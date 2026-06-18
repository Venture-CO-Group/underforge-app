/**
 * Dynamic daily nutrition adjustment layer.
 *
 * Baseline targets (from `user_nutrition_targets`, possibly the
 * training-day variant — see `getEffectiveNutritionTargets`) are NEVER
 * modified. Instead we write a per-day row into `nutrition_daily_adjustments`
 * that reflects how unplanned activity and steps shift the user's
 * calorie/macro goal for that specific date.
 *
 * Strategy: `protein_floor_v1`
 *   - Protein grams stay fixed at the baseline (hard floor — body-comp
 *     driver, not session fuel).
 *   - Of the kcal surplus, 70% goes to carbs and 30% to fat (closer to
 *     real endurance + strength practice than putting 100% into carbs).
 *   - Scale fiber with total calories using the same stepwise rule as
 *     `calculateMacrosFromCalories`.
 *   - Cap total adjustment at ±40% of baseline calories to avoid runaway
 *     swings when a provider misreports energy.
 *   - The kcal bump itself is goal-aware: fat-loss users only get 50% of
 *     the unplanned kcal added back so the deficit is preserved (see
 *     `goalBumpFactor` in `lib/nutrition-math.ts`).
 *   - Movement calories for adjustment exclude planned workouts (`step_id`
 *     on `workout_logs`): those sessions are already reflected in baseline
 *     targets from plan generation (see `computeAdjustableMovementCalories`).
 */

import { createClient } from '@supabase/supabase-js';
import { computeAdjustableMovementCalories } from './calories-balance';
import { estimateBaselineMovementKcalFromOnboard } from './llm-service';
import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import {
  getEffectiveNutritionTargets,
  getPersistedBaselineMovement,
  isPlannedTrainingDay,
  plannedTrainingKcalPerSession,
  type DayType,
  type NutritionTargets,
} from './nutrition-storage';
import { getTrainingDaySignals, hasAnyTrainingSignal } from './training-day-status';
import { getManualRestDayOverride } from './training-day-override';
import {
  MAX_CALORIE_ADJUSTMENT_FRACTION,
  NEAT_KCAL_PER_STEP_AT_70KG,
  NEAT_STEP_BASELINE,
  buildInputsDigest,
  computeAdjustment,
  goalBumpFactor,
  netMovementAboveBaseline,
} from './nutrition-math';

export {
  MAX_CALORIE_ADJUSTMENT_FRACTION,
  NEAT_KCAL_PER_STEP_AT_70KG,
  NEAT_STEP_BASELINE,
  buildInputsDigest,
  computeAdjustment,
};

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let supabase: any;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export interface AdjustmentInputs {
  userId: string;
  /** YYYY-MM-DD in user-local time. */
  adjustmentDate: string;
  /** Optional weight override. Defaults to the row from body_composition_log. */
  weightKg?: number;
  /** Onboarding profile — used for occupation NEAT when inferring movement kcal. */
  onboardData?: any;
  /**
   * Action plan JSON used to (a) flip between rest/training-day baselines
   * and (b) discount the planned-training kcal already in baseline from the
   * canonical active_energy_kcal. When missing we default to the rest-day
   * baseline with no plan-aware discount.
   */
  actionPlan?: any;
  /**
   * The user's selected goal (e.g. `burn_body_fat`, `build_muscle_mass`).
   * Drives the goal-aware bump factor — fat-loss users only get half of
   * unplanned kcal added back so the deficit is preserved.
   */
  selectedGoal?: string | null;
  /** Bypass inputs_digest short-circuit (e.g. manual training/rest override toggled). */
  forceRecompute?: boolean;
}

export interface NutritionAdjustment {
  userId: string;
  adjustmentDate: string;
  baseCaloriesTarget: number;
  baseCarbsTargetGrams: number;
  baseProteinTargetGrams: number;
  baseFatTargetGrams: number;
  baseFiberTargetGrams: number;
  activityCaloriesBurned: number;
  stepsNeatCalories: number;
  adjustedCaloriesTarget: number;
  adjustedCarbsTargetGrams: number;
  adjustedProteinTargetGrams: number;
  adjustedFatTargetGrams: number;
  adjustedFiberTargetGrams: number;
  strategy: 'carbs_first_v1' | 'protein_floor_v1';
  inputsDigest: string;
  computedAt: string;
}

/**
 * Compute and persist the nutrition adjustment for (user, date). Returns the
 * latest row. Caller decides when to invoke (on foreground, after a new
 * activity, after a steps update, etc.). Safe to call frequently -- uses
 * `inputs_digest` to skip redundant writes.
 */
