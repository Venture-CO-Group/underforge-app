/**
 * Android Health Connect adapter (Android only).
 *
 * Mirror of `lib/providers/healthkit.ts` for Android. Reads:
 *   - exercise sessions       -> `activity_logs` via `importExternalActivityLog`
 *   - steps                   -> `daily_metrics(steps)`
 *   - active calories burned  -> `daily_metrics(active_energy_kcal)`
 *   - total calories burned   -> derives `resting_energy_kcal` (total - active
 *                                per day, clamped >= 0) when both are present
 *   - sleep sessions          -> `daily_metrics(sleep_total_min, sleep_efficiency_pct)`
 *   - HRV (RMSSD)             -> `daily_metrics(hrv_rmssd_ms)`
 *   - resting heart rate      -> `daily_metrics(resting_hr_bpm)`
 *
 * The `react-native-health-connect` module only loads on a real Android
 * build (it's a native module). We require it lazily and guard with
 * `Platform.OS === 'android'` so this file is safe to import on iOS, web,
 * and Expo Go where the native module isn't available.
 *
 * Cursor-based incremental sync: the last successful fetch anchor is stored
 * in `user_provider_connections.last_sync_cursor` (per user) under
 * `provider='healthconnect'`. On first run we pull the last 30 days;
 * subsequent runs pull strictly from the cursor.
 *
 * Health Connect has no event-driven push API for third-party apps; the
 * matching `lib/providers/sync-orchestrator.ts` schedules a periodic
 * background task plus a foreground re-sync on app open.
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
import {
  mapHealthConnectExerciseToCategory,
  sleepStageTag,
} from './normalize-helpers';

export { mapHealthConnectExerciseToCategory, sleepStageTag };

const SOURCE: ProviderSource = 'healthconnect';

/**
 * Structural type for the small subset of `react-native-health-connect` we
 * use. Keeping this local lets the file type-check without forcing the real
 * module to be importable on iOS / web.
 */
interface HealthConnectAPI {
  getSdkStatus(providerPackageName?: string): Promise<number>;
  initialize(providerPackageName?: string): Promise<boolean>;
  requestPermission(perms: { accessType: 'read' | 'write'; recordType: string }[]): Promise<{ accessType: string; recordType: string }[]>;
  getGrantedPermissions(): Promise<{ accessType: string; recordType: string }[]>;
  readRecords(
    recordType: string,
    options: {
      timeRangeFilter: { operator: 'between'; startTime: string; endTime: string };
      pageSize?: number;
      pageToken?: string;
      ascendingOrder?: boolean;
    },
  ): Promise<{ records: any[]; pageToken?: string }>;
  openHealthConnectSettings?: () => void;
  SdkAvailabilityStatus?: { SDK_AVAILABLE: number };
}

const REQUIRED_RECORD_TYPES = [
  'ExerciseSession',
  'Steps',
  'ActiveCaloriesBurned',
  'TotalCaloriesBurned',
  'SleepSession',
  'HeartRateVariabilityRmssd',
  'RestingHeartRate',
] as const;

let hcModule: HealthConnectAPI | null = null;
let hcLoadAttempted = false;
// Health Connect's native client must be initialized once per app process
// before any read / getGrantedPermissions call — otherwise every API throws
// "Health Connect client is not initialized". `requestPermission()` does
// initialize internally, but background/foreground re-syncs do not go through
// that flow, so we memoize an initialize() promise here and await it before
// any other native call.
let hcInitPromise: Promise<boolean> | null = null;

/** Avoid spamming Logfire / Metro when Connections refresh calls availability often. */
let lastHcAvailabilitySnapshot: { ok: boolean; status: number } | null = null;
let loggedHcNativeModuleMissing = false;

function describeSdkStatusCode(status: number): string {
  if (status === 1) return 'SDK_UNAVAILABLE';
  if (status === 2) return 'SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED';
  if (status === 3) return 'SDK_AVAILABLE';
  return `UNKNOWN_${status}`;
}

