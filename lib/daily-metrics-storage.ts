/**
 * Daily-metrics storage. Mirrors the local-first shape of `activity-storage.ts`
 * but for the `daily_metrics` table (steps, active energy, resting energy).
 *
 * Canonical-source-per-metric model:
 *   - Every source writes its own row for (user, metric, date, source).
 *   - `resolveCanonicalDailyMetric` picks ONE winner per (user, metric, date)
 *     using `CANONICAL_SOURCE_PRIORITY` and marks it `is_canonical = true`.
 *   - All consumer code (UI, nutrition adjustment, reports) MUST read only
 *     canonical rows. Never sum across sources.
 *
 * The same resolver is mirrored in `supabase/functions/_shared/canonical.ts`
 * so webhook-side inserts reach the same decision without a device round-trip.
 */

import { createClient } from '@supabase/supabase-js';
import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import {
  CANONICAL_SOURCE_PRIORITY,
  type CanonicalWinnerReason,
  type Confidence,
  type DailyMetricName,
  type NormalizedDailyMetric,
  type ProviderSource,
} from './providers/types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let supabase: any;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export interface DailyMetricRow {
  id?: number;
  supabaseId?: number;
  userId: string;
  metricDate: string;
  metric: DailyMetricName;
  source: ProviderSource;
  value: number;
  isCanonical: boolean;
  winnerReason?: CanonicalWinnerReason;
  confidence: Confidence;
  syncedAt?: string;
}

/**
 * Upsert a single (user, metric, date, source) reading locally and on
 * Supabase. Returns the local row id. Does NOT recompute canonical winners;
 * callers that care about canonical selection should call
 * `resolveCanonicalDailyMetric` afterwards.
 */
