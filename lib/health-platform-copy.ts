/**
 * User-facing names for on-device health integrations must match the platform:
 * iOS → Apple Health; Android → Health Connect. Avoid showing the other OS's
 * brand when displaying synced rows or hints on the wrong platform.
 */

import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * Prefer `Platform.OS`, but fall back to `expo-device` `osName` — some builds
 * have been observed to mis-report `Platform.OS` while still showing Android UI.
 */
export function resolveMobileOsBucket(): 'ios' | 'android' | 'other' {
  const osName = Device.osName?.toLowerCase() ?? '';
  if (Platform.OS === 'android' || osName === 'android') {
    return 'android';
  }
  if (Platform.OS === 'ios' || osName === 'ios' || osName === 'ipados') {
    return 'ios';
  }
  return 'other';
}

/** Conflict-resolution footnote copy for the Connections screen footer. */
export function conflictResolutionPriorityFallback(): string {
  const bucket = resolveMobileOsBucket();
  if (bucket === 'ios') {
    return 'Conflict resolution: Apple Health > Garmin > Whoop > manual. The freshest complete reading per day wins within the same source.';
  }
  if (bucket === 'android') {
    return 'Conflict resolution: Health Connect > Garmin > Whoop > manual. The freshest complete reading per day wins within the same source.';
  }
  return 'Conflict resolution: On-device health app > Garmin > Whoop > manual. The freshest complete reading per day wins within the same source.';
}

/** Steps chart empty-state hint (Whoop-only steps vs phone totals). */
export function stepsTrendNoDataFallback(): string {
  const bucket = resolveMobileOsBucket();
  if (bucket === 'ios') {
    return 'No steps yet. Whoop estimates steps only from logged walks / runs / hikes — connect Apple Health for full daily totals.';
  }
  if (bucket === 'android') {
    return 'No steps yet. Whoop estimates steps only from logged walks / runs / hikes — connect Health Connect for full daily totals.';
  }
  return 'No steps yet. Whoop estimates steps only from logged walks / runs / hikes — connect your phone\'s health integration in the mobile app for full daily totals.';
}

/**
 * Apple HealthKit reports workout types as PascalCase tokens with no spaces
 * (e.g. "TraditionalStrengthTraining"). Humanize them for display by inserting
 * spaces at case boundaries; strings that already contain spaces pass through
 * unchanged.
 */
export function humanizeActivityName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

/** Label for a stored provider `source` field in UI (badges, legends, etc.). */
export function providerSourceUserFacingLabel(source: string): string {
  const bucket = resolveMobileOsBucket();
  switch (source) {
    case 'manual':
      return 'Manual';
    case 'whoop':
      return 'Whoop';
    case 'garmin':
      return 'Garmin';
    case 'healthkit':
      return bucket === 'ios' ? 'Apple Health' : 'Health (iOS)';
    case 'healthconnect':
      return bucket === 'android' ? 'Health Connect' : 'Health (Android)';
    default:
      return source;
  }
}
