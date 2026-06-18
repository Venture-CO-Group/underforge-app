-- Canonical bootstrap DDL for this project. Reflect new schema here first; `supabase/migrations/`
-- records historical apply order on existing hosted databases.
--
-- ⚠️ THIS FILE FEEDS THE COACH DASHBOARD CONTRACT.
-- An external repo (the coach dashboard) reads/writes this same database.
-- `docs/coach-dashboard-data-model.md` is generated from THIS file by
-- `scripts/generate-data-model.js` and regenerates automatically on `npm start`.
-- When you change a coach-facing table here (user_profile, coaches, coach_user,
-- checkin_coach_with_user), classify the new/changed column in
-- `docs/coach-dashboard-data-model.config.json`, then run `npm run data-model`.
-- `npm run data-model:check` (CI/pre-commit) fails if the doc is stale.

-- Create user_profile table
CREATE TABLE user_profile (
  user_id text PRIMARY KEY,       -- emulate Clerk `sub` identifier
  display_name text,
  onboarding_profile_json text,
  onboarding_profile_ai_gen_json text, -- snapshot copy of onboarding_profile_json for historical comparison
  timezone text,                  -- user's timezone (e.g. "Europe/Berlin")
  expo_push_token text,           -- optional Expo push notification token
  device_type text CHECK (device_type IN ('ios_device', 'ios_simulator')) DEFAULT 'ios_simulator', -- device type enum
  active boolean DEFAULT false,   -- indicates if this profile is currently active
  is_coach boolean DEFAULT false, -- indicates if this user is a coach
  share_stats boolean DEFAULT false, -- indicates if user wants to share their consistency stats on the leaderboard
  human_coach_step_notes_json text, -- per-step notes written manually by the human coach in Supabase Studio; JSON keyed by action-step id ("step_1"/"step_2"/"step_3")
  created_at timestamptz DEFAULT now()
);

-- Add unique constraint to ensure only one active profile per expo_push_token
CREATE UNIQUE INDEX idx_unique_active_expo_token 
  ON user_profile (expo_push_token) 
  WHERE active = true AND expo_push_token IS NOT NULL;

-- Enable RLS for user_profile table
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients (for saving user profiles)
CREATE POLICY "User profiles can be public inserted."
  ON public.user_profile
  FOR INSERT
  WITH CHECK (true);

-- Allow reads from anonymous/public clients (for loading user profiles)
CREATE POLICY "User profiles can be public read."
  ON public.user_profile
  FOR SELECT
  USING (true);

-- Allow updates from anonymous/public clients (for updating user profiles)
CREATE POLICY "User profiles can be public updated."
  ON public.user_profile
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Allow deletes from anonymous/public clients (for deleting user profiles)
CREATE POLICY "User profiles can be public deleted."
  ON public.user_profile
  FOR DELETE
  USING (true);

  -- Remove the restrictive constraint entirely
ALTER TABLE user_profile 
DROP CONSTRAINT user_profile_device_type_check;

-- Or keep it but make it more flexible
ALTER TABLE user_profile 
ADD CONSTRAINT user_profile_device_type_check 
CHECK (device_type IN ('ios_device', 'ios_simulator', 'android_device', 'android_simulator', 'web', 'unknown'));

-- Add reminder_frequency column to user_profile table
ALTER TABLE user_profile
ADD COLUMN reminder_frequency text CHECK (reminder_frequency IN ('once_per_day', 'every_task')) DEFAULT 'once_per_day';

-- Add away_mode columns to user_profile table
ALTER TABLE user_profile
ADD COLUMN away_mode boolean DEFAULT false,
ADD COLUMN away_mode_start_date timestamptz;

-- Add account_status column for admin-controlled user access
ALTER TABLE user_profile
ADD COLUMN account_status text CHECK (account_status IN ('active', 'deactivated')) DEFAULT 'active';

-- Create conversations table for mirroring SQLite data
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  user_id text REFERENCES user_profile(user_id) ON DELETE CASCADE,
  sqlite_id INTEGER NOT NULL,
  user_message TEXT NOT NULL,
  coach_response TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  user_display_name TEXT NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create chat_messages table for mirroring SQLite data
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  user_id text REFERENCES user_profile(user_id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  sender TEXT NOT NULL CHECK (sender IN ('user', 'coach', 'ai_coach', 'human_coach')),
  timestamp TEXT NOT NULL,
  user_display_name TEXT NOT NULL,
  is_from_notification BOOLEAN DEFAULT FALSE,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS for conversations table
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients (for mirroring from app)
CREATE POLICY "Conversations can be public inserted."
  ON public.conversations
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Conversations can be public deleted."
  ON public.conversations
  FOR DELETE
  USING (true);

-- Enable RLS for chat_messages table
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients (for mirroring from app)
CREATE POLICY "Chat messages can be public inserted."
  ON public.chat_messages
  FOR INSERT
  WITH CHECK (true);

-- Allow reads from anonymous/public clients (for loading chat messages)
CREATE POLICY "Chat messages can be public read."
  ON public.chat_messages
  FOR SELECT
  USING (true);

-- Allow updates from anonymous/public clients (for upsert on re-persist)
CREATE POLICY "Chat messages can be public updated."
  ON public.chat_messages
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Chat messages can be public deleted."
  ON public.chat_messages
  FOR DELETE
  USING (true);

-- Create task_completions table for tracking daily task completions
CREATE TABLE public.task_completions (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  step_id text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  completion_date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, step_id, completion_date)
);

-- Enable RLS for task_completions table
ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients
CREATE POLICY "Task completions can be public inserted."
  ON public.task_completions
  FOR INSERT
  WITH CHECK (true);

-- Allow reads from anonymous/public clients
CREATE POLICY "Task completions can be public read."
  ON public.task_completions
  FOR SELECT
  USING (true);

-- Allow updates from anonymous/public clients
CREATE POLICY "Task completions can be public updated."
  ON public.task_completions
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Allow deletes from anonymous/public clients
CREATE POLICY "Task completions can be public deleted."
  ON public.task_completions
  FOR DELETE
  USING (true);

