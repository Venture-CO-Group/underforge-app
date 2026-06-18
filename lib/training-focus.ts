import type { ExerciseCategory } from '../types/workout';

export interface TrainingFocus {
  /** 0–100, share of training that is strength work. */
  strengthPct: number;
  /** 0–100, share that is cardio (endurance + conditioning). */
  cardioPct: number;
  /** True when there was no weighted work to summarize. */
  empty: boolean;
}

export interface TrainingFocusInput {
  category?: ExerciseCategory;
  /** Relative weight of this exercise (set count or load-weighted volume). Defaults to 1. */
  weight?: number;
}

/**
 * Split a set of exercises into a strength vs cardio focus. "Cardio" folds in both
 * `endurance` and `conditioning`; `power` and `strength` (and missing category) count as
 * strength; `mobility` is excluded from the split entirely (it's recovery/range-of-motion
 * work, neither strength nor cardio). Each exercise contributes its `weight` (sets or
 * load-weighted volume).
 */
export function trainingFocus(items: TrainingFocusInput[]): TrainingFocus {
  let strength = 0;
  let cardio = 0;
  for (const { category, weight } of items) {
    const w = weight && weight > 0 ? weight : 1;
    if (category === 'endurance' || category === 'conditioning') cardio += w;
    else if (category === 'mobility') continue; // excluded from the strength/cardio split
    else strength += w; // strength, power, or unspecified
  }
  const total = strength + cardio;
  if (total <= 0) return { strengthPct: 0, cardioPct: 0, empty: true };
  const strengthPct = Math.round((strength / total) * 100);
  return { strengthPct, cardioPct: 100 - strengthPct, empty: false };
}
