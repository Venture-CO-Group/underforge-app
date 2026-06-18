/**
 * Activity ↔ workout link resolver.
 *
 * When a wearable reports a workout on the same calendar day as a
 * `workout_log`, strength-style imports are auto-merged (`linked`) with
 * `review_acknowledged = 0` so calories use the linked blend immediately;
 * the dashboard pill is a review step (confirm or separate). Legacy rows
 * may still be `pending` until resolved.
 *
 *   pending  → legacy / awaiting user (treated like unconfirmed for review UI)
 *   linked   → same session as the workout_log (count once in blends)
 *   separated → genuinely different sessions
 *
 * Cardio-style imports are auto-marked `separated` so we do not prompt
 * when a run lands on the same day as a lift.
 */

import { createClient } from '@supabase/supabase-js';
import { ActivityCategory, getActivityTypeById } from '../types/workout';
import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import { updateWorkoutDate } from './workout-storage';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
let supabase: any = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export type LinkState = 'pending' | 'linked' | 'separated';
/**
 * How the linked pair's kcal is merged in `sumLinkedBlendedKcal`:
 *   wearable        → use the activity_logs.calories_burned (wearable side)
 *   uf              → use the workout_logs strength estimate (UF side)
 *   average         → average of both sides (legacy behaviour, default)
 *   pending_review  → deviation > threshold, surface in the review pill;
 *                     defaults to average until the user resolves it
 */
export type CaloriesResolution = 'wearable' | 'uf' | 'average' | 'pending_review';

/** kcal deviation above this threshold marks the pair as `pending_review`. */
export const LINK_CALORIES_DEVIATION_THRESHOLD = 0.2;

export interface ActivityWorkoutLink {
  id: number;
  supabaseId?: number;
  userId: string;
  activityLogId: number;
  workoutLogId: number;
  linkState: LinkState;
  /** 0 = show review pill for auto-linked matches; 1 = user dismissed or legacy confirmed. */
  reviewAcknowledged: boolean;
  caloriesResolution: CaloriesResolution;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}

export interface PendingLinkRow extends ActivityWorkoutLink {
  // Hydrated for the pill UI.
  activityName: string;
  activitySource: string;
  /** UF (workout_logs) and wearable (activity_logs) kcal estimates. */
  activityKcal: number;
  workoutKcal: number;
  activityDurationMinutes: number;
  activityIntensity: string | null;
  activityDate: string;
  activityStartedAt: string | null;
  workoutDayName: string;
}

/**
 * Categories we treat as strength-style for the auto-prompt rule. Acts as
 * the fallback when a wearable activity-type doesn't carry an explicit
 * `strengthLike` flag.
 */
const STRENGTH_CATEGORIES: ReadonlySet<ActivityCategory> = new Set<ActivityCategory>([
  'gym_cardio',
  'other',
]);

/**
 * Raw activity-type strings emitted by each wearable provider that should
 * unconditionally auto-link with a same-day strength workout_log. Kept here
 * (instead of in the provider files) so all the matching logic lives next
 * to the link table.
 *
 * Validation: `scripts/audit-link-categories.ts` groups the last 90 days of
 * activity_logs by `(source, activity_type, category)` so we can confirm
 * coverage on real data before iterating.
 */
const WEARABLE_STRENGTH_TYPES: ReadonlySet<string> = new Set<string>([
  // HealthKit
  'traditionalstrengthtraining',
  'functionalstrengthtraining',
  'crosstraining',
  // Health Connect
  'strength_training',
  'weightlifting',
  'calisthenics',
  'boot_camp',
  // Whoop
  'powerlifting',
  'crossfit',
  'functional fitness',
]);

export function isStrengthStyleActivityType(activityType: string): boolean {
  const def = getActivityTypeById(activityType);
  if (def?.strengthLike) return true;
  if (WEARABLE_STRENGTH_TYPES.has(String(activityType).toLowerCase())) return true;
  if (!def) return true; // unknown → treat as strength so the user can confirm
  return STRENGTH_CATEGORIES.has(def.category);
}

const shiftYmdByDays = (ymd: string, deltaDays: number): string => {
  const parsed = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return ymd;
  parsed.setDate(parsed.getDate() + deltaDays);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
};

