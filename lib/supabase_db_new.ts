import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as Localization from 'expo-localization';
import { ChatMessage } from '../types/chat';
import { Checkin } from '../types/checkin';
import { CoachType, ExpectedCheckin, Onboard } from '../types/onboard';
import { DeviceType, UserProfile } from '../types/user_profile';
import { getActiveLoggedInUser } from './db';
import { PushTokenResult } from './expo-notification-helper';
import { glowLogger } from './glow-logger';
import { onboardingEvents } from './supabase_db';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let supabase: any;

// Initialize supabase client using the existing function
export const initializeSupabase = async (): Promise<void> => {
  await require('./supabase_db').initializeSupabase();
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false, // Not needed for React Native
      },
    });
  }
};

// Helper function to get current timezone
const getCurrentTimezone = (): string | undefined => {
  try {
    const calendars = Localization.getCalendars();
    const timeZone = calendars[0]?.timeZone; // e.g. "Europe/Berlin"
    return timeZone;
  } catch (error) {
    glowLogger.error('Error getting current timezone', {
      error: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
};

// Set other user profiles with the same push token to inactive (for push notification routing).
// Excludes the current user so their profile is never inadvertently deactivated.
export const setOtherUserProfilesInactive = async (pushToken: string, currentUserId?: string): Promise<void> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, skipping inactive profile update', {
        push_token: pushToken
      });
      return;
    }

    let query = supabase
      .from('user_profile')
      .update({ active: false })
      .eq('expo_push_token', pushToken)
      .neq('active', false);

    if (currentUserId) {
      query = query.neq('user_id', currentUserId);
    }

    const { data, error } = await query;

    if (error) {
      glowLogger.error('Error setting other user profiles inactive', {
        error: error.message || String(error),
        push_token: pushToken
      });
      throw error;
    }

    glowLogger.info('Other user profiles set to inactive', { 
      push_token: pushToken,
      excluded_user_id: currentUserId,
      profiles_updated: data ? data.length : 0
    });
  } catch (error) {
    glowLogger.error('Failed to set other user profiles inactive', {
      error: error instanceof Error ? error.message : String(error),
      push_token: pushToken
    });
    throw error;
  }
};

