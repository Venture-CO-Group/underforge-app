/**
 * Apple HealthKit adapter (iOS only).
 *
 * Reads the metrics our coaching pipeline cares about via `react-native-health`
 * and writes them into the app's own stores using the normalized provider model:
 *   - workouts            -> `activity_logs` via `importExternalActivityLog`
 *   - steps               -> `daily_metrics(steps)`
 *   - active energy       -> `daily_metrics(active_energy_kcal)`
 *   - basal energy        -> `daily_metrics(resting_energy_kcal)`
 *   - sleep analysis      -> `daily_metrics(sleep_total_min, sleep_efficiency_pct)`
 *   - HRV (SDNN)          -> `daily_metrics(hrv_rmssd_ms)`  (stored under the
 *                            canonical column even though Apple reports SDNN;
 *                            see comment on `syncHrvByDay` for rationale)
 *   - resting heart rate  -> `daily_metrics(resting_hr_bpm)`
 *
 * The `react-native-health` module only loads on a real iOS build (it's a
 * native module). We require it lazily with `require` and guard with
 * `Platform.OS === 'ios'` so this file is safe to import on Android, web,
 * and Expo Go where the native module isn't available.
 *
 * Cursor-based incremental sync: the last successful fetch time is stored in
 * `user_provider_connections.last_sync_cursor`. Each run still covers at least
 * `daysBack` calendar days (like Health Connect): we take the earlier of the
 * cursor and (now − daysBack) so a narrow follow-up sync never drops workouts
 * that landed slightly late.
 */

import { Platform } from 'react-native';
import { importExternalActivityLog, getLatestUserWeightKg } from '../activity-storage';
import {
  resolveCanonicalDailyMetric,
  upsertDailyMetric,
} from '../daily-metrics-storage';
import { getDatabase } from '../db';
import { glowLogger } from '../glow-logger';
import type { ActivityCategory } from '../../types/workout';
import type {
  NormalizedActivity,
  NormalizedDailyMetric,
  ProviderSource,
} from './types';
import { dedupeFingerprint } from './types';
import { reconcileProviderCalories } from './met-table';
import { sleepTag } from './normalize-helpers';
import { unregisterHealthKitObservers } from './healthkit-observers';

// Re-exported so callers can `import { sleepTag } from './healthkit'`
// without depending directly on the shared helpers module.
export { sleepTag };

const SOURCE: ProviderSource = 'healthkit';

/**
 * Minimal structural types for react-native-health so this file stays
 * type-safe without pulling in the real module at compile time.
 */
