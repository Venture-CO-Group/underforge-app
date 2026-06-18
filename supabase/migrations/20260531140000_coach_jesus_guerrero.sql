-- Jesús Guerrero (coach id 6).
-- App onboarding matches config key "Jesús" to the first token of full_name
-- (see ChooseCoach getFirstName + onboarding_coaches.json).
-- On conflict, email/password_hash are left unchanged (set them in Studio on first insert).

INSERT INTO public.coaches (id, coach_name, email, password_hash, full_name, coach_type)
VALUES (
  6,
  'jesus_guerrero',
  'jesus.guerrero@underforge.io',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  'Jesús Guerrero',
  'ai_human_hybrid'
)
ON CONFLICT (id) DO UPDATE SET
  coach_name = EXCLUDED.coach_name,
  full_name = EXCLUDED.full_name,
  coach_type = EXCLUDED.coach_type;

-- Fix display name / type if the row was inserted earlier without accents or as ai_only.
UPDATE public.coaches
SET full_name = 'Jesús Guerrero',
    coach_type = 'ai_human_hybrid'
WHERE id = 6 OR coach_name = 'jesus_guerrero' OR coach_name = 'jesus_gutierrez';
