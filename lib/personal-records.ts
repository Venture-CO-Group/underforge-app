import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import type { WeightUnit } from '../types/workout';

const LB_TO_KG = 1 / 2.2046226218;

export interface PersonalRecord {
  exerciseId: string;
  exerciseName: string;
  /** Best Epley-estimated 1RM in kg for this workout. */
  e1rmKg: number;
  /** Best raw working weight in kg used for the record. */
  weightKg: number;
  /** Reps performed on the best set. */
  reps: number;
}

function toKg(value: number, unit: WeightUnit | null | undefined): number {
  if (!unit) return value;
  return unit === 'lbs' ? value * LB_TO_KG : value;
}

/** Epley 1RM estimate. Works for any rep range and is the standard formula. */
function epley1RM(weightKg: number, reps: number): number {
  if (!weightKg || !reps) return 0;
  return weightKg * (1 + reps / 30);
}

interface SetRow {
  exercise_id: string;
  exercise_name: string;
  weight_value: number | null;
  weight_unit: string | null;
  reps: number | null;
  completed: number | null;
}

/**
 * Find exercises in the given workout where the user broke a previous Epley
 * e1RM personal record. Bodyweight or rep-only sets (no weight) are skipped.
 * Returns one entry per exercise that PR'd.
 */
export const detectPRs = async (
  userId: string,
  workoutLogId: number,
): Promise<PersonalRecord[]> => {
  try {
    const db = getDatabase();
    const sets = await db.getAllAsync<SetRow>(
      `SELECT exercise_id, exercise_name, weight_value, weight_unit, reps, completed
         FROM workout_exercise_logs
        WHERE workout_log_id = ?`,
      [workoutLogId],
    );

    // Group by exercise and compute this session's best e1RM per exercise.
    const sessionBest = new Map<string, { name: string; e1rmKg: number; weightKg: number; reps: number }>();
    for (const s of sets) {
      if (s.completed !== 1) continue;
      const w = s.weight_value;
      const r = s.reps;
      if (w == null || r == null || w <= 0 || r <= 0) continue;
      const weightKg = toKg(Number(w), s.weight_unit as WeightUnit | null);
      const e1rm = epley1RM(weightKg, Number(r));
      const prev = sessionBest.get(s.exercise_id);
      if (!prev || e1rm > prev.e1rmKg) {
        sessionBest.set(s.exercise_id, {
          name: s.exercise_name,
          e1rmKg: e1rm,
          weightKg,
          reps: Number(r),
        });
      }
    }

    if (sessionBest.size === 0) return [];

    const prs: PersonalRecord[] = [];
    for (const [exerciseId, best] of sessionBest.entries()) {
      // Historical best e1RM for this exercise across all PRIOR completed workouts.
      const priorSets = await db.getAllAsync<SetRow>(
        `SELECT wel.weight_value, wel.weight_unit, wel.reps, wel.completed
           FROM workout_exercise_logs wel
           INNER JOIN workout_logs wl ON wl.id = wel.workout_log_id
          WHERE wl.user_id = ?
            AND wel.exercise_id = ?
            AND wl.status = 'completed'
            AND wl.id != ?`,
        [userId, exerciseId, workoutLogId],
      );

      let priorBest = 0;
      for (const s of priorSets) {
        if (s.completed !== 1) continue;
        const w = s.weight_value;
        const r = s.reps;
        if (w == null || r == null || w <= 0 || r <= 0) continue;
        const weightKg = toKg(Number(w), s.weight_unit as WeightUnit | null);
        const e1rm = epley1RM(weightKg, Number(r));
        if (e1rm > priorBest) priorBest = e1rm;
      }

      // Require at least one prior session and a strict improvement so a user's
      // very first time doing an exercise doesn't trigger a celebratory PR.
      if (priorSets.length > 0 && best.e1rmKg > priorBest * 1.001) {
        prs.push({
          exerciseId,
          exerciseName: best.name,
          e1rmKg: Math.round(best.e1rmKg * 10) / 10,
          weightKg: Math.round(best.weightKg * 10) / 10,
          reps: best.reps,
        });
      }
    }

    return prs;
  } catch (error) {
    glowLogger.error('detectPRs failed', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      workout_log_id: workoutLogId,
    });
    return [];
  }
};
