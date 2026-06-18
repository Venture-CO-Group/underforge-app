-- Coach-owned Forging Circles: a coach can own a circle directly from the
-- dashboard, without proxying through one of their coachees.
-- See schema.sql (public.forging_circles) and docs/coach-dashboard-data-model.md
-- ("Coach-owned Forging Circles") for the canonical definition and rationale.
--
-- Invariant (enforced in app + dashboard code, not via a DB CHECK yet): exactly
-- one of owner_user_id / owner_coach_id is non-null per row.

-- New nullable owner: a coach (NULL for legacy user-owned circles).
ALTER TABLE public.forging_circles
  ADD COLUMN IF NOT EXISTS owner_coach_id integer REFERENCES public.coaches(id) ON DELETE SET NULL;

-- owner_user_id is NULL for coach-owned circles; drop the legacy NOT NULL.
ALTER TABLE public.forging_circles
  ALTER COLUMN owner_user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_forging_circles_owner_coach_id
  ON public.forging_circles(owner_coach_id);
