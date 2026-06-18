/**
 * Pure nutrition adjustment math, no DB / no React / no Expo imports.
 *
 * Kept separate from `lib/nutrition-adjustment.ts` so unit tests can exercise
 * the algebra with plain `ts-node` without pulling in expo-sqlite. The
 * wrapper file re-exports from here.
 */

/**
 * Minimal structural shape of `NutritionTargets` from `nutrition-storage.ts`.
 * Duplicated locally (via structural typing) so this module stays free of
 * expo-sqlite imports and can be unit-tested with plain ts-node.
 */
export interface NutritionTargetsLike {
  caloriesTarget: number;
  carbsTarget: number;
  proteinTarget: number;
  fatTarget: number;
  fiberTarget: number;
}

type NutritionTargets = NutritionTargetsLike;

export const MAX_CALORIE_ADJUSTMENT_FRACTION = 0.4;
export const NEAT_STEP_BASELINE = 7_500;
export const NEAT_KCAL_PER_STEP_AT_70KG = 0.04;
/**
 * Residual NEAT multiplier applied on top of BMR when a live steps source is
 * available. Steps capture lifestyle walking; this 1.1× covers the remaining
 * non-walking NEAT (cooking, standing, fidgeting) so we don't under-credit the
 * burned floor. The standard occupation multipliers (1.2-1.55) embed both
 * walking and non-walking NEAT and would double-count once steps are added.
 */
export const NEAT_NON_WALKING_MULTIPLIER = 1.1;

export interface AdjustmentResult {
  adjustedCaloriesTarget: number;
  adjustedCarbsTargetGrams: number;
  adjustedProteinTargetGrams: number;
  adjustedFatTargetGrams: number;
  adjustedFiberTargetGrams: number;
}

/** Fraction of the kcal surplus that goes into carbs (rest goes into fat). */
export const SURPLUS_CARB_FRACTION = 0.7;
export const SURPLUS_FAT_FRACTION = 1 - SURPLUS_CARB_FRACTION;

/**
 * Goal-aware fraction of `adjustableKcal` that is added back to the
 * consumed calorie target when unplanned activity happens.
 *
 *   fat loss / cut   → 0.5  (preserve part of the deficit)
 *   strength         → 0.8  (mild compromise)
 *   muscle gain      → 1.0  (surplus needs full replenishment)
 *   maintenance      → 1.0  (net zero across the day)
 *
 * Unknown / unset goals fall back to 1.0 so behaviour matches the legacy
 * implementation that always replenished 100%.
 */
export function goalBumpFactor(selectedGoal?: string | null): number {
  if (!selectedGoal) return 1.0;
  const g = selectedGoal.toLowerCase();
  if (g.includes('fat') || g.includes('lose') || g.includes('cut') || g.includes('burn')) return 0.5;
  if (g.includes('strength')) return 0.8;
  return 1.0;
}

/**
 * Compute a dynamic day-of adjustment on top of a baseline target.
 *
 * Strategy: protein_floor_v1
 *   - Protein grams stay fixed at the baseline (hard floor — body-comp driver,
 *     not session fuel).
 *   - Of the kcal surplus, 70% goes to carbs (4 kcal/g) and 30% to fat
 *     (9 kcal/g). This matches typical endurance + strength practice better
 *     than putting 100% into carbs.
 *   - Fiber scales stepwise with total calories.
 *   - Result clamped to ±40% of the baseline to guard against bad provider
 *     data or runaway step counts.
 */
