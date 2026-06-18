import { AppState, type AppStateStatus, Platform } from 'react-native';
import { DeviceType } from '../types/user_profile';
import {
  getPushTokenWithStatus,
  type PushTokenResult,
} from './expo-notification-helper';
import { glowLogger } from './glow-logger';
import { getUserProfile, updateUserProfileExpoPushToken } from './supabase_db_new';

// ============================================================================
// Push token sync
//
// Single source of truth for "make sure this user has a working push token in
// Supabase". Replaces ad-hoc copy-paste blocks that used to live across
// `app/index.tsx`, `UserDetailScreen`, etc.
//
// We treat a missing token on a real device with permission as a CRITICAL
// failure (logged at `error` level so it surfaces in Logfire) because the user
// will not be able to receive any notifications until it's resolved.
// ============================================================================

const REAL_DEVICE_TYPES: DeviceType[] = [
  DeviceType.IOS_DEVICE,
  DeviceType.ANDROID_DEVICE,
];

const isRealDeviceType = (type: DeviceType | undefined | null): boolean =>
  !!type && REAL_DEVICE_TYPES.includes(type);

export type EnsurePushTokenReason =
  | 'updated'
  | 'simulator_or_emulator'
  | 'permission_denied'
  | 'expo_token_unavailable'
  | 'supabase_update_failed'
  | 'no_remote_profile';

export interface EnsurePushTokenOptions {
  /** Used in logs to disambiguate which call site triggered the sync. */
  source: string;
}

export interface EnsurePushTokenResult {
  success: boolean;
  token: string | null;
  reason: EnsurePushTokenReason;
  pushTokenResult?: PushTokenResult;
}

/**
 * Ensure that the user's Supabase profile has a valid Expo push token.
 *
 * - Always attempts to obtain the freshest token from the device, since EAS
 *   rebuilds, OS reinstalls, or token rotation can invalidate prior tokens.
 * - When the device is a simulator or the user denied permission we exit
 *   early with the appropriate `reason`; we don't attempt to overwrite an
 *   existing remote token in those cases.
 * - When we have a token but the Supabase update fails, we log the failure
 *   and return `success=false` so the caller can decide whether to retry.
 * - When we are on a real device with permission but cannot obtain a token,
 *   we log a CRITICAL error - this is the primary path we need to monitor
 *   in Logfire because it means the user silently has no push capability.
 */
export async function ensurePushTokenForUser(
  userId: string,
  options: EnsurePushTokenOptions
): Promise<EnsurePushTokenResult> {
  const { source } = options;

  glowLogger.info('ensurePushTokenForUser:start', {
    user_id: userId,
    source,
    platform: Platform.OS,
  });

  const result = await getPushTokenWithStatus(userId);

  if (!result || !isRealDeviceType(result.deviceType)) {
    glowLogger.info('ensurePushTokenForUser:simulator_or_emulator', {
      user_id: userId,
      source,
      device_type: result?.deviceType,
    });
    return {
      success: false,
      token: null,
      reason: 'simulator_or_emulator',
      pushTokenResult: result,
    };
  }

  if (result.permissionStatus !== 'granted') {
    glowLogger.warn('ensurePushTokenForUser:permission_denied', {
      user_id: userId,
      source,
      permission_status: result.permissionStatus,
      device_type: result.deviceType,
      platform: Platform.OS,
    });
    return {
      success: false,
      token: null,
      reason: 'permission_denied',
      pushTokenResult: result,
    };
  }

  if (!result.expoPushToken) {
    glowLogger.error(
      'ensurePushTokenForUser:expo_token_unavailable - real device with permission has no token',
      {
        user_id: userId,
        source,
        device_type: result.deviceType,
        platform: Platform.OS,
        permission_status: result.permissionStatus,
        impact: 'User will NOT receive any push notifications until resolved',
      }
    );
    return {
      success: false,
      token: null,
      reason: 'expo_token_unavailable',
      pushTokenResult: result,
    };
  }

  try {
    await updateUserProfileExpoPushToken(userId, result);
    glowLogger.info('ensurePushTokenForUser:updated', {
      user_id: userId,
      source,
      token_preview: result.expoPushToken.substring(0, 40),
      device_type: result.deviceType,
      platform: Platform.OS,
    });
    return {
      success: true,
      token: result.expoPushToken,
      reason: 'updated',
      pushTokenResult: result,
    };
  } catch (updateError) {
    const message =
      updateError instanceof Error ? updateError.message : String(updateError);
    const isMissingProfile = /No rows were updated|profile not found/i.test(
      message
    );
    glowLogger.error('ensurePushTokenForUser:supabase_update_failed', {
      user_id: userId,
      source,
      error: message,
      device_type: result.deviceType,
      platform: Platform.OS,
      token_preview: result.expoPushToken.substring(0, 40),
      missing_profile: isMissingProfile,
    });
    return {
      success: false,
      token: null,
      reason: isMissingProfile ? 'no_remote_profile' : 'supabase_update_failed',
      pushTokenResult: result,
    };
  }
}

/**
 * Best-effort check of the remote profile's token before re-running the full
 * sync. Saves a permission roundtrip and avoids duplicate `updated` logs when
 * the profile already has a valid token.
 */