-- Create nutrition_log table for tracking daily nutrition
CREATE TABLE public.nutrition_log (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  log_date date NOT NULL,
  carbs_grams decimal(6,1) DEFAULT 0,
  protein_grams decimal(6,1) DEFAULT 0,
  fat_grams decimal(6,1) DEFAULT 0,
  fiber_grams decimal(6,1) DEFAULT 0,
  total_calories integer DEFAULT 0,
  carbs_target_grams decimal(6,1) DEFAULT 200,
  protein_target_grams decimal(6,1) DEFAULT 150,
  fat_target_grams decimal(6,1) DEFAULT 67,
  fiber_target_grams decimal(6,1) DEFAULT 28,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, log_date)
);

-- Enable RLS for nutrition_log table
ALTER TABLE nutrition_log ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients
CREATE POLICY "Nutrition log can be public inserted."
  ON public.nutrition_log
  FOR INSERT
  WITH CHECK (true);

-- Allow reads from anonymous/public clients
CREATE POLICY "Nutrition log can be public read."
  ON public.nutrition_log
  FOR SELECT
  USING (true);

-- Allow updates from anonymous/public clients
CREATE POLICY "Nutrition log can be public updated."
  ON public.nutrition_log
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Allow deletes from anonymous/public clients
CREATE POLICY "Nutrition log can be public deleted."
  ON public.nutrition_log
  FOR DELETE
  USING (true);

-- Create meal_logs table for individual meal entries
CREATE TABLE public.meal_logs (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  log_date date NOT NULL,
  meal_description text NOT NULL,
  carbs_grams decimal(6,1) NOT NULL,
  protein_grams decimal(6,1) NOT NULL,
  fat_grams decimal(6,1) NOT NULL,
  fiber_grams decimal(6,1) NOT NULL,
  calories integer NOT NULL,
  food_quantities text,
  food_item_macros jsonb,
  logged_at timestamptz DEFAULT now()
);

-- Enable RLS for meal_logs table
ALTER TABLE meal_logs ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients
CREATE POLICY "Meal logs can be public inserted."
  ON public.meal_logs
  FOR INSERT
  WITH CHECK (true);

-- Allow reads from anonymous/public clients
CREATE POLICY "Meal logs can be public read."
  ON public.meal_logs
  FOR SELECT
  USING (true);

-- Allow deletes from anonymous/public clients
CREATE POLICY "Meal logs can be public deleted."
  ON public.meal_logs
  FOR DELETE
  USING (true);

-- Create daily_nutrition_totals table for daily cumulative totals
CREATE TABLE public.daily_nutrition_totals (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  log_date date NOT NULL,
  total_carbs_grams decimal(7,1) DEFAULT 0,
  total_protein_grams decimal(7,1) DEFAULT 0,
  total_fat_grams decimal(7,1) DEFAULT 0,
  total_fiber_grams decimal(7,1) DEFAULT 0,
  total_calories integer DEFAULT 0,
  carbs_target_grams decimal(6,1) DEFAULT 200,
  protein_target_grams decimal(6,1) DEFAULT 150,
  fat_target_grams decimal(6,1) DEFAULT 67,
  fiber_target_grams decimal(6,1) DEFAULT 28,
  calories_target integer DEFAULT 2000,
  carbs_percent_of_target decimal(5,1) DEFAULT 0,
  protein_percent_of_target decimal(5,1) DEFAULT 0,
  fat_percent_of_target decimal(5,1) DEFAULT 0,
  fiber_percent_of_target decimal(5,1) DEFAULT 0,
  calories_percent_of_target decimal(5,1) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, log_date)
);

-- Enable RLS for daily_nutrition_totals table
ALTER TABLE daily_nutrition_totals ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients
CREATE POLICY "Daily nutrition totals can be public inserted."
  ON public.daily_nutrition_totals
  FOR INSERT
  WITH CHECK (true);

-- Allow reads from anonymous/public clients
CREATE POLICY "Daily nutrition totals can be public read."
  ON public.daily_nutrition_totals
  FOR SELECT
  USING (true);

-- Allow updates from anonymous/public clients
CREATE POLICY "Daily nutrition totals can be public updated."
  ON public.daily_nutrition_totals
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Allow deletes from anonymous/public clients
CREATE POLICY "Daily nutrition totals can be public deleted."
  ON public.daily_nutrition_totals
  FOR DELETE
  USING (true);

-- Create coaches table for web dashboard access
CREATE TABLE public.coaches (
  id SERIAL PRIMARY KEY,
  coach_name text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text,
  coach_type text NOT NULL DEFAULT 'ai_only'
    CHECK (coach_type IN ('ai_only', 'ai_human_hybrid')),
  created_at timestamptz DEFAULT now(),
  last_login_at timestamptz
);

-- Enable RLS for coaches table
ALTER TABLE coaches ENABLE ROW LEVEL SECURITY;

-- Allow reads from anonymous/public clients (for authentication)
CREATE POLICY "Coaches can be public read."
  ON public.coaches
  FOR SELECT
  USING (true);

