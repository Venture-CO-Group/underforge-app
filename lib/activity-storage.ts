import { createClient } from '@supabase/supabase-js';
import { ActivityIntensity, ActivityLog, getActivityTypeById } from '../types/workout';
import {
  isStrengthStyleActivityType,
  reconcileMatchForImportedActivity,
  refreshUnacknowledgedLinkCalories,
} from './activity-workout-links';
import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import { estimateCaloriesFromMet } from './providers/met-table';
import { dedupeFingerprint } from './providers/types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let supabase: any;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/**
 * Fill calorie-related and dedupe fields on an activity before it hits the
 * database. For manual entries missing calories we estimate via MET so every
 * activity has at least a confidence-labelled kcal value.
 *
 * Kept inline (no I/O) so it also runs during bulk imports from HealthKit
 * and Whoop without blocking the event loop.
 */
function enrichActivityForInsert(
  log: Omit<ActivityLog, 'id' | 'supabaseId' | 'synced' | 'createdAt' | 'updatedAt'>,
  opts?: { weightKg?: number; sex?: 'male' | 'female' | 'unknown' },
): Omit<ActivityLog, 'id' | 'supabaseId' | 'synced' | 'createdAt' | 'updatedAt'> {
  const source = log.source ?? 'manual';
  let caloriesBurned = log.caloriesBurned;
  let caloriesSource = log.caloriesSource;
  let caloriesConfidence = log.caloriesConfidence;

  if (caloriesBurned == null || !Number.isFinite(caloriesBurned)) {
    const typeDef = getActivityTypeById(log.activityType);
    const category = typeDef?.category ?? 'other';
    const est = estimateCaloriesFromMet({
      category,
      durationMinutes: log.durationMinutes,
      weightKg: opts?.weightKg,
      sex: opts?.sex,
      intensity: log.intensity,
    });
    caloriesBurned = est.caloriesBurned;
    caloriesSource = est.caloriesSource;
    caloriesConfidence = est.caloriesConfidence;
  } else if (!caloriesSource) {
    // Caller provided a number but no provenance; default to 'manual' so the
    // UI can still show a source badge.
    caloriesSource = source === 'manual' ? 'manual' : 'provider';
    caloriesConfidence = caloriesConfidence ?? (source === 'manual' ? 'medium' : 'high');
  }

  // Fingerprint: only meaningful when we know start time.
  const fingerprint =
    log.dedupeFingerprint ??
    (log.startedAt
      ? dedupeFingerprint(
          log.startedAt,
          getActivityTypeById(log.activityType)?.category ?? 'other',
          log.durationMinutes,
        )
      : undefined);

  return {
    ...log,
    source,
    caloriesBurned,
    caloriesSource,
    caloriesConfidence,
    dedupeFingerprint: fingerprint,
  };
}

/**
 * Create a new activity log (local-first, then sync to Supabase)
 */
