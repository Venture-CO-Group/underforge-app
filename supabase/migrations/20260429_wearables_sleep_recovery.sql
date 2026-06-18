-- ============================================================================
-- Wearables Integration v1 - Sleep & Recovery extension
--
-- Adds sleep + recovery main indicators to the canonical-source-per-metric
-- model introduced in 20260423_wearables.sql. Storage stays the same:
-- one row per (user, metric, date, source) inside `daily_metrics`.
--
-- Indicators added (all per-day, single numeric value per row):
--   - sleep_total_min       Sum of light + slow-wave + REM sleep in minutes
--                           (excludes time awake / no-data; main night sleep
--                           only — naps are skipped during ingestion).
--   - sleep_efficiency_pct  Whoop `score.sleep_efficiency_percentage` 0–100.
--   - recovery_score        Whoop `score.recovery_score` 0–100.
--   - hrv_rmssd_ms          Heart-rate variability in milliseconds.
--   - resting_hr_bpm        Resting heart rate in bpm.
--
-- Provider raw payload kinds also gain `recovery` so the audit trail covers
-- both sleep + recovery webhooks and poller pulls.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend daily_metrics.metric CHECK constraint
-- ---------------------------------------------------------------------------
ALTER TABLE public.daily_metrics
  DROP CONSTRAINT IF EXISTS daily_metrics_metric_check;

ALTER TABLE public.daily_metrics
  ADD CONSTRAINT daily_metrics_metric_check
  CHECK (metric IN (
    'steps',
    'active_energy_kcal',
    'resting_energy_kcal',
    'sleep_total_min',
    'sleep_efficiency_pct',
    'recovery_score',
    'hrv_rmssd_ms',
    'resting_hr_bpm'
  ));

-- ---------------------------------------------------------------------------
-- 2. Extend provider_raw_payloads.kind CHECK constraint
-- ---------------------------------------------------------------------------
ALTER TABLE public.provider_raw_payloads
  DROP CONSTRAINT IF EXISTS provider_raw_payloads_kind_check;

ALTER TABLE public.provider_raw_payloads
  ADD CONSTRAINT provider_raw_payloads_kind_check
  CHECK (kind IN (
    'workout',
    'steps',
    'active_energy',
    'resting_energy',
    'sleep',
    'recovery',
    'heart_rate',
    'other'
  ));
