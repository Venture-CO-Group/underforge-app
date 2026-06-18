import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckinProgress } from '../lib/checkin_helper';
import { glowLogger } from '../lib/glow-logger';
import { getWeeklyTaskCompletions, saveTaskCompletionToSupabase } from '../lib/supabase-task-completion';
import { styles } from '../styles/WeeklyStatsScreen.styles';
import { CheckinProgressBar } from './CheckinProgressBar';
import { TaskCheckinProgressBar } from './TaskCheckinProgressBar';

interface WeeklyStatsScreenProps {
  onBack: () => void;
  planProgress: number;
  checkinProgress: CheckinProgress | null;
  userId?: string;
  onTaskCompletionChange?: () => void;
}

export default function WeeklyStatsScreen({ onBack, planProgress, checkinProgress, userId, onTaskCompletionChange }: WeeklyStatsScreenProps) {
  const { t } = useTranslation(['progress', 'common']);
  // State declarations FIRST
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [weeklyTaskCompletions, setWeeklyTaskCompletions] = useState<Array<{ step_id: string; completion_date: string; completed: boolean }>>(
    (checkinProgress as any)?.task_completions_this_week || []
  );

  // Update weeklyTaskCompletions when checkinProgress changes
  useEffect(() => {
    const completions = (checkinProgress as any)?.task_completions_this_week || [];
    setWeeklyTaskCompletions(completions);
  }, [checkinProgress]);

  // Derive current day key
  const currentDayKey = useMemo(() => {
    const idx = new Date().getDay(); // 0=Sun
    return ['sun','mon','tue','wed','thu','fri','sat'][idx];
  }, []);

  // Build per-day task data from task_completions
  const { daysData, totalStreakDays } = useMemo(() => {
    const dayOrder = ['mon','tue','wed','thu','fri','sat','sun'];
    const weekdayLabel = (key: string) => t(`progress:weekday_${key}` as const);
    const expected = checkinProgress?.expected_checkins_this_week || [];
    const completed = weeklyTaskCompletions || [];

    // Helper to get day key from completion_date (YYYY-MM-DD format)
    const dayKeyFromCompletionDate = (dateStr?: string | null) => {
      if (!dateStr) return null;
      const d = new Date(dateStr + 'T00:00:00');
      if (isNaN(d.getTime())) return null;
      return ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
    };

    // Create a lookup map for completed tasks: key = "step_id|dayKey"
    const completedMap = new Map<string, boolean>();
    completed.forEach((c) => {
      const derivedDay = dayKeyFromCompletionDate(c.completion_date);
      if (derivedDay && c.completed) {
        const key = `${c.step_id}|${derivedDay}`;
        completedMap.set(key, true);
      }
    });

    const grouped: Record<string, { id: string; title: string; completed: boolean }[]> = {};
    dayOrder.forEach(d => { grouped[d] = []; });

    expected.forEach((exp: any) => {
      const day = exp.dayOfWeek?.toLowerCase();
      if (!day || !grouped[day]) return;

      // Check if this task was completed on this day
      const lookupKey = `${exp.step_id}|${day}`;
      const isDone = completedMap.has(lookupKey);

      grouped[day].push({
        id: exp.step_id,
        title: exp.step_title || exp.step_id,
        completed: isDone,
      });
    });

    // Simple streak calc
    let streak = 0;
    const todayIdx = dayOrder.indexOf(currentDayKey);
    for (let i = todayIdx; i >= 0; i--) {
      const tasks = grouped[dayOrder[i]];
      if (tasks.length === 0) continue;
      if (tasks.every(t => t.completed)) streak += 1;
      else break;
    }

    const daysData = dayOrder.map(dayKey => ({
      key: dayKey,
      label: weekdayLabel(dayKey),
      tasks: grouped[dayKey]
    }));

    glowLogger.info('WeeklyStatsScreen aggregation', {
      totalExpected: expected.length,
      totalCompletedRecords: completed.length,
      completedMapSize: completedMap.size,
      completedMapKeys: Array.from(completedMap.keys()).slice(0, 5),
      sampleExpected: expected.slice(0, 3).map((e: any) => ({ step_id: e.step_id, dayOfWeek: e.dayOfWeek })),
      sampleCompleted: completed.slice(0, 3).map(c => ({ step_id: c.step_id, date: c.completion_date, completed: c.completed })),
      perDay: daysData.map(d => ({ day: d.key, tasks: d.tasks.length, completed: d.tasks.filter(t => t.completed).length })),
    });

    return { daysData, totalStreakDays: streak };
  }, [checkinProgress, currentDayKey, weeklyTaskCompletions, t]);

  // Set initial expanded day after daysData is computed
  useEffect(() => {
    if (expandedDays.size === 0 && daysData.length > 0) {
      const current = daysData.find(d => d.key === currentDayKey);
      if (current && current.tasks.length > 0) {
        setExpandedDays(new Set([current.key]));
      } else {
        const firstWithTasks = daysData.find(d => d.tasks.length > 0);
        if (firstWithTasks) setExpandedDays(new Set([firstWithTasks.key]));
      }
    }
  }, [daysData, currentDayKey, expandedDays.size]);

  // Helper to format date as YYYY-MM-DD in local timezone (not UTC)
  const formatLocalDate = useCallback((date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  // Helper function to get the date for a day of week in the current week
  const getDateForDayOfWeek = useCallback((dayKey: string): string | null => {
    const dayMap: Record<string, number> = {
      'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6
    };
    
    const targetDay = dayMap[dayKey.toLowerCase()];
    if (targetDay === undefined) return null;
    
    const today = new Date();
    const weekStart = new Date(today);
    const day = weekStart.getDay();
    const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
    weekStart.setDate(diff);
    weekStart.setHours(0, 0, 0, 0);
    
    const targetDate = new Date(weekStart);
    const daysToAdd = targetDay === 0 ? 6 : targetDay - 1;
    targetDate.setDate(weekStart.getDate() + daysToAdd);
    
    // Use local date format, not UTC
    return formatLocalDate(targetDate);
  }, [formatLocalDate]);

  // Check if a day is in the past or today
  const isDayInPastOrToday = useCallback((dayKey: string): boolean => {
    const dateStr = getDateForDayOfWeek(dayKey);
    if (!dateStr) return false;
    
    const targetDate = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return targetDate <= today;
  }, [getDateForDayOfWeek]);

  // Handle task toggle
  const handleTaskToggle = useCallback(async (taskId: string, dayKey: string, currentlyCompleted: boolean) => {
    if (!userId) {
      Alert.alert(t('common:error'), t('progress:weeklyStatsErrorUserId'));
      return;
    }

    if (!isDayInPastOrToday(dayKey)) {
      Alert.alert(t('progress:weeklyStatsCannotLogTitle'), t('progress:weeklyStatsCannotLogBody'));
      return;
    }

    const completionDate = getDateForDayOfWeek(dayKey);
    if (!completionDate) {
      Alert.alert(t('common:error'), t('progress:weeklyStatsInvalidDate'));
      return;
    }

    if (savingTaskId === taskId) return;

    try {
      setSavingTaskId(taskId);
      const newCompletedStatus = !currentlyCompleted;
      
      await saveTaskCompletionToSupabase(userId, taskId, newCompletedStatus, completionDate);
      
      const updatedCompletions = await getWeeklyTaskCompletions(userId);
      setWeeklyTaskCompletions(updatedCompletions);
      
      if (onTaskCompletionChange) {
        onTaskCompletionChange();
      }
      
      glowLogger.info('Task completion toggled', {
        user_id: userId,
        step_id: taskId,
        completed: newCompletedStatus,
        completion_date: completionDate,
      });
    } catch (error) {
      glowLogger.error('Error toggling task completion', {
        error: error instanceof Error ? error.message : String(error),
      });
      Alert.alert(t('common:error'), t('progress:weeklyStatsSaveFailed'));
    } finally {
      setSavingTaskId(null);
    }
  }, [userId, getDateForDayOfWeek, isDayInPastOrToday, savingTaskId, onTaskCompletionChange, t]);

  const toggleDay = (dayKey: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      next.has(dayKey) ? next.delete(dayKey) : next.add(dayKey);
      return next;
    });
  };

  const renderDaySection = (day: typeof daysData[number]) => {
    const total = day.tasks.length;
    const completedCount = day.tasks.filter(t => t.completed).length;
    const progress = total ? completedCount / total : 0;
    const expanded = expandedDays.has(day.key);
    const labelText = (day.key === currentDayKey ? '→ ' : '') + day.label;

    return (
      <View key={day.key} style={styles.dayCard}>
        <TouchableOpacity
          style={styles.dayHeaderRow}
          activeOpacity={0.75}
          onPress={() => toggleDay(day.key)}
        >
          <Text style={styles.dayLabel}>{labelText}</Text>
          <Text style={[styles.dayChevron, expanded && styles.dayChevronExpanded]}>›</Text>
        </TouchableOpacity>
        <View style={styles.dayProgressWrapper}>
          <TaskCheckinProgressBar
            progress={progress}
            accessibilityLabel={`${day.label} ${Math.round(progress * 100)}%`}
          />
          {total > 0 && (
            <Text style={styles.dayProgressText}>
              {t('progress:weeklyStatsTasksProgress', { completed: completedCount, total })}
            </Text>
          )}
        </View>
        {expanded && total > 0 && (
          <View style={styles.tasksContainer}>
            {day.tasks.map(task => {
              const canLog = isDayInPastOrToday(day.key);
              const isSaving = savingTaskId === task.id;
              const isDisabled = !canLog || isSaving || !userId;
              
              return (
                <TouchableOpacity
                  key={task.id}
                  style={[styles.taskRow, isDisabled && styles.taskRowDisabled]}
                  onPress={() => !isDisabled && handleTaskToggle(task.id, day.key, task.completed)}
                  disabled={isDisabled}
                  activeOpacity={isDisabled ? 1 : 0.7}
                >
                  <Text style={styles.checkbox}>
                    {isSaving ? '⋯' : (task.completed ? '☑' : '☐')}
                  </Text>
                  <Text
                    style={[
                      styles.taskText,
                      task.completed && styles.taskTextCompleted,
                      isDisabled && styles.taskTextDisabled
                    ]}
                    numberOfLines={2}
                  >
                    {task.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {expanded && total === 0 && (
          <View style={styles.tasksContainer}>
            <Text style={styles.noTasksTextSmall}>{t('progress:weeklyStatsNoTasks')}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>{t('progress:weeklyStatsDone')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('progress:weeklyStatsTitle')}</Text>
        </View>
        <View style={styles.headerRight} />
      </View>
      
      <View style={styles.progressSection}>
        <CheckinProgressBar
          planProgress={planProgress}
          checkinProgress={checkinProgress}
          showChevron={false}
          showProgressText={true}
          progressTextStyle={{ marginTop: 8 }}
          debugSource="WeeklyStatsScreen"
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.streakText}>
            {t('progress:weeklyStatsStreak', { count: totalStreakDays })}
          </Text>
          {daysData.map(renderDaySection)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
