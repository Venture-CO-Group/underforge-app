-- Per-set kcal estimate on workout_exercise_logs.
--
-- Populated by the device on insert/update using a MET-based formula that
-- combines work time (clamp(reps*3, 15..60s)), rest time, RIR / perceived
-- difficulty, and current bodyweight. Read paths (calories balance card,
-- nutrition adjustment, weekly report) sum this column per workout_log to
-- get the UF strength estimate, replacing the old time-based aggregate that
-- ran on the fly. NULL stays valid as a "no signal" marker so historic rows
-- remain queryable until the device writes them.

ALTER TABLE public.workout_exercise_logs
  ADD COLUMN IF NOT EXISTS calories_burned integer;

-- One-shot backfill: same formula as `estimateSetKcal`, with bodyweight=70
-- as a tame default. The device overwrites this on the next edit using the
-- user's actual latest weight.
UPDATE public.workout_exercise_logs
   SET calories_burned = ROUND(
     (
       (LEAST(60, GREATEST(15, COALESCE(reps, 8) * 3))::numeric / 60.0)
         * (
             CASE
               WHEN rir IS NOT NULL OR difficulty_perception IS NOT NULL THEN
                 GREATEST(
                   COALESCE(CASE
                     WHEN rir <= 1 THEN 6.0
                     WHEN rir <= 3 THEN 5.0
                     ELSE 3.5
                   END, 0),
                   COALESCE(CASE
                     WHEN difficulty_perception >= 4 THEN 6.0
                     WHEN difficulty_perception >= 2 THEN 5.0
                     ELSE 3.5
                   END, 0)
                 )
               ELSE 5.0
             END
           )
         * 70.0 / 60.0
     ) + (
       (COALESCE(rest_time_seconds, 60)::numeric / 60.0)
         * 1.5
         * 70.0 / 60.0
     )
   )
 WHERE calories_burned IS NULL;