export const recomputeDailyAdjustment = async (
  inputs: AdjustmentInputs,
): Promise<NutritionAdjustment | null> => {
  try {
    const db = getDatabase();

    // Day-type swap: planned training day → training baseline; otherwise
    // rest baseline. Plan-vs-reality swap: if the user logged a workout on a
    // planned rest day, flip to the training baseline (the LLM expected the
    // burn to live elsewhere, so we must replenish today).
    const plannedTrainingToday = inputs.actionPlan
      ? isPlannedTrainingDay(inputs.actionPlan, inputs.adjustmentDate)
      : false;
    const manualRestOverride = await getManualRestDayOverride(
      inputs.userId,
      inputs.adjustmentDate,
    );
    let dayType: DayType = 'rest';
    if (!manualRestOverride) {
      dayType = plannedTrainingToday ? 'training' : 'rest';
      if (!plannedTrainingToday) {
        const hasLoggedTrainingToday = await hasLoggedTrainingForDate(
          inputs.userId,
          inputs.adjustmentDate,
        );
        if (hasLoggedTrainingToday) dayType = 'training';
      }
    }
    const { targets: base } = await getEffectiveNutritionTargets(
      inputs.userId,
      inputs.adjustmentDate,
      { dayType, actionPlan: inputs.actionPlan },
    );

    // Planned training kcal already in baseline (used to discount canonical
    // active_energy_kcal). Zero on rest days or when the plan doesn't carry
    // a per-session estimate.
    const trainingStep = inputs.actionPlan?.steps?.find?.((s: any) => s?.id === 'step_1') ?? null;
    const plannedTrainingKcalForToday =
      plannedTrainingToday && !manualRestOverride
        ? plannedTrainingKcalPerSession(trainingStep)
        : 0;

    // Live day: when the user is mid-day, the per-session sum is more
    // accurate than the still-accumulating canonical active_energy_kcal.
    const todayYmdActual = todayYmdLocal();
    const liveDay = inputs.adjustmentDate === todayYmdActual;

    // Prefer the explicit baseline-movement value persisted with the user's
    // current nutrition targets (set by `persistPlanNutritionTargets`).
    // Fall back to a runtime recompute from onboarding answers for users
    // whose row predates the column.
    const persistedBaseline = await getPersistedBaselineMovement(inputs.userId);
    const occupationNeatKcal = persistedBaseline
      ? persistedBaseline.kcalPerDay
      : inputs.onboardData
      ? estimateBaselineMovementKcalFromOnboard(inputs.onboardData)
      : 0;

    const movement = await computeAdjustableMovementCalories({
      userId: inputs.userId,
      todayYmd: inputs.adjustmentDate,
      weightKg: inputs.weightKg ?? 72,
      occupationNeatKcal,
      plannedTrainingKcalForToday,
      liveDay,
    });

    const activityCalories = movement.activityCalories;
    // The base target already embeds `baselineMovement.kcalPerDay` of assumed
    // daily walking (== `occupationNeatKcal` here). The movement credit is a
    // from-zero count, so net the assumed baseline out to avoid double-counting
    // it every day — only the movement *above* baseline bumps the target.
    const stepsNeatCalories = netMovementAboveBaseline(
      movement.stepsNeatCalories,
      occupationNeatKcal,
    );

    const bumpFactor = goalBumpFactor(inputs.selectedGoal);
    const adjustment = computeAdjustment({
      base,
      activityCalories,
      stepsNeatCalories,
      bumpFactor,
    });

    const digest = buildInputsDigest({
      baseCals: base.caloriesTarget,
      activityCalories,
      stepsNeatCalories,
      weightKg: inputs.weightKg,
      strategy: 'protein_floor_v1',
      bumpFactor,
      dayType,
      manualRestOverride,
    });

    const existing = await db.getFirstAsync<{ id: number; inputs_digest: string | null }>(
      `SELECT id, inputs_digest FROM nutrition_daily_adjustments
        WHERE user_id = ? AND adjustment_date = ?`,
      [inputs.userId, inputs.adjustmentDate],
    );

    if (!inputs.forceRecompute && existing && existing.inputs_digest === digest) {
      return getAdjustmentForDate(inputs.userId, inputs.adjustmentDate);
    }

    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO nutrition_daily_adjustments
         (user_id, adjustment_date,
          base_calories_target, base_carbs_target_grams, base_protein_target_grams,
          base_fat_target_grams, base_fiber_target_grams,
          activity_calories_burned, steps_neat_calories,
          adjusted_calories_target, adjusted_carbs_target_grams, adjusted_protein_target_grams,
          adjusted_fat_target_grams, adjusted_fiber_target_grams,
          strategy, inputs_digest, computed_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(user_id, adjustment_date) DO UPDATE SET
          base_calories_target = excluded.base_calories_target,
          base_carbs_target_grams = excluded.base_carbs_target_grams,
          base_protein_target_grams = excluded.base_protein_target_grams,
          base_fat_target_grams = excluded.base_fat_target_grams,
          base_fiber_target_grams = excluded.base_fiber_target_grams,
          activity_calories_burned = excluded.activity_calories_burned,
          steps_neat_calories = excluded.steps_neat_calories,
          adjusted_calories_target = excluded.adjusted_calories_target,
          adjusted_carbs_target_grams = excluded.adjusted_carbs_target_grams,
          adjusted_protein_target_grams = excluded.adjusted_protein_target_grams,
          adjusted_fat_target_grams = excluded.adjusted_fat_target_grams,
          adjusted_fiber_target_grams = excluded.adjusted_fiber_target_grams,
          strategy = excluded.strategy,
          inputs_digest = excluded.inputs_digest,
          computed_at = excluded.computed_at,
          synced = 0`,
      [
        inputs.userId,
        inputs.adjustmentDate,
        base.caloriesTarget,
        base.carbsTarget,
        base.proteinTarget,
        base.fatTarget,
        base.fiberTarget,
        activityCalories,
        stepsNeatCalories,
        adjustment.adjustedCaloriesTarget,
        adjustment.adjustedCarbsTargetGrams,
        adjustment.adjustedProteinTargetGrams,
        adjustment.adjustedFatTargetGrams,
        adjustment.adjustedFiberTargetGrams,
        'protein_floor_v1',
        digest,
        now,
      ],
    );

    // Best-effort Supabase push.
    if (supabase) {
      void (async () => {
        try {
          const { error } = await supabase
            .from('nutrition_daily_adjustments')
            .upsert(
              {
                user_id: inputs.userId,
                adjustment_date: inputs.adjustmentDate,
                base_calories_target: base.caloriesTarget,
                base_carbs_target_grams: base.carbsTarget,
                base_protein_target_grams: base.proteinTarget,
                base_fat_target_grams: base.fatTarget,
                base_fiber_target_grams: base.fiberTarget,
                activity_calories_burned: activityCalories,
                steps_neat_calories: stepsNeatCalories,
                adjusted_calories_target: adjustment.adjustedCaloriesTarget,
                adjusted_carbs_target_grams: adjustment.adjustedCarbsTargetGrams,
                adjusted_protein_target_grams: adjustment.adjustedProteinTargetGrams,
                adjusted_fat_target_grams: adjustment.adjustedFatTargetGrams,
                adjusted_fiber_target_grams: adjustment.adjustedFiberTargetGrams,
                strategy: 'protein_floor_v1',
                inputs_digest: digest,
                computed_at: now,
              },
              { onConflict: 'user_id,adjustment_date' },
            );
          if (!error) {
            await db.runAsync(
              `UPDATE nutrition_daily_adjustments SET synced = 1
                WHERE user_id = ? AND adjustment_date = ?`,
              [inputs.userId, inputs.adjustmentDate],
            );
          }
        } catch (e) {
          glowLogger.warn('Supabase adjustment upsert failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
    }

    return getAdjustmentForDate(inputs.userId, inputs.adjustmentDate);
  } catch (error) {
    glowLogger.error('Failed to recompute daily adjustment', {
      error: error instanceof Error ? error.message : String(error),
      user_id: inputs.userId,
      date: inputs.adjustmentDate,
    });
    return null;
  }
};

/** Read the stored adjustment row for (user, date). */
export const getAdjustmentForDate = async (
  userId: string,
  date: string,
): Promise<NutritionAdjustment | null> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<any>(
      `SELECT * FROM nutrition_daily_adjustments
        WHERE user_id = ? AND adjustment_date = ?`,
      [userId, date],
    );
    if (!row) return null;
    return {
      userId: row.user_id,
      adjustmentDate: row.adjustment_date,
      baseCaloriesTarget: row.base_calories_target,
      baseCarbsTargetGrams: row.base_carbs_target_grams,
      baseProteinTargetGrams: row.base_protein_target_grams,
      baseFatTargetGrams: row.base_fat_target_grams,
      baseFiberTargetGrams: row.base_fiber_target_grams,
      activityCaloriesBurned: row.activity_calories_burned,
      stepsNeatCalories: row.steps_neat_calories,
      adjustedCaloriesTarget: row.adjusted_calories_target,
      adjustedCarbsTargetGrams: row.adjusted_carbs_target_grams,
      adjustedProteinTargetGrams: row.adjusted_protein_target_grams,
      adjustedFatTargetGrams: row.adjusted_fat_target_grams,
      adjustedFiberTargetGrams: row.adjusted_fiber_target_grams,
      strategy: row.strategy as 'carbs_first_v1' | 'protein_floor_v1',
      inputsDigest: row.inputs_digest,
      computedAt: row.computed_at,
    };
  } catch (error) {
    glowLogger.error('Failed to read nutrition_daily_adjustments', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      date,
    });
    return null;
  }
};

/**
 * Returns true when the app is wired to use the dynamic adjustment layer.
 * Gated by `EXPO_PUBLIC_WEARABLES_V1` so we can ship infra ahead of UI.
 */
export function isWearablesV1Enabled(): boolean {
  return process.env.EXPO_PUBLIC_WEARABLES_V1 === 'true';
}

function todayYmdLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function hasLoggedTrainingForDate(userId: string, ymd: string): Promise<boolean> {
  const signals = await getTrainingDaySignals(userId, ymd);
  if (hasAnyTrainingSignal(signals)) return true;
  try {
    const db = getDatabase();
    const inProgress = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM workout_logs
        WHERE user_id = ? AND workout_date = ? AND status = 'in_progress'`,
      [userId, ymd],
    );
    return (inProgress?.c ?? 0) > 0;
  } catch {
    return false;
  }
}