// Save user profile to Supabase using UserProfile interface
export const saveUserProfile = async (userProfile: UserProfile, saveAiGenCopy: boolean = false): Promise<void> => {
  try {
    glowLogger.info('saveUserProfile called', {
      user_id: userProfile.user_id,
      display_name: userProfile.display_name,
      saveAiGenCopy: saveAiGenCopy,
      has_onboardingProfile: !!userProfile.onboardingProfile,
      has_onboarding_profile_json: !!userProfile.onboarding_profile_json
    });

    // Check if Supabase is initialized
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, skipping profile save', {
        user_id: userProfile.user_id,
        display_name: userProfile.display_name
      });
      return;
    }

    // If we have a push token, deactivate other profiles with the same token
    if (userProfile.expoPushToken) {
      await setOtherUserProfilesInactive(userProfile.expoPushToken, userProfile.user_id);
    }
    
    // Prepare profile data for database
    const profileData: any = {
      user_id: userProfile.user_id,
      display_name: userProfile.display_name,
      active: userProfile.active,
      device_type: userProfile.device_type || DeviceType.IOS_SIMULATOR,
      created_at: userProfile.created_at || new Date().toISOString()
    };
    
    // Add timezone, get current if not provided
    if (userProfile.timezone) {
      profileData.timezone = userProfile.timezone;
    } else {
      profileData.timezone = getCurrentTimezone();
    }
    
    // Add onboarding profile JSON if onboardingProfile data exists
    if (userProfile.onboardingProfile) {
      profileData.onboarding_profile_json = JSON.stringify(userProfile.onboardingProfile);
    } else if (userProfile.onboarding_profile_json) {
      profileData.onboarding_profile_json = userProfile.onboarding_profile_json;
    }
    
    // Save AI-generated copy if requested and we have JSON data
    if (saveAiGenCopy && profileData.onboarding_profile_json) {
      profileData.onboarding_profile_ai_gen_json = profileData.onboarding_profile_json;
    } 

    // Add push token if provided
    if (userProfile.expoPushToken !== undefined) {
      profileData.expo_push_token = userProfile.expoPushToken;
    }
    
    // Add auth_user_id if provided (links to Supabase Auth)
    if ((userProfile as any).auth_user_id !== undefined) {
      profileData.auth_user_id = (userProfile as any).auth_user_id;
    }
    
    // Add email if provided
    if ((userProfile as any).email !== undefined) {
      profileData.email = (userProfile as any).email;
    }

    // Add signup_code if provided (acquisition attribution; set once at signup)
    if (userProfile.signup_code !== undefined) {
      profileData.signup_code = userProfile.signup_code;
    }

    // Add reminder_frequency if provided
    if (userProfile.reminder_frequency !== undefined) {
      profileData.reminder_frequency = userProfile.reminder_frequency;
    }

    // Add away_mode fields if provided
    if (userProfile.away_mode !== undefined) {
      profileData.away_mode = userProfile.away_mode;
    }
    if (userProfile.away_mode_start_date !== undefined) {
      profileData.away_mode_start_date = userProfile.away_mode_start_date;
    }

    // Add account_status if provided (admin-controlled, defaults to 'active')
    if (userProfile.account_status !== undefined) {
      profileData.account_status = userProfile.account_status;
    }

    if (userProfile.weekly_checkin_schedule_mode !== undefined) {
      profileData.weekly_checkin_schedule_mode = userProfile.weekly_checkin_schedule_mode;
    }

    if (userProfile.avatar_url !== undefined) {
      profileData.avatar_url = userProfile.avatar_url;
    }

    if (userProfile.default_share_audience !== undefined) {
      profileData.default_share_audience = userProfile.default_share_audience;
    }

    glowLogger.info('Profile data being saved', { profile_data: JSON.stringify(profileData) });

    const { data, error } = await supabase
      .from('user_profile')
      .upsert(profileData, {
        onConflict: 'user_id'
      })
      .select();

    if (error) {
      glowLogger.error('Error saving user profile to Supabase', {
        error: error.message || String(error)
      });
      throw error;
    }

    glowLogger.info('User profile saved to Supabase successfully', { data: JSON.stringify(data) });

    // After successful save, emit the event
    onboardingEvents.emit('onboardingDataChanged', {
      userId: userProfile.user_id,
      displayName: userProfile.display_name,
      onboardingProfile: userProfile.onboardingProfile,
      action: 'profile_saved'
    });
  } catch (error) {
    glowLogger.error('Failed to save user profile to Supabase', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

// Get user profile from Supabase by user_id returning UserProfile
export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot fetch user profile', {
        user_id: userId
      });
      return null;
    }

    const { data, error } = await supabase
      .from('user_profile')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows found
        glowLogger.info('No user profile found for user_id', { user_id: userId });
        return null;
      }
      glowLogger.error('Error fetching user profile from Supabase', {
        error: error.message || String(error)
      });
      throw error;
    }

    if (!data) {
      glowLogger.info('No user profile data found for user_id', { user_id: userId });
      return null;
    }

    // Parse the onboarding profile JSON if it exists
    let parsedOnboard: Onboard | undefined;
    if (data.onboarding_profile_json) {
      try {
        parsedOnboard = JSON.parse(data.onboarding_profile_json);
      } catch (parseError) {
        glowLogger.error('Error parsing onboarding profile JSON', {
          error: parseError instanceof Error ? parseError.message : String(parseError)
        });
        throw new Error('Invalid onboarding profile data');
      }
    }

    const userProfile: UserProfile = {
      user_id: data.user_id,
      display_name: data.display_name,
      avatar_url: data.avatar_url ?? null,
      email: data.email ?? null,
      onboarding_profile_json: data.onboarding_profile_json,
      onboarding_profile_ai_gen_json: data.onboarding_profile_ai_gen_json,
      timezone: data.timezone || getCurrentTimezone(),
      expoPushToken: data.expo_push_token,
      device_type: data.device_type || DeviceType.IOS_SIMULATOR,
      active: data.active || false,
      is_coach: !!data.is_coach,
      created_at: data.created_at,
      reminder_frequency: data.reminder_frequency || 'once_per_day',
      away_mode: data.away_mode || false,
      away_mode_start_date: data.away_mode_start_date || null,
      account_status: data.account_status || 'active',
      weekly_checkin_schedule_mode: data.weekly_checkin_schedule_mode || 'sun_sat_sun1800',
      default_share_audience: data.default_share_audience === 'public' ? 'public' : 'circles',
      onboardingProfile: parsedOnboard,
      human_coach_step_notes_json: data.human_coach_step_notes_json ?? null,
    };

    glowLogger.info('User profile fetched from Supabase successfully', { 
      user_id: userId,
      is_coach: userProfile.is_coach,
    });
    return userProfile;
  } catch (error) {
    glowLogger.error('Failed to fetch user profile from Supabase', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

// Get user profile from Supabase for the currently logged in user
export const getRemoteUserProfileLoggedInUser = async (): Promise<UserProfile | null> => {
  try {
    // Get the currently active logged in user
    const activeUser = await getActiveLoggedInUser();
    
    if (!activeUser) {
      glowLogger.info('No active logged in user found', {});
      return null;
    }
    
    glowLogger.info('Getting remote profile for active user', { 
      display_name: activeUser.display_name, 
      user_id: activeUser.id 
    });
    
    // Fetch their profile from Supabase
    const userProfile = await getUserProfile(activeUser.id);

    glowLogger.info('Got remote profile for active user', { 
      display_name: activeUser.display_name, 
      user_id: activeUser.id,
    });
    
    return userProfile;
  } catch (error) {
    glowLogger.error('Failed to get remote user profile for logged in user', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

// Log current onboarding data for debugging purposes
const logCurrentOnboardData = async (userId: string): Promise<void> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot log current onboard data', { user_id: userId });
      return;
    }

    const { data, error } = await supabase
      .from('user_profile')
      .select('onboarding_profile_json, onboarding_profile_ai_gen_json')
      .eq('user_id', userId)
      .single();

    if (error) {
      glowLogger.error('Error fetching current onboard data', {
        user_id: userId,
        error: error.message || String(error)
      });
      return;
    }

    glowLogger.debug('Current onboard data before update', {
      user_id: userId,
      existing_onboarding_profile_json: data?.onboarding_profile_json,
      existing_onboarding_profile_ai_gen_json: data?.onboarding_profile_ai_gen_json
    });
  } catch (err) {
    glowLogger.error('Exception while logging current onboard data', {
      user_id: userId,
      error: String(err)
    });
  }
};

// Update user onboarding profile JSON in Supabase
export const updateUserOnboardingProfileJson = async (userId: string, onboardData: Onboard): Promise<void> => {
  try {
    glowLogger.info('updateUserOnboardingProfileJson called', {
      user_id: userId,
      has_action_plan: !!onboardData.actionPlan,
      selected_goal: onboardData.selectedGoal,
      name: onboardData.name
    });

    if (!supabase) {
      glowLogger.warn('Supabase not initialized, skipping onboarding profile update', {
        user_id: userId
      });
      return;
    }

    const onboardingProfileJson = JSON.stringify(onboardData);

    glowLogger.info('About to update onboarding profile JSON', { 
      user_id: userId, 
      json_length: onboardingProfileJson.length
    });

    const { data, error } = await supabase
      .from('user_profile')
      .update({ 
        onboarding_profile_json: onboardingProfileJson 
      })
      .eq('user_id', userId)
      .select();

    if (error) {
      glowLogger.error('Error updating onboarding profile JSON in Supabase', {
        error: error.message || String(error),
        error_code: error.code || 'unknown',
        error_details: error.details || 'none',
        error_hint: error.hint || 'none',
        user_id: userId,
        full_error: JSON.stringify(error, null, 2)
      });
      throw error;
    }

    // Check if no rows were affected
    if (!data || data.length === 0) {
      throw new Error(`No rows were updated - user profile may not exist for user_id: ${userId}`);
    }

    glowLogger.info('Onboarding profile JSON updated in Supabase successfully', {
      user_id: userId,
      rows_affected: data.length,
      json_length: onboardingProfileJson.length
    });

    // After successful update, emit the event
    onboardingEvents.emit('onboardingDataChanged', {
      userId: userId,
      displayName: onboardData.name,
      onboardingProfile: onboardData,
      action: 'onboarding_profile_updated'
    });
  } catch (error) {
    glowLogger.error('Failed to update onboarding profile JSON in Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    throw error;
  }
};

// Update user profile in Supabase using UserProfile interface
export const updateUserProfile = async (userProfile: Partial<UserProfile> & { user_id: string }, saveAiGenCopy: boolean = false): Promise<void> => {
  try {
    glowLogger.info('updateUserProfile called', {
      user_id: userProfile.user_id,
      display_name: userProfile.display_name,
      saveAiGenCopy: saveAiGenCopy,
      has_onboardingProfile: !!userProfile.onboardingProfile,
      has_onboarding_profile_json: !!userProfile.onboarding_profile_json
    });

    // Log current onboard data before making any updates
    await logCurrentOnboardData(userProfile.user_id);

    if (!supabase) {
      glowLogger.warn('Supabase not initialized, skipping profile update', {
        user_id: userProfile.user_id
      });
      return;
    }

    const updateData: any = {};
    
    if (userProfile.display_name !== undefined) {
      updateData.display_name = userProfile.display_name;
    }
    
    if (userProfile.onboardingProfile !== undefined) {
      updateData.onboarding_profile_json = JSON.stringify(userProfile.onboardingProfile);
    } else if (userProfile.onboarding_profile_json !== undefined) {
      updateData.onboarding_profile_json = userProfile.onboarding_profile_json;
    }

    // Save AI-generated copy if requested and we have JSON data
    if (saveAiGenCopy && updateData.onboarding_profile_json) {
      updateData.onboarding_profile_ai_gen_json = updateData.onboarding_profile_json;
    } 

    if (userProfile.expoPushToken !== undefined) {
      updateData.expo_push_token = userProfile.expoPushToken;
    }

    if (userProfile.device_type !== undefined) {
      updateData.device_type = userProfile.device_type;
    }

    if (userProfile.active !== undefined) {
      updateData.active = userProfile.active;
    }

    if (userProfile.timezone !== undefined) {
      updateData.timezone = userProfile.timezone;
    }

    if (userProfile.reminder_frequency !== undefined) {
      updateData.reminder_frequency = userProfile.reminder_frequency;
    }

    if (userProfile.away_mode !== undefined) {
      updateData.away_mode = userProfile.away_mode;
    }

    if (userProfile.away_mode_start_date !== undefined) {
      updateData.away_mode_start_date = userProfile.away_mode_start_date;
    }

    if (userProfile.account_status !== undefined) {
      updateData.account_status = userProfile.account_status;
    }

    if (userProfile.weekly_checkin_schedule_mode !== undefined) {
      updateData.weekly_checkin_schedule_mode = userProfile.weekly_checkin_schedule_mode;
    }

    if (userProfile.avatar_url !== undefined) {
      updateData.avatar_url = userProfile.avatar_url;
    }

    if (userProfile.default_share_audience !== undefined) {
      updateData.default_share_audience = userProfile.default_share_audience;
    }

    // Debug: Log what we're about to update
    glowLogger.info('About to update user profile', { 
      user_id: userProfile.user_id, 
      update_data: JSON.stringify(updateData)
    });

    const { data, error } = await supabase
      .from('user_profile')
      .update(updateData)
      .eq('user_id', userProfile.user_id)
      .select();

    if (error) {
      glowLogger.error('Error updating user profile in Supabase', {
        error: error.message || String(error),
        error_code: error.code,
        error_details: error.details,
        error_hint: error.hint
      });
      throw error;
    }

    // Check if no rows were affected (user doesn't exist)
    if (!data || data.length === 0) {
      glowLogger.warn('No rows were updated - user profile may not exist', {
        user_id: userProfile.user_id,
        suggestion: 'Consider using saveUserProfileNew instead to create the profile'
      });
    }

    glowLogger.info('User profile updated in Supabase successfully', { 
      user_id: userProfile.user_id, 
      rows_affected: data ? data.length : 0 
    });

    // After successful update, emit the event
    onboardingEvents.emit('onboardingDataChanged', {
      userId: userProfile.user_id,
      displayName: userProfile.display_name,
      onboardingProfile: userProfile.onboardingProfile,
      action: 'profile_updated'
    });
  } catch (error) {
    glowLogger.error('Failed to update user profile in Supabase', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

// Delete user profile from Supabase
export const deleteUserProfile = async (userId: string): Promise<void> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, skipping profile deletion', {
        user_id: userId
      });
      return;
    }

    const { error } = await supabase
      .from('user_profile')
      .delete()
      .eq('user_id', userId);

    if (error) {
      glowLogger.error('Error deleting user profile from Supabase', {
        error: error.message || String(error)
      });
      throw error;
    }

    glowLogger.info('User profile deleted from Supabase successfully', { user_id: userId });
  } catch (error) {
    glowLogger.error('Failed to delete user profile from Supabase', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

// Check if user profile exists in Supabase for the currently logged in user
export const hasRemoteUserProfileForLoggedInUser = async (): Promise<boolean> => {
  try {
    const userProfile = await getRemoteUserProfileLoggedInUser();
    return userProfile !== null;
  } catch (error) {
    glowLogger.error('Failed to check if remote user profile exists for logged in user', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
};

/**
 * Find a user profile by email address.
 * Used during sign-up/sign-in to link existing profiles to auth accounts.
 * Does NOT filter by active flag — active is a device/push-notification flag,
 * not an account existence flag. Filtering by it causes permanent lockout when
 * another user signs up on the same device (setOtherUserProfilesInactive sets active=false).
 */
export const findProfileByEmail = async (email: string): Promise<{
  userId: string;
  displayName: string;
  email: string;
} | null> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot search for profile by email', {});
      return null;
    }

    if (!email) {
      glowLogger.info('No email provided for profile search', {});
      return null;
    }

    glowLogger.info('Searching for user profile by email', { email });

    const { data, error } = await supabase
      .from('user_profile')
      .select('user_id, display_name, email')
      .eq('email', email)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        glowLogger.info('No profile found for email', { email });
        return null;
      }
      glowLogger.error('Error searching for profile by email', {
        error: error.message || String(error),
        email
      });
      return null;
    }

    if (!data) {
      glowLogger.info('No profile data found for email', { email });
      return null;
    }

    glowLogger.info('Found profile by email', {
      user_id: data.user_id,
      display_name: data.display_name,
      email
    });

    return {
      userId: data.user_id,
      displayName: data.display_name || 'User',
      email: data.email || email,
    };
  } catch (error) {
    glowLogger.error('Failed to find profile by email', {
      error: error instanceof Error ? error.message : String(error),
      email
    });
    return null;
  }
};

/**
 * Find a user profile by auth_user_id.
 * Used during session restore and sign-in to find the profile linked to an auth account.
 * Does NOT filter by active flag — active is a device/push-notification flag,
 * not an account existence flag. Filtering by it causes permanent lockout when
 * another user signs up on the same device (setOtherUserProfilesInactive sets active=false).
 */
export const findProfileByAuthUserId = async (authUserId: string): Promise<{
  userId: string;
  displayName: string;
  email: string;
} | null> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot search for profile by auth_user_id', {});
      return null;
    }

    if (!authUserId) {
      glowLogger.info('No auth_user_id provided for profile search', {});
      return null;
    }

    glowLogger.info('Searching for user profile by auth_user_id', { auth_user_id: authUserId });

    const { data, error } = await supabase
      .from('user_profile')
      .select('user_id, display_name, email')
      .eq('auth_user_id', authUserId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        glowLogger.info('No profile found for auth_user_id', { auth_user_id: authUserId });
        return null;
      }
      glowLogger.error('Error searching for profile by auth_user_id', {
        error: error.message || String(error),
        auth_user_id: authUserId
      });
      return null;
    }

    if (!data) {
      glowLogger.info('No profile data found for auth_user_id', { auth_user_id: authUserId });
      return null;
    }

    glowLogger.info('Found profile by auth_user_id', {
      user_id: data.user_id,
      display_name: data.display_name,
      auth_user_id: authUserId
    });

    return {
      userId: data.user_id,
      displayName: data.display_name || 'User',
      email: data.email || '',
    };
  } catch (error) {
    glowLogger.error('Failed to find profile by auth_user_id', {
      error: error instanceof Error ? error.message : String(error),
      auth_user_id: authUserId
    });
    return null;
  }
};

