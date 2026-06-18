// Whoop webhook receiver.
//
// Webhook body shape (https://developer.whoop.com/docs/webhooks):
//   {
//     "user_id": 12345,
//     "id": 98765,
//     "type": "workout.updated" | "workout.deleted"
//           | "sleep.updated"   | "sleep.deleted"
//           | "recovery.updated"| "recovery.deleted"
//           | "cycle.updated"   ...
//     "trace_id": "..."
//   }
//
// We verify the HMAC signature, log the raw payload, fetch the full
// detail from the Whoop API using the user's stored tokens, and upsert
// into `activity_logs` (workouts) or `daily_metrics` (sleep/recovery).

import { corsHeaders } from '../_shared/cors.ts';
import {
  adminClient,
  fetchWhoopConnectionByExternalId,
  verifyWhoopSignature,
  whoopFetch,
  type WhoopConnection,
} from '../_shared/whoop.ts';
import {
  normalizeWhoopRecovery,
  normalizeWhoopSleep,
  normalizeWhoopWorkout,
  type WhoopRecoveryPayload,
  type WhoopSleepPayload,
} from '../_shared/normalize.ts';
import {
  storeRawPayload,
  upsertActivity,
  upsertDailyMetricAndResolve,
} from '../_shared/ingest.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const rawBody = await req.text();
  const sigOk = await verifyWhoopSignature(
    rawBody,
    req.headers.get('x-whoop-signature'),
    req.headers.get('x-whoop-signature-timestamp'),
  );
  if (!sigOk) {
    return new Response('bad signature', { status: 401 });
  }

  let event: { user_id: number | string; id: number | string; type: string; trace_id?: string };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const started = Date.now();
  const supabase = adminClient();

  try {
    const conn = await fetchWhoopConnectionByExternalId(supabase, String(event.user_id));
    if (!conn) {
      // No connection for this external user - Whoop retries webhooks a few
      // times, and the user may have disconnected. 200 so Whoop stops retrying.
      return logAndRespond('no_connection', started, 200);
    }

    // If the user has disconnected (or the connection is in an error state),
    // skip ingestion. Whoop occasionally emits webhooks during the brief
    // window between their server-side revocation processing and our
    // `providers-disconnect` flip, and this guard prevents stale workouts /
    // metrics from being re-imported after the user explicitly disconnected.
    // 200 so Whoop drops the event from its retry queue.
    if (conn.status !== 'active') {
      return logAndRespond('connection_inactive', started, 200);
    }

    if (event.type.startsWith('workout.')) {
      return await handleWorkoutEvent(supabase, conn, event, rawBody, started);
    }
    if (event.type.startsWith('sleep.')) {
      return await handleSleepEvent(supabase, conn, event, rawBody, started);
    }
    if (event.type.startsWith('recovery.')) {
      return await handleRecoveryEvent(supabase, conn, event, rawBody, started);
    }

    // Unhandled event type - log the payload and ack so Whoop doesn't retry.
    await storeRawPayload(supabase, {
      user_id: conn.user_id,
      provider: 'whoop',
      kind: 'other',
      external_id: String(event.id),
      payload: JSON.parse(rawBody),
    });
    return logAndRespond('ignored', started, 200);
  } catch (e) {
    console.error('whoop webhook error', e instanceof Error ? e.message : String(e));
    return logAndRespond('error', started, 500);
  }
});

async function handleWorkoutEvent(
  supabase: ReturnType<typeof adminClient>,
  conn: WhoopConnection,
  event: { id: number | string; type: string },
  rawBody: string,
  started: number,
): Promise<Response> {
  const userId = conn.user_id;

  if (event.type === 'workout.deleted') {
    await supabase
      .from('activity_logs')
      .delete()
      .eq('user_id', userId)
      .eq('source', 'whoop')
      .eq('external_id', String(event.id));
    return logAndRespond('workout_deleted', started, 200);
  }

  // Fetch the full workout detail. Whoop emits per-workout webhooks for
  // creates + updates, but the event payload is metadata-only.
  const res = await whoopFetch(supabase, conn, `/v2/activity/workout/${event.id}`);
  if (!res.ok) {
    console.warn('whoop workout fetch failed', res.status);
    return logAndRespond('fetch_failed', started, 200);
  }
  const detail = await res.json();

  const payloadId = await storeRawPayload(supabase, {
    user_id: userId,
    provider: 'whoop',
    kind: 'workout',
    external_id: String(event.id),
    payload: { event: JSON.parse(rawBody), detail },
  });

  const weightKg = await lookupUserWeightKg(supabase, userId);
  const normalized = normalizeWhoopWorkout(userId, detail, weightKg);
  if (!normalized) return logAndRespond('normalize_failed', started, 200);

  await upsertActivity(supabase, normalized, payloadId);

  // If the workout is a step-bearing modality (walk/run/hike), re-aggregate
  // estimated steps for the activity date so home + trends pick it up live.
  // Active energy still comes from the `cycle` endpoint (handled by sync).
  await reaggregateWhoopStepsForDateWebhook(supabase, userId, normalized.activity_date);

  return logAndRespond('workout_upserted', started, 200);
}

