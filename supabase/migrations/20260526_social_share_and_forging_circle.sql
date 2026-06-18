-- Social Share + Forging Circle (2026-05-26)
-- Adds: user_profile.avatar_url, social_posts, social_post_likes, social_post_comments,
--       forging_circle_invites, forging_circle_members, accept_circle_invite() RPC,
--       Storage buckets 'avatars' and 'social-posts' with permissive read policies.
--
-- Apply on hosted Supabase via `supabase db push` or paste into SQL editor.
-- Mirrors the additions in schema.sql (see the Migrations section there).

-- ============================================================================
-- 1. Avatar URL column on user_profile
-- ============================================================================
ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- ============================================================================
-- 2. social_posts
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.social_posts (
  id BIGSERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  workout_log_id integer REFERENCES public.workout_logs(id) ON DELETE SET NULL,
  activity_log_id integer REFERENCES public.activity_logs(id) ON DELETE SET NULL,
  title text NOT NULL,
  photo_url text,
  visibility text NOT NULL CHECK (visibility IN ('public', 'circle')) DEFAULT 'circle',
  share_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_social_posts_user_id ON public.social_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_visibility_created
  ON public.social_posts(visibility, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_created_at
  ON public.social_posts(created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Social posts can be public inserted." ON public.social_posts;
DROP POLICY IF EXISTS "Social posts can be public read." ON public.social_posts;
DROP POLICY IF EXISTS "Social posts can be public updated." ON public.social_posts;
DROP POLICY IF EXISTS "Social posts can be public deleted." ON public.social_posts;
CREATE POLICY "Social posts can be public inserted."
  ON public.social_posts FOR INSERT WITH CHECK (true);
CREATE POLICY "Social posts can be public read."
  ON public.social_posts FOR SELECT USING (true);
CREATE POLICY "Social posts can be public updated."
  ON public.social_posts FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Social posts can be public deleted."
  ON public.social_posts FOR DELETE USING (true);

-- ============================================================================
-- 3. social_post_likes
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.social_post_likes (
  id BIGSERIAL PRIMARY KEY,
  post_id bigint NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_social_post_likes_post ON public.social_post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_social_post_likes_user ON public.social_post_likes(user_id);

ALTER TABLE public.social_post_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Social post likes can be public inserted." ON public.social_post_likes;
DROP POLICY IF EXISTS "Social post likes can be public read." ON public.social_post_likes;
DROP POLICY IF EXISTS "Social post likes can be public deleted." ON public.social_post_likes;
CREATE POLICY "Social post likes can be public inserted."
  ON public.social_post_likes FOR INSERT WITH CHECK (true);
CREATE POLICY "Social post likes can be public read."
  ON public.social_post_likes FOR SELECT USING (true);
CREATE POLICY "Social post likes can be public deleted."
  ON public.social_post_likes FOR DELETE USING (true);

-- ============================================================================
-- 4. social_post_comments (flat, no threads in v1)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.social_post_comments (
  id BIGSERIAL PRIMARY KEY,
  post_id bigint NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) > 0 AND length(body) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_social_post_comments_post_created
  ON public.social_post_comments(post_id, created_at)
  WHERE deleted_at IS NULL;

ALTER TABLE public.social_post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Social post comments can be public inserted." ON public.social_post_comments;
DROP POLICY IF EXISTS "Social post comments can be public read." ON public.social_post_comments;
DROP POLICY IF EXISTS "Social post comments can be public updated." ON public.social_post_comments;
DROP POLICY IF EXISTS "Social post comments can be public deleted." ON public.social_post_comments;
CREATE POLICY "Social post comments can be public inserted."
  ON public.social_post_comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Social post comments can be public read."
  ON public.social_post_comments FOR SELECT USING (true);
CREATE POLICY "Social post comments can be public updated."
  ON public.social_post_comments FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Social post comments can be public deleted."
  ON public.social_post_comments FOR DELETE USING (true);

-- ============================================================================
-- 5. forging_circle_invites
--    Mutual invites discovered by email. Unknown emails are blocked client-side
--    in v1 (see lib/forging-circle.ts), so invitee_user_id is always populated.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.forging_circle_invites (
  id BIGSERIAL PRIMARY KEY,
  inviter_user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  invitee_email text NOT NULL,
  invitee_user_id text REFERENCES public.user_profile(user_id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')) DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (inviter_user_id <> invitee_user_id)
);

-- One active (pending/accepted) invite per pair. Declined/cancelled can be re-sent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_forging_circle_invites_active_pair
  ON public.forging_circle_invites(inviter_user_id, invitee_user_id)
  WHERE status IN ('pending', 'accepted');

CREATE INDEX IF NOT EXISTS idx_forging_circle_invites_invitee_pending
  ON public.forging_circle_invites(invitee_user_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_forging_circle_invites_inviter
  ON public.forging_circle_invites(inviter_user_id, created_at DESC);

ALTER TABLE public.forging_circle_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Forging circle invites can be public inserted." ON public.forging_circle_invites;
DROP POLICY IF EXISTS "Forging circle invites can be public read." ON public.forging_circle_invites;
DROP POLICY IF EXISTS "Forging circle invites can be public updated." ON public.forging_circle_invites;
DROP POLICY IF EXISTS "Forging circle invites can be public deleted." ON public.forging_circle_invites;
CREATE POLICY "Forging circle invites can be public inserted."
  ON public.forging_circle_invites FOR INSERT WITH CHECK (true);
CREATE POLICY "Forging circle invites can be public read."
  ON public.forging_circle_invites FOR SELECT USING (true);
CREATE POLICY "Forging circle invites can be public updated."
  ON public.forging_circle_invites FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Forging circle invites can be public deleted."
  ON public.forging_circle_invites FOR DELETE USING (true);

-- ============================================================================
-- 6. forging_circle_members
--    Symmetric: accept_circle_invite() writes two rows (A->B and B->A).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.forging_circle_members (
  id BIGSERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  member_user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, member_user_id),
  CHECK (user_id <> member_user_id)
);

CREATE INDEX IF NOT EXISTS idx_forging_circle_members_user
  ON public.forging_circle_members(user_id);

ALTER TABLE public.forging_circle_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Forging circle members can be public inserted." ON public.forging_circle_members;
DROP POLICY IF EXISTS "Forging circle members can be public read." ON public.forging_circle_members;
DROP POLICY IF EXISTS "Forging circle members can be public deleted." ON public.forging_circle_members;
CREATE POLICY "Forging circle members can be public inserted."
  ON public.forging_circle_members FOR INSERT WITH CHECK (true);
CREATE POLICY "Forging circle members can be public read."
  ON public.forging_circle_members FOR SELECT USING (true);
CREATE POLICY "Forging circle members can be public deleted."
  ON public.forging_circle_members FOR DELETE USING (true);

-- ============================================================================
-- 7. accept_circle_invite RPC
--    Atomically flips invite to accepted and writes both membership rows.
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
  v_status text;
BEGIN
  SELECT inviter_user_id, invitee_user_id, status
    INTO v_inviter, v_invitee, v_status
    FROM public.forging_circle_invites
   WHERE id = p_invite_id
   FOR UPDATE;

  IF v_inviter IS NULL THEN
    RAISE EXCEPTION 'Invite % not found', p_invite_id;
  END IF;

  IF v_invitee IS NULL THEN
    RAISE EXCEPTION 'Invite % has no resolved invitee_user_id', p_invite_id;
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Invite % is not pending (status=%)', p_invite_id, v_status;
  END IF;

  UPDATE public.forging_circle_invites
     SET status = 'accepted', responded_at = now()
   WHERE id = p_invite_id;

  INSERT INTO public.forging_circle_members(user_id, member_user_id)
       VALUES (v_inviter, v_invitee)
  ON CONFLICT (user_id, member_user_id) DO NOTHING;

  INSERT INTO public.forging_circle_members(user_id, member_user_id)
       VALUES (v_invitee, v_inviter)
  ON CONFLICT (user_id, member_user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_circle_invite(bigint) TO anon, authenticated;

-- ============================================================================
-- 8. Storage buckets and policies
--    Public-read buckets so post photos and avatars render directly via URL.
--    Writes are permissive (anon client), matching the rest of the app's RLS
--    posture. Tighten with auth.uid() in a follow-up once Supabase Auth is
--    universally adopted.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
     VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
     VALUES ('social-posts', 'social-posts', true)
ON CONFLICT (id) DO NOTHING;

-- Drop and recreate so this block stays idempotent if you ran a partial
-- earlier version, or if Studio created the bucket without the policies.
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Avatars can be uploaded by anyone" ON storage.objects;
DROP POLICY IF EXISTS "Avatars can be updated by anyone" ON storage.objects;
DROP POLICY IF EXISTS "Avatars can be deleted by anyone" ON storage.objects;
DROP POLICY IF EXISTS "Social post photos are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Social post photos can be uploaded by anyone" ON storage.objects;
DROP POLICY IF EXISTS "Social post photos can be deleted by anyone" ON storage.objects;

CREATE POLICY "Avatars are publicly readable"
  ON storage.objects FOR SELECT
  TO public, anon, authenticated
  USING (bucket_id = 'avatars');

CREATE POLICY "Avatars can be uploaded by anyone"
  ON storage.objects FOR INSERT
  TO public, anon, authenticated
  WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Avatars can be updated by anyone"
  ON storage.objects FOR UPDATE
  TO public, anon, authenticated
  USING (bucket_id = 'avatars')
  WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Avatars can be deleted by anyone"
  ON storage.objects FOR DELETE
  TO public, anon, authenticated
  USING (bucket_id = 'avatars');

CREATE POLICY "Social post photos are publicly readable"
  ON storage.objects FOR SELECT
  TO public, anon, authenticated
  USING (bucket_id = 'social-posts');

CREATE POLICY "Social post photos can be uploaded by anyone"
  ON storage.objects FOR INSERT
  TO public, anon, authenticated
  WITH CHECK (bucket_id = 'social-posts');

CREATE POLICY "Social post photos can be deleted by anyone"
  ON storage.objects FOR DELETE
  TO public, anon, authenticated
  USING (bucket_id = 'social-posts');
