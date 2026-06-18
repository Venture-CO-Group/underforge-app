/**
 * Client façade for Health Connect — same shape as `whoop-client.ts` so the
 * Connections screen can interact with it through a uniform interface.
 *
 * Unlike Whoop, Health Connect is an on-device API: there are no OAuth
 * tokens to swap. OS permission revocation still happens in Google's Health
 * Connect Settings app after we purge stored data. We keep the local
 * `user_provider_connections` row for the UI badge and the sync orchestrator's
 * "should I sync this provider?" check.
 */

import { Platform } from 'react-native';
import { hardDeleteActivityLogsBySource } from '../activity-storage';
import { hardDeleteDailyMetricsBySource } from '../daily-metrics-storage';
import { getDatabase } from '../db';
import { glowLogger } from '../glow-logger';
import { supabase } from '../supabase_db_new';
import {
  isHealthConnectAvailable,
  openHealthConnectSettings,
  requestHealthConnectPermissions,
  syncHealthConnect,
} from './healthconnect';

const PROVIDER_FUNCTION_BASE = () => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('EXPO_PUBLIC_SUPABASE_URL is not set');
  return `${url.replace(/\/$/, '')}/functions/v1`;
};

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

export interface HealthConnectConnectionSummary {
  provider: 'healthconnect';
  connected: boolean;
  lastSyncAt?: string | null;
  lastError?: string | null;
}

/**
 * Initialize the SDK, request read permissions, and (if granted) trigger
 * an initial 30-day sync. Returns `{ connected: false }` on user-denied
 * permissions or unsupported platforms — callers should treat that the same
 * way as a cancelled OAuth flow.
 */
export async function connectHealthConnect(userId: string): Promise<{ connected: boolean }> {
  if (Platform.OS !== 'android') return { connected: false };
  const granted = await requestHealthConnectPermissions();
  if (!granted) return { connected: false };

  // Best-effort initial sync; even if it fails, the connection row is
  // marked active by `syncHealthConnect` so the UI reflects the granted
  // permissions.
  try {
    await syncHealthConnect(userId, { daysBack: 30, force: true });
  } catch (e) {
    glowLogger.warn('Initial Health Connect sync failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  glowLogger.info('Health Connect connected', { user_id: userId });
  return { connected: true };
}

/**
 * Purge Health Connect–sourced data locally and on Supabase (same contract as
 * Whoop disconnect), mark the connection revoked, then open Health Connect
 * Settings so the user can revoke read access in Google's UI.
 */
export async function disconnectHealthConnect(userId: string): Promise<void> {
  if (!userId || typeof userId !== 'string') {
    glowLogger.error('disconnectHealthConnect: missing user_id', {});
    throw new Error('Cannot disconnect Health Connect: missing user id.');
  }

  const headers = await authHeader();
  const url = `${PROVIDER_FUNCTION_BASE()}/providers-disconnect`;
  glowLogger.info('Health Connect disconnect: calling providers-disconnect', {
    user_id: userId,
    provider: 'healthconnect',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: userId, provider: 'healthconnect' }),
  });

  if (!res.ok) {
    const bodyText = await res.text();
    glowLogger.error('providers-disconnect failed (Health Connect)', {
      status: res.status,
      body: bodyText,
      user_id: userId,
      provider: 'healthconnect',
    });
    throw new Error(`providers-disconnect failed: ${res.status} ${bodyText}`);
  }

  try {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE user_provider_connections
          SET status = 'revoked', last_error = NULL, last_sync_cursor = NULL
        WHERE user_id = ? AND provider = 'healthconnect'`,
      [userId],
    );
  } catch (e) {
    glowLogger.warn('Failed to mark Health Connect connection revoked', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const removedActivities = await hardDeleteActivityLogsBySource(userId, 'healthconnect');
  const removedDaily = await hardDeleteDailyMetricsBySource(userId, 'healthconnect');

  openHealthConnectSettings();
  glowLogger.info('Health Connect disconnected', {
    user_id: userId,
    local_activities_removed: removedActivities,
    local_daily_metrics_removed: removedDaily,
  });
}

/**
 * Read the local connection row. Returns `connected: false` for any state
 * other than `'active'`, including `'revoked'` and missing-row.
 */
export async function getHealthConnectConnection(
  userId: string,
): Promise<HealthConnectConnectionSummary> {
  if (Platform.OS !== 'android') {
    return { provider: 'healthconnect', connected: false };
  }
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{
      status: string;
      last_sync_at: string | null;
      last_error: string | null;
    }>(
      `SELECT status, last_sync_at, last_error
         FROM user_provider_connections
        WHERE user_id = ? AND provider = 'healthconnect'`,
      [userId],
    );
    if (!row) return { provider: 'healthconnect', connected: false };
    return {
      provider: 'healthconnect',
      connected: row.status === 'active',
      lastSyncAt: row.last_sync_at,
      lastError: row.last_error,
    };
  } catch (e) {
    glowLogger.warn('Failed to read Health Connect connection row', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { provider: 'healthconnect', connected: false };
  }
}

/**
 * Re-export the platform availability check so the UI can render the row
 * conditionally without importing the bigger adapter module directly.
 */
export { isHealthConnectAvailable };
