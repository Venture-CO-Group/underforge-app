-- Weekly check-in schedule preference on user_profile.
-- Apply on hosted Supabase: `supabase db push` or run in SQL editor.

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS weekly_checkin_schedule_mode text
    CHECK (weekly_checkin_schedule_mode IN ('sun_sat_sun1800', 'mon_sun_mon1800'))
    DEFAULT 'sun_sat_sun1800';