export const createActivityLog = async (
  log: Omit<ActivityLog, 'id' | 'supabaseId' | 'synced' | 'createdAt' | 'updatedAt'>,
  opts?: { weightKg?: number; sex?: 'male' | 'female' | 'unknown' }
): Promise<ActivityLog | null> => {
  try {
    const now = new Date().toISOString();
    const db = getDatabase();
    const enriched = enrichActivityForInsert(log, opts);

    const result = await db.runAsync(
      `INSERT INTO activity_logs (
        user_id, activity_date, activity_type, activity_name,
        duration_minutes, intensity, distance_value, distance_unit,
        elevation_gain, calories_burned, avg_heart_rate, notes,
        source, external_id, calories_source, calories_confidence,
        dedupe_fingerprint, started_at, ended_at,
        created_at, updated_at, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        enriched.userId,
        enriched.activityDate,
        enriched.activityType,
        enriched.activityName,
        enriched.durationMinutes,
        enriched.intensity,
        enriched.distanceValue ?? null,
        enriched.distanceUnit ?? null,
        enriched.elevationGain ?? null,
        enriched.caloriesBurned ?? null,
        enriched.avgHeartRate ?? null,
        enriched.notes ?? null,
        enriched.source ?? 'manual',
        enriched.externalId ?? null,
        enriched.caloriesSource ?? 'manual',
        enriched.caloriesConfidence ?? 'medium',
        enriched.dedupeFingerprint ?? null,
        enriched.startedAt ?? null,
        enriched.endedAt ?? null,
        now,
        now,
      ]
    );

    const localId = result.lastInsertRowId;
    glowLogger.info('Activity log created locally', {
      local_id: localId,
      activity_type: enriched.activityType,
      activity_name: enriched.activityName,
      source: enriched.source ?? 'manual',
      calories_source: enriched.caloriesSource,
    });

    // Await sync so the row is marked synced before the caller triggers
    // a dashboard refresh (which runs retryPendingActivityLogs).
    await syncActivityLogToSupabase(localId, enriched, now);

    // Re-read so callers (e.g. the social share flow) see the freshly-synced
    // supabase_id and synced flag without an extra polling round-trip.
    const fresh = await getActivityLogById(localId);
    if (fresh) return fresh;

    return {
      id: localId,
      ...enriched,
      synced: false,
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    glowLogger.error('Failed to create activity log', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

/**
 * Get all activity logs for a user, ordered by date descending
 */
export const getActivityLogs = async (
  userId: string,
  limit = 50,
  offset = 0
): Promise<ActivityLog[]> => {
  try {
    const db = getDatabase();
    const rows = await db.getAllAsync<any>(
      `SELECT * FROM activity_logs
       WHERE user_id = ? AND status != 'deleted'
       ORDER BY activity_date DESC, created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

    return rows.map(mapRowToActivityLog);
  } catch (error) {
    glowLogger.error('Failed to get activity logs', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

/**
 * Get activity logs for a date range.
 * Mirrors the workout-log behaviour: tries to fetch from Supabase first and merge
 * any missing rows into local SQLite, then reads from local. This way an activity
 * that successfully made it to Supabase but never landed in local SQLite (e.g.
 * after a reinstall, or because the original local insert failed) still surfaces
 * in the UI instead of silently disappearing.
 */
export const getActivityLogsForDateRange = async (
  userId: string,
  startDate: string,
  endDate: string,
  localOnly = false
): Promise<ActivityLog[]> => {
  try {
    const db = getDatabase();

    // Step 1: best-effort Supabase backfill for the requested range.
    // Skipped when `localOnly` — fast-path callers (e.g. the Progress tab) read local SQLite
    // and rely on the one-time sign-in hydration (syncActivityLogsFromSupabase) for reinstall.
    if (!localOnly) {
      await syncActivityLogsFromSupabaseRange(userId, startDate, endDate).catch(err => {
        glowLogger.warn('Inline Supabase sync failed for activity logs, using local only', {
          error: err instanceof Error ? err.message : String(err),
          user_id: userId,
          start_date: startDate,
          end_date: endDate,
        });
      });
    }

    // Step 2: read from local DB (now includes anything we just synced from Supabase)
    const rows = await db.getAllAsync<any>(
      `SELECT * FROM activity_logs
       WHERE user_id = ? AND activity_date >= ? AND activity_date <= ? AND status != 'deleted'
       ORDER BY activity_date DESC, created_at DESC`,
      [userId, startDate, endDate]
    );

    return rows.map(mapRowToActivityLog);
  } catch (error) {
    glowLogger.error('Failed to get activity logs for date range', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

/**
 * Fetch a single activity log by its local SQLite id. Returns null if not
 * found (or soft-deleted). Used by the social share flow to resolve the
 * Supabase id once a background sync lands.
 */
export const getActivityLogById = async (
  activityLogId: number
): Promise<ActivityLog | null> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<any>(
      `SELECT * FROM activity_logs WHERE id = ? AND status != 'deleted'`,
      [activityLogId]
    );
    if (!row) return null;
    return mapRowToActivityLog(row);
  } catch (error) {
    glowLogger.error('Failed to get activity log by id', {
      error: error instanceof Error ? error.message : String(error),
      activity_log_id: activityLogId,
    });
    return null;
  }
};

/**
 * Get activity logs for a specific date
 */
export const getActivityLogsForDate = async (
  userId: string,
  date: string
): Promise<ActivityLog[]> => {
  try {
    const db = getDatabase();
    const rows = await db.getAllAsync<any>(
      `SELECT * FROM activity_logs
       WHERE user_id = ? AND activity_date = ? AND status != 'deleted'
       ORDER BY created_at DESC`,
      [userId, date]
    );

    return rows.map(mapRowToActivityLog);
  } catch (error) {
    glowLogger.error('Failed to get activity logs for date', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

/**
 * Update activity_date on an existing log (local + Supabase when linked).
 */
export const updateActivityDate = async (
  userId: string,
  localLogId: number,
  newDate: string
): Promise<boolean> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ user_id: string; supabase_id: number | null }>(
      'SELECT user_id, supabase_id FROM activity_logs WHERE id = ? AND status != ?',
      [localLogId, 'deleted']
    );
    if (!row || row.user_id !== userId) {
      glowLogger.warn('updateActivityDate: log missing or user mismatch', {
        local_log_id: localLogId,
        user_id: userId,
      });
      return false;
    }

    const now = new Date().toISOString();
    await db.runAsync(
      'UPDATE activity_logs SET activity_date = ?, updated_at = ?, synced = 0 WHERE id = ?',
      [newDate, now, localLogId]
    );

    if (row.supabase_id && supabase) {
      try {
        const { error } = await supabase
          .from('activity_logs')
          .update({ activity_date: newDate, updated_at: now })
          .eq('id', row.supabase_id)
          .eq('user_id', userId);
        if (!error) {
          await db.runAsync('UPDATE activity_logs SET synced = 1 WHERE id = ?', [localLogId]);
        } else {
          glowLogger.warn('Failed to sync activity date to Supabase', { error: error.message });
        }
      } catch (e) {
        glowLogger.warn('Failed to sync activity date to Supabase, will retry on next sync', {
          error: e instanceof Error ? e.message : String(e),
          local_log_id: localLogId,
        });
      }
    }

    return true;
  } catch (error) {
    glowLogger.error('Failed to update activity date', {
      error: error instanceof Error ? error.message : String(error),
      local_log_id: localLogId,
    });
    return false;
  }
};

/**
 * Soft-delete an activity log locally; remove remote row when supabase_id is set.
 */
export const deleteActivityLog = async (userId: string, logId: number): Promise<boolean> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ supabase_id: number | null }>(
      'SELECT supabase_id FROM activity_logs WHERE id = ? AND user_id = ? AND status != ?',
      [logId, userId, 'deleted']
    );

    if (!row) {
      glowLogger.warn('deleteActivityLog: log not found or user mismatch', {
        log_id: logId,
        user_id: userId,
      });
      return false;
    }

    await db.runAsync(
      `UPDATE activity_logs SET status = 'deleted', updated_at = ?, synced = 0 WHERE id = ?`,
      [new Date().toISOString(), logId]
    );

    if (supabase && row.supabase_id) {
      try {
        const { error } = await supabase
          .from('activity_logs')
          .delete()
          .eq('id', row.supabase_id)
          .eq('user_id', userId);
        if (!error) {
          await db.runAsync('UPDATE activity_logs SET synced = 1 WHERE id = ?', [logId]);
        } else {
          glowLogger.warn('Failed to delete activity on Supabase', { error: error.message });
        }
      } catch (e) {
        glowLogger.warn('Supabase activity delete error', {
          error: e instanceof Error ? e.message : String(e),
          log_id: logId,
        });
      }
    }

    glowLogger.info('Activity log deleted', { log_id: logId });
    return true;
  } catch (error) {
    glowLogger.error('Failed to delete activity log', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

/**
 * Hard-delete every activity_log for `(userId, source)` locally. Used by
 * provider disconnect flows (Whoop / Health Connect / etc.): once the user
 * disconnects an integration, the matching Edge Function purges the rows
 * on Supabase and the client mirrors that locally so no trace of the
 * imported data remains. Returns the count of rows removed.
 */
export const hardDeleteActivityLogsBySource = async (
  userId: string,
  source: Exclude<ActivityLog['source'], undefined>,
): Promise<number> => {
  try {
    const db = getDatabase();
    const before = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) as n FROM activity_logs WHERE user_id = ? AND source = ?`,
      [userId, source],
    );
    const count = Number(before?.n ?? 0);
    if (count === 0) return 0;

    await db.runAsync(
      `DELETE FROM activity_logs WHERE user_id = ? AND source = ?`,
      [userId, source],
    );
    glowLogger.info('Hard-deleted activity logs for provider disconnect', {
      user_id: userId,
      source,
      count,
    });
    return count;
  } catch (e) {
    glowLogger.error('hardDeleteActivityLogsBySource failed', {
      error: e instanceof Error ? e.message : String(e),
      user_id: userId,
      source,
    });
    return 0;
  }
};

/** Number of distinct activity sessions per date (non-deleted) in inclusive YYYY-MM-DD range. */
export const getLocalActivityCountsByDate = async (
  userId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, number>> => {
  try {
    const db = getDatabase();
    const results = await db.getAllAsync<{ activity_date: string; cnt: number }>(`
      SELECT activity_date, COUNT(*) AS cnt
      FROM activity_logs
      WHERE user_id = ? AND activity_date >= ? AND activity_date <= ? AND status != 'deleted'
      GROUP BY activity_date
      ORDER BY activity_date ASC
    `, [userId, startDate, endDate]);
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.activity_date] = r.cnt;
    return counts;
  } catch (error) {
    glowLogger.error('Error getting local activity counts by date', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return {};
  }
};

/**
 * Number of activity_logs rows per date that QUALIFY as a training-substitute
 * for the consistency score. The rule (see consistency-helper docs):
 *
 *   - activity_type !== 'stretching' (stretching never substitutes for training)
 *   - duration_minutes >= 30
 *   - intensity in ('hard','max')
 *     OR (intensity === 'moderate' AND duration_minutes >= 45)
 *
 * The daily cap (1 training session per day total, including workout_logs)
 * is applied by the caller, not here.
 */
export const getQualifyingActivityCountsByDate = async (
  userId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, number>> => {
  try {
    const db = getDatabase();
    const results = await db.getAllAsync<{ activity_date: string; cnt: number }>(`
      SELECT activity_date, COUNT(*) AS cnt
      FROM activity_logs
      WHERE user_id = ?
        AND activity_date >= ? AND activity_date <= ?
        AND status != 'deleted'
        AND activity_type != 'stretching'
        AND duration_minutes >= 30
        AND (
          intensity IN ('hard','max')
          OR (intensity = 'moderate' AND duration_minutes >= 45)
        )
      GROUP BY activity_date
      ORDER BY activity_date ASC
    `, [userId, startDate, endDate]);
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.activity_date] = r.cnt;
    return counts;
  } catch (error) {
    glowLogger.error('Error getting qualifying activity counts by date', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return {};
  }
};

/** Sum of calories_burned from non-deleted activity_logs in inclusive YYYY-MM-DD range. */
export const getActivityCaloriesForDateRange = async (
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ total: number }>(`
      SELECT COALESCE(SUM(calories_burned), 0) AS total
      FROM activity_logs
      WHERE user_id = ? AND activity_date >= ? AND activity_date <= ? AND status != 'deleted'
    `, [userId, startDate, endDate]);
    return Math.round(row?.total ?? 0);
  } catch (error) {
    glowLogger.error('Error summing activity calories for date range', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return 0;
  }
};

/** Sum of duration_minutes from non-deleted activity_logs in inclusive YYYY-MM-DD range. */
export const getActivityDurationForDateRange = async (
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ total: number }>(`
      SELECT COALESCE(SUM(duration_minutes), 0) AS total
      FROM activity_logs
      WHERE user_id = ? AND activity_date >= ? AND activity_date <= ? AND status != 'deleted'
    `, [userId, startDate, endDate]);
    return Math.round(row?.total ?? 0);
  } catch (error) {
    glowLogger.error('Error summing activity duration for date range', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return 0;
  }
};

/**
 * Allowed values for SQLite CHECK constraints on the activity_logs table.
 * Anything outside these sets must be normalised before insert, otherwise
 * the row silently fails to land locally and the activity disappears from
 * the dashboard / Progress screen even though it lives in Supabase.
 */
const VALID_INTENSITIES = new Set(['easy', 'moderate', 'hard', 'max']);
const VALID_DISTANCE_UNITS = new Set(['km', 'mi']);
const VALID_STATUSES = new Set(['active', 'deleted']);

function normalizeIntensity(value: unknown): string | null {
  if (value == null) return null;
  const v = String(value).toLowerCase();
  return VALID_INTENSITIES.has(v) ? v : null;
}

function normalizeDistanceUnit(value: unknown): string | null {
  if (value == null) return null;
  const v = String(value).toLowerCase();
  return VALID_DISTANCE_UNITS.has(v) ? v : null;
}

function normalizeStatus(value: unknown): string {
  if (value == null) return 'active';
  const v = String(value).toLowerCase();
  return VALID_STATUSES.has(v) ? v : 'active';
}

/**
 * Insert a Supabase activity_logs row into local SQLite if it isn't already present.
 * Returns true if a new row was inserted, false if it already existed locally,
 * and throws (so the caller can log) on actual insert errors.
 */
async function upsertActivityLogRowFromSupabase(row: any): Promise<boolean> {
  const db = getDatabase();

  // PostgREST may return `external_id` as a number while SQLite stores TEXT;
  // normalize so (user, source, external_id) dedupe always matches.
  const externalIdStr =
    row.external_id != null && row.external_id !== '' ? String(row.external_id) : null;
  const fpStr =
    row.dedupe_fingerprint != null && row.dedupe_fingerprint !== ''
      ? String(row.dedupe_fingerprint)
      : null;

  // Check by supabase_id first, then fall back to (source, external_id) so
  // an imported HealthKit activity that was pushed by a different device
  // doesn't get inserted twice locally.
  const existing = await db.getFirstAsync<{ id: number; status: string | null }>(
    'SELECT id, status FROM activity_logs WHERE supabase_id = ?',
    [row.id],
  );
  if (existing) {
    // Heal stale soft-delete state: if the local copy is tombstoned but
    // Supabase says the row is active (we already filtered out remote
    // tombstones in `syncActivityLogsFromSupabaseRange`), resurrect it so
    // the UI's `status != 'deleted'` filter stops hiding the row. This is
    // what makes a Whoop reconnect after a previous broken-sync session
    // surface workouts in Recent Workouts again.
    const remoteStatus = normalizeStatus(row.status);
    if ((existing.status ?? 'active') !== remoteStatus) {
      await db.runAsync(
        `UPDATE activity_logs
            SET status = ?,
                updated_at = ?,
                synced = 1
          WHERE id = ?`,
        [remoteStatus, row.updated_at ?? new Date().toISOString(), existing.id],
      );
    }
    return false;
  }

  if (row.source && row.source !== 'manual' && externalIdStr) {
    const existingExternal = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM activity_logs WHERE user_id = ? AND source = ? AND external_id = ?',
      [row.user_id, row.source, externalIdStr],
    );
    if (existingExternal) {
      // Link the local row to its remote id AND resurrect it from any prior
      // soft-delete state. Without the `status` reset, a local row stuck on
      // `status='deleted'` (e.g. from a previous broken sync that imported a
      // tombstone, or from an old client-side delete that never round-tripped
      // through Supabase) would stay invisible forever even after the user
      // reconnects Whoop and the same `(source, external_id)` is re-upserted
      // remotely as active.
      await db.runAsync(
        `UPDATE activity_logs
            SET supabase_id = ?,
                status = ?,
                updated_at = ?,
                synced = 1
          WHERE id = ?`,
        [row.id, normalizeStatus(row.status), row.updated_at ?? new Date().toISOString(), existingExternal.id],
      );
      return false;
    }
  }

  // Same Whoop/HealthKit session can exist twice locally (e.g. orphan row with
  // NULL/mismatched external_id + fresh row from Supabase). Merge into one
  // local row using the server fingerprint, preferring a row that already has
  // an activity_workout_links row so user link decisions are preserved.
  if (row.source && row.source !== 'manual' && fpStr) {
    const mergeTarget = await db.getFirstAsync<{ id: number }>(
      `SELECT al.id FROM activity_logs al
         LEFT JOIN activity_workout_links awl ON awl.activity_log_id = al.id
        WHERE al.user_id = ? AND al.source = ? AND al.dedupe_fingerprint = ?
          AND IFNULL(al.supabase_id, -1) != ?
        ORDER BY CASE WHEN awl.id IS NOT NULL THEN 0 ELSE 1 END, al.id ASC
        LIMIT 1`,
      [row.user_id, row.source, fpStr, row.id],
    );
    if (mergeTarget) {
      const nowIso = row.updated_at ?? new Date().toISOString();
      await db.runAsync(
        `UPDATE activity_logs SET
            supabase_id = ?,
            activity_date = ?,
            activity_type = ?,
            activity_name = ?,
            duration_minutes = ?,
            intensity = ?,
            distance_value = ?,
            distance_unit = ?,
            elevation_gain = ?,
            calories_burned = ?,
            avg_heart_rate = ?,
            notes = ?,
            source = ?,
            external_id = ?,
            calories_source = ?,
            calories_confidence = ?,
            dedupe_fingerprint = ?,
            started_at = ?,
            ended_at = ?,
            status = ?,
            updated_at = ?,
            synced = 1
          WHERE id = ?`,
        [
          row.id,
          row.activity_date,
          row.activity_type,
          row.activity_name,
          row.duration_minutes,
          normalizeIntensity(row.intensity),
          row.distance_value ?? null,
          normalizeDistanceUnit(row.distance_unit),
          row.elevation_gain ?? null,
          row.calories_burned ?? null,
          row.avg_heart_rate ?? null,
          row.notes ?? null,
          row.source ?? 'manual',
          externalIdStr,
          row.calories_source ?? 'manual',
          row.calories_confidence ?? 'medium',
          fpStr,
          row.started_at ?? null,
          row.ended_at ?? null,
          normalizeStatus(row.status),
          nowIso,
          mergeTarget.id,
        ],
      );
      await db.runAsync(
        `DELETE FROM activity_logs
          WHERE user_id = ? AND source = ? AND dedupe_fingerprint = ?
            AND id != ?
            AND (supabase_id IS NULL OR supabase_id = ?)`,
        [row.user_id, row.source, fpStr, mergeTarget.id, row.id],
      );
      reconcileMatchForImportedActivity({
        userId: row.user_id,
        activityLogId: mergeTarget.id,
        activityDate: row.activity_date,
        activityType: row.activity_type,
      }).catch(() => {});
      return false;
    }
  }

  // Manual activities pulled from Supabase that arrive without a stored
  // kcal value should still get a MET-based estimate so the burned-calorie
  // bucket sums correctly. Wearable rows are server-normalised already
  // (see `reconcileCalories` in supabase/functions/_shared/normalize.ts) so
  // we leave their NULL alone — a deliberate "unknown" we don't overwrite.
  let resolvedKcal: number | null = row.calories_burned ?? null;
  let resolvedCaloriesSource: string = row.calories_source ?? 'manual';
  let resolvedCaloriesConfidence: string = row.calories_confidence ?? 'medium';
  if ((row.source ?? 'manual') === 'manual' && (resolvedKcal == null || !Number.isFinite(resolvedKcal))) {
    try {
      const typeDef = getActivityTypeById(row.activity_type);
      const category = typeDef?.category ?? 'other';
      const intensity = normalizeIntensity(row.intensity) as ActivityIntensity | null;
      const weightKg = await getLatestUserWeightKg(row.user_id).catch(() => undefined);
      const est = estimateCaloriesFromMet({
        category,
        durationMinutes: row.duration_minutes ?? 0,
        weightKg,
        intensity: intensity ?? undefined,
      });
      resolvedKcal = est.caloriesBurned;
      resolvedCaloriesSource = est.caloriesSource;
      resolvedCaloriesConfidence = est.caloriesConfidence;
    } catch (e) {
      glowLogger.warn('Failed to MET-estimate kcal for remote manual activity', {
        error: e instanceof Error ? e.message : String(e),
        supabase_id: row.id,
      });
    }
  }

  const insertResult = await db.runAsync(
    `INSERT INTO activity_logs (
      supabase_id, user_id, activity_date, activity_type, activity_name,
      duration_minutes, intensity, distance_value, distance_unit,
      elevation_gain, calories_burned, avg_heart_rate, notes,
      source, external_id, calories_source, calories_confidence,
      dedupe_fingerprint, started_at, ended_at,
      status, created_at, updated_at, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      row.id,
      row.user_id,
      row.activity_date,
      row.activity_type,
      row.activity_name,
      row.duration_minutes,
      normalizeIntensity(row.intensity),
      row.distance_value ?? null,
      normalizeDistanceUnit(row.distance_unit),
      row.elevation_gain ?? null,
      resolvedKcal,
      row.avg_heart_rate ?? null,
      row.notes ?? null,
      row.source ?? 'manual',
      externalIdStr,
      resolvedCaloriesSource,
      resolvedCaloriesConfidence,
      fpStr ?? row.dedupe_fingerprint ?? null,
      row.started_at ?? null,
      row.ended_at ?? null,
      normalizeStatus(row.status),
      row.created_at ?? new Date().toISOString(),
      row.updated_at ?? new Date().toISOString(),
    ],
  );

  // Wearables v1.1: detect a candidate workout link for newly-synced
  // wearable activities (Whoop / HealthKit pushed via Supabase). Manual
  // rows skip this — they were entered explicitly so there's nothing to
  // disambiguate.
  if (row.source && row.source !== 'manual' && insertResult.lastInsertRowId) {
    reconcileMatchForImportedActivity({
      userId: row.user_id,
      activityLogId: insertResult.lastInsertRowId as number,
      activityDate: row.activity_date,
      activityType: row.activity_type,
    }).catch(() => {});
  }
  return true;
}

/**
 * Pull activity logs from Supabase into local SQLite for an explicit date range.
 * Used as an inline backfill from getActivityLogsForDateRange so activities that
 * exist remotely but never made it to local SQLite (e.g. after a reinstall, or
 * if the original local insert failed) still show up in the UI.
 */
async function syncActivityLogsFromSupabaseRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  if (!supabase) return 0;

  // Purge any local provider-sourced tombstones (`source != 'manual'` AND
  // `status = 'deleted'`) before pulling fresh data. These can only exist as
  // legacy state from a previous client/server version that imported remote
  // soft-deletes — they have no business in local SQLite anymore now that
  // disconnect / `workout.deleted` are hard-deletes. Manual entries are
  // skipped because their soft-delete state is part of the offline-sync
  // protocol (see `deleteActivityLog`).
  try {
    const db = getDatabase();
    const purge = await db.runAsync(
      `DELETE FROM activity_logs
        WHERE user_id = ?
          AND status = 'deleted'
          AND source IS NOT NULL
          AND source != 'manual'`,
      [userId],
    );
    if (purge.changes && purge.changes > 0) {
      glowLogger.info('Purged stale provider tombstones from local activity_logs', {
        user_id: userId,
        purged_count: purge.changes,
      });
    }
  } catch (e) {
    glowLogger.warn('Failed to purge stale provider tombstones', {
      error: e instanceof Error ? e.message : String(e),
      user_id: userId,
    });
  }

  // CRITICAL: skip tombstoned rows (`status='deleted'`). Without this filter,
  // legacy soft-deleted rows on Supabase (e.g. left over from older versions
  // of the Whoop disconnect / `workout.deleted` webhook that used to flip
  // status instead of hard-deleting) get re-imported into local SQLite with
  // `status='deleted'` and the UI filter (`status != 'deleted'`) then hides
  // them — so connecting Whoop appears to "do nothing" in Recent Workouts.
  // Active rows are the only thing that should ever land in local from a
  // remote sync.
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('activity_date', startDate)
    .lte('activity_date', endDate)
    .neq('status', 'deleted')
    .order('activity_date', { ascending: true });

  if (error || !data) {
    glowLogger.warn('Failed to fetch activity logs from Supabase for range', {
      error: error?.message,
      user_id: userId,
      start_date: startDate,
      end_date: endDate,
    });
    return 0;
  }

  let syncedCount = 0;
  let failedCount = 0;

  for (const row of data) {
    try {
      const inserted = await upsertActivityLogRowFromSupabase(row);
      if (inserted) syncedCount++;
    } catch (e) {
      failedCount++;
      glowLogger.error('Failed to insert remote activity log into local SQLite', {
        error: e instanceof Error ? e.message : String(e),
        supabase_id: row?.id,
        user_id: row?.user_id,
        activity_date: row?.activity_date,
        activity_type: row?.activity_type,
        intensity: row?.intensity,
        distance_unit: row?.distance_unit,
        status: row?.status,
      });
    }
  }

  if (syncedCount > 0 || failedCount > 0) {
    glowLogger.info('Synced activity logs from Supabase range to local', {
      user_id: userId,
      start_date: startDate,
      end_date: endDate,
      synced_count: syncedCount,
      failed_count: failedCount,
      total_remote: data.length,
    });
  }

  return syncedCount;
}

/**
 * Pull activity logs from Supabase into local SQLite (restore / sign-in flow).
 * Fetches the last 365 days so historical activities aren't lost across long
 * absences; inserts any rows not already present locally.
 */
export const syncActivityLogsFromSupabase = async (userId: string): Promise<number> => {
  if (!supabase) return 0;

  try {
    const now = new Date();
    const startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
    const endDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    return await syncActivityLogsFromSupabaseRange(userId, startDateStr, endDateStr);
  } catch (error) {
    glowLogger.error('Error syncing activity logs from Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return 0;
  }
};

/**
 * Best-effort fetch of the user's latest body weight (kg) for MET estimates.
 * Falls back to undefined if no body_composition_log row exists yet. Keeping
 * this local-only avoids another Supabase round-trip in the hot log path.
 */
export const getLatestUserWeightKg = async (userId: string): Promise<number | undefined> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ weight_value: number; weight_unit: string }>(
      `SELECT weight_value, weight_unit FROM body_composition_log
        WHERE user_id = ?
        ORDER BY log_date DESC LIMIT 1`,
      [userId],
    );
    if (!row) return undefined;
    if (row.weight_unit === 'lbs') return Math.round(row.weight_value * 0.453592 * 10) / 10;
    return row.weight_value;
  } catch {
    return undefined;
  }
};

/**
 * Import an activity that originated from an external provider.
 *
 * Differences vs. `createActivityLog`:
 *   - Dedupes on `(user_id, source, external_id)` before inserting.
 *   - Does not trigger MET fallback when the caller already supplied a
 *     provider-sourced kcal value; the edge function normalizer handles
 *     provider-vs-MET reconciliation via `reconcileProviderCalories`.
 */
export const importExternalActivityLog = async (
  log: Omit<ActivityLog, 'id' | 'supabaseId' | 'synced' | 'createdAt' | 'updatedAt'> & {
    source: Exclude<ActivityLog['source'], undefined>;
    externalId: string;
  },
): Promise<{ inserted: boolean; localId?: number }> => {
  try {
    const db = getDatabase();

    const extKey = String(log.externalId);
    const existing = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM activity_logs WHERE user_id = ? AND source = ? AND external_id = ?',
      [log.userId, log.source, extKey],
    );
    if (existing) return { inserted: false, localId: existing.id };

    const created = await createActivityLog(log);
    if (!created?.id) return { inserted: !!created, localId: created?.id };

    // Wearables v1.3: some providers (notably Whoop via HealthKit) occasionally
    // split a single strength session into two adjacent imports. Fold this piece
    // into a same-type sibling that's within the gap window instead of leaving
    // two rows. Applies to any provider source. When merged, the incoming row is
    // tombstoned (so re-syncs still dedupe it) and no separate link is parked.
    const mergedInto = await tryMergeStrengthSplit(created);
    if (mergedInto != null) {
      return { inserted: false, localId: mergedInto };
    }

    // Wearables v1.1: when an imported activity lands on a date that already
    // has a workout_log, park a pending link the dashboard pill can resolve.
    // Best-effort; never blocks the import path.
    reconcileMatchForImportedActivity({
      userId: log.userId,
      activityLogId: created.id,
      activityDate: log.activityDate,
      activityType: log.activityType,
    }).catch(() => {});
    return { inserted: true, localId: created.id };
  } catch (error) {
    glowLogger.error('Failed to import external activity log', {
      error: error instanceof Error ? error.message : String(error),
      source: log.source,
      external_id: log.externalId,
    });
    return { inserted: false };
  }
};

