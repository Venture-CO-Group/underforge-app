import { createClient } from '@supabase/supabase-js';
import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import { removePendingBodyComposition, storePendingBodyComposition } from './sync-status';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let supabase: any;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export type WeightUnit = 'kg' | 'lbs';
export type DateRange = '30days' | '3months' | '6months';

/**
 * Public URLs for the optional weekly progress photos. Front is the angle the
 * weight chart renders above the bar; side/back are extra reference angles.
 * `undefined`/omitted on save means "leave whatever is already stored" — only a
 * present value overwrites, so a weight-only re-save never wipes photos.
 */
export interface BodyPhotoUrls {
  front?: string | null;
  side?: string | null;
  back?: string | null;
}

export interface BodyCompositionEntry {
  id?: number;
  logDate: Date;
  weekNumber: number;
  year: number;
  weightValue: number;
  weightUnit: WeightUnit;
  musclePercent: number;
  fatPercent: number;
  photoFrontUrl?: string | null;
  photoSideUrl?: string | null;
  photoBackUrl?: string | null;
  createdAt?: Date;
}

export interface BodyCompositionChartData {
  weekLabel: string; // e.g., "W51"
  dateLabel: string; // e.g., "(12.12)"
  weightValue: number;
  weightUnit: WeightUnit;
  musclePercent: number;
  fatPercent: number;
  otherPercent: number;
  photoFrontUrl?: string | null;
  photoSideUrl?: string | null;
  photoBackUrl?: string | null;
  logDate: Date;
}

/**
 * Get ISO week number from a date
 */
export const getWeekNumber = (date: Date): number => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

/**
 * Format date as DD.MM
 */
const formatDateShort = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
};


/**
 * Retry Supabase save with exponential backoff
 */
