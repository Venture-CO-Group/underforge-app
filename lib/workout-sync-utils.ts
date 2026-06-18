/**
 * Workout Sync Utilities
 *
 * Simple utilities for clearing and syncing workout data.
 * These functions use the existing workout-storage functions.
 */

import { createClient } from '@supabase/supabase-js';
import { getDatabase } from './db';
import { clearAllWorkoutLogsForUser } from './workout-storage';

// Supabase configuration (same as in workout-storage.ts)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ?
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/**
 * Clear all local workout data for a user
 */
export async function clearLocalWorkoutData(userId: string): Promise<void> {
  console.log(`🧹 Clearing local workout data for user: ${userId}`);

  try {
    await clearAllWorkoutLogsForUser(userId);
    console.log('✅ Local workout data cleared successfully');
  } catch (error) {
    console.error('❌ Error clearing local workout data:', error);
    throw error;
  }
}

/**
 * Sync workout data from Supabase to local database
 * This will add any missing data from Supabase to local storage
 */
export async function syncFromSupabaseToLocal(userId: string): Promise<void> {
  console.log(`🔄 Syncing workout data from Supabase for user: ${userId}`);

  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    // Fetch workout logs from Supabase (only completed workouts, not drafts)
    console.log('📡 Fetching COMPLETED workout logs from Supabase...');
    const { data: workoutLogs, error: workoutError } = await supabase
      .from('workout_logs')
      .select('id, user_id, workout_date, workout_day_name, step_id, status, created_at, updated_at')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('workout_date', { ascending: false });

    if (workoutError) {
      throw new Error(`Supabase error: ${workoutError.message}`);
    }

    console.log(`📊 Found ${workoutLogs.length} workout logs in Supabase`);

    const db = getDatabase();

    // Process each workout log
    for (const workoutLog of workoutLogs) {
      console.log(`💪 Processing workout:`, workoutLog);

      // Ensure we have a valid workout_date
      let workoutDate = workoutLog.workout_date;
      if (!workoutDate) {
        console.log(`   ⚠️ Skipping workout - no workout_date found:`, workoutLog);
        continue;
      }

      // Convert to YYYY-MM-DD format if it's a full timestamp
      if (workoutDate.includes('T')) {
        workoutDate = workoutDate.split('T')[0];
      }

      console.log(`💪 Processing workout: ${workoutLog.workout_day_name} (${workoutDate})`);

      // Check if this workout already exists locally
      const existingWorkout = await db.getFirstAsync<{ id: number }>(
        'SELECT id FROM workout_logs WHERE user_id = ? AND workout_date = ? AND workout_day_name = ?',
        [userId, workoutDate, workoutLog.workout_day_name]
      );

      if (existingWorkout) {
        console.log(`   ⏭️ Workout already exists locally (ID: ${existingWorkout.id}), skipping`);
        continue;
      }

      // Create workout log locally with Supabase ID
      const result = await db.runAsync(`
        INSERT INTO workout_logs (
          user_id, workout_date, workout_day_name, step_id, status,
          created_at, updated_at, supabase_id, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [
        userId,
        workoutDate,
        workoutLog.workout_day_name,
        workoutLog.step_id || null,
        workoutLog.status || 'completed',
        workoutLog.created_at || new Date().toISOString(),
        workoutLog.updated_at || new Date().toISOString(),
        workoutLog.id,
      ]);

      const localWorkoutId = result.lastInsertRowId;
      console.log(`   ✅ Created new workout log (ID: ${localWorkoutId})`);

      // Fetch exercise logs for this workout
      const { data: exerciseLogs, error: exerciseError } = await supabase
        .from('workout_exercise_logs')
        .select('*')
        .eq('workout_log_id', workoutLog.id);

      if (exerciseError) {
        console.error(`   ⚠️ Error fetching exercises for workout ${workoutLog.id}:`, exerciseError.message);
        continue;
      }

      console.log(`   🏋️ Found ${exerciseLogs.length} exercise logs`);

      // Process exercise logs
      for (const exercise of exerciseLogs) {
        console.log(`     📝 Exercise data:`, exercise);
        
        await db.runAsync(`
          INSERT INTO workout_exercise_logs (
            workout_log_id, exercise_id, exercise_name, set_number,
            weight_value, weight_unit, reps, rest_time_seconds, rir,
            difficulty_perception, comments, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          localWorkoutId,
          exercise.exercise_id || exercise.exercise_name.toLowerCase().replace(/\s+/g, '-'),
          exercise.exercise_name,
          exercise.set_number,
          exercise.weight_value || null,  // Correct column name
          exercise.weight_unit || 'kg',   // Use from Supabase or default to kg
          exercise.reps || null,
          exercise.rest_time_seconds || null,  // Correct column name
          exercise.rir || null,
          exercise.difficulty_perception || null,
          exercise.comments || null,
          exercise.created_at || new Date().toISOString(),
        ]);

        console.log(`     ✅ Added exercise: ${exercise.exercise_name} (set ${exercise.set_number}) - weight: ${exercise.weight_value}, reps: ${exercise.reps}`);
      }
    }

    console.log('🎉 Sync completed successfully!');

  } catch (error) {
    console.error('❌ Error syncing from Supabase:', error);
    throw error;
  }
}

/**
 * Clear local workout data AND sync from Supabase
 * This completely resets local data and replaces it with Supabase data
 */
export async function resetAndSyncWorkoutData(userId: string): Promise<void> {
  console.log(`🔄 Reset and sync workout data for user: ${userId}`);

  try {
    // Clear local data first
    await clearLocalWorkoutData(userId);

    // Then sync from Supabase
    await syncFromSupabaseToLocal(userId);

    console.log('✅ Reset and sync completed successfully!');
  } catch (error) {
    console.error('❌ Error during reset and sync:', error);
    throw error;
  }
}

/**
 * Get sync status - shows what data exists locally vs in Supabase
 */
export async function getWorkoutSyncStatus(userId: string): Promise<{
  localWorkouts: number;
  supabaseWorkouts: number;
  needsSync: boolean;
}> {
  console.log(`📊 Checking sync status for user: ${userId}`);

  try {
    // Get local count
    const db = getDatabase();
    const localResult = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM workout_logs WHERE user_id = ?',
      [userId]
    );
    const localWorkouts = localResult?.count || 0;

    // Get Supabase count
    let supabaseWorkouts = 0;
    if (supabase) {
      const { data, error } = await supabase
        .from('workout_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (!error) {
        supabaseWorkouts = data?.length || 0;
      }
    }

    const needsSync = localWorkouts !== supabaseWorkouts;

    console.log(`📊 Sync status: Local=${localWorkouts}, Supabase=${supabaseWorkouts}, Needs sync=${needsSync}`);

    return {
      localWorkouts,
      supabaseWorkouts,
      needsSync,
    };

  } catch (error) {
    console.error('❌ Error getting sync status:', error);
    throw error;
  }
}
