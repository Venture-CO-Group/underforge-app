import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import { detectPRs, type PersonalRecord } from './personal-records';
import { getExerciseLogsForWorkout, getWorkoutLogById } from './workout-storage';
import type { WeightUnit } from '../types/workout';

const LB_TO_KG = 1 / 2.2046226218;

export interface CompactExercise {
  exerciseId: string;
  exerciseName: string;
  setsCompleted: number;
  /** Range string like "8-12 reps @ 80kg" describing what was done. */
  summary: string;
}

export interface ActivityShareData {
  activityName: string;
  activityType: string;
  durationMinutes: number;
  caloriesBurned: number | null;
  distanceValue: number | null;
  distanceUnit: 'km' | 'mi' | null;
  elevationGainMeters: number | null;
}

export interface WorkoutShareMetrics {
  workoutLogId: number | null;
  activityLogId: number | null;
  /** Resolved workout name used as the default post title. */
  workoutTitle: string;
  /** ISO date string of the workout/activity (YYYY-MM-DD). */
  workoutDate: string | null;
  exercises: CompactExercise[];
  totalKcal: number;
  totalVolumeKg: number;
  newPRs: PersonalRecord[];
  activity: ActivityShareData | null;
}

function toKg(value: number, unit: WeightUnit | null | undefined): number {
  if (!unit) return value;
  return unit === 'lbs' ? value * LB_TO_KG : value;
}

function formatSummary(
  weights: { value: number; unit: WeightUnit }[],
  reps: number[],
): string {
  const repTokens = Array.from(new Set(reps.filter(r => r > 0)));
  const minReps = repTokens.length ? Math.min(...repTokens) : 0;
  const maxReps = repTokens.length ? Math.max(...repTokens) : 0;
  const repPart = !repTokens.length
    ? ''
    : minReps === maxReps
      ? `${minReps} reps`
      : `${minReps}-${maxReps} reps`;

  const weightTokens = weights.filter(w => w.value > 0);
  if (weightTokens.length === 0) {
    return repPart || 'completed';
  }
  const minW = Math.min(...weightTokens.map(w => w.value));
  const maxW = Math.max(...weightTokens.map(w => w.value));
  const unit = weightTokens[0].unit;
  const weightPart = minW === maxW
    ? `${roundPretty(minW)}${unit}`
    : `${roundPretty(minW)}-${roundPretty(maxW)}${unit}`;
  return repPart ? `${repPart} @ ${weightPart}` : weightPart;
}

function roundPretty(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.05) return String(Math.round(value));
  return value.toFixed(1);
}

/**
 * Build all numbers we might surface in the share modal for a completed workout
 * (and an optionally linked cardio activity, which is the only place distance
 * and elevation come from). Numbers stay in their underlying units (kg for
 * volume, km/mi for distance, meters for elevation) so the UI can choose a
 * presentation. Anything missing returns 0 or null — UI hides empty fields.
 */
export const buildShareMetrics = async (
  userId: string,
  options: { workoutLogId?: number | null; activityLogId?: number | null },
): Promise<WorkoutShareMetrics | null> => {
  try {
    const { workoutLogId = null, activityLogId = null } = options;
    if (!workoutLogId && !activityLogId) return null;

    let workoutTitle = '';
    let workoutDate: string | null = null;
    let exercises: CompactExercise[] = [];
    let totalVolumeKg = 0;
    let totalKcal = 0;
    let newPRs: PersonalRecord[] = [];

    if (workoutLogId) {
      const log = await getWorkoutLogById(workoutLogId);
      if (log) {
        workoutTitle = log.workoutDayName;
        workoutDate = log.workoutDate;
      }

      const exerciseLogs = await getExerciseLogsForWorkout(workoutLogId);

      // Group completed sets by exercise and aggregate volume + summary.
      const grouped = new Map<string, {
        exerciseName: string;
        sets: number;
        weights: { value: number; unit: WeightUnit }[];
        reps: number[];
      }>();

      for (const s of exerciseLogs) {
        if (!s.completed) continue;
        const reps = s.reps ?? 0;
        const weightVal = s.weightValue ?? 0;
        const unit: WeightUnit = s.weightUnit ?? 'kg';

        if (weightVal > 0 && reps > 0) {
          totalVolumeKg += toKg(weightVal, unit) * reps;
        }

        const existing = grouped.get(s.exerciseId);
        if (existing) {
          existing.sets += 1;
          if (weightVal > 0) existing.weights.push({ value: weightVal, unit });
          if (reps > 0) existing.reps.push(reps);
        } else {
          grouped.set(s.exerciseId, {
            exerciseName: s.exerciseName,
            sets: 1,
            weights: weightVal > 0 ? [{ value: weightVal, unit }] : [],
            reps: reps > 0 ? [reps] : [],
          });
        }
      }

      exercises = Array.from(grouped.entries()).map(([exerciseId, g]) => ({
        exerciseId,
        exerciseName: g.exerciseName,
        setsCompleted: g.sets,
        summary: `${g.sets} × ${formatSummary(g.weights, g.reps)}`,
      }));

      // Sum stored kcal estimates on completed sets.
      const db = getDatabase();
      const row = await db.getFirstAsync<{ kcal: number | null }>(
        `SELECT COALESCE(SUM(calories_burned), 0) AS kcal
           FROM workout_exercise_logs
          WHERE workout_log_id = ?
            AND completed = 1`,
        [workoutLogId],
      );
      totalKcal = Math.round(row?.kcal ?? 0);

      // Detect PRs (skipped for bodyweight/rep-only sessions automatically).
      newPRs = await detectPRs(userId, workoutLogId);
    }

    let activity: ActivityShareData | null = null;
    if (activityLogId) {
      const db = getDatabase();
      const row = await db.getFirstAsync<{
        activity_name: string;
        activity_type: string;
        activity_date: string;
        duration_minutes: number;
        calories_burned: number | null;
        distance_value: number | null;
        distance_unit: string | null;
        elevation_gain: number | null;
      }>(
        `SELECT activity_name, activity_type, activity_date, duration_minutes,
                calories_burned, distance_value, distance_unit, elevation_gain
           FROM activity_logs
          WHERE id = ?`,
        [activityLogId],
      );

      if (row) {
        activity = {
          activityName: row.activity_name,
          activityType: row.activity_type,
          durationMinutes: row.duration_minutes,
          caloriesBurned: row.calories_burned ?? null,
          distanceValue: row.distance_value ?? null,
          distanceUnit: (row.distance_unit as 'km' | 'mi' | null) ?? null,
          elevationGainMeters: row.elevation_gain ?? null,
        };
        if (!workoutTitle) workoutTitle = row.activity_name;
        if (!workoutDate) workoutDate = row.activity_date;
        // Activity calories are separate from per-set strength kcal; surface both.
        if (!workoutLogId && row.calories_burned) {
          totalKcal = row.calories_burned;
        }
      }
    }

    return {
      workoutLogId,
      activityLogId,
      workoutTitle: workoutTitle || 'My workout',
      workoutDate,
      exercises,
      totalKcal,
      totalVolumeKg: Math.round(totalVolumeKg * 10) / 10,
      newPRs,
      activity,
    };
  } catch (error) {
    glowLogger.error('buildShareMetrics failed', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      ...options,
    });
    return null;
  }
};