/**
 * Reactivate a user profile on sign-in.
 * The active flag can be set to false by setOtherUserProfilesInactive when a different
 * user signs up on the same device. This restores it so the user receives push notifications.
 */
export const reactivateUserProfile = async (userId: string): Promise<void> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot reactivate profile', { user_id: userId });
      return;
    }

    const { error } = await supabase
      .from('user_profile')
      .update({ active: true })
      .eq('user_id', userId);

    if (error) {
      glowLogger.error('Failed to reactivate user profile', {
        error: error.message || String(error),
        user_id: userId
      });
      return;
    }

    glowLogger.info('User profile reactivated on sign-in', { user_id: userId });
  } catch (error) {
    glowLogger.error('Error reactivating user profile', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
  }
};

/**
 * Link an existing user_profile to a new auth account.
 * Used when an existing user signs up and we find their profile by email.
 */
export const linkProfileToAuth = async (
  userId: string,
  authUserId: string,
  email: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot link profile to auth', {});
      return { success: false, error: 'Supabase not initialized' };
    }

    glowLogger.info('Linking user profile to auth account', {
      user_id: userId,
      auth_user_id: authUserId,
      email
    });

    const { error } = await supabase
      .from('user_profile')
      .update({
        auth_user_id: authUserId,
        email: email
      })
      .eq('user_id', userId);

    if (error) {
      glowLogger.error('Failed to link profile to auth', {
        error: error.message || String(error),
        user_id: userId,
        auth_user_id: authUserId
      });
      return { success: false, error: error.message };
    }

    glowLogger.info('Successfully linked profile to auth', {
      user_id: userId,
      auth_user_id: authUserId
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    glowLogger.error('Exception linking profile to auth', {
      error: errorMessage,
      user_id: userId,
      auth_user_id: authUserId
    });
    return { success: false, error: errorMessage };
  }
};

