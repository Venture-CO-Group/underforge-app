-- 20260527160000_multi_forging_circles
--
-- Evolves the single global Forging Circle into multiple user-owned, named
-- circles. The old `forging_circle_members` table modeled one implicit circle
-- per user with symmetric `(user_id, member_user_id)` rows; this migration:
--
--  1. Introduces `forging_circles` (id, owner_user_id, name) — circle metadata.
--  2. Rewrites `forging_circle_members` so each row is `(circle_id, member_user_id)`.
--     The owner is implicit (never duplicated in members). "Participants" =
--     `circle.owner_user_id` ∪ `forging_circle_members.member_user_id`.
--  3. Adds `circle_id` to `forging_circle_invites` so each invite is scoped to
--     a specific named circle.
--  4. Backfills a default "My Forging Circle" per user who had legacy members
--     and moves invites/members onto it.
--  5. Renames `default_share_audience` value `'circle'` → `'circles'` (plural).
--  6. Adds optional `social_posts.circle_id` for future per-circle targeting
--     (not yet exposed in share UI; v1 still uses visibility public/circle).
--  7. Rewrites the `accept_circle_invite` RPC to write a single membership row
--     scoped to the invite's `circle_id`.
--
-- All steps are idempotent so the migration can be re-run safely.

-- ============================================================================
-- 1. forging_circles
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.forging_circles (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_forging_circles_owner
  ON public.forging_circles(owner_user_id, created_at DESC);

ALTER TABLE public.forging_circles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Forging circles can be public inserted." ON public.forging_circles;
DROP POLICY IF EXISTS "Forging circles can be public read." ON public.forging_circles;
DROP POLICY IF EXISTS "Forging circles can be public updated." ON public.forging_circles;
DROP POLICY IF EXISTS "Forging circles can be public deleted." ON public.forging_circles;
CREATE POLICY "Forging circles can be public inserted."
  ON public.forging_circles FOR INSERT WITH CHECK (true);
CREATE POLICY "Forging circles can be public read."
  ON public.forging_circles FOR SELECT USING (true);
CREATE POLICY "Forging circles can be public updated."
  ON public.forging_circles FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Forging circles can be public deleted."
  ON public.forging_circles FOR DELETE USING (true);

-- ============================================================================
-- 2. Backfill default circles for users with legacy memberships/invites
--    (only runs once thanks to ON CONFLICT and IF NOT EXISTS guards.)
-- ============================================================================
DO $migrate$
DECLARE
  v_has_legacy_user_col boolean;
  v_has_legacy_member_col boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'forging_circle_members'
       AND column_name = 'user_id'
  ) INTO v_has_legacy_user_col;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'forging_circle_members'
       AND column_name = 'member_user_id'
  ) INTO v_has_legacy_member_col;

  -- Create a "My Forging Circle" for every user that participates in any
  -- legacy row (either as owner or as someone else's member).
  IF v_has_legacy_user_col THEN
    INSERT INTO public.forging_circles (owner_user_id, name)
    SELECT DISTINCT m.user_id, 'My Forging Circle'
      FROM public.forging_circle_members m
      WHERE m.user_id IS NOT NULL
    ON CONFLICT (owner_user_id, name) DO NOTHING;
  END IF;

  -- Also seed for users that only appear on the receiving side of an invite —
  -- they may not have any membership rows yet but still need a destination
  -- circle for their pending invites.
  INSERT INTO public.forging_circles (owner_user_id, name)
  SELECT DISTINCT i.inviter_user_id, 'My Forging Circle'
    FROM public.forging_circle_invites i
    WHERE i.inviter_user_id IS NOT NULL
  ON CONFLICT (owner_user_id, name) DO NOTHING;
END;
$migrate$;

-- ============================================================================
-- 3. forging_circle_invites: add circle_id and backfill
-- ============================================================================
ALTER TABLE public.forging_circle_invites
  ADD COLUMN IF NOT EXISTS circle_id bigint
    REFERENCES public.forging_circles(id) ON DELETE CASCADE;

-- Backfill: each pending/accepted invite points at the inviter's default
-- "My Forging Circle". Cancelled/declined rows are also backfilled so the FK
-- stays consistent if the user re-opens history.
UPDATE public.forging_circle_invites i
   SET circle_id = c.id
  FROM public.forging_circles c
 WHERE i.circle_id IS NULL
   AND c.owner_user_id = i.inviter_user_id
   AND c.name = 'My Forging Circle';

-- Drop the legacy uniqueness on (inviter, invitee) since the same pair can now
-- exist across different circles.
DROP INDEX IF EXISTS public.idx_forging_circle_invites_active_pair;

-- New uniqueness: one active invite per (circle, invitee).
CREATE UNIQUE INDEX IF NOT EXISTS idx_forging_circle_invites_circle_invitee_active
  ON public.forging_circle_invites(circle_id, invitee_user_id)
  WHERE status IN ('pending', 'accepted') AND circle_id IS NOT NULL;

-- Now that historical rows are mapped, require circle_id going forward.
ALTER TABLE public.forging_circle_invites
  ALTER COLUMN circle_id SET NOT NULL;

-- ============================================================================
-- 4. forging_circle_members: replace symmetric (user_id, member_user_id) with
--    (circle_id, member_user_id). Backfill from legacy rows.
-- ============================================================================
ALTER TABLE public.forging_circle_members
  ADD COLUMN IF NOT EXISTS circle_id bigint
    REFERENCES public.forging_circles(id) ON DELETE CASCADE;

-- For every legacy row (user_id -> member_user_id) map it onto the user's
-- default circle. The reverse direction is implicit on the new model: the
-- inviter side is captured by being the owner of the circle, and the invitee
-- side becomes a member. Symmetric duplicates collapse on the new unique key.
DO $backfill$
DECLARE
  v_has_legacy_user_col boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'forging_circle_members'
       AND column_name = 'user_id'
  ) INTO v_has_legacy_user_col;

  IF v_has_legacy_user_col THEN
    UPDATE public.forging_circle_members m
       SET circle_id = c.id
      FROM public.forging_circles c
     WHERE m.circle_id IS NULL
       AND c.owner_user_id = m.user_id
       AND c.name = 'My Forging Circle';
  END IF;
