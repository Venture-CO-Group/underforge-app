import { glowLogger } from './glow-logger';
import { supabase } from './supabase_db_new';

export interface TaskCompletion {
  user_id: string;
  step_id: string;
  completed: boolean;
  completion_date: string; // YYYY-MM-DD format
}

/**
 * Get the start of a calendar week (Monday) for a given date
 */
const getWeekStart = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  return new Date(d.setDate(diff));
};

/**
 * Get the end of a calendar week (Sunday) for a given date
 */
const getWeekEnd = (date: Date): Date => {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
};

/**
 * Format date as YYYY-MM-DD in local timezone (not UTC)
 */
const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Save or update task completion to Supabase
 */
export const saveTaskCompletionToSupabase = async (
  userId: string,
  stepId: string,
  completed: boolean,
  completionDate?: string
): Promise<void> => {
  try {
    const date = completionDate || formatDate(new Date());
    
    const { error } = await supabase
      .from('task_completions')
      .upsert({
        user_id: userId,
        step_id: stepId,
        completed,
        completion_date: date
      }, {
        onConflict: 'user_id,step_id,completion_date'
      });

    if (error) throw error;

    glowLogger.info('Task completion saved to Supabase', {
      user_id: userId,
      step_id: stepId,
      completed,
      completion_date: date
    });
  } catch (error) {
    glowLogger.error('Error saving task completion to Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      step_id: stepId
    });
    throw error;
  }
};

/**
 * Get weekly compliance data for the last N weeks
 * Returns an array of { weekStart, weekEnd, completionRate } for each week
 * @param userId - User ID
 * @param totalCheckinsPerWeek - Total expected checkins per week (sum of daysOfWeek across all steps)
 * @param weeks - Number of weeks to fetch
 */
export const getWeeklyCompliance = async (
  userId: string,
  totalCheckinsPerWeek: number,
  weeks: number = 6
): Promise<Array<{ weekStart: string; weekEnd: string; completionRate: number }>> => {
  try {
    const result: Array<{ weekStart: string; weekEnd: string; completionRate: number }> = [];
    const today = new Date();
    
    for (let i = weeks - 1; i >= 0; i--) {
      // Get the date for the start of each week going backwards
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() - (i * 7));
      
      const weekStart = getWeekStart(targetDate);
      const weekEnd = getWeekEnd(targetDate);
      
      const weekStartStr = formatDate(weekStart);
      const weekEndStr = formatDate(weekEnd);
      
      // Query Supabase for completions in this week
      const { data, error } = await supabase
        .from('task_completions')
        .select('step_id, completion_date, completed')
        .eq('user_id', userId)
        .gte('completion_date', weekStartStr)
        .lte('completion_date', weekEndStr);

      if (error) throw error;

      // Calculate completion rate: completed tasks / total expected tasks
      // Count unique (step_id, completion_date) pairs where completed = true
      const completedTaskSet = new Set<string>();
      data?.forEach((record: { step_id: string; completion_date: string; completed: boolean }) => {
        if (record.completed) {
          completedTaskSet.add(`${record.step_id}_${record.completion_date}`);
        }
      });
      
      const completedTasks = completedTaskSet.size;
      const completionRate = totalCheckinsPerWeek > 0 ? (completedTasks / totalCheckinsPerWeek) * 100 : 0;
      
      // Debug logging
      glowLogger.info('Weekly compliance calculation', {
        week_start: weekStartStr,
        week_end: weekEndStr,
        completed_tasks: completedTasks,
        total_checkins_per_week: totalCheckinsPerWeek,
        completion_rate: completionRate,
        total_records: data?.length || 0
      });
      
      result.push({
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
        completionRate: Math.round(completionRate)
      });
    }
    
    glowLogger.info('Retrieved weekly compliance from Supabase', {
      user_id: userId,
      weeks,
      data_points: result.length
    });
    
    return result;
  } catch (error) {
    glowLogger.error('Error getting weekly compliance from Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return [];
  }
};

/**
 * Calculate current streak (consecutive weeks with >= compliance threshold)
 * 
 * Away Mode Rules:
 * - If 3 or more days during a week user was away: week doesn't count (skip it, don't break streak)
 * - If 1-2 days away: week counts but threshold is 70% instead of 80%
 * - If 0 days away: normal 80% threshold
 * 
 * @param weeklyData - Array of weekly compliance data (oldest to newest), with optional awayDays
 * @param isAwayMode - If true, current away mode is active
 * @param awayModeStartDate - ISO date string of when away mode was activated (for calculating current week away days)
 */
