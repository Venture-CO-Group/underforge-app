-- Auto-linked wearable↔workout matches default to merged behavior; the app
-- shows a review pill until the user acknowledges or separates.
ALTER TABLE public.activity_workout_links
  ADD COLUMN review_acknowledged boolean NOT NULL DEFAULT true;

UPDATE public.activity_workout_links
   SET review_acknowledged = false
 WHERE link_state = 'pending';