-- Allow updates from anonymous/public clients (for last_login_at)
CREATE POLICY "Coaches can be public updated."
  ON public.coaches
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Coaching plan-tier catalog (AI-only vs human-check-in cadences). Flexible by design:
-- add a future tier by inserting a row, not by altering schema. The coach dashboard reads
-- this to populate its tier picker; checkins_per_week feeds the dashboard's computed
-- "pending check-ins this week". (Distinct from the user's training/nutrition/recovery plan.)
CREATE TABLE IF NOT EXISTS public.plan_tiers (
  id serial PRIMARY KEY,
  key text NOT NULL UNIQUE,                       -- stable slug; the app maps it to a localized name
  display_name text NOT NULL,                     -- English label shown in the dashboard
  checkins_per_week numeric NOT NULL DEFAULT 0,   -- expected human check-ins per week (ai_only = 0)
  active boolean NOT NULL DEFAULT true,           -- soft-retire a tier without deleting history
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.plan_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Plan tiers can be public read."
  ON public.plan_tiers FOR SELECT USING (true);
CREATE POLICY "Plan tiers can be public inserted."
  ON public.plan_tiers FOR INSERT WITH CHECK (true);
CREATE POLICY "Plan tiers can be public updated."
  ON public.plan_tiers FOR UPDATE USING (true) WITH CHECK (true);

INSERT INTO public.plan_tiers (key, display_name, checkins_per_week) VALUES
  ('ai_only',        'AI only',                    0),
  ('human_2x_month', '2x / month human check-in',  0.5),
  ('human_2x_week',  '2x / week human check-in',   2)
ON CONFLICT (key) DO NOTHING;

-- coach_user is an APPEND-ONLY log of coach + plan-tier assignments. Each tier or coach
-- change inserts a NEW row; the live assignment is the row WHERE is_current = true, and the
-- full ai<->human history is every row for a user ordered by assigned_at. A partial unique
-- index (below) guarantees exactly one live row per user.
CREATE TABLE public.coach_user (
  id SERIAL PRIMARY KEY,
  coach_id integer NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  plan_tier_id integer REFERENCES public.plan_tiers(id), -- NULL = ai_only; the user's coaching plan tier
  is_current boolean NOT NULL DEFAULT true,              -- the live assignment; superseded rows are kept with false
  assigned_at timestamptz DEFAULT now()                 -- when this assignment row was written (the change timestamp)
);

-- Enable RLS for coach_user table
ALTER TABLE coach_user ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients
CREATE POLICY "Coach user mappings can be public inserted."
  ON public.coach_user
  FOR INSERT
  WITH CHECK (true);

-- Allow reads from anonymous/public clients
CREATE POLICY "Coach user mappings can be public read."
  ON public.coach_user
  FOR SELECT
  USING (true);

-- Allow deletes from anonymous/public clients
CREATE POLICY "Coach user mappings can be public deleted."
  ON public.coach_user
  FOR DELETE
  USING (true);

-- Create index for faster lookups
CREATE INDEX idx_coach_user_coach_id ON public.coach_user(coach_id);
CREATE INDEX idx_coach_user_user_id ON public.coach_user(user_id);
-- Exactly one live coach/plan-tier row per user; superseded rows linger as history (is_current = false).
CREATE UNIQUE INDEX idx_coach_user_current ON public.coach_user(user_id) WHERE is_current = true;
CREATE INDEX idx_coach_user_plan_tier_id ON public.coach_user(plan_tier_id);

-- Human coach check-in notes per user (coach dashboard; delete-account cleans by user_id)
CREATE TABLE public.checkin_coach_with_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  coach_id integer NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  checkin_date timestamptz DEFAULT now(),
  notes text NOT NULL,
  checkin_type text CHECK (checkin_type IN ('message', 'call', 'video', 'in_person')), -- how the coach checked in (NULL = unspecified)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_checkin_user_id ON public.checkin_coach_with_user(user_id);
CREATE INDEX idx_checkin_coach_id ON public.checkin_coach_with_user(coach_id);
CREATE INDEX idx_checkin_date ON public.checkin_coach_with_user(checkin_date DESC);

ALTER TABLE public.checkin_coach_with_user ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Checkin coach with user can be public inserted."
  ON public.checkin_coach_with_user FOR INSERT WITH CHECK (true);
CREATE POLICY "Checkin coach with user can be public read."
  ON public.checkin_coach_with_user FOR SELECT USING (true);
CREATE POLICY "Checkin coach with user can be public updated."
  ON public.checkin_coach_with_user FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Checkin coach with user can be public deleted."
  ON public.checkin_coach_with_user FOR DELETE USING (true);

CREATE TABLE public.glow360_survey (
  id bigint NOT NULL,
  health_areas text[] NOT NULL,
  name text NOT NULL,
  age_group text NOT NULL,
  health_description text NOT NULL,
  motivation text NOT NULL,
  email text NOT NULL,
  consent text NOT NULL,
  submitted_at timestamp without time zone NOT NULL,
  created_at timestamp without time zone DEFAULT now()
);

CREATE POLICY "Anyone can insert survey responses" 
ON public.glow360_survey 
AS PERMISSIVE 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Enable Row Level Security on the table
ALTER TABLE public.glow360_survey ENABLE ROW LEVEL SECURITY;

-- Deny all reads explicitly
CREATE POLICY "No read access"
ON public.glow360_survey
AS RESTRICTIVE
FOR SELECT
TO public
USING (false);

-- Add preferred_weight_unit column to user_profile table
ALTER TABLE user_profile 
ADD COLUMN preferred_weight_unit text CHECK (preferred_weight_unit IN ('kg', 'lbs')) DEFAULT 'kg';

-- Create body_composition_log table for tracking weekly body composition
CREATE TABLE public.body_composition_log (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  log_date date NOT NULL,
  week_number integer NOT NULL,
  year integer NOT NULL,
  weight_value decimal(5,2) NOT NULL,
  weight_unit text NOT NULL CHECK (weight_unit IN ('kg', 'lbs')),
  muscle_percent decimal(4,1) NOT NULL,
  fat_percent decimal(4,1) NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, week_number, year)
);

-- Enable RLS for body_composition_log table
ALTER TABLE body_composition_log ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients
CREATE POLICY "Body composition log can be public inserted."
  ON public.body_composition_log
  FOR INSERT
  WITH CHECK (true);

-- Allow reads from anonymous/public clients
CREATE POLICY "Body composition log can be public read."
  ON public.body_composition_log
  FOR SELECT
  USING (true);

-- Allow updates from anonymous/public clients
CREATE POLICY "Body composition log can be public updated."
  ON public.body_composition_log
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Allow deletes from anonymous/public clients
CREATE POLICY "Body composition log can be public deleted."
  ON public.body_composition_log
  FOR DELETE
  USING (true);

-- Create index for faster lookups
CREATE INDEX idx_body_composition_user_id ON public.body_composition_log(user_id);
CREATE INDEX idx_body_composition_log_date ON public.body_composition_log(log_date);

-- Optional progress photos attached to a weekly body-composition entry. Public
-- URLs in the 'body-photos' bucket (one set per ISO week, overwritten on
-- re-upload). Front is the angle shown on the weight chart; side/back are extra.
ALTER TABLE public.body_composition_log
  ADD COLUMN IF NOT EXISTS photo_front_url text;
ALTER TABLE public.body_composition_log
  ADD COLUMN IF NOT EXISTS photo_side_url text;
ALTER TABLE public.body_composition_log
  ADD COLUMN IF NOT EXISTS photo_back_url text;

-- ============================================
-- Workout Tracking Tables
-- ============================================

-- Create workout_logs table for tracking workout sessions
CREATE TABLE public.workout_logs (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  workout_date date NOT NULL,
  workout_day_name text NOT NULL,  -- e.g., "Leg Day", "Full Body", "Upper Body Day"
  step_id text,                     -- Link to action plan step (optional for legacy plans)
  status text NOT NULL CHECK (status IN ('in_progress', 'completed', 'deleted')) DEFAULT 'in_progress',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS for workout_logs table
ALTER TABLE workout_logs ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients
CREATE POLICY "Workout logs can be public inserted."
  ON public.workout_logs
  FOR INSERT
  WITH CHECK (true);

-- Allow reads from anonymous/public clients
CREATE POLICY "Workout logs can be public read."
  ON public.workout_logs
  FOR SELECT
  USING (true);

-- Allow updates from anonymous/public clients
CREATE POLICY "Workout logs can be public updated."
  ON public.workout_logs
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Allow deletes from anonymous/public clients
CREATE POLICY "Workout logs can be public deleted."
  ON public.workout_logs
  FOR DELETE
  USING (true);

-- Create indexes for faster lookups
CREATE INDEX idx_workout_logs_user_id ON public.workout_logs(user_id);
CREATE INDEX idx_workout_logs_workout_date ON public.workout_logs(workout_date);
CREATE INDEX idx_workout_logs_status ON public.workout_logs(status);

-- Create workout_exercise_logs table for individual exercise entries within a workout
CREATE TABLE public.workout_exercise_logs (
  id SERIAL PRIMARY KEY,
  workout_log_id integer NOT NULL REFERENCES public.workout_logs(id) ON DELETE CASCADE,
  exercise_id text NOT NULL,         -- Reference to exercise database ID
  exercise_name text NOT NULL,       -- Exercise name for display
  set_number integer NOT NULL,       -- Which set (1, 2, 3...)
  weight_value decimal(6,2),         -- Weight used (null for bodyweight exercises)
  weight_unit text CHECK (weight_unit IN ('kg', 'lbs')),
  reps integer,                      -- Actual reps performed
  rest_time_seconds integer,         -- Actual rest time taken
  rir integer CHECK (rir >= 0 AND rir <= 5),  -- Reps in Reserve (0-5)
  difficulty_perception integer CHECK (difficulty_perception >= 1 AND difficulty_perception <= 5),
  comments text,                     -- User notes for this set
  calories_burned integer,           -- MET-based per-set estimate (device-written)
  created_at timestamptz DEFAULT now()
);

-- Enable RLS for workout_exercise_logs table
ALTER TABLE workout_exercise_logs ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients
CREATE POLICY "Workout exercise logs can be public inserted."
  ON public.workout_exercise_logs
  FOR INSERT
  WITH CHECK (true);

-- Allow reads from anonymous/public clients
CREATE POLICY "Workout exercise logs can be public read."
  ON public.workout_exercise_logs
  FOR SELECT
  USING (true);

-- Allow updates from anonymous/public clients
CREATE POLICY "Workout exercise logs can be public updated."
  ON public.workout_exercise_logs
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Allow deletes from anonymous/public clients
CREATE POLICY "Workout exercise logs can be public deleted."
  ON public.workout_exercise_logs
  FOR DELETE
  USING (true);

-- Create unique constraint for upsert operations
ALTER TABLE public.workout_exercise_logs 
ADD CONSTRAINT workout_exercise_logs_unique_set 
UNIQUE (workout_log_id, exercise_id, set_number);

-- Create indexes for faster lookups
CREATE INDEX idx_workout_exercise_logs_workout_log_id ON public.workout_exercise_logs(workout_log_id);
CREATE INDEX idx_workout_exercise_logs_exercise_id ON public.workout_exercise_logs(exercise_id);

-- ============================================
-- User Nutrition Targets Table
-- ============================================

-- Personalized macro/calorie targets; history keyed by effective_from.
--
-- baseline_movement_* (nullable, added 2026-05-24):
--   Explicit daily "move outside training" recommendation (brisk-walk NEAT),
--   computed in lib/baseline-movement.ts from occupation_activity, habitual
--   cardio, and plan-training kcal. Written by persistPlanNutritionTargets on
--   plan create/regenerate/edit. Legacy rows stay NULL until then; the app
--   recomputes from onboarding when NULL (CoachDashboard burn card, training
--   plan BaselineMovementCard). Apply to existing Supabase DBs via Studio SQL
--   or supabase/migrations/20260524_baseline_movement_targets.sql (see
--   Migrations section at end of this file).
CREATE TABLE public.user_nutrition_targets (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  calories_target INTEGER NOT NULL,
  carbs_target_grams DECIMAL(6,1) NOT NULL,
  protein_target_grams DECIMAL(6,1) NOT NULL,
  fat_target_grams DECIMAL(6,1) NOT NULL,
  fiber_target_grams DECIMAL(6,1) NOT NULL,
  baseline_movement_kcal INTEGER,     -- kcal/day NEAT target; feeds burn card + TDEE context
  baseline_movement_minutes INTEGER,  -- user-facing brisk-walk minutes/day (training plan UI)
  baseline_movement_steps INTEGER,    -- ~steps/day equivalent for wearable cross-check
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, effective_from)
);

-- Enable RLS for user_nutrition_targets table
ALTER TABLE user_nutrition_targets ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients
CREATE POLICY "User nutrition targets can be public inserted."
  ON public.user_nutrition_targets
  FOR INSERT
  WITH CHECK (true);

-- Allow reads from anonymous/public clients
CREATE POLICY "User nutrition targets can be public read."
  ON public.user_nutrition_targets
  FOR SELECT
  USING (true);

-- Allow updates from anonymous/public clients
CREATE POLICY "User nutrition targets can be public updated."
  ON public.user_nutrition_targets
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Allow deletes from anonymous/public clients
CREATE POLICY "User nutrition targets can be public deleted."
  ON public.user_nutrition_targets
  FOR DELETE
  USING (true);

-- Create indexes for faster lookups
CREATE INDEX idx_user_nutrition_targets_user_id ON public.user_nutrition_targets(user_id);
CREATE INDEX idx_user_nutrition_targets_effective_from ON public.user_nutrition_targets(effective_from);

-- ============================================
-- Wearables Integration Tables
-- ============================================
-- Raw provider payloads are kept as an audit/replay trail for imported data.

CREATE TABLE public.provider_raw_payloads (
  id BIGSERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('healthkit','whoop','garmin','healthconnect')),
  kind text NOT NULL CHECK (kind IN ('workout','steps','active_energy','resting_energy','sleep','recovery','heart_rate','other')),
  external_id text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prp_user_provider ON public.provider_raw_payloads(user_id, provider, kind);
CREATE INDEX idx_prp_external_id
  ON public.provider_raw_payloads(provider, external_id) WHERE external_id IS NOT NULL;

ALTER TABLE public.provider_raw_payloads ENABLE ROW LEVEL SECURITY;
-- No permissive policies: only service-role Edge Functions read/write raw payloads.

-- OAuth/provider connection state. Token columns are service-role only.
CREATE TABLE public.user_provider_connections (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('healthkit','whoop','garmin','healthconnect')),
  external_user_id text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[],
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  last_sync_cursor text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','error')),
  last_error text,
  UNIQUE(user_id, provider)
);