/**
 * Find a user profile by push token.
 * Used for auto-restore functionality when a user installs a new build
 * but their profile exists in Supabase from a previous installation.
 */
export const findUserProfileByPushToken = async (pushToken: string): Promise<UserProfile | null> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot search for profile by push token', {});
      return null;
    }

    if (!pushToken) {
      glowLogger.info('No push token provided for profile search', {});
      return null;
    }

    glowLogger.info('Searching for user profile by push token', { 
      push_token_preview: pushToken.substring(0, 30) + '...'
    });

    const { data, error } = await supabase
      .from('user_profile')
      .select('*')
      .eq('expo_push_token', pushToken)
      .eq('active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows found - this is expected for new users
        glowLogger.info('No active profile found for push token', { 
          push_token_preview: pushToken.substring(0, 30) + '...'
        });
        return null;
      }
      glowLogger.error('Error searching for profile by push token', {
        error: error.message || String(error)
      });
      return null;
    }

    if (!data) {
      glowLogger.info('No profile data found for push token', {});
      return null;
    }

    // Parse the onboarding profile JSON if it exists
    let parsedOnboard: Onboard | undefined;
    if (data.onboarding_profile_json) {
      try {
        parsedOnboard = JSON.parse(data.onboarding_profile_json);
      } catch (parseError) {
        glowLogger.error('Error parsing onboarding profile JSON for auto-restore', {
          error: parseError instanceof Error ? parseError.message : String(parseError)
        });
        return null;
      }
    }

    const userProfile: UserProfile = {
      user_id: data.user_id,
      display_name: data.display_name,
      onboarding_profile_json: data.onboarding_profile_json,
      onboarding_profile_ai_gen_json: data.onboarding_profile_ai_gen_json,
      timezone: data.timezone || getCurrentTimezone(),
      expoPushToken: data.expo_push_token,
      device_type: data.device_type || DeviceType.IOS_DEVICE,
      active: data.active || false,
      is_coach: !!data.is_coach,
      created_at: data.created_at,
      onboardingProfile: parsedOnboard,
      human_coach_step_notes_json: data.human_coach_step_notes_json ?? null,
    };

    glowLogger.info('Found user profile by push token for auto-restore', { 
      user_id: userProfile.user_id,
      display_name: userProfile.display_name,
      has_onboarding_profile: !!parsedOnboard
    });

    return userProfile;
  } catch (error) {
    glowLogger.error('Failed to find user profile by push token', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};

// Get all user profiles from Supabase
export const getAllUserProfiles = async (): Promise<UserProfile[]> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot fetch user profiles');
      return [];
    }

    const { data, error } = await supabase
      .from('user_profile')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      glowLogger.error('Error fetching all user profiles from Supabase', {
        error: error.message || String(error)
      });
      throw error;
    }

    if (!data || data.length === 0) {
      glowLogger.info('No user profiles found');
      return [];
    }

    const userProfiles: UserProfile[] = data.map((row: any) => {
      let parsedOnboard: Onboard | undefined;
      if (row.onboarding_profile_json) {
        try {
          parsedOnboard = JSON.parse(row.onboarding_profile_json);
        } catch (parseError) {
          glowLogger.error('Error parsing onboarding profile JSON for user', {
            user_id: row.user_id,
            error: parseError instanceof Error ? parseError.message : String(parseError)
          });
        }
      }
      return {
        user_id: row.user_id,
        display_name: row.display_name,
        onboarding_profile_json: row.onboarding_profile_json,
        onboarding_profile_ai_gen_json: row.onboarding_profile_ai_gen_json,
        timezone: row.timezone || getCurrentTimezone(),
        expoPushToken: row.expo_push_token,
        device_type: row.device_type,
        active: row.active,
        is_coach: !!row.is_coach,
        created_at: row.created_at,
        onboardingProfile: parsedOnboard
      };
    });

    // For profiles without timezone, set current timezone
    for (const profile of userProfiles) {
      if (!profile.timezone) {
        profile.timezone = getCurrentTimezone();
      }
    }

    glowLogger.info('All user profiles fetched from Supabase successfully', { 
      count: userProfiles.length 
    });
    return userProfiles;
  } catch (error) {
    glowLogger.error('Failed to fetch all user profiles from Supabase', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

// Get chat messages for a specific user from Supabase
export const getChatMessages = async (userId: string): Promise<ChatMessage[]> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot fetch chat messages', {
        user_id: userId
      });
      return [];
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', userId)
      .order('timestamp', { ascending: false });

    if (error) {
      glowLogger.error('Error fetching chat messages from Supabase', {
        error: error.message || String(error),
        user_id: userId
      });
      throw error;
    }

    if (!data || data.length === 0) {
      glowLogger.info('No chat messages found for user', { user_id: userId });
      return [];
    }

    const chatMessages: ChatMessage[] = data.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      text: row.text,
      sender: row.sender,
      timestamp: row.timestamp,
      user_display_name: row.user_display_name,
      is_from_notification: row.is_from_notification || false,
      created_at: row.created_at
    }));

    glowLogger.info('Chat messages fetched from Supabase successfully', { 
      user_id: userId,
      count: chatMessages.length 
    });
    return chatMessages;
  } catch (error) {
    glowLogger.error('Failed to fetch chat messages from Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    throw error;
  }
};

// Update user profile Expo push token in Supabase
export const updateUserProfileExpoPushToken = async (userId: string, pushTokenResult: PushTokenResult): Promise<void> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, skipping push token update', {
        user_id: userId
      });
      return;
    }

    // Validate that the device type is a real device (iOS or Android), not a simulator/emulator
    if (pushTokenResult.deviceType !== DeviceType.IOS_DEVICE && pushTokenResult.deviceType !== DeviceType.ANDROID_DEVICE) {
      throw new Error(`Push token update only supported for real devices, got: ${pushTokenResult.deviceType}`);
    }

    // First, get the existing user profile to check its device type
    const existingProfile = await getUserProfile(userId);
    if (!existingProfile) {
      throw new Error(`User profile not found for user_id: ${userId}`);
    }

    // Validate that the existing profile also has a real device type (not simulator/emulator)
    if (existingProfile.device_type !== DeviceType.IOS_DEVICE && existingProfile.device_type !== DeviceType.ANDROID_DEVICE) {
      throw new Error(`User profile device type must be a real device (ios_device or android_device), got: ${existingProfile.device_type}`);
    }

    glowLogger.info('Updating user profile push token', {
      user_id: userId,
      has_push_token: !!pushTokenResult.expoPushToken,
      permission_status: pushTokenResult.permissionStatus,
      device_type: pushTokenResult.deviceType
    });

    const { data, error } = await supabase
      .from('user_profile')
      .update({
        expo_push_token: pushTokenResult.expoPushToken,
        active: true  // Ensure profile stays active with new token
      })
      .eq('user_id', userId)
      .select();

    if (error) {
      glowLogger.error('Error updating user profile push token in Supabase', {
        error: error.message || String(error),
        error_code: error.code,
        error_details: error.details,
        error_hint: error.hint,
        user_id: userId
      });
      throw error;
    }

    // Check if no rows were affected
    if (!data || data.length === 0) {
      throw new Error(`No rows were updated - user profile may not exist for user_id: ${userId}`);
    }

    glowLogger.info('User profile push token updated successfully', {
      user_id: userId,
      expo_push_token: pushTokenResult.expoPushToken,
      rows_affected: data.length
    });

  } catch (error) {
    glowLogger.error('Failed to update user profile push token', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    throw error;
  }
};

