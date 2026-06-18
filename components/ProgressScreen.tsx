import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
  findNodeHandle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveOverlay } from '@/hooks/useActiveOverlay';

import { useTranslation } from 'react-i18next';
import { appIcons } from '../assets/icons';
import {
  deleteActivityLog,
  getActivityLogsForDateRange,
  getLatestUserWeightKg,
  updateActivityDate,
} from '../lib/activity-storage';
import {
  getLinkedActivityWorkoutInfo,
  getPendingLinkForActivity,
  resolveLink,
  setLinkCaloriesResolution,
  type LinkedActivityWorkoutInfo,
  type PendingLinkRow,
} from '../lib/activity-workout-links';
import {
  BodyCompositionChartData,
  DateRange,
  WeightUnit,
  getBodyCompositionLogs,
  getUserWeightPreference,
  setUserWeightPreference,
  syncBodyCompositionFromSupabase,
} from '../lib/body-composition-storage';
import { openCamera, openImageGallery } from '../lib/camera-helper';
import { getCurrentLoggedInUser } from '../lib/db';
import { pickAndSeedBodyTestData } from '../lib/dev-seed-body';
import { glowLogger } from '../lib/glow-logger';
import { humanizeActivityName, providerSourceUserFacingLabel, resolveMobileOsBucket } from '../lib/health-platform-copy';
import { refreshConsistencyScoreAfterLog } from '../lib/leaderboard-storage';
import { MealLog, deleteMealLog, getRecentMeals, saveMealLog, updateMealLogDate } from '../lib/nutrition-storage';
import { retryPendingBodyCompositions, retryPendingMealDeletions, retryPendingWorkoutDeletions } from '../lib/sync-status';
import { normalizeDecimalInput } from '../lib/validation';
import { sumWorkoutLogBurnedKcal } from '../lib/workout-energy';
import { deleteWorkoutLog, getWorkoutLogsForDateRange, updateWorkoutDate } from '../lib/workout-storage';
import { getExerciseCommentDisplay } from '../lib/workout-exercise-comments';
import { findBuiltinExerciseById } from '../lib/exercise-catalog';
import {
  formatStoredRepsForDisplay,
  isEnduranceDurationExercise,
  isEnduranceDurationExerciseById,
} from '../lib/exercise-duration';
import { Onboard } from '../types/onboard';
import { ActivityLog, ExerciseLog, WorkoutDayOption, WorkoutLog } from '../types/workout';
import BodyCompositionChart from './BodyCompositionChart';
import { Icon } from './Icon';
import { ImageLightbox, type LightboxImage } from './ImageLightbox';
import { LogDateSelector } from './LogDateSelector';
import NutritionStatsChart from './NutritionStatsChart';
import TrainingProgressCharts from './TrainingProgressCharts';
import { WeeklyLogModal } from './WeeklyLogModal';
import WeightBarChart from './WeightBarChart';
import { WorkoutDaySelector, extractWorkoutOptionsFromPlan } from './WorkoutDaySelector';
import type { ActivityLogPrefill } from './ActivityLogModal';
import { SourceBadge } from './SourceBadge';
import LinkActivityPill from './LinkActivityPill';
import { LinkReviewModal } from './LinkReviewModal';

const { width: screenWidth } = Dimensions.get('window');
const chartWidth = Math.min(screenWidth - 32, 380);

// Progress tab types
type ProgressTab = 'Body' | 'Nutrition' | 'Training';
const PROGRESS_TABS: ProgressTab[] = ['Body', 'Nutrition', 'Training'];

type FilterOption = { label: string; value: DateRange };
const filterOptions: FilterOption[] = [
  { label: 'Last 30 days', value: '30days' },
  { label: 'Last 3 months', value: '3months' },
  { label: 'Last 6 months', value: '6months' },
];

const displayActivityName = (activity: ActivityLog): string =>
  activity.source && activity.source !== 'manual'
    ? humanizeActivityName(activity.activityName)
    : activity.activityName;

/** Same calendar day: order by wall-clock recency (most recent first). */
function getTrainingRecentSortTimeMs(
  type: 'workout' | 'activity',
  data: WorkoutLog | ActivityLog,
): number {
  if (type === 'workout') {
    const w = data as WorkoutLog;
    const iso = w.updatedAt || w.createdAt;
    if (iso) return new Date(iso).getTime();
    return new Date(`${w.workoutDate}T12:00:00`).getTime();
  }
  const a = data as ActivityLog;
  const iso = a.endedAt || a.startedAt || a.updatedAt || a.createdAt;
  if (iso) return new Date(iso).getTime();
  return new Date(`${a.activityDate}T12:00:00`).getTime();
}

// Placeholder component for coming soon tabs
const ComingSoonPlaceholder: React.FC<{ title: string }> = ({ title }) => (
  <View style={styles.placeholderContainer}>
    <Text style={styles.placeholderIcon}>🚧</Text>
    <Text style={styles.placeholderTitle}>{title} Tracking</Text>
    <Text style={styles.placeholderText}>Coming Soon</Text>
    <Text style={styles.placeholderDescription}>
      We're working hard to bring you {title.toLowerCase()} tracking features. 
      Stay tuned for updates!
    </Text>
  </View>
);

interface ProgressScreenProps {
  /** The user's plan/profile — source for workout options without a remote fetch. */
  onboardingData: Onboard;
  onNavigateToChat?: () => void;
  onNavigateToChatWithMealImage?: (imageUri: string) => void;
  onNavigateToChatWithMessage?: (message: string) => void;
  /** Opens the global workout log modal (e.g. log again from recent workouts). */
  onOpenWorkoutLog?: (option: WorkoutDayOption, existingWorkoutLogId?: number) => void;
  onRelogMeal?: (meal: MealLog) => void;
  /** Opens the global activity log modal (e.g. log again from recent activities). */
  onOpenActivityLog?: (prefill: ActivityLogPrefill) => void;
  /** Bumps when activity/workout logs change elsewhere so Training recent list can refresh. */
  dataVersion?: number;
  /** Notify parent that user data changed (e.g. delete/edit of meal/workout/activity) so dashboards can refresh. */
  onUserDataChanged?: () => void;
  coachName?: string;
  plannedTrainingDays?: string[];
  onShowStreak?: () => void;
  /**
   * Opens the global "Share on UnderForge Social" composer for either a
   * workout or a cardio/sport activity. Pass either the local workout id pair
   * or the local activity id pair (with best-effort Supabase ids); the
   * composer figures out the rest from the local SQLite snapshot.
   */
  onShareToSocial?: (payload: {
    localWorkoutLogId?: number | null;
    supabaseWorkoutLogId?: number | null;
    localActivityLogId?: number | null;
    supabaseActivityLogId?: number | null;
    displayTitle: string;
  }) => void | Promise<void>;
  initialNutritionView?: 'trends' | 'recent';
  initialTrainingView?: 'trends' | 'recent';
  /** After weekly body log, scroll Body tab so weight + composition charts are in view. */
  initialBodyScrollToCharts?: boolean;
  onInitialBodyScrollToChartsConsumed?: () => void;
}