CREATE INDEX idx_upc_user_id ON public.user_provider_connections(user_id);

ALTER TABLE public.user_provider_connections ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW public.user_provider_connections_public AS
  SELECT id, user_id, provider, external_user_id, connected_at,
         last_sync_at, status, last_error
    FROM public.user_provider_connections;

REVOKE ALL ON TABLE public.user_provider_connections FROM anon;
REVOKE ALL ON TABLE public.user_provider_connections FROM authenticated;
GRANT SELECT ON public.user_provider_connections_public TO anon;
GRANT SELECT ON public.user_provider_connections_public TO authenticated;

-- One row per metric/date/source; only the canonical winner is used in UI/math.
CREATE TABLE public.daily_metrics (
  id BIGSERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  metric text NOT NULL CHECK (metric IN (
    'steps','active_energy_kcal','resting_energy_kcal',
    'sleep_total_min','sleep_efficiency_pct',
    'recovery_score','hrv_rmssd_ms','resting_hr_bpm'
  )),
  source text NOT NULL CHECK (source IN ('healthkit','whoop','garmin','healthconnect','manual')),
  value numeric NOT NULL CHECK (value >= 0),
  is_canonical boolean NOT NULL DEFAULT false,
  winner_reason text CHECK (
    winner_reason IN (
      'healthkit_aggregated',
      'preferred_source',
      'fallback_priority',
      'freshest_complete_source',
      'only_source'
    )
  ),
  confidence text NOT NULL DEFAULT 'high' CHECK (confidence IN ('high','medium','low')),
  payload_id bigint REFERENCES public.provider_raw_payloads(id) ON DELETE SET NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, metric_date, metric, source)
);

