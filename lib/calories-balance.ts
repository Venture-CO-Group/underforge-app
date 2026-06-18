/**
 * Pure read-side helpers for the calories balance card + breakdown modal.
 *
 * Always three buckets:
 *   - bmr — resting burn (wearable 7-day avg resting_energy_kcal or onboarding BMR)
 *   - sessions — strength workout_logs + activity_logs + linked blends (merged)
 *   - daily_movement — steps NEAT when available; else active_energy residual;
 *     target floors on 30-day avg or onboarding occupation NEAT when no wearable
 *
 * `active_energy_kcal` does NOT include BMR; it may include steps and session
 * burn, so movement prefers canonical steps and only uses active_energy minus
 * sessions when steps are missing.
 */

import { getActivityCaloriesForDateRange } from './activity-storage';
import { getLinkedPairsForRange, type LinkedPairRow } from './activity-workout-links';
import { getCanonicalDailyMetric, getCanonicalDailyMetricsRange } from './daily-metrics-storage';
import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import {
  applyNoWearableMovementEstimate,
  resolveDailyMovementAchievedKcal,
  resolveDailyMovementTargetKcal,
  resolveSessionsTargetKcal,
} from './calories-balance-math';
import { stepsNeatKcal } from './nutrition-math';

export {
  activeBurnFromBreakdown,
  activeBurnHomeRowsFromBreakdown,
  applyNoWearableMovementEstimate,
  resolveDailyMovementAchievedKcal,
  resolveDailyMovementTargetKcal,
  resolveSessionsTargetKcal,
} from './calories-balance-math';

export type BurnedBreakdownVariant = 'three_bucket';

export interface BreakdownRow {
  key: 'bmr' | 'sessions' | 'daily_movement';
  achieved: number;
  target: number;
  sourceLabel?: string;
  /** No wearable: movement credited from onboarding occupation (not pending). */
  estimatedFromOccupation?: boolean;
}

export interface CaloriesBurnedBreakdown {
  variant: BurnedBreakdownVariant;
  rows: BreakdownRow[];
  achievedTotal: number;
  targetTotal: number;
  /** Resolved BMR used in the bmr row (for bar segment sizing). */
  bmrAchievedKcal: number;
  /** Wearable provider or recent canonical steps/active energy. */
  hasWearableMovement: boolean;
}

const KCAL_PER_STRENGTH_MIN = 6.5;
const WEARABLE_LOOKBACK_DAYS = 7;

export const computeCaloriesBurnedBreakdown = async (params: {
  userId: string;
  todayYmd: string;
  bmrKcal: number;
  weightKg: number;
  /** Onboarding occupation NEAT target (kcal/day above BMR). */
  occupationNeatKcal: number;
  /** When true, sessions target uses plan estimate (see plannedSessionTargetKcal). */
  plannedTrainingToday: boolean;
  /** From action plan step_1 (kcal/session); 0 if unknown. */
  plannedSessionTargetKcal?: number;
}): Promise<CaloriesBurnedBreakdown> => {
  const {
    userId,
    todayYmd,
    bmrKcal,
    weightKg,
    occupationNeatKcal,
    plannedTrainingToday,
    plannedSessionTargetKcal = 0,
  } = params;
  const startOf30dWindow = ymdMinusDays(todayYmd, 30);
  const endOfYesterday = ymdMinusDays(todayYmd, 1);

  const bmrResolved = await resolveBmrAchieved({ userId, todayYmd, fallbackBmrKcal: bmrKcal });
  const bmrAchieved = bmrResolved.achieved;
  const bmrSourceLabel = bmrResolved.sourceLabel;

  const [sessionsToday, sessions30dAvg, movement30dAvg, hasWearable] = await Promise.all([
    computeSessionsAchieved(userId, todayYmd, todayYmd, weightKg),
    computeSessionsDailyAverage(userId, startOf30dWindow, endOfYesterday, weightKg),
    computeMovementDailyAverage(userId, startOf30dWindow, endOfYesterday, weightKg, occupationNeatKcal),
    userHasWearableMovementSource(userId, todayYmd),
  ]);

  const sessionsAchieved = sessionsToday.total;
  const sessionsTarget = resolveSessionsTargetKcal(
    sessionsAchieved,
    sessions30dAvg,
    plannedTrainingToday,
    plannedSessionTargetKcal,
  );

  const movementToday = await computeMovementAchieved(
    userId,
    todayYmd,
    weightKg,
    sessionsAchieved,
  );
  const measuredMovementTarget = resolveDailyMovementTargetKcal(
    movementToday.achieved,
    movement30dAvg,
    occupationNeatKcal,
  );
  const movementResolved = applyNoWearableMovementEstimate({
    hasWearable,
    occupationNeatKcal,
    measuredAchieved: movementToday.achieved,
    measuredTarget: measuredMovementTarget,
  });

  const rows: BreakdownRow[] = [
    { key: 'bmr', achieved: bmrAchieved, target: bmrAchieved, sourceLabel: bmrSourceLabel },
    {
      key: 'sessions',
      achieved: sessionsAchieved,
      target: sessionsTarget,
    },
    {
      key: 'daily_movement',
      achieved: movementResolved.achieved,
      target: movementResolved.target,
      sourceLabel: movementResolved.estimatedFromOccupation
        ? undefined
        : movementToday.sourceLabel,
      estimatedFromOccupation: movementResolved.estimatedFromOccupation,
    },
  ];

  return {
    variant: 'three_bucket',
    rows,
    achievedTotal: rows.reduce((s, r) => s + r.achieved, 0),
    targetTotal: rows.reduce((s, r) => s + r.target, 0),
    bmrAchievedKcal: bmrAchieved,
    hasWearableMovement: hasWearable,
  };
};

