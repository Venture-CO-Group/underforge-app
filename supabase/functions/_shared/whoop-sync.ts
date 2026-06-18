// Per-connection Whoop sync logic, shared between:
//   - `providers-sync`         — the hourly cron sweep across every active
//                                Whoop connection.
//   - `providers-oauth-callback` — the inline backfill that runs the moment
//                                a user finishes the OAuth flow, so they
//                                see their workouts/sleep/recovery without
//                                waiting up to an hour for the cron tick.
//
// Keeping a single implementation here means the OAuth callback doesn't
// have to make a function-to-function HTTP call (which has historically
// been flaky in Supabase's Edge runtime due to the gateway's JWT layer
// and 60s timeouts cascading), and there's no risk of the two paths
// drifting in subtle behaviour (page sizes, cursor handling, error
// shape, etc.).

import {
  type SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2';
import { whoopFetch, type WhoopConnection } from './whoop.ts';
import {
  estimateWhoopWorkoutSteps,
  normalizeWhoopRecovery,
  normalizeWhoopSleep,
  normalizeWhoopWorkout,
  toLocalYmd,
  type WhoopRecoveryPayload,
  type WhoopSleepPayload,
  type WhoopWorkoutPayload,
} from './normalize.ts';
import {
  storeRawPayload,
  upsertActivity,
  upsertDailyMetricAndResolve,
} from './ingest.ts';

// Days of history to pull for a brand-new connection. Configurable per
// deployment via env so we can dial it up for power users without
// redeploying. Cron and OAuth backfill share the same value.
export const INITIAL_BACKFILL_DAYS = (() => {
  const raw = Number(Deno.env.get('WHOOP_INITIAL_BACKFILL_DAYS') ?? '');
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 365) : 90;
})();

// Per-page page size for Whoop list endpoints (max 25 per the v1 docs).
const PAGE_SIZE = 25;
// Hard cap on pages per endpoint per run, to keep a single tick bounded.
const MAX_PAGES = 30;

// Reference the helper so the linter knows it's used by the normalize
// module's contract; no-op at runtime.
void estimateWhoopWorkoutSteps;

export interface SyncResult {
  workouts: number;
  cycles: number;
  sleep: number;
  recovery: number;
}

/**
 * Sync everything for a single Whoop connection. The caller is
 * responsible for fetching the row from `user_provider_connections`
 * and for updating `last_sync_at` / `last_sync_cursor` / `last_error`
 * after this resolves. Throws on the first irrecoverable Whoop error
 * so the caller can mark `status='error'` and surface the message.
 */
export async function syncWhoopForConnection(
  supabase: SupabaseClient,
  conn: WhoopConnection & { last_sync_cursor: string | null },
  windowEnd: Date = new Date(),
): Promise<SyncResult> {
  const windowStart = conn.last_sync_cursor
    ? new Date(conn.last_sync_cursor)
    : new Date(windowEnd.getTime() - INITIAL_BACKFILL_DAYS * 24 * 60 * 60 * 1000);

  const [workouts, cycles, sleep, recovery] = await Promise.all([
    syncWhoopWorkouts(supabase, conn, windowStart, windowEnd),
    syncWhoopCycles(supabase, conn, windowStart, windowEnd),
    syncWhoopSleep(supabase, conn, windowStart, windowEnd),
    syncWhoopRecoveries(supabase, conn, windowStart, windowEnd),
  ]);

  return { workouts, cycles, sleep, recovery };
}

/**
 * Walk a paginated Whoop list endpoint, yielding every record across
 * pages. Stops at MAX_PAGES even if Whoop keeps returning a `next_token`,
 * to keep each tick bounded.
 */
async function* iterateWhoopRecords<T>(
  supabase: SupabaseClient,
  conn: WhoopConnection,
  basePath: string,
  since: Date,
  until: Date,
): AsyncGenerator<T, void, unknown> {
  let nextToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      start: since.toISOString(),
      end: until.toISOString(),
      limit: String(PAGE_SIZE),
    });
    if (nextToken) params.set('nextToken', nextToken);
    const res = await whoopFetch(supabase, conn, `${basePath}?${params.toString()}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Whoop ${basePath} fetch failed: ${res.status} ${body.slice(0, 240)}`);
    }
    const body = await res.json();
    const records: T[] = body?.records ?? [];
    for (const r of records) yield r;
    nextToken = typeof body?.next_token === 'string' && body.next_token ? body.next_token : null;
    if (!nextToken) return;
  }
}