CREATE INDEX idx_daily_metrics_canonical
  ON public.daily_metrics(user_id, metric_date, metric)
  WHERE is_canonical;
CREATE INDEX idx_daily_metrics_user_date ON public.daily_metrics(user_id, metric_date);

ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Daily metrics can be public inserted."
  ON public.daily_metrics FOR INSERT WITH CHECK (true);
CREATE POLICY "Daily metrics can be public read."
  ON public.daily_metrics FOR SELECT USING (true);
CREATE POLICY "Daily metrics can be public updated."
  ON public.daily_metrics FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Daily metrics can be public deleted."
  ON public.daily_metrics FOR DELETE USING (true);

CREATE TABLE public.nutrition_daily_adjustments (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  adjustment_date date NOT NULL,
  base_calories_target integer NOT NULL,
  base_carbs_target_grams decimal(6,1) NOT NULL,
  base_protein_target_grams decimal(6,1) NOT NULL,
  base_fat_target_grams decimal(6,1) NOT NULL,
  base_fiber_target_grams decimal(6,1) NOT NULL,
  activity_calories_burned integer NOT NULL DEFAULT 0,
  steps_neat_calories integer NOT NULL DEFAULT 0,
  adjusted_calories_target integer NOT NULL,
  adjusted_carbs_target_grams decimal(6,1) NOT NULL,
  adjusted_protein_target_grams decimal(6,1) NOT NULL,
  adjusted_fat_target_grams decimal(6,1) NOT NULL,
  adjusted_fiber_target_grams decimal(6,1) NOT NULL,
  strategy text NOT NULL DEFAULT 'carbs_first_v1' CHECK (strategy IN ('carbs_first_v1','proportional_v1')),
  inputs_digest text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, adjustment_date)
);

CREATE INDEX idx_nda_user_date ON public.nutrition_daily_adjustments(user_id, adjustment_date);

ALTER TABLE public.nutrition_daily_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Nutrition daily adjustments can be public inserted."
  ON public.nutrition_daily_adjustments FOR INSERT WITH CHECK (true);
CREATE POLICY "Nutrition daily adjustments can be public read."
  ON public.nutrition_daily_adjustments FOR SELECT USING (true);
CREATE POLICY "Nutrition daily adjustments can be public updated."
  ON public.nutrition_daily_adjustments FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Nutrition daily adjustments can be public deleted."
  ON public.nutrition_daily_adjustments FOR DELETE USING (true);
 
-- ============================================
-- Activity Logs Table (Cardio, Sports, etc.)
-- ============================================

