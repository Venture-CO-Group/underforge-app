import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
} from 'react-native';
import { CheckinProgress } from '../lib/checkin_helper';
import { getWeeklyTaskCompletions } from '../lib/supabase-task-completion';
import { ExpectedCheckin } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import WeeklyStatsScreen from './WeeklyStatsScreen';

interface CheckinDayProps {
  visible: boolean;
  onClose: () => void;
  checkinProgress: CheckinProgress | null;
  userProfile: UserProfile | null;
  onDataChange?: () => void; // Called when task completions change
}

// Helper to get day key from completion_date (YYYY-MM-DD format)
const dayKeyFromCompletionDate = (dateStr?: string | null): string | null => {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
};

export default function CheckinDay({ visible, onClose, checkinProgress, userProfile, onDataChange }: CheckinDayProps) {
  const [weeklyTaskCompletions, setWeeklyTaskCompletions] = useState<Array<{ step_id: string; completion_date: string; completed: boolean }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const isLoadingRef = useRef(false);

  // Calculate expected checkins from user profile
  const expectedCheckinsThisWeek = useMemo(() => {
    if (!userProfile?.onboardingProfile?.actionPlan?.steps) return [];
    
    return userProfile.onboardingProfile.actionPlan.steps.reduce((checkins: ExpectedCheckin[], step) => {
      if (step.daysOfWeek && step.daysOfWeek.length > 0) {
        step.daysOfWeek.forEach(dayOfWeek => {
          checkins.push({
            step_id: step.id,
            step_title: step.title,
            dayOfWeek: dayOfWeek,
            timeOfDay: step.timeOfDay,
            calculateTimestampForThisWeekCheckin: function() { return ''; }
          });
        });
      }
      return checkins;
    }, []);
  }, [userProfile?.onboardingProfile?.actionPlan?.steps]);

  // Calculate completion stats using MATCHED completions (same logic as WeeklyStatsScreen)
  const { totalTasks, completedTasks, planProgress } = useMemo(() => {
    const total = expectedCheckinsThisWeek.length;
    
    // Create a lookup map for completed tasks: key = "step_id|dayKey"
    const completedMap = new Map<string, boolean>();
    weeklyTaskCompletions.forEach((c) => {
      const derivedDay = dayKeyFromCompletionDate(c.completion_date);
      if (derivedDay && c.completed) {
        const key = `${c.step_id}|${derivedDay}`;
        completedMap.set(key, true);
      }
    });

    // Count how many expected checkins have a matching completion
    let matched = 0;
    expectedCheckinsThisWeek.forEach((exp) => {
      const day = exp.dayOfWeek?.toLowerCase();
      if (day) {
        const lookupKey = `${exp.step_id}|${day}`;
        if (completedMap.has(lookupKey)) {
          matched++;
        }
      }
    });

    return {
      totalTasks: total,
      completedTasks: matched,
      planProgress: total > 0 ? matched / total : 0
    };
  }, [expectedCheckinsThisWeek, weeklyTaskCompletions]);

  // Hydrate CheckinProgress with task_completions data
  const hydratedCheckinProgress: CheckinProgress | null = useMemo(() => {
    if (!checkinProgress) return null;
    const hasMethod = typeof (checkinProgress as any).isUserOnTrack === 'function';
    const boundIsUserOnTrack = hasMethod
      ? () =>
          (checkinProgress as any).isUserOnTrack.call({
            ...checkinProgress,
            expected_checkins_this_week: expectedCheckinsThisWeek,
            num_checkins_this_week: completedTasks,
            task_completions_this_week: weeklyTaskCompletions,
          })
      : undefined;
    return {
      ...checkinProgress,
      expected_checkins_this_week: expectedCheckinsThisWeek,
      num_checkins_this_week: completedTasks,
      task_completions_this_week: weeklyTaskCompletions,
      ...(boundIsUserOnTrack ? { isUserOnTrack: boundIsUserOnTrack } : {}),
    } as CheckinProgress;
  }, [checkinProgress, expectedCheckinsThisWeek, completedTasks, weeklyTaskCompletions]);

  // Function to fetch task completion data from Supabase
  const fetchTaskCompletionData = useCallback(async () => {
    if (!userProfile?.user_id || isLoadingRef.current) {
      return;
    }

    try {
      isLoadingRef.current = true;
      setIsLoading(true);
      const completions = await getWeeklyTaskCompletions(userProfile.user_id);
      setWeeklyTaskCompletions(completions);
      // Notify parent that data changed so it can refresh
      if (onDataChange) {
        onDataChange();
      }
    } catch (error) {
      console.error('Error fetching task completion data:', error);
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  }, [userProfile?.user_id, onDataChange]);


  // Fetch task completion data when component mounts or when userProfile changes
  useEffect(() => {
    if (visible && userProfile?.user_id) {
      fetchTaskCompletionData();
    }
  }, [visible, userProfile?.user_id, fetchTaskCompletionData]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <WeeklyStatsScreen
        onBack={onClose}
        planProgress={planProgress}
        checkinProgress={hydratedCheckinProgress}
        userId={userProfile?.user_id}
        onTaskCompletionChange={fetchTaskCompletionData}
      />
    </Modal>
  );
}
