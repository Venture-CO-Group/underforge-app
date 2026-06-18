import AsyncStorage from '@react-native-async-storage/async-storage';
import { Onboard } from '../types/onboard';
import { DeviceType } from '../types/user_profile';
import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import { assignUserToCoach, saveUserProfile } from './supabase_db_new';

const SYNC_STATUS_KEY = 'needsProfileSync';
const PENDING_PROFILE_KEY = 'pendingProfileData';
const LOCAL_ONBOARDING_KEY = 'localOnboardingData';
const PENDING_BODY_COMPOSITION_KEY = 'pendingBodyCompositionData';
const PENDING_MEAL_LOG_KEY = 'pendingMealLogData';
const CACHED_ACCOUNT_STATUS_KEY = 'cachedAccountStatus';
const ACCOUNT_STATUS_LAST_CHECK_KEY = 'accountStatusLastCheck';

export interface PendingProfileData {
  user_id: string;
  display_name: string;
  onboardingProfile: any;
  expoPushToken: string | null;
  device_type: string;
  active: boolean;
  auth_user_id?: string;
  email?: string;
  signup_code?: string | null;
}

/**
 * Check if profile sync is needed
 */
export const needsProfileSync = async (): Promise<boolean> => {
  try {
    const value = await AsyncStorage.getItem(SYNC_STATUS_KEY);
    return value === 'true';
  } catch (error) {
    return false;
  }
};

/**
 * Set profile sync status
 */
export const setNeedsProfileSync = async (needsSync: boolean): Promise<void> => {
  try {
    if (needsSync) {
      await AsyncStorage.setItem(SYNC_STATUS_KEY, 'true');
    } else {
      await AsyncStorage.removeItem(SYNC_STATUS_KEY);
      await AsyncStorage.removeItem(PENDING_PROFILE_KEY);
    }
  } catch (error) {
    // Silently fail - not critical
  }
};

/**
 * Store pending profile data for retry
 */
export const storePendingProfile = async (profileData: PendingProfileData): Promise<void> => {
  try {
    await AsyncStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify(profileData));
    await AsyncStorage.setItem(SYNC_STATUS_KEY, 'true');
  } catch (error) {
    // Silently fail - not critical
  }
};

/**
 * Get pending profile data
 */
export const getPendingProfile = async (): Promise<PendingProfileData | null> => {
  try {
    const value = await AsyncStorage.getItem(PENDING_PROFILE_KEY);
    if (value) {
      return JSON.parse(value);
    }
    return null;
  } catch (error) {
    return null;
  }
};

/**
 * Store onboarding data locally for offline access
 */
