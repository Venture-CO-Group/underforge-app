ALTER TABLE public.meal_logs
  ADD COLUMN IF NOT EXISTS food_item_macros jsonb;