// Get checkins for a specific user within a date range from Supabase
export const get_checkins_for_range = async (
  userId: string, 
  startDateTime: string, 
  endDateTime: string
): Promise<Checkin[]> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot fetch checkins', {
        user_id: userId,
        start_datetime: startDateTime,
        end_datetime: endDateTime
      });
      return [];
    }

    const { data, error } = await supabase
      .from('checkins')
      .select('*')
      .eq('user_id', userId)
      .gte('checkin_due_at', startDateTime)
      .lte('checkin_due_at', endDateTime)
      .order('checkin_due_at', { ascending: true });

    if (error) {
      glowLogger.error('Error fetching checkins from Supabase', {
        error: error.message || String(error),
        user_id: userId,
        start_datetime: startDateTime,
        end_datetime: endDateTime
      });
      throw error;
    }

    if (!data || data.length === 0) {
      glowLogger.info('No checkins found for user in date range', { 
        user_id: userId,
        start_datetime: startDateTime,
        end_datetime: endDateTime
      });
      return [];
    }

    const checkins: Checkin[] = data.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      step_id: row.step_id,
      step_title: row.step_title,
      checked_in_at: row.checked_in_at,
      checkin_due_at: row.checkin_due_at
    }));

    glowLogger.info('Checkins fetched from Supabase successfully', { 
      user_id: userId,
      start_datetime: startDateTime,
      end_datetime: endDateTime,
      count: checkins.length 
    });
    return checkins;
  } catch (error) {
    glowLogger.error('Failed to fetch checkins from Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      start_datetime: startDateTime,
      end_datetime: endDateTime
    });
    throw error;
  }
};

// Save a new checkin to Supabase
export const saveNewCheckin = async (userId: string, expectedCheckin: ExpectedCheckin): Promise<void> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot save checkin', {
        user_id: userId,
        step_id: expectedCheckin.step_id,
        step_title: expectedCheckin.step_title
      });
      return;
    }

    // Calculate the checkin_due_at timestamp using the ExpectedCheckin method
    const checkinDueAt = expectedCheckin.calculateTimestampForThisWeekCheckin();

    const checkinData = {
      user_id: userId,
      step_id: expectedCheckin.step_id,
      step_title: expectedCheckin.step_title,
      checkin_due_at: checkinDueAt
    };

    glowLogger.info('Saving new checkin', { 
      user_id: userId, 
      step_id: expectedCheckin.step_id,
      step_title: expectedCheckin.step_title,
      checkin_due_at: checkinDueAt
    });

    const { data, error } = await supabase
      .from('checkins')
      .insert(checkinData)
      .select();

    if (error) {
      glowLogger.error('Error saving checkin to Supabase', {
        error: error.message || String(error),
        error_code: error.code,
        error_details: error.details,
        error_hint: error.hint,
        user_id: userId,
        step_id: expectedCheckin.step_id
      });
      throw error;
    }

    glowLogger.info('Checkin saved to Supabase successfully', { 
      user_id: userId,
      step_id: expectedCheckin.step_id,
      step_title: expectedCheckin.step_title,
      checkin_id: data?.[0]?.id
    });
  } catch (error) {
    glowLogger.error('Failed to save checkin to Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      step_id: expectedCheckin.step_id,
      step_title: expectedCheckin.step_title
    });
    throw error;
  }
};

export const get_todays_checkins = async (userId: string): Promise<Checkin[]> => {
  try {
    // Get current date in local timezone
    const now = new Date();
    
    // Create start of day (00:00) in current timezone, then convert to UTC
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    
    // Create end of day (23:59:59.999) in current timezone, then convert to UTC
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    
    // Since the database stores checkin_due_at in UTC, but we want to check for 
    // checkins that are due "today" in the user's timezone, we need to expand
    // the UTC range to ensure we don't miss any checkins
    const startOfDayUTC = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000); // 24 hours before
    const endOfDayUTC = new Date(endOfDay.getTime() + 24 * 60 * 60 * 1000); // 24 hours after
    
    glowLogger.info('Getting checkins due today', {
      user_id: userId,
      start_of_day_local: startOfDay.toISOString(),
      end_of_day_local: endOfDay.toISOString(),
      start_of_day_utc_expanded: startOfDayUTC.toISOString(),
      end_of_day_utc_expanded: endOfDayUTC.toISOString(),
      local_date: now.toLocaleDateString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });

    // Call get_checkins_for_range with expanded UTC range
    const allCheckins = await get_checkins_for_range(
      userId,
      startOfDayUTC.toISOString(),
      endOfDayUTC.toISOString()
    );

    // Filter to only include checkins that are due "today" in local timezone
    const todaysCheckins = allCheckins.filter(checkin => {
      const checkinDueDate = new Date(checkin.checkin_due_at);
      const checkinLocalDate = checkinDueDate.toLocaleDateString();
      const todayLocalDate = now.toLocaleDateString();
      return checkinLocalDate === todayLocalDate;
    });

    glowLogger.info('Checkins due today fetched successfully', {
      user_id: userId,
      count: todaysCheckins.length,
      all_checkins_count: allCheckins.length,
      local_date: now.toLocaleDateString(),
      todays_checkins: todaysCheckins.map(c => ({
        id: c.id,
        step_id: c.step_id,
        step_title: c.step_title,
        checkin_due_at: c.checkin_due_at,
        checkin_due_local: new Date(c.checkin_due_at).toLocaleString()
      }))
    });

    return todaysCheckins;
  } catch (error) {
    glowLogger.error('Failed to get checkins due today', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    throw error;
  }
};

// Delete a checkin from Supabase by ID
export const deleteCheckin = async (userId: string, checkinId: number): Promise<void> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot delete checkin', {
        user_id: userId,
        checkin_id: checkinId
      });
      return;
    }

    glowLogger.info('Deleting checkin', {
      user_id: userId,
      checkin_id: checkinId
    });

    const { data, error } = await supabase
      .from('checkins')
      .delete()
      .eq('id', checkinId)
      .eq('user_id', userId)
      .select();

    if (error) {
      glowLogger.error('Error deleting checkin from Supabase', {
        error: error.message || String(error),
        error_code: error.code,
        error_details: error.details,
        error_hint: error.hint,
        user_id: userId,
        checkin_id: checkinId
      });
      throw error;
    }

    // Check if no rows were affected (checkin doesn't exist or doesn't belong to user)
    if (!data || data.length === 0) {
      throw new Error(`No checkin found with ID ${checkinId} for user ${userId}`);
    }

    glowLogger.info('Checkin deleted from Supabase successfully', {
      user_id: userId,
      checkin_id: checkinId,
      rows_affected: data.length
    });
  } catch (error) {
    glowLogger.error('Failed to delete checkin from Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      checkin_id: checkinId
    });
    throw error;
  }
};

