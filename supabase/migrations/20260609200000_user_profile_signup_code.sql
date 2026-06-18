-- user_profile.signup_code: acquisition attribution.
-- Records the normalized special_codes.code the user entered at the pre-auth
-- onboarding entry screen (e.g. 'jesus2026'), or NULL when they joined without
-- a code. Stored as the literal code (not an FK) so it survives even if the
-- special_codes row is later edited or removed.

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS signup_code text;
