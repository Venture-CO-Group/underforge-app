-- Per-user, per-step notes written manually by the human coach in Supabase
-- Studio. Stored as a JSON string on `user_profile` (not nested inside
-- `onboarding_profile_json`) so that plan regenerations / in-app plan edits,
-- which replace the entire `actionPlan` object, do not clobber coach notes.
--
-- Shape (string keys are the fixed action-step ids):
--   {
--     "step_1": "Focus on hip hinge this block...",
--     "step_2": "Keep protein at 1.8g/kg...",
--     "step_3": "Prioritize 7.5h sleep..."
--   }
--
-- NULL / missing keys render a discrete placeholder in the step detail UI.

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS human_coach_step_notes_json text;
