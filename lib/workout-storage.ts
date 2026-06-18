import { createClient } from '@supabase/supabase-js';
import {
    DifficultyPerception,
    ExerciseLog,
    WeightUnit,
    WorkoutLog,
    WorkoutLogStatus,
} from '../types/workout';
import { getLatestUserWeightKg } from './activity-storage';
import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import { withRetry } from './retry';
import {
    removePendingWorkoutExerciseLog,
    removePendingWorkoutLog,
    storePendingWorkoutDeletion,
    storePendingWorkoutExerciseLog
} from './sync-status';
import { estimateSetKcal } from './workout-energy';
import { getExerciseLoggingUnitById } from './exercise-catalog';

const DEFAULT_BODYWEIGHT_KG = 70;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let supabase: any;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ============================================
// Workout Log CRUD Operations
// ============================================

/**
 * Create a new workout log (local-first)
 */
export const createWorkoutLog = async (
  userId: string,
  workoutDayName: string,
  stepId?: string,
  overrideDate?: string
): Promise<WorkoutLog | null> => {
  try {
    const now = new Date();
    const workoutDate = overrideDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const createdAt = now.toISOString();

    const logData: any = {
      user_id: userId,
      workout_date: workoutDate,
      workout_day_name: workoutDayName,
    };
    if (stepId) logData.step_id = stepId;
    glowLogger.info('Creating workout log (local-first)', logData);

    const db = getDatabase();

    // Check if an in_progress workout already exists for this user + day name (today)
    const existingDraft = await db.getFirstAsync<{
      id: number;
      supabase_id: number | null;
      user_id: string;
      workout_date: string;
      workout_day_name: string;
      step_id: string | null;
      status: string;
      created_at: string;
      updated_at: string;
      synced: number;
    }>(`
      SELECT * FROM workout_logs
      WHERE user_id = ? AND workout_day_name = ? AND status = 'in_progress'
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId, workoutDayName]);

    // If a draft already exists, return it instead of creating a new one
    if (existingDraft) {
      glowLogger.info('Found existing draft, returning it', {
        user_id: userId,
        workout_id: existingDraft.id,
        workout_name: existingDraft.workout_day_name,
        has_supabase_id: !!existingDraft.supabase_id,
      });
      
      // Inline fetch exercise logs to avoid forward reference
      const exerciseLogs = await db.getAllAsync<{
        id: number;
        supabase_id: number | null;
        workout_log_id: number;
        exercise_id: string;
        exercise_name: string;
        set_number: number;
        weight_value: number | null;
        weight_unit: string | null;
        reps: number | null;
        rest_time_seconds: number | null;
        rir: number | null;
        difficulty_perception: number | null;
        comments: string | null;
        completed: number | null;
        created_at: string;
      }>(`
        SELECT * FROM workout_exercise_logs
        WHERE workout_log_id = ?
        ORDER BY exercise_id, set_number
      `, [existingDraft.id]);

      const exercises: ExerciseLog[] = exerciseLogs.map(log => ({
        id: log.id,
        supabaseId: log.supabase_id || undefined,
        workoutLogId: log.workout_log_id,
        exerciseId: log.exercise_id,
        exerciseName: log.exercise_name,
        setNumber: log.set_number,
        weightValue: log.weight_value ?? undefined,
        weightUnit: log.weight_unit as WeightUnit | undefined,
        reps: log.reps ?? undefined,
        restTimeSeconds: log.rest_time_seconds ?? undefined,
        rir: log.rir ?? undefined,
        difficultyPerception: log.difficulty_perception as DifficultyPerception | undefined,
        comments: log.comments ?? undefined,
        completed: log.completed === 1,
        createdAt: log.created_at,
      }));

      return {
        id: existingDraft.id,
        supabaseId: existingDraft.supabase_id || undefined,
        userId: existingDraft.user_id,
        workoutDate: existingDraft.workout_date,
        workoutDayName: existingDraft.workout_day_name,
        stepId: existingDraft.step_id || undefined,
        status: existingDraft.status as WorkoutLogStatus,
        exercises,
        synced: existingDraft.synced === 1,
        createdAt: existingDraft.created_at,
        updatedAt: existingDraft.updated_at,
      };
    }

    // No existing draft, create a new one
    const result = await db.runAsync(`
      INSERT INTO workout_logs (user_id, workout_date, workout_day_name, step_id, status, created_at, updated_at, synced)
      VALUES (?, ?, ?, ?, 'in_progress', ?, ?, 0)
    `, [userId, workoutDate, workoutDayName, stepId || null, createdAt, createdAt]);

    const localId = result.lastInsertRowId;
    glowLogger.info('Workout log draft saved to local SQLite (Supabase sync deferred until completion)', { user_id: userId, local_id: localId });

    return {
      id: localId,
      userId,
      workoutDate,
      workoutDayName,
      stepId,
      status: 'in_progress',
      exercises: [],
      synced: false,
      createdAt,
      updatedAt: createdAt,
    };
  } catch (error) {
    glowLogger.error('Error creating workout log', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return null;
  }
};

/**
 * Update the workout_date on an existing workout log (local + Supabase)
 */
export const updateWorkoutDate = async (
  workoutLogId: number,
  newDate: string
): Promise<void> => {
  const db = getDatabase();
  await db.runAsync(
    'UPDATE workout_logs SET workout_date = ?, updated_at = ?, synced = 0 WHERE id = ?',
    [newDate, new Date().toISOString(), workoutLogId]
  );
  try {
    const row = await db.getFirstAsync<{ supabase_id: number | null }>(
      'SELECT supabase_id FROM workout_logs WHERE id = ?',
      [workoutLogId]
    );
    if (row?.supabase_id && supabase) {
      const { error } = await supabase
        .from('workout_logs')
        .update({ workout_date: newDate })
        .eq('id', row.supabase_id);
      if (!error) {
        await db.runAsync('UPDATE workout_logs SET synced = 1 WHERE id = ?', [workoutLogId]);
      }
    }
  } catch (e) {
    glowLogger.warn('Failed to sync workout date to Supabase, will retry on next sync', {
      error: e instanceof Error ? e.message : String(e),
      workout_log_id: workoutLogId,
    });
  }
};

/**
 * Get an in-progress workout log for a user (if any)
 */
export const getInProgressWorkoutLog = async (userId: string): Promise<WorkoutLog | null> => {
  try {
    const db = getDatabase();
    
    // Debug: check all workout logs for this user
    const allLogs = await db.getAllAsync<{ id: number; status: string; workout_day_name: string }>(
      'SELECT id, status, workout_day_name FROM workout_logs WHERE user_id = ?',
      [userId]
    );
    glowLogger.info('All workout logs for user', { 
      user_id: userId, 
      logs: allLogs.map(l => ({ id: l.id, status: l.status, name: l.workout_day_name }))
    });
    
    const workoutLog = await db.getFirstAsync<{
      id: number;
      supabase_id: number | null;
      user_id: string;
      workout_date: string;
      workout_day_name: string;
      step_id: string | null;
      status: string;
      created_at: string;
      updated_at: string;
      synced: number;
    }>(`
      SELECT * FROM workout_logs
      WHERE user_id = ? AND status = 'in_progress'
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);

    const resultLogData: any = {
      user_id: userId,
      found: !!workoutLog,
    };
    if (workoutLog) {
      resultLogData.workout_id = workoutLog.id;
      resultLogData.workout_name = workoutLog.workout_day_name;
    }
    glowLogger.info('In-progress workout query result', resultLogData);

    if (!workoutLog) {
      return null;
    }

    // Get exercise logs for this workout
    const exerciseLogs = await getExerciseLogsForWorkout(workoutLog.id);

    return {
      id: workoutLog.id,
      supabaseId: workoutLog.supabase_id || undefined,
      userId: workoutLog.user_id,
      workoutDate: workoutLog.workout_date,
      workoutDayName: workoutLog.workout_day_name,
      stepId: workoutLog.step_id || undefined,
      status: workoutLog.status as WorkoutLogStatus,
      exercises: exerciseLogs,
      synced: workoutLog.synced === 1,
      createdAt: workoutLog.created_at,
      updatedAt: workoutLog.updated_at,
    };
  } catch (error) {
    glowLogger.error('Error getting in-progress workout log', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return null;
  }
};

/**
 * Get a workout log by ID
 */
export const getWorkoutLogById = async (workoutLogId: number): Promise<WorkoutLog | null> => {
  try {
    const db = getDatabase();
    const workoutLog = await db.getFirstAsync<{
      id: number;
      supabase_id: number | null;
      user_id: string;
      workout_date: string;
      workout_day_name: string;
      step_id: string | null;
      status: string;
      created_at: string;
      updated_at: string;
      synced: number;
    }>(`
      SELECT * FROM workout_logs WHERE id = ?
    `, [workoutLogId]);

    if (!workoutLog) {
      return null;
    }

    const exerciseLogs = await getExerciseLogsForWorkout(workoutLog.id);

    return {
      id: workoutLog.id,
      supabaseId: workoutLog.supabase_id || undefined,
      userId: workoutLog.user_id,
      workoutDate: workoutLog.workout_date,
      workoutDayName: workoutLog.workout_day_name,
      stepId: workoutLog.step_id || undefined,
      status: workoutLog.status as WorkoutLogStatus,
      exercises: exerciseLogs,
      synced: workoutLog.synced === 1,
      createdAt: workoutLog.created_at,
      updatedAt: workoutLog.updated_at,
    };
  } catch (error) {
    glowLogger.error('Error getting workout log by ID', {
      error: error instanceof Error ? error.message : String(error),
      workout_log_id: workoutLogId,
    });
    return null;
  }
};

/**
 * Update workout log status
 */
export const updateWorkoutLogStatus = async (
  workoutLogId: number,
  status: WorkoutLogStatus
): Promise<boolean> => {
  try {
    const db = getDatabase();
    const now = new Date().toISOString();

    glowLogger.info('Updating workout log status', {
      workout_log_id: workoutLogId,
      new_status: status,
    });

    await db.runAsync(`
      UPDATE workout_logs
      SET status = ?, updated_at = ?, synced = 0
      WHERE id = ?
    `, [status, now, workoutLogId]);

    // Verify the update
    const updated = await db.getFirstAsync<{ status: string }>(
      'SELECT status FROM workout_logs WHERE id = ?',
      [workoutLogId]
    );

    const statusLogData: any = {
      workout_log_id: workoutLogId,
      status,
    };
    if (updated) statusLogData.verified_status = updated.status;
    glowLogger.info('Workout log status updated', statusLogData);

    // Try to sync to Supabase
    if (supabase) {
      const workoutLog = await db.getFirstAsync<{ supabase_id: number | null }>(
        'SELECT supabase_id FROM workout_logs WHERE id = ?',
        [workoutLogId]
      );

      if (workoutLog?.supabase_id) {
        try {
          const { error } = await supabase
            .from('workout_logs')
            .update({ status, updated_at: now })
            .eq('id', workoutLog.supabase_id);

          if (!error) {
            await db.runAsync('UPDATE workout_logs SET synced = 1 WHERE id = ?', [workoutLogId]);
          }
        } catch (syncError) {
          glowLogger.warn('Failed to sync workout log status update', {
            error: syncError instanceof Error ? syncError.message : String(syncError),
          });
        }
      }
    }

    return true;
  } catch (error) {
    glowLogger.error('Error updating workout log status', {
      error: error instanceof Error ? error.message : String(error),
      workout_log_id: workoutLogId,
    });
    return false;
  }
};

/**
 * Delete a workout log (local-first; Supabase delete with retry and pending queue on failure).
 * Remote `workout_exercise_logs` rows cascade when the parent `workout_logs` row is deleted.
 */
export const deleteWorkoutLog = async (userId: string, workoutLogId: number): Promise<boolean> => {
  try {
    const db = getDatabase();

    glowLogger.info('Deleting workout log', {
      workout_log_id: workoutLogId,
      user_id: userId,
    });

    const workoutLog = await db.getFirstAsync<{ supabase_id: number | null }>(
      'SELECT supabase_id FROM workout_logs WHERE id = ? AND user_id = ?',
      [workoutLogId, userId]
    );

    if (!workoutLog) {
      glowLogger.warn('deleteWorkoutLog: workout not found or user mismatch', {
        workout_log_id: workoutLogId,
        user_id: userId,
      });
      return false;
    }

    const exerciseRowIds = await db.getAllAsync<{ id: number }>(
      'SELECT id FROM workout_exercise_logs WHERE workout_log_id = ?',
      [workoutLogId]
    );
    for (const row of exerciseRowIds) {
      await removePendingWorkoutExerciseLog(row.id);
    }
    await removePendingWorkoutLog(workoutLogId);

    const exerciseDeleteResult = await db.runAsync(
      'DELETE FROM workout_exercise_logs WHERE workout_log_id = ?',
      [workoutLogId]
    );

    const workoutDeleteResult = await db.runAsync(
      'DELETE FROM workout_logs WHERE id = ? AND user_id = ?',
      [workoutLogId, userId]
    );

    if (workoutDeleteResult.changes === 0) {
      return false;
    }

    glowLogger.info('Workout log deleted from local DB', {
      workout_log_id: workoutLogId,
      exercise_logs_deleted: exerciseDeleteResult.changes,
    });

    if (supabase && workoutLog.supabase_id) {
      try {
        await withRetry(async () => {
          const { error } = await supabase
            .from('workout_logs')
            .delete()
            .eq('id', workoutLog.supabase_id)
            .eq('user_id', userId);

          if (error) throw new Error(error.message);
        }, { maxAttempts: 3, label: 'deleteWorkoutLog-supabase' });

        glowLogger.info('Workout log deleted from Supabase', {
          supabase_id: workoutLog.supabase_id,
        });
      } catch (syncError) {
        glowLogger.warn('Failed to delete workout from Supabase, queuing for retry', {
          user_id: userId,
          supabase_id: workoutLog.supabase_id,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });

        await storePendingWorkoutDeletion({
          supabase_id: workoutLog.supabase_id,
          user_id: userId,
          timestamp: Date.now(),
        });
      }
    }

    return true;
  } catch (error) {
    glowLogger.error('Error deleting workout log', {
      error: error instanceof Error ? error.message : String(error),
      workout_log_id: workoutLogId,
    });
    return false;
  }
};

/**
 * DEBUG: Clear all workout logs for a user (local only)
 */
export const clearAllWorkoutLogsForUser = async (userId: string): Promise<void> => {
  try {
    const db = getDatabase();
    
    // Get all workout log IDs for this user
    const logs = await db.getAllAsync<{ id: number }>(
      'SELECT id FROM workout_logs WHERE user_id = ?',
      [userId]
    );
    
    console.log('[clearAllWorkoutLogsForUser] Found', logs.length, 'workout logs to delete');
    
    // Delete all exercise logs for this user's workouts
    for (const log of logs) {
      await db.runAsync('DELETE FROM workout_exercise_logs WHERE workout_log_id = ?', [log.id]);
    }
    
    // Delete all workout logs for this user
    const result = await db.runAsync('DELETE FROM workout_logs WHERE user_id = ?', [userId]);
    
    console.log('[clearAllWorkoutLogsForUser] Deleted', result.changes, 'workout logs');
    glowLogger.info('Cleared all workout logs for user', {
      user_id: userId,
      count: result.changes,
    });
  } catch (error) {
    console.error('[clearAllWorkoutLogsForUser] Error:', error);
    glowLogger.error('Error clearing workout logs', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Get unique workout dates from local SQLite only (no Supabase).
 * Lightweight query for dashboard display - returns only dates, no exercise logs.
 */
export const getLocalWorkoutDates = async (
  userId: string,
  startDate: string,
  endDate: string
): Promise<string[]> => {
  try {
    const db = getDatabase();
    const results = await db.getAllAsync<{ workout_date: string }>(`
      SELECT DISTINCT workout_date FROM workout_logs
      WHERE user_id = ? AND workout_date >= ? AND workout_date <= ?
        AND status = 'completed'
      ORDER BY workout_date ASC
    `, [userId, startDate, endDate]);
    return results.map(r => r.workout_date);
  } catch (error) {
    glowLogger.error('Error getting local workout dates', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return [];
  }
};

/**
 * Get unique workout counts per date from local SQLite (for multi-workout badge).
 * Uses DISTINCT workout_day_name so sync duplicates don't inflate the count.
 */
export const getLocalWorkoutCountsByDate = async (
  userId: string,
  startDate: string,
  endDate: string
): Promise<Record<string, number>> => {
  try {
    const db = getDatabase();
    const results = await db.getAllAsync<{ workout_date: string; cnt: number }>(`
      SELECT workout_date, COUNT(DISTINCT workout_day_name) as cnt FROM workout_logs
      WHERE user_id = ? AND workout_date >= ? AND workout_date <= ?
        AND status = 'completed'
      GROUP BY workout_date
      ORDER BY workout_date ASC
    `, [userId, startDate, endDate]);
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r.workout_date] = r.cnt;
    }
    return counts;
  } catch (error) {
    glowLogger.error('Error getting local workout counts by date', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return {};
  }
};

/**
 * Get all unique (workout_date, workout_day_name) pairs from local SQLite.
 * Used for computing historical per-week workout session counts without
 * conflating "unique dates" with "unique sessions".
 */
export const getLocalWorkoutDateNamePairs = async (
  userId: string,
  startDate: string,
  endDate: string
): Promise<Array<{ workout_date: string; workout_day_name: string }>> => {
  try {
    const db = getDatabase();
    return await db.getAllAsync<{ workout_date: string; workout_day_name: string }>(`
      SELECT workout_date, workout_day_name FROM workout_logs
      WHERE user_id = ? AND workout_date >= ? AND workout_date <= ?
        AND status = 'completed'
      GROUP BY workout_date, workout_day_name
      ORDER BY workout_date ASC
    `, [userId, startDate, endDate]);
  } catch (error) {
    glowLogger.error('Error getting local workout date-name pairs', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return [];
  }
};

/**
 * Get workout day names logged this week from local SQLite only.
 * Returns an array of workout_day_name strings for completed logs in the date range.
 */
export const getLocalWorkoutDayNames = async (
  userId: string,
  startDate: string,
  endDate: string
): Promise<string[]> => {
  try {
    const db = getDatabase();
    const results = await db.getAllAsync<{ workout_day_name: string }>(`
      SELECT DISTINCT workout_day_name FROM workout_logs
      WHERE user_id = ? AND workout_date >= ? AND workout_date <= ?
        AND status = 'completed'
      ORDER BY workout_date ASC
    `, [userId, startDate, endDate]);
    return results.map(r => r.workout_day_name);
  } catch (error) {
    glowLogger.error('Error getting local workout day names', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return [];
  }
};

/** Sum of (weight × reps) in kg for completed sets in completed workouts in the inclusive YYYY-MM-DD range. */
export const getVolumeLiftedKgForDateRange = async (
  userId: string,
  startDateYmd: string,
  endDateYmd: string,
): Promise<number> => {
  try {
    const db = getDatabase();
    const rows = await db.getAllAsync<{
      weight_value: number | null;
      weight_unit: string | null;
      reps: number | null;
      completed: number | null;
    }>(`
      SELECT wel.weight_value, wel.weight_unit, wel.reps, wel.completed
      FROM workout_exercise_logs wel
      INNER JOIN workout_logs wl ON wl.id = wel.workout_log_id
      WHERE wl.user_id = ?
        AND wl.status = 'completed'
        AND wl.workout_date >= ?
        AND wl.workout_date <= ?
        AND wel.completed = 1
    `, [userId, startDateYmd, endDateYmd]);

    let sumKg = 0;
    for (const r of rows) {
      const w = r.weight_value ?? 0;
      const rep = r.reps ?? 0;
      if (w <= 0 || rep <= 0) continue;
      const kg = r.weight_unit === 'lbs' ? w / 2.2046226218 : w;
      sumKg += kg * rep;
    }
    return Math.round(sumKg * 10) / 10;
  } catch (error) {
    glowLogger.error('Error computing volume lifted for date range', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return 0;
  }
};

// Single-flight guard: Progress training tab + charts both call
// getWorkoutLogsForDateRange on mount. On Android those overlap and the old
// check-then-insert sync raced on SQLite, sometimes crashing the emulator.
const inFlightWorkoutLogsSync = new Map<string, Promise<void>>();

async function syncWorkoutLogsFromSupabaseForRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<void> {
  if (!supabase) return;

  const existing = inFlightWorkoutLogsSync.get(userId);
  if (existing) {
    await existing;
    return;
  }

  const run = (async () => {
    const db = getDatabase();
    try {
      const { data: remoteWorkoutLogs, error: remoteError } = await supabase
        .from('workout_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('workout_date', startDate)
        .lte('workout_date', endDate)
        .neq('status', 'deleted')
        .order('workout_date', { ascending: false });

      if (remoteError || !remoteWorkoutLogs?.length) return;

      glowLogger.info('Found workout logs in Supabase, syncing to local', {
        count: remoteWorkoutLogs.length,
        user_id: userId,
      });

      for (const remoteLog of remoteWorkoutLogs) {
        const result = await db.runAsync(
          `
            INSERT OR IGNORE INTO workout_logs (
              supabase_id, user_id, workout_date, workout_day_name, step_id,
              status, created_at, updated_at, synced
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
          `,
          [
            remoteLog.id,
            remoteLog.user_id,
            remoteLog.workout_date,
            remoteLog.workout_day_name,
            remoteLog.step_id,
            remoteLog.status,
            remoteLog.created_at,
            remoteLog.updated_at,
          ],
        );

        let localLogId = result.lastInsertRowId;
        if (result.changes === 0) {
          const existingLocal = await db.getFirstAsync<{ id: number }>(
            'SELECT id FROM workout_logs WHERE supabase_id = ?',
            [remoteLog.id],
          );
          if (!existingLocal) continue;
          localLogId = existingLocal.id;
        }

        const { data: remoteExercises, error: exError } = await supabase
          .from('workout_exercise_logs')
          .select('*')
          .eq('workout_log_id', remoteLog.id);

        if (exError || !remoteExercises?.length) {
          if (result.changes > 0) {
            glowLogger.info('Synced workout log from Supabase to local', {
              supabase_id: remoteLog.id,
              local_id: localLogId,
              workout_date: remoteLog.workout_date,
            });
          }
          continue;
        }

        const remoteWorkoutWeight =
          (await getLatestUserWeightKg(remoteLog.user_id).catch(() => undefined)) ??
          DEFAULT_BODYWEIGHT_KG;

        let insertedExerciseCount = 0;
        for (const remoteEx of remoteExercises) {
          const remoteKcal =
            typeof remoteEx.calories_burned === 'number' && Number.isFinite(remoteEx.calories_burned)
              ? remoteEx.calories_burned
              : estimateSetKcal(
                  {
                    reps: remoteEx.reps,
                    restTimeSeconds: remoteEx.rest_time_seconds,
                    rir: remoteEx.rir,
                    difficultyPerception: remoteEx.difficulty_perception,
                    weightValue: remoteEx.weight_value,
                    weightUnit: remoteEx.weight_unit as WeightUnit | null,
                    loggingUnit: getExerciseLoggingUnitById(remoteEx.exercise_id),
                  },
                  remoteWorkoutWeight,
                );
          const insertResult = await db.runAsync(
            `
              INSERT OR IGNORE INTO workout_exercise_logs (
                supabase_id, workout_log_id, exercise_id, exercise_name, set_number,
                weight_value, weight_unit, reps, rest_time_seconds, rir,
                difficulty_perception, comments, completed, calories_burned,
                created_at, synced
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `,
            [
              remoteEx.id,
              localLogId,
              remoteEx.exercise_id,
              remoteEx.exercise_name,
              remoteEx.set_number,
              remoteEx.weight_value,
              remoteEx.weight_unit,
              remoteEx.reps,
              remoteEx.rest_time_seconds,
              remoteEx.rir,
              remoteEx.difficulty_perception ?? null,
              remoteEx.comments ?? null,
              (remoteEx.completed === true || remoteEx.completed === 1) ? 1 : 0,
              remoteKcal,
              remoteEx.created_at,
            ],
          );
          if (insertResult.changes > 0) insertedExerciseCount++;
        }

        if (insertedExerciseCount > 0) {
          glowLogger.info('Synced exercise logs from Supabase', {
            workout_log_id: localLogId,
            exercise_count: insertedExerciseCount,
          });
        }
        if (result.changes > 0) {
          glowLogger.info('Synced workout log from Supabase to local', {
            supabase_id: remoteLog.id,
            local_id: localLogId,
            workout_date: remoteLog.workout_date,
          });
        }
      }
    } catch (syncError) {
      glowLogger.warn('Failed to sync workout logs from Supabase, using local only', {
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }
  })();

  inFlightWorkoutLogsSync.set(userId, run);
  try {
    await run;
  } finally {
    inFlightWorkoutLogsSync.delete(userId);
  }
}

/**
 * Get workout logs for a date range
 */
export const getWorkoutLogsForDateRange = async (
  userId: string,
  startDate: string,
  endDate: string,
  localOnly = false
): Promise<WorkoutLog[]> => {
  try {
    const db = getDatabase();

    // Step 1: Try to fetch from Supabase and merge with local (for app reinstall scenarios).
    // Skipped when `localOnly` — fast-path callers (e.g. the Progress tab) read local SQLite
    // for an instant paint and rely on the one-time sign-in hydration (workout-sync-utils) to
    // restore history after a reinstall. Cross-device freshness within a session is traded away.
    if (!localOnly) {
      await syncWorkoutLogsFromSupabaseForRange(userId, startDate, endDate);
    }

    // Step 2: Read from local DB (now includes any synced data from Supabase)
    const logs = await db.getAllAsync<{
      id: number;
      supabase_id: number | null;
      user_id: string;
      workout_date: string;
      workout_day_name: string;
      step_id: string | null;
      status: string;
      created_at: string;
      updated_at: string;
      synced: number;
    }>(`
      SELECT * FROM workout_logs
      WHERE user_id = ? AND workout_date >= ? AND workout_date <= ? AND status != 'deleted'
      ORDER BY workout_date DESC, created_at DESC
    `, [userId, startDate, endDate]);

    const workoutLogs: WorkoutLog[] = [];
    for (const log of logs) {
      const exercises = await getExerciseLogsForWorkout(log.id);
      workoutLogs.push({
        id: log.id,
        supabaseId: log.supabase_id || undefined,
        userId: log.user_id,
        workoutDate: log.workout_date,
        workoutDayName: log.workout_day_name,
        stepId: log.step_id || undefined,
        status: log.status as WorkoutLogStatus,
        exercises,
        synced: log.synced === 1,
        createdAt: log.created_at,
        updatedAt: log.updated_at,
      });
    }

    return workoutLogs;
  } catch (error) {
    glowLogger.error('Error getting workout logs for date range', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return [];
  }
};

// ============================================
// Exercise Log CRUD Operations
// ============================================

/**
 * Save an exercise log entry (local-first)
 */
export const saveExerciseLog = async (
  workoutLogId: number,
  exerciseId: string,
  exerciseName: string,
  setNumber: number,
  weightValue?: number,
  weightUnit?: WeightUnit,
  reps?: number,
  restTimeSeconds?: number,
  rir?: number,
  difficultyPerception?: DifficultyPerception,
  comments?: string,
  syncToSupabase: boolean = false,
  completed: boolean = false
): Promise<ExerciseLog | null> => {
  try {
    const db = getDatabase();
    const createdAt = new Date().toISOString();

    // Per-set kcal estimate: bodyweight comes from the latest body_composition
    // log of the workout's owner. We tolerate a missing user_id (e.g. orphan
    // workout) by falling back to a tame default so the column never goes
    // null on a fresh write.
    const ownerRow = await db.getFirstAsync<{ user_id: string | null }>(
      'SELECT user_id FROM workout_logs WHERE id = ?',
      [workoutLogId],
    );
    const weightKg =
      (ownerRow?.user_id
        ? await getLatestUserWeightKg(ownerRow.user_id).catch(() => undefined)
        : undefined) ?? DEFAULT_BODYWEIGHT_KG;
    const caloriesBurned = estimateSetKcal(
      {
        reps,
        restTimeSeconds,
        rir,
        difficultyPerception,
        weightValue,
        weightUnit,
        loggingUnit: getExerciseLoggingUnitById(exerciseId),
      },
      weightKg,
    );

    // Check if this set already exists (update instead of insert)
    const existing = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM workout_exercise_logs WHERE workout_log_id = ? AND exercise_id = ? AND set_number = ?',
      [workoutLogId, exerciseId, setNumber]
    );

    let localId: number;

    if (existing) {
      // Update existing entry
      await db.runAsync(`
        UPDATE workout_exercise_logs
        SET weight_value = ?, weight_unit = ?, reps = ?, rest_time_seconds = ?, rir = ?,
            difficulty_perception = ?, comments = ?, completed = ?, calories_burned = ?, synced = 0
        WHERE id = ?
      `, [
        weightValue ?? null,
        weightUnit ?? null,
        reps ?? null,
        restTimeSeconds ?? null,
        rir ?? null,
        difficultyPerception ?? null,
        comments ?? null,
        completed ? 1 : 0,
        caloriesBurned,
        existing.id,
      ]);
      localId = existing.id;
      glowLogger.info('Exercise log updated', { local_id: localId, exercise_id: exerciseId, set_number: setNumber, completed });
    } else {
      // Insert new entry
      const result = await db.runAsync(`
        INSERT INTO workout_exercise_logs (
          workout_log_id, exercise_id, exercise_name, set_number,
          weight_value, weight_unit, reps, rest_time_seconds, rir,
          difficulty_perception, comments, completed, calories_burned, created_at, synced
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `, [
        workoutLogId,
        exerciseId,
        exerciseName,
        setNumber,
        weightValue ?? null,
        weightUnit ?? null,
        reps ?? null,
        restTimeSeconds ?? null,
        rir ?? null,
        difficultyPerception ?? null,
        comments ?? null,
        completed ? 1 : 0,
        caloriesBurned,
        createdAt,
      ]);
      localId = result.lastInsertRowId;
      glowLogger.info('Exercise log saved', { local_id: localId, exercise_id: exerciseId, set_number: setNumber, completed });
    }

    // Update workout log's updated_at timestamp
    await db.runAsync(
      'UPDATE workout_logs SET updated_at = ? WHERE id = ?',
      [new Date().toISOString(), workoutLogId]
    );

    // Try to sync to Supabase (only if syncToSupabase flag is true)
    if (supabase && syncToSupabase) {
      // Get the workout log's supabase_id
      const workoutLog = await db.getFirstAsync<{ supabase_id: number | null }>(
        'SELECT supabase_id FROM workout_logs WHERE id = ?',
        [workoutLogId]
      );

      glowLogger.info('Syncing exercise log to Supabase', {
        local_workout_log_id: workoutLogId,
        supabase_workout_log_id: workoutLog?.supabase_id ?? 'not synced',
        exercise_id: exerciseId,
        set_number: setNumber,
      });

      if (workoutLog?.supabase_id) {
        try {
          const exerciseData = {
            workout_log_id: workoutLog.supabase_id,
            exercise_id: exerciseId,
            exercise_name: exerciseName,
            set_number: setNumber,
            weight_value: weightValue,
            weight_unit: weightUnit,
            reps,
            rest_time_seconds: restTimeSeconds,
            rir,
            difficulty_perception: difficultyPerception,
            comments,
            calories_burned: caloriesBurned,
          };
          
          glowLogger.info('Inserting exercise log to Supabase', {
            workout_log_id: workoutLog.supabase_id,
            exercise_id: exerciseId,
            exercise_name: exerciseName,
            set_number: setNumber,
          });
          
          const { data, error } = await supabase
            .from('workout_exercise_logs')
            .insert(exerciseData)
            .select('id')
            .single();

          if (!error && data) {
            await db.runAsync(
              'UPDATE workout_exercise_logs SET supabase_id = ?, synced = 1 WHERE id = ?',
              [data.id, localId]
            );
            glowLogger.info('Exercise log synced successfully', {
              local_id: localId,
              supabase_id: data.id,
            });
          } else {
            glowLogger.warn('Exercise log Supabase sync failed, queuing for retry', {
              local_id: localId,
              error: error?.message,
            });
            await storePendingWorkoutExerciseLog({
              localId,
              workoutLogId,
              exerciseId,
              exerciseName,
              setNumber,
              weightValue,
              weightUnit,
              reps,
              restTimeSeconds,
              rir,
              difficultyPerception,
              comments,
              caloriesBurned,
              timestamp: Date.now(),
            });
          }
        } catch (syncError) {
          glowLogger.error('Exercise log Supabase sync exception', {
            local_id: localId,
            error: syncError instanceof Error ? syncError.message : String(syncError),
          });
          await storePendingWorkoutExerciseLog({
            localId,
            workoutLogId,
            exerciseId,
            exerciseName,
            setNumber,
            weightValue,
            weightUnit,
            reps,
            restTimeSeconds,
            rir,
            difficultyPerception,
            comments,
            caloriesBurned,
            timestamp: Date.now(),
          });
        }
      } else {
        glowLogger.warn('Workout log not synced to Supabase yet, skipping exercise log sync', {
          local_workout_log_id: workoutLogId,
        });
      }
    }

    return {
      id: localId,
      workoutLogId,
      exerciseId,
      exerciseName,
      setNumber,
      weightValue,
      weightUnit,
      reps,
      restTimeSeconds,
      rir,
      difficultyPerception,
      comments,
      createdAt,
    };
  } catch (error) {
    glowLogger.error('Error saving exercise log', {
      error: error instanceof Error ? error.message : String(error),
      workout_log_id: workoutLogId,
      exercise_id: exerciseId,
    });
    return null;
  }
};

/**
 * Get all exercise logs for a workout
 */
export const getExerciseLogsForWorkout = async (workoutLogId: number): Promise<ExerciseLog[]> => {
  try {
    const db = getDatabase();
    console.log('[getExerciseLogsForWorkout] Fetching exercise logs for workout ID:', workoutLogId);
    
    const logs = await db.getAllAsync<{
      id: number;
      supabase_id: number | null;
      workout_log_id: number;
      exercise_id: string;
      exercise_name: string;
      set_number: number;
      weight_value: number | null;
      weight_unit: string | null;
      reps: number | null;
      rest_time_seconds: number | null;
      rir: number | null;
      difficulty_perception: number | null;
      comments: string | null;
      completed: number | null;
      calories_burned: number | null;
      created_at: string;
    }>(`
      SELECT * FROM workout_exercise_logs
      WHERE workout_log_id = ?
      ORDER BY id
    `, [workoutLogId]);

    console.log('[getExerciseLogsForWorkout] Found', logs.length, 'exercise logs');
    console.log('[getExerciseLogsForWorkout] Exercises:', logs.map(l => l.exercise_name).join(', '));

    return logs.map(log => ({
      id: log.id,
      supabaseId: log.supabase_id || undefined,
      workoutLogId: log.workout_log_id,
      exerciseId: log.exercise_id,
      exerciseName: log.exercise_name,
      setNumber: log.set_number,
      weightValue: log.weight_value ?? undefined,
      weightUnit: log.weight_unit as WeightUnit | undefined,
      reps: log.reps ?? undefined,
      restTimeSeconds: log.rest_time_seconds ?? undefined,
      rir: log.rir ?? undefined,
      difficultyPerception: log.difficulty_perception as DifficultyPerception | undefined,
      comments: log.comments ?? undefined,
      completed: log.completed === 1,
      caloriesBurned:
        typeof log.calories_burned === 'number' && Number.isFinite(log.calories_burned)
          ? log.calories_burned
          : undefined,
      createdAt: log.created_at,
    }));
  } catch (error) {
    glowLogger.error('Error getting exercise logs for workout', {
      error: error instanceof Error ? error.message : String(error),
      workout_log_id: workoutLogId,
    });
    return [];
  }
};

/**
 * Get the last completed workout for a given exercise
 * Returns the most recent completed set data for reference
 */
export const getLastWorkoutForExercise = async (
  userId: string,
  exerciseId: string,
  excludeWorkoutLogId?: number
): Promise<{ [setNumber: number]: { weightValue?: number; weightUnit?: WeightUnit; reps?: number; restTimeSeconds?: number; rir?: number; comments?: string } }> => {
  try {
    const db = getDatabase();
    
    // Get the most recent completed workout that includes this exercise
    const lastWorkoutLog = await db.getFirstAsync<{ id: number }>(` 
      SELECT wl.id
      FROM workout_logs wl
      INNER JOIN workout_exercise_logs wel ON wel.workout_log_id = wl.id
      WHERE wl.user_id = ? 
        AND wel.exercise_id = ?
        AND wl.status = 'completed'
        ${excludeWorkoutLogId ? 'AND wl.id != ?' : ''}
      ORDER BY wl.workout_date DESC, wl.created_at DESC
      LIMIT 1
    `, excludeWorkoutLogId ? [userId, exerciseId, excludeWorkoutLogId] : [userId, exerciseId]);

    if (!lastWorkoutLog) {
      return {};
    }

    // Get all sets for this exercise from that workout
    const logs = await db.getAllAsync<{
      set_number: number;
      weight_value: number | null;
      weight_unit: string | null;
      reps: number | null;
      rest_time_seconds: number | null;
      rir: number | null;
      comments: string | null;
    }>(`
      SELECT set_number, weight_value, weight_unit, reps, rest_time_seconds, rir, comments
      FROM workout_exercise_logs
      WHERE workout_log_id = ? AND exercise_id = ?
      ORDER BY set_number
    `, [lastWorkoutLog.id, exerciseId]);

    const result: { [setNumber: number]: { weightValue?: number; weightUnit?: WeightUnit; reps?: number; restTimeSeconds?: number; rir?: number; comments?: string } } = {};
    logs.forEach(log => {
      result[log.set_number] = {
        weightValue: log.weight_value ?? undefined,
        weightUnit: log.weight_unit as WeightUnit | undefined,
        reps: log.reps ?? undefined,
        restTimeSeconds: log.rest_time_seconds ?? undefined,
        rir: log.rir ?? undefined,
        comments: log.comments ?? undefined,
      };
    });

    return result;
  } catch (error) {
    glowLogger.error('Error getting last workout for exercise', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      exercise_id: exerciseId,
    });
    return {};
  }
};

/**
 * All-time exercise history for a given catalog exerciseId.
 *
 * Returns the most recent N completed sessions that include this exercise,
 * each with all set data (weight, reps, rir, comments). Used by the chat
 * coach to answer questions like "what was my max pull-up weight?" or
 * "when did I last deadlift?" — these are unbounded-history questions
 * that the fixed 2-week snapshot window cannot answer reliably.
 */
export const getExerciseHistory = async (
  userId: string,
  exerciseId: string,
  options?: { limitSessions?: number }
): Promise<{
  workoutLogId: number;
  workoutDate: string;
  workoutDayName: string;
  sets: {
    setNumber: number;
    weightValue?: number;
    weightUnit?: WeightUnit;
    reps?: number;
    rir?: number;
    comments?: string;
  }[];
}[]> => {
  try {
    const db = getDatabase();
    const limitSessions = Math.max(1, options?.limitSessions ?? 45);

    // Get the N most recent completed workouts that include this exercise.
    const sessions = await db.getAllAsync<{
      id: number;
      workout_date: string;
      workout_day_name: string;
    }>(`
      SELECT DISTINCT wl.id, wl.workout_date, wl.workout_day_name
      FROM workout_logs wl
      INNER JOIN workout_exercise_logs wel ON wel.workout_log_id = wl.id
      WHERE wl.user_id = ?
        AND wel.exercise_id = ?
        AND wl.status = 'completed'
      ORDER BY wl.workout_date DESC, wl.created_at DESC
      LIMIT ?
    `, [userId, exerciseId, limitSessions]);

    if (sessions.length === 0) return [];

    const ids = sessions.map(s => s.id);
    const placeholders = ids.map(() => '?').join(',');
    const setRows = await db.getAllAsync<{
      workout_log_id: number;
      set_number: number;
      weight_value: number | null;
      weight_unit: string | null;
      reps: number | null;
      rir: number | null;
      comments: string | null;
    }>(`
      SELECT workout_log_id, set_number, weight_value, weight_unit, reps, rir, comments
      FROM workout_exercise_logs
      WHERE exercise_id = ?
        AND workout_log_id IN (${placeholders})
      ORDER BY workout_log_id, set_number
    `, [exerciseId, ...ids]);

    const setsByWorkout = new Map<number, typeof setRows>();
    for (const row of setRows) {
      if (!setsByWorkout.has(row.workout_log_id)) setsByWorkout.set(row.workout_log_id, []);
      setsByWorkout.get(row.workout_log_id)!.push(row);
    }

    return sessions.map(s => ({
      workoutLogId: s.id,
      workoutDate: s.workout_date,
      workoutDayName: s.workout_day_name,
      sets: (setsByWorkout.get(s.id) || []).map(r => ({
        setNumber: r.set_number,
        weightValue: r.weight_value ?? undefined,
        weightUnit: (r.weight_unit ?? undefined) as WeightUnit | undefined,
        reps: r.reps ?? undefined,
        rir: r.rir ?? undefined,
        comments: r.comments ?? undefined,
      })),
    }));
  } catch (error) {
    glowLogger.error('Error getting exercise history', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      exercise_id: exerciseId,
    });
    return [];
  }
};

/**
 * Delete an exercise log entry
 */
export const deleteExerciseLog = async (exerciseLogId: number): Promise<boolean> => {
  try {
    const db = getDatabase();

    // Get the exercise log to find its supabase_id
    const exerciseLog = await db.getFirstAsync<{ supabase_id: number | null; workout_log_id: number }>(
      'SELECT supabase_id, workout_log_id FROM workout_exercise_logs WHERE id = ?',
      [exerciseLogId]
    );

    if (!exerciseLog) {
      return false;
    }

    // Delete locally
    await db.runAsync('DELETE FROM workout_exercise_logs WHERE id = ?', [exerciseLogId]);

    // Update workout log's updated_at
    await db.runAsync(
      'UPDATE workout_logs SET updated_at = ? WHERE id = ?',
      [new Date().toISOString(), exerciseLog.workout_log_id]
    );

    // Delete from Supabase if synced
    if (supabase && exerciseLog.supabase_id) {
      try {
        await supabase
          .from('workout_exercise_logs')
          .delete()
          .eq('id', exerciseLog.supabase_id);
      } catch (syncError) {
        glowLogger.warn('Failed to delete exercise log from Supabase', {
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    }

    glowLogger.info('Exercise log deleted', { exercise_log_id: exerciseLogId });
    return true;
  } catch (error) {
    glowLogger.error('Error deleting exercise log', {
      error: error instanceof Error ? error.message : String(error),
      exercise_log_id: exerciseLogId,
    });
    return false;
  }
};

// ============================================
// Sync Functions
// ============================================

/**
 * Retry pending workout log syncs
 */
export const retryPendingWorkoutLogs = async (): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> => {
  // Import dynamically to avoid circular dependency
  const { getPendingWorkoutLogs } = await import('./sync-status');
  const pendingLogs = await getPendingWorkoutLogs();

  if (pendingLogs.length === 0) {
    return { total: 0, succeeded: 0, failed: 0 };
  }

  if (!supabase) {
    return { total: pendingLogs.length, succeeded: 0, failed: pendingLogs.length };
  }

  let succeeded = 0;
  let failed = 0;
  const db = getDatabase();

  for (const pending of pendingLogs) {
    try {
      const { data, error } = await supabase
        .from('workout_logs')
        .insert({
          user_id: pending.userId,
          workout_date: pending.workoutDate,
          workout_day_name: pending.workoutDayName,
          step_id: pending.stepId || null,
          status: pending.status,
        })
        .select('id')
        .single();

      if (!error && data) {
        await db.runAsync(
          'UPDATE workout_logs SET supabase_id = ?, synced = 1 WHERE id = ?',
          [data.id, pending.localId]
        );
        await removePendingWorkoutLog(pending.localId);
        succeeded++;
      } else {
        failed++;
      }
    } catch (error) {
      failed++;
    }
  }

  glowLogger.info('Completed pending workout log sync retry', { total: pendingLogs.length, succeeded, failed });
  return { total: pendingLogs.length, succeeded, failed };
};

/**
 * Retry pending exercise log syncs
 */
export const retryPendingExerciseLogs = async (): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> => {
  const { getPendingWorkoutExerciseLogs } = await import('./sync-status');
  const pendingLogs = await getPendingWorkoutExerciseLogs();

  if (pendingLogs.length === 0) {
    return { total: 0, succeeded: 0, failed: 0 };
  }

  if (!supabase) {
    return { total: pendingLogs.length, succeeded: 0, failed: pendingLogs.length };
  }

  let succeeded = 0;
  let failed = 0;
  const db = getDatabase();

  for (const pending of pendingLogs) {
    try {
      // Get the parent workout's supabase_id
      const workoutLog = await db.getFirstAsync<{ supabase_id: number | null }>(
        'SELECT supabase_id FROM workout_logs WHERE id = ?',
        [pending.workoutLogId]
      );

      if (!workoutLog?.supabase_id) {
        failed++;
        continue;
      }

      const { data, error } = await supabase
        .from('workout_exercise_logs')
        .insert({
          workout_log_id: workoutLog.supabase_id,
          exercise_id: pending.exerciseId,
          exercise_name: pending.exerciseName,
          set_number: pending.setNumber,
          weight_value: pending.weightValue,
          weight_unit: pending.weightUnit,
          reps: pending.reps,
          rest_time_seconds: pending.restTimeSeconds,
          rir: pending.rir,
          difficulty_perception: pending.difficultyPerception,
          comments: pending.comments,
          calories_burned: pending.caloriesBurned ?? null,
        })
        .select('id')
        .single();

      if (!error && data) {
        await db.runAsync(
          'UPDATE workout_exercise_logs SET supabase_id = ?, synced = 1 WHERE id = ?',
          [data.id, pending.localId]
        );
        await removePendingWorkoutExerciseLog(pending.localId);
        succeeded++;
      } else {
        failed++;
      }
    } catch (error) {
      failed++;
    }
  }

  glowLogger.info('Completed pending exercise log sync retry', { total: pendingLogs.length, succeeded, failed });
  return { total: pendingLogs.length, succeeded, failed };
};

