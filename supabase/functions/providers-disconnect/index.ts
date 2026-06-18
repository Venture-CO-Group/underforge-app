// Revoke a wearable provider connection without exposing token rows to the app.
//
// Disconnect flow (Whoop or Health Connect):
//   1. Authn the caller and verify (auth_user_id ↔ user_id) ownership.
//   2. Whoop only: call Whoop's `DELETE /v2/user/access` so Whoop stops sending webhooks
//      for this user. (Without this step Whoop keeps emitting workout.updated
//      events and previous webhook code would happily ingest them.)
//      Health Connect skips this — revocation happens in the OS Settings app.
//   3. Mark `user_provider_connections` as revoked, blank out stored tokens,
//      clear sync cursor, and clear `external_user_id` (Whoop) so any in-flight
//      webhook that races with the disconnect can't find this row by external_user_id.
//   4. Hard-delete previously-imported `activity_logs`, `daily_metrics`, and
//      `provider_raw_payloads` rows that originated from this provider.
//      The user expects "disconnect" to mean "stop showing this provider's
//      data," not just "stop pulling new data."
//
// Steps 2-4 are best-effort — a failure on any one of them is logged but
// does not abort the disconnect, since the local row flip in step 3 is what
// stops our own poller (`providers-sync`) from running and the webhook guard
// (added in providers-webhook-whoop) from ingesting future events.

import { corsHeaders } from '../_shared/cors.ts';
import {
  adminClient,
  fetchWhoopConnection,
  whoopFetch,
} from '../_shared/whoop.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { user_id, provider } = body ?? {};
    if (!user_id || (provider !== 'whoop' && provider !== 'healthconnect')) {
      return new Response(JSON.stringify({ error: 'Missing user_id or unsupported provider' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = adminClient();
    const { data: profile, error: profileError } = await supabase
      .from('user_profile')
      .select('user_id')
      .eq('auth_user_id', user.id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Provider connection does not belong to the signed-in user' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 2: revoke OAuth on Whoop's side so they stop pushing webhooks.
    // Health Connect has no server-side token revoke — the client opens HC Settings.
    let whoopRevokeOutcome: 'ok' | 'no_connection' | 'error' | 'skipped' =
      provider === 'healthconnect' ? 'skipped' : 'no_connection';
    if (provider === 'whoop') {
      try {
        const conn = await fetchWhoopConnection(supabase, user_id);
        if (conn && conn.status !== 'revoked') {
          const res = await whoopFetch(supabase, conn, '/v2/user/access', { method: 'DELETE' });
          // 204 No Content is the documented success; 401 means Whoop already
          // considers the grant revoked. Both end states are acceptable.
          if (res.ok || res.status === 401) {
            whoopRevokeOutcome = 'ok';
          } else {
            whoopRevokeOutcome = 'error';
            console.warn('whoop revoke non-2xx', { status: res.status, body: await res.text() });
          }
        }
      } catch (e) {
        whoopRevokeOutcome = 'error';
        console.warn('whoop revoke failed', e instanceof Error ? e.message : String(e));
      }
    }

    // Step 3: flip status, scrub credentials, and clear external_user_id.
    // Clearing tokens means any future code that accidentally pulled this
    // row could not call `whoopFetch` against a live grant. Clearing
    // external_user_id means a stray webhook can't find this row by lookup.
    const { error: updateError } = await supabase
      .from('user_provider_connections')
      .update({
        status: 'revoked',
        last_error: null,
        access_token_encrypted: '',
        refresh_token_encrypted: '',
        external_user_id: null,
        last_sync_cursor: null,
      })
      .eq('user_id', user_id)
      .eq('provider', provider);
    if (updateError) throw updateError;

    // Step 4a: hard-delete activity_logs from this provider. The user
    // explicitly disconnected, so we leave no trace of the integration's
    // imported data — neither in Supabase nor (mirrored by the client) in
    // local SQLite.
    const { error: actErr } = await supabase
      .from('activity_logs')
      .delete()
      .eq('user_id', user_id)
      .eq('source', provider);
    if (actErr) {
      console.warn('disconnect activity_logs cleanup failed', actErr.message);
    }

    // Step 4b: purge daily_metrics rows from this provider. The canonical
    // resolver re-runs at insert time, so a future HealthKit sync (or
    // whatever else is connected) will repopulate any dates this user
    // had Whoop-only metrics for.
    const { error: dmErr } = await supabase
      .from('daily_metrics')
      .delete()
      .eq('user_id', user_id)
      .eq('source', provider);
    if (dmErr) {
      console.warn('disconnect daily_metrics cleanup failed', dmErr.message);
    }

    // Step 4c: drop the raw payload audit trail for this provider too.
    // `daily_metrics.payload_id` has ON DELETE SET NULL, so this is safe
    // to wipe without breaking referential integrity for any other rows
    // that might still reference these payloads.
    const { error: rawErr } = await supabase
      .from('provider_raw_payloads')
      .delete()
      .eq('user_id', user_id)
      .eq('provider', provider);
    if (rawErr) {
      console.warn('disconnect provider_raw_payloads cleanup failed', rawErr.message);
    }

    return new Response(
      JSON.stringify({ status: 'revoked', whoop_revoke: whoopRevokeOutcome }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