export const calculateStreak = (
  weeklyData: Array<{ completionRate: number; weekStart?: string; weekEnd?: string; awayDays?: number }>,
  isAwayMode: boolean = false,
  awayModeStartDate?: string | null
): number => {
  let streak = 0;
  
  // Start from the most recent week and count backwards
  for (let i = weeklyData.length - 1; i >= 0; i--) {
    const week = weeklyData[i];
    
    // Calculate away days for the current week (last element) if away mode is active
    let awayDays = week.awayDays || 0;
    if (i === weeklyData.length - 1 && isAwayMode && awayModeStartDate && week.weekStart) {
      // Calculate how many days of away mode overlap with this week
      const awayStart = new Date(awayModeStartDate);
      const weekStart = new Date(week.weekStart);
      const today = new Date();
      
      // Start counting from the later of awayStart or weekStart
      const countStart = awayStart > weekStart ? awayStart : weekStart;
      // End counting at today (not beyond)
      const daysDiff = Math.floor((today.getTime() - countStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      awayDays = Math.max(0, daysDiff);
    }
    
    // Apply away mode rules
    if (awayDays > 2) {
      // More than 2 days away: skip this week (don't count it, but don't break streak either)
      continue;
    }
    
    // Determine threshold based on away days
    const threshold = awayDays >= 1 && awayDays <= 2 ? 70 : 80;
    
    if (week.completionRate >= threshold) {
      streak++;
    } else {
      break; // Stop counting at first week below threshold
    }
  }
  
  return streak;
};

/**
 * Get today's task completions from Supabase
 * If multiple rows exist for the same step_id (shouldn't happen due to unique constraint),
 * we use the most recent one (by created_at) or consider it completed if any row has completed=true
 */
export const getTodayTaskCompletionsFromSupabase = async (
  userId: string
): Promise<{ [stepId: string]: boolean }> => {
  try {
    const today = formatDate(new Date());
    
    const { data, error } = await supabase
      .from('task_completions')
      .select('*')
      .eq('user_id', userId)
      .eq('completion_date', today)
      .order('created_at', { ascending: false }); // Most recent first

    if (error) throw error;

    const completions: { [stepId: string]: boolean } = {};
    const stepIdCounts: { [stepId: string]: number } = {};
    
    // First pass: count occurrences and detect duplicates
    data?.forEach((row: { step_id: string; completed: boolean }) => {
      stepIdCounts[row.step_id] = (stepIdCounts[row.step_id] || 0) + 1;
    });
    
    // Second pass: use most recent value (since data is ordered by created_at DESC)
    // If any row has completed=true, prefer that (task is completed if any record says so)
    data?.forEach((row: { step_id: string; completed: boolean; created_at?: string }) => {
      if (!(row.step_id in completions)) {
        // First time seeing this step_id, use its value
        completions[row.step_id] = row.completed;
      } else if (row.completed) {
        // If we already have a value but this one is completed=true, prefer completed
        completions[row.step_id] = true;
      }
      // Otherwise keep the existing value (which is from a more recent record)
    });
    
    // Log warnings for duplicates
    Object.entries(stepIdCounts).forEach(([stepId, count]) => {
      if (count > 1) {
        glowLogger.warn('Duplicate task completion entries found', {
          user_id: userId,
          step_id: stepId,
          date: today,
          count
        });
      }
    });

    glowLogger.info('Retrieved today task completions from Supabase', {
      user_id: userId,
      date: today,
      count: data?.length || 0,
      unique_steps: Object.keys(completions).length
    });

    return completions;
  } catch (error) {
    glowLogger.error('Error getting today task completions from Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return {};
  }
};

/**
 * Get task completions for the current week from task_completions table
 * Returns completions grouped by date for building weekly view
 */
export const getWeeklyTaskCompletions = async (
  userId: string
): Promise<Array<{ step_id: string; completion_date: string; completed: boolean }>> => {
  try {
    const today = new Date();
    const weekStart = getWeekStart(today);
    const weekEnd = getWeekEnd(today);
    
    const weekStartStr = formatDate(weekStart);
    const weekEndStr = formatDate(weekEnd);
    
    const { data, error } = await supabase
      .from('task_completions')
      .select('step_id, completion_date, completed')
      .eq('user_id', userId)
      .gte('completion_date', weekStartStr)
      .lte('completion_date', weekEndStr)
      .order('completion_date', { ascending: true });

    if (error) throw error;

    glowLogger.info('Retrieved weekly task completions from Supabase', {
      user_id: userId,
      week_start: weekStartStr,
      week_end: weekEndStr,
      count: data?.length || 0
    });

    return data || [];
  } catch (error) {
    glowLogger.error('Error getting weekly task completions from Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return [];
  }
};