/**
 * Movement calories that increase the consumed calorie target. Mirrors the
 * burned card's sessions + daily_movement split. Planned plan-step workouts
 * are excluded from the adjustable session sum (baseline already assumed them).
 */
export const computeAdjustableMovementCalories = async (params: {
  userId: string;
  todayYmd: string;
  weightKg: number;
  occupationNeatKcal?: number;
  plannedTrainingKcalForToday?: number;
  liveDay?: boolean;
}): Promise<{
  activityCalories: number;
  stepsNeatCalories: number;
  canonicalActiveEnergyCalories: number;
  workoutCalories: number;
}> => {
  const { userId, todayYmd, weightKg } = params;
  const occupationNeat = Math.max(0, Math.round(params.occupationNeatKcal ?? 0));
  const plannedKcal = Math.max(0, Math.round(params.plannedTrainingKcalForToday ?? 0));

  const canonicalToday = await getCanonicalDailyMetric(userId, todayYmd, 'active_energy_kcal').catch(() => null);
  const canonicalActiveEnergyCalories =
    canonicalToday && canonicalToday.value > 0 ? Math.round(canonicalToday.value) : 0;

  const linkedTodayAll = await getLinkedPairsForRange(userId, todayYmd, todayYmd).catch(() => [] as LinkedPairRow[]);
  const plannedWorkoutIds = await getWorkoutLogIdsWithPlanStep(userId, todayYmd, todayYmd);
  const linkedAdjustable = linkedTodayAll.filter((p) => !plannedWorkoutIds.has(p.workoutLogId));
  const linkedActivitySet = new Set(linkedTodayAll.map((p) => p.activityLogId));
  const linkedWorkoutSet = new Set(linkedAdjustable.map((p) => p.workoutLogId));

  const [workoutCaloriesRaw, activityCaloriesOnly] = await Promise.all([
    estimateStrengthWorkoutKcal(userId, todayYmd, todayYmd, weightKg, linkedWorkoutSet, {
      excludePlannedStepWorkouts: true,
    }),
    sumActivityCaloriesExcluding(userId, todayYmd, todayYmd, linkedActivitySet),
  ]);
  const blendedKcal = sumLinkedBlendedKcal(linkedAdjustable);
  const workoutCalories = workoutCaloriesRaw + blendedKcal;
  const activityCalories = workoutCalories + activityCaloriesOnly;

  const sessionsAchievedForResidual = await computeSessionsAchieved(
    userId,
    todayYmd,
    todayYmd,
    weightKg,
  );
  const movement = await computeMovementAchieved(
    userId,
    todayYmd,
    weightKg,
    sessionsAchievedForResidual.total,
  );
  let stepsNeatCalories = movement.achieved;

  if (params.liveDay && canonicalActiveEnergyCalories > 0) {
    const perSessionAndSteps = activityCalories + stepsNeatCalories;
    const reconciled = Math.max(0, canonicalActiveEnergyCalories - plannedKcal);
    if (reconciled > perSessionAndSteps) {
      const extraMovement = reconciled - activityCalories;
      stepsNeatCalories = Math.max(stepsNeatCalories, extraMovement);
    }
  }

  return {
    activityCalories,
    stepsNeatCalories,
    canonicalActiveEnergyCalories: params.liveDay ? canonicalActiveEnergyCalories : 0,
    workoutCalories,
  };
};