const retrySupabaseSave = async (
  data: any,
  userId: string,
  maxRetries: number = 3
): Promise<boolean> => {
  if (!supabase) {
    glowLogger.warn('Supabase not available for retry', { user_id: userId });
    return false;
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { error } = await supabase
        .from('body_composition_log')
        .upsert(data, {
          onConflict: 'user_id,week_number,year'
        });

      if (!error) {
        return true; // Success
      }

      glowLogger.warn(`Body composition Supabase save attempt ${attempt + 1} failed`, {
        error: error.message,
        user_id: userId,
        attempt: attempt + 1,
        max_retries: maxRetries
      });

      // If not the last attempt, wait before retrying
      if (attempt < maxRetries - 1) {
        const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
        glowLogger.info(`Retrying body composition save in ${delayMs}ms`, {
          user_id: userId,
          attempt: attempt + 1
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

    } catch (error) {
      glowLogger.error(`Body composition Supabase save attempt ${attempt + 1} threw exception`, {
        error: error instanceof Error ? error.message : String(error),
        user_id: userId,
        attempt: attempt + 1,
        max_retries: maxRetries
      });

      // If not the last attempt, wait before retrying
      if (attempt < maxRetries - 1) {
        const delayMs = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  return false; // All retries failed
};

/**
 * Save body composition log to both local SQLite and Supabase
 */
export const saveBodyCompositionLog = async (
  userId: string,
  weightValue: number,
  weightUnit: WeightUnit,
  musclePercent: number,
  fatPercent: number,
  photos?: BodyPhotoUrls
): Promise<boolean> => {
  try {
    const now = new Date();
    const weekNumber = getWeekNumber(now);
    const year = now.getFullYear();
    const logDate = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Normalize to null so SQLite stores NULL (not the string "undefined").
    const frontUrl = photos?.front ?? null;
    const sideUrl = photos?.side ?? null;
    const backUrl = photos?.back ?? null;

    glowLogger.info('Saving body composition log', {
      user_id: userId,
      week_number: weekNumber,
      year,
      weight_value: weightValue,
      weight_unit: weightUnit,
      muscle_percent: musclePercent,
      fat_percent: fatPercent,
      has_front_photo: !!frontUrl,
      has_side_photo: !!sideUrl,
      has_back_photo: !!backUrl
    });

    // Save to local SQLite (upsert based on user_id + week_number + year).
    // COALESCE keeps any existing photo when this save omits it (null), so a
    // weight-only re-save of an existing week never erases previously added photos.
    const db = getDatabase();
    await db.runAsync(`
      INSERT INTO body_composition_log (user_id, log_date, week_number, year, weight_value, weight_unit, muscle_percent, fat_percent, photo_front_url, photo_side_url, photo_back_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, week_number, year) DO UPDATE SET
        log_date = excluded.log_date,
        weight_value = excluded.weight_value,
        weight_unit = excluded.weight_unit,
        muscle_percent = excluded.muscle_percent,
        fat_percent = excluded.fat_percent,
        photo_front_url = COALESCE(excluded.photo_front_url, photo_front_url),
        photo_side_url = COALESCE(excluded.photo_side_url, photo_side_url),
        photo_back_url = COALESCE(excluded.photo_back_url, photo_back_url),
        created_at = CURRENT_TIMESTAMP
    `, [userId, logDate, weekNumber, year, weightValue, weightUnit, musclePercent, fatPercent, frontUrl, sideUrl, backUrl]);

    glowLogger.info('Body composition saved to local SQLite', { user_id: userId });

    // Save to Supabase with retry mechanism
    if (supabase) {
      const supabaseData: Record<string, any> = {
        user_id: userId,
        log_date: logDate,
        week_number: weekNumber,
        year: year,
        weight_value: weightValue,
        weight_unit: weightUnit,
        muscle_percent: musclePercent,
        fat_percent: fatPercent,
      };
      // Only include photo columns when present: an omitted column is left
      // untouched on conflict, mirroring the local COALESCE behavior.
      if (frontUrl) supabaseData.photo_front_url = frontUrl;
      if (sideUrl) supabaseData.photo_side_url = sideUrl;
      if (backUrl) supabaseData.photo_back_url = backUrl;

      const supabaseSuccess = await retrySupabaseSave(supabaseData, userId, 3);

      if (supabaseSuccess) {
        glowLogger.info('Body composition saved to Supabase', { user_id: userId });
        // Remove from pending queue if it was there
        await removePendingBodyComposition(userId, weekNumber, year);
      } else {
        glowLogger.warn('Body composition failed to save to Supabase after retries', {
          user_id: userId,
          will_retry_later: true
        });
        // Store for persistent retry (like profile sync)
        await storePendingBodyComposition({
          user_id: userId,
          log_date: logDate,
          week_number: weekNumber,
          year: year,
          weight_value: weightValue,
          weight_unit: weightUnit,
          muscle_percent: musclePercent,
          fat_percent: fatPercent,
          photo_front_url: frontUrl ?? undefined,
          photo_side_url: sideUrl ?? undefined,
          photo_back_url: backUrl ?? undefined,
          timestamp: Date.now()
        });
        // Don't fail - local save succeeded, data is available offline
      }
    }

    return true;
  } catch (error) {
    glowLogger.error('Error saving body composition log', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return false;
  }
};

/**
 * Get body composition logs for a date range
 */
export const getBodyCompositionLogs = async (
  userId: string,
  dateRange: DateRange
): Promise<BodyCompositionChartData[]> => {
  try {
    const now = new Date();
    let startDate: Date;

    if (dateRange === '30days') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (dateRange === '6months') {
      startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    }

    const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;

    glowLogger.info('Fetching body composition logs', {
      user_id: userId,
      date_range: dateRange,
      start_date: startDateStr
    });

    // Try to fetch from local SQLite first
    const db = getDatabase();
    const localResults = await db.getAllAsync<{
      id: number;
      log_date: string;
      week_number: number;
      year: number;
      weight_value: number;
      weight_unit: string;
      muscle_percent: number;
      fat_percent: number;
      photo_front_url: string | null;
      photo_side_url: string | null;
      photo_back_url: string | null;
    }>(`
      SELECT * FROM body_composition_log
      WHERE user_id = ? AND log_date >= ?
      ORDER BY log_date ASC
    `, [userId, startDateStr]);

    if (localResults.length > 0) {
      glowLogger.info('Body composition logs fetched from local SQLite', {
        count: localResults.length,
        user_id: userId
      });

      return localResults.map(row => {
        const logDate = new Date(row.log_date);
        return {
          weekLabel: `W${row.week_number}`,
          dateLabel: `(${formatDateShort(logDate)})`,
          weightValue: row.weight_value,
          weightUnit: row.weight_unit as WeightUnit,
          musclePercent: row.muscle_percent,
          fatPercent: row.fat_percent,
          otherPercent: 100 - row.muscle_percent - row.fat_percent,
          photoFrontUrl: row.photo_front_url ?? null,
          photoSideUrl: row.photo_side_url ?? null,
          photoBackUrl: row.photo_back_url ?? null,
          logDate,
        };
      });
    }

    // Fallback to Supabase if no local data
    if (supabase) {
      const { data, error } = await supabase
        .from('body_composition_log')
        .select('*')
        .eq('user_id', userId)
        .gte('log_date', startDateStr)
        .order('log_date', { ascending: true });

      if (error) {
        glowLogger.error('Error fetching body composition from Supabase', {
          error: error.message,
          user_id: userId
        });
        return [];
      }

      if (data && data.length > 0) {
        glowLogger.info('Body composition logs fetched from Supabase', {
          count: data.length,
          user_id: userId
        });

        return data.map((row: any) => {
          const logDate = new Date(row.log_date);
          return {
            weekLabel: `W${row.week_number}`,
            dateLabel: `(${formatDateShort(logDate)})`,
            weightValue: parseFloat(row.weight_value),
            weightUnit: row.weight_unit as WeightUnit,
            musclePercent: parseFloat(row.muscle_percent),
            fatPercent: parseFloat(row.fat_percent),
            otherPercent: 100 - parseFloat(row.muscle_percent) - parseFloat(row.fat_percent),
            photoFrontUrl: row.photo_front_url ?? null,
            photoSideUrl: row.photo_side_url ?? null,
            photoBackUrl: row.photo_back_url ?? null,
            logDate,
          };
        });
      }
    }

    return [];
  } catch (error) {
    glowLogger.error('Error fetching body composition logs', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    }); 
    return [];
  }
};

export interface BodyCompositionLogRow {
  logDate: string;
  musclePercent: number;
  fatPercent: number;
  weightValue: number;
  weightUnit: WeightUnit;
}

/**
 * Latest body-composition rows with log_date on or before inclusiveEndYmd (YYYY-MM-DD), newest first.
 */
export const getBodyCompositionLogsOnOrBefore = async (
  userId: string,
  inclusiveEndYmd: string,
  limit: number = 4,
): Promise<BodyCompositionLogRow[]> => {
  try {
    const db = getDatabase();
    const localResults = await db.getAllAsync<{
      log_date: string;
      muscle_percent: number;
      fat_percent: number;
      weight_value: number;
      weight_unit: string;
    }>(`
      SELECT log_date, muscle_percent, fat_percent, weight_value, weight_unit
      FROM body_composition_log
      WHERE user_id = ? AND log_date <= ?
      ORDER BY log_date DESC
      LIMIT ?
    `, [userId, inclusiveEndYmd, limit]);

    return localResults.map(row => ({
      logDate: row.log_date,
      musclePercent: row.muscle_percent,
      fatPercent: row.fat_percent,
      weightValue: row.weight_value,
      weightUnit: row.weight_unit as WeightUnit,
    }));
  } catch (error) {
    glowLogger.error('Error fetching body composition logs on or before date', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return [];
  }
};

/**
 * Sync body composition logs from Supabase to local SQLite
 * Call this when app starts to ensure local cache is up to date with remote data
 */
export const syncBodyCompositionFromSupabase = async (userId: string): Promise<number> => {
  if (!supabase) {
    return 0;
  }

  try {
    // Get last 6 months of body composition logs from Supabase
    const now = new Date();
    const startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000); // 6 months
    const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;

    glowLogger.info('Syncing body composition from Supabase', {
      user_id: userId,
      start_date: startDateStr
    });

    const { data, error } = await supabase
      .from('body_composition_log')
      .select('*')
      .eq('user_id', userId)
      .gte('log_date', startDateStr)
      .order('log_date', { ascending: true });

    if (error || !data) {
      glowLogger.warn('Failed to sync body composition from Supabase', { error: error?.message });
      return 0;
    }

    const db = getDatabase();
    let syncedCount = 0;

    for (const row of data) {
      try {
        // Upsert based on user_id + week_number + year (same as save function)
        await db.runAsync(`
          INSERT INTO body_composition_log (user_id, log_date, week_number, year, weight_value, weight_unit, muscle_percent, fat_percent, photo_front_url, photo_side_url, photo_back_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, week_number, year) DO UPDATE SET
            log_date = excluded.log_date,
            weight_value = excluded.weight_value,
            weight_unit = excluded.weight_unit,
            muscle_percent = excluded.muscle_percent,
            fat_percent = excluded.fat_percent,
            photo_front_url = COALESCE(excluded.photo_front_url, photo_front_url),
            photo_side_url = COALESCE(excluded.photo_side_url, photo_side_url),
            photo_back_url = COALESCE(excluded.photo_back_url, photo_back_url)
        `, [row.user_id, row.log_date, row.week_number, row.year, row.weight_value, row.weight_unit, row.muscle_percent, row.fat_percent, row.photo_front_url ?? null, row.photo_side_url ?? null, row.photo_back_url ?? null]);
        syncedCount++;
      } catch (insertError) {
        // Ignore individual insert errors (e.g., constraint violations)
        glowLogger.warn('Failed to sync individual body composition entry', {
          week: row.week_number,
          year: row.year,
          error: insertError instanceof Error ? insertError.message : String(insertError)
        });
      }
    }

    glowLogger.info('Synced body composition from Supabase to local', {
      user_id: userId,
      synced_count: syncedCount,
      total_remote: data.length
    });

    return syncedCount;
  } catch (error) {
    glowLogger.error('Error syncing body composition from Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return 0;
  }
};

/**
 * Get user's preferred weight unit
 */
export const getUserWeightPreference = async (userId: string): Promise<WeightUnit> => {
  try {
    if (!supabase) {
      return 'kg';
    }

    const { data, error } = await supabase
      .from('user_profile')
      .select('preferred_weight_unit')
      .eq('user_id', userId)
      .single();

    if (error || !data?.preferred_weight_unit) {
      return 'kg';
    }

    return data.preferred_weight_unit as WeightUnit;
  } catch (error) {
    glowLogger.error('Error fetching weight preference', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return 'kg';
  }
};

/**
 * Set user's preferred weight unit
 */
export const setUserWeightPreference = async (
  userId: string,
  unit: WeightUnit
): Promise<boolean> => {
  try {
    if (!supabase) {
      return false;
    }

    const { error } = await supabase
      .from('user_profile')
      .update({ preferred_weight_unit: unit })
      .eq('user_id', userId);

    if (error) {
      glowLogger.error('Error setting weight preference', {
        error: error.message,
        user_id: userId
      });
      return false;
    }

    glowLogger.info('Weight preference updated', {
      user_id: userId,
      unit
    });

    return true;
  } catch (error) {
    glowLogger.error('Error setting weight preference', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return false;
  }
};

/**
 * Convert weight between kg and lbs
 */
export const convertWeight = (value: number, from: WeightUnit, to: WeightUnit): number => {
  if (from === to) return value;
  if (from === 'kg' && to === 'lbs') return Math.round(value * 2.20462 * 10) / 10;
  return Math.round(value / 2.20462 * 10) / 10;
};