// Structure returned by getUsersWithRecentChatMessages
export interface UserRecentChatMessages {
  userProfile: UserProfile;
  messageCount: number;
}

/**
 * Get users having chat messages (sender = 'user') within the past N hours,
 * along with count of those messages.
 */
export const getUsersWithRecentChatMessages = async (
  sinceNumHours: number
): Promise<UserRecentChatMessages[]> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot fetch recent chat message users', {
        since_hours: sinceNumHours
      });
      return [];
    }

    if (sinceNumHours <= 0) {
      glowLogger.warn('sinceNumHours must be > 0', { since_hours: sinceNumHours });
      return [];
    }

    const sinceDate = new Date(Date.now() - sinceNumHours * 60 * 60 * 1000);
    const sinceISO = sinceDate.toISOString();

    glowLogger.info('Querying recent chat messages', {
      since_hours: sinceNumHours,
      since_iso: sinceISO
    });

    // Fetch raw rows and aggregate in app
    const { data: recentMessages, error: recentError } = await supabase
      .from('chat_messages')
      .select('user_id')
      .eq('sender', 'user')
      .gte('timestamp', sinceISO);

    if (recentError) {
      glowLogger.error('Error querying recent chat message rows', {
        error: recentError.message || String(recentError)
      });
      throw recentError;
    }

    if (!recentMessages || recentMessages.length === 0) {
      glowLogger.info('No recent chat messages found for any users (raw fetch)', {
        since_hours: sinceNumHours
      });
      return [];
    }

    // Build counts map
    const countMap: Record<string, number> = {};
    for (const row of recentMessages) {
      if (row.user_id) {
        countMap[row.user_id] = (countMap[row.user_id] || 0) + 1;
      }
    }

    const userIds = Object.keys(countMap);
    if (userIds.length === 0) {
      glowLogger.info('No user_ids after processing recent chat messages', {
        since_hours: sinceNumHours
      });
      return [];
    }

    glowLogger.info('Fetching user profiles for recent chat message users', {
      user_count: userIds.length
    });

    const { data: profilesData, error: profilesError } = await supabase
      .from('user_profile')
      .select('*')
      .in('user_id', userIds);

    if (profilesError) {
      glowLogger.error('Error fetching user profiles for recent chat users', {
        error: profilesError.message || String(profilesError)
      });
      throw profilesError;
    }

    const results: UserRecentChatMessages[] = (profilesData || []).map((row: any) => {
      let parsedOnboard: Onboard | undefined;
      if (row.onboarding_profile_json) {
        try {
          parsedOnboard = JSON.parse(row.onboarding_profile_json);
        } catch (e) {
          glowLogger.error('Failed parsing onboarding_profile_json for user (skipping parse)', {
            user_id: row.user_id,
            error: e instanceof Error ? e.message : String(e)
          });
        }
      }
      const userProfile: UserProfile = {
        user_id: row.user_id,
        display_name: row.display_name,
        onboarding_profile_json: row.onboarding_profile_json,
        onboarding_profile_ai_gen_json: row.onboarding_profile_ai_gen_json,
        timezone: row.timezone || getCurrentTimezone(),
        expoPushToken: row.expo_push_token,
        device_type: row.device_type,
        active: row.active,
        is_coach: !!row.is_coach,
        created_at: row.created_at,
        onboardingProfile: parsedOnboard
      };
      return {
        userProfile,
        messageCount: countMap[row.user_id] || 0
      };
    });

    results.sort((a, b) => b.messageCount - a.messageCount);

    glowLogger.info('Compiled recent chat message user list (in-memory aggregation)', {
      since_hours: sinceNumHours,
      result_count: results.length
    });

    return results;
  } catch (error) {
    glowLogger.error('Failed in getUsersWithRecentChatMessages', {
      error: error instanceof Error ? error.message : String(error),
      since_hours: sinceNumHours
    });
    return [];
  }
};

// Structure returned by getUsersWithRecentCheckins
export interface UserRecentCheckins {
  userProfile: UserProfile;
  checkinCount: number;
}

/**
 * Get users having checkins within the past N hours,
 * along with count of those checkins.
 */
export const getUsersWithRecentCheckins = async (
  sinceNumHours: number
): Promise<UserRecentCheckins[]> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot fetch recent checkin users', {
        since_hours: sinceNumHours
      });
      return [];
    }

    if (sinceNumHours <= 0) {
      glowLogger.warn('sinceNumHours must be > 0', { since_hours: sinceNumHours });
      return [];
    }

    const sinceDate = new Date(Date.now() - sinceNumHours * 60 * 60 * 1000);
    const sinceISO = sinceDate.toISOString();

    glowLogger.info('Querying recent checkins', {
      since_hours: sinceNumHours,
      since_iso: sinceISO
    });

    // Fetch raw checkin rows (only user_id needed)
    const { data: recentCheckins, error: recentError } = await supabase
      .from('checkins')
      .select('user_id')
      .gte('checked_in_at', sinceISO);

    if (recentError) {
      glowLogger.error('Error querying recent checkin rows', {
        error: recentError.message || String(recentError)
      });
      throw recentError;
    }

    if (!recentCheckins || recentCheckins.length === 0) {
      glowLogger.info('No recent checkins found for any users', {
        since_hours: sinceNumHours
      });
      return [];
    }

    // Aggregate counts
    const countMap: Record<string, number> = {};
    for (const row of recentCheckins) {
      if (row.user_id) {
        countMap[row.user_id] = (countMap[row.user_id] || 0) + 1;
      }
    }

    const userIds = Object.keys(countMap);
    if (userIds.length === 0) {
      glowLogger.info('No user_ids after processing recent checkins', {
        since_hours: sinceNumHours
      });
      return [];
    }

    glowLogger.info('Fetching user profiles for recent checkin users', {
      user_count: userIds.length
    });

    const { data: profilesData, error: profilesError } = await supabase
      .from('user_profile')
      .select('*')
      .in('user_id', userIds);

    if (profilesError) {
      glowLogger.error('Error fetching user profiles for recent checkin users', {
        error: profilesError.message || String(profilesError)
      });
      throw profilesError;
    }

    const results: UserRecentCheckins[] = (profilesData || []).map((row: any) => {
      let parsedOnboard: Onboard | undefined;
      if (row.onboarding_profile_json) {
        try {
          parsedOnboard = JSON.parse(row.onboarding_profile_json);
        } catch (e) {
          glowLogger.error('Failed parsing onboarding_profile_json for user (skipping parse)', {
            user_id: row.user_id,
            error: e instanceof Error ? e.message : String(e)
          });
        }
      }
      const userProfile: UserProfile = {
        user_id: row.user_id,
        display_name: row.display_name,
        onboarding_profile_json: row.onboarding_profile_json,
        onboarding_profile_ai_gen_json: row.onboarding_profile_ai_gen_json,
        timezone: row.timezone || getCurrentTimezone(),
        expoPushToken: row.expo_push_token,
        device_type: row.device_type,
        active: row.active,
        is_coach: !!row.is_coach,
        created_at: row.created_at,
        onboardingProfile: parsedOnboard
      };
      return {
        userProfile,
        checkinCount: countMap[row.user_id] || 0
      };
    });

    results.sort((a, b) => b.checkinCount - a.checkinCount);

    glowLogger.info('Compiled recent checkin user list', {
      since_hours: sinceNumHours,
      result_count: results.length
    });

    return results;
  } catch (error) {
    glowLogger.error('Failed in getUsersWithRecentCheckins', {
      error: error instanceof Error ? error.message : String(error),
      since_hours: sinceNumHours
    });
    return [];
  }
};