interface HealthKitSample {
  /** Most HealthKit sample APIs use these keys. */
  startDate?: string;
  endDate?: string;
  /**
   * `getAnchoredWorkouts` returns ISO8601 bounds as `start` / `end` (not
   * `startDate` / `endDate`). See RCTAppleHealthKit+Queries.m `fetchAnchoredWorkouts`.
   */
  start?: string;
  end?: string;
  value?: number;
  id?: string;
  sourceName?: string;
  sourceId?: string;
  activityName?: string;
  activityId?: number;
  calories?: number;
  distance?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Sleep samples from `getSleepSamples`. Apple categorizes them with strings
 * like 'INBED', 'ASLEEP', 'ASLEEP_CORE', 'ASLEEP_DEEP', 'ASLEEP_REM', 'AWAKE'.
 * We bucket on the `ASLEEP*` prefix when computing efficiency.
 */
interface HealthKitSleepSample extends Omit<HealthKitSample, 'value'> {
  value?: number | string;
}

interface HealthKitAPI {
  initHealthKit(options: any, cb: (err: string | null) => void): void;
  getSamples(
    options: { startDate: string; endDate: string; type: string },
    cb: (err: string | null, results: HealthKitSample[]) => void,
  ): void;
  getDailyStepCountSamples(
    options: { startDate: string; endDate: string },
    cb: (err: string | null, results: HealthKitSample[]) => void,
  ): void;
  getActiveEnergyBurned(
    options: { startDate: string; endDate: string },
    cb: (err: string | null, results: HealthKitSample[]) => void,
  ): void;
  getBasalEnergyBurned?(
    options: { startDate: string; endDate: string },
    cb: (err: string | null, results: HealthKitSample[]) => void,
  ): void;
  getSleepSamples?(
    options: { startDate: string; endDate: string; limit?: number },
    cb: (err: string | null, results: HealthKitSleepSample[]) => void,
  ): void;
  getHeartRateVariabilitySamples?(
    options: { startDate: string; endDate: string; unit?: string },
    cb: (err: string | null, results: HealthKitSample[]) => void,
  ): void;
  getRestingHeartRateSamples?(
    options: { startDate: string; endDate: string; unit?: string },
    cb: (err: string | null, results: HealthKitSample[]) => void,
  ): void;
  getAnchoredWorkouts(
    options: { startDate: string; endDate: string },
    cb: (err: string | null, results: { data: HealthKitSample[] }) => void,
  ): void;
  Constants: {
    Permissions: {
      Workout: string;
      Steps: string;
      StepCount: string;
      ActiveEnergyBurned: string;
      BasalEnergyBurned?: string;
      HeartRate: string;
      RestingHeartRate?: string;
      HeartRateVariability?: string;
      SleepAnalysis?: string;
    };
    Activities?: Record<string, string | number>;
  };
}

/**
 * Public list of HealthKit permission keys our app reads. Exposed so the
 * observer module can register a `HKObserverQuery` for each one without
 * duplicating the constant strings. Falls back gracefully on
 * `react-native-health` versions that don't expose the newer permissions.
 */
export function getRequestedHealthKitPermissionKeys(): string[] {
  const hk = requireHealthKit();
  if (!hk) return [];
  const p = hk.Constants.Permissions;
  return [
    p.Workout,
    p.StepCount,
    p.ActiveEnergyBurned,
    p.BasalEnergyBurned,
    p.SleepAnalysis,
    p.HeartRateVariability,
    p.RestingHeartRate,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

let healthkit: HealthKitAPI | null = null;
let healthkitLoadAttempted = false;

function requireHealthKit(): HealthKitAPI | null {
  if (Platform.OS !== 'ios') return null;
  if (healthkit) return healthkit;
  if (healthkitLoadAttempted) return null;
  healthkitLoadAttempted = true;

  try {
    // Dynamic require so Metro doesn't try to resolve on Android/web.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-health');
    const candidate = [mod, mod?.default, mod?.HealthKit, mod?.default?.HealthKit]
      .find((value) => typeof value?.initHealthKit === 'function');
    if (typeof candidate?.initHealthKit !== 'function') {
      glowLogger.debug('react-native-health native API unavailable', {
        exports: mod ? Object.keys(mod) : [],
      });
      return null;
    }
    healthkit = candidate as HealthKitAPI;
    return healthkit;
  } catch (e) {
    glowLogger.debug('react-native-health not installed; HealthKit disabled', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export function isHealthKitAvailable(): boolean {
  return Platform.OS === 'ios' && requireHealthKit() != null;
}

/**
 * Request read permissions for the metrics we consume. No-op on non-iOS.
 * Returns true on success, false otherwise (including "user denied").
 *
 * iOS will surface a single permission sheet listing every category we ask
 * for here. The user can toggle each individually. If they deny a category
 * the corresponding sync function below will simply find no samples and
 * skip silently — we never throw.
 */
export async function requestHealthKitPermissions(): Promise<boolean> {
  console.log('[HK] requestHealthKitPermissions: enter');
  const hk = requireHealthKit();
  if (!hk) {
    console.log('[HK] requestHealthKitPermissions: requireHealthKit() returned null');
    return false;
  }
  console.log('[HK] requestHealthKitPermissions: hk loaded; initHealthKit type =', typeof hk.initHealthKit);
  const p = hk.Constants.Permissions;
  const read = [
    p.Workout,
    p.StepCount,
    p.ActiveEnergyBurned,
    p.BasalEnergyBurned,
    p.HeartRate,
    p.RestingHeartRate,
    p.HeartRateVariability,
    p.SleepAnalysis,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  console.log('[HK] requestHealthKitPermissions: read keys =', read.join(','));

  const perms = { permissions: { read, write: [] } };
  // `initHealthKit` presents iOS's permission sheet when the scopes are still
  // undetermined, and only calls back once the user responds. Under the
  // bridgeless RN runtime that sheet presentation can fail to call back at all
  // (most reproducibly in the iOS Simulator on a fresh permission state),
  // which would otherwise leave the Connections toggle spinning forever. Guard
  // with a timeout so a non-responding init resolves false instead of hanging.
  // A late callback after the timeout is a harmless no-op (`finish` is latched).
  const INIT_TIMEOUT_MS = 60_000;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => {
      glowLogger.warn('HealthKit initHealthKit timed out with no callback', {
        timeoutMs: INIT_TIMEOUT_MS,
      });
      finish(false);
    }, INIT_TIMEOUT_MS);
    try {
      hk.initHealthKit(perms, (err) => {
        if (err) {
          glowLogger.warn('HealthKit permission init failed', { error: err });
          finish(false);
          return;
        }
        finish(true);
      });
    } catch (e) {
      glowLogger.warn('HealthKit initHealthKit synchronous throw', {
        error: e instanceof Error ? e.message : String(e),
      });
      finish(false);
    }
  });
}

export interface HealthKitSyncResult {
  workouts: number;
  stepsDays: number;
  activeEnergyDays: number;
  restingEnergyDays: number;
  sleepDays: number;
  hrvDays: number;
  rhrDays: number;
}

/**
 * Sync workouts + the supported daily metrics from HealthKit for the window
 * (now - daysBack) -> now. Uses `user_provider_connections.last_sync_cursor`
 * as an anchor; pass `force=true` to ignore the cursor and re-pull the full
 * window (e.g. on initial connect).
 *
 * Each sub-sync wraps its own try/catch so that, e.g., a denied SleepAnalysis
 * permission can never block the workout pull.
 */
export async function syncHealthKit(
  userId: string,
  opts: { daysBack?: number; force?: boolean } = {},
): Promise<HealthKitSyncResult> {
  const empty: HealthKitSyncResult = {
    workouts: 0,
    stepsDays: 0,
    activeEnergyDays: 0,
    restingEnergyDays: 0,
    sleepDays: 0,
    hrvDays: 0,
    rhrDays: 0,
  };
  const hk = requireHealthKit();
  if (!hk) return empty;

  const daysBack = opts.daysBack ?? 30;
  const now = new Date();
  const minStart = new Date(now.getTime() - daysBack * 86_400_000);
  const cursor = opts.force ? null : await readCursor(userId);
  const startDate =
    cursor == null ? minStart : new Date(Math.min(cursor.getTime(), minStart.getTime()));
  const startIso = startDate.toISOString();
  const endIso = now.toISOString();

  const weightKg = await getLatestUserWeightKg(userId);

  const result: HealthKitSyncResult = { ...empty };

  result.workouts = await safe(
    'workouts',
    () => syncWorkouts(userId, hk, startIso, endIso, weightKg),
    0,
  );
  result.stepsDays = await safe(
    'steps',
    () => syncStepsByDay(userId, hk, startIso, endIso),
    0,
  );
  result.activeEnergyDays = await safe(
    'active_energy',
    () => syncActiveEnergyByDay(userId, hk, startIso, endIso),
    0,
  );
  result.restingEnergyDays = await safe(
    'resting_energy',
    () => syncBasalEnergyByDay(userId, hk, startIso, endIso),
    0,
  );
  result.sleepDays = await safe(
    'sleep',
    () => syncSleepByNight(userId, hk, startIso, endIso),
    0,
  );
  result.hrvDays = await safe(
    'hrv',
    () => syncHrvByDay(userId, hk, startIso, endIso),
    0,
  );
  result.rhrDays = await safe(
    'rhr',
    () => syncRestingHrByDay(userId, hk, startIso, endIso),
    0,
  );

  await writeCursor(userId, now);
  await markConnectionActive(userId);

  glowLogger.info('HealthKit sync complete', {
    user_id: userId,
    ...result,
    window_start: startIso,
    window_end: endIso,
  });
  return result;
}

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    glowLogger.warn(`HealthKit ${label} sync failed`, {
      error: e instanceof Error ? e.message : String(e),
    });
    return fallback;
  }
}

// ---- internal: workouts ------------------------------------------------

async function syncWorkouts(
  userId: string,
  hk: HealthKitAPI,
  startIso: string,
  endIso: string,
  weightKg: number | undefined,
): Promise<number> {
  const samples = await new Promise<HealthKitSample[]>((resolve) => {
    hk.getAnchoredWorkouts({ startDate: startIso, endDate: endIso }, (err, results) => {
      if (err) {
        glowLogger.warn('HealthKit workouts fetch failed', { error: err });
        resolve([]);
        return;
      }
      resolve(results?.data ?? []);
    });
  });

  let inserted = 0;
  for (const s of samples) {
    try {
      const normalized = normalizeWorkout(userId, s, weightKg);
      if (!normalized) continue;
      const res = await importExternalActivityLog({
        userId,
        source: 'healthkit',
        externalId: normalized.externalId!,
        activityDate: normalized.activityDate,
        activityType:
          strengthActivityIdFromName(normalized.activityName)
          ?? mapCategoryToActivityType(normalized.activityCategory),
        activityName: normalized.activityName,
        durationMinutes: normalized.durationMinutes,
        intensity: 'moderate',
        distanceValue: normalized.distanceValue,
        distanceUnit: normalized.distanceUnit,
        caloriesBurned: normalized.caloriesBurned,
        caloriesSource: normalized.caloriesSource,
        caloriesConfidence: normalized.caloriesConfidence,
        avgHeartRate: normalized.avgHeartRate,
        dedupeFingerprint: normalized.dedupeFingerprint,
        startedAt: normalized.startedAt,
        endedAt: normalized.endedAt,
      });
      if (res.inserted) inserted++;
    } catch (e) {
      glowLogger.warn('Failed to import HealthKit workout', {
        error: e instanceof Error ? e.message : String(e),
        external_id: s.id,
      });
    }
  }
  return inserted;
}

/** `fetchAnchoredWorkouts` reports distance in miles (see native `mileUnit`). */
const HEALTHKIT_WORKOUT_DISTANCE_MI_TO_KM = 1.609344;

function normalizeWorkout(
  userId: string,
  s: HealthKitSample,
  weightKg: number | undefined,
): NormalizedActivity | null {
  const startIso = s.startDate ?? s.start;
  const endIso = s.endDate ?? s.end;
  if (!s.id || !startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (durationMinutes <= 0) return null;

  const category = mapHealthKitActivityToCategory(s.activityName, s.activityId);
  const activityDate = toLocalYmd(start);

  const reconciled = reconcileProviderCalories(s.calories, {
    category,
    durationMinutes,
    weightKg,
  });

  return {
    userId,
    source: SOURCE,
    externalId: String(s.id),
    activityDate,
    startedAt: startIso,
    endedAt: endIso,
    durationMinutes,
    activityCategory: category,
    activityName: s.activityName ?? 'Workout',
    distanceValue:
      typeof s.distance === 'number' && Number.isFinite(s.distance)
        ? s.distance * HEALTHKIT_WORKOUT_DISTANCE_MI_TO_KM
        : undefined,
    distanceUnit: typeof s.distance === 'number' && Number.isFinite(s.distance) ? 'km' : undefined,
    caloriesBurned: reconciled.caloriesBurned,
    caloriesSource: reconciled.caloriesSource,
    caloriesConfidence: reconciled.caloriesConfidence,
    dedupeFingerprint: dedupeFingerprint(startIso, category, durationMinutes),
  };
}

/**
 * HealthKit reports fine-grained sport strings; map them to our small
 * `ActivityCategory` taxonomy. The mapping is intentionally coarse and only
 * aims for "close enough" categorisation so MET math is reasonable. Unknown
 * activities fall through to 'other'.
 */
function mapHealthKitActivityToCategory(
  name: string | undefined,
  _id: number | undefined,
): ActivityCategory {
  const n = (name ?? '').toLowerCase();
  if (n.includes('run')) return 'running';
  if (n.includes('walk') || n.includes('hike')) return n.includes('hike') ? 'hiking' : 'running';
  if (n.includes('cycl') || n.includes('bike')) return 'cycling';
  if (n.includes('swim')) return 'swimming';
  if (n.includes('ski') || n.includes('snowboard') || n.includes('skate')) return 'winter_sports';
  if (n.includes('tennis') || n.includes('badminton') || n.includes('pickle') || n.includes('squash')) return 'racket_sports';
  if (n.includes('soccer') || n.includes('football') || n.includes('basketball') || n.includes('baseball') || n.includes('rugby') || n.includes('hockey') || n.includes('cricket')) return 'team_sports';
  if (n.includes('row') || n.includes('kayak') || n.includes('canoe') || n.includes('surf') || n.includes('sail')) return 'water_sports';
  if (n.includes('box') || n.includes('mma') || n.includes('judo') || n.includes('karate') || n.includes('taekwondo') || n.includes('kickbox')) return 'martial_arts';
  if (n.includes('yoga') || n.includes('pilates') || n.includes('stretch') || n.includes('tai')) return 'mind_body';
  if (n.includes('elliptical') || n.includes('rope') || n.includes('stair') || n.includes('cardio') || n.includes('hiit') || n.includes('dance')) return 'gym_cardio';
  if (n.includes('climb') || n.includes('golf') || n.includes('skate')) return 'outdoor';
  return 'other';
}

/**
 * Pick a specific wearable strength activity-type id when the workout name
 * looks like strength. Returns null otherwise so the normal category mapper
 * runs.
 */
export function strengthActivityIdFromName(name: string | undefined): string | null {
  const n = (name ?? '').toLowerCase();
  if (!n) return null;
  if (n.includes('crossfit') || n.includes('cross fit') || n.includes('cross-fit')) return 'crossfit';
  if (n.includes('calisthenic')) return 'calisthenics';
  if (
    n.includes('strength') ||
    n.includes('weight') ||
    n.includes('lift') ||
    n.includes('powerlift') ||
    n.includes('functional fitness') ||
    n.includes('boot camp') ||
    n.includes('bootcamp')
  ) {
    return 'strength_training';
  }
  return null;
}

/** Our `activity_logs.activity_type` is a granular string; pick a sensible default per category. */
function mapCategoryToActivityType(category: ActivityCategory): string {
  switch (category) {
    case 'running': return 'run';
    case 'hiking': return 'hike';
    case 'cycling': return 'road_cycling';
    case 'swimming': return 'pool_swim';
    case 'winter_sports': return 'downhill_skiing';
    case 'racket_sports': return 'tennis';
    case 'team_sports': return 'soccer';
    case 'water_sports': return 'rowing';
    case 'martial_arts': return 'boxing';
    case 'mind_body': return 'yoga';
    case 'gym_cardio': return 'elliptical';
    case 'outdoor': return 'climbing';
    default: return 'other_activity';
  }
}

// ---- internal: daily metrics ------------------------------------------

async function syncStepsByDay(
  userId: string,
  hk: HealthKitAPI,
  startIso: string,
  endIso: string,
): Promise<number> {
  const samples = await new Promise<HealthKitSample[]>((resolve) => {
    hk.getDailyStepCountSamples({ startDate: startIso, endDate: endIso }, (err, results) => {
      if (err) {
        glowLogger.warn('HealthKit steps fetch failed', { error: err });
        resolve([]);
        return;
      }
      resolve(results ?? []);
    });
  });
  return upsertDailyMetrics(userId, samples, 'steps');
}

async function syncActiveEnergyByDay(
  userId: string,
  hk: HealthKitAPI,
  startIso: string,
  endIso: string,
): Promise<number> {
  const samples = await new Promise<HealthKitSample[]>((resolve) => {
    hk.getActiveEnergyBurned({ startDate: startIso, endDate: endIso }, (err, results) => {
      if (err) {
        glowLogger.warn('HealthKit active energy fetch failed', { error: err });
        resolve([]);
        return;
      }
      resolve(results ?? []);
    });
  });
  return upsertDailyMetrics(userId, samples, 'active_energy_kcal');
}

/**
 * Basal/resting energy. Apple Health's "basal energy burned" is the
 * Health-app equivalent of BMR over each interval; summing across a local
 * day produces our `resting_energy_kcal` daily metric.
 *
 * Some `react-native-health` builds don't ship `getBasalEnergyBurned`; we
 * silently no-op in that case rather than failing the whole sync.
 */
async function syncBasalEnergyByDay(
  userId: string,
  hk: HealthKitAPI,
  startIso: string,
  endIso: string,
): Promise<number> {
  if (typeof hk.getBasalEnergyBurned !== 'function') return 0;
  const fetcher = hk.getBasalEnergyBurned;
  const samples = await new Promise<HealthKitSample[]>((resolve) => {
    fetcher({ startDate: startIso, endDate: endIso }, (err, results) => {
      if (err) {
        glowLogger.warn('HealthKit basal energy fetch failed', { error: err });
        resolve([]);
        return;
      }
      resolve(results ?? []);
    });
  });
  return upsertDailyMetrics(userId, samples, 'resting_energy_kcal');
}

/**
 * Sleep aggregation.
 *
 * HealthKit returns categorical samples like 'INBED' / 'ASLEEP*' / 'AWAKE',
 * each with its own start/end interval. We:
 *   1. Bucket every sample by the local Y-M-D of its END (matches how Apple
 *      Health's UI attributes a sleep block to the morning of waking).
 *   2. Sum minutes-asleep into `sleep_total_min`.
 *   3. Compute `sleep_efficiency_pct = asleep / (asleep + awake_in_bed) * 100`,
 *      clamped to [0, 100].
 *   4. Upsert both metrics for that night.
 *
 * Returns the number of distinct nights upserted.
 */
async function syncSleepByNight(
  userId: string,
  hk: HealthKitAPI,
  startIso: string,
  endIso: string,
): Promise<number> {
  if (typeof hk.getSleepSamples !== 'function') return 0;
  const fetcher = hk.getSleepSamples;
  const samples = await new Promise<HealthKitSleepSample[]>((resolve) => {
    fetcher({ startDate: startIso, endDate: endIso, limit: 5000 }, (err, results) => {
      if (err) {
        glowLogger.warn('HealthKit sleep fetch failed', { error: err });
        resolve([]);
        return;
      }
      resolve(results ?? []);
    });
  });

  type Bucket = { asleepMin: number; awakeInBedMin: number };
  const byNight = new Map<string, Bucket>();
  for (const s of samples) {
    if (!s.startDate || !s.endDate) continue;
    const start = new Date(s.startDate);
    const end = new Date(s.endDate);
    const minutes = Math.max(0, (end.getTime() - start.getTime()) / 60_000);
    if (minutes <= 0) continue;
    const dayKey = toLocalYmd(end);
    const bucket = byNight.get(dayKey) ?? { asleepMin: 0, awakeInBedMin: 0 };
    const tag = sleepTag(s.value);
    if (tag === 'asleep') bucket.asleepMin += minutes;
    else if (tag === 'awake_in_bed') bucket.awakeInBedMin += minutes;
    // 'inbed' on its own (without `ASLEEP`) usually overlaps with the asleep
    // samples; counting it would double-count, so we ignore it.
    byNight.set(dayKey, bucket);
  }

  let nights = 0;
  for (const [date, b] of byNight.entries()) {
    if (b.asleepMin <= 0) continue;
    const denom = b.asleepMin + b.awakeInBedMin;
    const efficiency = denom > 0 ? Math.max(0, Math.min(100, (b.asleepMin / denom) * 100)) : 0;

    await upsertDailyMetric({
      userId,
      metricDate: date,
      metric: 'sleep_total_min',
      source: SOURCE,
      value: Math.round(b.asleepMin),
      confidence: 'high',
    });
    await resolveCanonicalDailyMetric(userId, date, 'sleep_total_min');

    if (denom > 0) {
      await upsertDailyMetric({
        userId,
        metricDate: date,
        metric: 'sleep_efficiency_pct',
        source: SOURCE,
        value: Math.round(efficiency * 10) / 10,
        confidence: 'high',
      });
      await resolveCanonicalDailyMetric(userId, date, 'sleep_efficiency_pct');
    }
    nights++;
  }
  return nights;
}

/**
 * HRV daily aggregate.
 *
 * Apple Health reports HRV as SDNN (standard deviation of NN intervals) in
 * milliseconds. Our canonical metric column is `hrv_rmssd_ms` (RMSSD), which
 * Whoop / Health Connect both report. SDNN and RMSSD are related but not
 * identical — for users with both Whoop and HealthKit connected the canonical
 * priority puts Whoop first, so the HK value is only consumed when no
 * RMSSD-native source exists. Storing under the same column keeps the
 * downstream reader simple; the small fidelity loss is acceptable.
 *
 * Aggregation: per local-day mean of all SDNN samples that day.
 */
async function syncHrvByDay(
  userId: string,
  hk: HealthKitAPI,
  startIso: string,
  endIso: string,
): Promise<number> {
  if (typeof hk.getHeartRateVariabilitySamples !== 'function') return 0;
  const fetcher = hk.getHeartRateVariabilitySamples;
  const samples = await new Promise<HealthKitSample[]>((resolve) => {
    fetcher(
      { startDate: startIso, endDate: endIso, unit: 'ms' },
      (err, results) => {
        if (err) {
          glowLogger.warn('HealthKit HRV fetch failed', { error: err });
          resolve([]);
          return;
        }
        resolve(results ?? []);
      },
    );
  });
  return upsertDailyAverage(userId, samples, 'hrv_rmssd_ms');
}

async function syncRestingHrByDay(
  userId: string,
  hk: HealthKitAPI,
  startIso: string,
  endIso: string,
): Promise<number> {
  if (typeof hk.getRestingHeartRateSamples !== 'function') return 0;
  const fetcher = hk.getRestingHeartRateSamples;
  const samples = await new Promise<HealthKitSample[]>((resolve) => {
    fetcher(
      { startDate: startIso, endDate: endIso, unit: 'bpm' },
      (err, results) => {
        if (err) {
          glowLogger.warn('HealthKit RHR fetch failed', { error: err });
          resolve([]);
          return;
        }
        resolve(results ?? []);
      },
    );
  });
  return upsertDailyAverage(userId, samples, 'resting_hr_bpm');
}

async function upsertDailyMetrics(
  userId: string,
  samples: HealthKitSample[],
  metric: NormalizedDailyMetric['metric'],
): Promise<number> {
  // HealthKit returns per-day aggregates. Some plugin versions return per-sample
  // rows; collapse by local-day to be safe.
  const byDay = new Map<string, number>();
  for (const s of samples) {
    if (typeof s.value !== 'number') continue;
    const d = toLocalYmd(new Date(s.startDate ?? s.endDate));
    byDay.set(d, (byDay.get(d) ?? 0) + s.value);
  }
  let updatedDays = 0;
  for (const [date, value] of byDay.entries()) {
    await upsertDailyMetric({
      userId,
      metricDate: date,
      metric,
      source: SOURCE,
      value,
      confidence: 'high',
    });
    await resolveCanonicalDailyMetric(userId, date, metric);
    updatedDays++;
  }
  return updatedDays;
}

/**
 * Like `upsertDailyMetrics` but takes the AVERAGE per local day instead of
 * the sum. Used for instantaneous metrics (HRV, RHR) where summing would be
 * meaningless.
 */
async function upsertDailyAverage(
  userId: string,
  samples: HealthKitSample[],
  metric: NormalizedDailyMetric['metric'],
): Promise<number> {
  const byDay = new Map<string, { sum: number; n: number }>();
  for (const s of samples) {
    if (typeof s.value !== 'number' || !Number.isFinite(s.value)) continue;
    const d = toLocalYmd(new Date(s.startDate ?? s.endDate));
    const cur = byDay.get(d) ?? { sum: 0, n: 0 };
    cur.sum += s.value;
    cur.n += 1;
    byDay.set(d, cur);
  }
  let updatedDays = 0;
  for (const [date, { sum, n }] of byDay.entries()) {
    if (n === 0) continue;
    const avg = Math.round((sum / n) * 10) / 10;
    await upsertDailyMetric({
      userId,
      metricDate: date,
      metric,
      source: SOURCE,
      value: avg,
      confidence: 'high',
    });
    await resolveCanonicalDailyMetric(userId, date, metric);
    updatedDays++;
  }
  return updatedDays;
}

// ---- internal: connection bookkeeping ---------------------------------

async function readCursor(userId: string): Promise<Date | null> {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ last_sync_cursor: string | null }>(
      `SELECT last_sync_cursor FROM user_provider_connections
        WHERE user_id = ? AND provider = 'healthkit'`,
      [userId],
    );
    if (row?.last_sync_cursor) {
      const d = new Date(row.last_sync_cursor);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeCursor(userId: string, cursor: Date): Promise<void> {
  try {
    const db = getDatabase();
    const iso = cursor.toISOString();
    await db.runAsync(
      `INSERT INTO user_provider_connections (user_id, provider, status, connected_at, last_sync_at, last_sync_cursor)
       VALUES (?, 'healthkit', 'active', ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         last_sync_at = excluded.last_sync_at,
         last_sync_cursor = excluded.last_sync_cursor,
         status = 'active',
         last_error = NULL`,
      [userId, iso, iso, iso],
    );
  } catch (e) {
    glowLogger.warn('Failed to persist HealthKit sync cursor', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export interface HealthKitConnectionSummary {
  connected: boolean;
  lastSyncAt?: string | null;
}

/**
 * Read the persisted HealthKit connection row so the Connections screen can
 * reflect prior authorization on load.
 *
 * Apple deliberately makes *read* permission status undetectable (you can't
 * tell whether the user granted or denied a read scope), so there is no native
 * "are we authorized?" call to lean on. Instead we treat a row written by a
 * successful sync (`status = 'active'`, via `writeCursor` / `markConnectionActive`)
 * as "connected" — the same signal Whoop and Health Connect expose. Returns
 * `{ connected: false }` on non-iOS, a missing row, or any non-active status.
 */
export async function getHealthKitConnection(
  userId: string,
): Promise<HealthKitConnectionSummary> {
  if (Platform.OS !== 'ios') return { connected: false };
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ status: string; last_sync_at: string | null }>(
      `SELECT status, last_sync_at FROM user_provider_connections
        WHERE user_id = ? AND provider = 'healthkit'`,
      [userId],
    );
    if (!row) return { connected: false };
    return { connected: row.status === 'active', lastSyncAt: row.last_sync_at };
  } catch (e) {
    glowLogger.warn('Failed to read HealthKit connection row', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { connected: false };
  }
}

/**
 * Disconnect Apple Health *within Underforge*.
 *
 * Apple owns the read-permission grant and deliberately hides its status from
 * us (see `getHealthKitConnection`), so we cannot revoke it programmatically.
 * What we can do — and what the Connections toggle needs — is stop importing:
 * mark the connection row non-active so the gated background/foreground syncs
 * in `sync-orchestrator` skip HealthKit, and tear down any observers. The
 * Connections switch reads this row, so it flips off immediately and stays off
 * (a revoked row is never auto-promoted back to 'active').
 *
 * Already-imported `activity_logs` are intentionally left in place — this is a
 * "stop syncing" action, not a data wipe.
 */
export async function disconnectHealthKit(userId: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    unregisterHealthKitObservers();
  } catch (e) {
    glowLogger.warn('Failed to unregister HealthKit observers on disconnect', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  const db = getDatabase();
  await db.runAsync(
    `UPDATE user_provider_connections
        SET status = 'revoked', last_sync_cursor = NULL
      WHERE user_id = ? AND provider = 'healthkit'`,
    [userId],
  );
}

async function markConnectionActive(userId: string): Promise<void> {
  try {
    const db = getDatabase();
    await db.runAsync(
      `INSERT OR IGNORE INTO user_provider_connections (user_id, provider, status, connected_at)
       VALUES (?, 'healthkit', 'active', ?)`,
      [userId, new Date().toISOString()],
    );
  } catch {
    // best-effort
  }
}

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
