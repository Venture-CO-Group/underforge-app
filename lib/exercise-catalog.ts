import base from '../assets/exercises/exercises.json';
import esOverrides from '../assets/exercises/exercise_es_overrides.json';
import {
  normalizeExerciseNameKey,
  normalizeExerciseNameLooseKey,
} from './exercise-localization';
import type { Exercise, ExerciseLoggingUnit } from '../types/workout';

type EsOverride = { nameEs: string; videoUrlEs: string };

const overrides = esOverrides as Record<string, EsOverride>;

function mergeExercise(raw: Exercise): Exercise {
  const o = overrides[raw.id];
  if (!o) {
    return raw;
  }
  return {
    ...raw,
    nameEs: o.nameEs,
    videoUrlEs: o.videoUrlEs,
  };
}

/** Built-in exercises with optional `nameEs` / `videoUrlEs` merged from `exercise_es_overrides.json`. */
export const BUILTIN_EXERCISES: Exercise[] = (base.exercises as Exercise[]).map(mergeExercise);

export function findBuiltinExerciseById(exerciseId: string): Exercise | undefined {
  return BUILTIN_EXERCISES.find((e) => e.id === exerciseId);
}

/** Lazily-built name → catalog exercise index (exact + plural/case-insensitive, EN + ES). */
let catalogNameIndex: Map<string, Exercise> | null = null;
function getCatalogNameIndex(): Map<string, Exercise> {
  if (catalogNameIndex) return catalogNameIndex;
  const idx = new Map<string, Exercise>();
  for (const ex of BUILTIN_EXERCISES) {
    const keys = [
      normalizeExerciseNameKey(ex.name),
      normalizeExerciseNameLooseKey(ex.name),
      ex.nameEs ? normalizeExerciseNameKey(ex.nameEs) : '',
      ex.nameEs ? normalizeExerciseNameLooseKey(ex.nameEs) : '',
    ];
    for (const key of keys) {
      if (key && !idx.has(key)) idx.set(key, ex);
    }
  }
  catalogNameIndex = idx;
  return idx;
}

/**
 * Resolve a catalog exercise from a (possibly legacy / generic) id OR display name.
 *
 * Generation-time harmonization can leave older plans/logs with generic ids like
 * `deadlift` or `dumbbell-press` that don't match catalog ids (`barbell-deadlift`).
 * At DISPLAY time we still need the real catalog entry to read `category` and
 * `muscleActivation` (for the focus bar / muscle map), so we fall back:
 *   id (exact) → id (underscores→hyphens) → exact name → plural/case-insensitive name.
 * Returns undefined when nothing matches (caller may then hydrate a custom exercise).
 */
export function resolveCatalogExercise(
  exerciseId?: string | null,
  exerciseName?: string | null,
): Exercise | undefined {
  if (exerciseId) {
    const direct = findBuiltinExerciseById(exerciseId);
    if (direct) return direct;
    const normalizedId = exerciseId.replace(/_/g, '-');
    if (normalizedId !== exerciseId) {
      const byNorm = findBuiltinExerciseById(normalizedId);
      if (byNorm) return byNorm;
    }
  }
  if (exerciseName) {
    const idx = getCatalogNameIndex();
    return (
      idx.get(normalizeExerciseNameKey(exerciseName)) ||
      idx.get(normalizeExerciseNameLooseKey(exerciseName))
    );
  }
  return undefined;
}

/**
 * Returns the logging unit (reps vs seconds) for an exercise. Defaults to 'reps' when
 * the exercise is missing or has no explicit `loggingUnit` set in the catalog.
 */
export function getExerciseLoggingUnit(
  exercise?: Exercise | null,
): ExerciseLoggingUnit {
  return exercise?.loggingUnit ?? 'reps';
}

/** Convenience: resolve logging unit from a catalog id; defaults to 'reps' when unknown. */
export function getExerciseLoggingUnitById(exerciseId?: string | null): ExerciseLoggingUnit {
  if (!exerciseId) return 'reps';
  return getExerciseLoggingUnit(findBuiltinExerciseById(exerciseId));
}
