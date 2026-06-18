/**
 * useResetPasswordDeepLink
 *
 * Handles incoming Supabase password-recovery deep links on iOS and Android.
 *
 * Flow:
 *  1. Supabase `/auth/v1/verify?type=recovery&...&redirect_to=longeviq://reset-password`
 *     ultimately redirects to `longeviq://reset-password#access_token=...&refresh_token=...&type=recovery`.
 *  2. This hook listens for that URL (both cold start via getInitialURL and warm
 *     start via the `url` event), parses the tokens from the URL fragment, and
 *     calls `supabase.auth.setSession` to establish the short-lived recovery
 *     session on the device.
 *  3. When ready, `recoveryActive` flips to true so the app can render the
 *     ResetPasswordScreen.
 *
 * This hook is intentionally scoped to ONLY recovery links — any other URL is
 * ignored so no other flow (notifications, etc.) is affected.
 */

import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import { glowLogger } from '../lib/glow-logger';
import { supabase } from '../lib/supabase_db_new';

const RECOVERY_PATH = 'reset-password';

/**
 * Parse tokens from the fragment (`#key=value&...`) or query string of a URL.
 * Supabase returns recovery tokens in the fragment by default.
 */
function parseTokensFromUrl(url: string): {
  access_token?: string;
  refresh_token?: string;
  type?: string;
  error?: string;
  error_description?: string;
} {
  const result: Record<string, string> = {};

  const extract = (part: string) => {
    if (!part) return;
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const [rawKey, rawValue = ''] = pair.split('=');
      if (!rawKey) continue;
      try {
        result[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue);
      } catch {
        result[rawKey] = rawValue;
      }
    }
  };

  const hashIndex = url.indexOf('#');
  if (hashIndex >= 0) {
    extract(url.slice(hashIndex + 1));
  }

  const questionIndex = url.indexOf('?');
  if (questionIndex >= 0) {
    const end = hashIndex >= 0 ? hashIndex : url.length;
    extract(url.slice(questionIndex + 1, end));
  }

  return result as {
    access_token?: string;
    refresh_token?: string;
    type?: string;
    error?: string;
    error_description?: string;
  };
}

/**
 * Returns true if the URL points to our recovery route, regardless of scheme
 * (covers both the native scheme and a potential future https bridge).
 */
function isRecoveryUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = Linking.parse(url);
    const path = (parsed.path || '').replace(/^\/+/, '');
    const hostname = typeof parsed.hostname === 'string'
      ? parsed.hostname.replace(/^\/+/, '')
      : '';
    const matchesRoute =
      path === RECOVERY_PATH ||
      hostname === RECOVERY_PATH ||
      url.startsWith(`longeviq://${RECOVERY_PATH}`) ||
      url.startsWith(`longeviq:///${RECOVERY_PATH}`);

    if (!matchesRoute) return false;
  } catch {
    if (!url.includes(RECOVERY_PATH)) return false;
  }
  const tokens = parseTokensFromUrl(url);
  return tokens.type === 'recovery' || !!tokens.access_token || !!tokens.error;
}

export interface UseResetPasswordDeepLinkResult {
  /** True once a valid recovery session has been established and the UI should show the reset screen. */
  recoveryActive: boolean;
  /** True while we are exchanging tokens — used to avoid flashing other UI. */
  recoveryPending: boolean;
  /** A link-level error (expired / malformed link). Null when none. */
  recoveryError: string | null;
  /** Clear recovery state after the flow is done or cancelled. */
  clearRecovery: () => void;
}

export function useResetPasswordDeepLink(): UseResetPasswordDeepLinkResult {
  const [recoveryActive, setRecoveryActive] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  // Avoid processing the same URL twice (cold-start getInitialURL can re-emit
  // the same URL as the `url` listener on some platforms).
  const processedUrlRef = useRef<string | null>(null);

  const handleUrl = useCallback(async (url: string | null | undefined) => {
    if (!url) return;
    if (!isRecoveryUrl(url)) return;
    if (processedUrlRef.current === url) return;
    processedUrlRef.current = url;

    glowLogger.info('Password recovery deep link received', {
      url_preview: url.slice(0, 80),
    });

    const tokens = parseTokensFromUrl(url);

    if (tokens.error) {
      glowLogger.warn('Recovery link contained an error', {
        error: tokens.error,
        error_description: tokens.error_description,
      });
      setRecoveryError(tokens.error_description || tokens.error);
      setRecoveryActive(true);
      setRecoveryPending(false);
      return;
    }

    if (!tokens.access_token || !tokens.refresh_token) {
      glowLogger.warn('Recovery link missing tokens', {});
      setRecoveryError('invalid_link');
      setRecoveryActive(true);
      setRecoveryPending(false);
      return;
    }

    if (!supabase) {
      glowLogger.error('Supabase not initialized while processing recovery link', {});
      setRecoveryError('supabase_not_ready');
      setRecoveryActive(true);
      setRecoveryPending(false);
      return;
    }

    try {
      setRecoveryPending(true);
      const { error } = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });

      if (error) {
        glowLogger.error('Failed to set recovery session', { error: error.message });
        setRecoveryError(error.message);
        setRecoveryActive(true);
        setRecoveryPending(false);
        return;
      }

      glowLogger.info('Recovery session established, prompting for new password', {});
      setRecoveryError(null);
      setRecoveryActive(true);
      setRecoveryPending(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      glowLogger.error('Exception handling recovery deep link', { error: message });
      setRecoveryError(message);
      setRecoveryActive(true);
      setRecoveryPending(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    Linking.getInitialURL()
      .then(initialUrl => {
        if (cancelled) return;
        handleUrl(initialUrl);
      })
      .catch(err => {
        glowLogger.warn('Linking.getInitialURL failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    const subscription = Linking.addEventListener('url', event => {
      handleUrl(event.url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [handleUrl]);

  const clearRecovery = useCallback(() => {
    processedUrlRef.current = null;
    setRecoveryActive(false);
    setRecoveryPending(false);
    setRecoveryError(null);
  }, []);

  return { recoveryActive, recoveryPending, recoveryError, clearRecovery };
}