async function syncWhoopWorkouts(
  supabase: SupabaseClient,
  conn: WhoopConnection,
  since: Date,
  until: Date,
): Promise<number> {
  const weightKg = await lookupUserWeightKg(supabase, conn.user_id);
  let upserted = 0;
  // Days touched by this sync window — we'll re-aggregate Whoop step
  // estimates per date afterwards so partial syncs stay idempotent.
  const datesAffected = new Set<string>();
  for await (const w of iterateWhoopRecords<WhoopWorkoutPayload>(
    supabase,
    conn,
    '/v2/activity/workout',
    since,
    until,
  )) {
    const normalized = normalizeWhoopWorkout(conn.user_id, w, weightKg);
    if (!normalized) continue;
    const payloadId = await storeRawPayload(supabase, {
      user_id: conn.user_id,
      provider: 'whoop',
      kind: 'workout',
      external_id: String(w.id),
      payload: w,
    });
    await upsertActivity(supabase, normalized, payloadId);
    datesAffected.add(normalized.activity_date);
    upserted++;
  }

  // After the upserts above are visible, re-derive estimated steps for
  // each affected date by summing all *currently stored* Whoop walk/run/
  // hike workouts for that date. Keeps re-syncs and partial windows
  // correct.
  for (const date of datesAffected) {
    await reaggregateWhoopStepsForDate(supabase, conn.user_id, date);
  }
  return upserted;
}

async function reaggregateWhoopStepsForDate(
  supabase: SupabaseClient,
  userId: string,
  metricDate: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('activity_type, distance_value, distance_unit')
    .eq('user_id', userId)
    .eq('source', 'whoop')
    .eq('activity_date', metricDate)
    .neq('status', 'deleted');
  if (error) {
    console.error('reaggregateWhoopStepsForDate select failed', error.message);
    return;
  }

  let totalSteps = 0;
  for (const row of data ?? []) {
    const at = String(row.activity_type ?? '').toLowerCase();
    let stepsPerKm: number | null = null;
    if (at === 'run') stepsPerKm = 950;
    else if (at === 'hike') stepsPerKm = 1300;
    else if (at === 'walk') stepsPerKm = 1400;
    if (stepsPerKm == null) continue;

    const dv = Number(row.distance_value);
    if (!Number.isFinite(dv) || dv <= 0) continue;
    const km = row.distance_unit === 'mi' ? dv * 1.609344 : dv;
    totalSteps += Math.round(km * stepsPerKm);
  }

  if (totalSteps <= 0) return;

  await upsertDailyMetricAndResolve(supabase, {
    user_id: userId,
    metric_date: metricDate,
    metric: 'steps',
    source: 'whoop',
    value: totalSteps,
    confidence: 'low',
    payload_id: null,
  });
}

async function syncWhoopCycles(
  supabase: SupabaseClient,
  conn: WhoopConnection,
  since: Date,
  until: Date,
): Promise<number> {
  // Whoop "cycle" = a physiological day. `score.kilojoule` is active energy.
  let days = 0;
  for await (const c of iterateWhoopRecords<{
    id: number;
    start: string;
    end: string;
    score?: { kilojoule?: number };
  }>(supabase, conn, '/v2/cycle', since, until)) {
    const kj = c.score?.kilojoule;
    if (typeof kj !== 'number' || kj <= 0) continue;
    const kcal = Math.round(kj / 4.184);
    const date = toLocalYmd(c.start);
    const payloadId = await storeRawPayload(supabase, {
      user_id: conn.user_id,
      provider: 'whoop',
      kind: 'active_energy',
      external_id: String(c.id),
      payload: c,
    });
    await upsertDailyMetricAndResolve(supabase, {
      user_id: conn.user_id,
      metric_date: date,
      metric: 'active_energy_kcal',
      source: 'whoop',
      value: kcal,
      confidence: 'high',
      payload_id: payloadId,
    });
    days++;
  }
  return days;
}