/**
 * Return user profiles created within the last X hours.
 * Does not include a count wrapper; just the UserProfile list.
 */
export const getUsersWithRecentOnboardings = async (
  userCreatedWithinLastXHours: number
): Promise<UserProfile[]> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot fetch recent onboardings', {
        hours: userCreatedWithinLastXHours
      });
      return [];
    }

    if (userCreatedWithinLastXHours <= 0) {
      glowLogger.warn('userCreatedWithinLastXHours must be > 0', {
        hours: userCreatedWithinLastXHours
      });
      return [];
    }

    const cutoffISO = new Date(Date.now() - userCreatedWithinLastXHours * 60 * 60 * 1000).toISOString();

    glowLogger.info('Querying recent onboardings', {
      hours: userCreatedWithinLastXHours,
      cutoff_iso: cutoffISO
    });

    const { data, error } = await supabase
      .from('user_profile')
      .select('*')
      .gte('created_at', cutoffISO)
      .order('created_at', { ascending: false });

    if (error) {
      glowLogger.error('Error fetching recent onboardings', {
        error: error.message || String(error),
        hours: userCreatedWithinLastXHours
      });
      throw error;
    }

    if (!data || data.length === 0) {
      glowLogger.info('No recent onboardings found', {
        hours: userCreatedWithinLastXHours
      });
      return [];
    }

    const recentProfiles: UserProfile[] = data.map((row: any) => {
      let parsedOnboard: Onboard | undefined;
      if (row.onboarding_profile_json) {
        try {
          parsedOnboard = JSON.parse(row.onboarding_profile_json);
        } catch (parseError) {
          glowLogger.error('Error parsing onboarding profile JSON for recent onboarding user', {
            user_id: row.user_id,
            error: parseError instanceof Error ? parseError.message : String(parseError)
          });
        }
      }
      return {
        user_id: row.user_id,
        display_name: row.display_name,
        onboarding_profile_json: row.onboarding_profile_json,
        onboarding_profile_ai_gen_json: row.onboarding_profile_ai_gen_json,
        timezone: row.timezone || getCurrentTimezone(),
        expoPushToken: row.expo_push_token,
        device_type: row.device_type,
        active: row.active,
        is_coach: !!row.is_coach,
        created_at: row.created_at,
        onboardingProfile: parsedOnboard
      };
    });

    // Ensure timezone fallback
    for (const profile of recentProfiles) {
      if (!profile.timezone) {
        profile.timezone = getCurrentTimezone();
      }
    }

    glowLogger.info('Recent onboardings fetched successfully', {
      hours: userCreatedWithinLastXHours,
      count: recentProfiles.length
    });

    return recentProfiles;
  } catch (error) {
    glowLogger.error('Failed to fetch recent onboardings', {
      error: error instanceof Error ? error.message : String(error),
      hours: userCreatedWithinLastXHours
    });
    return [];
  }
};

// Coach data type for app use.
// NOTE: `full_name` is nullable in the DB; callers MUST handle null/empty.
export interface CoachData {
  id: number;
  coach_name: string | null;
  full_name: string | null;
  coach_type: CoachType;
  // Image path derived from id and full_name: assets/images/coaches/<id>_<full_name lowercase>.png
}

// Normalize the DB `coach_type` value to the CoachType enum, defaulting to
// AI_ONLY for unknown/missing values so a bad row cannot break onboarding.
const normalizeCoachType = (value: unknown): CoachType => {
  return value === CoachType.AI_HUMAN_HYBRID ? CoachType.AI_HUMAN_HYBRID : CoachType.AI_ONLY;
};

export type SpecialCodeType = 'coach' | 'event' | 'promo';

export interface ValidatedSpecialCode {
  codeType: SpecialCodeType;
  code: string; // normalized code the user entered (lowercased/trimmed)
  coachId?: number;
  metadata?: Record<string, unknown>;
}

const normalizeSpecialCodeInput = (code: string): string =>
  code.trim().toLowerCase();

// Validate a pre-auth special code (coach / event / promo onboarding entry).
export const validateSpecialCode = async (
  code: string
): Promise<ValidatedSpecialCode | null> => {
  const normalized = normalizeSpecialCodeInput(code);
  if (!normalized) {
    return null;
  }

  glowLogger.info('=== validateSpecialCode START ===', { code_length: normalized.length });

  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot validate special code', {});
      return null;
    }

    const { data, error } = await supabase
      .from('special_codes')
      .select('code_type, coach_id, metadata, expires_at')
      .eq('code', normalized)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      glowLogger.error('Error validating special code', {
        error: error.message || String(error),
      });
      return null;
    }

    if (!data) {
      glowLogger.info('Special code not found or inactive', {});
      return null;
    }

    if (data.expires_at && new Date(data.expires_at) <= new Date()) {
      glowLogger.info('Special code expired', { expires_at: data.expires_at });
      return null;
    }

    const codeType = data.code_type as SpecialCodeType;
    if (codeType !== 'coach' && codeType !== 'event' && codeType !== 'promo') {
      glowLogger.warn('Unknown special code type', { code_type: data.code_type });
      return null;
    }

    const result: ValidatedSpecialCode = {
      codeType,
      code: normalized,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
    };

    if (codeType === 'coach' && data.coach_id != null) {
      result.coachId = data.coach_id;
    }

    glowLogger.info('=== validateSpecialCode SUCCESS ===', {
      code_type: codeType,
      coach_id: result.coachId != null ? String(result.coachId) : 'none',
    });

    return result;
  } catch (error) {
    glowLogger.error('Failed to validate special code', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

// Get all coaches from the database
export const getCoaches = async (): Promise<CoachData[]> => {
  glowLogger.info('=== getCoaches START ===', {});
  
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot fetch coaches', {});
      return [];
    }

    const { data: coaches, error } = await supabase
      .from('coaches')
      .select('id, coach_name, full_name, coach_type')
      .order('full_name');

    if (error) {
      glowLogger.error('Error fetching coaches', {
        error: error.message || String(error)
      });
      return [];
    }

    if (!coaches || coaches.length === 0) {
      glowLogger.warn('No coaches found in database', {});
      return [];
    }

    const normalized: CoachData[] = coaches.map((c: { id: number; coach_name: string | null; full_name: string | null; coach_type: string | null }) => ({
      id: c.id,
      coach_name: c.coach_name,
      full_name: c.full_name,
      coach_type: normalizeCoachType(c.coach_type),
    }));

    glowLogger.info('=== getCoaches SUCCESS ===', {
      coach_count: normalized.length,
      coaches: normalized.map(c => ({ id: c.id, full_name: c.full_name, coach_type: c.coach_type }))
    });

    return normalized;
  } catch (error) {
    glowLogger.error('Failed to get coaches', {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
};

// Assign user to a coach in the coach_user table using coach ID
export const assignUserToCoach = async (userId: string, coachId: number, coachName?: string): Promise<void> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, skipping coach assignment', {
        user_id: userId,
        coach_id: coachId
      });
      return;
    }

    glowLogger.info('Assigning user to coach', {
      user_id: userId,
      coach_id: String(coachId),
      coach_name: coachName || 'unknown'
    });

    // Insert the coach-user mapping using the coach ID directly
    // Ensure coachId is a proper integer for the database
    // Insert the live assignment row. plan_tier_id is left NULL (= ai_only); the coach
    // dashboard sets a real tier when upgrading the user. The partial unique index on
    // (user_id) WHERE is_current keeps this to one live row, so a repeat onboarding insert
    // surfaces as a duplicate-key (23505) and is handled gracefully below.
    const insertData = {
      coach_id: Number(coachId),
      user_id: userId,
      is_current: true
    };
    
    glowLogger.info('Inserting coach_user record', {
      insert_data: JSON.stringify(insertData)
    });
    
    const { data, error } = await supabase
      .from('coach_user')
      .insert(insertData)
      .select();

    if (error) {
      // Check if it's a duplicate key error (user already assigned to this coach)
      if (error.code === '23505') {
        glowLogger.info('User already assigned to this coach', {
          user_id: userId,
          coach_id: String(coachId)
        });
        return;
      }
      // Check for RLS policy violation
      if (error.code === '42501' || error.message?.includes('policy')) {
        glowLogger.error('RLS policy violation - coach_user insert denied', {
          error: error.message || String(error),
          error_code: error.code || 'unknown',
          error_hint: error.hint || 'Check that anon role has INSERT permission on coach_user table',
          user_id: userId,
          coach_id: String(coachId)
        });
        return; // Don't throw - graceful failure
      }
      glowLogger.error('Error assigning user to coach', {
        error: error.message || String(error),
        error_code: error.code || 'unknown',
        error_details: error.details || 'none',
        error_hint: error.hint || 'none',
        user_id: userId,
        coach_id: String(coachId)
      });
      throw error;
    }

    glowLogger.info('User assigned to coach successfully', {
      user_id: userId,
      coach_id: String(coachId),
      assignment_id: String(data?.[0]?.id ?? 'unknown')
    });
  } catch (error) {
    glowLogger.error('Failed to assign user to coach (exception)', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      coach_id: String(coachId)
    });
    // Don't throw - we don't want coach assignment failure to break onboarding
  }
};