const daysBetweenYmd = (a: string, b: string): number => {
  const da = new Date(`${a}T12:00:00`).getTime();
  const db = new Date(`${b}T12:00:00`).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((da - db) / 86_400_000));
};

async function getWorkoutKcal(workoutLogId: number): Promise<number> {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ kcal: number | null }>(
      `SELECT COALESCE(SUM(calories_burned), 0) AS kcal
         FROM workout_exercise_logs WHERE workout_log_id = ?`,
      [workoutLogId],
    );
    return Math.max(0, Math.round(row?.kcal ?? 0));
  } catch {
    return 0;
  }
}

interface ActivityCandidate {
  id: number;
  activityType: string;
  activityDate: string;
  activityKcal: number;
  startedAt: string | null;
}

async function gatherActivityCandidatesForWorkout(
  userId: string,
  workoutLogId: number,
  activityDate: string,
  excludeActivityLogIds: ReadonlySet<number> = new Set(),
): Promise<ActivityCandidate[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    id: number;
    activity_type: string;
    activity_date: string;
    calories_burned: number | null;
    started_at: string | null;
    link_state: LinkState | null;
    linked_workout_id: number | null;
    review_acknowledged: number | null;
  }>(
    `SELECT al.id, al.activity_type, al.activity_date, al.calories_burned, al.started_at,
            awl.link_state, awl.workout_log_id AS linked_workout_id,
            awl.review_acknowledged
       FROM activity_logs al
       LEFT JOIN activity_workout_links awl
         ON awl.activity_log_id = al.id AND awl.user_id = al.user_id
      WHERE al.user_id = ?
        AND al.activity_date = ?
        AND al.status != 'deleted'
        AND al.source != 'manual'`,
    [userId, activityDate],
  );

  const candidates: ActivityCandidate[] = [];
  for (const row of rows) {
    if (excludeActivityLogIds.has(row.id)) continue;
    if (!isStrengthStyleActivityType(row.activity_type)) continue;
    if (row.link_state === 'separated' && row.linked_workout_id === workoutLogId) continue;
    if (
      row.link_state === 'linked'
      && row.linked_workout_id != null
      && row.linked_workout_id !== workoutLogId
    ) {
      continue;
    }
    candidates.push({
      id: row.id,
      activityType: row.activity_type,
      activityDate: row.activity_date,
      activityKcal: Math.max(0, Math.round(row.calories_burned ?? 0)),
      startedAt: row.started_at,
    });
  }
  return candidates;
}

const pickBestActivityCandidate = (
  candidates: ActivityCandidate[],
  workoutKcal: number,
): ActivityCandidate | null => {
  if (candidates.length === 0) return null;
  let best: ActivityCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    let score: number;
    if (workoutKcal > 0 && candidate.activityKcal > 0) {
      score = Math.abs(candidate.activityKcal - workoutKcal);
    } else if (candidate.startedAt) {
      score = new Date(candidate.startedAt).getTime();
    } else {
      score = Number.MAX_SAFE_INTEGER;
    }
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
};

async function upsertLinkedRow(params: {
  userId: string;
  activityLogId: number;
  workoutLogId: number;
  linkState: LinkState;
  reviewAcknowledged: number;
  caloriesResolution: CaloriesResolution;
}): Promise<ActivityWorkoutLink | null> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM activity_workout_links
      WHERE user_id = ? AND activity_log_id = ?`,
    [params.userId, params.activityLogId],
  );
  if (existing) {
    await db.runAsync(
      `UPDATE activity_workout_links
          SET workout_log_id = ?, link_state = ?, review_acknowledged = ?,
              calories_resolution = ?, updated_at = ?, synced = 0
        WHERE id = ?`,
      [
        params.workoutLogId,
        params.linkState,
        params.reviewAcknowledged,
        params.caloriesResolution,
        now,
        existing.id,
      ],
    );
    const row = await getLinkById(existing.id);
    if (row && supabase) void pushLinkToSupabase(row);
    return row;
  }
  const result = await db.runAsync(
    `INSERT INTO activity_workout_links
       (user_id, activity_log_id, workout_log_id, link_state, review_acknowledged, calories_resolution, created_at, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      params.userId,
      params.activityLogId,
      params.workoutLogId,
      params.linkState,
      params.reviewAcknowledged,
      params.caloriesResolution,
      now,
      now,
    ],
  );
  const row = await getLinkById(result.lastInsertRowId as number);
  if (row && supabase) void pushLinkToSupabase(row);
  return row;
}