export const upsertDailyMetric = async (
  metric: NormalizedDailyMetric,
): Promise<number | null> => {
  try {
    const db = getDatabase();
    const now = new Date().toISOString();
    const confidence: Confidence = metric.confidence ?? 'high';

    // SQLite UPSERT via unique (user_id, metric_date, metric, source).
    await db.runAsync(
      `INSERT INTO daily_metrics
         (user_id, metric_date, metric, source, value, is_canonical, confidence, synced_at, synced)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0)
       ON CONFLICT(user_id, metric_date, metric, source)
       DO UPDATE SET value = excluded.value,
                     confidence = excluded.confidence,
                     synced_at = excluded.synced_at,
                     synced = 0`,
      [
        metric.userId,
        metric.metricDate,
        metric.metric,
        metric.source,
        metric.value,
        confidence,
        now,
      ],
    );

    const row = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM daily_metrics
        WHERE user_id = ? AND metric_date = ? AND metric = ? AND source = ?`,
      [metric.userId, metric.metricDate, metric.metric, metric.source],
    );
    const localId = row?.id ?? null;

    // Fire-and-forget Supabase upsert (we keep the local row as canonical
    // truth; failures are retried by `retryPendingDailyMetrics`).
    if (supabase) {
      void (async () => {
        try {
          const { error } = await supabase
            .from('daily_metrics')
            .upsert(
              {
                user_id: metric.userId,
                metric_date: metric.metricDate,
                metric: metric.metric,
                source: metric.source,
                value: metric.value,
                confidence,
              },
              { onConflict: 'user_id,metric_date,metric,source' },
            );
          if (!error && localId != null) {
            await db.runAsync(
              'UPDATE daily_metrics SET synced = 1 WHERE id = ?',
              [localId],
            );
          } else if (error) {
            glowLogger.warn('Supabase daily_metrics upsert failed', {
              error: error.message,
              metric: metric.metric,
              source: metric.source,
            });
          }
        } catch (e) {
          glowLogger.warn('Supabase daily_metrics upsert error', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
    }

    return localId;
  } catch (error) {
    glowLogger.error('Failed to upsert daily metric', {
      error: error instanceof Error ? error.message : String(error),
      metric: metric.metric,
      source: metric.source,
      date: metric.metricDate,
    });
    return null;
  }
};

/**
 * Recompute which source is canonical for (user, metric, date), writing
 * `is_canonical` and `winner_reason` appropriately. Idempotent.
 *
 * Priority rules (see `CANONICAL_SOURCE_PRIORITY`):
 *   1. HealthKit wins whenever it has a row — it already aggregates Apple
 *      Watch + iPhone + third-party Health writers.
 *   2. Among direct providers the static priority list wins.
 *   3. If only one source has a row today, it's automatically canonical.
 *
 * Returns the winning row, or null if no rows exist yet.
 */
export const resolveCanonicalDailyMetric = async (
  userId: string,
  metricDate: string,
  metric: DailyMetricName,
): Promise<DailyMetricRow | null> => {
  const db = getDatabase();

  const rows = await db.getAllAsync<any>(
    `SELECT id, supabase_id, user_id, metric_date, metric, source, value,
            is_canonical, confidence, winner_reason, synced_at
       FROM daily_metrics
      WHERE user_id = ? AND metric_date = ? AND metric = ?`,
    [userId, metricDate, metric],
  );

  if (!rows || rows.length === 0) return null;

  const priority = CANONICAL_SOURCE_PRIORITY[metric];
  const priorityIdx = (s: string) => {
    const i = priority.indexOf(s as ProviderSource);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  // Sort by priority, then freshness as tiebreaker.
  const sorted = [...rows].sort((a, b) => {
    const pa = priorityIdx(a.source);
    const pb = priorityIdx(b.source);
    if (pa !== pb) return pa - pb;
    return String(b.synced_at ?? '').localeCompare(String(a.synced_at ?? ''));
  });

  const winner = sorted[0];
  const winnerReason: CanonicalWinnerReason =
    rows.length === 1
      ? 'only_source'
      : winner.source === 'healthkit'
      ? 'healthkit_aggregated'
      : priorityIdx(winner.source) < priority.length
      ? 'fallback_priority'
      : 'freshest_complete_source';

  // Flip is_canonical on the winner, off on everyone else.
  // Run as two statements; SQLite has no boolean type so use 1/0.
  await db.runAsync(
    `UPDATE daily_metrics SET is_canonical = 0, winner_reason = NULL
      WHERE user_id = ? AND metric_date = ? AND metric = ?`,
    [userId, metricDate, metric],
  );
  await db.runAsync(
    `UPDATE daily_metrics SET is_canonical = 1, winner_reason = ?
      WHERE id = ?`,
    [winnerReason, winner.id],
  );

  // Best-effort propagate to Supabase. Not atomic with the local write, but
  // idempotent so running the same resolver server-side converges.
  if (supabase) {
    void (async () => {
      try {
        await supabase
          .from('daily_metrics')
          .update({ is_canonical: false, winner_reason: null })
          .eq('user_id', userId)
          .eq('metric_date', metricDate)
          .eq('metric', metric);
        await supabase
          .from('daily_metrics')
          .update({ is_canonical: true, winner_reason: winnerReason })
          .eq('user_id', userId)
          .eq('metric_date', metricDate)
          .eq('metric', metric)
          .eq('source', winner.source);
      } catch (e) {
        glowLogger.warn('Supabase canonical update failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }

  return mapRowToDailyMetric({
    ...winner,
    is_canonical: 1,
    winner_reason: winnerReason,
  });
};

/** Read the canonical row for (user, metric, date). Returns null if none. */
export const getCanonicalDailyMetric = async (
  userId: string,
  metricDate: string,
  metric: DailyMetricName,
): Promise<DailyMetricRow | null> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<any>(
      `SELECT id, supabase_id, user_id, metric_date, metric, source, value,
              is_canonical, confidence, winner_reason, synced_at
         FROM daily_metrics
        WHERE user_id = ? AND metric_date = ? AND metric = ? AND is_canonical = 1
        LIMIT 1`,
      [userId, metricDate, metric],
    );
    return row ? mapRowToDailyMetric(row) : null;
  } catch (error) {
    glowLogger.error('Failed to get canonical daily metric', {
      error: error instanceof Error ? error.message : String(error),
      metric,
      date: metricDate,
    });
    return null;
  }
};

/**
 * Read canonical rows for a metric across a date range. Returns rows in
 * ascending date order. Used by the calories breakdown modal to compute
 * 30-day averages without making 30 round-trips.
 */
export const getCanonicalDailyMetricsRange = async (
  userId: string,
  metric: DailyMetricName,
  startDate: string,
  endDate: string,
): Promise<DailyMetricRow[]> => {
  try {
    const db = getDatabase();
    const rows = await db.getAllAsync<any>(
      `SELECT id, supabase_id, user_id, metric_date, metric, source, value,
              is_canonical, confidence, winner_reason, synced_at
         FROM daily_metrics
        WHERE user_id = ? AND metric = ? AND is_canonical = 1
          AND metric_date >= ? AND metric_date <= ?
        ORDER BY metric_date ASC`,
      [userId, metric, startDate, endDate],
    );
    return rows.map(mapRowToDailyMetric);
  } catch (error) {
    glowLogger.error('Failed to get canonical daily metrics range', {
      error: error instanceof Error ? error.message : String(error),
      metric,
      start: startDate,
      end: endDate,
    });
    return [];
  }
};

/** Read ALL sources for (user, metric, date), used by the long-press UI. */
export const getDailyMetricSources = async (
  userId: string,
  metricDate: string,
  metric: DailyMetricName,
): Promise<DailyMetricRow[]> => {
  try {
    const db = getDatabase();
    const rows = await db.getAllAsync<any>(
      `SELECT id, supabase_id, user_id, metric_date, metric, source, value,
              is_canonical, confidence, winner_reason, synced_at
         FROM daily_metrics
        WHERE user_id = ? AND metric_date = ? AND metric = ?
        ORDER BY is_canonical DESC, source ASC`,
      [userId, metricDate, metric],
    );
    return (rows ?? []).map(mapRowToDailyMetric);
  } catch (error) {
    glowLogger.error('Failed to get daily metric sources', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

/**
 * Pull daily_metrics rows from Supabase into local SQLite for the last N days.
 * Called during the same sync cascade that hydrates activity_logs.
 */
export const syncDailyMetricsFromSupabase = async (
  userId: string,
  daysBack = 30,
): Promise<number> => {
  if (!supabase) return 0;
  try {
    const db = getDatabase();
    const now = new Date();
    const start = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const startStr = toDateStr(start);
    const endStr = toDateStr(now);

    const { data, error } = await supabase
      .from('daily_metrics')
      .select('*')
      .eq('user_id', userId)
      .gte('metric_date', startStr)
      .lte('metric_date', endStr);

    if (error || !data) {
      glowLogger.warn('Failed to fetch daily_metrics from Supabase', {
        error: error?.message,
        user_id: userId,
      });
      return 0;
    }

    let upsertedCount = 0;
    for (const row of data) {
      try {
        await db.runAsync(
          `INSERT INTO daily_metrics
             (supabase_id, user_id, metric_date, metric, source, value,
              is_canonical, confidence, winner_reason, synced_at, synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(user_id, metric_date, metric, source)
           DO UPDATE SET value = excluded.value,
                         is_canonical = excluded.is_canonical,
                         confidence = excluded.confidence,
                         winner_reason = excluded.winner_reason,
                         synced_at = excluded.synced_at,
                         supabase_id = excluded.supabase_id,
                         synced = 1`,
          [
            row.id,
            row.user_id,
            row.metric_date,
            row.metric,
            row.source,
            row.value,
            row.is_canonical ? 1 : 0,
            row.confidence ?? 'high',
            row.winner_reason ?? null,
            row.synced_at ?? new Date().toISOString(),
          ],
        );
        upsertedCount++;
      } catch (e) {
        glowLogger.warn('Failed to upsert remote daily_metric into local', {
          error: e instanceof Error ? e.message : String(e),
          row_id: row?.id,
        });
      }
    }
    return upsertedCount;
  } catch (error) {
    glowLogger.error('Error syncing daily_metrics from Supabase', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
};

/**
 * Hard-delete every daily_metrics row for `(userId, source)` locally, then
 * re-resolve canonical winners for each affected (date, metric). Used when a
 * provider disconnects so SQLite matches Supabase cleanup.
 */
export const hardDeleteDailyMetricsBySource = async (
  userId: string,
  source: ProviderSource,
): Promise<number> => {
  try {
    const db = getDatabase();
    const affected = await db.getAllAsync<{ metric_date: string; metric: string }>(
      `SELECT DISTINCT metric_date, metric FROM daily_metrics WHERE user_id = ? AND source = ?`,
      [userId, source],
    );
    const before = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) as n FROM daily_metrics WHERE user_id = ? AND source = ?`,
      [userId, source],
    );
    const count = Number(before?.n ?? 0);
    if (count === 0) return 0;

    await db.runAsync(`DELETE FROM daily_metrics WHERE user_id = ? AND source = ?`, [userId, source]);
    glowLogger.info('Hard-deleted daily metrics for provider disconnect', {
      user_id: userId,
      source,
      count,
    });

    for (const row of affected ?? []) {
      await resolveCanonicalDailyMetric(userId, row.metric_date, row.metric as DailyMetricName);
    }
    return count;
  } catch (e) {
    glowLogger.error('hardDeleteDailyMetricsBySource failed', {
      error: e instanceof Error ? e.message : String(e),
      user_id: userId,
      source,
    });
    return 0;
  }
};

// ---- internal helpers ----

function mapRowToDailyMetric(row: any): DailyMetricRow {
  return {
    id: row.id,
    supabaseId: row.supabase_id ?? undefined,
    userId: row.user_id,
    metricDate: row.metric_date,
    metric: row.metric,
    source: row.source,
    value: Number(row.value),
    isCanonical: row.is_canonical === 1 || row.is_canonical === true,
    winnerReason: row.winner_reason ?? undefined,
    confidence: (row.confidence ?? 'high') as Confidence,
    syncedAt: row.synced_at ?? undefined,
  };
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
