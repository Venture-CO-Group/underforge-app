/**
 * Pure baseline-movement recommendation math (no DB, no Expo).
 *
 * Replaces the implicit "occupation multiplier embeds ~7,500 lifestyle
 * steps/day" assumption that used to live inside `getOccupationMultiplier`
 * with an explicit recommendation expressed in minutes/day of brisk
 * walking-equivalent movement, plus kcal/steps for downstream consumers.
 *
 * The recommendation is a function of three explicit inputs:
 *
 *   1. occupation_activity   — coarse measure of how much the user already
 *                              moves at work (lower recommendation when
 *                              their job is active).
 *   2. cardio_kcal_per_day   — habitual non-plan cardio averaged over the
 *                              week (lowers recommendation; some cardio
 *                              already covers movement needs).
 *   3. plan_training_kcal_per_day — average plan-prescribed training kcal
 *                              (modest reduction — strength training does
 *                              not directly substitute for low-intensity
 *                              steady movement, but it does count for
 *                              total energy expenditure).
 *
 * Floor: 15 minutes/day. We always recommend at least a short walk.
 *
 * Calorie & step conversions:
 *   kcal/day  = BRISK_WALK_MET * weightKg * minutes / 60
 *   steps/day = round_to_100( kcal / (KCAL_PER_STEP_AT_70KG * weightKg/70) )
 */

export type BaselineMovementPace = 'brisk';

export interface BaselineMovement {
  /** kcal/day target for non-training NEAT — feeds eating + burn targets. */
  kcalPerDay: number;
  /** Primary user-facing value: minutes of brisk walking-equivalent. */
  minutesPerDay: number;
  /** Approximate steps/day, rounded to nearest 100. Cross-checks against wearables. */
  stepsPerDayApprox: number;
  pace: BaselineMovementPace;
}

export interface BaselineMovementInputs {
  /** Onboarding `occupation_activity` answer (English option string). */
  occupationActivity: string;
  /** User bodyweight in kg (used for kcal/step scaling). */
  weightKg: number;
  /** Habitual non-plan cardio kcal/day, averaged over the week. Default 0. */
  cardioKcalPerDay?: number;
  /** Average daily plan-training kcal (sum estimatedCaloriesBurned ÷ 7). Default 0. */
  planTrainingKcalPerDay?: number;
}

const BRISK_WALK_MET = 4.3; // compendium "walking ~4 mph, brisk pace"
const KCAL_PER_STEP_AT_70KG = 0.04;
const MINUTES_FLOOR = 15;

/** Base recommendation by occupation, in minutes of brisk walking-equivalent. */
function baseMinutesByOccupation(occupationActivity: string): number {
  const a = (occupationActivity || '').toLowerCase();
  if (a.includes('very active')) return 20;
  if (a.includes('regular')) return 30;
  if (a.includes('standing') || a.includes('walking')) return 40;
  // Default ("Mostly sitting" or unspecified) — most sedentary baseline.
  return 50;
}

/**
 * Subtract for habitual cardio. Each ~10 kcal/day of cardio is treated as
 * roughly equivalent to 1 minute of brisk walking budget covered already.
 * Capped at 20 minutes off so heavy cardio users don't drop below the floor
 * because of cardio alone.
 */
function cardioReductionMinutes(cardioKcalPerDay: number): number {
  if (!Number.isFinite(cardioKcalPerDay) || cardioKcalPerDay <= 0) return 0;
  return Math.min(20, Math.round(cardioKcalPerDay / 10));
}

/**
 * Subtract for prescribed plan training. Capped at 10 minutes — strength
 * sessions don't fully substitute for low-intensity NEAT, so even a heavy
 * training week still warrants daily walking.
 */
function planReductionMinutes(planTrainingKcalPerDay: number): number {
  if (!Number.isFinite(planTrainingKcalPerDay) || planTrainingKcalPerDay <= 0) {
    return 0;
  }
  return Math.min(10, Math.round(planTrainingKcalPerDay / 15));
}

function kcalFromMinutes(minutes: number, weightKg: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return 0;
  return Math.round((BRISK_WALK_MET * weightKg * minutes) / 60);
}

function approxStepsFromKcal(kcal: number, weightKg: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || kcal <= 0) return 0;
  const kcalPerStep = KCAL_PER_STEP_AT_70KG * (weightKg / 70);
  if (kcalPerStep <= 0) return 0;
  const raw = kcal / kcalPerStep;
  return Math.round(raw / 100) * 100;
}

/**
 * Derive a daily baseline-movement recommendation from explicit inputs.
 * Returns a floor-respecting result even when occupation is unrecognised
 * (defaults to the most sedentary bucket).
 */
export function computeBaselineMovement(inputs: BaselineMovementInputs): BaselineMovement {
  const weight = Number.isFinite(inputs.weightKg) && inputs.weightKg > 0 ? inputs.weightKg : 70;
  const baseMin = baseMinutesByOccupation(inputs.occupationActivity);
  const cardioOff = cardioReductionMinutes(inputs.cardioKcalPerDay ?? 0);
  const planOff = planReductionMinutes(inputs.planTrainingKcalPerDay ?? 0);
  const minutesPerDay = Math.max(MINUTES_FLOOR, baseMin - cardioOff - planOff);
  const kcalPerDay = kcalFromMinutes(minutesPerDay, weight);
  const stepsPerDayApprox = approxStepsFromKcal(kcalPerDay, weight);
  return {
    kcalPerDay,
    minutesPerDay,
    stepsPerDayApprox,
    pace: 'brisk',
  };
}

export const BASELINE_MOVEMENT_CONSTANTS = {
  BRISK_WALK_MET,
  KCAL_PER_STEP_AT_70KG,
  MINUTES_FLOOR,
} as const;