function requireHealthConnect(): HealthConnectAPI | null {
  if (Platform.OS !== 'android') return null;
  if (hcModule) return hcModule;
  if (hcLoadAttempted) return null;
  hcLoadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-health-connect');
    if (typeof mod?.getSdkStatus !== 'function') {
      glowLogger.debug('react-native-health-connect API unavailable', {
        exports: mod ? Object.keys(mod) : [],
      });
      return null;
    }
    hcModule = mod as HealthConnectAPI;
    return hcModule;
  } catch (e) {
    glowLogger.debug('react-native-health-connect not installed; HC disabled', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Ensure the Health Connect native client is initialized. Memoized so we
 * only pay the IPC cost once per process; on failure we clear the promise
 * so the next caller gets a fresh attempt (the SDK can become available
 * mid-session if the user just installed Health Connect from the Play
 * Store dialog).
 */
async function ensureInitialized(hc: HealthConnectAPI): Promise<boolean> {
  if (!hcInitPromise) {
    hcInitPromise = (async () => {
      try {
        const ok = await hc.initialize();
        if (!ok) {
          glowLogger.warn('Health Connect initialize() returned false', {});
        }
        return ok;
      } catch (e) {
        glowLogger.warn('Health Connect initialize() threw', {
          error: e instanceof Error ? e.message : String(e),
        });
        return false;
      }
    })();
  }
  const ok = await hcInitPromise;
  if (!ok) hcInitPromise = null;
  return ok;
}

const SDK_AVAILABLE = 3;

/**
 * Returns `true` only when running on Android, the module is loaded, and the
 * Health Connect SDK is in the AVAILABLE state (= app installed and
 * up-to-date). UI uses this to decide whether to render the connect row.
 */
export async function isHealthConnectAvailable(): Promise<boolean> {
  const hc = requireHealthConnect();
  if (!hc) {
    if (!loggedHcNativeModuleMissing) {
      loggedHcNativeModuleMissing = true;
      glowLogger.warn('Health Connect availability: native module missing', {
        hint: 'Expo Go and non-Android builds have no react-native-health-connect native code.',
      });
    }
    return false;
  }
  try {
    const status = await hc.getSdkStatus();
    const available = (hc.SdkAvailabilityStatus?.SDK_AVAILABLE ?? SDK_AVAILABLE);
    const ok = status === available;
    const snap = { ok, status };
    const changed =
      !lastHcAvailabilitySnapshot ||
      lastHcAvailabilitySnapshot.ok !== snap.ok ||
      lastHcAvailabilitySnapshot.status !== snap.status;
    if (changed) {
      lastHcAvailabilitySnapshot = snap;
      glowLogger.info('Health Connect SDK availability (getSdkStatus)', {
        sdk_status: status,
        sdk_status_label: describeSdkStatusCode(status),
        expected_available_code: available,
        available_to_app: ok,
        note: ok
          ? 'Underforge will show Health Connect as connectable.'
          : 'Underforge shows Health Connect unavailable even if the HC settings app opens — update/install HC from Play or use a Play-enabled system image on emulators.',
      });
    }
    return ok;
  } catch (e) {
    lastHcAvailabilitySnapshot = null;
    glowLogger.warn('Health Connect getSdkStatus threw', {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/**
 * Initialize the HC SDK and ask the user for read permissions over the
 * record types we care about. Returns true only if every required permission
 * was granted (partial grants behave like a denial here so we don't end up
 * with a half-broken sync silently importing the wrong subset).
 */
export async function requestHealthConnectPermissions(): Promise<boolean> {
  const hc = requireHealthConnect();
  if (!hc) return false;
  try {
    const initialized = await ensureInitialized(hc);
    if (!initialized) {
      glowLogger.warn('Health Connect requestPermission skipped: initialize() failed', {});
      return false;
    }
    glowLogger.info('Health Connect opening system permission UI', {
      record_types_requested: REQUIRED_RECORD_TYPES.length,
    });
    const granted = await hc.requestPermission(
      REQUIRED_RECORD_TYPES.map((recordType) => ({ accessType: 'read' as const, recordType })),
    );
    const grantedTypes = new Set(granted.map((p) => p.recordType));
    const allGranted = REQUIRED_RECORD_TYPES.every((t) => grantedTypes.has(t));
    if (!allGranted) {
      glowLogger.info('Health Connect permissions partially granted', {
        returned_rows: granted.length,
        granted: [...grantedTypes],
        missing: REQUIRED_RECORD_TYPES.filter((t) => !grantedTypes.has(t)),
      });
    } else {
      glowLogger.info('Health Connect all required read permissions granted', {});
    }
    return allGranted;
  } catch (e) {
    glowLogger.warn('Health Connect permission flow failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export interface HealthConnectSyncResult {
  workouts: number;
  stepsDays: number;
  activeEnergyDays: number;
  restingEnergyDays: number;
  sleepDays: number;
  hrvDays: number;
  rhrDays: number;
}

/**
 * Sync exercise sessions + supported daily metrics for the window
 * (now - daysBack) -> now. Each sub-sync wraps its own try/catch so a
 * denied permission for, e.g., SleepSession can never block the workout
 * pull.
 */
export async function syncHealthConnect(
  userId: string,
  opts: { daysBack?: number; force?: boolean } = {},
): Promise<HealthConnectSyncResult> {
  const empty: HealthConnectSyncResult = {
    workouts: 0,
    stepsDays: 0,
    activeEnergyDays: 0,
    restingEnergyDays: 0,
    sleepDays: 0,
    hrvDays: 0,
    rhrDays: 0,
  };
  const hc = requireHealthConnect();
  if (!hc) return empty;
  const initialized = await ensureInitialized(hc);
  if (!initialized) {
    // Don't spam the warn channel on every background tick; debug is enough.
    glowLogger.debug('Health Connect sync skipped: client not initialized', {
      user_id: userId,
    });
    return empty;
  }

  const daysBack = opts.daysBack ?? 30;
  const now = new Date();
  const cursor = opts.force ? null : await readCursor(userId);
  // Always look back at least `daysBack` days. Picking `min(cursor,
  // now - daysBack)` instead of `cursor ?? now - daysBack` ensures that
  // foreground re-syncs running seconds after a previous sync still cover
  // the last few days; otherwise the window can collapse to a few seconds
  // and miss anything Health Connect indexed late (provider sources push
  // updates with a delay).
  const minStart = new Date(now.getTime() - daysBack * 86_400_000);
  const startDate = cursor && cursor < minStart ? cursor : minStart;
  const startIso = startDate.toISOString();
  const endIso = now.toISOString();
  const window = { startTime: startIso, endTime: endIso };

  // Permissions snapshot: helps tell apart "Health Connect is empty"
  // from "we are not authorized to read these record types" when the
  // sync result comes back with all zeros.
  let grantedPermissionTypes: string[] = [];
  try {
    const granted = await hc.getGrantedPermissions();
    grantedPermissionTypes = Array.from(
      new Set(granted.map((p) => p.recordType)),
    ).sort();
  } catch (e) {
    glowLogger.debug('Could not read Health Connect granted permissions', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const weightKg = await getLatestUserWeightKg(userId);

  // Pre-flight raw record counts (force-syncs only): even if downstream
  // normalization filters things out, this tells us whether Health
  // Connect has any data at all for this user/window. The most common
  // Android user-confusion is granting Underforge permissions without
  // first enabling the "share with Health Connect" toggle inside Samsung
  // Health / Google Fit / Fitbit, which leaves the Health Connect store
  // empty. Skipped on background re-syncs to avoid the double-read cost.
  if (opts.force) {
    const rawCounts: Record<string, number> = {};
    for (const recordType of REQUIRED_RECORD_TYPES) {
      try {
        const records = await readAllRecords(hc, recordType, window);
        rawCounts[recordType] = records.length;
      } catch (e) {
        rawCounts[recordType] = -1;
        glowLogger.debug('Health Connect raw read failed', {
          record_type: recordType,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    glowLogger.info('Health Connect raw record counts', {
      user_id: userId,
      window_start: startIso,
      window_end: endIso,
      granted_permission_types: grantedPermissionTypes,
      ...rawCounts,
    });
  } else {
    glowLogger.debug('Health Connect granted permissions snapshot', {
      user_id: userId,
      granted_permission_types: grantedPermissionTypes,
    });
  }

  const result: HealthConnectSyncResult = { ...empty };
  result.workouts = await safe(
    'workouts',
    () => syncExerciseSessions(userId, hc, window, weightKg),
    0,
  );
  result.stepsDays = await safe(
    'steps',
    () => syncSteps(userId, hc, window),
    0,
  );

  const activeByDay = await safe(
    'active_energy',
    () => readDailyEnergy(hc, window, 'ActiveCaloriesBurned'),
    new Map<string, number>(),
  );
  for (const [date, kcal] of activeByDay.entries()) {
    await upsertDailyMetric({
      userId,
      metricDate: date,
      metric: 'active_energy_kcal',
      source: SOURCE,
      value: Math.round(kcal),
      confidence: 'high',
    });
    await resolveCanonicalDailyMetric(userId, date, 'active_energy_kcal');
  }
  result.activeEnergyDays = activeByDay.size;

  // Resting energy = total - active per local day, clamped to >= 0.
  // HC doesn't expose basal directly through this list; deriving from
  // `TotalCaloriesBurned - ActiveCaloriesBurned` is the standard pattern.
  const totalByDay = await safe(
    'total_energy',
    () => readDailyEnergy(hc, window, 'TotalCaloriesBurned'),
    new Map<string, number>(),
  );
  let restingDays = 0;
  for (const [date, total] of totalByDay.entries()) {
    const active = activeByDay.get(date) ?? 0;
    const resting = Math.max(0, Math.round(total - active));
    if (resting <= 0) continue;
    await upsertDailyMetric({
      userId,
      metricDate: date,
      metric: 'resting_energy_kcal',
      source: SOURCE,
      value: resting,
      confidence: 'medium',
    });
    await resolveCanonicalDailyMetric(userId, date, 'resting_energy_kcal');
    restingDays++;
  }
  result.restingEnergyDays = restingDays;

  result.sleepDays = await safe(
    'sleep',
    () => syncSleep(userId, hc, window),
    0,
  );
  result.hrvDays = await safe(
    'hrv',
    () => syncHrv(userId, hc, window),
    0,
  );
  result.rhrDays = await safe(
    'rhr',
    () => syncRhr(userId, hc, window),
    0,
  );

  await writeCursor(userId, now);
  await markConnectionActive(userId);

  glowLogger.info('Health Connect sync complete', {
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
    glowLogger.warn(`Health Connect ${label} sync failed`, {
      error: e instanceof Error ? e.message : String(e),
    });
    return fallback;
  }
}

// ---- internal: workouts ------------------------------------------------

async function syncExerciseSessions(
  userId: string,
  hc: HealthConnectAPI,
  window: { startTime: string; endTime: string },
  weightKg: number | undefined,
): Promise<number> {
  const records = await readAllRecords(hc, 'ExerciseSession', window);
  let inserted = 0;
  for (const r of records) {
    try {
      const normalized = normalizeExerciseSession(userId, r, weightKg);
      if (!normalized) continue;
      const hcEx =
        typeof r?.exerciseType === 'number' ? (r.exerciseType as number) : undefined;
      const res = await importExternalActivityLog({
        userId,
        source: SOURCE,
        externalId: normalized.externalId!,
        activityDate: normalized.activityDate,
        activityType: mapHealthConnectExerciseTypeToActivityType(
          hcEx,
          normalized.activityCategory,
        ),
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
      glowLogger.warn('Failed to import Health Connect exercise session', {
        error: e instanceof Error ? e.message : String(e),
        external_id: r?.metadata?.id,
      });
    }
  }
  return inserted;
}

function normalizeExerciseSession(
  userId: string,
  r: any,
  weightKg: number | undefined,
): NormalizedActivity | null {
  const externalId: string | undefined = r?.metadata?.id;
  const startTime: string | undefined = r?.startTime;
  const endTime: string | undefined = r?.endTime;
  if (!externalId || !startTime || !endTime) return null;

  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (durationMinutes <= 0) return null;

  const exerciseType: number | undefined = typeof r?.exerciseType === 'number' ? r.exerciseType : undefined;
  const title: string | undefined = typeof r?.title === 'string' ? r.title : undefined;
  const category = mapHealthConnectExerciseToCategory(exerciseType, title);
  const activityDate = toLocalYmd(start);

  // HC ExerciseSession doesn't carry calories on the record itself; we let
  // `reconcileProviderCalories` fall back to MET estimation. Active calories
  // for the day are tracked separately on `active_energy_kcal`.
  const reconciled = reconcileProviderCalories(undefined, {
    category,
    durationMinutes,
    weightKg,
  });

  return {
    userId,
    source: SOURCE,
    externalId,
    activityDate,
    startedAt: startTime,
    endedAt: endTime,
    durationMinutes,
    activityCategory: category,
    activityName: title ?? exerciseTypeName(exerciseType) ?? 'Workout',
    caloriesBurned: reconciled.caloriesBurned,
    caloriesSource: reconciled.caloriesSource,
    caloriesConfidence: reconciled.caloriesConfidence,
    dedupeFingerprint: dedupeFingerprint(startTime, category, durationMinutes),
  };
}

function exerciseTypeName(exerciseType: number | undefined): string | undefined {
  if (exerciseType == null) return undefined;
  // Prefer specific labels when the HC enum is unambiguous (category fallbacks are coarse).
  if (exerciseType === 79) return 'Walk';
  const cat = mapHealthConnectExerciseToCategory(exerciseType, undefined);
  switch (cat) {
    case 'running': return 'Run';
    case 'hiking': return 'Hike';
    case 'cycling': return 'Cycling';
    case 'swimming': return 'Swim';
    case 'winter_sports': return 'Winter sport';
    case 'racket_sports': return 'Racket sport';
    case 'team_sports': return 'Team sport';
    case 'water_sports': return 'Water sport';
    case 'martial_arts': return 'Martial arts';
    case 'mind_body': return 'Mind & body';
    case 'gym_cardio': return 'Gym / cardio';
    case 'outdoor': return 'Outdoor';
    default: return 'Workout';
  }
}

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

/** HC-specific: disambiguate category defaults using `ExerciseSessionRecord` ids. */
function mapHealthConnectExerciseTypeToActivityType(
  exerciseType: number | undefined,
  category: ActivityCategory,
): string {
  if (exerciseType === 79) return 'walk'; // EXERCISE_TYPE_WALKING
  return mapCategoryToActivityType(category);
}

// ---- internal: daily metrics ------------------------------------------

async function syncSteps(
  userId: string,
  hc: HealthConnectAPI,
  window: { startTime: string; endTime: string },
): Promise<number> {
  const records = await readAllRecords(hc, 'Steps', window);
  const byDay = new Map<string, number>();
  for (const r of records) {
    const endTime: string | undefined = r?.endTime ?? r?.startTime;
    const count = typeof r?.count === 'number' ? r.count : 0;
    if (!endTime || count <= 0) continue;
    const d = toLocalYmd(new Date(endTime));
    byDay.set(d, (byDay.get(d) ?? 0) + count);
  }
  let updatedDays = 0;
  for (const [date, value] of byDay.entries()) {
    await upsertDailyMetric({
      userId,
      metricDate: date,
      metric: 'steps',
      source: SOURCE,
      value: Math.round(value),
      confidence: 'high',
    });
    await resolveCanonicalDailyMetric(userId, date, 'steps');
    updatedDays++;
  }
  return updatedDays;
}

/**
 * Read calorie records for a window and reduce to (local YMD -> kcal).
 * `recordType` is one of the energy interval records; energy values are
 * normalized to kilocalories via the record's `energy.unit`.
 *
 * Returns a Map even on success so callers can compose results without
 * branching on null.
 */
async function readDailyEnergy(
  hc: HealthConnectAPI,
  window: { startTime: string; endTime: string },
  recordType: 'ActiveCaloriesBurned' | 'TotalCaloriesBurned',
): Promise<Map<string, number>> {
  const records = await readAllRecords(hc, recordType, window);
  const byDay = new Map<string, number>();
  for (const r of records) {
    const endTime: string | undefined = r?.endTime ?? r?.startTime;
    const energy = r?.energy;
    if (!endTime || !energy || typeof energy.value !== 'number') continue;
    const kcal = energyToKcal(energy.value, energy.unit);
    const d = toLocalYmd(new Date(endTime));
    byDay.set(d, (byDay.get(d) ?? 0) + kcal);
  }
  return byDay;
}

function energyToKcal(value: number, unit: string | undefined): number {
  switch (unit) {
    case 'kilocalories': return value;
    case 'calories': return value / 1000;
    case 'kilojoules': return value / 4.184;
    case 'joules': return value / 4184;
    default: return value;
  }
}

async function syncSleep(
  userId: string,
  hc: HealthConnectAPI,
  window: { startTime: string; endTime: string },
): Promise<number> {
  const records = await readAllRecords(hc, 'SleepSession', window);

  type Bucket = { asleepMin: number; awakeInBedMin: number };
  const byNight = new Map<string, Bucket>();
  for (const session of records) {
    const start: string | undefined = session?.startTime;
    const end: string | undefined = session?.endTime;
    if (!start || !end) continue;
    const dayKey = toLocalYmd(new Date(end));
    const bucket = byNight.get(dayKey) ?? { asleepMin: 0, awakeInBedMin: 0 };

    const stages: Array<{ startTime: string; endTime: string; stage: number }> | undefined = session.stages;
    if (Array.isArray(stages) && stages.length > 0) {
      for (const stage of stages) {
        const sm = minutesBetween(stage.startTime, stage.endTime);
        if (sm <= 0) continue;
        const tag = sleepStageTag(stage.stage);
        if (tag === 'asleep') bucket.asleepMin += sm;
        else if (tag === 'awake_in_bed') bucket.awakeInBedMin += sm;
      }
    } else {
      // No stage breakdown: treat the whole session as asleep.
      const sm = minutesBetween(start, end);
      bucket.asleepMin += sm;
    }
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

async function syncHrv(
  userId: string,
  hc: HealthConnectAPI,
  window: { startTime: string; endTime: string },
): Promise<number> {
  const records = await readAllRecords(hc, 'HeartRateVariabilityRmssd', window);
  return upsertDailyAverage(
    userId,
    records.map((r) => ({
      time: r?.time,
      value: typeof r?.heartRateVariabilityMillis === 'number' ? r.heartRateVariabilityMillis : undefined,
    })),
    'hrv_rmssd_ms',
  );
}

async function syncRhr(
  userId: string,
  hc: HealthConnectAPI,
  window: { startTime: string; endTime: string },
): Promise<number> {
  const records = await readAllRecords(hc, 'RestingHeartRate', window);
  return upsertDailyAverage(
    userId,
    records.map((r) => ({
      time: r?.time,
      value: typeof r?.beatsPerMinute === 'number' ? r.beatsPerMinute : undefined,
    })),
    'resting_hr_bpm',
  );
}

async function upsertDailyAverage(
  userId: string,
  samples: { time: string | undefined; value: number | undefined }[],
  metric: NormalizedDailyMetric['metric'],
): Promise<number> {
  const byDay = new Map<string, { sum: number; n: number }>();
  for (const s of samples) {
    if (!s.time || typeof s.value !== 'number' || !Number.isFinite(s.value)) continue;
    const d = toLocalYmd(new Date(s.time));
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

// ---- internal: pagination + helpers ----------------------------------

const HC_PAGE_SIZE = 1000;
const HC_MAX_PAGES = 20;

async function readAllRecords(
  hc: HealthConnectAPI,
  recordType: string,
  window: { startTime: string; endTime: string },
): Promise<any[]> {
  const out: any[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < HC_MAX_PAGES; page++) {
    const res = await hc.readRecords(recordType, {
      timeRangeFilter: { operator: 'between', startTime: window.startTime, endTime: window.endTime },
      pageSize: HC_PAGE_SIZE,
      pageToken,
      ascendingOrder: true,
    });
    if (Array.isArray(res?.records)) out.push(...res.records);
    if (!res?.pageToken || res.pageToken === pageToken) break;
    pageToken = res.pageToken;
  }
  return out;
}

function minutesBetween(startIso: string | undefined, endIso: string | undefined): number {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, (end - start) / 60_000);
}

// ---- internal: connection bookkeeping ---------------------------------

async function readCursor(userId: string): Promise<Date | null> {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ last_sync_cursor: string | null }>(
      `SELECT last_sync_cursor FROM user_provider_connections
        WHERE user_id = ? AND provider = 'healthconnect'`,
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
       VALUES (?, 'healthconnect', 'active', ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         last_sync_at = excluded.last_sync_at,
         last_sync_cursor = excluded.last_sync_cursor,
         status = 'active',
         last_error = NULL`,
      [userId, iso, iso, iso],
    );
  } catch (e) {
    glowLogger.warn('Failed to persist Health Connect sync cursor', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function markConnectionActive(userId: string): Promise<void> {
  try {
    const db = getDatabase();
    await db.runAsync(
      `INSERT OR IGNORE INTO user_provider_connections (user_id, provider, status, connected_at)
       VALUES (?, 'healthconnect', 'active', ?)`,
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

/**
 * Open the Android Health Connect Settings app so the user can manage
 * granted permissions / disconnect this app.
 */
export function openHealthConnectSettings(): void {
  const hc = requireHealthConnect();
  if (!hc) return;
  try {
    hc.openHealthConnectSettings?.();
  } catch (e) {
    glowLogger.warn('openHealthConnectSettings failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
