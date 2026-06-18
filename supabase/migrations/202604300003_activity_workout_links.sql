-- Wearables v1.1: persist user-confirmed (or pending) links between a
-- wearable-imported activity_logs row and a manually-logged workout_logs row
-- on the same calendar day.
--
-- A `pending` row is created on import when a workout_log already exists for
-- the activity's date and the activity looks strength-style (or no obvious
-- "definitely a separate session" signal). The dashboard's one-tap pill
-- resolves it to either `linked` (count once toward the consistency score
-- because it's the same session the user logged in the app) or `separated`
-- (count twice because they did genuinely two different things).

CREATE TABLE IF NOT EXISTS public.activity_workout_links (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  activity_log_id INTEGER NOT NULL REFERENCES public.activity_logs(id) ON DELETE CASCADE,
  workout_log_id INTEGER NOT NULL REFERENCES public.workout_logs(id) ON DELETE CASCADE,
  link_state TEXT NOT NULL CHECK (link_state IN ('pending','linked','separated')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, activity_log_id)
);

CREATE INDEX IF NOT EXISTS idx_awl_user_state
  ON public.activity_workout_links(user_id, link_state);
CREATE INDEX IF NOT EXISTS idx_awl_workout
  ON public.activity_workout_links(workout_log_id);

ALTER TABLE public.activity_workout_links ENABLE ROW LEVEL SECURITY;

-- Match the permissive policies used by the rest of the app's tables in
-- the wearables stack (see 20260423_wearables.sql). Auth is enforced at the
-- edge-function / app layer; the public-row anon model is intentional.
CREATE POLICY "Activity workout links can be public inserted."
  ON public.activity_workout_links FOR INSERT WITH CHECK (true);
CREATE POLICY "Activity workout links can be public read."
  ON public.activity_workout_links FOR SELECT USING (true);
CREATE POLICY "Activity workout links can be public updated."
  ON public.activity_workout_links FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Activity workout links can be public deleted."
  ON public.activity_workout_links FOR DELETE USING (true);