END;
$backfill$;

-- Drop legacy constraints/columns now that data is in the new shape.
ALTER TABLE public.forging_circle_members DROP CONSTRAINT IF EXISTS forging_circle_members_user_id_member_user_id_key;
ALTER TABLE public.forging_circle_members DROP CONSTRAINT IF EXISTS forging_circle_members_check;
DROP INDEX IF EXISTS public.idx_forging_circle_members_user;
ALTER TABLE public.forging_circle_members DROP COLUMN IF EXISTS user_id;

-- Make circle_id mandatory and enforce per-circle membership uniqueness.
ALTER TABLE public.forging_circle_members
  ALTER COLUMN circle_id SET NOT NULL;

DO $unique$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'forging_circle_members_circle_id_member_user_id_key'
  ) THEN
    ALTER TABLE public.forging_circle_members
      ADD CONSTRAINT forging_circle_members_circle_id_member_user_id_key
      UNIQUE (circle_id, member_user_id);
  END IF;
END;
$unique$;

CREATE INDEX IF NOT EXISTS idx_forging_circle_members_circle
  ON public.forging_circle_members(circle_id);
CREATE INDEX IF NOT EXISTS idx_forging_circle_members_member
  ON public.forging_circle_members(member_user_id);

-- ============================================================================
-- 5. user_profile.default_share_audience: 'circle' -> 'circles' (plural)
-- ============================================================================
ALTER TABLE public.user_profile
  DROP CONSTRAINT IF EXISTS user_profile_default_share_audience_check;

UPDATE public.user_profile
   SET default_share_audience = 'circles'
 WHERE default_share_audience = 'circle';

ALTER TABLE public.user_profile
  ALTER COLUMN default_share_audience SET DEFAULT 'circles';

ALTER TABLE public.user_profile
  ADD CONSTRAINT user_profile_default_share_audience_check
  CHECK (default_share_audience IN ('public', 'circles'));

-- ============================================================================
-- 6. social_posts.circle_id (optional, for future per-circle targeting)
-- ============================================================================
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS circle_id bigint
    REFERENCES public.forging_circles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_social_posts_circle_created
  ON public.social_posts(circle_id, created_at DESC)
  WHERE deleted_at IS NULL AND circle_id IS NOT NULL;

-- ============================================================================
-- 7. accept_circle_invite RPC — circle-aware, single membership row
-- ============================================================================
CREATE OR REPLACE FUNCTION public.accept_circle_invite(p_invite_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inviter text;
  v_invitee text;
  v_circle  bigint;
  v_status  text;
BEGIN
  SELECT inviter_user_id, invitee_user_id, circle_id, status
    INTO v_inviter, v_invitee, v_circle, v_status
    FROM public.forging_circle_invites
   WHERE id = p_invite_id
   FOR UPDATE;

  IF v_inviter IS NULL THEN
    RAISE EXCEPTION 'Invite % not found', p_invite_id;
  END IF;
  IF v_invitee IS NULL THEN
    RAISE EXCEPTION 'Invite % has no resolved invitee_user_id', p_invite_id;
  END IF;
  IF v_circle IS NULL THEN
    RAISE EXCEPTION 'Invite % is not scoped to a circle', p_invite_id;
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Invite % is not pending (status=%)', p_invite_id, v_status;
  END IF;

  UPDATE public.forging_circle_invites
     SET status = 'accepted', responded_at = now()
   WHERE id = p_invite_id;

  INSERT INTO public.forging_circle_members(circle_id, member_user_id)
       VALUES (v_circle, v_invitee)
  ON CONFLICT (circle_id, member_user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_circle_invite(bigint) TO anon, authenticated;

-- ============================================================================
-- Note on identity enforcement
-- ----------------------------------------------------------------------------
-- The rest of the schema is intentionally permissive (USING (true) /
-- WITH CHECK (true)) because user IDs come from a Clerk-style identity layer
-- rather than Supabase Auth, so the database has no reliable signal to
-- enforce "you are user X" at the RLS layer. Owner-only enforcement for
-- invites/membership is implemented client-side in lib/forging-circle.ts
-- (assertCircleOwner), which is what the UI relies on. Migration of this
-- system to auth.uid()-based RLS is out of scope for v1.
-- ============================================================================

