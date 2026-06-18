-- Plan tiers + coach_user as an append-only assignment log + checkin_type.
-- See schema.sql for the canonical definitions and rationale.

-- 1. Plan-tier catalog ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plan_tiers (
  id serial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  checkins_per_week numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.plan_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Plan tiers can be public read." ON public.plan_tiers;
CREATE POLICY "Plan tiers can be public read."
  ON public.plan_tiers FOR SELECT USING (true);
DROP POLICY IF EXISTS "Plan tiers can be public inserted." ON public.plan_tiers;
CREATE POLICY "Plan tiers can be public inserted."
  ON public.plan_tiers FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Plan tiers can be public updated." ON public.plan_tiers;
CREATE POLICY "Plan tiers can be public updated."
  ON public.plan_tiers FOR UPDATE USING (true) WITH CHECK (true);

INSERT INTO public.plan_tiers (key, display_name, checkins_per_week) VALUES
  ('ai_only',        'AI only',                    0),
  ('human_2x_month', '2x / month human check-in',  0.5),
  ('human_2x_week',  '2x / week human check-in',   2)
ON CONFLICT (key) DO NOTHING;

-- 2. coach_user -> append-only log ------------------------------------------
ALTER TABLE public.coach_user
  ADD COLUMN IF NOT EXISTS plan_tier_id integer REFERENCES public.plan_tiers(id);
ALTER TABLE public.coach_user
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true;

-- Drop the old one-row-per-(coach,user) constraint so tier/coach changes can append rows.
ALTER TABLE public.coach_user DROP CONSTRAINT IF EXISTS coach_user_coach_id_user_id_key;

-- Legacy safety: the old constraint allowed a user to be attached to multiple coaches, so
-- a user may already have >1 row — all of which just defaulted to is_current = true. Demote
-- every row except the most recent per user (by assigned_at, then id) so the partial unique
-- index below can build. Idempotent: re-running leaves a single live row untouched.
UPDATE public.coach_user c
SET is_current = false
WHERE c.is_current = true
  AND EXISTS (
    SELECT 1 FROM public.coach_user c2
    WHERE c2.user_id = c.user_id
      AND c2.is_current = true
      AND (c2.assigned_at > c.assigned_at
           OR (c2.assigned_at = c.assigned_at AND c2.id > c.id))
  );

-- Enforce exactly one live row per user instead.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_user_current
  ON public.coach_user(user_id) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_coach_user_plan_tier_id
  ON public.coach_user(plan_tier_id);

-- 3. checkin_coach_with_user -> how the check-in happened -------------------
ALTER TABLE public.checkin_coach_with_user
  ADD COLUMN IF NOT EXISTS checkin_type text
  CHECK (checkin_type IN ('message', 'call', 'video', 'in_person'));