async function separatePendingLinksForWorkoutExcept(
  userId: string,
  workoutLogId: number,
  keepActivityLogId: number,
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const rows = await db.getAllAsync<{ id: number }>(
    `SELECT id FROM activity_workout_links
      WHERE user_id = ? AND workout_log_id = ?
        AND activity_log_id != ?
        AND (
          link_state = 'pending'
          OR (link_state = 'linked' AND IFNULL(review_acknowledged, 1) = 0)
          OR IFNULL(calories_resolution, 'average') = 'pending_review'
        )`,
    [userId, workoutLogId, keepActivityLogId],
  );
  for (const row of rows) {
    await db.runAsync(
      `UPDATE activity_workout_links
          SET link_state = 'separated', review_acknowledged = 1,
              calories_resolution = 'average', updated_at = ?, synced = 0
        WHERE id = ?`,
      [now, row.id],
    );
    const updated = await getLinkById(row.id);
    if (updated && supabase) void pushLinkToSupabase(updated);
  }
}

async function alignWorkoutDateIfCrossDay(
  workoutLogId: number,
  workoutDate: string,
  activityDate: string,
): Promise<void> {
  if (workoutDate === activityDate) return;
  if (daysBetweenYmd(workoutDate, activityDate) > 1) return;
  await updateWorkoutDate(workoutLogId, activityDate);
}

/**
 * Pick the single best wearable activity for a UF workout on the given
 * activity date, create/update the link, and drop other pending candidates.
 */
export const reconcileWorkoutMatch = async (
  userId: string,
  workoutLogId: number,
  activityDate: string,
  excludeActivityLogIds: ReadonlySet<number> = new Set(),
): Promise<ActivityWorkoutLink | null> => {
  try {
    const db = getDatabase();
    const workout = await db.getFirstAsync<{ workout_date: string }>(
      `SELECT workout_date FROM workout_logs
        WHERE id = ? AND user_id = ? AND status != 'deleted'`,
      [workoutLogId, userId],
    );
    if (!workout) return null;

    const workoutKcal = await getWorkoutKcal(workoutLogId);
    const candidates = await gatherActivityCandidatesForWorkout(
      userId,
      workoutLogId,
      activityDate,
      excludeActivityLogIds,
    );
    const best = pickBestActivityCandidate(candidates, workoutKcal);
    if (!best) return null;

    const initialResolution = await computeInitialCaloriesResolution(best.id, workoutLogId);
    const row = await upsertLinkedRow({
      userId,
      activityLogId: best.id,
      workoutLogId,
      linkState: 'linked',
      reviewAcknowledged: 0,
      caloriesResolution: initialResolution,
    });
    await separatePendingLinksForWorkoutExcept(userId, workoutLogId, best.id);
    await alignWorkoutDateIfCrossDay(workoutLogId, workout.workout_date, best.activityDate);
    return row;
  } catch (error) {
    glowLogger.error('Failed to reconcile workout match', {
      error: error instanceof Error ? error.message : String(error),
      workout_log_id: workoutLogId,
    });
    return null;
  }
};

/**
 * Entry point when a wearable activity is imported. Finds the best UF workout
 * (same day or previous day) by kcal distance, then reconciles 1:1.
 */
