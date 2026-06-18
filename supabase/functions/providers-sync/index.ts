// Scheduled fallback poller for provider data. Runs every 60 min via
// `pg_cron` (see deploy notes below). For each active Whoop connection we
// fetch:
//   - workouts          → activity_logs (+ raw payload)
//   - cycles            → daily_metrics.active_energy_kcal
//   - sleep             → daily_metrics.sleep_total_min + sleep_efficiency_pct
//   - recovery          → daily_metrics.recovery_score + hrv_rmssd_ms + resting_hr_bpm
//
// Why poll when Whoop already pushes webhooks? Webhooks are per-event;
// daily aggregates and historical backfill are not pushed, so we need a
// periodic sweep to keep `daily_metrics` fresh and to seed the last 90 days
// of sleep/recovery on a brand-new connection. The poller is also a
// belt-and-suspenders recovery path for missed webhooks.
//
// The actual per-connection sync logic lives in `_shared/whoop-sync.ts`
// so that `providers-oauth-callback` can call it inline (no
// function-to-function HTTP hop needed) on first connect for an
// immediate backfill.
//
// Deploy cron (run once in the Supabase SQL editor):
//   select cron.schedule('providers-sync-hourly', '5 * * * *',
//     $$ select net.http_post(
//         url := 'https://<project-ref>.functions.supabase.co/providers-sync',
//         headers := '{"Authorization":"Bearer <service-role-jwt>"}'::jsonb
//       ) $$);

import { corsHeaders } from '../_shared/cors.ts';
import { adminClient, type WhoopConnection } from '../_shared/whoop.ts';
import { errorMessage, syncWhoopForConnection } from '../_shared/whoop-sync.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const started = Date.now();
  const supabase = adminClient();

  // Allow a JSON body of `{ user_id }` to scope this run to a single
  // connection. `providers-oauth-callback` no longer relies on this
  // (it calls `syncWhoopForConnection` directly), but the parameter is
  // still useful for ad-hoc debug runs:
  //   curl -X POST .../providers-sync -d '{"user_id":"<id>"}'
  let scopedUserId: string | null = null;
  if (req.method === 'POST') {
    try {
      const body = await req.clone().json();
      if (body && typeof body.user_id === 'string' && body.user_id.length > 0) {
        scopedUserId = body.user_id;
      }
    } catch {
      // No JSON body — treat as cron invocation.
    }
  }

  let query = supabase
    .from('user_provider_connections')
    .select('id,user_id,external_user_id,access_token_encrypted,refresh_token_encrypted,token_expires_at,scopes,status,last_sync_cursor')
    .eq('provider', 'whoop')
    .eq('status', 'active');
  if (scopedUserId) {
    query = query.eq('user_id', scopedUserId);
  }
  const { data: connections, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const summary: Array<{
    user_id: string;
    workouts: number;
    cycles: number;
    sleep: number;
    recovery: number;
    outcome: string;
  }> = [];

  for (const rawConn of connections ?? []) {
    const conn = rawConn as WhoopConnection & { last_sync_cursor: string | null };
    const windowEnd = new Date();
    try {
      const result = await syncWhoopForConnection(supabase, conn, windowEnd);

      await supabase
        .from('user_provider_connections')
        .update({
          last_sync_at: windowEnd.toISOString(),
          last_sync_cursor: windowEnd.toISOString(),
          last_error: null,
          status: 'active',
        })
        .eq('id', conn.id);

      summary.push({
        user_id: conn.user_id,
        workouts: result.workouts,
        cycles: result.cycles,
        sleep: result.sleep,
        recovery: result.recovery,
        outcome: 'ok',
      });
    } catch (e) {
      const msg = errorMessage(e);
      console.error('providers-sync per-user failure', { user_id: conn.user_id, err: msg });
      await supabase
        .from('user_provider_connections')
        .update({ last_error: msg.slice(0, 400), status: 'error' })
        .eq('id', conn.id);
      summary.push({
        user_id: conn.user_id,
        workouts: 0,
        cycles: 0,
        sleep: 0,
        recovery: 0,
        outcome: 'error',
      });
    }
  }

  console.log(JSON.stringify({
    provider: 'whoop',
    outcome: 'poll_complete',
    latency_ms: Date.now() - started,
    users: summary.length,
    scoped: scopedUserId ? true : false,
  }));
  return new Response(JSON.stringify({ users: summary }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
