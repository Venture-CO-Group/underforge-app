/**
 * Exercise notes are stored on workout_exercise_logs.comments (per set row) but
 * treated as one note per exercise. Persist/read on the last checked set only.
 */

export type SetWithComment = {
  setNumber: number;
  completed?: boolean;
  comments?: string;
};

export function getLastCheckedSet<T extends SetWithComment>(sets: T[]): T | undefined {
  const checked = sets.filter(s => s.completed);
  if (!checked.length) return undefined;
  return checked.reduce((a, b) => (a.setNumber > b.setNumber ? a : b));
}

/** Value for the exercise-level comment field in the UI (raw text; do not trim). */
export function getExerciseCommentDisplay(sets: SetWithComment[]): string {
  const lastChecked = getLastCheckedSet(sets);
  if (lastChecked?.comments?.trim()) return lastChecked.comments ?? '';
  const any = sets.find(s => s.comments?.trim());
  return any?.comments ?? '';
}

/** Comment column when writing a set row to SQLite / Supabase. */
export function getPersistedSetComment(
  set: SetWithComment,
  setsForExercise: SetWithComment[],
): string | undefined {
  const lastChecked = getLastCheckedSet(setsForExercise);
  if (!lastChecked || set.setNumber !== lastChecked.setNumber) return undefined;
  const text = getExerciseCommentDisplay(setsForExercise).trim();
  return text || undefined;
}

/** Prior session hint from getLastWorkoutForExercise per-set map. */
export function getPreviousExerciseComment(
  lastWorkoutBySet: Record<number, { comments?: string } | undefined>,
): string | undefined {
  const entries = Object.entries(lastWorkoutBySet)
    .map(([n, d]) => ({ setNumber: Number(n), comments: d?.comments?.trim() }))
    .filter((e): e is { setNumber: number; comments: string } => !!e.comments);
  if (!entries.length) return undefined;
  entries.sort((a, b) => b.setNumber - a.setNumber);
  return entries[0].comments;
}

export function normalizeExerciseCommentsInSets<T extends SetWithComment & { exerciseId: string }>(
  sets: T[],
  exerciseId: string,
): T[] {
  const forEx = sets.filter(s => s.exerciseId === exerciseId);
  const display = getExerciseCommentDisplay(forEx);
  const target = getLastCheckedSet(forEx) ?? forEx[forEx.length - 1];
  if (!target || !display.trim()) {
    return sets.map(s =>
      s.exerciseId === exerciseId && s.comments ? { ...s, comments: '' } : s,
    ) as T[];
  }
  return sets.map(s => {
    if (s.exerciseId !== exerciseId) return s;
    return {
      ...s,
      comments: s.setNumber === target.setNumber ? display : '',
    } as T;
  });
}

export function normalizeAllExerciseComments<T extends SetWithComment & { exerciseId: string }>(
  sets: T[],
): T[] {
  const ids = [...new Set(sets.map(s => s.exerciseId))];
  return ids.reduce((acc, id) => normalizeExerciseCommentsInSets(acc, id), sets);
}

/** Move the exercise note onto the last checked set (or last set if none checked yet). */
export function reassignExerciseCommentInSets<T extends SetWithComment & { exerciseId: string }>(
  sets: T[],
  exerciseId: string,
): T[] {
  const forEx = sets.filter(s => s.exerciseId === exerciseId);
  const comment = getExerciseCommentDisplay(forEx);
  if (!comment.trim()) return sets;
  const target = getLastCheckedSet(forEx) ?? forEx[forEx.length - 1];
  if (!target) return sets;
  return sets.map(s => {
    if (s.exerciseId !== exerciseId) return s;
    return {
      ...s,
      comments: s.setNumber === target.setNumber ? comment : '',
    } as T;
  });
}