async function syncWhoopSleep(
  supabase: SupabaseClient,
  conn: WhoopConnection,
  since: Date,
  until: Date,
): Promise<number> {
  // Collapse to the longest main-night sleep per metric_date so a user
  // with a midnight nap + main sleep ending the same morning doesn't get
  // two competing rows for the same (user, metric, date, source).
  const bestByDate = new Map<string, {
    id: string;
    raw: WhoopSleepPayload;
    total_min: number | null;
    efficiency_pct: number | null;
  }>();

  for await (const s of iterateWhoopRecords<WhoopSleepPayload>(
    supabase,
    conn,
    '/v2/activity/sleep',
    since,
    until,
  )) {
    const norm = normalizeWhoopSleep(s);
    if (!norm) continue;
    const existing = bestByDate.get(norm.metric_date);
    const candidateMin = norm.total_min ?? 0;
    const existingMin = existing?.total_min ?? 0;
    if (!existing || candidateMin > existingMin) {
      bestByDate.set(norm.metric_date, {
        id: String(s.id),
        raw: s,
        total_min: norm.total_min,
        efficiency_pct: norm.efficiency_pct,
      });
    }
  }

  let upserted = 0;
  for (const [date, best] of bestByDate.entries()) {
    const payloadId = await storeRawPayload(supabase, {
      user_id: conn.user_id,
      provider: 'whoop',
      kind: 'sleep',
      external_id: best.id,
      payload: best.raw,
    });
    if (best.total_min !== null) {
      await upsertDailyMetricAndResolve(supabase, {
        user_id: conn.user_id,
        metric_date: date,
        metric: 'sleep_total_min',
        source: 'whoop',
        value: best.total_min,
        confidence: 'high',
        payload_id: payloadId,
      });
    }
    if (best.efficiency_pct !== null) {
      await upsertDailyMetricAndResolve(supabase, {
        user_id: conn.user_id,
        metric_date: date,
        metric: 'sleep_efficiency_pct',
        source: 'whoop',
        value: best.efficiency_pct,
        confidence: 'high',
        payload_id: payloadId,
      });
    }
    upserted++;
  }
  return upserted;
}

async function syncWhoopRecoveries(
  supabase: SupabaseClient,
  conn: WhoopConnection,
  since: Date,
  until: Date,
): Promise<number> {
  let upserted = 0;
  for await (const r of iterateWhoopRecords<WhoopRecoveryPayload>(
    supabase,
    conn,
    '/v2/recovery',
    since,
    until,
  )) {
    const norm = normalizeWhoopRecovery(r);
    if (!norm) continue;
    const payloadId = await storeRawPayload(supabase, {
      user_id: conn.user_id,
      provider: 'whoop',
      kind: 'recovery',
      external_id: `${r.cycle_id}`,
      payload: r,
    });

    if (norm.recovery_score !== null) {
      await upsertDailyMetricAndResolve(supabase, {
        user_id: conn.user_id,
        metric_date: norm.metric_date,
        metric: 'recovery_score',
        source: 'whoop',
        value: norm.recovery_score,
        confidence: 'high',
        payload_id: payloadId,
      });
    }
    if (norm.resting_hr_bpm !== null) {
      await upsertDailyMetricAndResolve(supabase, {
        user_id: conn.user_id,
        metric_date: norm.metric_date,
        metric: 'resting_hr_bpm',
        source: 'whoop',
        value: norm.resting_hr_bpm,
        confidence: 'high',
        payload_id: payloadId,
      });
    }
    if (norm.hrv_rmssd_ms !== null) {
      await upsertDailyMetricAndResolve(supabase, {
        user_id: conn.user_id,
        metric_date: norm.metric_date,
        metric: 'hrv_rmssd_ms',
        source: 'whoop',
        value: norm.hrv_rmssd_ms,
        confidence: 'high',
        payload_id: payloadId,
      });
    }
    upserted++;
  }
  return upserted;
}

async function lookupUserWeightKg(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from('body_composition_log')
    .select('weight_value, weight_unit')
    .eq('user_id', userId)
    .order('log_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return 72;
  const v = Number(data.weight_value);
  if (!Number.isFinite(v) || v <= 0) return 72;
  return data.weight_unit === 'lbs' ? Math.round(v * 0.453592 * 10) / 10 : v;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const obj = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const pieces = [
      obj.message ? String(obj.message) : null,
      obj.details ? `details=${String(obj.details)}` : null,
      obj.hint ? `hint=${String(obj.hint)}` : null,
      obj.code ? `code=${String(obj.code)}` : null,
    ].filter(Boolean);
    if (pieces.length) return pieces.join(' ');
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}