CREATE TABLE public.activity_logs (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  activity_date date NOT NULL,
  activity_type text NOT NULL,
  activity_name text NOT NULL,
  duration_minutes integer NOT NULL,
  intensity text CHECK (intensity IN ('easy', 'moderate', 'hard', 'max')),
  distance_value decimal(8,2),
  distance_unit text CHECK (distance_unit IN ('km', 'mi')),
  elevation_gain decimal(8,2),
  calories_burned integer,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','healthkit','whoop','garmin','healthconnect')),
  external_id text,
  payload_id bigint REFERENCES public.provider_raw_payloads(id) ON DELETE SET NULL,
  calories_source text CHECK (calories_source IN ('provider','estimated_met','estimated_hr','manual')) DEFAULT 'manual',
  calories_confidence text CHECK (calories_confidence IN ('high','medium','low')) DEFAULT 'medium',
  dedupe_fingerprint text,
  started_at timestamptz,
  ended_at timestamptz,
  avg_heart_rate integer,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Activity logs can be public inserted."
  ON public.activity_logs
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Activity logs can be public read."
  ON public.activity_logs
  FOR SELECT
  USING (true);

CREATE POLICY "Activity logs can be public updated."
  ON public.activity_logs
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Activity logs can be public deleted."
  ON public.activity_logs
  FOR DELETE
  USING (true);

CREATE INDEX idx_activity_logs_user_id ON public.activity_logs(user_id);
CREATE INDEX idx_activity_logs_activity_date ON public.activity_logs(activity_date);
CREATE UNIQUE INDEX uniq_activity_logs_external
  ON public.activity_logs(user_id, source, external_id);
CREATE INDEX idx_activity_logs_fingerprint ON public.activity_logs(user_id, dedupe_fingerprint);

-- Wearable-imported activity vs manually logged workout (202604300003 + review_ack 20260504200000)
CREATE TABLE public.activity_workout_links (
  id BIGSERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  activity_log_id integer NOT NULL REFERENCES public.activity_logs(id) ON DELETE CASCADE,
  workout_log_id integer NOT NULL REFERENCES public.workout_logs(id) ON DELETE CASCADE,
  link_state text NOT NULL CHECK (link_state IN ('pending', 'linked', 'separated')) DEFAULT 'pending',
  review_acknowledged boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, activity_log_id)
);

CREATE INDEX idx_awl_user_state ON public.activity_workout_links(user_id, link_state);
CREATE INDEX idx_awl_workout ON public.activity_workout_links(workout_log_id);

ALTER TABLE public.activity_workout_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Activity workout links can be public inserted."
  ON public.activity_workout_links FOR INSERT WITH CHECK (true);
CREATE POLICY "Activity workout links can be public read."
  ON public.activity_workout_links FOR SELECT USING (true);
CREATE POLICY "Activity workout links can be public updated."
  ON public.activity_workout_links FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Activity workout links can be public deleted."
  ON public.activity_workout_links FOR DELETE USING (true);

-- ============================================
-- Weekly Consistency Scores (Leaderboard)
-- ============================================
-- Tracks weekly consistency scores for users used in the Social & Learn leaderboard
CREATE TABLE public.weekly_consistency_scores (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  week_start date NOT NULL,
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, week_start)
);

-- Enable RLS for weekly_consistency_scores
ALTER TABLE public.weekly_consistency_scores ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anonymous/public clients (app will upsert scores)
CREATE POLICY "Weekly consistency scores can be public inserted."
  ON public.weekly_consistency_scores
  FOR INSERT
  WITH CHECK (true);

-- Allow reads from anonymous/public clients (for leaderboard queries)
CREATE POLICY "Weekly consistency scores can be public read."
  ON public.weekly_consistency_scores
  FOR SELECT
  USING (true);

-- Allow updates from anonymous/public clients (for upserts)
CREATE POLICY "Weekly consistency scores can be public updated."
  ON public.weekly_consistency_scores
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Weekly consistency scores can be public deleted."
  ON public.weekly_consistency_scores
  FOR DELETE
  USING (true);

-- Indexes for leaderboard queries
CREATE INDEX idx_wcs_week_start ON public.weekly_consistency_scores(week_start);
CREATE INDEX idx_wcs_user_id ON public.weekly_consistency_scores(user_id);

-- ============================================
-- Weekly Check-in Reports
-- ============================================
-- Stores weekly check-in data (metrics snapshot + LLM narrative) per user per week.
-- One row per user per week, upserted when the user views their check-in.

CREATE TABLE public.weekly_checkin_reports (
  id SERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  week_start date NOT NULL,
  week_end date NOT NULL,
  -- Training & nutrition metrics
  consistency_score integer NOT NULL DEFAULT 0 CHECK (consistency_score >= 0 AND consistency_score <= 100),
  workout_sessions integer NOT NULL DEFAULT 0,
  activity_sessions integer NOT NULL DEFAULT 0,
  total_training_sessions integer NOT NULL DEFAULT 0,
  meals_logged integer NOT NULL DEFAULT 0,
  volume_lifted_kg decimal(10,1) DEFAULT 0,
  protein_grams decimal(8,1) DEFAULT 0,
  total_estimated_calories integer DEFAULT 0,
  -- Body composition (nullable — only present when user has logged scans)
  weight_kg decimal(5,1),
  muscle_percent decimal(4,1),
  fat_percent decimal(4,1),
  lean_mass_kg decimal(5,1),
  weight_kg_prior decimal(5,1),
  muscle_percent_delta decimal(4,1),
  fat_percent_delta decimal(4,1),
  lean_mass_kg_delta decimal(5,1),
  -- LLM-generated narrative (structured + plain-text)
  narrative_json jsonb,
  summary_text text,
  status text NOT NULL CHECK (status IN ('viewed', 'skipped')) DEFAULT 'viewed',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, week_start)
);

-- Enable RLS for weekly_checkin_reports
ALTER TABLE public.weekly_checkin_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Weekly checkin reports can be public inserted."
  ON public.weekly_checkin_reports
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Weekly checkin reports can be public read."
  ON public.weekly_checkin_reports
  FOR SELECT
  USING (true);

CREATE POLICY "Weekly checkin reports can be public updated."
  ON public.weekly_checkin_reports
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Weekly checkin reports can be public deleted."
  ON public.weekly_checkin_reports
  FOR DELETE
  USING (true);

CREATE INDEX idx_wcr_user_id ON public.weekly_checkin_reports(user_id);
CREATE INDEX idx_wcr_week_start ON public.weekly_checkin_reports(week_start);

-- ============================================
-- Migrations
-- ============================================
-- Add share_stats column to user_profile (2026-02-13)
ALTER TABLE public.user_profile ADD COLUMN IF NOT EXISTS share_stats boolean DEFAULT false;

