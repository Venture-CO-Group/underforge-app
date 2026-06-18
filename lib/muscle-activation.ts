import type { TFunction } from 'i18next';
import type { BodyPartSlug, Exercise, MuscleActivation, MuscleGroup } from '../types/workout';

/**
 * Fallback mapping from our coarse `MuscleGroup` to body-highlighter slugs, used when an
 * exercise has no explicit `muscleActivation` (e.g. user-created custom exercises). The
 * mapped slugs are treated as primary (level 3).
 */
export const MUSCLE_GROUP_TO_SLUGS: Record<MuscleGroup, BodyPartSlug[]> = {
  chest: ['chest'],
  back: ['upper-back'],
  shoulders: ['deltoids'],
  arms: ['biceps', 'triceps'],
  legs: ['quadriceps', 'gluteal', 'hamstring'],
  quads: ['quadriceps'],
  hamstrings: ['hamstring'],
  glutes: ['gluteal'],
  adductors: ['adductors'],
  calves: ['calves'],
  abs: ['abs'],
  obliques: ['obliques'],
};

/** Trainable muscle slugs we surface in the map / balance check (excludes neck, joints, etc.). */
export const TRAINABLE_SLUGS: BodyPartSlug[] = [
  'chest', 'upper-back', 'lower-back', 'trapezius', 'deltoids',
  'biceps', 'triceps', 'forearm', 'abs', 'obliques',
  'quadriceps', 'hamstring', 'gluteal', 'adductors', 'calves', 'tibialis',
];

/** slug → i18n key (reuses the existing `bodymap` namespace shared with BodyMapSelector). */
export const SLUG_TO_I18N_KEY: Record<string, string> = {
  neck: 'bodymap:partNeck',
  deltoids: 'bodymap:partShoulders',
  shoulders: 'bodymap:partShoulders',
  chest: 'bodymap:partChest',
  biceps: 'bodymap:partBiceps',
  triceps: 'bodymap:partTriceps',
  forearm: 'bodymap:partForearm',
  abs: 'bodymap:partAbs',
  obliques: 'bodymap:partObliques',
  quadriceps: 'bodymap:partQuadriceps',
  tibialis: 'bodymap:partTibialis',
  'upper-back': 'bodymap:partUpperBack',
  'lower-back': 'bodymap:partLowerBack',
  trapezius: 'bodymap:partTrapezius',
  hamstring: 'bodymap:partHamstring',
  gluteal: 'bodymap:partGluteal',
  calves: 'bodymap:partCalves',
  adductors: 'bodymap:partAdductors',
};

/** English fallbacks (also used as i18n defaultValues) for slug labels. */
export const SLUG_LABEL_FALLBACK: Record<string, string> = {
  neck: 'Neck',
  deltoids: 'Shoulders',
  shoulders: 'Shoulders',
  chest: 'Chest',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearm: 'Forearms',
  abs: 'Core / Abs',
  obliques: 'Obliques',
  quadriceps: 'Quads',
  tibialis: 'Shins',
  'upper-back': 'Upper Back',
  'lower-back': 'Lower Back',
  trapezius: 'Trapezius',
  hamstring: 'Hamstrings',
  gluteal: 'Glutes',
  calves: 'Calves',
  adductors: 'Inner Thighs',
};

/** Localized display label for a body-part slug. */
export function getSlugLabel(slug: string, t: TFunction): string {
  const key = SLUG_TO_I18N_KEY[slug];
  const fallback = SLUG_LABEL_FALLBACK[slug] || slug;
  return key ? t(key, { defaultValue: fallback }) : fallback;
}

/** Resolve an exercise's muscle activation: explicit data, else primary slugs from its muscle group. */
export function activationForExercise(
  exercise?: Exercise | null,
  muscleGroupFallback?: MuscleGroup,
): MuscleActivation[] {
  if (exercise?.muscleActivation?.length) return exercise.muscleActivation;
  const mg = exercise?.muscleGroup ?? muscleGroupFallback;
  if (!mg) return [];
  return (MUSCLE_GROUP_TO_SLUGS[mg] ?? []).map((slug) => ({ slug, level: 3 as const }));
}

export interface ActivationInput {
  activation: MuscleActivation[];
  /**
   * Per-exercise contribution weight — the sum of each logged set's load factor (see
   * `loadFactorForSet`), so heavier sets count more than light ones while bodyweight sets still
   * register at 1.0 each. Defaults to 1 (≈ one bodyweight set) when omitted.
   */
  weight?: number;
}

/** Sum weighted activation (muscle level × the exercise's load-weighted volume) per slug. */
export function aggregateActivation(items: ActivationInput[]): Map<BodyPartSlug, number> {
  const scores = new Map<BodyPartSlug, number>();
  for (const item of items) {
    const weight = item.weight && item.weight > 0 ? item.weight : 1;
    for (const { slug, level } of item.activation) {
      scores.set(slug, (scores.get(slug) ?? 0) + level * weight);
    }
  }
  return scores;
}

export interface BodyDatum {
  slug: BodyPartSlug;
  intensity: number;
}

/**
 * Convert raw scores to body-highlighter data with intensity 1–3, bucketed relative to the
 * highest-scoring muscle (so the map reads as a heatmap regardless of absolute volume).
 */
export function scoresToBodyData(scores: Map<BodyPartSlug, number>): BodyDatum[] {
  const max = Math.max(0, ...scores.values());
  if (max <= 0) return [];
  const data: BodyDatum[] = [];
  for (const [slug, score] of scores) {
    if (score <= 0) continue;
    const ratio = score / max;
    const intensity = ratio >= 0.66 ? 3 : ratio >= 0.33 ? 2 : 1;
    data.push({ slug, intensity });
  }
  return data;
}

/** The most-trained muscles (highest scores), up to `n`. Used for the "we focused on X" copy. */
export function topTrainedMuscles(scores: Map<BodyPartSlug, number>, n = 2): BodyPartSlug[] {
  return [...scores.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([slug]) => slug);
}

/**
 * Trainable muscles that got little/no work relative to the week's own distribution
 * (zero, or well below the mean of the muscles that WERE trained). Sorted least-trained first.
 */
export function underTrainedMuscles(scores: Map<BodyPartSlug, number>): BodyPartSlug[] {
  const trained = TRAINABLE_SLUGS.map((s) => scores.get(s) ?? 0);
  const nonZero = trained.filter((v) => v > 0);
  if (nonZero.length === 0) return [];
  const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
  const threshold = mean * 0.5;
  return TRAINABLE_SLUGS
    .filter((s) => (scores.get(s) ?? 0) < threshold)
    .sort((a, b) => (scores.get(a) ?? 0) - (scores.get(b) ?? 0));
}
