// Ingestion helpers: given a normalized activity/daily metric, upsert into
// Supabase and re-run canonical resolution. Used by both the Whoop webhook
// and the poller so the two paths stay behaviour-equivalent.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decideCanonical, DailyMetricName, ProviderSource } from './canonical.ts';
import type { NormalizedActivity } from './normalize.ts';

function dbErrorMessage(context: string, error: unknown): string {
  if (error instanceof Error) return `${context}: ${error.message}`;
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const pieces = [
      e.message ? String(e.message) : null,
      e.details ? `details=${String(e.details)}` : null,
      e.hint ? `hint=${String(e.hint)}` : null,
      e.code ? `code=${String(e.code)}` : null,
    ].filter(Boolean);
    if (pieces.length) return `${context}: ${pieces.join(' ')}`;
    try {
      return `${context}: ${JSON.stringify(error)}`;
    } catch {
      return `${context}: ${String(error)}`;
    }
  }
  return `${context}: ${String(error)}`;
}

export async function storeRawPayload(
  supabase: SupabaseClient,
  row: {
    user_id: string;
    provider: ProviderSource;
    kind: 'workout' | 'steps' | 'active_energy' | 'resting_energy' | 'sleep' | 'recovery' | 'heart_rate' | 'other';
    external_id?: string;
    payload: unknown;
  },
): Promise<number | null> {
  const { data, error } = await supabase
    .from('provider_raw_payloads')
    .insert(row)
    .select('id')
    .single();
  if (error) {
    console.error('provider_raw_payloads insert failed', error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function upsertActivity(
  supabase: SupabaseClient,
  normalized: NormalizedActivity,
  payloadId: number | null,
): Promise<void> {
  const { error } = await supabase
    .from('activity_logs')
    .upsert(
      {
        user_id: normalized.user_id,
        activity_date: normalized.activity_date,
        activity_type: normalized.activity_type,
        activity_name: normalized.activity_name,
        duration_minutes: normalized.duration_minutes,
        intensity: normalized.intensity,
        distance_value: normalized.distance_value ?? null,
        distance_unit: normalized.distance_unit ?? null,
        elevation_gain: normalized.elevation_gain ?? null,
        calories_burned: normalized.calories_burned,
        avg_heart_rate: normalized.avg_heart_rate ?? null,
        notes: normalized.notes ?? null,
        source: normalized.source,
        external_id: normalized.external_id,
        payload_id: payloadId,
        calories_source: normalized.calories_source,
        calories_confidence: normalized.calories_confidence,
        dedupe_fingerprint: normalized.dedupe_fingerprint,
        started_at: normalized.started_at,
        ended_at: normalized.ended_at,
        status: 'active',
      },
      { onConflict: 'user_id,source,external_id' },
    );
  if (error) throw new Error(dbErrorMessage('activity_logs upsert failed', error));
}

/**
 * Upsert a daily metric reading and re-resolve canonical for that
 * (user, metric, date). Safe to call on every inbound sample.
 */
export async function upsertDailyMetricAndResolve(
  supabase: SupabaseClient,
  row: {
    user_id: string;
    metric_date: string;
    metric: DailyMetricName;
    source: ProviderSource;
    value: number;
    confidence?: 'high' | 'medium' | 'low';
    payload_id?: number | null;
  },
): Promise<void> {
  const { error: upsertErr } = await supabase
    .from('daily_metrics')
    .upsert(
      {
        user_id: row.user_id,
        metric_date: row.metric_date,
        metric: row.metric,
        source: row.source,
        value: row.value,
        confidence: row.confidence ?? 'high',
        payload_id: row.payload_id ?? null,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,metric_date,metric,source' },
    );
  if (upsertErr) throw new Error(dbErrorMessage('daily_metrics upsert failed', upsertErr));

  const { data: all, error: selErr } = await supabase
    .from('daily_metrics')
    .select('id, source, synced_at, value')
    .eq('user_id', row.user_id)
    .eq('metric_date', row.metric_date)
    .eq('metric', row.metric);
  if (selErr) throw new Error(dbErrorMessage('daily_metrics select failed', selErr));

  const decision = decideCanonical(all ?? [], row.metric);
  if (!decision) return;

  await supabase
    .from('daily_metrics')
    .update({ is_canonical: false, winner_reason: null })
    .eq('user_id', row.user_id)
    .eq('metric_date', row.metric_date)
    .eq('metric', row.metric);

  await supabase
    .from('daily_metrics')
    .update({ is_canonical: true, winner_reason: decision.winnerReason })
    .eq('id', decision.winnerId);

  // Guardrail: we leave `nutrition_daily_adjustments` recomputation to the
  // device because it requires the baseline targets + body weight context.
  // The device picks up the new canonical value on the next sync tick.
}
