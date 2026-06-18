// Server-side mirror of `resolveCanonicalDailyMetric` in
// lib/daily-metrics-storage.ts. Runs inside Supabase Edge Functions so that
// webhook-driven inserts reach the same canonical decision as the device.
//
// Kept dependency-free (no imports) so any Edge Function can import it.

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

export type CanonicalWinnerReason =
  | 'healthkit_aggregated'
  | 'preferred_source'
  | 'fallback_priority'
  | 'freshest_complete_source'
  | 'only_source';

export const CANONICAL_SOURCE_PRIORITY: Record<DailyMetricName, ProviderSource[]> = {
  steps: ['healthkit', 'garmin', 'whoop', 'healthconnect', 'manual'],
  active_energy_kcal: ['healthkit', 'whoop', 'garmin', 'healthconnect', 'manual'],
  resting_energy_kcal: ['healthkit', 'whoop', 'garmin', 'healthconnect', 'manual'],
  // Sleep + recovery: Whoop is the gold standard if connected — its sensor
  // and scoring is dedicated to these domains. HealthKit gets second priority
  // because it aggregates Apple Watch + 3rd-party sleep trackers.
  sleep_total_min: ['whoop', 'healthkit', 'garmin', 'healthconnect', 'manual'],
  sleep_efficiency_pct: ['whoop', 'healthkit', 'garmin', 'healthconnect', 'manual'],
  recovery_score: ['whoop', 'garmin', 'healthkit', 'healthconnect', 'manual'],
  hrv_rmssd_ms: ['whoop', 'healthkit', 'garmin', 'healthconnect', 'manual'],
  resting_hr_bpm: ['whoop', 'healthkit', 'garmin', 'healthconnect', 'manual'],
};

export interface DailyMetricRow {
  id: number | string;
  source: ProviderSource;
  synced_at?: string;
  value?: number;
}

export interface CanonicalDecision {
  winnerId: DailyMetricRow['id'];
  winnerReason: CanonicalWinnerReason;
}

export function decideCanonical(
  rows: DailyMetricRow[],
  metric: DailyMetricName,
): CanonicalDecision | null {
  if (!rows.length) return null;

  const priority = CANONICAL_SOURCE_PRIORITY[metric];
  const priorityIdx = (s: ProviderSource) => {
    const i = priority.indexOf(s);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  const sorted = [...rows].sort((a, b) => {
    const pa = priorityIdx(a.source);
    const pb = priorityIdx(b.source);
    if (pa !== pb) return pa - pb;
    // Freshness tiebreaker — newest wins.
    return String(b.synced_at ?? '').localeCompare(String(a.synced_at ?? ''));
  });

  const winner = sorted[0];
  const reason: CanonicalWinnerReason =
    rows.length === 1
      ? 'only_source'
      : winner.source === 'healthkit'
      ? 'healthkit_aggregated'
      : priorityIdx(winner.source) < priority.length
      ? 'fallback_priority'
      : 'freshest_complete_source';

  return { winnerId: winner.id, winnerReason: reason };
}
