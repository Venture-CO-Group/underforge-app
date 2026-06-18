/**
 * Wearables sync orchestrator.
 *
 * Three triggers, all funneling through the platform-appropriate
 * `syncHealthKit` / `syncHealthConnect` entry points:
 *
 *   1. iOS HKObserverQuery + background delivery
 *      Registered via `lib/providers/healthkit-observers.ts`. iOS wakes the
 *      app when new HealthKit data lands; we run a normal incremental sync.
 *
 *   2. Periodic background task (`expo-background-task` / TaskManager)
 *      Registered here. The system wakes us every ~30+ minutes (subject to
 *      OS heuristics) and we pull the last 2 days of data. Primarily for
 *      Android since Health Connect has no event push, but also runs on iOS
 *      as a safety net for missed observer wake-ups.
 *
 *   3. Foreground re-sync on app open
 *      `AppState` listener calls the platform-appropriate sync once when
 *      the app becomes active, debounced to once per 60 s.
 *
 * `defineTask` MUST be called at module-load time (it registers the handler
 * that the OS-side TaskManager service will look up by name when a wake-up
 * arrives), so this file has a top-level call. `registerTaskAsync` is then
 * called from `registerProviderBackgroundSync()` once we have an active
 * user.
 */

import { AppState, type AppStateStatus, Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { glowLogger } from '../glow-logger';
import { getCurrentLoggedInUser } from '../db';
import { syncHealthKit } from './healthkit';
import {
  registerHealthKitObservers,
  unregisterHealthKitObservers,
} from './healthkit-observers';
import { syncHealthConnect } from './healthconnect';
import { getDatabase } from '../db';

const BACKGROUND_TASK_NAME = 'underforge.wearables.sync';

/** Minimum wall-clock spacing between foreground re-syncs. */
const FOREGROUND_DEBOUNCE_MS = 60_000;

/**
 * Inexact background interval in minutes. The OS treats this as a floor and
 * may run it less often (battery, doze). 30 min keeps Android's Health
 * Connect data fresh enough for daily totals without measurable battery hit.
 */
const BACKGROUND_MIN_INTERVAL_MIN = 30;

/**
 * Background pull window in days. Short window because both HealthKit and
 * Health Connect already de-duplicate on `external_id` server-side, so a
 * 2-day overlap is enough to backfill anything we missed since the last
 * cursor without paying for a 30-day re-read on every wake-up.
 */
const BACKGROUND_DAYS_BACK = 2;

let lastForegroundSyncAt = 0;
let appStateSubscription: { remove: () => void } | null = null;
let activeUserIdForForeground: string | null = null;
let backgroundTaskRegistered = false;

// ---- Background task definition (module-load time) ---------------------

// `defineTask` is idempotent across re-imports, but we still guard it to
// avoid a noisy warning during fast-refresh in development.
if (!TaskManager.isTaskDefined(BACKGROUND_TASK_NAME)) {
  TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
    try {
      const user = await getCurrentLoggedInUser();
      if (!user?.id) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      const userId = user.id;

      const ran: string[] = [];
      if (Platform.OS === 'ios') {
        if (await isProviderActive(userId, 'healthkit')) {
          await syncHealthKit(userId, { daysBack: BACKGROUND_DAYS_BACK }).catch(() => {});
          ran.push('healthkit');
        }
      } else if (Platform.OS === 'android') {
        if (await isProviderActive(userId, 'healthconnect')) {
          await syncHealthConnect(userId, { daysBack: BACKGROUND_DAYS_BACK }).catch(() => {});
          ran.push('healthconnect');
        }
      }
      glowLogger.info('Wearables background task ran', { ran });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (e) {
      glowLogger.warn('Wearables background task failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

async function isProviderActive(
  userId: string,
  provider: 'healthkit' | 'healthconnect',
): Promise<boolean> {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ status: string }>(
      `SELECT status FROM user_provider_connections
        WHERE user_id = ? AND provider = ?`,
      [userId, provider],
    );
    return row?.status === 'active';
  } catch {
    return false;
  }
}

// ---- Public API --------------------------------------------------------

/**
 * One-shot setup called from the app shell once an authenticated user is
 * resolved. Idempotent; safe to call on every render. Wires up:
 *   - iOS HealthKit observers + background delivery
 *   - The periodic `expo-background-task` sync
 *   - The `AppState` foreground re-sync listener
 *
 * Pass `userId = null` (or call `tearDownProviderSync`) on logout to
 * release listeners and stop the background task.
 */
export async function registerProviderSync(userId: string): Promise<void> {
  if (!userId) return;

  if (Platform.OS === 'ios') {
    // No-op today (see `healthkit-observers.ts` for context): we used to call
    // `setObserver` here, but that path is unsafe under bridgeless RN. Keep
    // the call so we have an obvious place to re-enable observers once the
    // upstream package is fixed. Real-time isn't required — the foreground
    // re-sync below + the periodic background task keep data fresh.
    try {
      registerHealthKitObservers(userId);
    } catch (e) {
      glowLogger.warn('Failed to register HealthKit observers', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await ensureBackgroundTaskRegistered();
  ensureForegroundListener(userId);
}

/**
 * Registers the periodic background task once. Exposed separately in case
 * a caller wants to set it up without also touching foreground hooks.
 */
export async function ensureBackgroundTaskRegistered(): Promise<void> {
  if (backgroundTaskRegistered) return;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
      glowLogger.info('Background tasks unavailable on this device', { status });
      return;
    }
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK_NAME, {
      minimumInterval: BACKGROUND_MIN_INTERVAL_MIN,
    });
    backgroundTaskRegistered = true;
    glowLogger.info('Wearables background task registered', {
      task: BACKGROUND_TASK_NAME,
      minimum_interval_min: BACKGROUND_MIN_INTERVAL_MIN,
    });
  } catch (e) {
    glowLogger.warn('Failed to register wearables background task', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

function ensureForegroundListener(userId: string): void {
  activeUserIdForForeground = userId;
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state !== 'active') return;
    const uid = activeUserIdForForeground;
    if (!uid) return;
    const now = Date.now();
    if (now - lastForegroundSyncAt < FOREGROUND_DEBOUNCE_MS) return;
    lastForegroundSyncAt = now;
    void runForegroundSync(uid);
  });
}

async function runForegroundSync(userId: string): Promise<void> {
  try {
    if (Platform.OS === 'ios') {
      if (await isProviderActive(userId, 'healthkit')) {
        await syncHealthKit(userId, { daysBack: BACKGROUND_DAYS_BACK });
      }
    } else if (Platform.OS === 'android') {
      if (await isProviderActive(userId, 'healthconnect')) {
        await syncHealthConnect(userId, { daysBack: BACKGROUND_DAYS_BACK });
      }
    }
  } catch (e) {
    glowLogger.warn('Foreground wearables re-sync failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Unwind everything `registerProviderSync` registered. Call from the
 * sign-out path so a different user signing in afterwards doesn't inherit
 * the previous user's listeners.
 */
export async function tearDownProviderSync(): Promise<void> {
  unregisterHealthKitObservers();
  if (appStateSubscription) {
    try {
      appStateSubscription.remove();
    } catch {
      // best-effort
    }
    appStateSubscription = null;
  }
  activeUserIdForForeground = null;

  if (backgroundTaskRegistered) {
    try {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_TASK_NAME);
    } catch (e) {
      glowLogger.debug('Background task unregister failed (non-fatal)', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    backgroundTaskRegistered = false;
  }
}
