-- Classify each coach as AI-only or AI/human hybrid. Used at onboarding time
-- to set the user's `coach_type` (persisted on `onboarding_profile_json`),
-- which in turn gates the human chat mode in ChatScreen.
ALTER TABLE public.coaches
  ADD COLUMN IF NOT EXISTS coach_type text NOT NULL DEFAULT 'ai_only'
  CHECK (coach_type IN ('ai_only', 'ai_human_hybrid'));

-- Alonso Prieto (id = 3) is the only hybrid coach today.
UPDATE public.coaches
SET coach_type = 'ai_human_hybrid'
WHERE id = 3;