/** Connected wearable provider or recent canonical steps/active in lookback window. */
export async function userHasWearableMovementSource(
  userId: string,
  todayYmd: string,
): Promise<boolean> {
  try {
    const db = getDatabase();
    const conn = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM user_provider_connections
        WHERE user_id = ? AND status = 'active'`,
      [userId],
    );
    if ((conn?.n ?? 0) > 0) return true;
  } catch {
    /* fall through */
  }

  const start = ymdMinusDays(todayYmd, WEARABLE_LOOKBACK_DAYS - 1);
  const [stepsRows, activeRows] = await Promise.all([
    getCanonicalDailyMetricsRange(userId, 'steps', start, todayYmd).catch(() => []),
    getCanonicalDailyMetricsRange(userId, 'active_energy_kcal', start, todayYmd).catch(() => []),
  ]);
  return (
    stepsRows.some((r) => r.value > 0) || activeRows.some((r) => r.value > 0)
  );
}

export function getBreakdownRow(
  breakdown: CaloriesBurnedBreakdown,
  key: BreakdownRow['key'],
): BreakdownRow | undefined {
  return breakdown.rows.find((r) => r.key === key);
}

// ---------------------------------------------------------------------------
// Sessions + movement internals
// ---------------------------------------------------------------------------

async function computeSessionsAchieved(
  userId: string,
  startDate: string,
  endDate: string,
  weightKg: number,
): Promise<{ total: number }> {
  const linked = await getLinkedPairsForRange(userId, startDate, endDate).catch(() => [] as LinkedPairRow[]);
  const linkedActivitySet = new Set(linked.map((p) => p.activityLogId));
  const linkedWorkoutSet = new Set(linked.map((p) => p.workoutLogId));

  const [workoutsKcal, activitiesKcal, blended] = await Promise.all([
    estimateStrengthWorkoutKcal(userId, startDate, endDate, weightKg, linkedWorkoutSet),
    sumActivityCaloriesExcluding(userId, startDate, endDate, linkedActivitySet),
    Promise.resolve(sumLinkedBlendedKcal(linked)),
  ]);

  return { total: workoutsKcal + activitiesKcal + blended };
}

async function computeSessionsDailyAverage(
  userId: string,
  startDate: string,
  endDate: string,
  weightKg: number,
): Promise<number> {
  const linked = await getLinkedPairsForRange(userId, startDate, endDate).catch(() => [] as LinkedPairRow[]);
  const linkedActivitySet = new Set(linked.map((p) => p.activityLogId));
  const linkedWorkoutSet = new Set(linked.map((p) => p.workoutLogId));

  const [avgWorkoutsRaw, avgActivities] = await Promise.all([
    estimateStrengthWorkoutKcalAverage(userId, startDate, endDate, weightKg, linkedWorkoutSet),
    averageActivityKcalExcluding(userId, startDate, endDate, linkedActivitySet),
  ]);
  const days = Math.max(1, daysBetween(startDate, endDate));
  const blended30dKcal = sumLinkedBlendedKcal(linked);
  return avgWorkoutsRaw + avgActivities + Math.round(blended30dKcal / days);
}

async function computeMovementAchieved(
  userId: string,
  todayYmd: string,
  weightKg: number,
  sessionsAchieved: number,
): Promise<{ achieved: number; sourceLabel?: string }> {
  const stepsRow = await getCanonicalDailyMetric(userId, todayYmd, 'steps').catch(() => null);
  const activeRow = await getCanonicalDailyMetric(userId, todayYmd, 'active_energy_kcal').catch(() => null);
  const achieved = resolveDailyMovementAchievedKcal({
    steps: stepsRow?.value ?? 0,
    activeEnergyKcal: activeRow?.value ?? 0,
    sessionsAchieved,
    weightKg,
  });
  const sourceLabel = stepsRow && stepsRow.value > 0
    ? stepsRow.source
    : activeRow && activeRow.value > 0
      ? activeRow.source
      : undefined;
  return { achieved, sourceLabel };
}

async function computeMovementDailyAverage(
  userId: string,
  startDate: string,
  endDate: string,
  weightKg: number,
  occupationNeatKcal: number,
): Promise<number> {
  const avgSteps = await averageStepsNeatKcal(userId, startDate, endDate, weightKg);
  if (avgSteps > 0) return avgSteps;
  const hasWearable = await userHasWearableMovementSource(userId, endDate);
  if (!hasWearable) return occupationNeatKcal;
  return 0;
}

/** Workout logs tied to an action-plan step (planned sessions). */
async function getWorkoutLogIdsWithPlanStep(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<Set<number>> {
  try {
    const db = getDatabase();
    const rows = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM workout_logs
        WHERE user_id = ?
          AND workout_date >= ? AND workout_date <= ?
          AND status != 'deleted'
          AND step_id IS NOT NULL
          AND LENGTH(TRIM(step_id)) > 0`,
      [userId, startDate, endDate],
    );
    return new Set(rows.map((r) => r.id));
  } catch (error) {
    glowLogger.warn('Failed to read planned workout_log ids', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Set();
  }
}

