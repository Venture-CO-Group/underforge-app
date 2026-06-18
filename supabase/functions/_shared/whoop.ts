// Whoop API helpers shared across the OAuth, webhook, and poll functions.
//
// All calls go through `whoopFetch` which transparently refreshes expired
// tokens using `user_provider_connections.refresh_token_encrypted`.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptToken, encryptToken } from './encrypt.ts';

export const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';
export const WHOOP_OAUTH_BASE = 'https://api.prod.whoop.com/oauth/oauth2';

export function whoopEnv() {
  const clientId = Deno.env.get('WHOOP_CLIENT_ID');
  const clientSecret = Deno.env.get('WHOOP_CLIENT_SECRET');
  const redirectUri = Deno.env.get('WHOOP_REDIRECT_URI');
  const webhookSecret = Deno.env.get('WHOOP_WEBHOOK_SECRET');
  if (!clientId || !clientSecret || !redirectUri) {
    const missing = [
      !clientId ? 'WHOOP_CLIENT_ID' : null,
      !clientSecret ? 'WHOOP_CLIENT_SECRET' : null,
      !redirectUri ? 'WHOOP_REDIRECT_URI' : null,
    ].filter(Boolean).join(', ');
    throw new Error(`Missing Whoop environment variable(s): ${missing}`);
  }
  return { clientId, clientSecret, redirectUri, webhookSecret };
}

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

export interface WhoopConnection {
  id: number;
  user_id: string;
  external_user_id: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string;
  scopes: string[] | null;
  status: 'active' | 'revoked' | 'error';
}

export async function fetchWhoopConnection(
  supabase: SupabaseClient,
  userId: string,
): Promise<WhoopConnection | null> {
  const { data, error } = await supabase
    .from('user_provider_connections')
    .select('id,user_id,external_user_id,access_token_encrypted,refresh_token_encrypted,token_expires_at,scopes,status')
    .eq('user_id', userId)
    .eq('provider', 'whoop')
    .maybeSingle();
  if (error) throw error;
  return (data as WhoopConnection | null) ?? null;
}

export async function fetchWhoopConnectionByExternalId(
  supabase: SupabaseClient,
  externalUserId: string,
): Promise<WhoopConnection | null> {
  const { data, error } = await supabase
    .from('user_provider_connections')
    .select('id,user_id,external_user_id,access_token_encrypted,refresh_token_encrypted,token_expires_at,scopes,status')
    .eq('provider', 'whoop')
    .eq('external_user_id', externalUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as WhoopConnection | null) ?? null;
}

export async function exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}> {
  const { clientId, clientSecret, redirectUri } = whoopEnv();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  });
  const res = await fetch(`${WHOOP_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Whoop token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function refreshWhoopToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const { clientId, clientSecret } = whoopEnv();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(`${WHOOP_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Whoop refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Authenticated fetch. If the stored access token has expired (or the server
 * returns 401), we transparently refresh, persist the new tokens, and retry
 * exactly once.
 */
export async function whoopFetch(
  supabase: SupabaseClient,
  conn: WhoopConnection,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let accessToken = await decryptToken(conn.access_token_encrypted);
  const expiresAt = new Date(conn.token_expires_at).getTime();
  const now = Date.now();
  if (!Number.isFinite(expiresAt) || expiresAt - now < 60_000) {
    accessToken = await rotateTokens(supabase, conn);
  }

  const doFetch = (token: string) =>
    fetch(`${WHOOP_API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

  let res = await doFetch(accessToken);
  if (res.status === 401) {
    accessToken = await rotateTokens(supabase, conn);
    res = await doFetch(accessToken);
  }
  return res;
}

async function rotateTokens(supabase: SupabaseClient, conn: WhoopConnection): Promise<string> {
  const refreshPlain = await decryptToken(conn.refresh_token_encrypted);
  const refreshed = await refreshWhoopToken(refreshPlain);
  const newAccess = await encryptToken(refreshed.access_token);
  const newRefresh = await encryptToken(refreshed.refresh_token);
  const expires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabase
    .from('user_provider_connections')
    .update({
      access_token_encrypted: newAccess,
      refresh_token_encrypted: newRefresh,
      token_expires_at: expires,
      status: 'active',
      last_error: null,
    })
    .eq('id', conn.id);
  conn.access_token_encrypted = newAccess;
  conn.refresh_token_encrypted = newRefresh;
  conn.token_expires_at = expires;
  return refreshed.access_token;
}

/**
 * Whoop webhook payloads are signed with an HMAC-SHA256 over
 * `<x-whoop-signature-timestamp><rawBody>` using the app's client secret.
 * If a deployment sets WHOOP_WEBHOOK_SECRET, we use it as an override, but
 * Whoop's dashboard currently exposes the OAuth client secret as the signing
 * secret. Constant-time comparison resists timing attacks.
 */
export async function verifyWhoopSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
): Promise<boolean> {
  const env = whoopEnv();
  const secret = env.webhookSecret || env.clientSecret;
  if (!secret || !signatureHeader || !timestampHeader) return false;

  // Protect against replay: reject signatures older than 5 minutes.
  const ts = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestampHeader}${rawBody}`),
    ),
  );
  const expected = btoa(String.fromCharCode(...sig));
  return timingSafeEqual(expected, signatureHeader);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