-- Coach dashboard plan workflow (setup_coaches.sql)
ALTER TABLE public.user_profile ADD COLUMN IF NOT EXISTS plan_status text DEFAULT 'AI drafted'
  CHECK (plan_status IN ('AI drafted', 'Coach reviewed', 'Coach and client reviewed'));

-- Supabase Auth linkage (app + Edge Functions)
ALTER TABLE public.user_profile ADD COLUMN IF NOT EXISTS auth_user_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profile_auth_user_id
  ON public.user_profile(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- Baseline movement on user_nutrition_targets (2026-05-24).
-- Idempotent apply for hosted DBs when `supabase db push` history is out of sync;
-- safe to run in Supabase Studio (Path A). Local SQLite gets the same columns via
-- lib/db.ts on app startup. All three nullable — no backfill required for legacy users.
ALTER TABLE public.user_nutrition_targets
  ADD COLUMN IF NOT EXISTS baseline_movement_kcal integer,
  ADD COLUMN IF NOT EXISTS baseline_movement_minutes integer,
  ADD COLUMN IF NOT EXISTS baseline_movement_steps integer;

-- Weekly check-in schedule mode (2026-05-25). Lets users pick between the
-- default Sun→Sat window (prompted Sunday 18:00 local) and the alternate
-- Mon→Sun window (prompted Monday 18:00 local). NULL/legacy rows default to
-- the Sun→Sat behavior in the client.
ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS weekly_checkin_schedule_mode text
    CHECK (weekly_checkin_schedule_mode IN ('sun_sat_sun1800', 'mon_sun_mon1800'))
    DEFAULT 'sun_sat_sun1800';

-- Human coach per-step notes (2026-05-29). Stored at the profile level (not
-- nested in onboarding_profile_json) so plan regenerations / in-app plan edits
-- don't clobber them. JSON shape: {"step_1": "...", "step_2": "...", "step_3": "..."}.
-- Coaches edit this column manually in Supabase Studio.
ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS human_coach_step_notes_json text;

-- ============================================
-- Social Share + Forging Circle (2026-05-26)
-- ============================================
-- Profile photo URL (Supabase Storage 'avatars' bucket)
ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- Default audience used for new social posts AND for leaderboard visibility
-- (2026-05-27). 'circles' (default) keeps the user mostly private to their
-- Forging Circles; 'public' opens them to anyone. Renamed from singular
-- 'circle' to plural 'circles' in 20260527160000_multi_forging_circles.sql.
ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS default_share_audience text
    NOT NULL DEFAULT 'circles'
    CHECK (default_share_audience IN ('public', 'circles'));

-- Acquisition attribution (2026-06-09): the normalized special_codes.code the
-- user entered at the pre-auth onboarding entry screen (e.g. 'jesus2026'), or
-- NULL when they joined without a code. Stored as the literal code (not an FK)
-- so it survives even if the special_codes row is later edited or removed.
ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS signup_code text;

-- forging_circles: each circle is owned by exactly one of a user (legacy,
-- app-created) or a coach (dashboard-created). Participants = owner ∪
-- forging_circle_members.member_user_id for that circle. Declared before
-- social_posts so the optional FK below resolves.
-- Invariant (enforced in app + dashboard code, not via a DB CHECK yet): exactly
-- one of owner_user_id / owner_coach_id is non-null per row. owner_user_id is
-- nullable because coach-owned circles leave it NULL.
CREATE TABLE IF NOT EXISTS public.forging_circles (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id text REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 40),
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, name)
);
-- Coach-owned circles (dashboard-introduced): owner_coach_id set, owner_user_id NULL.
ALTER TABLE public.forging_circles
  ADD COLUMN IF NOT EXISTS owner_coach_id integer REFERENCES public.coaches(id) ON DELETE SET NULL;
