// Start the Whoop OAuth flow.
//
// Input: POST { user_id, provider } (auth header required)
// Output: { authorize_url, state, code_verifier }
//
// The client opens `authorize_url` via `expo-web-browser.openAuthSessionAsync`.
// Whoop redirects to WHOOP_REDIRECT_URI (the callback Edge Function) with
// `?code=...&state=...`. The client keeps `state` + `code_verifier` in memory
// and posts them to providers-oauth-callback to complete the exchange.
//
// We use PKCE so secrets never travel through the device.

import { corsHeaders } from '../_shared/cors.ts';
import { whoopEnv } from '../_shared/whoop.ts';

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
    const body = await req.json().catch(() => ({}));
    const { user_id, provider } = body ?? {};
    if (!user_id || provider !== 'whoop') {
      return new Response(JSON.stringify({ error: 'Missing user_id or unsupported provider' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { clientId, redirectUri } = whoopEnv();
    const codeVerifier = randomBase64Url(64);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    // State binds the callback to the user_id so the callback function can
    // persist tokens to the right row.
    const state = `${user_id}:${randomBase64Url(24)}`;

    const scopes = [
      'read:recovery',
      'read:workout',
      'read:sleep',
      'read:profile',
      'read:cycles',
      'read:body_measurement',
      'offline',
    ].join(' ');

    const url = new URL('https://api.prod.whoop.com/oauth/oauth2/auth');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return new Response(
      JSON.stringify({
        authorize_url: url.toString(),
        state,
        code_verifier: codeVerifier,
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

function randomBase64Url(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64UrlFromBytes(b);
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64UrlFromBytes(new Uint8Array(digest));
}

function base64UrlFromBytes(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
