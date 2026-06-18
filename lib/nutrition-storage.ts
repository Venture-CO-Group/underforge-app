import { createClient } from '@supabase/supabase-js';
import { computeBaselineMovement, type BaselineMovement } from './baseline-movement';
import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import { withRetry } from './retry';
import { PendingMealLogData, storePendingMealDeletion, storePendingMealLog } from './sync-status';
import type { Onboard } from '../types/onboard';

// `calculateBaseCalories` lives in llm-service; we only need the BMR /
// cardio / weight bits out of it to recompute the baseline-movement
// recommendation with the now-known plan-training kcal/day. Import is
// safe (no circular dep — llm-service does not import nutrition-storage).
import { calculateBaseCalories } from './llm-service';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let supabase: any;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export interface MealLog {
  id: number;
  supabaseId?: number | null;
  mealDescription: string;
  foodQuantities?: string;
  foodItemMacros?: MealLogFoodItemMacro[];
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  calories: number;
  loggedAt: Date;
  logDate: string; // YYYY-MM-DD format, the canonical date for grouping
}

export interface MealLogFoodItemMacro {
  name: string;
  grams: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  calories: number;
}

const normalizeFoodItemMacros = (value: unknown): MealLogFoodItemMacro[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const normalized = value
    .map((item): MealLogFoodItemMacro | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      if (!name) return null;

      const grams = Number(record.grams);
      const carbs = Number(record.carbs);
      const protein = Number(record.protein);
      const fat = Number(record.fat);
      const fiber = Number(record.fiber);
      if (![grams, carbs, protein, fat, fiber].every(Number.isFinite)) return null;

      const rawCalories = Number(record.calories);
      const calories = Number.isFinite(rawCalories)
        ? Math.round(rawCalories)
        : Math.round(carbs * 4 + protein * 4 + fat * 9);

      return {
        name,
        grams: Math.round(grams * 10) / 10,
        carbs: Math.round(carbs),
        protein: Math.round(protein),
        fat: Math.round(fat),
        fiber: Math.round(fiber),
        calories,
      };
    })
    .filter((item): item is MealLogFoodItemMacro => item != null);

  return normalized.length > 0 ? normalized : undefined;
};

