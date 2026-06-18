// Finish the Whoop OAuth flow.
//
// Input: POST { user_id, state, code, code_verifier }
// Output: { status: 'connected', external_user_id }
//
// We exchange the authorization code + PKCE verifier for tokens, encrypt
// them, and upsert into user_provider_connections. The row becomes the
// authoritative record that future webhook/poll calls read.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { encryptToken } from '../_shared/encrypt.ts';
import {
  exchangeAuthorizationCode,
  fetchWhoopConnection,
  WHOOP_API_BASE,
} from '../_shared/whoop.ts';
import { errorMessage, syncWhoopForConnection } from '../_shared/whoop-sync.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const params = new URLSearchParams();
    for (const key of ['code', 'state', 'error', 'error_description']) {
      const value = url.searchParams.get(key);
      if (value) params.set(key, value);
    }

    return Response.redirect(`longeviq://providers-oauth-return?${params.toString()}`, 302);
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { user_id, state, code, code_verifier } = body ?? {};
    if (!user_id || !state || !code || !code_verifier) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Bind state -> user_id so a stolen code can't be exchanged for someone
    // else's account.
    if (!state.startsWith(`${user_id}:`)) {
      return new Response(JSON.stringify({ error: 'state/user_id mismatch' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
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

    const admin = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: appProfile, error: profileError } = await admin
      .from('user_profile')
      .select('user_id')
      .eq('auth_user_id', user.id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (profileError || !appProfile) {
      return new Response(JSON.stringify({ error: 'Provider connection does not belong to the signed-in user' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tokens = await exchangeAuthorizationCode(code, code_verifier);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const profileRes = await fetch(`${WHOOP_API_BASE}/v2/user/profile/basic`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const whoopProfile = profileRes.ok ? await profileRes.json() : null;
    const externalUserId = whoopProfile?.user_id ? String(whoopProfile.user_id) : null;

    const { error } = await admin
      .from('user_provider_connections')
      .upsert(
        {
          user_id,
          provider: 'whoop',
          external_user_id: externalUserId,
          access_token_encrypted: await encryptToken(tokens.access_token),
          refresh_token_encrypted: await encryptToken(tokens.refresh_token),
          token_expires_at: expiresAt,
          scopes: tokens.scope ? tokens.scope.split(' ') : null,
          status: 'active',
          last_error: null,
          last_sync_cursor: null,
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
      );
    if (error) throw error;

    // Kick off an immediate backfill so the user sees their workouts /
    // sleep / recovery without waiting for the hourly `providers-sync`
    // cron. We call `syncWhoopForConnection` *directly* (no
    // function-to-function HTTP hop) — that path was historically
    // unreliable in the Supabase Edge runtime: the gateway's JWT layer,
    // the per-function 60s timeout cascading, and the implicit cold-start
    // costs all combined to make the inline sync silently no-op. By
    // sharing the logic via `_shared/whoop-sync.ts` the OAuth callback
    // does the same exact work as the cron with the same error handling.
    //
    // Best-effort: if the backfill fails we still return `connected:true`
    // because the row in `user_provider_connections` is already written.
    // The cron will catch up at the next tick and surface the error via
    // `last_error`.
    let backfillOutcome: 'ok' | 'error' = 'ok';
    let backfillSummary: { workouts: number; cycles: number; sleep: number; recovery: number } | null = null;
    try {
      const conn = await fetchWhoopConnection(admin, user_id);
      if (!conn) throw new Error('connection row missing immediately after upsert');
      const connWithCursor = { ...conn, last_sync_cursor: null as string | null };
      const windowEnd = new Date();
      backfillSummary = await syncWhoopForConnection(admin, connWithCursor, windowEnd);
      await admin
        .from('user_provider_connections')
        .update({
          last_sync_at: windowEnd.toISOString(),
          last_sync_cursor: windowEnd.toISOString(),
          last_error: null,
          status: 'active',
        })
        .eq('id', conn.id);
    } catch (e) {
      backfillOutcome = 'error';
      const msg = errorMessage(e);
      console.warn('initial whoop backfill failed', { user_id, err: msg });
      await admin
        .from('user_provider_connections')
        .update({ last_error: msg.slice(0, 400) })
        .eq('user_id', user_id)
        .eq('provider', 'whoop');
    }

    console.log(JSON.stringify({
      provider: 'whoop',
      outcome: 'oauth_connected',
      user_id,
      backfill: backfillOutcome,
      ...(backfillSummary ?? {}),
    }));

    return new Response(
      JSON.stringify({
        status: 'connected',
        external_user_id: externalUserId,
        backfill: backfillOutcome,
        backfill_summary: backfillSummary,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
