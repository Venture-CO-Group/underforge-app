import { ExpectedCheckin, expectedWeeklyCheckins } from '../types/onboard';
import { glowLogger } from './glow-logger';
import { getWeeklyTaskCompletions } from './supabase-task-completion';
import { getRemoteUserProfileLoggedInUser } from './supabase_db_new';

export enum TrackingStatus {
  FALLING_BEHIND = 'falling_behind',
  ON_SCHEDULE = 'on_schedule',
  AHEAD_OF_SCHEDULE = 'ahead_of_schedule'
}

export interface CheckinProgress {
  num_checkins_this_week: number;
  expected_checkins_this_week: ExpectedCheckin[];
  task_completions_this_week?: Array<{ step_id: string; completion_date: string; completed: boolean }>;
  
  isUserOnTrack(): TrackingStatus;
}

// Get the start of the current week (Monday at 00:00 UTC)
const getWeekStartUTC = (): string => {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to Monday = 0
  
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - daysToSubtract);
  weekStart.setUTCHours(0, 0, 0, 0);
  
  return weekStart.toISOString();
};

// Get the end of the current week (Sunday at 23:59:59 UTC)
const getWeekEndUTC = (): string => {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const daysToAdd = dayOfWeek === 0 ? 0 : 7 - dayOfWeek; // Days until next Sunday
  
  const weekEnd = new Date(now);
  weekEnd.setUTCDate(now.getUTCDate() + daysToAdd);
  weekEnd.setUTCHours(23, 59, 59, 999);
  
  return weekEnd.toISOString();
};

// Helper function to calculate tracking status based on current progress
const calculateTrackingStatus = (actualCheckins: number, expectedCheckins: ExpectedCheckin[]): TrackingStatus => {
  const totalExpectedCheckins = expectedCheckins.length;
  
  // If no expected checkins, user is on schedule by default
  if (totalExpectedCheckins === 0) {
    return TrackingStatus.ON_SCHEDULE;
  }
  
  // Get current day of week in user's timezone (Monday = 1, Sunday = 7)
  const now = new Date();
  const currentDayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  
  // Convert to Monday=1, Tuesday=2, ..., Sunday=7 format
  const mondayBasedDay = currentDayOfWeek === 0 ? 7 : currentDayOfWeek;
  
  // Map day numbers to string representations
  const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  
  // Calculate expected checkins by today (inclusive)
  let expectedByToday = 0;
  for (let day = 1; day <= mondayBasedDay; day++) {
    const dayIndex = day === 7 ? 0 : day; // Convert back to 0-6 format for array indexing
    const dayString = dayMap[dayIndex];
    
    // Count expected checkins for this day
    const checkinsForDay = expectedCheckins.filter(checkin => 
      checkin.dayOfWeek.toLowerCase() === dayString
    ).length;
    
    expectedByToday += checkinsForDay;
  }
  
  // Handle edge case where no checkins are expected by today
  if (expectedByToday === 0) {
    // If no checkins expected yet and user has done none, they're on schedule
    // If they've done some when none were expected, they're ahead
    return actualCheckins === 0 ? TrackingStatus.ON_SCHEDULE : TrackingStatus.AHEAD_OF_SCHEDULE;
  }
  
  // Calculate trajectory to see if user will complete 2/3 or 90% of weekly checkins
  const completionRate = actualCheckins / expectedByToday;
  const weeklyProjection = completionRate * totalExpectedCheckins;
  
  // Thresholds
  const twoThirdsThreshold = totalExpectedCheckins * (2/3);
  const ninetyPercentThreshold = totalExpectedCheckins * 0.9;
  
  glowLogger.info('Tracking status calculation', {
    current_day: mondayBasedDay,
    actual_checkins: actualCheckins,
    expected_by_today: expectedByToday,
    total_expected_weekly: totalExpectedCheckins,
    completion_rate: completionRate,
    weekly_projection: weeklyProjection,
    two_thirds_threshold: twoThirdsThreshold,
    ninety_percent_threshold: ninetyPercentThreshold
  });
  
  // Determine status based on weekly projection
  if (weeklyProjection >= ninetyPercentThreshold) {
    return TrackingStatus.AHEAD_OF_SCHEDULE;
  } else if (weeklyProjection >= twoThirdsThreshold) {
    return TrackingStatus.ON_SCHEDULE;
  } else {
    return TrackingStatus.FALLING_BEHIND;
  }
};

// Get checkin progress for the current week using task_completions table
export const checking_progress_this_week = async (userId: string): Promise<CheckinProgress> => {
  try {
    glowLogger.info('Getting checkin progress for current week from task_completions', {
      user_id: userId
    });
    
    // Get user's onboarding profile to determine expected checkins
    const userProfile = await getRemoteUserProfileLoggedInUser();
    if (!userProfile?.onboardingProfile) {
      glowLogger.warn('No onboarding profile found for user', { user_id: userId });
      return {
        num_checkins_this_week: 0,
        expected_checkins_this_week: [],
        task_completions_this_week: []
      };
    }
    
    // Generate expected checkins from the user's action plan
    const expectedCheckins: ExpectedCheckin[] = expectedWeeklyCheckins(userProfile.onboardingProfile);
    
    // Get actual task completions for this week from task_completions table
    const taskCompletions = await getWeeklyTaskCompletions(userId);
    
    // Count unique completed tasks this week
    // A task is completed if: step_id matches expected AND completed = true
    const completedTasksSet = new Set<string>();
    taskCompletions.forEach(completion => {
      if (completion.completed) {
        // Create a unique key combining step_id and completion_date
        const key = `${completion.step_id}_${completion.completion_date}`;
        completedTasksSet.add(key);
      }
    });
    
    const numCompletedTasks = completedTasksSet.size;
    
    const result: CheckinProgress = {
      num_checkins_this_week: numCompletedTasks,
      expected_checkins_this_week: expectedCheckins,
      task_completions_this_week: taskCompletions,
      
      isUserOnTrack(): TrackingStatus {
        return calculateTrackingStatus(this.num_checkins_this_week, this.expected_checkins_this_week);
      }
    };
    
    glowLogger.info('Checkin progress calculated successfully from task_completions', {
      user_id: userId,
      completed_tasks: numCompletedTasks,
      expected_checkins: expectedCheckins.length,
      total_task_completion_records: taskCompletions.length
    });
    
    return result;
  } catch (error) {
    glowLogger.error('Failed to get checkin progress for current week', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    throw error;
  }
};