export const reconcileMatchForImportedActivity = async (params: {
  userId: string;
  activityLogId: number;
  activityDate: string;
  activityType: string;
}): Promise<ActivityWorkoutLink | null> => {
  try {
    const db = getDatabase();
    const existing = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM activity_workout_links
        WHERE user_id = ? AND activity_log_id = ?`,
      [params.userId, params.activityLogId],
    );
    if (existing) return null;

    const strength = isStrengthStyleActivityType(params.activityType);
    const prevDate = shiftYmdByDays(params.activityDate, -1);
    const workoutDates = strength ? [params.activityDate, prevDate] : [params.activityDate];

    const workouts = await db.getAllAsync<{ id: number; workout_date: string }>(
      `SELECT id, workout_date FROM workout_logs
        WHERE user_id = ? AND workout_date IN (?, ?) AND status != 'deleted'
        ORDER BY created_at DESC`,
      [params.userId, workoutDates[0], workoutDates[1] ?? workoutDates[0]],
    );
    if (workouts.length === 0) return null;

    if (!strength) {
      const candidate = workouts[0];
      return upsertLinkedRow({
        userId: params.userId,
        activityLogId: params.activityLogId,
        workoutLogId: candidate.id,
        linkState: 'separated',
        reviewAcknowledged: 1,
        caloriesResolution: 'average',
      });
    }

    const activityKcalRow = await db.getFirstAsync<{ kcal: number | null }>(
      `SELECT calories_burned AS kcal FROM activity_logs WHERE id = ?`,
      [params.activityLogId],
    );
    const activityKcal = Math.max(0, Math.round(activityKcalRow?.kcal ?? 0));

    let bestWorkout: (typeof workouts)[number] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const workout of workouts) {
      const workoutKcal = await getWorkoutKcal(workout.id);
      const score =
        activityKcal > 0 && workoutKcal > 0
          ? Math.abs(activityKcal - workoutKcal)
          : workoutKcal;
      if (score < bestScore) {
        bestWorkout = workout;
        bestScore = score;
      }
    }
    if (!bestWorkout) return null;

    return reconcileWorkoutMatch(params.userId, bestWorkout.id, params.activityDate);
  } catch (error) {
    glowLogger.error('Failed to reconcile imported activity match', {
      error: error instanceof Error ? error.message : String(error),
      activity_log_id: params.activityLogId,
    });
    return null;
  }
};

/**
 * @deprecated Use `reconcileMatchForImportedActivity` instead.
 */
export const detectPendingLinkForActivity = async (params: {
  userId: string;
  activityLogId: number;
  activityDate: string;
  activityType: string;
}): Promise<ActivityWorkoutLink | null> => reconcileMatchForImportedActivity(params);

/** Read a link row by local id. */
export const getLinkById = async (id: number): Promise<ActivityWorkoutLink | null> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{
      id: number;
      supabase_id: number | null;
      user_id: string;
      activity_log_id: number;
      workout_log_id: number;
      link_state: LinkState;
      review_acknowledged: number | null;
      calories_resolution: CaloriesResolution | null;
      created_at: string;
      updated_at: string;
      synced: number;
    }>(
      `SELECT * FROM activity_workout_links WHERE id = ?`,
      [id],
    );
    if (!row) return null;
    return {
      id: row.id,
      supabaseId: row.supabase_id ?? undefined,
      userId: row.user_id,
      activityLogId: row.activity_log_id,
      workoutLogId: row.workout_log_id,
      linkState: row.link_state,
      reviewAcknowledged: (row.review_acknowledged ?? 1) === 1,
      caloriesResolution: row.calories_resolution ?? 'average',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      synced: row.synced === 1,
    };
  } catch {
    return null;
  }
};

/**
 * Read link rows that still need user review: legacy `pending`, or
 * auto-merged `linked` with `review_acknowledged = 0`.
 */
export const getPendingLinksForUser = async (
  userId: string,
  maxDaysBack = 14,
): Promise<PendingLinkRow[]> => {
  try {
    const db = getDatabase();
    const now = new Date();
    const earliest = new Date(now);
    earliest.setDate(now.getDate() - Math.max(0, maxDaysBack - 1));
    const earliestYmd = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, '0')}-${String(earliest.getDate()).padStart(2, '0')}`;
    const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const rows = await db.getAllAsync<{
      id: number;
      supabase_id: number | null;
      user_id: string;
      activity_log_id: number;
      workout_log_id: number;
      link_state: LinkState;
      review_acknowledged: number | null;
      calories_resolution: CaloriesResolution | null;
      created_at: string;
      updated_at: string;
      synced: number;
      activity_name: string;
      activity_source: string | null;
      activity_kcal: number | null;
      workout_kcal: number | null;
      duration_minutes: number;
      intensity: string | null;
      activity_date: string;
      started_at: string | null;
      workout_day_name: string;
    }>(
      `SELECT awl.id, awl.supabase_id, awl.user_id, awl.activity_log_id,
              awl.workout_log_id, awl.link_state, awl.review_acknowledged,
              awl.calories_resolution, awl.created_at, awl.updated_at,
              awl.synced,
              al.activity_name, al.source AS activity_source,
              al.calories_burned AS activity_kcal,
              (
                SELECT COALESCE(SUM(wel.calories_burned), 0)
                  FROM workout_exercise_logs wel
                 WHERE wel.workout_log_id = awl.workout_log_id
              ) AS workout_kcal,
              al.duration_minutes, al.intensity, al.activity_date, al.started_at,
              wl.workout_day_name
         FROM activity_workout_links awl
         INNER JOIN activity_logs al ON al.id = awl.activity_log_id
         INNER JOIN workout_logs wl ON wl.id = awl.workout_log_id
         WHERE awl.user_id = ?
           AND (
             awl.link_state = 'pending'
             OR (awl.link_state = 'linked' AND IFNULL(awl.review_acknowledged, 1) = 0)
             OR IFNULL(awl.calories_resolution, 'average') = 'pending_review'
           )
           AND al.activity_date >= ? AND al.activity_date <= ?
           AND al.status != 'deleted' AND wl.status != 'deleted'
         ORDER BY awl.created_at DESC`,
      [userId, earliestYmd, todayYmd],
    );
    return rows.map((row) => ({
      id: row.id,
      supabaseId: row.supabase_id ?? undefined,
      userId: row.user_id,
      activityLogId: row.activity_log_id,
      workoutLogId: row.workout_log_id,
      linkState: row.link_state,
      reviewAcknowledged: (row.review_acknowledged ?? 1) === 1,
      caloriesResolution: row.calories_resolution ?? 'average',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      synced: row.synced === 1,
      activityName: row.activity_name,
      activitySource: row.activity_source ?? 'manual',
      activityKcal: Math.max(0, Math.round(row.activity_kcal ?? 0)),
      workoutKcal: Math.max(0, Math.round(row.workout_kcal ?? 0)),
      activityDurationMinutes: row.duration_minutes,
      activityIntensity: row.intensity,
      activityDate: row.activity_date,
      activityStartedAt: row.started_at,
      workoutDayName: row.workout_day_name,
    }));
  } catch (error) {
    glowLogger.error('Failed to read pending links', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

/** Pending link for a single activity, hydrated for the review modal. */
export const getPendingLinkForActivity = async (
  activityLogId: number,
): Promise<PendingLinkRow | null> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{
      id: number;
      supabase_id: number | null;
      user_id: string;
      activity_log_id: number;
      workout_log_id: number;
      link_state: LinkState;
      review_acknowledged: number | null;
      calories_resolution: CaloriesResolution | null;
      created_at: string;
      updated_at: string;
      synced: number;
      activity_name: string;
      activity_source: string | null;
      activity_kcal: number | null;
      workout_kcal: number | null;
      duration_minutes: number;
      intensity: string | null;
      activity_date: string;
      started_at: string | null;
      workout_day_name: string;
    }>(
      `SELECT awl.id, awl.supabase_id, awl.user_id, awl.activity_log_id,
              awl.workout_log_id, awl.link_state, awl.review_acknowledged,
              awl.calories_resolution, awl.created_at, awl.updated_at,
              awl.synced,
              al.activity_name, al.source AS activity_source,
              al.calories_burned AS activity_kcal,
              (
                SELECT COALESCE(SUM(wel.calories_burned), 0)
                  FROM workout_exercise_logs wel
                 WHERE wel.workout_log_id = awl.workout_log_id
              ) AS workout_kcal,
              al.duration_minutes, al.intensity, al.activity_date, al.started_at,
              wl.workout_day_name
         FROM activity_workout_links awl
         INNER JOIN activity_logs al ON al.id = awl.activity_log_id
         INNER JOIN workout_logs wl ON wl.id = awl.workout_log_id
         WHERE awl.activity_log_id = ?
           AND (
             awl.link_state = 'pending'
             OR (awl.link_state = 'linked' AND IFNULL(awl.review_acknowledged, 1) = 0)
             OR IFNULL(awl.calories_resolution, 'average') = 'pending_review'
           )
           AND al.status != 'deleted' AND wl.status != 'deleted'`,
      [activityLogId],
    );
    if (!row) return null;
    return {
      id: row.id,
      supabaseId: row.supabase_id ?? undefined,
      userId: row.user_id,
      activityLogId: row.activity_log_id,
      workoutLogId: row.workout_log_id,
      linkState: row.link_state,
      reviewAcknowledged: (row.review_acknowledged ?? 1) === 1,
      caloriesResolution: row.calories_resolution ?? 'average',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      synced: row.synced === 1,
      activityName: row.activity_name,
      activitySource: row.activity_source ?? 'manual',
      activityKcal: Math.max(0, Math.round(row.activity_kcal ?? 0)),
      workoutKcal: Math.max(0, Math.round(row.workout_kcal ?? 0)),
      activityDurationMinutes: row.duration_minutes,
      activityIntensity: row.intensity,
      activityDate: row.activity_date,
      activityStartedAt: row.started_at,
      workoutDayName: row.workout_day_name,
    };
  } catch {
    return null;
  }
};

export interface LinkedActivityWorkoutInfo {
  /** The workout_log's day name, for the "Linked to <day name>" caption. */
  workoutDayName: string;
  /**
   * True while the auto-linked match still needs the user's confirmation —
   * either the review hasn't been acknowledged or the kcal deviation is still
   * `pending_review`. Drives the "(pending confirmation)" caption suffix.
   */
  pendingReview: boolean;
}

/**
 * Activity id → linked workout info for activities linked to a workout_log
 * (`link_state = 'linked'`), including auto-linked matches awaiting review.
 * Used by Recent Activity to render the "Linked to <day name>" caption (with a
 * "(pending confirmation)" suffix until the user resolves the review pill).
 */
export const getLinkedActivityWorkoutInfo = async (
  userId: string,
  startDate: string,
  endDate: string,
): Promise<Map<number, LinkedActivityWorkoutInfo>> => {
  try {
    const db = getDatabase();
    const rows = await db.getAllAsync<{
      activity_log_id: number;
      workout_day_name: string;
      review_acknowledged: number | null;
      calories_resolution: string | null;
    }>(
      `SELECT awl.activity_log_id, wl.workout_day_name,
              awl.review_acknowledged, awl.calories_resolution
         FROM activity_workout_links awl
         INNER JOIN activity_logs al ON al.id = awl.activity_log_id
         INNER JOIN workout_logs wl ON wl.id = awl.workout_log_id
         WHERE awl.user_id = ?
           AND awl.link_state = 'linked'
           AND al.activity_date >= ? AND al.activity_date <= ?`,
      [userId, startDate, endDate],
    );
    const map = new Map<number, LinkedActivityWorkoutInfo>();
    for (const r of rows) {
      const pendingReview =
        (r.review_acknowledged ?? 1) === 0 || r.calories_resolution === 'pending_review';
      map.set(r.activity_log_id, { workoutDayName: r.workout_day_name, pendingReview });
    }
    return map;
  } catch {
    return new Map();
  }
};

/** Activity ids linked to a workout (`link_state = 'linked'`). */
export const getLinkedActivityIds = async (
  userId: string,
  startDate: string,
  endDate: string,
): Promise<Set<number>> => {
  try {
    const db = getDatabase();
    const rows = await db.getAllAsync<{ activity_log_id: number }>(
      `SELECT awl.activity_log_id
         FROM activity_workout_links awl
         INNER JOIN activity_logs al ON al.id = awl.activity_log_id
         WHERE awl.user_id = ?
           AND awl.link_state = 'linked'
           AND al.activity_date >= ? AND al.activity_date <= ?`,
      [userId, startDate, endDate],
    );
    return new Set(rows.map((r) => r.activity_log_id));
  } catch {
    return new Set();
  }
};

export interface LinkedPairRow {
  activityLogId: number;
  workoutLogId: number;
  activityKcal: number;
  workoutKcal: number;
  caloriesResolution: CaloriesResolution;
  /** YYYY-MM-DD of the underlying activity, used for daily aggregation. */
  date: string;
}

/**
 * Linked (activity, workout) pairs in `[startDate, endDate]` inclusive,
 * already hydrated with each side's stored kcal. Used by the burned-calories
 * card to average UF and wearable estimates per session instead of just
 * dropping the wearable activity from the Activities sum.
 *
 * Workout kcal is the sum of `workout_exercise_logs.calories_burned` for the
 * paired `workout_log_id`. Activity kcal is `activity_logs.calories_burned`.
 * Rows with neither side reporting kcal are returned with zeros so callers
 * can short-circuit cheaply.
 */
export const getLinkedPairsForRange = async (
  userId: string,
  startDate: string,
  endDate: string,
): Promise<LinkedPairRow[]> => {
  try {
    const db = getDatabase();
    const rows = await db.getAllAsync<{
      activity_log_id: number;
      workout_log_id: number;
      activity_kcal: number | null;
      workout_kcal: number | null;
      calories_resolution: CaloriesResolution | null;
      activity_date: string;
    }>(
      `SELECT awl.activity_log_id,
              awl.workout_log_id,
              al.calories_burned AS activity_kcal,
              (
                SELECT COALESCE(SUM(wel.calories_burned), 0)
                  FROM workout_exercise_logs wel
                 WHERE wel.workout_log_id = awl.workout_log_id
              ) AS workout_kcal,
              awl.calories_resolution,
              al.activity_date
         FROM activity_workout_links awl
         INNER JOIN activity_logs al ON al.id = awl.activity_log_id
         INNER JOIN workout_logs wl ON wl.id = awl.workout_log_id
         WHERE awl.user_id = ?
           AND awl.link_state = 'linked'
           AND al.activity_date >= ? AND al.activity_date <= ?
           AND al.status != 'deleted' AND wl.status != 'deleted'`,
      [userId, startDate, endDate],
    );
    return rows.map((row) => ({
      activityLogId: row.activity_log_id,
      workoutLogId: row.workout_log_id,
      activityKcal: Math.max(0, Math.round(row.activity_kcal ?? 0)),
      workoutKcal: Math.max(0, Math.round(row.workout_kcal ?? 0)),
      caloriesResolution: row.calories_resolution ?? 'average',
      date: row.activity_date,
    }));
  } catch (error) {
    glowLogger.warn('Failed to read linked activity/workout pairs', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

/**
 * Resolve from the review queue: confirm keeps `linked` and marks review
 * done, or mark `separated`. Always sets `review_acknowledged = 1`.
 */
export const resolveLink = async (
  linkId: number,
  newState: 'linked' | 'separated',
): Promise<ActivityWorkoutLink | null> => {
  try {
    const db = getDatabase();
    const before = await db.getFirstAsync<{
      user_id: string;
      activity_log_id: number;
      workout_log_id: number;
    }>(
      `SELECT user_id, activity_log_id, workout_log_id FROM activity_workout_links WHERE id = ?`,
      [linkId],
    );
    if (!before) return null;

    const activityDateRow = await db.getFirstAsync<{ activity_date: string }>(
      `SELECT activity_date FROM activity_logs WHERE id = ?`,
      [before.activity_log_id],
    );
    const activityDate = activityDateRow?.activity_date;

    if (newState === 'separated') {
      await db.runAsync(
        `UPDATE activity_workout_links
            SET link_state = ?, review_acknowledged = 1, calories_resolution = 'average',
                updated_at = ?, synced = 0
          WHERE id = ?`,
        [newState, new Date().toISOString(), linkId],
      );
    } else {
      await db.runAsync(
        `UPDATE activity_workout_links
            SET link_state = ?, review_acknowledged = 1, updated_at = ?, synced = 0
          WHERE id = ?`,
        [newState, new Date().toISOString(), linkId],
      );
      await separatePendingLinksForWorkoutExcept(
        before.user_id,
        before.workout_log_id,
        before.activity_log_id,
      );
    }

    const row = await getLinkById(linkId);
    if (row && supabase) void pushLinkToSupabase(row);

    if (newState === 'separated' && activityDate) {
      await reconcileWorkoutMatch(
        before.user_id,
        before.workout_log_id,
        activityDate,
        new Set([before.activity_log_id]),
      );
    }

    return row;
  } catch (error) {
    glowLogger.error('Failed to resolve workout link', {
      error: error instanceof Error ? error.message : String(error),
      link_id: linkId,
    });
    return null;
  }
};

/**
 * Update a linked pair's calorie resolution after the user picks one of the
 * three options in the review modal (Use wearable / Use UF / Average).
 */
export const setLinkCaloriesResolution = async (
  linkId: number,
  resolution: 'wearable' | 'uf' | 'average',
): Promise<ActivityWorkoutLink | null> => {
  try {
    const db = getDatabase();
    const before = await db.getFirstAsync<{
      user_id: string;
      activity_log_id: number;
      workout_log_id: number;
    }>(
      `SELECT user_id, activity_log_id, workout_log_id FROM activity_workout_links WHERE id = ?`,
      [linkId],
    );
    await db.runAsync(
      `UPDATE activity_workout_links
          SET calories_resolution = ?, review_acknowledged = 1, updated_at = ?, synced = 0
        WHERE id = ?`,
      [resolution, new Date().toISOString(), linkId],
    );
    if (before) {
      await separatePendingLinksForWorkoutExcept(
        before.user_id,
        before.workout_log_id,
        before.activity_log_id,
      );
    }
    const row = await getLinkById(linkId);
    if (row && supabase) void pushLinkToSupabase(row);
    return row;
  } catch (error) {
    glowLogger.error('Failed to set link calories resolution', {
      error: error instanceof Error ? error.message : String(error),
      link_id: linkId,
    });
    return null;
  }
};

/**
 * Recompute the calorie-deviation resolution for an activity's auto-link after
 * its kcal changed (e.g. two split wearable sessions were merged). Only touches
 * links that are still `linked` and unacknowledged — never overrides a user's
 * explicit choice or a `separated` decision. No-op when there's no such link.
 */
export const refreshUnacknowledgedLinkCalories = async (
  activityLogId: number,
): Promise<void> => {
  try {
    const db = getDatabase();
    const link = await db.getFirstAsync<{
      id: number;
      workout_log_id: number;
      calories_resolution: CaloriesResolution | null;
    }>(
      `SELECT id, workout_log_id, calories_resolution
         FROM activity_workout_links
        WHERE activity_log_id = ? AND link_state = 'linked'
          AND IFNULL(review_acknowledged, 1) = 0`,
      [activityLogId],
    );
    if (!link) return;
    const next = await computeInitialCaloriesResolution(activityLogId, link.workout_log_id);
    if (next === (link.calories_resolution ?? 'average')) return;
    await db.runAsync(
      `UPDATE activity_workout_links
          SET calories_resolution = ?, updated_at = ?, synced = 0
        WHERE id = ?`,
      [next, new Date().toISOString(), link.id],
    );
    const row = await getLinkById(link.id);
    if (row && supabase) void pushLinkToSupabase(row);
  } catch (error) {
    glowLogger.warn('Failed to refresh link calories after merge', {
      error: error instanceof Error ? error.message : String(error),
      activity_log_id: activityLogId,
    });
  }
};

/**
 * Compute the deviation between a freshly-created pair's UF + wearable kcal
 * estimates and pick the initial `calories_resolution`. Pairs whose sides
 * agree within `LINK_CALORIES_DEVIATION_THRESHOLD` auto-merge as `average`.
 * Otherwise the row lands as `pending_review`.
 */
async function computeInitialCaloriesResolution(
  activityLogId: number,
  workoutLogId: number,
): Promise<CaloriesResolution> {
  try {
    const db = getDatabase();
    const a = await db.getFirstAsync<{ kcal: number | null }>(
      `SELECT calories_burned AS kcal FROM activity_logs WHERE id = ?`,
      [activityLogId],
    );
    const w = await db.getFirstAsync<{ kcal: number | null }>(
      `SELECT COALESCE(SUM(calories_burned), 0) AS kcal
         FROM workout_exercise_logs WHERE workout_log_id = ?`,
      [workoutLogId],
    );
    const aKcal = Math.max(0, Math.round(a?.kcal ?? 0));
    const wKcal = Math.max(0, Math.round(w?.kcal ?? 0));
    if (aKcal === 0 || wKcal === 0) return 'average';
    const max = Math.max(aKcal, wKcal);
    const deviation = Math.abs(aKcal - wKcal) / max;
    return deviation > LINK_CALORIES_DEVIATION_THRESHOLD ? 'pending_review' : 'average';
  } catch {
    return 'average';
  }
}

async function pushLinkToSupabase(row: ActivityWorkoutLink): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('activity_workout_links')
      .upsert(
        {
          user_id: row.userId,
          activity_log_id: row.activityLogId,
          workout_log_id: row.workoutLogId,
          link_state: row.linkState,
          review_acknowledged: row.reviewAcknowledged,
          calories_resolution: row.caloriesResolution,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
        },
        { onConflict: 'user_id,activity_log_id' },
      );
    if (!error) {
      const db = getDatabase();
      await db.runAsync(
        `UPDATE activity_workout_links SET synced = 1 WHERE id = ?`,
        [row.id],
      );
    }
  } catch (error) {
    glowLogger.warn('Supabase activity_workout_links upsert failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
