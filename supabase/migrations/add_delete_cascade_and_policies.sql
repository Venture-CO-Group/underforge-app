-- Migration: Add ON DELETE CASCADE to checkin_coach_with_user and missing DELETE RLS policies
-- Run this in the Supabase SQL editor before deploying the delete-account Edge Function.

-- 1. Ensure checkin_coach_with_user.user_id has ON DELETE CASCADE to user_profile
ALTER TABLE checkin_coach_with_user
  DROP CONSTRAINT IF EXISTS checkin_coach_with_user_user_id_fkey,
  ADD CONSTRAINT checkin_coach_with_user_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE;

-- 2. Add missing DELETE RLS policies
CREATE POLICY "Conversations can be public deleted."
  ON conversations FOR DELETE USING (true);

CREATE POLICY "Chat messages can be public deleted."
  ON chat_messages FOR DELETE USING (true);

CREATE POLICY "Checkin coach with user can be public deleted."
  ON checkin_coach_with_user FOR DELETE USING (true);

CREATE POLICY "Weekly consistency scores can be public deleted."
  ON weekly_consistency_scores FOR DELETE USING (true);