-- owner_user_id is NULL for coach-owned circles; drop the legacy NOT NULL on hosted DBs.
ALTER TABLE public.forging_circles
  ALTER COLUMN owner_user_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forging_circles_owner
  ON public.forging_circles(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forging_circles_owner_coach_id
  ON public.forging_circles(owner_coach_id);
ALTER TABLE public.forging_circles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Forging circles can be public inserted." ON public.forging_circles FOR INSERT WITH CHECK (true);
CREATE POLICY "Forging circles can be public read." ON public.forging_circles FOR SELECT USING (true);
CREATE POLICY "Forging circles can be public updated." ON public.forging_circles FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Forging circles can be public deleted." ON public.forging_circles FOR DELETE USING (true);

-- social_posts: workout share posts in the Social tab Feed.
-- visibility 'public' -> visible to all; 'circle' -> visible to forging-circle members + author.
-- metrics_snapshot is denormalized at post time so deletes/edits to source data don't change the card.
CREATE TABLE IF NOT EXISTS public.social_posts (
  id BIGSERIAL PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  workout_log_id integer REFERENCES public.workout_logs(id) ON DELETE SET NULL,
  activity_log_id integer REFERENCES public.activity_logs(id) ON DELETE SET NULL,
  title text NOT NULL,
  photo_url text,
  location text,
  visibility text NOT NULL CHECK (visibility IN ('public', 'circle')) DEFAULT 'circle',
  -- Optional per-circle target. NULL = "all my circles" (broadcast); a value
  -- is reserved for future per-circle targeted posts.
  circle_id bigint REFERENCES public.forging_circles(id) ON DELETE SET NULL,
  share_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Optional free-text location (gym/place/city) added 2026-05-27 — also runs
-- standalone via migration for existing deployments.
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS location text;

ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS circle_id bigint REFERENCES public.forging_circles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_social_posts_circle_created
  ON public.social_posts(circle_id, created_at DESC)
  WHERE deleted_at IS NULL AND circle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_posts_user_id ON public.social_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_visibility_created
  ON public.social_posts(visibility, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_created_at
  ON public.social_posts(created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Social posts can be public inserted." ON public.social_posts FOR INSERT WITH CHECK (true);
CREATE POLICY "Social posts can be public read." ON public.social_posts FOR SELECT USING (true);
CREATE POLICY "Social posts can be public updated." ON public.social_posts FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Social posts can be public deleted." ON public.social_posts FOR DELETE USING (true);

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
CREATE POLICY "Social post likes can be public inserted." ON public.social_post_likes FOR INSERT WITH CHECK (true);
CREATE POLICY "Social post likes can be public read." ON public.social_post_likes FOR SELECT USING (true);
CREATE POLICY "Social post likes can be public deleted." ON public.social_post_likes FOR DELETE USING (true);

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
  ON public.social_post_comments(post_id, created_at) WHERE deleted_at IS NULL;
ALTER TABLE public.social_post_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Social post comments can be public inserted." ON public.social_post_comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Social post comments can be public read." ON public.social_post_comments FOR SELECT USING (true);
CREATE POLICY "Social post comments can be public updated." ON public.social_post_comments FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Social post comments can be public deleted." ON public.social_post_comments FOR DELETE USING (true);

-- forging_circle_invites: scoped to a single circle. Unknown emails are blocked
-- client-side so invitee_user_id is always populated at insert.
-- The inviter is exactly one of a user (legacy/app, inviter_user_id) or a coach
-- (dashboard, inviter_coach_id) — see the one_inviter constraint below. A
-- coach-owned circle's invites come from the dashboard with inviter_coach_id set.
CREATE TABLE IF NOT EXISTS public.forging_circle_invites (
  id BIGSERIAL PRIMARY KEY,
  circle_id bigint NOT NULL REFERENCES public.forging_circles(id) ON DELETE CASCADE,
  inviter_user_id text REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  inviter_coach_id integer REFERENCES public.coaches(id) ON DELETE CASCADE,
  invitee_email text NOT NULL,
  invitee_user_id text REFERENCES public.user_profile(user_id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')) DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (inviter_user_id IS NULL OR inviter_user_id <> invitee_user_id),
  CONSTRAINT forging_circle_invites_one_inviter
    CHECK (num_nonnulls(inviter_user_id, inviter_coach_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forging_circle_invites_circle_invitee_active
  ON public.forging_circle_invites(circle_id, invitee_user_id)
  WHERE status IN ('pending', 'accepted') AND circle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forging_circle_invites_invitee_pending
  ON public.forging_circle_invites(invitee_user_id, created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_forging_circle_invites_inviter
  ON public.forging_circle_invites(inviter_user_id, created_at DESC);
ALTER TABLE public.forging_circle_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Forging circle invites can be public inserted." ON public.forging_circle_invites FOR INSERT WITH CHECK (true);
CREATE POLICY "Forging circle invites can be public read." ON public.forging_circle_invites FOR SELECT USING (true);
CREATE POLICY "Forging circle invites can be public updated." ON public.forging_circle_invites FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Forging circle invites can be public deleted." ON public.forging_circle_invites FOR DELETE USING (true);

-- forging_circle_members: participants of a named circle (excluding the owner).
-- "Who is in circle X?" = circle.owner_user_id ∪ rows for that circle_id.
CREATE TABLE IF NOT EXISTS public.forging_circle_members (
  id BIGSERIAL PRIMARY KEY,
  circle_id bigint NOT NULL REFERENCES public.forging_circles(id) ON DELETE CASCADE,
  member_user_id text NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(circle_id, member_user_id)
);
CREATE INDEX IF NOT EXISTS idx_forging_circle_members_circle ON public.forging_circle_members(circle_id);
CREATE INDEX IF NOT EXISTS idx_forging_circle_members_member ON public.forging_circle_members(member_user_id);
ALTER TABLE public.forging_circle_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Forging circle members can be public inserted." ON public.forging_circle_members FOR INSERT WITH CHECK (true);
CREATE POLICY "Forging circle members can be public read." ON public.forging_circle_members FOR SELECT USING (true);
CREATE POLICY "Forging circle members can be public deleted." ON public.forging_circle_members FOR DELETE USING (true);

-- RPC to atomically accept a circle invite and write one membership row scoped
-- to the invite's circle. The owner is implicit (never a member row).
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
  -- Existence is checked via FOUND, not inviter_user_id: a coach-sent invite
  -- has inviter_user_id NULL (inviter_coach_id set instead).
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

-- ============================================
-- Special codes (2026-06-01)
-- ============================================
-- Pre-auth onboarding entry codes (coach, event, promo). Codes are stored
-- lowercase; the app normalizes input before lookup. Seed rows live in
-- supabase/migrations/20260601120000_special_codes.sql.
CREATE TABLE IF NOT EXISTS public.special_codes (
  id BIGSERIAL PRIMARY KEY,
  code text NOT NULL,
  code_type text NOT NULL CHECK (code_type IN ('coach', 'event', 'promo')),
  coach_id bigint REFERENCES public.coaches(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT special_codes_code_lowercase CHECK (code = lower(trim(code))),
  CONSTRAINT special_codes_coach_required CHECK (
    (code_type = 'coach' AND coach_id IS NOT NULL)
    OR (code_type <> 'coach')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_special_codes_code
  ON public.special_codes (code);
CREATE INDEX IF NOT EXISTS idx_special_codes_active
  ON public.special_codes (is_active, code_type)
  WHERE is_active = true;
ALTER TABLE public.special_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Special codes can be public read."
  ON public.special_codes FOR SELECT
  USING (
    is_active = true
    AND (expires_at IS NULL OR expires_at > now())
  );

-- Storage buckets for avatars and social post photos. Public-read so URLs render
-- directly; writes are permissive matching the rest of the schema's RLS posture.
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('social-posts', 'social-posts', true)
  ON CONFLICT (id) DO NOTHING;
-- Body progress photos. Public-read to keep the coach dashboard's read path
-- simple (same project, no signed-URL plumbing) and consistent with the app's
-- trusted-client posture — body_composition_log rows are already anon-readable.
-- Privacy rests on hard-to-enumerate paths ({userId}/{year}_W{week}_{angle}.jpg),
-- not on the bucket. See supabase/migrations for the storage.objects policies.
INSERT INTO storage.buckets (id, name, public) VALUES ('body-photos', 'body-photos', true)
  ON CONFLICT (id) DO NOTHING;
-- See supabase/migrations/20260526_social_share_and_forging_circle.sql for the
-- accompanying storage.objects policies (kept out of this canonical file because
-- they live on storage.objects, not a public.* table).