/**
 * Same logic as `providers-sync` but inlined here to avoid circular imports
 * between edge functions. Sums distance-derived step estimates for every
 * stored Whoop walk/run/hike on `metric_date` and upserts to daily_metrics.
 */
async function reaggregateWhoopStepsForDateWebhook(
  supabase: ReturnType<typeof adminClient>,
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
    console.error('webhook step reaggregate failed', error.message);
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

async function handleSleepEvent(
  supabase: ReturnType<typeof adminClient>,
  conn: WhoopConnection,
  event: { id: number | string; type: string },
  rawBody: string,
  started: number,
): Promise<Response> {
  const userId = conn.user_id;

  if (event.type === 'sleep.deleted') {
    // No hard delete on daily_metrics — let the next poll overwrite or the
    // canonical resolver demote a stale row. Just record the event.
    await storeRawPayload(supabase, {
      user_id: userId,
      provider: 'whoop',
      kind: 'sleep',
      external_id: String(event.id),
      payload: JSON.parse(rawBody),
    });
    return logAndRespond('sleep_deleted', started, 200);
  }

  const res = await whoopFetch(supabase, conn, `/v2/activity/sleep/${event.id}`);
  if (!res.ok) {
    console.warn('whoop sleep fetch failed', res.status);
    return logAndRespond('fetch_failed', started, 200);
  }
  const detail = (await res.json()) as WhoopSleepPayload;

  const payloadId = await storeRawPayload(supabase, {
    user_id: userId,
    provider: 'whoop',
    kind: 'sleep',
    external_id: String(event.id),
    payload: { event: JSON.parse(rawBody), detail },
  });

  const norm = normalizeWhoopSleep(detail);
  if (!norm) return logAndRespond('sleep_skipped', started, 200);

  if (norm.total_min !== null) {
    await upsertDailyMetricAndResolve(supabase, {
      user_id: userId,
      metric_date: norm.metric_date,
      metric: 'sleep_total_min',
      source: 'whoop',
      value: norm.total_min,
      confidence: 'high',
      payload_id: payloadId,
    });
  }
  if (norm.efficiency_pct !== null) {
    await upsertDailyMetricAndResolve(supabase, {
      user_id: userId,
      metric_date: norm.metric_date,
      metric: 'sleep_efficiency_pct',
      source: 'whoop',
      value: norm.efficiency_pct,
      confidence: 'high',
      payload_id: payloadId,
    });
  }
  return logAndRespond('sleep_upserted', started, 200);
}

async function handleRecoveryEvent(
  supabase: ReturnType<typeof adminClient>,
  conn: WhoopConnection,
  event: { id: number | string; type: string },
  rawBody: string,
  started: number,
): Promise<Response> {
  const userId = conn.user_id;

  if (event.type === 'recovery.deleted') {
    await storeRawPayload(supabase, {
      user_id: userId,
      provider: 'whoop',
      kind: 'recovery',
      external_id: String(event.id),
      payload: JSON.parse(rawBody),
    });
    return logAndRespond('recovery_deleted', started, 200);
  }

  // v2 recovery webhooks are keyed by the associated sleep UUID, not the
  // cycle ID. Fetch the sleep first to obtain cycle_id, then fetch recovery.
  const sleepRes = await whoopFetch(supabase, conn, `/v2/activity/sleep/${event.id}`);
  if (!sleepRes.ok) {
    console.warn('whoop recovery sleep fetch failed', sleepRes.status);
    return logAndRespond('fetch_failed', started, 200);
  }
  const sleep = (await sleepRes.json()) as WhoopSleepPayload;
  if (!sleep.cycle_id) {
    return logAndRespond('recovery_missing_cycle', started, 200);
  }

  const recoveryRes = await whoopFetch(supabase, conn, `/v2/cycle/${sleep.cycle_id}/recovery`);
  if (!recoveryRes.ok) {
    console.warn('whoop recovery fetch failed', recoveryRes.status);
    return logAndRespond('fetch_failed', started, 200);
  }
  const detail = (await recoveryRes.json()) as WhoopRecoveryPayload;

  const payloadId = await storeRawPayload(supabase, {
    user_id: userId,
    provider: 'whoop',
    kind: 'recovery',
    external_id: String(event.id),
    payload: { event: JSON.parse(rawBody), sleep, detail },
  });

  const norm = normalizeWhoopRecovery(detail);
  if (!norm) return logAndRespond('recovery_skipped', started, 200);

  if (norm.recovery_score !== null) {
    await upsertDailyMetricAndResolve(supabase, {
      user_id: userId,
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
      user_id: userId,
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
      user_id: userId,
      metric_date: norm.metric_date,
      metric: 'hrv_rmssd_ms',
      source: 'whoop',
      value: norm.hrv_rmssd_ms,
      confidence: 'high',
      payload_id: payloadId,
    });
  }
  return logAndRespond('recovery_upserted', started, 200);
}

async function lookupUserWeightKg(
  supabase: ReturnType<typeof adminClient>,
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

function logAndRespond(outcome: string, started: number, status: number): Response {
  console.log(JSON.stringify({
    provider: 'whoop',
    outcome,
    latency_ms: Date.now() - started,
  }));
  return new Response(JSON.stringify({ status: outcome }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
