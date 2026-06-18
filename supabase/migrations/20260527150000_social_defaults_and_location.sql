-- 20260527_social_defaults_and_location
--
-- Adds:
--  1. user_profile.default_share_audience — single default audience used for
--     both stats (leaderboard) and posts. 'circle' (default) keeps the user
--     mostly private to their Forging Circle; 'public' opens them to anyone.
--  2. social_posts.location — optional free-text location (gym name, city)
--     shown on the post card.
--
-- Both columns are nullable/defaulted so the migration is safe to re-run.

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS default_share_audience text
    NOT NULL DEFAULT 'circle'
    CHECK (default_share_audience IN ('public', 'circle'));

ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS location text;