export const ProgressScreen: React.FC<ProgressScreenProps> = ({
  onboardingData,
  onNavigateToChat,
  onNavigateToChatWithMealImage,
  onNavigateToChatWithMessage,
  onOpenWorkoutLog,
  onRelogMeal,
  onOpenActivityLog,
  dataVersion = 0,
  onUserDataChanged,
  coachName,
  plannedTrainingDays = [],
  initialNutritionView,
  initialTrainingView,
  initialBodyScrollToCharts,
  onInitialBodyScrollToChartsConsumed,
  onShowStreak,
  onShareToSocial,
}) => {
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<ProgressTab>('Body');
  const [dateRange, setDateRange] = useState<DateRange>('30days');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [chartData, setChartData] = useState<BodyCompositionChartData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState(0);
  const [isLogModalVisible, setIsLogModalVisible] = useState(false);
  const [isMealLogModalVisible, setIsMealLogModalVisible] = useState(false);
  const [showMealLogOptions, setShowMealLogOptions] = useState(true);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const {
    isOpen: showFilterDropdown,
    closeSelf: closeFilterDropdown,
    toggle: toggleFilterDropdown,
  } = useActiveOverlay('progress.filter');
  const [mealDescription, setMealDescription] = useState('');
  const [mealCarbs, setMealCarbs] = useState('');
  const [mealProtein, setMealProtein] = useState('');
  const [mealFat, setMealFat] = useState('');
  const [mealFiber, setMealFiber] = useState('');
  const [mealCalories, setMealCalories] = useState('');

  // Training tab state
  const [workoutOptions, setWorkoutOptions] = useState<WorkoutDayOption[]>([]);
  const [recentWorkouts, setRecentWorkouts] = useState<WorkoutLog[]>([]);
  const [trainingWorkoutLogs, setTrainingWorkoutLogs] = useState<WorkoutLog[]>([]);
  const [hasLoadedTrainingData, setHasLoadedTrainingData] = useState(false);
  const [showWorkoutSelector, setShowWorkoutSelector] = useState(false);
  const [isTrainingLoading, setIsTrainingLoading] = useState(false);
  const [chartsMountReady, setChartsMountReady] = useState(false);
  const [recentActivities, setRecentActivities] = useState<ActivityLog[]>([]);
  const [linkedWorkoutInfoByActivityId, setLinkedWorkoutInfoByActivityId] = useState<Map<number, LinkedActivityWorkoutInfo>>(new Map());
  const [linkReviewRow, setLinkReviewRow] = useState<PendingLinkRow | null>(null);
  const [linkReviewVisible, setLinkReviewVisible] = useState(false);
  const [linkReviewBusyId, setLinkReviewBusyId] = useState<number | null>(null);
  const [trainingWeightKg, setTrainingWeightKg] = useState(70);
  const [expandedWorkouts, setExpandedWorkouts] = useState<Set<string>>(new Set());
  const [trainingView, setTrainingView] = useState<'trends' | 'recent'>('trends');
  /** Set when routing to Training → Trends after a workout; outer scroll executes once loading finishes. */
  const scrollToTrainingOnLoadRef = useRef(false);
  const scrollBodyChartsToTopRef = useRef(false);
  const mainScrollRef = useRef<ScrollView>(null);
  /** Filters row inside TrainingProgressCharts; we scroll the outer ScrollView so this sits at the top, "skipping" the steps card. */
  const trainingFiltersRef = useRef<View | null>(null);
  /** Body tab charts block; scroll here so weight chart is at top and composition chart remains visible. */
  const bodyChartsRef = useRef<View | null>(null);

  // Nutrition tab state
  const [nutritionView, setNutritionView] = useState<'trends' | 'recent'>('trends');
  const [recentMeals, setRecentMeals] = useState<MealLog[]>([]);
  const [expandedMeals, setExpandedMeals] = useState<Set<number>>(new Set());
  const [isNutritionLoading, setIsNutritionLoading] = useState(false);

  // Date editing state (shared for meals and workouts)
  const [editingDateItemId, setEditingDateItemId] = useState<string | null>(null);
  const [editingDateValue, setEditingDateValue] = useState<string>('');

  const { t } = useTranslation(['progress', 'common', 'main', 'bodylog']);
  const insets = useSafeAreaInsets();
  const sheetBottomPadding = Math.max(24, insets.bottom + 16);

  useEffect(() => {
    if (initialNutritionView) {
      setNutritionView(initialNutritionView);
      setSelectedTab('Nutrition');
    }
  }, [initialNutritionView]);

  useEffect(() => {
    if (initialTrainingView) {
      setTrainingView(initialTrainingView);
      setSelectedTab('Training');
      if (initialTrainingView === 'trends') {
        scrollToTrainingOnLoadRef.current = true;
      }
    }
  }, [initialTrainingView]);

  useEffect(() => {
    if (initialBodyScrollToCharts) {
      setSelectedTab('Body');
      scrollBodyChartsToTopRef.current = true;
      onInitialBodyScrollToChartsConsumed?.();
    }
  }, [initialBodyScrollToCharts, onInitialBodyScrollToChartsConsumed]);

  useEffect(() => {
    if (!scrollBodyChartsToTopRef.current) return;
    if (!userId || selectedTab !== 'Body' || isLoading) return;
    scrollBodyChartsToTopRef.current = false;

    const tryScrollToCharts = (attempt = 0) => {
      const scrollHandle =
        findNodeHandle((mainScrollRef.current as any)?.getInnerViewNode?.() ?? mainScrollRef.current);
      const chartsHandle = findNodeHandle(bodyChartsRef.current as any);
      if (scrollHandle == null || chartsHandle == null) {
        if (attempt < 10) setTimeout(() => tryScrollToCharts(attempt + 1), 120);
        return;
      }
      UIManager.measureLayout(
        chartsHandle,
        scrollHandle,
        () => {
          if (attempt < 10) setTimeout(() => tryScrollToCharts(attempt + 1), 120);
        },
        (_x: number, y: number) => {
          mainScrollRef.current?.scrollTo({ y, animated: true });
        },
      );
    };
    setTimeout(tryScrollToCharts, 100);
  }, [userId, selectedTab, isLoading, chartData]);

  useEffect(() => {
    if (!scrollToTrainingOnLoadRef.current) return;
    if (!userId || selectedTab !== 'Training' || trainingView !== 'trends' || isTrainingLoading) return;
    scrollToTrainingOnLoadRef.current = false;

    const tryScrollToFilters = (attempt = 0) => {
      const scrollHandle =
        findNodeHandle((mainScrollRef.current as any)?.getInnerViewNode?.() ?? mainScrollRef.current);
      const filtersHandle = findNodeHandle(trainingFiltersRef.current as any);
      if (scrollHandle == null || filtersHandle == null) {
        if (attempt < 10) setTimeout(() => tryScrollToFilters(attempt + 1), 120);
        return;
      }
      UIManager.measureLayout(
        filtersHandle,
        scrollHandle,
        () => {
          if (attempt < 10) setTimeout(() => tryScrollToFilters(attempt + 1), 120);
        },
        (_x: number, y: number) => {
          mainScrollRef.current?.scrollTo({ y, animated: true });
        },
      );
    };
    setTimeout(tryScrollToFilters, 100);
  }, [userId, selectedTab, trainingView, isTrainingLoading]);

  // Load user and initial data
  useEffect(() => {
    const loadUserAndData = async () => {
      try {
        const user = await getCurrentLoggedInUser();
        if (user) {
          setUserId(user.id);
          const preference = await getUserWeightPreference(user.id);
          setWeightUnit(preference);
          
          // Retry any pending body composition syncs when screen loads
          retryPendingBodyCompositions().then(result => {
            if (result.succeeded > 0) {
              console.log(`Synced ${result.succeeded} pending body composition entries`);
              // Data will refresh automatically when chart loads
            }
          }).catch(error => {
            console.error('Error retrying body composition syncs:', error);
          });
        }
      } catch (error) {
        console.error('Error loading user:', error);
      }
    };
    loadUserAndData();
  }, []);

  // Load chart data when userId or dateRange changes
  const loadChartData = useCallback(async () => {
    if (!userId) return;
    
    setIsLoading(true);
    try {
      // Sync from Supabase first to ensure local cache has all remote data
      await syncBodyCompositionFromSupabase(userId);
      
      const data = await getBodyCompositionLogs(userId, dateRange);
      setChartData(data);
    } catch (error) {
      console.error('Error loading chart data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, dateRange]);

  useEffect(() => {
    loadChartData();
  }, [loadChartData]);

  // When we land here straight after logging (e.g. the home quick-log), refresh
  // so the just-saved entry and its new photo thumbnail appear immediately.
  useEffect(() => {
    if (initialBodyScrollToCharts) {
      loadChartData();
    }
  }, [initialBodyScrollToCharts, loadChartData]);

  // Load training data when tab is selected
  const loadTrainingData = useCallback(async () => {
    if (!userId || selectedTab !== 'Training') return;

    setIsTrainingLoading(true);
    try {
      // Workout options come from the user's plan, already in local state via the
      // onboardingData prop — no remote fetch, no blocking network round-trip.
      const planSteps = onboardingData?.actionPlan?.steps;
      if (planSteps) {
        setWorkoutOptions(extractWorkoutOptionsFromPlan(planSteps));
      }

      // Load recent completed workouts (last 3 months / 90 days)
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const startDate = `${ninetyDaysAgo.getFullYear()}-${String(ninetyDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(ninetyDaysAgo.getDate()).padStart(2, '0')}`;
      const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      
      retryPendingWorkoutDeletions().catch(() => {});
      const weightKg =
        (await getLatestUserWeightKg(userId).catch(() => undefined)) ?? 70;
      setTrainingWeightKg(weightKg);
      const recent = await getWorkoutLogsForDateRange(userId, startDate, endDate, true);
      setTrainingWorkoutLogs(recent);
      setRecentWorkouts(recent.filter(w => w.status === 'completed'));

      // Load recent activity logs (cardio, sports, etc.) — local-only for instant paint.
      const activities = await getActivityLogsForDateRange(userId, startDate, endDate, true);

      // Hydrate map of (activity_id → linked workout info) for the "Linked to" caption.
      const linkedInfo = await getLinkedActivityWorkoutInfo(userId, startDate, endDate);
      setLinkedWorkoutInfoByActivityId(linkedInfo);

      // Keep wearable rows the user merged with a workout_log visible: they show a
      // "Linked to <workout>" caption (plus "(pending confirmation)" until reviewed)
      // so the imported session is still discoverable alongside its workout card.
      setRecentActivities(activities);
    } catch (error) {
      console.error('Error loading training data:', error);
    } finally {
      setIsTrainingLoading(false);
      setHasLoadedTrainingData(true);
    }
  }, [userId, selectedTab, onboardingData]);

  const refreshAfterLinkReview = useCallback(() => {
    loadTrainingData().catch(() => {});
    onUserDataChanged?.();
  }, [loadTrainingData, onUserDataChanged]);

  const openLinkReviewForActivity = useCallback(async (activityId: number) => {
    const row = await getPendingLinkForActivity(activityId);
    if (!row) return;
    setLinkReviewRow(row);
    setLinkReviewVisible(true);
  }, []);

  const closeLinkReviewModal = useCallback(() => {
    setLinkReviewVisible(false);
    setLinkReviewRow(null);
  }, []);

  const handleLinkReviewResolve = useCallback(
    async (state: 'linked' | 'separated') => {
      if (!linkReviewRow || linkReviewBusyId) return;
      setLinkReviewBusyId(linkReviewRow.id);
      try {
        await resolveLink(linkReviewRow.id, state);
        closeLinkReviewModal();
        refreshAfterLinkReview();
      } finally {
        setLinkReviewBusyId(null);
      }
    },
    [closeLinkReviewModal, linkReviewBusyId, linkReviewRow, refreshAfterLinkReview],
  );

  const handleLinkReviewSetResolution = useCallback(
    async (resolution: 'wearable' | 'uf' | 'average') => {
      if (!linkReviewRow || linkReviewBusyId) return;
      setLinkReviewBusyId(linkReviewRow.id);
      try {
        await setLinkCaloriesResolution(linkReviewRow.id, resolution);
        closeLinkReviewModal();
        refreshAfterLinkReview();
      } finally {
        setLinkReviewBusyId(null);
      }
    },
    [closeLinkReviewModal, linkReviewBusyId, linkReviewRow, refreshAfterLinkReview],
  );

  useEffect(() => {
    if (selectedTab === 'Training') {
      loadTrainingData();
    }
  }, [loadTrainingData, dataVersion, selectedTab]);

  useEffect(() => {
    if (
      selectedTab !== 'Training' ||
      trainingView !== 'trends' ||
      isTrainingLoading ||
      !hasLoadedTrainingData
    ) {
      setChartsMountReady(false);
      return;
    }
    if (Platform.OS === 'android') {
      const timer = setTimeout(() => setChartsMountReady(true), 250);
      return () => clearTimeout(timer);
    }
    setChartsMountReady(true);
  }, [selectedTab, trainingView, isTrainingLoading, hasLoadedTrainingData]);

  // Load recent meals when Nutrition tab is selected
  const loadRecentMeals = useCallback(async () => {
    if (!userId || selectedTab !== 'Nutrition') return;

    setIsNutritionLoading(true);
    try {
      retryPendingMealDeletions().catch(() => {});
      const meals = await getRecentMeals(userId, 50);
      setRecentMeals(meals);
    } catch (error) {
      console.error('Error loading recent meals:', error);
    } finally {
      setIsNutritionLoading(false);
    }
  }, [userId, selectedTab]);

  useEffect(() => {
    loadRecentMeals();
  }, [loadRecentMeals, dataVersion]);

  const toggleMealExpansion = (mealId: number) => {
    const newExpanded = new Set(expandedMeals);
    if (newExpanded.has(mealId)) {
      newExpanded.delete(mealId);
    } else {
      newExpanded.add(mealId);
    }
    setExpandedMeals(newExpanded);
  };

  const handleDeleteMeal = (meal: MealLog) => {
    Alert.alert(
      t('progress:deleteMealTitle'),
      t('progress:deleteMealBody'),
      [
        { text: t('progress:deleteMealCancel'), style: 'cancel' },
        {
          text: t('progress:deleteMealConfirm'),
          style: 'destructive',
          onPress: async () => {
            if (!userId) return;
            const success = await deleteMealLog(userId, meal.id, meal.supabaseId, meal.logDate);
            if (success) {
              setRecentMeals(prev => prev.filter(m => m.id !== meal.id));
              onUserDataChanged?.();
            }
          },
        },
      ]
    );
  };

  const handleRelogActivity = (activity: ActivityLog) => {
    if (!onOpenActivityLog) return;
    onOpenActivityLog({
      activityType: activity.activityType,
      activityName: activity.activityType === 'custom' ? activity.activityName : undefined,
      durationMinutes: activity.durationMinutes,
      intensity: activity.intensity,
      distanceValue: activity.distanceValue,
      distanceUnit: activity.distanceUnit,
      elevationGain: activity.elevationGain,
      notes: activity.notes,
    });
  };

  const handleDeleteActivity = (activity: ActivityLog) => {
    const localId = activity.id;
    if (localId == null || !userId) return;
    Alert.alert(
      t('progress:deleteActivityTitle'),
      t('progress:deleteActivityBody'),
      [
        { text: t('progress:deleteActivityCancel'), style: 'cancel' },
        {
          text: t('progress:deleteActivityConfirm'),
          style: 'destructive',
          onPress: async () => {
            const success = await deleteActivityLog(userId, localId);
            if (success) {
              setRecentActivities(prev => prev.filter(a => a.id !== localId));
              setExpandedWorkouts(prev => {
                const next = new Set(prev);
                next.delete(`activity_${localId}`);
                return next;
              });
              if (editingDateItemId === `activity_${localId}`) {
                setEditingDateItemId(null);
              }
              onUserDataChanged?.();
            }
          },
        },
      ]
    );
  };

  const handleActivityDateChange = async (activityId: number, oldDate: string, newDate: string) => {
    if (!userId || newDate === oldDate) {
      setEditingDateItemId(null);
      return;
    }
    glowLogger.info('Activity date changed', { activity_id: activityId, old_date: oldDate, new_date: newDate });
    const ok = await updateActivityDate(userId, activityId, newDate);
    if (ok) {
      setRecentActivities(prev =>
        prev.map(a => (a.id === activityId ? { ...a, activityDate: newDate } : a))
      );
      onUserDataChanged?.();
    }
    setEditingDateItemId(null);
  };

  const handleDeleteWorkout = (workout: WorkoutLog) => {
    const workoutLocalId = workout.id;
    const workoutUserId = workout.userId;
    if (workoutLocalId == null || !workoutUserId) return;
    Alert.alert(
      t('progress:deleteWorkoutTitle'),
      t('progress:deleteWorkoutBody'),
      [
        { text: t('progress:deleteWorkoutCancel'), style: 'cancel' },
        {
          text: t('progress:deleteWorkoutConfirm'),
          style: 'destructive',
          onPress: async () => {
            const success = await deleteWorkoutLog(workoutUserId, workoutLocalId);
            if (success) {
              setRecentWorkouts(prev => prev.filter(w => w.id !== workoutLocalId));
              setExpandedWorkouts(prev => {
                const next = new Set(prev);
                next.delete(String(workoutLocalId));
                return next;
              });
              onUserDataChanged?.();
            }
          },
        },
      ]
    );
  };

  // Handle workout day selection
  const handleWorkoutSelect = (option: WorkoutDayOption) => {
    setShowWorkoutSelector(false);
    onOpenWorkoutLog?.(option);
  };

  const toggleWorkoutExpansion = (workoutId: string) => {
    const newExpanded = new Set(expandedWorkouts);
    if (newExpanded.has(workoutId)) {
      newExpanded.delete(workoutId);
    } else {
      newExpanded.add(workoutId);
    }
    setExpandedWorkouts(newExpanded);
  };

  const handleRelogWorkout = (workout: WorkoutLog) => {
    glowLogger.info('Relog workout tapped', {
      workout_id: workout.id,
      workout_day: workout.workoutDayName,
      exercise_count: workout.exercises?.length ?? 0,
    });

    const exerciseMap = new Map<string, { exercise: ExerciseLog; sets: number; maxReps: string }>();
    for (const ex of (workout.exercises || [])) {
      const existing = exerciseMap.get(ex.exerciseId);
      if (existing) {
        existing.sets += 1;
        if (ex.reps && (!existing.maxReps || Number(ex.reps) > Number(existing.maxReps))) {
          existing.maxReps = String(ex.reps);
        }
      } else {
        exerciseMap.set(ex.exerciseId, {
          exercise: ex,
          sets: 1,
          maxReps: ex.reps ? String(ex.reps) : '',
        });
      }
    }

    const option: WorkoutDayOption = {
      stepId: workout.stepId || `relog_${workout.id}`,
      dayName: workout.workoutDayName,
      exercises: Array.from(exerciseMap.values()).map(({ exercise, sets, maxReps }) => ({
        exerciseId: exercise.exerciseId,
        name: exercise.exerciseName,
        sets,
        reps: maxReps,
        restTimeSeconds: exercise.restTimeSeconds,
        rir: exercise.rir,
      })),
    };

    onOpenWorkoutLog?.(option);
  };

  const handleMealDateChange = async (mealId: number, oldDate: string, newDate: string) => {
    if (!userId || newDate === oldDate) {
      setEditingDateItemId(null);
      return;
    }
    glowLogger.info('Meal date changed', { meal_id: mealId, old_date: oldDate, new_date: newDate });
    const success = await updateMealLogDate(userId, mealId, newDate, oldDate);
    if (success) {
      setRecentMeals(prev => prev.map(m => m.id === mealId ? { ...m, logDate: newDate } : m));
      onUserDataChanged?.();
    }
    setEditingDateItemId(null);
  };

  const handleWorkoutDateChange = async (workoutId: number, oldDate: string, newDate: string) => {
    if (!userId || newDate === oldDate) {
      setEditingDateItemId(null);
      return;
    }
    glowLogger.info('Workout date changed', { workout_id: workoutId, old_date: oldDate, new_date: newDate });
    await updateWorkoutDate(workoutId, newDate);
    setRecentWorkouts(prev => prev.map(w => w.id === workoutId ? { ...w, workoutDate: newDate } : w));
    onUserDataChanged?.();
    setEditingDateItemId(null);
  };

  const handleFilterSelect = (value: DateRange) => {
    setDateRange(value);
    closeFilterDropdown();
  };

  const handleWeightUnitToggle = async () => {
    const newUnit: WeightUnit = weightUnit === 'kg' ? 'lbs' : 'kg';
    setWeightUnit(newUnit);
    if (userId) {
      await setUserWeightPreference(userId, newUnit);
    }
  };

  const handleLogSave = () => {
    loadChartData();
    setSelectedTab('Body');
    scrollBodyChartsToTopRef.current = true;
  };

  // Flat, full-size gallery built from every logged week's photos (front, then
  // side, then back). Tapping a chart thumbnail opens this viewer at that week.
  const bodyPhotoGallery = useMemo<LightboxImage[]>(() => {
    const items: LightboxImage[] = [];
    for (const entry of chartData) {
      const weekNum = parseInt(entry.weekLabel.replace(/\D/g, ''), 10);
      const angles: ['front' | 'side' | 'back', string | null | undefined][] = [
        ['front', entry.photoFrontUrl],
        ['side', entry.photoSideUrl],
        ['back', entry.photoBackUrl],
      ];
      for (const [angle, url] of angles) {
        if (url) {
          items.push({
            uri: url,
            caption: t('progress:photoViewerCaption', {
              week: weekNum,
              angle: t(`bodylog:photoAngle_${angle}`),
            }),
          });
        }
      }
    }
    return items;
  }, [chartData, t]);

  const handleBodyPhotoPress = useCallback((entry: BodyCompositionChartData) => {
    if (!entry.photoFrontUrl) return;
    const idx = bodyPhotoGallery.findIndex(item => item.uri === entry.photoFrontUrl);
    setPhotoViewerIndex(idx >= 0 ? idx : 0);
    setPhotoViewerVisible(true);
  }, [bodyPhotoGallery]);

  // DEV-only: pick photos and write back-dated weekly logs to exercise charts.
  const handleSeedBodyTestData = useCallback(async () => {
    if (!userId) return;
    const count = await pickAndSeedBodyTestData(userId);
    if (count > 0) {
      await loadChartData();
      Alert.alert('Seeded', `Inserted ${count} weekly body logs.`);
    }
  }, [userId, loadChartData]);

  const handlePhotoMealLog = async () => {
    setIsMealLogModalVisible(false);
    
    // Navigate to chat first
    if (onNavigateToChat) {
      onNavigateToChat();
    }

    // Then open camera and process (full photo source selection is in ChatScreen)
    const imageUri = await openCamera();
    if (imageUri && onNavigateToChatWithMealImage) {
      onNavigateToChatWithMealImage(imageUri);
    }
  };

  const handleManualMealLog = () => {
    setIsMealLogModalVisible(false);
    
    // Navigate to chat with prefilled message
    if (onNavigateToChatWithMessage) {
      onNavigateToChatWithMessage(t('main:prefilledMealMessage'));
    }
  };

  const handleMealLogSave = async () => {
    if (!userId) return;

    // Validate inputs
    const carbs = parseFloat(mealCarbs) || 0;
    const protein = parseFloat(mealProtein) || 0;
    const fat = parseFloat(mealFat) || 0;
    const fiber = parseFloat(mealFiber) || 0;
    const calories = parseFloat(mealCalories) || 0;

    if (!mealDescription.trim()) {
      Alert.alert(t('common:error'), t('progress:mealErrorEnterDesc'));
      return;
    }

    if (carbs === 0 && protein === 0 && fat === 0 && calories === 0) {
      Alert.alert(t('common:error'), t('progress:mealErrorEnterValue'));
      return;
    }

    // Calculate calories if not provided
    const finalCalories = calories > 0 ? calories : Math.round(carbs * 4 + protein * 4 + fat * 9);

    try {
      const success = await saveMealLog(
        userId,
        mealDescription.trim(),
        carbs,
        protein,
        fat,
        fiber,
        finalCalories
      );

      if (success) {
        // Recompute + upload the leaderboard score (no-op when this meal can't
        // change the capped score, e.g. the 4th meal of the day).
        refreshConsistencyScoreAfterLog(userId).catch(() => {});
        Alert.alert(t('common:done'), t('progress:mealSuccess'));
        // Reset form
        setMealDescription('');
        setMealCarbs('');
        setMealProtein('');
        setMealFat('');
        setMealFiber('');
        setMealCalories('');
        setIsMealLogModalVisible(false);
        setShowMealLogOptions(true);
        loadRecentMeals();
        onUserDataChanged?.();
      } else {
        Alert.alert(t('common:error'), t('progress:mealFailed'));
      }
    } catch (error) {
      console.error('Error logging meal:', error);
      Alert.alert(t('common:error'), t('progress:mealFailed'));
    }
  };

  const getFilterLabel = (value: DateRange) => {
    switch (value) {
      case '30days':
        return t('progress:filterLast30Days');
      case '3months':
        return t('progress:filterLast3Months');
      case '6months':
        return t('progress:filterLast6Months');
      default:
        return value;
    }
  };

  const selectedFilter = filterOptions.find(f => f.value === dateRange) || filterOptions[0];

  if (!userId) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>{t('progress:loading')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView 
        ref={mainScrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('progress:title')}</Text>
        </View>

        {/* Tab Bar */}
        <View style={styles.tabBar}>
          {PROGRESS_TABS.map((tab, index) => {
            // Map tabs to icons
            const iconMap = {
              'Body': appIcons.accessibility,
              'Nutrition': appIcons.nutrition,
              'Training': appIcons.training,
            };
            const iconSource = iconMap[tab as keyof typeof iconMap];
            const isSelected = selectedTab === tab;

            return (
              <TouchableOpacity
                key={tab}
                style={[
                  styles.tabButton,
                  isSelected && styles.tabButtonSelected,
                  index === PROGRESS_TABS.length - 1 && styles.tabButtonLast
                ]}
                onPress={() => {
                  if (tab === 'Training' && selectedTab !== 'Training') {
                    setIsTrainingLoading(true);
                    setChartsMountReady(false);
                  }
                  setSelectedTab(tab);
                }}
              >
                <Icon 
                  source={iconSource} 
                  width={19} 
                  height={19} 
                  fill={isSelected ? '#FFFFFF' : '#9AA3A6'} 
                />
                <Text style={[
                  styles.tabButtonText,
                  isSelected && styles.tabButtonTextSelected
                ]}>
                  {tab === 'Body' ? t('progress:tabBody') : tab === 'Nutrition' ? t('progress:tabNutrition') : t('progress:tabTraining')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Body Tab Content */}
        {selectedTab === 'Body' && (
          <>
            {/* Filter Row */}
            <View style={styles.filterRow}>
              <View style={styles.filterContainer}>
                <TouchableOpacity
                  style={styles.filterButton}
                  onPress={() => toggleFilterDropdown()}
                >
                  <Text style={styles.filterButtonText}>{getFilterLabel(selectedFilter.value)}</Text>
                  <Text style={styles.filterArrow}>{showFilterDropdown ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {showFilterDropdown && (
                  <View style={styles.dropdown}>
                    {filterOptions.map((option) => (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.dropdownItem,
                          option.value === dateRange && styles.dropdownItemSelected
                        ]}
                        onPress={() => handleFilterSelect(option.value)}
                      >
                        <Text style={[
                          styles.dropdownItemText,
                          option.value === dateRange && styles.dropdownItemTextSelected
                        ]}>
                          {getFilterLabel(option.value)}
                        </Text>
                        {option.value === dateRange && (
                          <Text style={styles.checkmark}>✓</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={styles.unitToggleSmall}
                onPress={handleWeightUnitToggle}
              >
                <Text style={styles.unitToggleLabel}>{t('progress:weightLabel')}</Text>
                <Text style={styles.unitToggleValue}>{weightUnit}</Text>
              </TouchableOpacity>
            </View>

            {/* Close dropdown when clicking outside */}
            {showFilterDropdown && (
              <TouchableOpacity
                style={styles.dropdownOverlay}
                onPress={closeFilterDropdown}
                activeOpacity={1}
              />
            )}

            {/* DEV-only: seed back-dated weekly logs from picked photos. */}
            {__DEV__ && (
              <TouchableOpacity style={styles.devSeedButton} onPress={handleSeedBodyTestData}>
                <Text style={styles.devSeedButtonText}>🌱 Seed test logs (DEV)</Text>
              </TouchableOpacity>
            )}

            {/* Charts */}
            <View ref={bodyChartsRef} style={styles.chartsContainer}>
              {isLoading ? (
                <View style={styles.loadingContainer}>
                  <Text style={styles.loadingText}>{t('progress:loadingData')}</Text>
                </View>
              ) : (
                <>
                  <WeightBarChart
                    data={chartData}
                    displayUnit={weightUnit}
                    dateRange={dateRange}
                    width={chartWidth}
                    onPhotoPress={handleBodyPhotoPress}
                  />
                  <BodyCompositionChart
                    data={chartData}
                    dateRange={dateRange}
                    width={chartWidth}
                  />
                </>
              )}
            </View>

            {/* Tips Section */}
            {chartData.length === 0 && !isLoading && (
              <View style={styles.tipsContainer}>
                <Text style={styles.tipsTitle}>{t('progress:tipsTitle')}</Text>
                <Text style={styles.tipsText}>{t('progress:tipsBody')}</Text>
                <View style={styles.tipsList}>
                  <Text style={styles.tipItem}>{t('progress:tipsBullet1')}</Text>
                  <Text style={styles.tipItem}>{t('progress:tipsBullet2')}</Text>
                  <Text style={styles.tipItem}>{t('progress:tipsBullet3')}</Text>
                </View>
              </View>
            )}
          </>
        )}

        {/* Nutrition Tab Content */}
        {selectedTab === 'Nutrition' && (
          <View style={styles.trainingContainer}>
            {/* View Toggle */}
            <View style={styles.viewToggleContainer}>
              <TouchableOpacity
                style={[styles.viewToggleButton, nutritionView === 'trends' && styles.viewToggleButtonActive]}
                onPress={() => setNutritionView('trends')}
              >
                <Text style={[styles.viewToggleText, nutritionView === 'trends' && styles.viewToggleTextActive]}>
                  {t('progress:trendsSection')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewToggleButton, nutritionView === 'recent' && styles.viewToggleButtonActive]}
                onPress={() => setNutritionView('recent')}
              >
                <Text style={[styles.viewToggleText, nutritionView === 'recent' && styles.viewToggleTextActive]}>
                  {t('progress:recentMeals')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Trends View */}
            {nutritionView === 'trends' && (
              <NutritionStatsChart userId={userId} />
            )}

            {/* Recent Meals View */}
            {nutritionView === 'recent' && (
              <>
                {isNutritionLoading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#F47C3C" />
                    <Text style={styles.loadingText}>{t('progress:loadingMeals')}</Text>
                  </View>
                ) : recentMeals.length === 0 ? (
                  <View style={styles.trainingEmptyState}>
                    <Text style={styles.trainingEmptyTitle}>{t('progress:noMealsTitle')}</Text>
                    <Text style={styles.trainingEmptyText}>{t('progress:noMealsSubtitle')}</Text>
                  </View>
                ) : (
                  <View style={styles.recentMealsSection}>
                    {(() => {
                      const groupMap = new Map<string, { date: string; label: string; meals: MealLog[] }>();
                      const today = new Date();
                      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                      const yesterday = new Date(today);
                      yesterday.setDate(yesterday.getDate() - 1);
                      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
                      for (const meal of recentMeals) {
                        let group = groupMap.get(meal.logDate);
                        if (!group) {
                          const d = new Date(meal.logDate + 'T12:00:00');
                          let label: string;
                          if (meal.logDate === todayStr) {
                            label = t('progress:dateToday');
                          } else if (meal.logDate === yesterdayStr) {
                            label = t('progress:dateYesterday');
                          } else {
                            label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                          }
                          group = { date: meal.logDate, label, meals: [] };
                          groupMap.set(meal.logDate, group);
                        }
                        group.meals.push(meal);
                      }
                      for (const g of groupMap.values()) {
                        g.meals.sort((m1, m2) => m2.loggedAt.getTime() - m1.loggedAt.getTime());
                      }
                      const grouped = Array.from(groupMap.values()).sort((a, b) => b.date.localeCompare(a.date));
                      return grouped.map(group => (
                        <View key={group.date} style={styles.mealDateGroup}>
                          <Text style={styles.mealDateHeader}>{group.label}</Text>
                          {group.meals.map(meal => {
                            const isExpanded = expandedMeals.has(meal.id);
                            return (
                              <TouchableOpacity
                                key={meal.id}
                                style={styles.mealCard}
                                onPress={() => toggleMealExpansion(meal.id)}
                                onLongPress={() => handleDeleteMeal(meal)}
                                activeOpacity={0.7}
                              >
                                <View style={styles.mealCardHeader}>
                                  <View style={styles.mealCardTitleRow}>
                                    <Text style={styles.mealCardIcon}>
                                      {isExpanded ? '▼' : '▶'}
                                    </Text>
                                    <View style={{ flex: 1 }}>
                                      <View style={styles.mealCardNameRow}>
                                        <Text style={[styles.mealCardTitle, { flex: 1 }]} numberOfLines={isExpanded ? undefined : 1}>
                                          {meal.mealDescription}
                                        </Text>
                                        <Text style={styles.mealCalInline}>{meal.calories} kcal</Text>
                                      </View>
                                      <Text style={styles.mealCardTime}>
                                        {meal.loggedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                      </Text>
                                    </View>
                                    <TouchableOpacity
                                      style={styles.mealRelogButton}
                                      onPress={() => onRelogMeal?.(meal)}
                                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                                    >
                                      <Text style={styles.mealRelogButtonText}>{t('progress:logAgain')}</Text>
                                    </TouchableOpacity>
                                  </View>
                                </View>

                                {isExpanded && (
                                  <View style={styles.mealCardExpanded}>
                                    {/* Estimated quantities */}
                                    <View style={styles.mealQuantitiesContainer}>
                                      <Text style={styles.mealQuantitiesLabel}>{t('progress:estimatedQuantities')}</Text>
                                      {meal.foodQuantities ? (
                                        (() => {
                                          const re = /(.+?:\s*~?\d+(?:\.\d+)?\s*(?:g|ml|oz|pieces?|tbsp|tsp|cups?|slices?))/gi;
                                          const parts: string[] = [];
                                          let m;
                                          while ((m = re.exec(meal.foodQuantities!)) !== null) {
                                            parts.push(m[1].replace(/^[,;]\s*/, '').trim());
                                          }
                                          if (parts.length === 0) parts.push(...meal.foodQuantities!.split(',').map(s => s.trim()));
                                          return parts;
                                        })().map((item, idx) => (
                                          <View key={idx} style={styles.mealQuantityRow}>
                                            <Text style={styles.mealQuantityBullet}>•</Text>
                                            <Text style={styles.mealQuantityItem}>{item}</Text>
                                          </View>
                                        ))
                                      ) : (
                                        <Text style={styles.mealQuantityUnavailable}>{t('progress:noBreakdown')}</Text>
                                      )}
                                    </View>

                                    {/* Macros + kcal row */}
                                    <View style={styles.mealMacroRow}>
                                      <View style={styles.mealMacroItem}>
                                        <View style={[styles.mealMacroDot, { backgroundColor: '#C4A0A5' }]} />
                                        <Text style={styles.mealMacroLabel}>{t('progress:macroC')}</Text>
                                        <Text style={styles.mealMacroValue}>{Math.round(meal.carbs)}g</Text>
                                      </View>
                                      <View style={styles.mealMacroItem}>
                                        <View style={[styles.mealMacroDot, { backgroundColor: '#8BA8A0' }]} />
                                        <Text style={styles.mealMacroLabel}>{t('progress:macroP')}</Text>
                                        <Text style={styles.mealMacroValue}>{Math.round(meal.protein)}g</Text>
                                      </View>
                                      <View style={styles.mealMacroItem}>
                                        <View style={[styles.mealMacroDot, { backgroundColor: '#C4B89C' }]} />
                                        <Text style={styles.mealMacroLabel}>{t('progress:macroF')}</Text>
                                        <Text style={styles.mealMacroValue}>{Math.round(meal.fat)}g</Text>
                                      </View>
                                      <View style={styles.mealMacroItem}>
                                        <View style={[styles.mealMacroDot, { backgroundColor: '#A89CB8' }]} />
                                        <Text style={styles.mealMacroLabel}>{t('progress:macroFb')}</Text>
                                        <Text style={styles.mealMacroValue}>{Math.round(meal.fiber)}g</Text>
                                      </View>
                                      <View style={styles.mealMacroDivider} />
                                      <Text style={styles.mealMacroKcal}>{meal.calories} kcal</Text>
                                    </View>

                                    {editingDateItemId === `meal_${meal.id}` ? (
                                      <LogDateSelector
                                        selectedDate={editingDateValue}
                                        onDateChange={(newDate) => handleMealDateChange(meal.id, meal.logDate, newDate)}
                                        daysBack={14}
                                      />
                                    ) : (
                                      <TouchableOpacity
                                        style={styles.editDateButton}
                                        onPress={() => {
                                          setEditingDateItemId(`meal_${meal.id}`);
                                          setEditingDateValue(meal.logDate);
                                        }}
                                      >
                                        <Text style={styles.editDateButtonText}>{t('progress:editDate')}</Text>
                                      </TouchableOpacity>
                                    )}

                                    <TouchableOpacity
                                      style={styles.mealDeleteButton}
                                      onPress={() => handleDeleteMeal(meal)}
                                    >
                                      <Text style={styles.mealDeleteButtonText}>{t('progress:delete')}</Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ));
                    })()}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* Training Tab Content */}
        {selectedTab === 'Training' && (
          <View style={styles.trainingContainer}>
            {userId ? (
              <View style={styles.trainingLinkPillSpacing}>
                <LinkActivityPill
                  userId={userId}
                  mode="progress"
                  dataVersion={dataVersion}
                  onResolved={() => {
                    loadTrainingData().catch(() => {});
                    onUserDataChanged?.();
                  }}
                />
              </View>
            ) : null}
            {/* View Toggle */}
            {(recentWorkouts.length > 0 || recentActivities.length > 0) && (
              <View style={styles.viewToggleContainer}>
                <TouchableOpacity
                  style={[styles.viewToggleButton, trainingView === 'trends' && styles.viewToggleButtonActive]}
                  onPress={() => setTrainingView('trends')}
                >
                  <Text style={[styles.viewToggleText, trainingView === 'trends' && styles.viewToggleTextActive]}>
                    {t('progress:trendsSection')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.viewToggleButton, trainingView === 'recent' && styles.viewToggleButtonActive]}
                  onPress={() => setTrainingView('recent')}
                >
                  <Text style={[styles.viewToggleText, trainingView === 'recent' && styles.viewToggleTextActive]}>
                    {t('progress:recentWorkouts')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {isTrainingLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#F47C3C" />
                  <Text style={styles.loadingText}>{t('progress:loadingTraining')}</Text>
              </View>
            ) : (
              <>
                {/* Trends View - Charts */}
                {trainingView === 'trends' && hasLoadedTrainingData && chartsMountReady && (
                  <View style={styles.progressChartsSection}>
                    <TrainingProgressCharts
                      userId={userId}
                      prefetchedWorkoutLogs={trainingWorkoutLogs}
                      filtersRef={trainingFiltersRef}
                    />
                  </View>
                )}
                {trainingView === 'trends' && hasLoadedTrainingData && !chartsMountReady && (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#F47C3C" />
                    <Text style={styles.loadingText}>{t('progress:trainingLoading')}</Text>
                  </View>
                )}

                {/* Recent Workouts & Activities View */}
                {trainingView === 'recent' && (recentWorkouts.length > 0 || recentActivities.length > 0) && (
                  <View style={styles.recentWorkoutsSection}>
                    <Text style={styles.sectionTitle}>{t('progress:recentWorkouts')}</Text>
                    {(() => {
                      // Merge workouts and activities into a single date-sorted list
                      type RecentItem =
                        | { type: 'workout'; date: string; data: WorkoutLog }
                        | { type: 'activity'; date: string; data: ActivityLog };

                      const items: RecentItem[] = [
                        ...recentWorkouts.map(w => ({ type: 'workout' as const, date: w.workoutDate, data: w })),
                        ...recentActivities.map(a => ({ type: 'activity' as const, date: a.activityDate, data: a })),
                      ].sort((a, b) => {
                        const byDate = b.date.localeCompare(a.date);
                        if (byDate !== 0) return byDate;
                        return (
                          getTrainingRecentSortTimeMs(b.type, b.data) -
                          getTrainingRecentSortTimeMs(a.type, a.data)
                        );
                      });

                      const parseDateLocal = (dateStr: string) => new Date(dateStr + 'T00:00:00');

                      return items.map((item) => {
                        try {
                        if (item.type === 'activity') {
                          const activity = item.data;
                          const actKey = `activity_${activity.id}`;
                          const isExpanded = expandedWorkouts.has(actKey);
                          const durationH = Math.floor(activity.durationMinutes / 60);
                          const durationM = activity.durationMinutes % 60;
                                  const durationStr = durationH > 0 ? t('progress:durationHourMin', { h: durationH, m: durationM }) : t('progress:durationMin', { m: durationM });
                                  const intensityLabel = activity.intensity
                                    ? activity.intensity.charAt(0).toUpperCase() + activity.intensity.slice(1)
                                    : t('progress:intensityUnknown');

                          return (
                            <View key={actKey}>
                              <View style={styles.workoutHistoryCard}>
                                <TouchableOpacity
                                  style={styles.workoutHistoryCardMain}
                                  onPress={() => toggleWorkoutExpansion(actKey)}
                                  onLongPress={() => handleDeleteActivity(activity)}
                                  activeOpacity={0.7}
                                >
                                  <View style={styles.workoutHistoryIcon}>
                                    <Text style={styles.workoutHistoryIconText}>
                                      {isExpanded ? '▼' : '▶'}
                                    </Text>
                                  </View>
                                  <View style={styles.workoutHistoryContent}>
                                    <View style={styles.workoutHistoryTitleRow}>
                                      <Text style={styles.workoutHistoryTitle}>{displayActivityName(activity)}</Text>
                                      {activity.source && activity.source !== 'manual' ? (
                                        <SourceBadge
                                          source={activity.source}
                                          caloriesSource={activity.caloriesSource}
                                          caloriesConfidence={activity.caloriesConfidence}
                                          compact
                                        />
                                      ) : null}
                                    </View>
                                    <Text style={styles.workoutHistoryDate}>
                                      {parseDateLocal(activity.activityDate).toLocaleDateString('en-US', {
                                        weekday: 'short',
                                        month: 'short',
                                        day: 'numeric',
                                      })}
                                      {' • '}
                                      {durationStr}
                                      {activity.distanceValue ? ` • ${activity.distanceValue}${activity.distanceUnit || 'km'}` : ''}
                                    </Text>
                                    {activity.id != null && linkedWorkoutInfoByActivityId.has(activity.id) ? (
                                      <Text style={styles.linkedToWorkoutText}>
                                        {t('progress:linkedToWorkout', {
                                          workout: linkedWorkoutInfoByActivityId.get(activity.id)?.workoutDayName ?? '',
                                          defaultValue: `Linked to "${linkedWorkoutInfoByActivityId.get(activity.id)?.workoutDayName ?? ''}"`,
                                        })}
                                        {linkedWorkoutInfoByActivityId.get(activity.id)?.pendingReview
                                          ? ` ${t('progress:linkedPendingConfirmation', { defaultValue: '(pending confirmation)' })}`
                                          : ''}
                                      </Text>
                                    ) : null}
                                  </View>
                                </TouchableOpacity>
                                {onOpenActivityLog && (!activity.source || activity.source === 'manual') ? (
                                  <TouchableOpacity
                                    style={styles.mealRelogButton}
                                    onPress={() => handleRelogActivity(activity)}
                                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                                  >
                                    <Text style={styles.mealRelogButtonText}>{t('progress:logAgain')}</Text>
                                  </TouchableOpacity>
                                ) : null}
                              </View>

                              {isExpanded && (
                                <View style={styles.workoutDetailsContainer}>
                                  <View style={styles.exerciseDetailRow}>
                                    <Text style={styles.exerciseDetailName}>{t('progress:statDuration')}</Text>
                                    <Text style={styles.exerciseDetailStat}>{durationStr}</Text>
                                  </View>
                                  <View style={styles.exerciseDetailRow}>
                                    <Text style={styles.exerciseDetailName}>{t('progress:statIntensity')}</Text>
                                    <Text style={styles.exerciseDetailStat}>
                                      {intensityLabel}
                                    </Text>
                                  </View>
                                  {activity.distanceValue != null && (
                                    <View style={styles.exerciseDetailRow}>
                                      <Text style={styles.exerciseDetailName}>{t('progress:statDistance')}</Text>
                                      <Text style={styles.exerciseDetailStat}>
                                        {activity.distanceValue} {activity.distanceUnit || 'km'}
                                      </Text>
                                    </View>
                                  )}
                                  {activity.elevationGain != null && (
                                    <View style={styles.exerciseDetailRow}>
                                      <Text style={styles.exerciseDetailName}>{t('progress:statElevation')}</Text>
                                      <Text style={styles.exerciseDetailStat}>{activity.elevationGain} m</Text>
                                    </View>
                                  )}
                                  {typeof activity.caloriesBurned === 'number' && activity.caloriesBurned > 0 ? (
                                    <View style={styles.exerciseDetailRow}>
                                      <Text style={styles.exerciseDetailName}>{t('progress:statCalories', { defaultValue: 'Burned calories' })}</Text>
                                      <Text style={styles.exerciseDetailStat}>
                                        {activity.caloriesBurned} kcal
                                        {activity.caloriesSource && activity.caloriesSource !== 'manual'
                                          ? `  (${activity.caloriesSource === 'provider' ? (activity.source ? providerSourceUserFacingLabel(activity.source) : 'source') : 'MET estimate'})`
                                          : ''}
                                      </Text>
                                    </View>
                                  ) : null}

                                  {activity.notes ? (
                                    <Text style={styles.exerciseNoteText}>{activity.notes}</Text>
                                  ) : null}

                                  {onShareToSocial && activity.id != null ? (
                                    <TouchableOpacity
                                      style={styles.shareOnSocialButton}
                                      onPress={(e) => {
                                        e.stopPropagation();
                                        onShareToSocial({
                                          localActivityLogId: activity.id!,
                                          supabaseActivityLogId: activity.supabaseId ?? null,
                                          displayTitle: displayActivityName(activity),
                                        });
                                      }}
                                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                      <Text style={styles.shareOnSocialButtonText}>{t('progress:shareOnSocial')}</Text>
                                    </TouchableOpacity>
                                  ) : null}

                                  {activity.id != null
                                    && linkedWorkoutInfoByActivityId.get(activity.id)?.pendingReview ? (
                                    <TouchableOpacity
                                      style={styles.confirmMatchButton}
                                      onPress={() => void openLinkReviewForActivity(activity.id!)}
                                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                      <Text style={styles.confirmMatchButtonText}>
                                        {t('progress:confirmMatch', { defaultValue: 'Confirm match' })}
                                      </Text>
                                    </TouchableOpacity>
                                  ) : null}

                                  {activity.id != null && (!activity.source || activity.source === 'manual') ? (
                                    <>
                                      {editingDateItemId === `activity_${activity.id}` ? (
                                        <LogDateSelector
                                          selectedDate={editingDateValue}
                                          onDateChange={(newDate) =>
                                            handleActivityDateChange(activity.id!, activity.activityDate, newDate)
                                          }
                                          daysBack={14}
                                        />
                                      ) : (
                                        <TouchableOpacity
                                          style={styles.editDateButton}
                                          onPress={() => {
                                            setEditingDateItemId(`activity_${activity.id}`);
                                            setEditingDateValue(activity.activityDate);
                                          }}
                                        >
                                          <Text style={styles.editDateButtonText}>{t('progress:editDate')}</Text>
                                        </TouchableOpacity>
                                      )}

                                      <TouchableOpacity
                                        style={styles.mealDeleteButton}
                                        onPress={() => handleDeleteActivity(activity)}
                                      >
                                        <Text style={styles.mealDeleteButtonText}>{t('progress:delete')}</Text>
                                      </TouchableOpacity>
                                    </>
                                  ) : activity.id != null ? (
                                    <Text style={styles.importedFromText}>
                                      {(() => {
                                        const src = activity.source ?? 'manual';
                                        const fromLabel = providerSourceUserFacingLabel(src);
                                        const osBucket = resolveMobileOsBucket();
                                        let editHint: string;
                                        if (src === 'healthkit') {
                                          editHint =
                                            osBucket === 'ios'
                                              ? t('progress:importedEditHealthkitIos', {
                                                  defaultValue: 'Edit in the Apple Health app.',
                                                })
                                              : t('progress:importedEditHealthkitAndroid', {
                                                  defaultValue:
                                                    'To change this entry, edit it in the Health app on your iPhone.',
                                                });
                                        } else if (src === 'healthconnect') {
                                          editHint =
                                            osBucket === 'android'
                                              ? t('progress:importedEditHealthconnectAndroid', {
                                                  defaultValue: 'Edit in the Health Connect app.',
                                                })
                                              : t('progress:importedEditHealthconnectIos', {
                                                  defaultValue:
                                                    'To change this entry, edit it in Health Connect on your Android device.',
                                                });
                                        } else {
                                          editHint = t('progress:importedEditGeneric', {
                                            app: fromLabel,
                                            defaultValue: `Edit in the ${fromLabel} app.`,
                                          });
                                        }
                                        return t('progress:importedFrom', {
                                          from: fromLabel,
                                          editHint,
                                          defaultValue: `Imported from ${fromLabel}. ${editHint}`,
                                        });
                                      })()}
                                    </Text>
                                  ) : null}
                                </View>
                              )}
                            </View>
                          );
                        }

                        // Workout entry
                        const workout = item.data;
                        const workoutIdStr = String(workout.id);
                        const isExpanded = expandedWorkouts.has(workoutIdStr);
                        const loggedExercises = (workout.exercises || []).filter(ex =>
                          ex.completed || ex.reps != null || ex.weightValue != null
                        );
                        const uniqueExerciseIds = new Set(loggedExercises.map(ex => ex.exerciseId));
                        const uniqueExerciseCount = uniqueExerciseIds.size;

                        return (
                          <View key={`workout_${workout.id}`}>
                            <View style={styles.workoutHistoryCard}>
                              <TouchableOpacity
                                style={styles.workoutHistoryCardMain}
                                onPress={() => toggleWorkoutExpansion(workoutIdStr)}
                                onLongPress={() => handleDeleteWorkout(workout)}
                                activeOpacity={0.7}
                              >
                                <View style={styles.workoutHistoryIcon}>
                                  <Text style={styles.workoutHistoryIconText}>
                                    {isExpanded ? '▼' : '▶'}
                                  </Text>
                                </View>
                                <View style={styles.workoutHistoryContent}>
                                  <Text style={styles.workoutHistoryTitle}>{workout.workoutDayName}</Text>
                                  <Text style={styles.workoutHistoryDate}>
                                    {parseDateLocal(workout.workoutDate).toLocaleDateString('en-US', {
                                      weekday: 'short',
                                      month: 'short',
                                      day: 'numeric',
                                    })}
                                    {' • '}
                                    {uniqueExerciseCount}{uniqueExerciseCount === 1 ? t('progress:exerciseSingular') : t('progress:exercisePlural')}
                                  </Text>
                                </View>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.mealRelogButton}
                                onPress={() => handleRelogWorkout(workout)}
                                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                              >
                                <Text style={styles.mealRelogButtonText}>{t('progress:logAgain')}</Text>
                              </TouchableOpacity>
                            </View>

                            {isExpanded && (
                              <View style={styles.workoutDetailsContainer}>
                                {(() => {
                                  const exercisesWithReps = (workout.exercises || []).filter(ex =>
                                    ex.completed || ex.reps != null || ex.weightValue != null
                                  );
                                  if (exercisesWithReps.length === 0) {
                                    return (
                                      <Text style={styles.workoutEmptyDetailText}>
                                        {t('progress:noExercises')}
                                      </Text>
                                    );
                                  }
                                  const groupedExercises = exercisesWithReps.reduce((groups, exercise) => {
                                    const key = exercise.exerciseId;
                                    if (!groups[key]) {
                                      groups[key] = [];
                                    }
                                    groups[key].push(exercise);
                                    return groups;
                                  }, {} as Record<string, typeof exercisesWithReps>);

                                  return Object.values(groupedExercises).map((exerciseGroup, groupIndex) => {
                                    const exerciseNote = getExerciseCommentDisplay(exerciseGroup);
                                    return (
                                    <View key={`${workout.id}-${exerciseGroup[0].exerciseId}-${groupIndex}`}>
                                      {exerciseNote ? (
                                        <Text style={styles.exerciseNoteText}>{exerciseNote}</Text>
                                      ) : null}
                                      {exerciseGroup.map((exercise, setIndex) => (
                                        <View key={`${workout.id}-${exercise.exerciseId}-${exercise.setNumber}-${setIndex}`}>
                                          <View style={styles.exerciseDetailRow}>
                                            <Text style={styles.exerciseDetailName}>
                                              {exercise.exerciseName}
                                            </Text>
                                            <View style={styles.exerciseDetailStats}>
                                              {exercise.weightValue != null && exercise.weightUnit && (
                                                <Text style={styles.exerciseDetailStat}>
                                                  {exercise.weightValue}{exercise.weightUnit}
                                                </Text>
                                              )}
                                              {exercise.reps != null && (() => {
                                                const catalogEx = exercise.exerciseId
                                                  ? findBuiltinExerciseById(exercise.exerciseId)
                                                  : undefined;
                                                const isEnduranceTime = isEnduranceDurationExercise(catalogEx)
                                                  || isEnduranceDurationExerciseById(exercise.exerciseId);
                                                const isSeconds =
                                                  !isEnduranceTime
                                                  && catalogEx?.loggingUnit === 'seconds';
                                                return (
                                                  <Text style={styles.exerciseDetailStat}>
                                                    {formatStoredRepsForDisplay(
                                                      String(exercise.reps),
                                                      isEnduranceTime,
                                                    )}
                                                    {isEnduranceTime
                                                      ? t('progress:minutesUnit')
                                                      : isSeconds
                                                        ? t('progress:secsUnit')
                                                        : t('progress:repsUnit')}
                                                  </Text>
                                                );
                                              })()}
                                              {exercise.restTimeSeconds != null && exercise.restTimeSeconds > 0 && (
                                                <Text style={styles.exerciseDetailStat}>
                                                  {Math.floor(exercise.restTimeSeconds / 60)}:{(exercise.restTimeSeconds % 60).toString().padStart(2, '0')}
                                                </Text>
                                              )}
                                            </View>
                                          </View>
                                        </View>
                                      ))}
                                    </View>
                                    );
                                  });
                                })()}
                                {(() => {
                                  const workoutKcal = sumWorkoutLogBurnedKcal(
                                    workout.exercises || [],
                                    trainingWeightKg,
                                  );
                                  return workoutKcal > 0 ? (
                                  <View style={styles.exerciseDetailRow}>
                                    <Text style={styles.exerciseDetailName}>
                                      {t('progress:statCalories', { defaultValue: 'Burned calories' })}
                                    </Text>
                                    <Text style={styles.exerciseDetailStat}>{workoutKcal} kcal</Text>
                                  </View>
                                  ) : null;
                                })()}
                                {editingDateItemId === `workout_${workout.id}` ? (
                                  <LogDateSelector
                                    selectedDate={editingDateValue}
                                    onDateChange={(newDate) => handleWorkoutDateChange(workout.id!, workout.workoutDate, newDate)}
                                    daysBack={14}
                                  />
                                ) : (
                                  <TouchableOpacity
                                    style={styles.editDateButton}
                                    onPress={() => {
                                      setEditingDateItemId(`workout_${workout.id}`);
                                      setEditingDateValue(workout.workoutDate);
                                    }}
                                  >
                                    <Text style={styles.editDateButtonText}>{t('progress:editDate')}</Text>
                                  </TouchableOpacity>
                                )}

                                {onShareToSocial && workout.id != null ? (
                                  <TouchableOpacity
                                    style={styles.shareOnSocialButton}
                                    onPress={(e) => {
                                      e.stopPropagation();
                                      onShareToSocial({
                                        localWorkoutLogId: workout.id!,
                                        supabaseWorkoutLogId: workout.supabaseId ?? null,
                                        displayTitle: workout.workoutDayName,
                                      });
                                    }}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  >
                                    <Text style={styles.shareOnSocialButtonText}>{t('progress:shareOnSocial')}</Text>
                                  </TouchableOpacity>
                                ) : null}

                                <TouchableOpacity
                                  style={styles.mealDeleteButton}
                                  onPress={() => handleDeleteWorkout(workout)}
                                >
                                  <Text style={styles.mealDeleteButtonText}>{t('progress:delete')}</Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        );
                        } catch (renderError) {
                          glowLogger.error('Failed to render recent workout/activity item', {
                            item_type: item.type,
                            item_date: item.date,
                            error: renderError instanceof Error ? renderError.message : String(renderError),
                          });
                          return null;
                        }
                      });
                    })()}
                  </View>
                )}

                {/* Empty State */}
                {recentWorkouts.length === 0 && (
                  <View style={styles.trainingEmptyState}>
                    <Icon source={appIcons.fitness_center} width={48} height={48} fill="#F47C3C" />
                    <Text style={styles.trainingEmptyTitle}>{t('progress:emptyTrainingTitle')}</Text>
                    <Text style={styles.trainingEmptyText}>{t('progress:emptyTrainingBody')}</Text>
                    {workoutOptions.length === 0 && (
                      <Text style={styles.trainingEmptyHint}>{t('progress:emptyTrainingTip')}</Text>
                    )}
                  </View>
                )}

              </>
            )}
          </View>
        )}

        {/* Placeholder Tabs */}
      </ScrollView>

      {/* Activity ↔ workout match review (from Recent Activity detail) */}
      <LinkReviewModal
        visible={linkReviewVisible}
        row={linkReviewRow}
        busyId={linkReviewBusyId}
        onClose={closeLinkReviewModal}
        onResolve={handleLinkReviewResolve}
        onSetResolution={handleLinkReviewSetResolution}
      />

      {/* Weekly Log Modal */}
      <WeeklyLogModal
        visible={isLogModalVisible}
        userId={userId}
        initialWeightUnit={weightUnit}
        onClose={() => setIsLogModalVisible(false)}
        onSave={handleLogSave}
      />

      {/* Full-size body-progress photo viewer */}
      <ImageLightbox
        visible={photoViewerVisible}
        images={bodyPhotoGallery}
        initialIndex={photoViewerIndex}
        onClose={() => setPhotoViewerVisible(false)}
      />

      {/* Processing Photo Indicator */}
      {isProcessingPhoto && (
        <Modal transparent visible animationType="fade">
          <View style={styles.processingOverlay}>
            <View style={styles.processingCard}>
              <ActivityIndicator size="large" color="#F47C3C" />
              <Text style={styles.processingText}>Analyzing your meal...</Text>
            </View>
          </View>
        </Modal>
      )}

      {/* Meal Log Modal */}
      <Modal
        visible={isMealLogModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setIsMealLogModalVisible(false);
          setShowMealLogOptions(true);
        }}
      >
        <KeyboardAvoidingView
          behavior="padding"
          style={{ flex: 1 }}
        >
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => {
            setIsMealLogModalVisible(false);
            setShowMealLogOptions(true);
          }}
        >
          <Pressable style={[styles.modalContent, { paddingBottom: sheetBottomPadding }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t('progress:mealLogTitle')}</Text>

            {showMealLogOptions ? (
              /* Show three options */
              <>
                <Text style={styles.mealOptionsSubtitle}>{t('progress:mealLogSubtitle')}</Text>
                <View style={styles.mealOptionsContainer}>
                <TouchableOpacity
                  style={styles.mealOptionButton}
                  onPress={async () => {
                    setIsMealLogModalVisible(false);
                    setShowMealLogOptions(true);
                    if (onNavigateToChat) {
                      onNavigateToChat();
                    }
                    setTimeout(async () => {
                      const imageUri = await openCamera();
                      if (imageUri && onNavigateToChatWithMealImage) {
                        onNavigateToChatWithMealImage(imageUri);
                      }
                    }, 300);
                  }}
                >
                  <Icon source={appIcons.camera} width={35} height={35} fill="#F47C3C" style={styles.mealOptionIconWrapper} />
                  <Text style={styles.mealOptionTitle}>{t('progress:mealOptionPhoto')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.mealOptionButton}
                  onPress={async () => {
                    setIsMealLogModalVisible(false);
                    setShowMealLogOptions(true);
                    if (onNavigateToChat) {
                      onNavigateToChat();
                    }
                    setTimeout(async () => {
                      const imageUri = await openImageGallery();
                      if (imageUri && onNavigateToChatWithMealImage) {
                        onNavigateToChatWithMealImage(imageUri);
                      }
                    }, 300);
                  }}
                >
                  <Icon source={appIcons.gallery_thumbnail} width={35} height={35} fill="#F47C3C" style={styles.mealOptionIconWrapper} />
                  <Text style={styles.mealOptionTitle}>{t('progress:mealOptionGallery')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.mealOptionButton}
                  onPress={handleManualMealLog}
                >
                  <Icon source={appIcons.chat} width={35} height={35} fill="#F47C3C" style={styles.mealOptionIconWrapper} />
                  <Text style={styles.mealOptionTitle}>{t('progress:mealOptionText')}</Text>
                </TouchableOpacity>
              </View>
              </>
            ) : (
              /* Show manual entry form (unused now as we navigate to chat) */
              <View style={styles.mealOptionsContainer}>

            <Text style={styles.inputLabel}>{t('progress:mealFormDesc')}</Text>
            <TextInput
              style={styles.textInput}
              placeholder={t('progress:mealFormDescPlaceholder')}
              placeholderTextColor="#6F7A7E"
              value={mealDescription}
              onChangeText={setMealDescription}
              autoCapitalize="sentences"
            />

            <View style={styles.nutritionRow}>
              <View style={styles.nutritionInput}>
                <Text style={styles.inputLabel}>{t('progress:mealFormCarbs')}</Text>
                <TextInput
                  style={styles.numberInput}
                  placeholder="0"
                  placeholderTextColor="#6F7A7E"
                  value={mealCarbs}
                  onChangeText={(text) => setMealCarbs(normalizeDecimalInput(text))}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.nutritionInput}>
                <Text style={styles.inputLabel}>{t('progress:mealFormProtein')}</Text>
                <TextInput
                  style={styles.numberInput}
                  placeholder="0"
                  placeholderTextColor="#6F7A7E"
                  value={mealProtein}
                  onChangeText={(text) => setMealProtein(normalizeDecimalInput(text))}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={styles.nutritionRow}>
              <View style={styles.nutritionInput}>
                <Text style={styles.inputLabel}>{t('progress:mealFormFat')}</Text>
                <TextInput
                  style={styles.numberInput}
                  placeholder="0"
                  placeholderTextColor="#6F7A7E"
                  value={mealFat}
                  onChangeText={(text) => setMealFat(normalizeDecimalInput(text))}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.nutritionInput}>
                <Text style={styles.inputLabel}>{t('progress:mealFormFiber')}</Text>
                <TextInput
                  style={styles.numberInput}
                  placeholder="0"
                  placeholderTextColor="#6F7A7E"
                  value={mealFiber}
                  onChangeText={(text) => setMealFiber(normalizeDecimalInput(text))}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <Text style={styles.inputLabel}>{t('progress:mealFormCalories')}</Text>
            <TextInput
              style={styles.textInput}
              placeholder="0"
              placeholderTextColor="#6F7A7E"
              value={mealCalories}
              onChangeText={(text) => setMealCalories(normalizeDecimalInput(text))}
              keyboardType="decimal-pad"
            />

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={() => {
                      setIsMealLogModalVisible(false);
                      setShowMealLogOptions(true);
                    }}
                  >
                    <Text style={styles.modalButtonTextCancel}>{t('progress:mealFormCancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonSave]}
                    onPress={handleMealLogSave}
                  >
                    <Text style={styles.modalButtonTextSave}>{t('progress:mealFormSave')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Workout Day Selector Modal */}
      <WorkoutDaySelector
        visible={showWorkoutSelector}
        workoutOptions={workoutOptions}
        onSelect={handleWorkoutSelect}
        onCustomWorkout={() => {
          setShowWorkoutSelector(false);
          onNavigateToChatWithMessage?.(t('main:prefilledCustomWorkoutMessage'));
        }}
        onClose={() => setShowWorkoutSelector(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F2F2EE',
  },
  // Tab Bar Styles
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0E1A1A',
    borderRadius: 10,
    padding: 3,
    marginBottom: 20,
    gap: 3,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    gap: 4,
  },
  tabButtonSelected: {
    backgroundColor: '#F47C3C',
  },
  tabButtonText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#9AA3A6',
  },
  tabButtonTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  tabButtonLast: {
    // No longer needed
  },
  // Placeholder Styles
  placeholderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  placeholderIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  placeholderTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  placeholderText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#F47C3C',
    marginBottom: 12,
  },
  placeholderDescription: {
    fontSize: 14,
    color: '#9AA3A6',
    textAlign: 'center',
    lineHeight: 20,
  },
  logButton: {
    backgroundColor: '#F47C3C',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  logButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    zIndex: 100,
  },
  filterContainer: {
    position: 'relative',
    zIndex: 101,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1A1A',
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    gap: 8,
  },
  filterButtonText: {
    fontSize: 10,
    color: '#F2F2EE',
    fontWeight: '500',
  },
  filterArrow: {
    fontSize: 9,
    color: '#9AA3A6',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    backgroundColor: '#0E1A1A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    minWidth: 160,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownItemSelected: {
    backgroundColor: '#141E1E',
  },
  dropdownItemText: {
    fontSize: 14,
    color: '#F2F2EE',
  },
  dropdownItemTextSelected: {
    color: '#F47C3C',
    fontWeight: '600',
  },
  checkmark: {
    color: '#F47C3C',
    fontSize: 14,
    fontWeight: '600',
  },
  dropdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99,
  },
  unitToggleSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1A1A',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    gap: 4,
  },
  devSeedButton: {
    alignSelf: 'flex-start',
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4ECDC4',
    backgroundColor: 'rgba(78, 205, 196, 0.12)',
  },
  devSeedButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4ECDC4',
  },
  unitToggleLabel: {
    fontSize: 11,
    color: '#9AA3A6',
  },
  unitToggleValue: {
    fontSize: 11,
    color: '#F47C3C',
    fontWeight: '700',
  },
  chartsContainer: {
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    fontSize: 16,
    color: '#9AA3A6',
  },
  tipsContainer: {
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  tipsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 12,
  },
  tipsText: {
    fontSize: 14,
    color: '#9AA3A6',
    lineHeight: 20,
    marginBottom: 16,
  },
  tipsList: {
    gap: 8,
  },
  tipItem: {
    fontSize: 13,
    color: '#9AA3A6',
    lineHeight: 18,
  },
  // Meal Log Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0E1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 12,
    textAlign: 'center',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#F2F2EE',
    marginBottom: 8,
    marginTop: 12,
  },
  textInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  nutritionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nutritionInput: {
    flex: 1,
  },
  numberInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  modalButtonSave: {
    backgroundColor: '#F47C3C',
  },
  modalButtonTextCancel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9AA3A6',
  },
  modalButtonTextSave: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  // Meal Options Styles
  mealOptionsSubtitle: {
    fontSize: 14,
    color: '#9AA3A6',
    marginBottom: 14,
    textAlign: 'center',
  },
  mealOptionsContainer: {
    paddingVertical: 10,
  },
  mealOptionButton: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 14,
    marginBottom: 9,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  mealOptionEmoji: {
    fontSize: 35,
    marginBottom: 7,
  },
  mealOptionIcon: {
    width: 35,
    height: 35,
    marginBottom: 7,
  },
  mealOptionIconWrapper: {
    marginBottom: 7,
  },
  mealOptionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 3,
  },
  mealOptionSubtitle: {
    fontSize: 12,
    color: '#9AA3A6',
  },
  // Processing Photo Styles
  processingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingCard: {
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    minWidth: 200,
  },
  processingText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
    color: '#F2F2EE',
  },
  // Training Tab Styles
  trainingContainer: {
    width: '100%',
  },
  trainingLinkPillSpacing: {
    marginBottom: 8,
  },
  ongoingWorkoutRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141E1E',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  ribbonIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F47C3C',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  ribbonIconText: {
    fontSize: 20,
  },
  ribbonIconImage: {
    width: 20,
    height: 20,
  },
  ribbonContent: {
    flex: 1,
  },
  ribbonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 2,
  },
  ribbonSubtitle: {
    fontSize: 13,
    color: '#9AA3A6',
  },
  ribbonArrow: {
    fontSize: 24,
    color: '#F47C3C',
    fontWeight: '300',
  },
  viewToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#141E1E',
    borderRadius: 10,
    padding: 4,
    marginBottom: 4,
  },
  viewToggleButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewToggleButtonActive: {
    backgroundColor: '#0E1A1A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  viewToggleText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9AA3A6',
  },
  viewToggleTextActive: {
    color: '#F47C3C',
    fontWeight: '600',
  },
  recentWorkoutsSection: {
    marginTop: 8,
  },
  progressChartsSection: {
    marginTop: 8,
    marginHorizontal: -16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 12,
  },
  workoutHistoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  workoutHistoryCardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  workoutHistoryIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#0E1A1A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  workoutHistoryIconText: {
    fontSize: 16,
  },
  workoutHistoryContent: {
    flex: 1,
  },
  workoutHistoryTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 2,
  },
  workoutHistoryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 2,
  },
  importedFromText: {
    fontSize: 11,
    color: '#8C979B',
    fontStyle: 'italic',
    marginTop: 8,
  },
  linkedToWorkoutText: {
    fontSize: 11,
    color: '#F47C3C',
    marginTop: 2,
  },
  workoutHistoryDate: {
    fontSize: 12,
    color: '#9AA3A6',
  },
  workoutDetailsContainer: {
    backgroundColor: '#0E1A1A',
    borderRadius: 8,
    marginLeft: 48, // Align with content
    marginRight: 16,
    marginBottom: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  exerciseDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  exerciseDetailName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#F2F2EE',
    flex: 1,
  },
  exerciseDetailStats: {
    flexDirection: 'row',
    gap: 12,
  },
  exerciseDetailStat: {
    fontSize: 12,
    color: '#9AA3A6',
    fontWeight: '500',
  },
  workoutEmptyDetailText: {
    fontSize: 13,
    color: '#8E8E93',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
  exerciseNoteText: {
    fontSize: 11,
    color: '#F47C3C',
    fontWeight: '500',
    marginBottom: 2,
    marginTop: 4,
    lineHeight: 14,
  },
  trainingEmptyState: {
    alignItems: 'center',
    paddingVertical: 50,
    paddingHorizontal: 32,
  },
  trainingEmptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  trainingEmptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
    textAlign: 'center',
  },
  trainingEmptyText: {
    fontSize: 14,
    color: '#9AA3A6',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  trainingEmptyHint: {
    fontSize: 13,
    color: '#AEAEB2',
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  // Recent Meals Styles
  recentMealsSection: {
    gap: 16,
  },
  mealDateGroup: {
    gap: 8,
  },
  mealDateHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9AA3A6',
    marginBottom: 2,
  },
  mealCard: {
    backgroundColor: '#141E1E',
    borderRadius: 12,
    padding: 14,
  },
  mealCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  mealCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: 8,
  },
  mealCardIcon: {
    fontSize: 10,
    color: '#9AA3A6',
    marginTop: 4,
  },
  mealCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  mealCardTime: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  mealCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mealCalInline: {
    fontSize: 12,
    color: '#6B7280',
    flexShrink: 0,
  },
  mealCardExpanded: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1F2E2E',
  },
  mealQuantitiesContainer: {
    marginBottom: 12,
    gap: 5,
  },
  mealQuantitiesLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  mealQuantityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  mealQuantityBullet: {
    fontSize: 13,
    color: '#9AA3A6',
    lineHeight: 18,
  },
  mealQuantityItem: {
    fontSize: 13,
    color: '#AEAEB2',
    lineHeight: 18,
    flex: 1,
  },
  mealQuantityUnavailable: {
    fontSize: 13,
    color: '#4A5568',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  mealMacroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A2626',
    borderRadius: 8,
    padding: 10,
    gap: 2,
  },
  mealMacroItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mealMacroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  mealMacroLabel: {
    fontSize: 12,
    color: '#9AA3A6',
    fontWeight: '500',
  },
  mealMacroValue: {
    fontSize: 13,
    color: '#F2F2EE',
    fontWeight: '600',
  },
  mealMacroDivider: {
    width: 1,
    height: 16,
    backgroundColor: '#2D3D3D',
    marginHorizontal: 6,
  },
  mealMacroKcal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F47C3C',
  },
  mealRelogButton: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: 'rgba(244, 124, 60, 0.13)',
    borderWidth: 1,
    borderColor: 'rgba(244, 124, 60, 0.28)',
    flexShrink: 0,
  },
  mealRelogButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F47C3C',
    letterSpacing: 0.3,
  },
  editDateButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(244, 124, 60, 0.12)',
  },
  editDateButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F47C3C',
  },
  shareOnSocialButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(244, 124, 60, 0.12)',
    minHeight: 44,
    justifyContent: 'center',
  },
  shareOnSocialButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F47C3C',
  },
  confirmMatchButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F47C3C',
    minHeight: 44,
    justifyContent: 'center',
  },
  confirmMatchButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0E1A1A',
  },
  mealDeleteButton: {
    marginTop: 12,
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(232, 93, 117, 0.12)',
  },
  mealDeleteButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E85D75',
  },
});
