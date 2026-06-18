-- ============================================================================
-- Wearables Integration v1
--
-- Adds tables and columns required to ingest external wearable/provider data
-- (HealthKit on-device, Whoop via Edge Functions) and to layer a dynamic
-- per-day nutrition adjustment on top of `user_nutrition_targets` without
-- overwriting the baseline targets.
--
-- Ordering:
--   1. provider_raw_payloads  -- referenced by daily_metrics + activity_logs
--   2. user_provider_connections
--   3. daily_metrics          -- canonical-source-per-metric model
--   4. nutrition_daily_adjustments
--   5. activity_logs          -- additive columns + dedupe indexes
--
-- RLS: OAuth tokens and raw provider payloads are intentionally _not_ exposed
-- via permissive public policies. Edge Functions access them using the
-- service role. All other tables follow the existing public-policy pattern.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Raw provider payloads (audit trail, replay, debugging)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_raw_payloads (
  id BIGSERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('healthkit','whoop','garmin','healthconnect')),
  kind text NOT NULL CHECK (kind IN ('workout','steps','active_energy','resting_energy','sleep','heart_rate','other')),
  external_id text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prp_user_provider
  ON public.provider_raw_payloads(user_id, provider, kind);
CREATE INDEX IF NOT EXISTS idx_prp_external_id
  ON public.provider_raw_payloads(provider, external_id) WHERE external_id IS NOT NULL;

ALTER TABLE public.provider_raw_payloads ENABLE ROW LEVEL SECURITY;
-- No permissive policies: only service-role can read/write raw payloads.

-- ---------------------------------------------------------------------------
-- 2. Provider connections (OAuth tokens -- service role only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_provider_connections (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('healthkit','whoop','garmin','healthconnect')),
  external_user_id text,
  -- Tokens stored encrypted via pgcrypto (see supabase/functions/_shared/encrypt.ts).
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[],
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  last_sync_cursor text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','revoked','error')),
  last_error text,
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_upc_user_id
  ON public.user_provider_connections(user_id);

ALTER TABLE public.user_provider_connections ENABLE ROW LEVEL SECURITY;

-- The device only needs to know which providers are connected (not tokens).
-- Expose a safe view for the app client, gated by RLS.
CREATE OR REPLACE VIEW public.user_provider_connections_public AS
  SELECT id, user_id, provider, external_user_id, connected_at,
         last_sync_at, status, last_error
    FROM public.user_provider_connections;

REVOKE ALL ON TABLE public.user_provider_connections FROM anon;
REVOKE ALL ON TABLE public.user_provider_connections FROM authenticated;
GRANT SELECT ON public.user_provider_connections_public TO anon;
GRANT SELECT ON public.user_provider_connections_public TO authenticated;

-- Reads/writes of token rows are service-role only -- no anon/auth table policies.

-- ---------------------------------------------------------------------------
-- 3. Daily metrics (canonical-source-per-metric model)
-- ---------------------------------------------------------------------------
-- One row per (user, metric, date, source). Winner row has is_canonical=true.
-- Never sum across sources; the canonical value is the only one used by UI,
-- coaching, reporting, and nutrition adjustments.
CREATE TABLE IF NOT EXISTS public.daily_metrics (
  id BIGSERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  metric text NOT NULL
    CHECK (metric IN ('steps','active_energy_kcal','resting_energy_kcal')),
  source text NOT NULL
    CHECK (source IN ('healthkit','whoop','garmin','healthconnect','manual')),
  value numeric NOT NULL CHECK (value >= 0),
  is_canonical boolean NOT NULL DEFAULT false,
  winner_reason text
    CHECK (winner_reason IN (
      'healthkit_aggregated',
      'preferred_source',
      'fallback_priority',
      'freshest_complete_source',
      'only_source'
    )),
  confidence text NOT NULL DEFAULT 'high'
    CHECK (confidence IN ('high','medium','low')),
  payload_id bigint REFERENCES public.provider_raw_payloads(id) ON DELETE SET NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, metric_date, metric, source)
);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_canonical
  ON public.daily_metrics(user_id, metric_date, metric)
  WHERE is_canonical;
CREATE INDEX IF NOT EXISTS idx_daily_metrics_user_date
  ON public.daily_metrics(user_id, metric_date);

ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Daily metrics can be public inserted."
  ON public.daily_metrics FOR INSERT WITH CHECK (true);
CREATE POLICY "Daily metrics can be public read."
  ON public.daily_metrics FOR SELECT USING (true);
CREATE POLICY "Daily metrics can be public updated."
  ON public.daily_metrics FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Daily metrics can be public deleted."
  ON public.daily_metrics FOR DELETE USING (true);

-- ---------------------------------------------------------------------------
-- 4. Nutrition daily adjustments (derived, layered on top of baseline targets)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nutrition_daily_adjustments (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  adjustment_date date NOT NULL,

  -- Baseline (copied from user_nutrition_targets effective on this date)
  base_calories_target integer NOT NULL,
  base_carbs_target_grams decimal(6,1) NOT NULL,
  base_protein_target_grams decimal(6,1) NOT NULL,
  base_fat_target_grams decimal(6,1) NOT NULL,
  base_fiber_target_grams decimal(6,1) NOT NULL,

  -- Inputs
  activity_calories_burned integer NOT NULL DEFAULT 0,
  steps_neat_calories integer NOT NULL DEFAULT 0,

  -- Adjusted outputs (capped and split per strategy)
  adjusted_calories_target integer NOT NULL,
  adjusted_carbs_target_grams decimal(6,1) NOT NULL,
  adjusted_protein_target_grams decimal(6,1) NOT NULL,
  adjusted_fat_target_grams decimal(6,1) NOT NULL,
  adjusted_fiber_target_grams decimal(6,1) NOT NULL,

  strategy text NOT NULL DEFAULT 'carbs_first_v1'
    CHECK (strategy IN ('carbs_first_v1','proportional_v1')),
  -- Hash of inputs used so we can short-circuit redundant recomputes.
  inputs_digest text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, adjustment_date)
);

CREATE INDEX IF NOT EXISTS idx_nda_user_date
  ON public.nutrition_daily_adjustments(user_id, adjustment_date);

ALTER TABLE public.nutrition_daily_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Nutrition daily adjustments can be public inserted."
  ON public.nutrition_daily_adjustments FOR INSERT WITH CHECK (true);
CREATE POLICY "Nutrition daily adjustments can be public read."
  ON public.nutrition_daily_adjustments FOR SELECT USING (true);
CREATE POLICY "Nutrition daily adjustments can be public updated."
  ON public.nutrition_daily_adjustments FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Nutrition daily adjustments can be public deleted."
  ON public.nutrition_daily_adjustments FOR DELETE USING (true);

-- ---------------------------------------------------------------------------
-- 5. activity_logs: source, dedupe, and calorie provenance columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','healthkit','whoop','garmin','healthconnect')),
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS payload_id bigint REFERENCES public.provider_raw_payloads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calories_source text
    CHECK (calories_source IN ('provider','estimated_met','estimated_hr','manual')) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS calories_confidence text
    CHECK (calories_confidence IN ('high','medium','low')) DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS dedupe_fingerprint text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

-- Primary dedupe: same provider-assigned external id never inserted twice.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_activity_logs_external
  ON public.activity_logs(user_id, source, external_id);

-- Cross-source dedupe index used by resolveActivityDedupe().
CREATE INDEX IF NOT EXISTS idx_activity_logs_fingerprint
  ON public.activity_logs(user_id, dedupe_fingerprint);
