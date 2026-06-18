/**
 * Normalized provider data model used by both the on-device HealthKit adapter
 * and the Supabase Edge Functions that ingest Whoop / Garmin / Health Connect.
 *
 * Goal: one canonical shape that maps 1:1 onto `activity_logs` and
 * `daily_metrics` rows, so ingestion code is provider-agnostic after
 * normalization.
 */

import type { ActivityCategory } from '../../types/workout';

export type ProviderSource =
  | 'manual'
  | 'healthkit'
  | 'whoop'
  | 'garmin'
  | 'healthconnect';

export type DailyMetricName =
  | 'steps'
  | 'active_energy_kcal'
  | 'resting_energy_kcal'
  | 'sleep_total_min'
  | 'sleep_efficiency_pct'
  | 'recovery_score'
  | 'hrv_rmssd_ms'
  | 'resting_hr_bpm';

export type CaloriesSource =
  | 'provider'
  | 'estimated_met'
  | 'estimated_hr'
  | 'manual';

export type Confidence = 'high' | 'medium' | 'low';

export type CanonicalWinnerReason =
  | 'healthkit_aggregated'
  | 'preferred_source'
  | 'fallback_priority'
  | 'freshest_complete_source'
  | 'only_source';

/**
 * Priority table consumed by `resolveCanonicalDailyMetric`.
 *
 * Rationale (see Section 7 of the wearables plan):
 *   - HealthKit already de-duplicates across Apple Watch, iPhone, and any
 *     third-party sources that write into Health, so if HealthKit is
 *     connected it wins automatically.
 *   - Between direct providers, Garmin's step data is historically more
 *     reliable than Whoop's, so Garmin > Whoop in the fallback tier.
 *   - `manual` is last-resort.
 *
 * v2 will allow per-user override via a preferred-source UI; until then this
 * ordering is the default for everyone.
 */
export const CANONICAL_SOURCE_PRIORITY: Record<DailyMetricName, ProviderSource[]> = {
  steps: ['healthkit', 'garmin', 'whoop', 'healthconnect', 'manual'],
  active_energy_kcal: ['healthkit', 'whoop', 'garmin', 'healthconnect', 'manual'],
  resting_energy_kcal: ['healthkit', 'whoop', 'garmin', 'healthconnect', 'manual'],
  // Sleep + recovery defer to Whoop when connected (purpose-built sensor +
  // scoring), then HealthKit's aggregated view.
  sleep_total_min: ['whoop', 'healthkit', 'garmin', 'healthconnect', 'manual'],
  sleep_efficiency_pct: ['whoop', 'healthkit', 'garmin', 'healthconnect', 'manual'],
  recovery_score: ['whoop', 'garmin', 'healthkit', 'healthconnect', 'manual'],
  hrv_rmssd_ms: ['whoop', 'healthkit', 'garmin', 'healthconnect', 'manual'],
  resting_hr_bpm: ['whoop', 'healthkit', 'garmin', 'healthconnect', 'manual'],
};

/**
 * A normalized activity/workout from any provider or manual entry.
 *
 * `externalId` must uniquely identify the activity within its provider. For
 * on-device HealthKit this is the HKWorkout UUID; for Whoop it's the workout
 * ID from the webhook payload.
 */
export interface NormalizedActivity {
  userId: string;
  source: ProviderSource;
  externalId?: string;

  activityDate: string;         // YYYY-MM-DD in user's local time
  startedAt?: string;           // ISO-8601 UTC
  endedAt?: string;             // ISO-8601 UTC
  durationMinutes: number;

  /**
   * App-level category (maps to `ActivityCategory`). Providers emit their own
   * sport/type strings; the adapter must map those to our taxonomy before
   * normalization so downstream code only ever sees `ActivityCategory`.
   */
  activityCategory: ActivityCategory;
  /** Provider/original sport label, free-form. Shown in UI when present. */
  activityName: string;

  distanceValue?: number;
  distanceUnit?: 'km' | 'mi';
  elevationGain?: number;
  avgHeartRate?: number;

  caloriesBurned?: number;
  caloriesSource: CaloriesSource;
  caloriesConfidence: Confidence;

  /** See `dedupeFingerprint()` in `lib/activity-dedupe.ts`. */
  dedupeFingerprint?: string;

  notes?: string;

  /** FK into `provider_raw_payloads` when available (server-side only). */
  payloadId?: number;
}

/**
 * A normalized daily metric value from a given source. Multiple sources
 * produce multiple rows; `resolveCanonicalDailyMetric` picks one winner.
 */
export interface NormalizedDailyMetric {
  userId: string;
  metricDate: string;           // YYYY-MM-DD
  metric: DailyMetricName;
  source: ProviderSource;
  value: number;
  confidence?: Confidence;      // default 'high'
  payloadId?: number;
}

/**
 * Minimal shape of the on-device "provider connection" row, returned from the
 * `user_provider_connections_public` view. Deliberately omits tokens.
 */
export interface ProviderConnectionPublic {
  id: number;
  userId: string;
  provider: ProviderSource;
  externalUserId?: string;
  connectedAt: string;
  lastSyncAt?: string;
  status: 'active' | 'revoked' | 'error';
  lastError?: string;
}

/**
 * Compute a provider-agnostic fingerprint that lets us detect near-duplicates
 * across sources (e.g. a Whoop workout that was also captured by HealthKit).
 *
 * Two activities with the same fingerprint are almost certainly the same
 * session. The canonical rule (higher-priority source wins) can then demote
 * the loser to a "shadow" row without deleting it.
 *
 * Design:
 *   - 10-minute start bucket (clock drift, timezone jitter)
 *   - Activity category (not the fine-grained type, since providers disagree)
 *   - Duration rounded to the nearest minute
 *
 * The returned string is stable across devices and does NOT depend on
 * provider-specific IDs, which is exactly what we want for cross-source
 * deduplication.
 */
export function dedupeFingerprint(
  startedAt: string | Date | undefined,
  activityCategory: ActivityCategory,
  durationMinutes: number,
): string | undefined {
  if (!startedAt || !Number.isFinite(durationMinutes)) return undefined;
  const d = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;
  if (Number.isNaN(d.getTime())) return undefined;

  // 10-minute bucket keyed by UTC epoch to avoid timezone drift between
  // device and server. 10 min is wide enough for clock skew yet narrow enough
  // to distinguish two consecutive runs.
  const bucketMinutes = 10;
  const bucket = Math.floor(d.getTime() / (bucketMinutes * 60 * 1000));
  const durationBucket = Math.round(durationMinutes);

  return `${bucket}|${activityCategory}|${durationBucket}`;
}