export function computeAdjustment(params: {
  base: NutritionTargets;
  activityCalories: number;
  stepsNeatCalories: number;
  /**
   * 0..1 factor applied to the unplanned-activity bump. Defaults to 1.0 so
   * existing callers (and unit tests) keep their previous behaviour. See
   * `goalBumpFactor`.
   */
  bumpFactor?: number;
}): AdjustmentResult {
  const baseCals = params.base.caloriesTarget;
  const factor = clamp01(params.bumpFactor ?? 1.0);
  const rawSurplus =
    Math.max(0, Math.round(params.activityCalories)) +
    Math.max(0, Math.round(params.stepsNeatCalories));
  const requestedSurplus = Math.round(rawSurplus * factor);

  const upperBound = Math.round(baseCals * (1 + MAX_CALORIE_ADJUSTMENT_FRACTION));
  const lowerBound = Math.round(baseCals * (1 - MAX_CALORIE_ADJUSTMENT_FRACTION));
  const adjustedCals = Math.min(upperBound, Math.max(lowerBound, baseCals + requestedSurplus));

  const surplusApplied = adjustedCals - baseCals;
  const adjustedProtein = params.base.proteinTarget;
  const surplusCarbsGrams = (surplusApplied * SURPLUS_CARB_FRACTION) / 4;
  const surplusFatGrams = (surplusApplied * SURPLUS_FAT_FRACTION) / 9;
  const adjustedCarbs = Math.max(
    0,
    Math.round(params.base.carbsTarget + surplusCarbsGrams),
  );
  const adjustedFat = Math.max(
    0,
    Math.round(params.base.fatTarget + surplusFatGrams),
  );
  const adjustedFiber =
    adjustedCals >= 2000 ? 30 : adjustedCals >= 1800 ? 25 : 21;

  return {
    adjustedCaloriesTarget: adjustedCals,
    adjustedCarbsTargetGrams: adjustedCarbs,
    adjustedProteinTargetGrams: adjustedProtein,
    adjustedFatTargetGrams: adjustedFat,
    adjustedFiberTargetGrams: adjustedFiber,
  };
}

/**
 * 0.04 kcal/step at 70 kg, scaled linearly by bodyweight.
 *
 * By default subtracts `NEAT_STEP_BASELINE` so we don't double-count steps
 * already priced into the onboarding occupation multiplier (the budget floor
 * and the LLM-generated `caloriesTarget` both embed ~7,500 daily steps via
 * `BMR × occupationFactor`).
 *
 * Pass `{ fromZero: true }` when the caller has already swapped the
 * occupation multiplier for `NEAT_NON_WALKING_MULTIPLIER` (i.e. the burned
 * breakdown UI when a live steps source is connected). In that mode every
 * step contributes; the residual NEAT multiplier covers non-walking activity.
 */
export function stepsNeatKcal(
  steps: number,
  weightKg: number,
  options?: { fromZero?: boolean },
): number {
  if (!Number.isFinite(steps) || steps <= 0) return 0;
  const countedSteps = options?.fromZero
    ? steps
    : Math.max(0, steps - NEAT_STEP_BASELINE);
  const kcal = countedSteps * NEAT_KCAL_PER_STEP_AT_70KG * (weightKg / 70);
  return Math.round(kcal);
}

/**
 * Net the embedded baseline-movement NEAT out of a from-zero step/active-energy
 * credit.
 *
 * The consumed calorie target already embeds `baselineMovement.kcalPerDay` of
 * assumed daily walking (the onboarding NEAT recommendation — see
 * `computeBaselineMovement`). When a live source is connected the adjustment
 * credits every measured step from zero (`stepsNeatKcal(..., { fromZero: true })`),
 * so adding the full measured movement on top of that base double-counts the
 * assumed baseline *every day*, not just on big days. Subtract it so the
 * adjustment only adds the movement *above* what the target already assumed —
 * i.e. the measured count effectively replaces the assumption rather than
 * stacking on it. Floored at 0: a below-baseline day adds nothing, it never
 * claws calories back out of the target.
 */
export function netMovementAboveBaseline(
  stepsNeatCalories: number,
  baselineMovementKcal: number,
): number {
  const steps = Number.isFinite(stepsNeatCalories)
    ? Math.max(0, Math.round(stepsNeatCalories))
    : 0;
  const baseline = Number.isFinite(baselineMovementKcal)
    ? Math.max(0, Math.round(baselineMovementKcal))
    : 0;
  return Math.max(0, steps - baseline);
}

/** Stable hash of adjustment inputs; plain concat, not cryptographic. */
export function buildInputsDigest(params: {
  baseCals: number;
  activityCalories: number;
  stepsNeatCalories: number;
  weightKg?: number;
  strategy: string;
  bumpFactor?: number;
  dayType?: string;
  manualRestOverride?: boolean;
}): string {
  return [
    params.baseCals,
    params.activityCalories,
    params.stepsNeatCalories,
    params.weightKg ?? '-',
    params.strategy,
    params.bumpFactor ?? '-',
    params.dayType ?? '-',
    params.manualRestOverride ? 'rest_override' : '-',
  ].join('|');
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1.0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
