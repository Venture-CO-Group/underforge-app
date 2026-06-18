import { Onboard } from './onboard';

export enum DeviceType {
  IOS_DEVICE = 'ios_device',
  IOS_SIMULATOR = 'ios_simulator',
  ANDROID_DEVICE = 'android_device',
  ANDROID_EMULATOR = 'android_emulator'
}

export interface UserProfile {
  user_id: string; // Primary key - emulate Clerk `sub` identifier
  display_name?: string;
  avatar_url?: string | null; // Supabase Storage public URL for the user's avatar
  onboarding_profile_json?: string;
  onboarding_profile_ai_gen_json?: string; // snapshot copy of onboarding_profile_json for historical comparison
  timezone?: string; // user's timezone (e.g. "Europe/Berlin")
  expoPushToken?: string | null; // optional Expo push notification token
  device_type: DeviceType; // device type enum, defaults to ios_simulator
  active: boolean; // indicates if this profile is currently active, defaults to false
  is_coach?: boolean; // indicates if this user is a coach, defaults to false
  created_at?: string; // ISO date string

  // Auth-related fields
  auth_user_id?: string | null; // links to Supabase auth.users
  email?: string | null; // user's email address
  signup_code?: string | null; // special_codes.code the user joined with (acquisition attribution), or null
  // Note: email_verified is checked via auth.users.email_confirmed_at, not stored here

  // Reminder preferences
  reminder_frequency?: 'once_per_day' | 'every_task'; // reminder frequency preference, defaults to 'once_per_day'

  // Away Mode - pauses streak counting during vacations or sick days
  away_mode?: boolean; // when true, streak counting is paused
  away_mode_start_date?: string | null; // ISO date string of when away mode was activated

  // Account Status - admin-controlled user access (controlled from Supabase)
  account_status?: 'active' | 'deactivated'; // defaults to 'active'

  // Nutrition preferences
  wants_detailed_nutrition_advice?: boolean; // when true, user wants to receive detailed nutritional advice and recipes

  // Weekly check-in schedule
  // 'sun_sat_sun1800' (default): assess Sun (prior) → Sat (this week), prompted Sunday 18:00 local
  // 'mon_sun_mon1800': assess Mon → Sun (last week), prompted Monday 18:00 local
  weekly_checkin_schedule_mode?: WeeklyCheckinScheduleMode;

  // Default audience used for new social posts AND for visibility in the
  // leaderboard. 'public' = visible to anyone; 'circles' = only members of
  // any of the user's Forging Circles.
  default_share_audience?: 'public' | 'circles' | null;

  // Parsed onboarding data - use this for the new interface
  onboardingProfile?: Onboard;

  // Per-step notes written manually by the human coach in Supabase Studio.
  // Stored as a JSON string keyed by action-step id (e.g. {"step_1": "..."}).
  // See `lib/human-coach-step-notes.ts` for parsing.
  human_coach_step_notes_json?: string | null;
}

export type WeeklyCheckinScheduleMode = 'sun_sat_sun1800' | 'mon_sun_mon1800';
export const DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE: WeeklyCheckinScheduleMode = 'sun_sat_sun1800';
