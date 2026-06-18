/**
 * MET (Metabolic Equivalent of Task) lookup used for pragmatic calorie
 * estimation when provider-reported calories are missing, out of sanity
 * bounds, or for manually-logged activities without a calorie value.
 *
 * Formula: kcal = MET * weight_kg * (duration_min / 60)
 *
 * The table keys off our `ActivityCategory` taxonomy (not the fine-grained
 * ActivityType) because category-level METs are stable enough for the "±15%
 * accuracy" bar we care about, and adding finer granularity would compound
 * table maintenance without materially improving the estimate.
 *
 * Values were cross-referenced against the Compendium of Physical Activities
 * (Ainsworth 2011) and rounded to 1 decimal place at a "moderate effort"
 * baseline. Intensity scaling is applied on top of this baseline via
 * `INTENSITY_MULTIPLIER` so an "easy" run counts less than a "hard" run.
 */

import type { ActivityCategory } from '../../types/workout';
import type { CaloriesSource, Confidence } from './types';

export type ActivityIntensity = 'easy' | 'moderate' | 'hard' | 'max';

/** Moderate-effort baseline METs. */
export const MET_BY_CATEGORY: Record<ActivityCategory, number> = {
  running: 9.8,
  hiking: 6.0,
  cycling: 7.5,
  swimming: 8.0,
  winter_sports: 6.0,
  racket_sports: 7.0,
  team_sports: 7.5,
  water_sports: 5.5,
  martial_arts: 8.5,
  mind_body: 3.0,
  gym_cardio: 7.0,
  outdoor: 5.5,
  other: 5.0,
};

/**
 * Multiplier applied to the baseline MET when we know the session intensity.
 * "moderate" is 1.0 because that's the baseline. "max" is explicitly capped
 * at 1.35 to avoid runaway estimates on short high-intensity sessions.
 */
export const INTENSITY_MULTIPLIER: Record<ActivityIntensity, number> = {
  easy: 0.75,
  moderate: 1.0,
  hard: 1.2,
  max: 1.35,
};

/**
 * Fallback bodyweight (kg) when we don't have a real weight for the user yet
 * (e.g. during onboarding). Uses the same pragmatic defaults as
 * `GENDER_CALORIE_DEFAULTS` in `lib/nutrition-storage.ts` so estimates are
 * at least in the right ballpark.
 */
export const DEFAULT_WEIGHT_KG_BY_SEX: Record<'male' | 'female' | 'unknown', number> = {
  male: 78,
  female: 65,
  unknown: 72,
};

export interface MetEstimateInput {
  category: ActivityCategory;
  durationMinutes: number;
  weightKg?: number;
  sex?: 'male' | 'female' | 'unknown';
  intensity?: ActivityIntensity;
}

export interface MetEstimateResult {
  caloriesBurned: number;
  caloriesSource: CaloriesSource;
  caloriesConfidence: Confidence;
}

/**
 * Estimate calories burned using the MET formula.
 *
 * Confidence rules:
 *   - `medium` when we have both a real weight and an intensity.
 *   - `low` when we fall back to a default weight or default intensity.
 *
 * Always clamps to [0, 10000] kcal so a malformed duration can't poison the
 * nutrition adjustment layer.
 */
export function estimateCaloriesFromMet(input: MetEstimateInput): MetEstimateResult {
  const category: ActivityCategory = input.category;
  const baseMet = MET_BY_CATEGORY[category] ?? MET_BY_CATEGORY.other;
  const intensity = input.intensity ?? 'moderate';
  const intensityMult = INTENSITY_MULTIPLIER[intensity] ?? 1.0;

  const weightKg =
    typeof input.weightKg === 'number' && input.weightKg > 0
      ? input.weightKg
      : DEFAULT_WEIGHT_KG_BY_SEX[input.sex ?? 'unknown'];

  const hours = Math.max(0, input.durationMinutes) / 60;
  const rawKcal = baseMet * intensityMult * weightKg * hours;
  const caloriesBurned = Math.max(0, Math.min(10000, Math.round(rawKcal)));

  const usedWeightFallback = !(typeof input.weightKg === 'number' && input.weightKg > 0);
  const usedIntensityFallback = !input.intensity;
  const confidence: Confidence =
    usedWeightFallback || usedIntensityFallback ? 'low' : 'medium';

  return {
    caloriesBurned,
    caloriesSource: 'estimated_met',
    caloriesConfidence: confidence,
  };
}

/**
 * Sanity-check a provider-reported calories value against the MET baseline.
 * Trusts the provider value as long as it isn't an implausibly *high* misfire
 * (> 2x the MET estimate); otherwise falls back to the MET estimate.
 *
 * Only the high side is guarded. A provider value *below* the MET estimate is
 * NOT an error: a wearable's HR-based burn is accurate to within ~5-15% of
 * truth, while the moderate-effort MET estimate systematically over-counts
 * easy sessions by 30-90%. The old 0.5x *low* floor discarded the more
 * accurate (lower) measured value and substituted the inflated estimate,
 * which silently inflated easy sessions (e.g. a relaxed 1h hike read as ~460
 * kcal instead of the device's ~90) and cascaded into nutrition targets. So
 * we keep only the 2x ceiling, which catches gross provider misfires (e.g. a
 * 4000-kcal 30-minute walk) without rejecting legitimately-low burns.
 *
 * Used when normalizing Whoop/Garmin/HealthKit workouts.
 */
export function reconcileProviderCalories(
  providerKcal: number | undefined,
  metInput: MetEstimateInput,
): MetEstimateResult {
  const metResult = estimateCaloriesFromMet(metInput);
  if (
    typeof providerKcal !== 'number' ||
    !Number.isFinite(providerKcal) ||
    providerKcal <= 0
  ) {
    return metResult;
  }
  const high = metResult.caloriesBurned * 2;
  if (providerKcal <= high) {
    return {
      caloriesBurned: Math.round(providerKcal),
      caloriesSource: 'provider',
      caloriesConfidence: 'high',
    };
  }
  // Provider value is implausibly high; keep MET estimate but flag low confidence.
  return {
    caloriesBurned: metResult.caloriesBurned,
    caloriesSource: 'estimated_met',
    caloriesConfidence: 'low',
  };
}