function ymdMinusDays(ymd: string, days: number): string {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function resolveBmrAchieved(params: {
  userId: string;
  todayYmd: string;
  fallbackBmrKcal: number;
}): Promise<{ achieved: number; sourceLabel?: string }> {
  const { userId, todayYmd, fallbackBmrKcal } = params;
  const fallback = Math.max(0, Math.round(fallbackBmrKcal));
  const start = ymdMinusDays(todayYmd, 6);
  const rows = await getCanonicalDailyMetricsRange(
    userId,
    'resting_energy_kcal',
    start,
    todayYmd,
  ).catch(() => []);
  const positive = rows.filter((r) => Number.isFinite(r.value) && r.value > 0);
  if (positive.length === 0) {
    return { achieved: fallback };
  }
  const avg = Math.round(
    positive.reduce((s, r) => s + r.value, 0) / positive.length,
  );
  const counts = new Map<string, number>();
  for (const r of positive) {
    if (r.source) counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
  }
  let label: string | undefined;
  let bestCount = 0;
  for (const [src, n] of counts) {
    if (n > bestCount) {
      label = src;
      bestCount = n;
    }
  }
  return { achieved: avg, sourceLabel: label };
}

export async function estimateStrengthWorkoutKcal(
  userId: string,
  startDate: string,
  endDate: string,
  weightKg: number,
  excludeWorkoutLogIds?: Set<number>,
  options?: { excludePlannedStepWorkouts?: boolean },
): Promise<number> {
  try {
    const db = getDatabase();
    const excludeIds = Array.from(excludeWorkoutLogIds ?? []);
    const excludeFilter = excludeIds.length
      ? ` AND wl.id NOT IN (${excludeIds.map(() => '?').join(',')})`
      : '';
    const planFilter = options?.excludePlannedStepWorkouts
      ? ` AND (wl.step_id IS NULL OR LENGTH(TRIM(wl.step_id)) = 0)`
      : '';
    const baseParams = [userId, startDate, endDate, ...excludeIds];

    const stored = await db.getFirstAsync<{ total: number; null_rows: number }>(
      `SELECT
          COALESCE(SUM(wel.calories_burned), 0) AS total,
          SUM(CASE WHEN wel.calories_burned IS NULL THEN 1 ELSE 0 END) AS null_rows
         FROM workout_exercise_logs wel
         INNER JOIN workout_logs wl ON wl.id = wel.workout_log_id
        WHERE wl.user_id = ?
          AND wl.workout_date >= ? AND wl.workout_date <= ?
          AND wl.status != 'deleted'${excludeFilter}${planFilter}`,
      baseParams,
    );
    let total = Math.max(0, Math.round(stored?.total ?? 0));

    if ((stored?.null_rows ?? 0) > 0) {
      const fallback = await db.getFirstAsync<{ total_seconds: number; sets: number }>(
        `SELECT
            COALESCE(SUM(wel.rest_time_seconds), 0) AS total_seconds,
            COUNT(*) AS sets
           FROM workout_exercise_logs wel
           INNER JOIN workout_logs wl ON wl.id = wel.workout_log_id
          WHERE wl.user_id = ?
            AND wl.workout_date >= ? AND wl.workout_date <= ?
            AND wl.status != 'deleted'
            AND wel.calories_burned IS NULL${excludeFilter}${planFilter}`,
        baseParams,
      );
      const restMinutes = (fallback?.total_seconds ?? 0) / 60;
      const workMinutes = (fallback?.sets ?? 0) * 0.5;
      const totalMinutes = restMinutes + workMinutes;
      const perMin = KCAL_PER_STRENGTH_MIN * (weightKg / 70);
      total += Math.max(0, Math.round(totalMinutes * perMin));
    }
    return total;
  } catch (error) {
    glowLogger.warn('Failed to estimate strength workout kcal', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

async function estimateStrengthWorkoutKcalAverage(
  userId: string,
  startDate: string,
  endDate: string,
  weightKg: number,
  excludeWorkoutLogIds?: Set<number>,
): Promise<number> {
  const days = Math.max(1, daysBetween(startDate, endDate));
  const total = await estimateStrengthWorkoutKcal(
    userId,
    startDate,
    endDate,
    weightKg,
    excludeWorkoutLogIds,
  );
  return Math.round(total / days);
}

function sumLinkedBlendedKcal(pairs: LinkedPairRow[]): number {
  let total = 0;
  for (const p of pairs) {
    const a = p.activityKcal;
    const w = p.workoutKcal;
    if (p.caloriesResolution === 'wearable' && a > 0) {
      total += a;
      continue;
    }
    if (p.caloriesResolution === 'uf' && w > 0) {
      total += w;
      continue;
    }
    if (a > 0 && w > 0) total += Math.round((a + w) / 2);
    else if (a > 0) total += a;
    else if (w > 0) total += w;
  }
  return total;
}

async function sumActivityCaloriesExcluding(
  userId: string,
  startDate: string,
  endDate: string,
  excludeIds: Set<number>,
): Promise<number> {
  if (excludeIds.size === 0) {
    return getActivityCaloriesForDateRange(userId, startDate, endDate);
  }
  try {
    const db = getDatabase();
    const placeholders = Array.from(excludeIds).map(() => '?').join(',');
    const row = await db.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(calories_burned), 0) AS total
         FROM activity_logs
        WHERE user_id = ?
          AND activity_date >= ? AND activity_date <= ?
          AND status != 'deleted'
          AND id NOT IN (${placeholders})`,
      [userId, startDate, endDate, ...Array.from(excludeIds)],
    );
    return Math.round(row?.total ?? 0);
  } catch {
    return getActivityCaloriesForDateRange(userId, startDate, endDate);
  }
}

async function averageActivityKcalExcluding(
  userId: string,
  startDate: string,
  endDate: string,
  excludeIds: Set<number>,
): Promise<number> {
  const total = await sumActivityCaloriesExcluding(userId, startDate, endDate, excludeIds);
  const days = Math.max(1, daysBetween(startDate, endDate));
  return Math.round(total / days);
}

async function averageStepsNeatKcal(
  userId: string,
  startDate: string,
  endDate: string,
  weightKg: number,
): Promise<number> {
  const rows = await getCanonicalDailyMetricsRange(userId, 'steps', startDate, endDate).catch(() => []);
  if (rows.length === 0) return 0;
  const total = rows.reduce((s, r) => s + stepsNeatKcal(r.value, weightKg), 0);
  return Math.round(total / rows.length);
}

function daysBetween(startYmd: string, endYmd: string): number {
  const start = new Date(startYmd + 'T00:00:00').getTime();
  const end = new Date(endYmd + 'T00:00:00').getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}