// Get coach ID for a user from coach_user table
export const getCoachIdForUser = async (userId: string): Promise<number | null> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot fetch coach ID', {});
      return null;
    }

    // coach_user is an append-only log; only the row with is_current = true is the live assignment.
    const { data: coachUser, error } = await supabase
      .from('coach_user')
      .select('coach_id')
      .eq('user_id', userId)
      .eq('is_current', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        glowLogger.info('No coach assigned to user', { user_id: userId });
        return null;
      }
      glowLogger.error('Error fetching coach ID for user', {
        error: error.message || String(error),
        user_id: userId
      });
      return null;
    }

    if (!coachUser || !coachUser.coach_id) {
      glowLogger.warn('No coach ID found for user', { user_id: userId });
      return null;
    }

    glowLogger.info('Coach ID fetched successfully', { 
      user_id: userId,
      coach_id: String(coachUser.coach_id)
    });
    
    return coachUser.coach_id;
  } catch (error) {
    glowLogger.error('Failed to get coach ID for user', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return null;
  }
};

// Get coach email by coach ID
export const getCoachEmailById = async (coachId: number): Promise<string | null> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot fetch coach email', {});
      return null;
    }

    const { data: coach, error } = await supabase
      .from('coaches')
      .select('email')
      .eq('id', coachId)
      .single();

    if (error) {
      glowLogger.error('Error fetching coach email', {
        error: error.message || String(error),
        coach_id: String(coachId)
      });
      return null;
    }

    if (!coach || !coach.email) {
      glowLogger.warn('Coach not found or no email', { coach_id: String(coachId) });
      return null;
    }

    glowLogger.info('Coach email fetched successfully', { 
      coach_id: String(coachId),
      email_preview: coach.email.substring(0, 3) + '***'
    });
    
    return coach.email;
  } catch (error) {
    glowLogger.error('Failed to get coach email', {
      error: error instanceof Error ? error.message : String(error),
      coach_id: String(coachId)
    });
    return null;
  }
};

// Get the live coach_type for a coach straight from the `coaches` table.
// This is the source of truth for human-chat gating — never hardcode which
// coaches are hybrid. Defaults to AI_ONLY (fail closed) on any error/missing row.
export const getCoachTypeById = async (coachId: number): Promise<CoachType> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot fetch coach_type', {});
      return CoachType.AI_ONLY;
    }

    const { data: coach, error } = await supabase
      .from('coaches')
      .select('coach_type')
      .eq('id', coachId)
      .maybeSingle();

    if (error) {
      glowLogger.error('Error fetching coach_type', {
        error: error.message || String(error),
        coach_id: String(coachId)
      });
      return CoachType.AI_ONLY;
    }

    if (!coach) {
      glowLogger.warn('Coach not found when fetching coach_type', { coach_id: String(coachId) });
      return CoachType.AI_ONLY;
    }

    const coachType = normalizeCoachType(coach.coach_type);
    glowLogger.info('Coach type fetched successfully', {
      coach_id: String(coachId),
      coach_type: coachType
    });
    return coachType;
  } catch (error) {
    glowLogger.error('Failed to get coach_type', {
      error: error instanceof Error ? error.message : String(error),
      coach_id: String(coachId)
    });
    return CoachType.AI_ONLY;
  }
};

// Get coach email for a user (looks up via coach_user table)
export const getCoachEmailForUser = async (userId: string): Promise<string | null> => {
  try {
    const coachId = await getCoachIdForUser(userId);
    if (!coachId) {
      return null;
    }
    return await getCoachEmailById(coachId);
  } catch (error) {
    glowLogger.error('Failed to get coach email for user', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return null;
  }
};

// Get the user's current coaching plan tier (the live coach_user row).
// Returns { key, displayName } or null when no tier is set (treat null as 'ai_only').
export const getCurrentPlanTierForUser = async (
  userId: string
): Promise<{ key: string; displayName: string } | null> => {
  try {
    if (!supabase) {
      glowLogger.warn('Supabase not initialized, cannot fetch plan tier', {});
      return null;
    }

    const { data, error } = await supabase
      .from('coach_user')
      .select('plan_tiers ( key, display_name )')
      .eq('user_id', userId)
      .eq('is_current', true)
      .maybeSingle();

    if (error) {
      glowLogger.error('Error fetching plan tier for user', {
        error: error.message || String(error),
        user_id: userId
      });
      return null;
    }

    // Supabase types the embedded relation loosely; normalize to a single object.
    const tier = Array.isArray((data as any)?.plan_tiers)
      ? (data as any)?.plan_tiers?.[0]
      : (data as any)?.plan_tiers;
    if (!tier?.key) {
      return null;
    }

    return { key: tier.key as string, displayName: (tier.display_name as string) ?? tier.key };
  } catch (error) {
    glowLogger.error('Failed to get plan tier for user', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return null;
  }
};

// Export supabase client for use in other modules
export { supabase };
