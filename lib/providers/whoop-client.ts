/**
 * Client-side Whoop connect/disconnect flow.
 *
 * The device never sees Whoop's client_secret. The flow is:
 *   1. Ask `providers-oauth-start` for an authorize_url + state + code_verifier.
 *   2. Open the authorize_url in a system browser auth session.
 *   3. Whoop redirects to the native app via a universal link (or back to our
 *      Edge Function which redirects into the app). The client captures
 *      `code` + `state` from the redirect URL.
 *   4. POST `{ state, code, code_verifier, user_id }` to
 *      `providers-oauth-callback`. The Edge Function exchanges the code for
 *      tokens, encrypts them, and writes `user_provider_connections`.
 */

import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../supabase_db_new';
import { glowLogger } from '../glow-logger';
import { hardDeleteActivityLogsBySource } from '../activity-storage';

const PROVIDER_FUNCTION_BASE = () => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('EXPO_PUBLIC_SUPABASE_URL is not set');
  return `${url.replace(/\/$/, '')}/functions/v1`;
};

const WHOOP_OAUTH_RETURN_URL = 'longeviq://providers-oauth-return';

async function authHeader(): Promise<Record<string, string>> {
  if (!supabase) throw new Error('Supabase client unavailable');
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('No active Supabase session');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

interface StartResponse {
  authorize_url: string;
  state: string;
  code_verifier: string;
}

/**
 * Kick off the OAuth flow for the currently logged-in user. Returns once
 * the provider has been connected, or throws on failure / cancellation.
 */
export async function connectWhoop(userId: string): Promise<{ connected: boolean }> {
  const headers = await authHeader();

  const startRes = await fetch(`${PROVIDER_FUNCTION_BASE()}/providers-oauth-start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: userId, provider: 'whoop' }),
  });
  if (!startRes.ok) {
    const msg = await startRes.text();
    throw new Error(`oauth-start failed: ${startRes.status} ${msg}`);
  }
  const start = (await startRes.json()) as StartResponse;

  const result = await WebBrowser.openAuthSessionAsync(start.authorize_url, WHOOP_OAUTH_RETURN_URL);
  if (result.type !== 'success' || !result.url) {
    glowLogger.info('Whoop auth session cancelled or failed', { type: result.type });
    return { connected: false };
  }

  const redirect = new URL(result.url);
  const code = redirect.searchParams.get('code');
  const state = redirect.searchParams.get('state');
  if (!code || state !== start.state) {
    throw new Error('Whoop redirect missing code or state mismatch');
  }

  const cbRes = await fetch(`${PROVIDER_FUNCTION_BASE()}/providers-oauth-callback`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      user_id: userId,
      state,
      code,
      code_verifier: start.code_verifier,
    }),
  });
  if (!cbRes.ok) {
    const msg = await cbRes.text();
    throw new Error(`oauth-callback failed: ${cbRes.status} ${msg}`);
  }

  glowLogger.info('Whoop connected', { user_id: userId });
  return { connected: true };
}

export async function disconnectWhoop(userId: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(`${PROVIDER_FUNCTION_BASE()}/providers-disconnect`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: userId, provider: 'whoop' }),
  });
  if (!res.ok) {
    throw new Error(`providers-disconnect failed: ${res.status} ${await res.text()}`);
  }

  // The Edge Function already hard-deleted Whoop activity_logs on
  // Supabase. Mirror that locally so the UI updates immediately and we
  // leave no trace of the integration's data behind.
  const removed = await hardDeleteActivityLogsBySource(userId, 'whoop');
  glowLogger.info('Whoop disconnected', { user_id: userId, local_activities_removed: removed });
}

export interface ProviderConnectionSummary {
  provider: 'whoop' | 'healthkit';
  connected: boolean;
  externalUserId?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  status?: 'active' | 'revoked' | 'error';
}

export async function getWhoopConnection(userId: string): Promise<ProviderConnectionSummary> {
  if (!supabase) return { provider: 'whoop', connected: false };

  const { data, error } = await supabase
    .from('user_provider_connections_public')
    .select('external_user_id,last_sync_at,last_error,status')
    .eq('user_id', userId)
    .eq('provider', 'whoop')
    .maybeSingle();
  if (error || !data) return { provider: 'whoop', connected: false };

  return {
    provider: 'whoop',
    connected: data.status === 'active',
    externalUserId: data.external_user_id,
    lastSyncAt: data.last_sync_at,
    lastError: data.last_error,
    status: data.status,
  };
}
