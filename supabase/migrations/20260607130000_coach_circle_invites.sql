-- Coach-sent Forging Circle invites: a coach can invite a user into a
-- coach-owned circle from the dashboard, and the user gets the same invite
-- experience (pending list + realtime banner + push) as a peer invite, but it
-- reads as "Coach X invited you".
--
-- See schema.sql (public.forging_circle_invites + accept_circle_invite) for the
-- canonical definitions. Companion to 20260607120000_coach_owned_forging_circles.sql.

-- 1. inviter can be a coach instead of a user --------------------------------
ALTER TABLE public.forging_circle_invites
  ADD COLUMN IF NOT EXISTS inviter_coach_id integer REFERENCES public.coaches(id) ON DELETE CASCADE;

-- inviter_user_id is NULL for coach-sent invites; drop the legacy NOT NULL.
ALTER TABLE public.forging_circle_invites
  ALTER COLUMN inviter_user_id DROP NOT NULL;

-- Exactly one inviter per row (user XOR coach). Existing rows have inviter_user_id
-- set and inviter_coach_id NULL, so they already satisfy this.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'forging_circle_invites_one_inviter'
  ) THEN
    ALTER TABLE public.forging_circle_invites
      ADD CONSTRAINT forging_circle_invites_one_inviter
      CHECK (num_nonnulls(inviter_user_id, inviter_coach_id) = 1);
  END IF;
END $$;

-- 2. accept_circle_invite: stop using inviter_user_id as the existence check --
-- (a coach-sent invite has inviter_user_id NULL, which the old guard misread as
-- "invite not found"). Use FOUND instead. Body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.accept_circle_invite(p_invite_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitee text;
  v_circle  bigint;
  v_status  text;
BEGIN
  SELECT invitee_user_id, circle_id, status
    INTO v_invitee, v_circle, v_status
    FROM public.forging_circle_invites
   WHERE id = p_invite_id
   FOR UPDATE;
  IF NOT FOUND THEN
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
