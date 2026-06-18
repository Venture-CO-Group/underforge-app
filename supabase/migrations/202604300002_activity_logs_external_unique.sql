-- ============================================================================
-- Make activity_logs external-id upserts compatible with PostgREST
--
-- The wearable ingestion path upserts via:
--   onConflict: 'user_id,source,external_id'
--
-- PostgREST cannot target the previous partial unique index
-- (`... WHERE external_id IS NOT NULL`) for this upsert. A normal unique
-- index still allows multiple manual/null external IDs in Postgres because
-- NULL values are distinct, while giving provider rows a concrete conflict
-- target.
-- ============================================================================

DROP INDEX IF EXISTS public.uniq_activity_logs_external;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_activity_logs_external
  ON public.activity_logs(user_id, source, external_id);

NOTIFY pgrst, 'reload schema';
