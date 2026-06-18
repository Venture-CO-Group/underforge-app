-- Baseline-movement recommendation, persisted alongside nutrition targets.
--
-- The recommendation makes explicit the "non-training NEAT" budget that
-- previously lived implicitly inside the occupation multiplier
-- (`getOccupationMultiplier`). It is derived from `occupation_activity`,
-- habitual `usual_cardio`, and the prescribed action-plan training kcal
-- via `lib/baseline-movement.ts:computeBaselineMovement` and is rewritten
-- whenever `persistPlanNutritionTargets` runs (i.e., on plan creation /
-- regeneration).
--
-- The minutes value is what the user sees in the training plan UI; the
-- kcal value feeds both the eating target (via `caloriesTarget` in step 2
-- of the action plan) and the burn-card daily-movement target. Steps is
-- the rough wearable-friendly equivalent.
--
-- All three columns are nullable so legacy rows (created before this
-- migration) still satisfy the schema; readers fall back to a runtime
-- recompute from the user's onboarding answers when the value is NULL.

ALTER TABLE public.user_nutrition_targets
  ADD COLUMN IF NOT EXISTS baseline_movement_kcal integer,
  ADD COLUMN IF NOT EXISTS baseline_movement_minutes integer,
  ADD COLUMN IF NOT EXISTS baseline_movement_steps integer;