export const storeLocalOnboardingData = async (onboardingData: Onboard): Promise<void> => {
  try {
    await AsyncStorage.setItem(LOCAL_ONBOARDING_KEY, JSON.stringify(onboardingData));
    glowLogger.info('Onboarding data stored locally', {
      user_name: onboardingData.name,
      local_user_id: onboardingData.localUserId || 'not_set'
    });
  } catch (error) {
    glowLogger.error('Failed to store onboarding data locally', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Get locally stored onboarding data
 */
export const getLocalOnboardingData = async (): Promise<Onboard | null> => {
  try {
    const value = await AsyncStorage.getItem(LOCAL_ONBOARDING_KEY);
    if (value) {
      const data = JSON.parse(value) as Onboard;
      glowLogger.info('Loaded onboarding data from local storage', {
        user_name: data.name,
        local_user_id: data.localUserId || 'not_set'
      });
      return data;
    }
    return null;
  } catch (error) {
    glowLogger.error('Failed to load local onboarding data', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};

/**
 * Fast offline path: read cached onboarding from AsyncStorage, then fall back to
 * pendingProfile (profile that failed to upload to Supabase). Does not use network.
 */
export const resolveCachedOnboardingProfile = async (
  localUserId: string,
): Promise<Onboard | null> => {
  const fromCache = await getLocalOnboardingData();
  if (fromCache) {
    if (fromCache.localUserId && fromCache.localUserId !== localUserId) {
      glowLogger.warn('Cached onboarding belongs to a different user, skipping', {
        cached_user_id: fromCache.localUserId,
        expected_user_id: localUserId,
      });
    } else {
      return { ...fromCache, localUserId: fromCache.localUserId || localUserId };
    }
  }

  const pending = await getPendingProfile();
  if (pending?.user_id === localUserId && pending.onboardingProfile) {
    const fromPending = pending.onboardingProfile as Onboard;
    const merged = { ...fromPending, localUserId: fromPending.localUserId || localUserId };
    glowLogger.info('Using pendingProfile onboarding as local fallback', {
      user_id: localUserId,
      user_name: merged.name,
    });
    await storeLocalOnboardingData(merged).catch(() => {});
    return merged;
  }

  return null;
};

/**
 * Clear locally stored onboarding data (e.g., on logout)
 */
export const clearLocalOnboardingData = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(LOCAL_ONBOARDING_KEY);
    glowLogger.info('Local onboarding data cleared', {});
  } catch (error) {
    // Silently fail - not critical
  }
};

/**
 * Retry profile sync with exponential backoff
 */
export const retryProfileSync = async (
  pendingProfile: PendingProfileData,
  setSyncStatus?: (status: 'idle' | 'syncing' | 'success' | 'failed') => void,
  maxRetries: number = 3
): Promise<void> => {
  if (setSyncStatus) setSyncStatus('syncing');
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const userProfileArgs: any = {
        user_id: pendingProfile.user_id,
        display_name: pendingProfile.display_name,
        onboardingProfile: pendingProfile.onboardingProfile,
        expoPushToken: pendingProfile.expoPushToken,
        device_type: pendingProfile.device_type as DeviceType,
        active: pendingProfile.active
      };
      
      // Include auth info if available
      if (pendingProfile.auth_user_id) {
        userProfileArgs.auth_user_id = pendingProfile.auth_user_id;
      }
      if (pendingProfile.email) {
        userProfileArgs.email = pendingProfile.email;
      }
      if (pendingProfile.signup_code !== undefined) {
        userProfileArgs.signup_code = pendingProfile.signup_code;
      }
      
      await saveUserProfile(userProfileArgs, true);
      
      // Success - clear sync status
      await setNeedsProfileSync(false);
      if (setSyncStatus) {
        setSyncStatus('success');
        // Auto-dismiss success after 2 seconds
        setTimeout(() => setSyncStatus('idle'), 2000);
      }
      
      glowLogger.info('Profile sync retry succeeded', {
        user_id: pendingProfile.user_id,
        attempt: attempt + 1
      });
      
      // Also assign coach if needed
      const coachId = pendingProfile.onboardingProfile?.coachId;
      if (coachId) {
        try {
          await assignUserToCoach(
            pendingProfile.user_id,
            coachId,
            pendingProfile.onboardingProfile?.selectedCoach
          );
        } catch (coachError) {
          glowLogger.warn('Failed to assign coach during retry', {
            error: coachError instanceof Error ? coachError.message : String(coachError)
          });
        }
      }
      
      return;
    } catch (error) {
      glowLogger.error(`Profile sync retry attempt ${attempt + 1} failed`, {
        error: error instanceof Error ? error.message : String(error),
        user_id: pendingProfile.user_id
      });
      
      if (attempt === maxRetries) {
        // All retries failed
        if (setSyncStatus) setSyncStatus('failed');
        return;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = 1000 * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// ============================================
// Body Composition Sync Functions
// ============================================

export interface PendingBodyCompositionData {
  user_id: string;
  log_date: string;
  week_number: number;
  year: number;
  weight_value: number;
  weight_unit: string;
  muscle_percent: number;
  fat_percent: number;
  photo_front_url?: string;
  photo_side_url?: string;
  photo_back_url?: string;
  timestamp: number; // When it was first attempted
}

/**
 * Store pending body composition data for retry
 */
export const storePendingBodyComposition = async (data: PendingBodyCompositionData): Promise<void> => {
  try {
    const key = `${PENDING_BODY_COMPOSITION_KEY}_${data.user_id}_${data.week_number}_${data.year}`;
    await AsyncStorage.setItem(key, JSON.stringify(data));
    glowLogger.info('Stored pending body composition for retry', {
      user_id: data.user_id,
      week: data.week_number,
      year: data.year
    });
  } catch (error) {
    glowLogger.error('Failed to store pending body composition', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Get all pending body composition entries
 */
export const getPendingBodyCompositions = async (): Promise<PendingBodyCompositionData[]> => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const bodyCompKeys = allKeys.filter(key => key.startsWith(PENDING_BODY_COMPOSITION_KEY));
    
    if (bodyCompKeys.length === 0) {
      return [];
    }

    const entries = await AsyncStorage.multiGet(bodyCompKeys);
    const pendingData: PendingBodyCompositionData[] = [];

    for (const [key, value] of entries) {
      if (value) {
        try {
          pendingData.push(JSON.parse(value));
        } catch (error) {
          glowLogger.error('Failed to parse pending body composition', { key });
        }
      }
    }

    return pendingData;
  } catch (error) {
    glowLogger.error('Failed to get pending body compositions', {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
};

/**
 * Remove a pending body composition entry after successful sync
 */
export const removePendingBodyComposition = async (
  userId: string,
  weekNumber: number,
  year: number
): Promise<void> => {
  try {
    const key = `${PENDING_BODY_COMPOSITION_KEY}_${userId}_${weekNumber}_${year}`;
    await AsyncStorage.removeItem(key);
    glowLogger.info('Removed pending body composition after successful sync', {
      user_id: userId,
      week: weekNumber,
      year
    });
  } catch (error) {
    glowLogger.error('Failed to remove pending body composition', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Retry all pending body composition syncs
 */
export const retryPendingBodyCompositions = async (): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> => {
  const pendingEntries = await getPendingBodyCompositions();
  
  if (pendingEntries.length === 0) {
    return { total: 0, succeeded: 0, failed: 0 };
  }

  glowLogger.info('Retrying pending body composition syncs', {
    count: pendingEntries.length
  });

  let succeeded = 0;
  let failed = 0;

  // Import here to avoid circular dependency
  const { createClient } = await import('@supabase/supabase-js');
  const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    glowLogger.warn('Cannot retry body composition sync - Supabase not configured');
    return { total: pendingEntries.length, succeeded: 0, failed: pendingEntries.length };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  for (const entry of pendingEntries) {
    try {
      const { error } = await supabase
        .from('body_composition_log')
        .upsert({
          user_id: entry.user_id,
          log_date: entry.log_date,
          week_number: entry.week_number,
          year: entry.year,
          weight_value: entry.weight_value,
          weight_unit: entry.weight_unit,
          muscle_percent: entry.muscle_percent,
          fat_percent: entry.fat_percent,
          // Only include photo columns when present, so a retry never overwrites
          // an existing remote photo with null (matches saveBodyCompositionLog).
          ...(entry.photo_front_url ? { photo_front_url: entry.photo_front_url } : {}),
          ...(entry.photo_side_url ? { photo_side_url: entry.photo_side_url } : {}),
          ...(entry.photo_back_url ? { photo_back_url: entry.photo_back_url } : {}),
        }, {
          onConflict: 'user_id,week_number,year'
        });

      if (!error) {
        succeeded++;
        await removePendingBodyComposition(entry.user_id, entry.week_number, entry.year);
        glowLogger.info('Pending body composition synced successfully', {
          user_id: entry.user_id,
          week: entry.week_number,
          year: entry.year
        });
      } else {
        failed++;
        glowLogger.warn('Pending body composition sync failed', {
          user_id: entry.user_id,
          week: entry.week_number,
          year: entry.year,
          error: error.message
        });
      }
    } catch (error) {
      failed++;
      glowLogger.error('Exception during pending body composition sync', {
        user_id: entry.user_id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  glowLogger.info('Completed pending body composition sync retry', {
    total: pendingEntries.length,
    succeeded,
    failed
  });

  return { total: pendingEntries.length, succeeded, failed };
};

// ============================================
// Meal Log Sync Functions
// ============================================

export interface PendingMealLogData {
  local_id: number;
  user_id: string;
  log_date: string;
  meal_description: string;
  carbs_grams: number;
  protein_grams: number;
  fat_grams: number;
  fiber_grams: number;
  calories: number;
  food_quantities?: string;
  food_item_macros?: unknown;
  logged_at: string;
  timestamp: number; // When it was first attempted
}

/**
 * Store pending meal log data for retry
 */
export const storePendingMealLog = async (data: PendingMealLogData): Promise<void> => {
  try {
    const key = `${PENDING_MEAL_LOG_KEY}_${data.user_id}_${data.local_id}`;
    await AsyncStorage.setItem(key, JSON.stringify(data));
    glowLogger.info('Stored pending meal log for retry', {
      user_id: data.user_id,
      local_id: data.local_id,
      meal: data.meal_description
    });
  } catch (error) {
    glowLogger.error('Failed to store pending meal log', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Get all pending meal log entries
 */
export const getPendingMealLogs = async (): Promise<PendingMealLogData[]> => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const mealLogKeys = allKeys.filter(key => key.startsWith(PENDING_MEAL_LOG_KEY));
    
    if (mealLogKeys.length === 0) {
      return [];
    }

    const entries = await AsyncStorage.multiGet(mealLogKeys);
    const pendingData: PendingMealLogData[] = [];

    for (const [key, value] of entries) {
      if (value) {
        try {
          pendingData.push(JSON.parse(value));
        } catch (error) {
          glowLogger.error('Failed to parse pending meal log', { key });
        }
      }
    }

    return pendingData;
  } catch (error) {
    glowLogger.error('Failed to get pending meal logs', {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
};

/**
 * Remove a pending meal log entry after successful sync
 */
export const removePendingMealLog = async (
  userId: string,
  localId: number
): Promise<void> => {
  try {
    const key = `${PENDING_MEAL_LOG_KEY}_${userId}_${localId}`;
    await AsyncStorage.removeItem(key);
    glowLogger.info('Removed pending meal log after successful sync', {
      user_id: userId,
      local_id: localId
    });
  } catch (error) {
    glowLogger.error('Failed to remove pending meal log', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Retry all pending meal log syncs
 */
export const retryPendingMealLogs = async (): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> => {
  const pendingEntries = await getPendingMealLogs();
  
  if (pendingEntries.length === 0) {
    return { total: 0, succeeded: 0, failed: 0 };
  }

  glowLogger.info('Retrying pending meal log syncs', {
    count: pendingEntries.length
  });

  let succeeded = 0;
  let failed = 0;

  // Import here to avoid circular dependency
  const { createClient } = await import('@supabase/supabase-js');
  const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    glowLogger.warn('Cannot retry meal log sync - Supabase not configured');
    return { total: pendingEntries.length, succeeded: 0, failed: pendingEntries.length };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  for (const entry of pendingEntries) {
    try {
      const insertPayload: Record<string, unknown> = {
          user_id: entry.user_id,
          log_date: entry.log_date,
          meal_description: entry.meal_description,
          carbs_grams: entry.carbs_grams,
          protein_grams: entry.protein_grams,
          fat_grams: entry.fat_grams,
          fiber_grams: entry.fiber_grams,
          calories: entry.calories,
        };
      if (entry.food_quantities) {
        insertPayload.food_quantities = entry.food_quantities;
      }
      if (entry.food_item_macros) {
        insertPayload.food_item_macros = entry.food_item_macros;
      }
      const { data, error } = await supabase
        .from('meal_logs')
        .insert(insertPayload)
        .select('id')
        .single();

      if (!error && data) {
        succeeded++;
        // Update local SQLite record with supabase_id and mark as synced
        try {
          const db = getDatabase();
          await db.runAsync(
            'UPDATE meal_logs SET supabase_id = ?, synced = 1 WHERE id = ?',
            [data.id, entry.local_id]
          );
        } catch (dbErr) {
          glowLogger.warn('Failed to update local meal log after sync', {
            local_id: entry.local_id,
            error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          });
        }
        // Update daily nutrition totals in Supabase
        try {
          const { updateDailyTotals } = await import('./nutrition-storage');
          await updateDailyTotals(entry.user_id);
        } catch (totalsErr) {
          glowLogger.warn('Failed to update daily totals after meal log sync', {
            error: totalsErr instanceof Error ? totalsErr.message : String(totalsErr),
          });
        }
        await removePendingMealLog(entry.user_id, entry.local_id);
        glowLogger.info('Pending meal log synced successfully', {
          user_id: entry.user_id,
          local_id: entry.local_id,
          supabase_id: data.id
        });
      } else {
        failed++;
        glowLogger.warn('Pending meal log sync failed', {
          user_id: entry.user_id,
          local_id: entry.local_id,
          error: error?.message
        });
      }
    } catch (error) {
      failed++;
      glowLogger.error('Exception during pending meal log sync', {
        user_id: entry.user_id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  glowLogger.info('Completed pending meal log sync retry', {
    total: pendingEntries.length,
    succeeded,
    failed
  });

  return { total: pendingEntries.length, succeeded, failed };
};

// ============================================
// Meal Deletion Sync Functions
// ============================================

const PENDING_MEAL_DELETION_KEY = 'pendingMealDeletion';

export interface PendingMealDeletionData {
  supabase_id: number;
  user_id: string;
  log_date: string;
  timestamp: number;
}

export const storePendingMealDeletion = async (data: PendingMealDeletionData): Promise<void> => {
  try {
    const key = `${PENDING_MEAL_DELETION_KEY}_${data.user_id}_${data.supabase_id}`;
    await AsyncStorage.setItem(key, JSON.stringify(data));
    glowLogger.info('Stored pending meal deletion for retry', {
      user_id: data.user_id,
      supabase_id: data.supabase_id,
    });
  } catch (error) {
    glowLogger.error('Failed to store pending meal deletion', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getPendingMealDeletions = async (): Promise<PendingMealDeletionData[]> => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const deletionKeys = allKeys.filter(key => key.startsWith(PENDING_MEAL_DELETION_KEY));

    if (deletionKeys.length === 0) return [];

    const entries = await AsyncStorage.multiGet(deletionKeys);
    const pending: PendingMealDeletionData[] = [];

    for (const [, value] of entries) {
      if (value) {
        try { pending.push(JSON.parse(value)); } catch { /* skip corrupt */ }
      }
    }
    return pending;
  } catch (error) {
    glowLogger.error('Failed to get pending meal deletions', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

const removePendingMealDeletion = async (userId: string, supabaseId: number): Promise<void> => {
  try {
    const key = `${PENDING_MEAL_DELETION_KEY}_${userId}_${supabaseId}`;
    await AsyncStorage.removeItem(key);
  } catch (error) {
    glowLogger.warn('Failed to remove pending meal deletion key', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const retryPendingMealDeletions = async (): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> => {
  const pendingEntries = await getPendingMealDeletions();

  if (pendingEntries.length === 0) {
    return { total: 0, succeeded: 0, failed: 0 };
  }

  glowLogger.info('Retrying pending meal deletions', { count: pendingEntries.length });

  const { createClient } = await import('@supabase/supabase-js');
  const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { total: pendingEntries.length, succeeded: 0, failed: pendingEntries.length };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let succeeded = 0;
  let failed = 0;

  for (const entry of pendingEntries) {
    try {
      const { error } = await supabase
        .from('meal_logs')
        .delete()
        .eq('id', entry.supabase_id)
        .eq('user_id', entry.user_id);

      if (!error) {
        succeeded++;
        await removePendingMealDeletion(entry.user_id, entry.supabase_id);
        try {
          const { updateDailyTotals } = await import('./nutrition-storage');
          await updateDailyTotals(entry.user_id, entry.log_date);
        } catch { /* non-critical */ }
      } else {
        failed++;
        glowLogger.warn('Pending meal deletion failed', { error: error.message });
      }
    } catch (error) {
      failed++;
      glowLogger.error('Exception during pending meal deletion retry', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  glowLogger.info('Completed pending meal deletion retry', { total: pendingEntries.length, succeeded, failed });
  return { total: pendingEntries.length, succeeded, failed };
};

// ============================================
// Workout Deletion Sync Functions
// ============================================

const PENDING_WORKOUT_DELETION_KEY = 'pendingWorkoutDeletion';

export interface PendingWorkoutDeletionData {
  supabase_id: number;
  user_id: string;
  timestamp: number;
}

export const storePendingWorkoutDeletion = async (data: PendingWorkoutDeletionData): Promise<void> => {
  try {
    const key = `${PENDING_WORKOUT_DELETION_KEY}_${data.user_id}_${data.supabase_id}`;
    await AsyncStorage.setItem(key, JSON.stringify(data));
    glowLogger.info('Stored pending workout deletion for retry', {
      user_id: data.user_id,
      supabase_id: data.supabase_id,
    });
  } catch (error) {
    glowLogger.error('Failed to store pending workout deletion', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getPendingWorkoutDeletions = async (): Promise<PendingWorkoutDeletionData[]> => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const deletionKeys = allKeys.filter(key => key.startsWith(PENDING_WORKOUT_DELETION_KEY));

    if (deletionKeys.length === 0) return [];

    const entries = await AsyncStorage.multiGet(deletionKeys);
    const pending: PendingWorkoutDeletionData[] = [];

    for (const [, value] of entries) {
      if (value) {
        try {
          pending.push(JSON.parse(value));
        } catch {
          /* skip corrupt */
        }
      }
    }
    return pending;
  } catch (error) {
    glowLogger.error('Failed to get pending workout deletions', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

const removePendingWorkoutDeletion = async (userId: string, supabaseId: number): Promise<void> => {
  try {
    const key = `${PENDING_WORKOUT_DELETION_KEY}_${userId}_${supabaseId}`;
    await AsyncStorage.removeItem(key);
  } catch (error) {
    glowLogger.warn('Failed to remove pending workout deletion key', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const retryPendingWorkoutDeletions = async (): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> => {
  const pendingEntries = await getPendingWorkoutDeletions();

  if (pendingEntries.length === 0) {
    return { total: 0, succeeded: 0, failed: 0 };
  }

  glowLogger.info('Retrying pending workout deletions', { count: pendingEntries.length });

  const { createClient } = await import('@supabase/supabase-js');
  const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { total: pendingEntries.length, succeeded: 0, failed: pendingEntries.length };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let succeeded = 0;
  let failed = 0;

  for (const entry of pendingEntries) {
    try {
      const { error } = await supabase
        .from('workout_logs')
        .delete()
        .eq('id', entry.supabase_id)
        .eq('user_id', entry.user_id);

      if (!error) {
        succeeded++;
        await removePendingWorkoutDeletion(entry.user_id, entry.supabase_id);
      } else {
        failed++;
        glowLogger.warn('Pending workout deletion failed', { error: error.message });
      }
    } catch (error) {
      failed++;
      glowLogger.error('Exception during pending workout deletion retry', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  glowLogger.info('Completed pending workout deletion retry', {
    total: pendingEntries.length,
    succeeded,
    failed,
  });
  return { total: pendingEntries.length, succeeded, failed };
};

// ============================================
// Workout Log Sync Functions
// ============================================

const PENDING_WORKOUT_LOG_KEY = 'pendingWorkoutLogData';
const PENDING_WORKOUT_EXERCISE_LOG_KEY = 'pendingWorkoutExerciseLogData';

export interface PendingWorkoutLogData {
  localId: number;
  userId: string;
  workoutDate: string;
  workoutDayName: string;
  stepId?: string;
  status: string;
  timestamp: number;
}

export interface PendingWorkoutExerciseLogData {
  localId: number;
  workoutLogId: number;
  exerciseId: string;
  exerciseName: string;
  setNumber: number;
  weightValue?: number;
  weightUnit?: string;
  reps?: number;
  restTimeSeconds?: number;
  rir?: number;
  difficultyPerception?: number;
  comments?: string;
  caloriesBurned?: number;
  timestamp: number;
}

/**
 * Store pending workout log data for retry
 */
export const storePendingWorkoutLog = async (data: PendingWorkoutLogData): Promise<void> => {
  try {
    const key = `${PENDING_WORKOUT_LOG_KEY}_${data.localId}`;
    await AsyncStorage.setItem(key, JSON.stringify(data));
    glowLogger.info('Stored pending workout log for retry', {
      local_id: data.localId,
      user_id: data.userId,
      workout_day_name: data.workoutDayName
    });
  } catch (error) {
    glowLogger.error('Failed to store pending workout log', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Get all pending workout log entries
 */
export const getPendingWorkoutLogs = async (): Promise<PendingWorkoutLogData[]> => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const workoutLogKeys = allKeys.filter(key => key.startsWith(PENDING_WORKOUT_LOG_KEY));
    
    if (workoutLogKeys.length === 0) {
      return [];
    }

    const entries = await AsyncStorage.multiGet(workoutLogKeys);
    const pendingData: PendingWorkoutLogData[] = [];

    for (const [key, value] of entries) {
      if (value) {
        try {
          pendingData.push(JSON.parse(value));
        } catch (error) {
          glowLogger.error('Failed to parse pending workout log', { key });
        }
      }
    }

    return pendingData;
  } catch (error) {
    glowLogger.error('Failed to get pending workout logs', {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
};

/**
 * Remove a pending workout log entry after successful sync
 */
export const removePendingWorkoutLog = async (localId: number): Promise<void> => {
  try {
    const key = `${PENDING_WORKOUT_LOG_KEY}_${localId}`;
    await AsyncStorage.removeItem(key);
    glowLogger.info('Removed pending workout log after successful sync', { local_id: localId });
  } catch (error) {
    glowLogger.error('Failed to remove pending workout log', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Store pending workout exercise log data for retry
 */
export const storePendingWorkoutExerciseLog = async (data: PendingWorkoutExerciseLogData): Promise<void> => {
  try {
    const key = `${PENDING_WORKOUT_EXERCISE_LOG_KEY}_${data.localId}`;
    await AsyncStorage.setItem(key, JSON.stringify(data));
    glowLogger.info('Stored pending workout exercise log for retry', {
      local_id: data.localId,
      exercise_id: data.exerciseId,
      set_number: data.setNumber
    });
  } catch (error) {
    glowLogger.error('Failed to store pending workout exercise log', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Get all pending workout exercise log entries
 */
export const getPendingWorkoutExerciseLogs = async (): Promise<PendingWorkoutExerciseLogData[]> => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const exerciseLogKeys = allKeys.filter(key => key.startsWith(PENDING_WORKOUT_EXERCISE_LOG_KEY));
    
    if (exerciseLogKeys.length === 0) {
      return [];
    }

    const entries = await AsyncStorage.multiGet(exerciseLogKeys);
    const pendingData: PendingWorkoutExerciseLogData[] = [];

    for (const [key, value] of entries) {
      if (value) {
        try {
          pendingData.push(JSON.parse(value));
        } catch (error) {
          glowLogger.error('Failed to parse pending workout exercise log', { key });
        }
      }
    }

    return pendingData;
  } catch (error) {
    glowLogger.error('Failed to get pending workout exercise logs', {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
};

/**
 * Remove a pending workout exercise log entry after successful sync
 */
export const removePendingWorkoutExerciseLog = async (localId: number): Promise<void> => {
  try {
    const key = `${PENDING_WORKOUT_EXERCISE_LOG_KEY}_${localId}`;
    await AsyncStorage.removeItem(key);
    glowLogger.info('Removed pending workout exercise log after successful sync', { local_id: localId });
  } catch (error) {
    glowLogger.error('Failed to remove pending workout exercise log', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

// ============================================
// Account Status Caching (for admin-controlled access)
// ============================================

export type AccountStatus = 'active' | 'deactivated';

interface CachedAccountStatusData {
  status: AccountStatus;
  lastChecked: number; // timestamp in ms
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Get cached account status
 */
export const getCachedAccountStatus = async (): Promise<CachedAccountStatusData | null> => {
  try {
    const value = await AsyncStorage.getItem(CACHED_ACCOUNT_STATUS_KEY);
    if (value) {
      return JSON.parse(value);
    }
    return null;
  } catch (error) {
    glowLogger.error('Failed to get cached account status', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};

/**
 * Cache account status with timestamp
 */
export const setCachedAccountStatus = async (status: AccountStatus): Promise<void> => {
  try {
    const data: CachedAccountStatusData = {
      status,
      lastChecked: Date.now()
    };
    await AsyncStorage.setItem(CACHED_ACCOUNT_STATUS_KEY, JSON.stringify(data));
    glowLogger.info('Account status cached', { status, timestamp: data.lastChecked });
  } catch (error) {
    glowLogger.error('Failed to cache account status', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Check if account status should be refreshed (every 24 hours)
 */
export const shouldRefreshAccountStatus = async (): Promise<boolean> => {
  try {
    const cached = await getCachedAccountStatus();
    if (!cached) {
      return true; // No cache, should refresh
    }
    
    const timeSinceLastCheck = Date.now() - cached.lastChecked;
    return timeSinceLastCheck >= TWENTY_FOUR_HOURS_MS;
  } catch (error) {
    return true; // On error, refresh to be safe
  }
};

/**
 * Clear cached account status (on logout)
 */
export const clearCachedAccountStatus = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(CACHED_ACCOUNT_STATUS_KEY);
    glowLogger.info('Cleared cached account status');
  } catch (error) {
    glowLogger.error('Failed to clear cached account status', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
