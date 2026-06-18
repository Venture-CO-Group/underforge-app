import type { Exercise } from '../types/workout';

export function isSpanishLocale(lang?: string): boolean {
  return (lang ?? '').toLowerCase().startsWith('es');
}

/** Normalize for matching logged / plan names to catalog (English or Spanish). */
export function normalizeExerciseNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Looser key for de-duplicating identical exercises that differ only by case or
 * singular/plural (e.g. "Calf Raise" \u2261 "Calf Raises", "Standing Calf Raises").
 * Strips a trailing plural "s"/"es" from each word before joining. Use for
 * homologation / merge keys, NOT for exact catalog id resolution.
 */
export function normalizeExerciseNameLooseKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    // Strip a single trailing plural "s": "raises"→"raise", "curls"→"curl".
    .map((word) => (word.length > 2 ? word.replace(/s$/, '') : word))
    .join('');
}

export function getLocalizedExerciseName(
  catalog: Exercise | undefined,
  fallbackName: string,
  lang?: string,
): string {
  if (catalog?.nameEs && isSpanishLocale(lang)) {
    return catalog.nameEs;
  }
  if (catalog?.name) {
    return catalog.name;
  }
  return fallbackName;
}

export function getLocalizedExerciseVideoUrl(
  catalog: Exercise | undefined,
  lang?: string,
): string | undefined {
  if (!catalog) return undefined;
  const primary = catalog.videoUrl;
  if (isSpanishLocale(lang)) {
    const es = catalog.videoUrlEs?.trim();
    if (es) return es;
  }
  return primary?.trim() || undefined;
}

/** Label to store in logs / show when resolving from built-in catalog (uses `nameEs` in Spanish). */
export function getExerciseCatalogLabel(exercise: Exercise, lang?: string): string {
  return getLocalizedExerciseName(exercise, exercise.name, lang);
}