const parseFoodItemMacros = (raw: unknown): MealLogFoodItemMacro[] | undefined => {
  if (!raw) return undefined;
  if (typeof raw !== 'string') return normalizeFoodItemMacros(raw);
  try {
    return normalizeFoodItemMacros(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

const serializeFoodItemMacros = (value?: unknown): string | null => {
  const normalized = normalizeFoodItemMacros(value);
  return normalized ? JSON.stringify(normalized) : null;
};

// Types for nutrition charts
export interface DailyNutritionData {
  date: string;
  dayName: string;
  dayOfMonth: number;
  monthNum: number;
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  isFuture: boolean;
}

export interface WeeklyNutritionStats {
  dailyData: DailyNutritionData[];
  weeklyTotals: {
    calories: number;
    carbs: number;
    protein: number;
    fat: number;
    fiber: number;
  };
  daysElapsed: number;
  targets: {
    calories: number;
    carbs: number;
    protein: number;
    fat: number;
    fiber: number;
  };
}

export type NutritionPeriod = 'current' | '2weeks';

export interface DailyNutritionTotals {
  totalCarbs: number;
  totalProtein: number;
  totalFat: number;
  totalFiber: number;
  totalCalories: number;
  carbsTarget: number;
  proteinTarget: number;
  fatTarget: number;
  fiberTarget: number;
  caloriesTarget: number;
  carbsPercentOfTarget: number;
  proteinPercentOfTarget: number;
  fatPercentOfTarget: number;
  fiberPercentOfTarget: number;
  caloriesPercentOfTarget: number;
}

export interface NutritionTargets {
  caloriesTarget: number;
  carbsTarget: number;
  proteinTarget: number;
  fatTarget: number;
  fiberTarget: number;
  /**
   * Training-day variants. Optional — when missing the rest-day baseline is
   * used for every day (legacy rows from before the v1.2 schema).
   */
  trainingDayCaloriesTarget?: number;
  trainingDayCarbsTarget?: number;
  trainingDayProteinTarget?: number;
  trainingDayFatTarget?: number;
  trainingDayFiberTarget?: number;
}

/** Which variant a runtime caller wants. `auto` resolves from the action plan. */
export type DayType = 'rest' | 'training';

// Default calorie targets by gender (conservative estimates)
const GENDER_CALORIE_DEFAULTS: { [key: string]: number } = {
  'Male': 2200,
  'Female': 1800,
  'Non-binary': 2000,
  'Prefer not to say': 2000,
};

const DEFAULT_CALORIES = 2000;

/**
 * Calculate macro targets from a calorie target using 40/30/30 split
 * - Carbs: 40% of calories / 4 cal per gram
 * - Protein: 30% of calories / 4 cal per gram
 * - Fat: 30% of calories / 9 cal per gram
 */
export const calculateMacrosFromCalories = (calories: number): NutritionTargets => {
  const carbsCalories = calories * 0.40;
  const proteinCalories = calories * 0.30;
  const fatCalories = calories * 0.30;

  return {
    caloriesTarget: calories,
    carbsTarget: Math.round(carbsCalories / 4),
    proteinTarget: Math.round(proteinCalories / 4),
    fatTarget: Math.round(fatCalories / 9),
    fiberTarget: calories >= 2000 ? 30 : (calories >= 1800 ? 25 : 21), // Adjust fiber based on calories (monotonic)
  };
};

/**
 * % of calories from each macro among carbs+protein+fat only (4 kcal/g C & P, 9 kcal/g F).
 * Matches weekly macro bar math for logged food and target rows from user_nutrition_targets grams.
 */
export function macroCalorieSplitPercentsFromGrams(
  carbsGrams: number,
  proteinGrams: number,
  fatGrams: number,
): { carbsPct: number; proteinPct: number; fatPct: number } | null {
  const carbsCals = carbsGrams * 4;
  const proteinCals = proteinGrams * 4;
  const fatCals = fatGrams * 9;
  const sum = carbsCals + proteinCals + fatCals;
  if (sum <= 0) return null;
  return {
    carbsPct: Math.round((carbsCals / sum) * 100),
    proteinPct: Math.round((proteinCals / sum) * 100),
    fatPct: Math.round((fatCals / sum) * 100),
  };
}

/**
 * Read the persisted baseline-movement recommendation for the user from
 * the latest effective `user_nutrition_targets` row. Returns `null` when
 * no row exists *or* the row predates the baseline_movement_* columns
 * (i.e. all three values are NULL). Local SQLite first, Supabase fallback.
 *
 * Callers that fall back to a runtime recompute (CoachDashboard / burn
 * card / nutrition adjustment) should treat null as "use the live
 * `computeBaselineMovement` from onboarding answers instead".
 */
export const getPersistedBaselineMovement = async (
  userId: string,
): Promise<{ kcalPerDay: number; minutesPerDay: number; stepsPerDayApprox: number } | null> => {
  try {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const db = getDatabase();
    const row = await db.getFirstAsync<{
      baseline_movement_kcal: number | null;
      baseline_movement_minutes: number | null;
      baseline_movement_steps: number | null;
    }>(
      `SELECT baseline_movement_kcal, baseline_movement_minutes, baseline_movement_steps
         FROM user_nutrition_targets
        WHERE user_id = ? AND effective_from <= ?
        ORDER BY effective_from DESC
        LIMIT 1`,
      [userId, today],
    );
    if (row && row.baseline_movement_kcal !== null && row.baseline_movement_minutes !== null) {
      return {
        kcalPerDay: row.baseline_movement_kcal,
        minutesPerDay: row.baseline_movement_minutes,
        stepsPerDayApprox: row.baseline_movement_steps ?? 0,
      };
    }
  } catch (e) {
    glowLogger.warn('getPersistedBaselineMovement local read failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Supabase fallback for fresh installs that haven't synced down yet.
  if (supabase) {
    try {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const { data, error } = await supabase
        .from('user_nutrition_targets')
        .select('baseline_movement_kcal, baseline_movement_minutes, baseline_movement_steps')
        .eq('user_id', userId)
        .lte('effective_from', today)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data && data.baseline_movement_kcal != null && data.baseline_movement_minutes != null) {
        return {
          kcalPerDay: data.baseline_movement_kcal,
          minutesPerDay: data.baseline_movement_minutes,
          stepsPerDayApprox: data.baseline_movement_steps ?? 0,
        };
      }
    } catch (e) {
      glowLogger.warn('getPersistedBaselineMovement supabase read failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return null;
};

/**
 * Get the current effective nutrition targets for a user
 * Returns the latest targets where effective_from <= today
 * Falls back to defaults if no targets exist
 */
export const getUserNutritionTargets = async (userId: string): Promise<NutritionTargets> => {
  try {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Try local SQLite first
    const db = getDatabase();
    
    // Debug: Check all entries for this user
    const allEntries = await db.getAllAsync<{
      id: number;
      supabase_id: number | null;
      effective_from: string;
      calories_target: number;
    }>(`
      SELECT id, supabase_id, effective_from, calories_target
      FROM user_nutrition_targets
      WHERE user_id = ?
    `, [userId]);
    
    glowLogger.info('All nutrition target entries for user', {
      user_id: userId,
      today: today,
      entries: allEntries
    });
    
    const localResult = await db.getFirstAsync<{
      calories_target: number;
      carbs_target_grams: number;
      protein_target_grams: number;
      fat_target_grams: number;
      fiber_target_grams: number;
      training_day_calories_target: number | null;
      training_day_carbs_target_grams: number | null;
      training_day_protein_target_grams: number | null;
      training_day_fat_target_grams: number | null;
      training_day_fiber_target_grams: number | null;
    }>(`
      SELECT calories_target, carbs_target_grams, protein_target_grams, fat_target_grams, fiber_target_grams,
             training_day_calories_target, training_day_carbs_target_grams, training_day_protein_target_grams,
             training_day_fat_target_grams, training_day_fiber_target_grams
      FROM user_nutrition_targets
      WHERE user_id = ? AND effective_from <= ?
      ORDER BY effective_from DESC
      LIMIT 1
    `, [userId, today]);

    if (localResult) {
      glowLogger.info('User nutrition targets fetched from local SQLite', {
        user_id: userId,
        targets: localResult
      });
      return {
        caloriesTarget: localResult.calories_target,
        carbsTarget: localResult.carbs_target_grams,
        proteinTarget: localResult.protein_target_grams,
        fatTarget: localResult.fat_target_grams,
        fiberTarget: localResult.fiber_target_grams,
        trainingDayCaloriesTarget: localResult.training_day_calories_target ?? undefined,
        trainingDayCarbsTarget: localResult.training_day_carbs_target_grams ?? undefined,
        trainingDayProteinTarget: localResult.training_day_protein_target_grams ?? undefined,
        trainingDayFatTarget: localResult.training_day_fat_target_grams ?? undefined,
        trainingDayFiberTarget: localResult.training_day_fiber_target_grams ?? undefined,
      };
    }

    // Try Supabase if no local data
    if (supabase) {
      const { data, error } = await supabase
        .from('user_nutrition_targets')
        .select('*')
        .eq('user_id', userId)
        .lte('effective_from', today)
        .order('effective_from', { ascending: false })
        .limit(1)
        .single();

      if (!error && data) {
        // First delete any existing entry for this user+date to avoid conflicts
        await db.runAsync(`
          DELETE FROM user_nutrition_targets 
          WHERE user_id = ? AND effective_from = ?
        `, [data.user_id, data.effective_from]);
        
        // Then insert the Supabase data
        await db.runAsync(`
          INSERT INTO user_nutrition_targets 
          (supabase_id, user_id, calories_target, carbs_target_grams, protein_target_grams, fat_target_grams, fiber_target_grams,
           training_day_calories_target, training_day_carbs_target_grams, training_day_protein_target_grams,
           training_day_fat_target_grams, training_day_fiber_target_grams,
           effective_from, synced)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
          data.id, data.user_id, data.calories_target, data.carbs_target_grams, data.protein_target_grams,
          data.fat_target_grams, data.fiber_target_grams,
          data.training_day_calories_target ?? null,
          data.training_day_carbs_target_grams ?? null,
          data.training_day_protein_target_grams ?? null,
          data.training_day_fat_target_grams ?? null,
          data.training_day_fiber_target_grams ?? null,
          data.effective_from,
        ]);

        glowLogger.info('User nutrition targets fetched from Supabase and cached locally', {
          user_id: userId,
          targets: data
        });

        return {
          caloriesTarget: data.calories_target,
          carbsTarget: parseFloat(data.carbs_target_grams),
          proteinTarget: parseFloat(data.protein_target_grams),
          fatTarget: parseFloat(data.fat_target_grams),
          fiberTarget: parseFloat(data.fiber_target_grams),
          trainingDayCaloriesTarget: data.training_day_calories_target ?? undefined,
          trainingDayCarbsTarget:
            data.training_day_carbs_target_grams != null ? parseFloat(data.training_day_carbs_target_grams) : undefined,
          trainingDayProteinTarget:
            data.training_day_protein_target_grams != null ? parseFloat(data.training_day_protein_target_grams) : undefined,
          trainingDayFatTarget:
            data.training_day_fat_target_grams != null ? parseFloat(data.training_day_fat_target_grams) : undefined,
          trainingDayFiberTarget:
            data.training_day_fiber_target_grams != null ? parseFloat(data.training_day_fiber_target_grams) : undefined,
        };
      }
    }

    // No targets found - return defaults (will be created on init)
    glowLogger.info('No nutrition targets found, returning defaults', { user_id: userId });
    return calculateMacrosFromCalories(DEFAULT_CALORIES);
  } catch (error) {
    glowLogger.error('Error in getUserNutritionTargets', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return calculateMacrosFromCalories(DEFAULT_CALORIES);
  }
};

/**
 * Create default nutrition targets for a user based on their gender
 * Saves to both local SQLite and Supabase
 */
export const createDefaultNutritionTargets = async (userId: string, gender: string | null): Promise<NutritionTargets> => {
  try {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Get calorie target based on gender
    const caloriesTarget = gender && GENDER_CALORIE_DEFAULTS[gender] 
      ? GENDER_CALORIE_DEFAULTS[gender] 
      : DEFAULT_CALORIES;

    // Calculate macros from calories
    const targets = calculateMacrosFromCalories(caloriesTarget);

    glowLogger.info('Creating default nutrition targets', {
      user_id: userId,
      gender,
      targets
    });

    // Save to local SQLite
    const db = getDatabase();
    const localResult = await db.runAsync(`
      INSERT OR REPLACE INTO user_nutrition_targets 
      (user_id, calories_target, carbs_target_grams, protein_target_grams, fat_target_grams, fiber_target_grams, effective_from, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `, [userId, targets.caloriesTarget, targets.carbsTarget, targets.proteinTarget, targets.fatTarget, targets.fiberTarget, today]);

    const localId = localResult.lastInsertRowId;

    // Try to sync to Supabase
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('user_nutrition_targets')
          .insert({
            user_id: userId,
            calories_target: targets.caloriesTarget,
            carbs_target_grams: targets.carbsTarget,
            protein_target_grams: targets.proteinTarget,
            fat_target_grams: targets.fatTarget,
            fiber_target_grams: targets.fiberTarget,
            effective_from: today,
          })
          .select('id')
          .single();

        if (!error && data) {
          // Update local record with Supabase ID
          await db.runAsync(
            'UPDATE user_nutrition_targets SET supabase_id = ?, synced = 1 WHERE id = ?',
            [data.id, localId]
          );
          glowLogger.info('Default nutrition targets synced to Supabase', {
            user_id: userId,
            supabase_id: data.id
          });
        }
      } catch (syncError) {
        glowLogger.warn('Failed to sync nutrition targets to Supabase', {
          error: syncError instanceof Error ? syncError.message : String(syncError)
        });
      }
    }

    return targets;
  } catch (error) {
    glowLogger.error('Error in createDefaultNutritionTargets', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return calculateMacrosFromCalories(DEFAULT_CALORIES);
  }
};

/**
 * Sync nutrition targets from Supabase to local SQLite
 * Call this when app starts to ensure local cache is up to date
 */
export const syncNutritionTargetsFromSupabase = async (userId: string): Promise<number> => {
  if (!supabase) {
    return 0;
  }

  try {
    // Get all targets for this user from Supabase
    const { data, error } = await supabase
      .from('user_nutrition_targets')
      .select('*')
      .eq('user_id', userId)
      .order('effective_from', { ascending: false });

    if (error || !data) {
      glowLogger.warn('Failed to sync nutrition targets from Supabase', { error: error?.message });
      return 0;
    }

    const db = getDatabase();
    let syncedCount = 0;

    for (const row of data) {
      try {
        // Delete any existing entry for this user+date combination to force fresh data
        await db.runAsync(`
          DELETE FROM user_nutrition_targets 
          WHERE user_id = ? AND effective_from = ?
        `, [row.user_id, row.effective_from]);
        
        // Then insert the Supabase data
        await db.runAsync(`
          INSERT INTO user_nutrition_targets 
          (supabase_id, user_id, calories_target, carbs_target_grams, protein_target_grams, fat_target_grams, fiber_target_grams,
           training_day_calories_target, training_day_carbs_target_grams, training_day_protein_target_grams,
           training_day_fat_target_grams, training_day_fiber_target_grams,
           effective_from, synced)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
          row.id, row.user_id, row.calories_target, row.carbs_target_grams, row.protein_target_grams,
          row.fat_target_grams, row.fiber_target_grams,
          row.training_day_calories_target ?? null,
          row.training_day_carbs_target_grams ?? null,
          row.training_day_protein_target_grams ?? null,
          row.training_day_fat_target_grams ?? null,
          row.training_day_fiber_target_grams ?? null,
          row.effective_from,
        ]);
        syncedCount++;
      } catch (syncError) {
        glowLogger.warn('Error syncing individual nutrition target', {
          error: syncError instanceof Error ? syncError.message : String(syncError),
          supabase_id: row.id,
          user_id: row.user_id,
          effective_from: row.effective_from
        });
      }
    }

    glowLogger.info('Synced nutrition targets from Supabase to local', {
      user_id: userId,
      synced_count: syncedCount,
      total_remote: data.length
    });

    return syncedCount;
  } catch (error) {
    glowLogger.error('Error syncing nutrition targets from Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return 0;
  }
};

/**
 * Initialize nutrition targets for a user if they don't exist
 * Should be called on app load/user login
 */
export const initializeNutritionTargetsIfNeeded = async (userId: string, gender: string | null): Promise<NutritionTargets> => {
  try {
    // First sync from Supabase to get any existing targets
    await syncNutritionTargetsFromSupabase(userId);

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Check if user has any targets
    const db = getDatabase();
    const existing = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM user_nutrition_targets WHERE user_id = ? AND effective_from <= ?',
      [userId, today]
    );

    if (existing) {
      // User has targets, return them
      return await getUserNutritionTargets(userId);
    }

    // No targets exist, create defaults based on gender
    glowLogger.info('No nutrition targets found, creating defaults', {
      user_id: userId,
      gender
    });
    return await createDefaultNutritionTargets(userId, gender);
  } catch (error) {
    glowLogger.error('Error in initializeNutritionTargetsIfNeeded', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return calculateMacrosFromCalories(DEFAULT_CALORIES);
  }
};

/**
 * Persist the LLM-calculated nutrition targets from `actionPlan.steps[step_2].nutrition_targets`
 * into `user_nutrition_targets` as a new history row. Computes both the
 * rest-day baseline (the LLM's caloriesTarget as-is) and a training-day
 * variant by layering the average estimatedCaloriesBurned per training
 * session on top.
 *
 * - `effectiveFromYmd` defaults to "today" so prior days keep their old
 *   baseline (the table is history-aware via `effective_from`).
 * - Macros on training days: keep protein constant; bump carbs by 70% of
 *   the kcal delta and fat by 30%; recompute fiber stepwise. This matches
 *   the `protein_floor_v1` strategy in `lib/nutrition-math.ts`.
 * - Best-effort Supabase upsert.
 */
export const persistPlanNutritionTargets = async (params: {
  userId: string;
  actionPlan: any;
  /**
   * Onboarding profile. When provided, used to derive the explicit
   * baseline-movement recommendation that gets persisted alongside the
   * macro targets. When omitted (legacy callers), baseline-movement
   * columns stay NULL and downstream consumers fall back to a runtime
   * recompute. Strongly preferred to pass it.
   */
  onboardData?: Onboard;
  effectiveFromYmd?: string;
}): Promise<NutritionTargets | null> => {
  try {
    const { userId, actionPlan, onboardData } = params;
    if (!actionPlan?.steps) return null;

    const nutritionStep = actionPlan.steps.find((s: any) => s?.id === 'step_2') ?? null;
    const nt = nutritionStep?.nutrition_targets;
    if (!nt || typeof nt.caloriesTarget !== 'number') {
      glowLogger.info('persistPlanNutritionTargets: step_2.nutrition_targets missing, skipping', {
        user_id: userId,
      });
      return null;
    }

    const trainingStep = actionPlan.steps.find((s: any) => s?.id === 'step_1') ?? null;
    const { restCalories, trainingCalories } = deriveRestAndTrainingCalories(nt.caloriesTarget, trainingStep);

    // Compute baseline-movement recommendation if we have onboarding data.
    // Inputs explicitly: occupation activity, weight, habitual cardio,
    // and the plan-training kcal/day we just learned from step 1.
    const baselineMovement = onboardData
      ? deriveBaselineMovementForPlan(onboardData, trainingStep)
      : null;

    const restMacros: NutritionTargets = {
      caloriesTarget: restCalories,
      carbsTarget: Math.round(Number(nt.carbsTarget ?? 0)),
      proteinTarget: Math.round(Number(nt.proteinTarget ?? 0)),
      fatTarget: Math.round(Number(nt.fatTarget ?? 0)),
      fiberTarget: Math.round(Number(nt.fiberTarget ?? 0)),
    };

    const trainingMacros = deriveTrainingMacros(restMacros, trainingCalories);

    const now = new Date();
    const today = params.effectiveFromYmd
      ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const db = getDatabase();
    await db.runAsync(`
      INSERT OR REPLACE INTO user_nutrition_targets
        (user_id, calories_target, carbs_target_grams, protein_target_grams, fat_target_grams, fiber_target_grams,
         training_day_calories_target, training_day_carbs_target_grams, training_day_protein_target_grams,
         training_day_fat_target_grams, training_day_fiber_target_grams,
         baseline_movement_kcal, baseline_movement_minutes, baseline_movement_steps,
         effective_from, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [
      userId,
      restMacros.caloriesTarget,
      restMacros.carbsTarget,
      restMacros.proteinTarget,
      restMacros.fatTarget,
      restMacros.fiberTarget,
      trainingMacros.caloriesTarget,
      trainingMacros.carbsTarget,
      trainingMacros.proteinTarget,
      trainingMacros.fatTarget,
      trainingMacros.fiberTarget,
      baselineMovement?.kcalPerDay ?? null,
      baselineMovement?.minutesPerDay ?? null,
      baselineMovement?.stepsPerDayApprox ?? null,
      today,
    ]);

    glowLogger.info('Persisted plan nutrition targets', {
      user_id: userId,
      effective_from: today,
      rest: restMacros,
      training: trainingMacros,
      baseline_movement: baselineMovement,
    });

    if (supabase) {
      try {
        await supabase
          .from('user_nutrition_targets')
          .upsert({
            user_id: userId,
            calories_target: restMacros.caloriesTarget,
            carbs_target_grams: restMacros.carbsTarget,
            protein_target_grams: restMacros.proteinTarget,
            fat_target_grams: restMacros.fatTarget,
            fiber_target_grams: restMacros.fiberTarget,
            training_day_calories_target: trainingMacros.caloriesTarget,
            training_day_carbs_target_grams: trainingMacros.carbsTarget,
            training_day_protein_target_grams: trainingMacros.proteinTarget,
            training_day_fat_target_grams: trainingMacros.fatTarget,
            training_day_fiber_target_grams: trainingMacros.fiberTarget,
            baseline_movement_kcal: baselineMovement?.kcalPerDay ?? null,
            baseline_movement_minutes: baselineMovement?.minutesPerDay ?? null,
            baseline_movement_steps: baselineMovement?.stepsPerDayApprox ?? null,
            effective_from: today,
          }, { onConflict: 'user_id,effective_from' });
        await db.runAsync(
          `UPDATE user_nutrition_targets SET synced = 1 WHERE user_id = ? AND effective_from = ?`,
          [userId, today],
        );
      } catch (e) {
        glowLogger.warn('Supabase upsert for persisted plan targets failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      ...restMacros,
      trainingDayCaloriesTarget: trainingMacros.caloriesTarget,
      trainingDayCarbsTarget: trainingMacros.carbsTarget,
      trainingDayProteinTarget: trainingMacros.proteinTarget,
      trainingDayFatTarget: trainingMacros.fatTarget,
      trainingDayFiberTarget: trainingMacros.fiberTarget,
    };
  } catch (error) {
    glowLogger.error('persistPlanNutritionTargets failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

/**
 * Average plan-training kcal per training day implied by step 1 of the
 * action plan. Returns 0 when the step or estimate is missing.
 */
export function plannedTrainingKcalPerSession(trainingStep: any): number {
  if (!trainingStep) return 0;
  const estimatedFromStepDetails = parseEstimatedKcalFromStepDetails(trainingStep.step_details);
  if (estimatedFromStepDetails > 0) return estimatedFromStepDetails;
  return 0;
}

/**
 * Plan-training kcal averaged across the *full* week (training + rest days).
 *   per_day = per_session × training_days_per_week / 7
 * Returns 0 when the plan is missing required pieces.
 *
 * Used by the baseline-movement recommendation: prescribed training reduces
 * how much extra walking we ask of the user.
 */
export function plannedTrainingKcalPerDay(trainingStep: any): number {
  const perSession = plannedTrainingKcalPerSession(trainingStep);
  if (perSession <= 0) return 0;
  const days = Array.isArray(trainingStep?.daysOfWeek) ? trainingStep.daysOfWeek.length : 0;
  if (days <= 0) return 0;
  return Math.round((perSession * days) / 7);
}

/**
 * Derive the baseline-movement recommendation we want to persist alongside
 * the macro targets. Combines:
 *
 *  - occupation activity (from onboarding)
 *  - habitual cardio kcal/day (computed by `calculateBaseCalories`)
 *  - the plan-training kcal/day implied by step 1
 *  - bodyweight (parsed from onboarding, defaults to 70 kg)
 *
 * Returns `null` when bodyweight cannot be parsed; callers should treat
 * that as "skip persisting" so legacy NULL semantics are preserved.
 */
function deriveBaselineMovementForPlan(
  onboardData: Onboard,
  trainingStep: any,
): BaselineMovement | null {
  // We rely on `calculateBaseCalories` for parsed weight + cardio kcal so
  // the recommendation tracks the same Onboard parsing as the rest of the
  // calorie pipeline (gender/age/height/weight fallbacks, JSON vs natural
  // language for `usual_cardio`, etc.).
  const calc = calculateBaseCalories(onboardData);
  if (!calc) return null;

  const occupationActivity: string =
    (onboardData as any).occupation_activity ||
    onboardData.clarifyingQuestions?.find((q) => q.question === 'occupation_activity')?.answer ||
    '';

  const weightKg = parseWeightKgFromOnboard(onboardData);
  const planKcalPerDay = plannedTrainingKcalPerDay(trainingStep);

  return computeBaselineMovement({
    occupationActivity,
    weightKg,
    cardioKcalPerDay: calc.cardioKcalPerDay,
    planTrainingKcalPerDay: planKcalPerDay,
  });
}

/** Parse "(70 kg)" out of the onboarding weight string; defaults to 70. */
function parseWeightKgFromOnboard(onboardData: Onboard): number {
  const candidates: string[] = [
    onboardData.weight ?? '',
    onboardData.clarifyingQuestions?.find((q) => q.question === 'current_weight_question')?.answer ?? '',
  ];
  for (const c of candidates) {
    const m = c.match(/\((\d+)\s*kg\)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return 70;
}

/** kcal from LLM workout JSON in step_details (string, object, or array of days). */
function parseEstimatedKcalFromStepDetails(stepDetails: unknown): number {
  if (typeof stepDetails === 'string') {
    return parseEstimatedKcalFromStepDetailsString(stepDetails);
  }
  if (stepDetails !== null && typeof stepDetails === 'object') {
    return extractPlannedSessionKcalFromStructuredStepDetails(stepDetails);
  }
  return 0;
}

function parseEstimatedKcalFromStepDetailsString(details: string): number {
  // Multi-day plans: array of workouts. Single-day plans: object.
  const matches = details.match(/"estimatedCaloriesBurned"\s*:\s*(\d+)/g);
  if (!matches || matches.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (const m of matches) {
    const n = parseInt(m.replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(n) && n > 0) {
      sum += n;
      count++;
    }
  }
  return count > 0 ? Math.round(sum / count) : 0;
}

function extractPlannedSessionKcalFromStructuredStepDetails(stepDetails: object): number {
  const fromObject = (o: Record<string, unknown>): number | null => {
    if (
      'text' in o &&
      typeof o.text === 'string' &&
      !('dayName' in o) &&
      !('estimatedCaloriesBurned' in o)
    ) {
      return null;
    }
    const raw = o.estimatedCaloriesBurned;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.round(raw);
    }
    if (typeof raw === 'string') {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };

  if (Array.isArray(stepDetails)) {
    const values: number[] = [];
    for (const item of stepDetails) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const n = fromObject(item as Record<string, unknown>);
        if (n != null && n > 0) values.push(n);
      }
    }
    if (values.length === 0) return 0;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }

  const single = fromObject(stepDetails as Record<string, unknown>);
  return single != null && single > 0 ? single : 0;
}

function deriveRestAndTrainingCalories(
  planCalories: number,
  trainingStep: any,
): { restCalories: number; trainingCalories: number } {
  const cals = Math.round(planCalories);
  const perSession = plannedTrainingKcalPerSession(trainingStep);
  const trainingDays = Array.isArray(trainingStep?.daysOfWeek) ? trainingStep.daysOfWeek.length : 0;
  if (perSession <= 0 || trainingDays <= 0 || trainingDays >= 7) {
    // Either we couldn't parse session kcal, or the plan trains every day —
    // in both cases the "rest" notion has no useful meaning; treat both
    // variants as equal so the runtime falls back to a single baseline.
    return { restCalories: cals, trainingCalories: cals };
  }
  // The LLM's plan caloriesTarget represents the weekly average. Split it
  // into rest- and training-day variants such that the weighted average
  // still equals `cals`:
  //   cals * 7 = restCalories * (7 - trainingDays) + trainingCalories * trainingDays
  //   trainingCalories - restCalories = perSession
  const trainingCalories = Math.round(cals + perSession * (7 - trainingDays) / 7);
  const restCalories = Math.round(cals - perSession * trainingDays / 7);
  return { restCalories, trainingCalories };
}

function deriveTrainingMacros(rest: NutritionTargets, trainingCalories: number): NutritionTargets {
  const delta = trainingCalories - rest.caloriesTarget;
  if (delta <= 0) {
    return { ...rest, caloriesTarget: trainingCalories };
  }
  // protein_floor_v1: protein constant, 70% of delta into carbs, 30% into fat.
  const carbsBumpGrams = (delta * 0.70) / 4;
  const fatBumpGrams = (delta * 0.30) / 9;
  const fiber = trainingCalories >= 2000 ? 30 : trainingCalories >= 1800 ? 25 : 21;
  return {
    caloriesTarget: trainingCalories,
    carbsTarget: Math.round(rest.carbsTarget + carbsBumpGrams),
    proteinTarget: rest.proteinTarget,
    fatTarget: Math.round(rest.fatTarget + fatBumpGrams),
    fiberTarget: fiber,
  };
}

/** Lowercase day-of-week token (mon/tue/...) for a YYYY-MM-DD date. */
export function dayTokenForYmd(ymd: string): string {
  const tokens = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const d = new Date(`${ymd}T12:00:00`);
  return tokens[d.getDay()] ?? 'mon';
}

/** Returns true when `ymd` is a planned training day per `step_1.daysOfWeek`. */
export function isPlannedTrainingDay(actionPlan: any, ymd: string): boolean {
  const step1 = actionPlan?.steps?.find?.((s: any) => s?.id === 'step_1');
  const days: string[] | undefined = step1?.daysOfWeek;
  if (!Array.isArray(days) || days.length === 0) return false;
  return days.map((d) => String(d).toLowerCase()).includes(dayTokenForYmd(ymd));
}

/** Training-day macros from persisted columns or derived from the action plan. */
function resolveTrainingTargets(
  base: NutritionTargets,
  actionPlan?: any,
): NutritionTargets | null {
  if (typeof base.trainingDayCaloriesTarget === 'number') {
    return {
      caloriesTarget: base.trainingDayCaloriesTarget,
      carbsTarget: base.trainingDayCarbsTarget ?? base.carbsTarget,
      proteinTarget: base.trainingDayProteinTarget ?? base.proteinTarget,
      fatTarget: base.trainingDayFatTarget ?? base.fatTarget,
      fiberTarget: base.trainingDayFiberTarget ?? base.fiberTarget,
      trainingDayCaloriesTarget: base.trainingDayCaloriesTarget,
      trainingDayCarbsTarget: base.trainingDayCarbsTarget,
      trainingDayProteinTarget: base.trainingDayProteinTarget,
      trainingDayFatTarget: base.trainingDayFatTarget,
      trainingDayFiberTarget: base.trainingDayFiberTarget,
    };
  }
  if (!actionPlan?.steps) return null;
  const nutritionStep = actionPlan.steps.find((s: any) => s?.id === 'step_2') ?? null;
  const nt = nutritionStep?.nutrition_targets;
  if (!nt || typeof nt.caloriesTarget !== 'number') return null;
  const trainingStep = actionPlan.steps.find((s: any) => s?.id === 'step_1') ?? null;
  const { trainingCalories } = deriveRestAndTrainingCalories(nt.caloriesTarget, trainingStep);
  if (trainingCalories <= base.caloriesTarget) return null;
  return deriveTrainingMacros(base, trainingCalories);
}

/**
 * Effective targets for `ymd` taking the day type into account.
 * - If `dayType` is provided, picks that variant explicitly.
 * - Otherwise resolves from `actionPlan` (when provided).
 * - Falls back to the rest-day baseline when no training-day variant is set.
 */
export const getEffectiveNutritionTargets = async (
  userId: string,
  ymd: string,
  options?: { actionPlan?: any; dayType?: DayType },
): Promise<{ targets: NutritionTargets; dayType: DayType }> => {
  const base = await getUserNutritionTargets(userId);
  let dayType: DayType = options?.dayType ?? 'rest';
  if (!options?.dayType) {
    dayType = options?.actionPlan && isPlannedTrainingDay(options.actionPlan, ymd) ? 'training' : 'rest';
  }
  if (dayType === 'training') {
    const trainingTargets = resolveTrainingTargets(base, options?.actionPlan);
    if (trainingTargets) {
      return { targets: trainingTargets, dayType: 'training' };
    }
  }
  return { targets: base, dayType: 'rest' };
};

/**
 * Save an individual meal log (local-first pattern)
 * 1. Save to local SQLite immediately
 * 2. Attempt to sync to Supabase
 * 3. If Supabase fails, queue for retry
 */
export const saveMealLog = async (
  userId: string,
  mealDescription: string,
  carbs: number,
  protein: number,
  fat: number,
  fiber: number,
  calories: number,
  logDate?: string,
  foodQuantities?: string,
  foodItemMacros?: unknown
): Promise<boolean> => {
  try {
    const now = new Date();
    const today = logDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const loggedAt = now.toISOString();
    const foodItemMacrosJson = serializeFoodItemMacros(foodItemMacros);

    glowLogger.info('Saving meal log (local-first)', {
      user_id: userId,
      date: today,
      meal_description: mealDescription,
      carbs,
      protein,
      fat,
      fiber,
      calories,
      has_food_item_macros: foodItemMacrosJson != null
    });

    // Step 1: Save to local SQLite first (always succeeds if DB is available)
    const db = getDatabase();
    const result = await db.runAsync(`
      INSERT INTO meal_logs (user_id, log_date, meal_description, carbs_grams, protein_grams, fat_grams, fiber_grams, calories, food_quantities, food_item_macros, logged_at, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [userId, today, mealDescription, carbs, protein, fat, fiber, calories, foodQuantities || null, foodItemMacrosJson, loggedAt]);

    const localId = result.lastInsertRowId;
    glowLogger.info('Meal log saved to local SQLite', { user_id: userId, local_id: localId });

    // Step 2: Try to sync to Supabase
    if (supabase) {
      try {
        const supabasePayload: Record<string, unknown> = {
            user_id: userId,
            log_date: today,
            meal_description: mealDescription,
            carbs_grams: carbs,
            protein_grams: protein,
            fat_grams: fat,
            fiber_grams: fiber,
            calories: calories,
          };
        if (foodQuantities) {
          supabasePayload.food_quantities = foodQuantities;
        }
        if (foodItemMacrosJson) {
          supabasePayload.food_item_macros = JSON.parse(foodItemMacrosJson);
        }
        const { data, error } = await supabase
          .from('meal_logs')
          .insert(supabasePayload)
          .select('id')
          .single();

        if (!error && data) {
          // Update local record with Supabase ID and mark as synced
          await db.runAsync(
            'UPDATE meal_logs SET supabase_id = ?, synced = 1 WHERE id = ?',
            [data.id, localId]
          );
          glowLogger.info('Meal log synced to Supabase', { 
            user_id: userId, 
            local_id: localId, 
            supabase_id: data.id 
          });
          
          // Update daily totals in Supabase
          await updateDailyTotals(userId, today);
        } else {
          // Queue for retry
          glowLogger.warn('Meal log Supabase sync failed, queuing for retry', {
            user_id: userId,
            local_id: localId,
            error: error?.message
          });
          
          const pendingData: PendingMealLogData = {
            local_id: localId,
            user_id: userId,
            log_date: today,
            meal_description: mealDescription,
            carbs_grams: carbs,
            protein_grams: protein,
            fat_grams: fat,
            fiber_grams: fiber,
            calories: calories,
            food_quantities: foodQuantities,
            food_item_macros: foodItemMacrosJson ? JSON.parse(foodItemMacrosJson) : undefined,
            logged_at: loggedAt,
            timestamp: Date.now()
          };
          await storePendingMealLog(pendingData);
        }
      } catch (syncError) {
        glowLogger.warn('Meal log Supabase sync exception, queuing for retry', {
          user_id: userId,
          local_id: localId,
          error: syncError instanceof Error ? syncError.message : String(syncError)
        });
        
        const pendingData: PendingMealLogData = {
          local_id: localId,
          user_id: userId,
          log_date: today,
          meal_description: mealDescription,
          carbs_grams: carbs,
          protein_grams: protein,
          fat_grams: fat,
          fiber_grams: fiber,
          calories: calories,
          food_quantities: foodQuantities,
          food_item_macros: foodItemMacrosJson ? JSON.parse(foodItemMacrosJson) : undefined,
          logged_at: loggedAt,
          timestamp: Date.now()
        };
        await storePendingMealLog(pendingData);
      }
    }

    return true; // Local save succeeded, that's what matters for user experience
  } catch (error) {
    glowLogger.error('Error in saveMealLog', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return false;
  }
};

/**
 * Update daily nutrition totals by summing all meals for today
 */
export const updateDailyTotals = async (userId: string, forDate?: string): Promise<boolean> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized in updateDailyTotals');
      return false;
    }

    const now = new Date();
    const today = forDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Get all meals for today
    const { data: meals, error: mealsError } = await supabase
      .from('meal_logs')
      .select('*')
      .eq('user_id', userId)
      .eq('log_date', today);

    if (mealsError) {
      glowLogger.error('Error fetching meals for daily total', { error: mealsError.message });
      return false;
    }

    // Calculate totals
    const totalCarbs = meals?.reduce((sum: number, meal: any) => sum + parseFloat(meal.carbs_grams || 0), 0) || 0;
    const totalProtein = meals?.reduce((sum: number, meal: any) => sum + parseFloat(meal.protein_grams || 0), 0) || 0;
    const totalFat = meals?.reduce((sum: number, meal: any) => sum + parseFloat(meal.fat_grams || 0), 0) || 0;
    const totalFiber = meals?.reduce((sum: number, meal: any) => sum + parseFloat(meal.fiber_grams || 0), 0) || 0;
    const totalCalories = meals?.reduce((sum: number, meal: any) => sum + parseInt(meal.calories || 0), 0) || 0;

    // Get user's nutrition targets from the dedicated targets table
    const userTargets = await getUserNutritionTargets(userId);
    const carbsTarget = userTargets.carbsTarget;
    const proteinTarget = userTargets.proteinTarget;
    const fatTarget = userTargets.fatTarget;
    const fiberTarget = userTargets.fiberTarget;
    const caloriesTarget = userTargets.caloriesTarget;

    // Calculate percentages
    const carbsPercent = carbsTarget > 0 ? Math.round((totalCarbs / carbsTarget) * 100 * 10) / 10 : 0;
    const proteinPercent = proteinTarget > 0 ? Math.round((totalProtein / proteinTarget) * 100 * 10) / 10 : 0;
    const fatPercent = fatTarget > 0 ? Math.round((totalFat / fatTarget) * 100 * 10) / 10 : 0;
    const fiberPercent = fiberTarget > 0 ? Math.round((totalFiber / fiberTarget) * 100 * 10) / 10 : 0;
    const caloriesPercent = caloriesTarget > 0 ? Math.round((totalCalories / caloriesTarget) * 100 * 10) / 10 : 0;

    glowLogger.info('Updating daily totals', {
      user_id: userId,
      date: today,
      total_carbs: totalCarbs,
      total_protein: totalProtein,
      total_fat: totalFat,
      total_fiber: totalFiber,
      total_calories: totalCalories,
      carbs_percent: carbsPercent,
      protein_percent: proteinPercent,
      fat_percent: fatPercent,
      fiber_percent: fiberPercent,
      calories_percent: caloriesPercent
    });

    // Upsert daily totals
    const { error } = await supabase
      .from('daily_nutrition_totals')
      .upsert({
        user_id: userId,
        log_date: today,
        total_carbs_grams: totalCarbs,
        total_protein_grams: totalProtein,
        total_fat_grams: totalFat,
        total_fiber_grams: totalFiber,
        total_calories: totalCalories,
        carbs_target_grams: carbsTarget,
        protein_target_grams: proteinTarget,
        fat_target_grams: fatTarget,
        fiber_target_grams: fiberTarget,
        calories_target: caloriesTarget,
        carbs_percent_of_target: carbsPercent,
        protein_percent_of_target: proteinPercent,
        fat_percent_of_target: fatPercent,
        fiber_percent_of_target: fiberPercent,
        calories_percent_of_target: caloriesPercent,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,log_date'
      });

    if (error) {
      glowLogger.error('Error upserting daily totals', { error: error.message });
      return false;
    }

    glowLogger.info('Daily totals updated successfully', { user_id: userId });
    return true;
  } catch (error) {
    glowLogger.error('Error in updateDailyTotals', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return false;
  }
};

export type GetTodayNutritionOptions = {
  /** When set, picks training- vs rest-day baseline targets for today. */
  dayType?: DayType;
  /** Used to resolve day type when `dayType` is omitted (plan + manual override). */
  actionPlan?: unknown;
};

/**
 * Get today's nutrition totals (local-first pattern)
 * 1. Resolve training vs rest targets (plan, logged activity, manual override)
 * 2. Layer wearables adjustment row when present
 * 3. Calculate consumed totals from local SQLite meal_logs
 */
export const getTodayNutrition = async (
  userId: string,
  options?: GetTodayNutritionOptions,
): Promise<DailyNutritionTotals> => {
  try {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    glowLogger.info('Fetching today nutrition totals (local-first)', { user_id: userId, date: today });

    let dayType: DayType = options?.dayType ?? 'rest';
    if (!options?.dayType) {
      const { getTrainingDayUiForDate } = await import('./training-day-status');
      const ui = await getTrainingDayUiForDate(userId, today, options?.actionPlan);
      dayType = ui.dayType;
    }

    const { targets: baselineTargets } = await getEffectiveNutritionTargets(userId, today, {
      dayType,
      actionPlan: options?.actionPlan,
    });

    const { getAdjustmentForDate } = await import('./nutrition-adjustment');
    const adjustment = await getAdjustmentForDate(userId, today);

    const carbsTarget = adjustment?.adjustedCarbsTargetGrams ?? baselineTargets.carbsTarget;
    const proteinTarget = adjustment?.adjustedProteinTargetGrams ?? baselineTargets.proteinTarget;
    const fatTarget = adjustment?.adjustedFatTargetGrams ?? baselineTargets.fatTarget;
    const fiberTarget = adjustment?.adjustedFiberTargetGrams ?? baselineTargets.fiberTarget;
    const caloriesTarget = adjustment?.adjustedCaloriesTarget ?? baselineTargets.caloriesTarget;

    // Calculate totals from local meal_logs table
    const db = getDatabase();
    const localResults = await db.getAllAsync<{
      carbs_grams: number;
      protein_grams: number;
      fat_grams: number;
      fiber_grams: number;
      calories: number;
    }>(`
      SELECT carbs_grams, protein_grams, fat_grams, fiber_grams, calories
      FROM meal_logs
      WHERE user_id = ? AND log_date = ?
    `, [userId, today]);

    // Sum up all meals for today
    const totals = localResults.reduce((acc, meal) => ({
      carbs: acc.carbs + (meal.carbs_grams || 0),
      protein: acc.protein + (meal.protein_grams || 0),
      fat: acc.fat + (meal.fat_grams || 0),
      fiber: acc.fiber + (meal.fiber_grams || 0),
      calories: acc.calories + (meal.calories || 0),
    }), { carbs: 0, protein: 0, fat: 0, fiber: 0, calories: 0 });

    // Calculate percentages
    const carbsPercent = carbsTarget > 0 ? (totals.carbs / carbsTarget) * 100 : 0;
    const proteinPercent = proteinTarget > 0 ? (totals.protein / proteinTarget) * 100 : 0;
    const fatPercent = fatTarget > 0 ? (totals.fat / fatTarget) * 100 : 0;
    const fiberPercent = fiberTarget > 0 ? (totals.fiber / fiberTarget) * 100 : 0;
    const caloriesPercent = caloriesTarget > 0 ? (totals.calories / caloriesTarget) * 100 : 0;

    const nutritionTotals: DailyNutritionTotals = {
      totalCarbs: Math.round(totals.carbs),
      totalProtein: Math.round(totals.protein),
      totalFat: Math.round(totals.fat),
      totalFiber: Math.round(totals.fiber),
      totalCalories: Math.round(totals.calories),
      carbsTarget,
      proteinTarget,
      fatTarget,
      fiberTarget,
      caloriesTarget,
      carbsPercentOfTarget: Math.round(carbsPercent * 10) / 10,
      proteinPercentOfTarget: Math.round(proteinPercent * 10) / 10,
      fatPercentOfTarget: Math.round(fatPercent * 10) / 10,
      fiberPercentOfTarget: Math.round(fiberPercent * 10) / 10,
      caloriesPercentOfTarget: Math.round(caloriesPercent * 10) / 10,
    };

    glowLogger.info('Nutrition totals calculated from local SQLite', {
      user_id: userId,
      meal_count: localResults.length,
      totals: nutritionTotals
    });

    return nutritionTotals;
  } catch (error) {
    glowLogger.error('Error in getTodayNutrition', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return getDefaultNutrition();
  }
};

/**
 * Get today's meal logs
 */
export const getTodayMeals = async (userId: string): Promise<MealLog[]> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized in getTodayMeals');
      return [];
    }

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const { data, error } = await supabase
      .from('meal_logs')
      .select('*')
      .eq('user_id', userId)
      .eq('log_date', today)
      .order('logged_at', { ascending: false });

    if (error) {
      glowLogger.error('Error fetching meal logs', { error: error.message });
      return [];
    }

    const meals: MealLog[] = data?.map((row: any) => ({
      id: row.id,
      mealDescription: row.meal_description,
      carbs: parseFloat(row.carbs_grams) || 0,
      protein: parseFloat(row.protein_grams) || 0,
      fat: parseFloat(row.fat_grams) || 0,
      fiber: parseFloat(row.fiber_grams) || 0,
      calories: row.calories || 0,
      loggedAt: new Date(row.logged_at),
      logDate: row.log_date,
    })) || [];

    return meals;
  } catch (error) {
    glowLogger.error('Error in getTodayMeals', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return [];
  }
};

const getDefaultNutrition = (): DailyNutritionTotals => {
  const defaultTargets = calculateMacrosFromCalories(DEFAULT_CALORIES);
  return {
    totalCarbs: 0,
    totalProtein: 0,
    totalFat: 0,
    totalFiber: 0,
    totalCalories: 0,
    carbsTarget: defaultTargets.carbsTarget,
    proteinTarget: defaultTargets.proteinTarget,
    fatTarget: defaultTargets.fatTarget,
    fiberTarget: defaultTargets.fiberTarget,
    caloriesTarget: defaultTargets.caloriesTarget,
    carbsPercentOfTarget: 0,
    proteinPercentOfTarget: 0,
    fatPercentOfTarget: 0,
    fiberPercentOfTarget: 0,
    caloriesPercentOfTarget: 0,
  };
};

/**
 * Get meal counts grouped by date from local SQLite only (no Supabase).
 * Lightweight query for dashboard display - returns date->count map.
 */
export const getLocalMealCountsByDate = async (
  userId: string,
  startDate: string,
  endDate: string
): Promise<Record<string, number>> => {
  try {
    const db = getDatabase();
    const results = await db.getAllAsync<{ log_date: string; count: number }>(`
      SELECT log_date, COUNT(*) as count FROM meal_logs
      WHERE user_id = ? AND log_date >= ? AND log_date <= ?
      GROUP BY log_date
      ORDER BY log_date ASC
    `, [userId, startDate, endDate]);
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r.log_date] = r.count;
    }
    return counts;
  } catch (error) {
    glowLogger.error('Error getting local meal counts by date', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return {};
  }
};

export interface MacroTotalsForDateRange {
  carbsGrams: number;
  proteinGrams: number;
  fatGrams: number;
  fiberGrams: number;
  calories: number;
}

/** Sum all macro columns from local meal_logs in inclusive YYYY-MM-DD range. */
export const getMacroTotalsForDateRange = async (
  userId: string,
  startDate: string,
  endDate: string,
): Promise<MacroTotalsForDateRange> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{
      carbs: number;
      protein: number;
      fat: number;
      fiber: number;
      cals: number;
    }>(`
      SELECT
        COALESCE(SUM(carbs_grams), 0) AS carbs,
        COALESCE(SUM(protein_grams), 0) AS protein,
        COALESCE(SUM(fat_grams), 0) AS fat,
        COALESCE(SUM(fiber_grams), 0) AS fiber,
        COALESCE(SUM(calories), 0) AS cals
      FROM meal_logs
      WHERE user_id = ? AND log_date >= ? AND log_date <= ?
    `, [userId, startDate, endDate]);
    return {
      carbsGrams: Math.round(row?.carbs ?? 0),
      proteinGrams: Math.round(row?.protein ?? 0),
      fatGrams: Math.round(row?.fat ?? 0),
      fiberGrams: Math.round(row?.fiber ?? 0),
      calories: Math.round(row?.cals ?? 0),
    };
  } catch (error) {
    glowLogger.error('Error summing macros for date range', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return { carbsGrams: 0, proteinGrams: 0, fatGrams: 0, fiberGrams: 0, calories: 0 };
  }
};

/**
 * Pull short, normalized meal description samples from local `meal_logs` for the date range
 * (inclusive, YYYY-MM-DD). Used by the weekly check-in to ground food-pattern hints (e.g.
 * "you often had white rice"). Capped, trimmed, and deduplicated to keep prompt size small.
 */
export const getMealDescriptionsForDateRange = async (
  userId: string,
  startDate: string,
  endDate: string,
  limit: number = 40,
): Promise<string[]> => {
  try {
    const db = getDatabase();
    const rows = await db.getAllAsync<{ meal_description: string | null }>(`
      SELECT meal_description
      FROM meal_logs
      WHERE user_id = ?
        AND log_date >= ?
        AND log_date <= ?
        AND meal_description IS NOT NULL
        AND TRIM(meal_description) != ''
      ORDER BY logged_at DESC
      LIMIT ?
    `, [userId, startDate, endDate, limit]);

    const seen = new Set<string>();
    const samples: string[] = [];
    for (const row of rows ?? []) {
      const raw = (row.meal_description ?? '').trim();
      if (!raw) continue;
      const normalized = raw.replace(/\s+/g, ' ').slice(0, 120);
      const dedupKey = normalized.toLowerCase();
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      samples.push(normalized);
    }
    return samples;
  } catch (error) {
    glowLogger.error('Error reading meal descriptions for date range', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return [];
  }
};

/** Total protein grams from local meal_logs in inclusive YYYY-MM-DD range. */
export const getTotalProteinGramsForDateRange = async (
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ total: number }>(`
      SELECT COALESCE(SUM(protein_grams), 0) AS total
      FROM meal_logs
      WHERE user_id = ? AND log_date >= ? AND log_date <= ?
    `, [userId, startDate, endDate]);
    return Math.round(row?.total ?? 0);
  } catch (error) {
    glowLogger.error('Error summing protein for date range', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return 0;
  }
};

/**
 * Get meal logs for a date range (local-first, fallback to Supabase)
 */
export const getMealLogsForDateRange = async (
  userId: string,
  startDate: string,
  endDate: string
): Promise<MealLog[]> => {
  try {
    glowLogger.info('Fetching meal logs for date range', {
      user_id: userId,
      start_date: startDate,
      end_date: endDate
    });

    // Try local SQLite first
    const db = getDatabase();
    const localResults = await db.getAllAsync<{
      id: number;
      supabase_id: number | null;
      meal_description: string;
      food_quantities: string | null;
      food_item_macros: string | null;
      carbs_grams: number;
      protein_grams: number;
      fat_grams: number;
      fiber_grams: number;
      calories: number;
      logged_at: string;
      log_date: string;
    }>(`
      SELECT id, supabase_id, meal_description, food_quantities, food_item_macros, carbs_grams, protein_grams, fat_grams, fiber_grams, calories, logged_at, log_date
      FROM meal_logs
      WHERE user_id = ? AND log_date >= ? AND log_date <= ?
      ORDER BY logged_at ASC
    `, [userId, startDate, endDate]);

    if (localResults.length > 0) {
      glowLogger.info('Meal logs fetched from local SQLite', {
        count: localResults.length,
        user_id: userId
      });

      return localResults.map(row => ({
        id: row.id,
        supabaseId: row.supabase_id,
        mealDescription: row.meal_description,
        foodQuantities: row.food_quantities || undefined,
        foodItemMacros: parseFoodItemMacros(row.food_item_macros),
        carbs: row.carbs_grams,
        protein: row.protein_grams,
        fat: row.fat_grams,
        fiber: row.fiber_grams,
        calories: row.calories,
        loggedAt: new Date(row.logged_at),
        logDate: row.log_date,
      }));
    }

    // Fallback to Supabase if no local data
    if (supabase) {
      const { data, error } = await supabase
        .from('meal_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('log_date', startDate)
        .lte('log_date', endDate)
        .order('logged_at', { ascending: true });

      if (error) {
        glowLogger.error('Error fetching meal logs from Supabase', {
          error: error.message,
          user_id: userId
        });
        return [];
      }

      if (data && data.length > 0) {
        glowLogger.info('Meal logs fetched from Supabase', {
          count: data.length,
          user_id: userId
        });

        // Cache to local SQLite for offline access
        for (const row of data) {
          try {
            await db.runAsync(`
              INSERT OR IGNORE INTO meal_logs (supabase_id, user_id, log_date, meal_description, food_quantities, food_item_macros, carbs_grams, protein_grams, fat_grams, fiber_grams, calories, logged_at, synced)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `, [row.id, row.user_id, row.log_date, row.meal_description, row.food_quantities || null, serializeFoodItemMacros(row.food_item_macros), row.carbs_grams, row.protein_grams, row.fat_grams, row.fiber_grams, row.calories, row.logged_at]);
          } catch (cacheError) {
            // Ignore cache errors, not critical
          }
        }

        return data.map((row: any) => ({
          id: row.id,
          supabaseId: row.id,
          mealDescription: row.meal_description,
          foodQuantities: row.food_quantities || undefined,
          foodItemMacros: parseFoodItemMacros(row.food_item_macros),
          carbs: parseFloat(row.carbs_grams) || 0,
          protein: parseFloat(row.protein_grams) || 0,
          fat: parseFloat(row.fat_grams) || 0,
          fiber: parseFloat(row.fiber_grams) || 0,
          calories: row.calories || 0,
          loggedAt: new Date(row.logged_at),
          logDate: row.log_date,
        }));
      }
    }

    return [];
  } catch (error) {
    glowLogger.error('Error in getMealLogsForDateRange', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return [];
  }
};

/**
 * Calculate weekly nutrition stats from meal logs
 */
export const calculateWeeklyNutritionStats = async (
  userId: string,
  userTimezone: string | null = null,
  period: NutritionPeriod = 'current'
): Promise<WeeklyNutritionStats> => {
  // Get user's nutrition targets from the dedicated targets table
  const userTargets = await getUserNutritionTargets(userId);
  const targets = {
    calories: userTargets.caloriesTarget,
    carbs: userTargets.carbsTarget,
    protein: userTargets.proteinTarget,
    fat: userTargets.fatTarget,
    fiber: userTargets.fiberTarget
  };

  const now = new Date();
  const tzOffset = userTimezone ? parseFloat(userTimezone) : 0;

  // Calculate week start in user's timezone (always Monday)
  const userNow = new Date(now.getTime() + (tzOffset * 3600000));
  const weekStart = new Date(userNow);
  const dayOfWeek = userNow.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  weekStart.setUTCDate(userNow.getUTCDate() - daysFromMonday);
  weekStart.setUTCHours(0, 0, 0, 0);

  // Adjust for 2 weeks view
  const numDays = period === '2weeks' ? 14 : 7;
  if (period === '2weeks') {
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  }

  // Calculate date range for query
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + numDays - 1);

  const formatDate = (date: Date): string => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const startDateStr = formatDate(weekStart);
  const endDateStr = formatDate(weekEnd);

  // Fetch meal logs for the date range
  const mealLogs = await getMealLogsForDateRange(userId, startDateStr, endDateStr);

  // Group meals by log_date (the canonical date stored when meal was logged)
  // This ensures consistency with getTodayNutrition which also queries by log_date
  const mealsByDate: { [date: string]: MealLog[] } = {};
  for (const meal of mealLogs) {
    // Use logDate directly instead of parsing loggedAt timestamp
    // This avoids timezone conversion issues
    const dateStr = meal.logDate;
    if (!mealsByDate[dateStr]) {
      mealsByDate[dateStr] = [];
    }
    mealsByDate[dateStr].push(meal);
  }

  // Generate daily data
  const dailyData: DailyNutritionData[] = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let daysElapsed = 0;

  for (let i = 0; i < numDays; i++) {
    const currentDay = new Date(weekStart);
    currentDay.setUTCDate(weekStart.getUTCDate() + i);
    const dateStr = formatDate(currentDay);
    const isFuture = currentDay > now;

    if (!isFuture) {
      daysElapsed++;
    }

    // Get meals for this day
    const dayMeals = isFuture ? [] : (mealsByDate[dateStr] || []);

    // Sum up macros for this day
    const dayTotals = dayMeals.reduce((acc, meal) => ({
      calories: acc.calories + (meal.calories || 0),
      carbs: acc.carbs + (meal.carbs || 0),
      protein: acc.protein + (meal.protein || 0),
      fat: acc.fat + (meal.fat || 0),
      fiber: acc.fiber + (meal.fiber || 0)
    }), { calories: 0, carbs: 0, protein: 0, fat: 0, fiber: 0 });

    const dayOfWeekIndex = currentDay.getUTCDay();

    dailyData.push({
      date: dateStr,
      dayName: dayNames[dayOfWeekIndex],
      dayOfMonth: currentDay.getUTCDate(),
      monthNum: currentDay.getUTCMonth() + 1,
      calories: dayTotals.calories,
      carbs: Math.round(dayTotals.carbs),
      protein: Math.round(dayTotals.protein),
      fat: Math.round(dayTotals.fat),
      fiber: Math.round(dayTotals.fiber),
      isFuture
    });
  }

  // Calculate weekly totals (excluding future days)
  const weeklyTotals = dailyData
    .filter(day => !day.isFuture)
    .reduce((acc, day) => ({
      calories: acc.calories + day.calories,
      carbs: acc.carbs + day.carbs,
      protein: acc.protein + day.protein,
      fat: acc.fat + day.fat,
      fiber: acc.fiber + day.fiber
    }), { calories: 0, carbs: 0, protein: 0, fat: 0, fiber: 0 });

  glowLogger.info('Weekly nutrition stats calculated', {
    user_id: userId,
    period,
    days_elapsed: daysElapsed,
    total_meals: mealLogs.length,
    weekly_totals: weeklyTotals
  });

  return {
    dailyData,
    weeklyTotals,
    daysElapsed,
    targets
  };
};

// Single-flight guard: this function is called from app start, the home
// dashboard, and the nutrition chart — sometimes all on the same screen
// transition. On slower devices (Android) those calls overlap, and the
// non-atomic check-then-insert pattern below used to insert duplicate rows.
// We now (a) use a partial UNIQUE index + INSERT OR IGNORE for atomic dedup,
// and (b) coalesce concurrent calls through this in-flight cache so the
// Supabase fetch only happens once per user at a time.
const inFlightMealLogsSync = new Map<string, Promise<number>>();

/**
 * Sync meal logs from Supabase to local SQLite
 * Call this when app starts to ensure local cache is up to date
 */
export const syncMealLogsFromSupabase = async (userId: string): Promise<number> => {
  if (!supabase) {
    return 0;
  }

  const existing = inFlightMealLogsSync.get(userId);
  if (existing) {
    return existing;
  }

  const run = (async (): Promise<number> => {
    try {
      // Get last 30 days of meal logs from Supabase
      const now = new Date();
      const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;

      const { data, error } = await supabase
        .from('meal_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('log_date', startDateStr)
        .order('logged_at', { ascending: true });

      if (error || !data) {
        glowLogger.warn('Failed to sync meal logs from Supabase', { error: error?.message });
        return 0;
      }

      const db = getDatabase();
      let syncedCount = 0;

      for (const row of data) {
        try {
          // Atomic: the partial UNIQUE index on (user_id, supabase_id) makes
          // OR IGNORE the de-dup mechanism — safe even if multiple sync
          // callers race against each other.
          const result = await db.runAsync(`
            INSERT OR IGNORE INTO meal_logs (supabase_id, user_id, log_date, meal_description, food_quantities, food_item_macros, carbs_grams, protein_grams, fat_grams, fiber_grams, calories, logged_at, synced)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          `, [row.id, row.user_id, row.log_date, row.meal_description, row.food_quantities || null, serializeFoodItemMacros(row.food_item_macros), row.carbs_grams, row.protein_grams, row.fat_grams, row.fiber_grams, row.calories, row.logged_at]);
          if (result.changes > 0) {
            syncedCount++;
          }
        } catch (insertError) {
          // Ignore individual insert errors
        }
      }

      glowLogger.info('Synced meal logs from Supabase to local', {
        user_id: userId,
        synced_count: syncedCount,
        total_remote: data.length
      });

      return syncedCount;
    } catch (error) {
      glowLogger.error('Error syncing meal logs from Supabase', {
        error: error instanceof Error ? error.message : String(error),
        user_id: userId
      });
      return 0;
    }
  })();

  inFlightMealLogsSync.set(userId, run);
  try {
    return await run;
  } finally {
    inFlightMealLogsSync.delete(userId);
  }
};

/**
 * Get recent meals from local SQLite, ordered by most recent first
 */
export const getRecentMeals = async (
  userId: string,
  limit: number = 50
): Promise<MealLog[]> => {
  try {
    const db = getDatabase();
    const results = await db.getAllAsync<{
      id: number;
      supabase_id: number | null;
      meal_description: string;
      food_quantities: string | null;
      food_item_macros: string | null;
      carbs_grams: number;
      protein_grams: number;
      fat_grams: number;
      fiber_grams: number;
      calories: number;
      logged_at: string;
      log_date: string;
    }>(`
      SELECT id, supabase_id, meal_description, food_quantities, food_item_macros, carbs_grams, protein_grams, fat_grams, fiber_grams, calories, logged_at, log_date
      FROM meal_logs
      WHERE user_id = ?
      ORDER BY logged_at DESC
      LIMIT ?
    `, [userId, limit]);

    return results.map(row => ({
      id: row.id,
      supabaseId: row.supabase_id,
      mealDescription: row.meal_description,
      foodQuantities: row.food_quantities || undefined,
      foodItemMacros: parseFoodItemMacros(row.food_item_macros),
      carbs: row.carbs_grams,
      protein: row.protein_grams,
      fat: row.fat_grams,
      fiber: row.fiber_grams,
      calories: row.calories,
      loggedAt: new Date(row.logged_at),
      logDate: row.log_date,
    }));
  } catch (error) {
    glowLogger.error('Error in getRecentMeals', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return [];
  }
};

/**
 * Update the date of a meal log (local-first with Supabase sync).
 * Recalculates daily totals for both old and new dates.
 */
export const updateMealLogDate = async (
  userId: string,
  localId: number,
  newDate: string,
  oldDate: string,
): Promise<boolean> => {
  try {
    const db = getDatabase();

    await db.runAsync(
      'UPDATE meal_logs SET log_date = ? WHERE id = ? AND user_id = ?',
      [newDate, localId, userId]
    );
    glowLogger.info('Meal log date updated locally', { local_id: localId, old_date: oldDate, new_date: newDate });

    // Sync to Supabase
    const row = await db.getFirstAsync<{ supabase_id: number | null }>(
      'SELECT supabase_id FROM meal_logs WHERE id = ?',
      [localId]
    );
    if (row?.supabase_id && supabase) {
      try {
        await withRetry(async () => {
          const { error } = await supabase
            .from('meal_logs')
            .update({ log_date: newDate })
            .eq('id', row.supabase_id)
            .eq('user_id', userId);
          if (error) throw new Error(error.message);
        }, { maxAttempts: 3, label: 'updateMealLogDate-supabase' });

        // Recalculate daily totals for both affected dates
        await updateDailyTotals(userId, oldDate);
        await updateDailyTotals(userId, newDate);
      } catch (syncError) {
        glowLogger.warn('Failed to sync meal date to Supabase', {
          local_id: localId,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    }

    return true;
  } catch (error) {
    glowLogger.error('Error in updateMealLogDate', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      local_id: localId,
    });
    return false;
  }
};

/**
 * Delete a meal log (local-first pattern)
 * 1. Delete from local SQLite immediately
 * 2. Attempt to delete from Supabase with retry
 * 3. If Supabase fails, queue for retry
 * 4. Recalculate daily totals
 */
export const deleteMealLog = async (
  userId: string,
  localId: number,
  supabaseId: number | null | undefined,
  logDate: string
): Promise<boolean> => {
  try {
    const db = getDatabase();

    // Step 1: Delete from local SQLite
    await db.runAsync('DELETE FROM meal_logs WHERE id = ? AND user_id = ?', [localId, userId]);
    glowLogger.info('Meal log deleted from local SQLite', { user_id: userId, local_id: localId });

    // Step 2: Try to delete from Supabase with retry
    if (supabase && supabaseId) {
      try {
        await withRetry(async () => {
          const { error } = await supabase
            .from('meal_logs')
            .delete()
            .eq('id', supabaseId)
            .eq('user_id', userId);

          if (error) throw new Error(error.message);
        }, { maxAttempts: 3, label: 'deleteMealLog-supabase' });

        glowLogger.info('Meal log deleted from Supabase', {
          user_id: userId,
          supabase_id: supabaseId,
        });

        // Recalculate daily totals in Supabase
        await updateDailyTotals(userId, logDate);
      } catch (syncError) {
        glowLogger.warn('Failed to delete meal from Supabase, queuing for retry', {
          user_id: userId,
          supabase_id: supabaseId,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });

        await storePendingMealDeletion({
          supabase_id: supabaseId,
          user_id: userId,
          log_date: logDate,
          timestamp: Date.now(),
        });
      }
    }

    return true;
  } catch (error) {
    glowLogger.error('Error in deleteMealLog', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      local_id: localId,
    });
    return false;
  }
};

// Deprecated - keep for backward compatibility
export interface NutritionData {
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  totalCalories: number;
  carbsTarget: number;
  proteinTarget: number;
  fatTarget: number;
  fiberTarget: number;
}

export const saveTodayNutrition = async (
  userId: string,
  carbs: number,
  protein: number,
  fat: number,
  fiber: number
): Promise<boolean> => {
  glowLogger.warn('saveTodayNutrition is deprecated, use saveMealLog instead');
  const calories = Math.round(carbs * 4 + protein * 4 + fat * 9);
  return await saveMealLog(userId, 'Logged meal', carbs, protein, fat, fiber, calories);
};