/**
 * Two strength sessions this close (or overlapping) on the same day from the
 * same provider are treated as one session that the wearable split apart.
 */
const SPLIT_MERGE_GAP_MS = 20 * 60 * 1000;

const deriveStartMs = (startedAt: string | null | undefined): number | null => {
  if (!startedAt) return null;
  const ms = new Date(startedAt).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/** Prefer stored `ended_at`; fall back to start + duration when missing. */
const deriveEndMs = (
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
  durationMinutes: number,
): number | null => {
  if (endedAt) {
    const ms = new Date(endedAt).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  const startMs = deriveStartMs(startedAt);
  if (startMs == null || durationMinutes <= 0) return null;
  return startMs + durationMinutes * 60_000;
};

/** Duration-weighted mean of the two pieces' avg heart rates (whichever exist). */
const weightedAvgHr = (
  hrA: number | null,
  durA: number,
  hrB: number | null,
  durB: number,
): number | null => {
  const a = hrA != null && Number.isFinite(hrA) ? hrA : null;
  const b = hrB != null && Number.isFinite(hrB) ? hrB : null;
  if (a == null && b == null) return null;
  if (a == null) return Math.round(b as number);
  if (b == null) return Math.round(a);
  const wa = Math.max(0, durA);
  const wb = Math.max(0, durB);
  if (wa + wb === 0) return Math.round((a + b) / 2);
  return Math.round((a * wa + b * wb) / (wa + wb));
};

/**
 * Fold a freshly-imported strength activity into an adjacent, same-type sibling
 * from the same provider when their time windows are within `SPLIT_MERGE_GAP_MS`
 * (overlap counts as zero gap). The earlier-starting span and later-ending span
 * become the survivor's window; duration is the full span (start→end), while
 * calories/distance are summed and heart rate is duration-weighted. The incoming
 * row is soft-deleted (kept as a tombstone so re-syncs still dedupe its
 * external_id) and the survivor's pending review link is refreshed.
 *
 * Returns the survivor's local id when a merge happened, otherwise null so the
 * caller proceeds with the normal single-row import.
 */
const tryMergeStrengthSplit = async (created: ActivityLog): Promise<number | null> => {
  try {
    if (!created.id || !created.startedAt) return null;
    if (!created.source || created.source === 'manual') return null;
    if (!isStrengthStyleActivityType(created.activityType)) return null;

    const ns = deriveStartMs(created.startedAt);
    const ne = deriveEndMs(created.startedAt, created.endedAt, created.durationMinutes);
    if (ns == null || ne == null) return null;

    const db = getDatabase();
    const siblings = await db.getAllAsync<{
      id: number;
      supabase_id: number | null;
      started_at: string;
      ended_at: string | null;
      duration_minutes: number;
      calories_burned: number | null;
      distance_value: number | null;
      avg_heart_rate: number | null;
    }>(
      `SELECT id, supabase_id, started_at, ended_at, duration_minutes,
              calories_burned, distance_value, avg_heart_rate
         FROM activity_logs
        WHERE user_id = ? AND source = ? AND activity_type = ?
          AND activity_date = ? AND status != 'deleted'
          AND started_at IS NOT NULL
          AND id != ?`,
      [created.userId, created.source, created.activityType, created.activityDate, created.id],
    );
    if (siblings.length === 0) return null;

    let best: (typeof siblings)[number] | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const sib of siblings) {
      const ss = deriveStartMs(sib.started_at);
      const se = deriveEndMs(sib.started_at, sib.ended_at, sib.duration_minutes);
      if (ss == null || se == null) continue;
      const gap = Math.max(ns, ss) - Math.min(ne, se);
      glowLogger.info('Split-merge gap check', {
        incoming_id: created.id,
        sibling_id: sib.id,
        gap_minutes: Math.round(gap / 60_000),
        within_window: gap <= SPLIT_MERGE_GAP_MS,
        activity_type: created.activityType,
      });
      if (gap <= SPLIT_MERGE_GAP_MS && gap < bestGap) {
        best = sib;
        bestGap = gap;
      }
    }
    if (!best) return null;

    const ss = deriveStartMs(best.started_at)!;
    const se = deriveEndMs(best.started_at, best.ended_at, best.duration_minutes)!;
    const mergedStart = new Date(Math.min(ns, ss)).toISOString();
    const mergedEnd = new Date(Math.max(ne, se)).toISOString();
    const mergedDuration = Math.max(1, Math.round((Math.max(ne, se) - Math.min(ns, ss)) / 60000));
    const mergedKcal = (best.calories_burned ?? 0) + (created.caloriesBurned ?? 0) || null;
    const sibDist = best.distance_value;
    const newDist = created.distanceValue ?? null;
    const mergedDist =
      sibDist != null && newDist != null ? sibDist + newDist : (sibDist ?? newDist ?? null);
    const mergedHr = weightedAvgHr(
      best.avg_heart_rate,
      best.duration_minutes,
      created.avgHeartRate ?? null,
      created.durationMinutes,
    );

    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE activity_logs
          SET started_at = ?, ended_at = ?, duration_minutes = ?,
              calories_burned = ?, distance_value = ?, avg_heart_rate = ?,
              updated_at = ?, synced = 0
        WHERE id = ?`,
      [mergedStart, mergedEnd, mergedDuration, mergedKcal, mergedDist, mergedHr, now, best.id],
    );

    // The retry path only re-inserts NEW rows; rows that already have a
    // supabase_id are flipped to synced=1 without pushing edits. Push the
    // survivor's updated fields explicitly so the merge reaches Supabase.
    if (supabase && best.supabase_id) {
      try {
        const { error } = await supabase
          .from('activity_logs')
          .update({
            started_at: mergedStart,
            ended_at: mergedEnd,
            duration_minutes: mergedDuration,
            calories_burned: mergedKcal,
            distance_value: mergedDist,
            avg_heart_rate: mergedHr,
            updated_at: now,
          })
          .eq('id', best.supabase_id)
          .eq('user_id', created.userId);
        if (!error) {
          await db.runAsync('UPDATE activity_logs SET synced = 1 WHERE id = ?', [best.id]);
        } else {
          glowLogger.warn('Failed to push merged activity update to Supabase', {
            error: error.message,
          });
        }
      } catch (e) {
        glowLogger.warn('Supabase merged activity update error', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Remove the duplicate piece (local soft-delete + Supabase delete) so it
    // can't double-count. The tombstone keeps its external_id for dedupe.
    await deleteActivityLog(created.userId, created.id);

    // The survivor's auto-link kcal may now deviate differently from the
    // workout estimate; refresh it while it's still awaiting user review.
    await refreshUnacknowledgedLinkCalories(best.id);

    glowLogger.info('Merged split strength session', {
      survivor_id: best.id,
      absorbed_id: created.id,
      source: created.source,
      activity_type: created.activityType,
      gap_minutes: Math.round(bestGap / 60000),
      merged_duration: mergedDuration,
    });
    return best.id;
  } catch (e) {
    glowLogger.warn('tryMergeStrengthSplit failed', {
      error: e instanceof Error ? e.message : String(e),
      activity_log_id: created.id,
    });
    return null;
  }
};

/**
 * Retry pushing unsynced activity logs to Supabase.
 */
export const retryPendingActivityLogs = async (): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> => {
  if (!supabase) return { total: 0, succeeded: 0, failed: 0 };

  try {
    const db = getDatabase();
    const pending = await db.getAllAsync<any>(
      `SELECT * FROM activity_logs WHERE synced = 0 AND status != 'deleted'`,
    );

    let succeeded = 0;
    let failed = 0;

    for (const row of pending) {
      try {
        // If supabase_id already set (previous sync inserted but failed to mark synced), just mark synced
        if (row.supabase_id) {
          await db.runAsync(
            `UPDATE activity_logs SET synced = 1 WHERE id = ?`,
            [row.id],
          );
          succeeded++;
          continue;
        }

        const { data, error } = await supabase
          .from('activity_logs')
          .insert({
            user_id: row.user_id,
            activity_date: row.activity_date,
            activity_type: row.activity_type,
            activity_name: row.activity_name,
            duration_minutes: row.duration_minutes,
            intensity: row.intensity,
            distance_value: row.distance_value ?? null,
            distance_unit: row.distance_unit ?? null,
            elevation_gain: row.elevation_gain ?? null,
            calories_burned: row.calories_burned ?? null,
            avg_heart_rate: row.avg_heart_rate ?? null,
            notes: row.notes ?? null,
            source: row.source ?? 'manual',
            external_id: row.external_id ?? null,
            calories_source: row.calories_source ?? 'manual',
            calories_confidence: row.calories_confidence ?? 'medium',
            dedupe_fingerprint: row.dedupe_fingerprint ?? null,
            started_at: row.started_at ?? null,
            ended_at: row.ended_at ?? null,
            created_at: row.created_at,
          })
          .select('id')
          .single();

        if (error) {
          failed++;
          continue;
        }

        if (data?.id) {
          await db.runAsync(
            `UPDATE activity_logs SET supabase_id = ?, synced = 1 WHERE id = ?`,
            [data.id, row.id],
          );
          succeeded++;
        }
      } catch {
        failed++;
      }
    }

    if (pending.length > 0) {
      glowLogger.info('Retry pending activity logs completed', {
        total: pending.length,
        succeeded,
        failed,
      });
    }

    return { total: pending.length, succeeded, failed };
  } catch (error) {
    glowLogger.error('Error retrying pending activity logs', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { total: 0, succeeded: 0, failed: 0 };
  }
};

// -- Internal helpers --

function mapRowToActivityLog(row: any): ActivityLog {
  return {
    id: row.id,
    supabaseId: row.supabase_id ?? undefined,
    userId: row.user_id,
    activityDate: row.activity_date,
    activityType: row.activity_type,
    activityName: row.activity_name,
    durationMinutes: row.duration_minutes,
    intensity: row.intensity as ActivityIntensity,
    distanceValue: row.distance_value ?? undefined,
    distanceUnit: row.distance_unit ?? undefined,
    elevationGain: row.elevation_gain ?? undefined,
    caloriesBurned: row.calories_burned ?? undefined,
    avgHeartRate: row.avg_heart_rate ?? undefined,
    notes: row.notes ?? undefined,
    synced: row.synced === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source ?? 'manual',
    externalId: row.external_id ?? undefined,
    caloriesSource: row.calories_source ?? undefined,
    caloriesConfidence: row.calories_confidence ?? undefined,
    dedupeFingerprint: row.dedupe_fingerprint ?? undefined,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
  };
}

async function syncActivityLogToSupabase(
  localId: number,
  log: Omit<ActivityLog, 'id' | 'supabaseId' | 'synced' | 'createdAt' | 'updatedAt'>,
  createdAt: string
) {
  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from('activity_logs')
      .insert({
        user_id: log.userId,
        activity_date: log.activityDate,
        activity_type: log.activityType,
        activity_name: log.activityName,
        duration_minutes: log.durationMinutes,
        intensity: log.intensity,
        distance_value: log.distanceValue ?? null,
        distance_unit: log.distanceUnit ?? null,
        elevation_gain: log.elevationGain ?? null,
        calories_burned: log.caloriesBurned ?? null,
        avg_heart_rate: log.avgHeartRate ?? null,
        notes: log.notes ?? null,
        source: log.source ?? 'manual',
        external_id: log.externalId ?? null,
        calories_source: log.caloriesSource ?? 'manual',
        calories_confidence: log.caloriesConfidence ?? 'medium',
        dedupe_fingerprint: log.dedupeFingerprint ?? null,
        started_at: log.startedAt ?? null,
        ended_at: log.endedAt ?? null,
        created_at: createdAt,
      })
      .select('id')
      .single();

    if (error) {
      glowLogger.warn('Supabase activity log sync failed', { error: error.message });
      return;
    }

    if (data?.id) {
      const db = getDatabase();
      await db.runAsync(
        `UPDATE activity_logs SET supabase_id = ?, synced = 1 WHERE id = ?`,
        [data.id, localId]
      );
      glowLogger.info('Activity log synced to Supabase', {
        local_id: localId,
        supabase_id: data.id,
      });
    }
  } catch (error) {
    glowLogger.warn('Supabase activity log sync error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