async function profileAlreadyHasToken(userId: string): Promise<boolean> {
  try {
    const profile = await getUserProfile(userId);
    if (!profile) return false;
    if (!profile.expoPushToken) return false;
    if (!isRealDeviceType(profile.device_type)) return false;
    return profile.expoPushToken.startsWith('ExponentPushToken[');
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Background recovery
//
// If a token request fails (network, iOS 18+ APNs hang, app backgrounded
// during email confirmation, etc.) we don't want the user permanently stuck
// without notifications. We schedule a session-scoped retry chain with
// exponential backoff. AppState 'active' transitions also kick off a fresh
// attempt so users who background the app and come back get a quick fix.
// ----------------------------------------------------------------------------

const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundAttempt = 0;
let backgroundUserId: string | null = null;

let appStateSubscription: { remove: () => void } | null = null;
let appStateUserId: string | null = null;
let lastForegroundCheckAt = 0;
const FOREGROUND_CHECK_THROTTLE_MS = 60_000;

const isTransientReason = (reason: EnsurePushTokenReason): boolean =>
  reason === 'expo_token_unavailable' ||
  reason === 'supabase_update_failed' ||
  reason === 'no_remote_profile';

export function scheduleBackgroundPushTokenRecovery(userId: string): void {
  if (backgroundTimer && backgroundUserId === userId) {
    glowLogger.info('Background push token recovery already scheduled', {
      user_id: userId,
      attempts_so_far: backgroundAttempt,
    });
    return;
  }

  if (backgroundUserId !== userId) {
    cancelBackgroundPushTokenRecovery();
    backgroundUserId = userId;
  }

  if (backgroundAttempt >= RETRY_DELAYS_MS.length) {
    glowLogger.warn('Background push token recovery exhausted retries', {
      user_id: userId,
      attempts: backgroundAttempt,
    });
    return;
  }

  const delay = RETRY_DELAYS_MS[backgroundAttempt];
  glowLogger.info('Scheduling background push token recovery', {
    user_id: userId,
    attempt: backgroundAttempt + 1,
    delay_ms: delay,
  });

  backgroundTimer = setTimeout(async () => {
    backgroundTimer = null;
    backgroundAttempt += 1;
    const attempt = backgroundAttempt;

    try {
      if (await profileAlreadyHasToken(userId)) {
        glowLogger.info(
          'Background push token recovery: profile already has token, stopping',
          { user_id: userId, attempt }
        );
        backgroundAttempt = 0;
        return;
      }

      const result = await ensurePushTokenForUser(userId, {
        source: `background_retry_${attempt}`,
      });

      if (result.success) {
        glowLogger.info('Background push token recovery succeeded', {
          user_id: userId,
          attempt,
        });
        backgroundAttempt = 0;
        return;
      }

      if (isTransientReason(result.reason)) {
        scheduleBackgroundPushTokenRecovery(userId);
      } else {
        glowLogger.info(
          'Background push token recovery stopping (non-transient reason)',
          { user_id: userId, attempt, reason: result.reason }
        );
      }
    } catch (error) {
      glowLogger.warn('Background push token recovery threw', {
        user_id: userId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
      scheduleBackgroundPushTokenRecovery(userId);
    }
  }, delay);
}

export function cancelBackgroundPushTokenRecovery(): void {
  if (backgroundTimer) {
    clearTimeout(backgroundTimer);
    backgroundTimer = null;
  }
  backgroundAttempt = 0;
  backgroundUserId = null;
}

/**
 * Top-level entry: ensure the user has a token now, and if not, kick off
 * background retries. Use this from app-start/sign-in/onboarding-complete.
 */
export async function ensurePushTokenForUserWithRecovery(
  userId: string,
  options: EnsurePushTokenOptions
): Promise<EnsurePushTokenResult> {
  const result = await ensurePushTokenForUser(userId, options);
  if (!result.success && isTransientReason(result.reason)) {
    backgroundAttempt = 0;
    scheduleBackgroundPushTokenRecovery(userId);
  }
  return result;
}

/**
 * Re-check the user's push token whenever the app comes to the foreground.
 * Throttled so we never spam more than once per minute, and a single
 * subscription is shared across the app lifetime (re-registering for a
 * different user replaces the previous subscription).
 */
export function registerAppForegroundPushTokenRecovery(userId: string): void {
  if (appStateSubscription && appStateUserId === userId) return;

  unregisterAppForegroundPushTokenRecovery();
  appStateUserId = userId;

  const handler = async (nextState: AppStateStatus) => {
    if (nextState !== 'active') return;
    if (!appStateUserId) return;

    const now = Date.now();
    if (now - lastForegroundCheckAt < FOREGROUND_CHECK_THROTTLE_MS) return;
    lastForegroundCheckAt = now;

    try {
      if (await profileAlreadyHasToken(appStateUserId)) return;

      glowLogger.warn(
        'App foreground: user has no push token, attempting recovery',
        { user_id: appStateUserId, platform: Platform.OS }
      );
      backgroundAttempt = 0;
      await ensurePushTokenForUserWithRecovery(appStateUserId, {
        source: 'app_foreground',
      });
    } catch (error) {
      glowLogger.warn('App foreground push token recovery threw', {
        user_id: appStateUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  appStateSubscription = AppState.addEventListener('change', handler);
  glowLogger.info('Registered app-foreground push token recovery', {
    user_id: userId,
  });
}

export function unregisterAppForegroundPushTokenRecovery(): void {
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
  appStateUserId = null;
  lastForegroundCheckAt = 0;
}
