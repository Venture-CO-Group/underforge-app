-- ============================================================================
-- Activity logs status column for wearable ingestion
--
-- Wearable webhooks need to mark provider-deleted activities without removing
-- the historical row, and the ingestion helper already upserts `status =
-- 'active'`. Some deployed databases predate that column, so add it
-- idempotently.
-- ============================================================================

ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deleted'));

-- Force PostgREST/Supabase Edge schema cache to notice the new column quickly.
NOTIFY pgrst, 'reload schema';
