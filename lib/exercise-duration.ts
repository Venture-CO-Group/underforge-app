import { Exercise, ExerciseCategory } from '../types/workout';
import { findBuiltinExerciseById } from './exercise-catalog';

/**
 * Steady-state cardio (running, cycling, …): logged in seconds in `reps`, shown in minutes.
 * Isometric holds (plank, wall sit) use seconds with a short sec picker instead.
 */
export function isEnduranceDurationExercise(exercise?: Exercise | null): boolean {
  if (!exercise) return false;
  return exercise.category === 'endurance' && (exercise.loggingUnit ?? 'reps') === 'seconds';
}

/** Default steady-state cardio duration when the plan does not specify one (5 min). */
export const DEFAULT_ENDURANCE_DURATION_SEC = 5 * 60;

export function defaultRepsForExercise(
  exercise?: Exercise | null,
  planReps = '',
): string {
  if (planReps) return planReps;
  if (isEnduranceDurationExercise(exercise)) {
    return String(DEFAULT_ENDURANCE_DURATION_SEC);
  }
  return '';
}

export function isEnduranceDurationExerciseById(
  exerciseId?: string | null,
  category?: ExerciseCategory,
): boolean {
  if (exerciseId) {
    const ex = findBuiltinExerciseById(exerciseId);
    if (ex) return isEnduranceDurationExercise(ex);
  }
  return category === 'endurance';
}

/** Minutes offered in the endurance TIME picker (persisted as seconds in `reps`). */
export function buildEnduranceDurationMinutes(): number[] {
  const values: number[] = [];
  for (let m = 5; m <= 60; m += 5) values.push(m);
  for (let m = 70; m <= 120; m += 10) values.push(m);
  for (let m = 135; m <= 180; m += 15) values.push(m);
  for (let m = 195; m <= 240; m += 15) values.push(m);
  return values;
}

export function minutesToStorageSeconds(minutes: number): number {
  return Math.round(minutes * 60);
}

/** Format stored seconds for the log column (minutes, or hours when ≥ 60 min). */
export function formatDurationMinutesForLog(storedSeconds: number): string {
  const min = storedSeconds / 60;
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m > 0 ? `${h}h ${m}` : `${h}h`;
  }
  const rounded = Math.round(min * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Format minutes for chart axis / stats (values already in minutes). */
export function formatDurationMinutesForChart(minutes: number): string {
  if (minutes >= 100) return Math.round(minutes).toLocaleString();
  if (minutes >= 10) return Math.round(minutes).toString();
  return (Math.round(minutes * 10) / 10).toString();
}

/** Parse log `reps` string to display minutes in the UI. */
export function formatStoredRepsForDisplay(
  reps: string | undefined,
  isEnduranceDuration: boolean,
): string {
  if (!reps?.trim()) return '';
  const n = parseInt(reps, 10);
  if (isNaN(n) || n <= 0) return reps.trim();
  if (isEnduranceDuration) return formatDurationMinutesForLog(n);
  return String(n);
}

export function parseDisplayToStoredSeconds(
  displayMinutes: number,
  isEnduranceDuration: boolean,
): number {
  if (isEnduranceDuration) return minutesToStorageSeconds(displayMinutes);
  return displayMinutes;
}
