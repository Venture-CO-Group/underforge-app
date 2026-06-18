import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  AppState,
  AppStateStatus,
  BackHandler,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { appIcons } from '../assets/icons';
import { coachImages } from '../assets/images/coaches';
import { getUserWeightPreference, WeightUnit } from '../lib/body-composition-storage';
import { openCamera, openImageGallery } from '../lib/camera-helper';
import { getCurrentLoggedInUser } from '../lib/db';
import { refreshConsistencyScoreAfterLog } from '../lib/leaderboard-storage';
import { MealLog } from '../lib/nutrition-storage';
import { registerProviderSync } from '../lib/providers/sync-orchestrator';
import { getCurrentPlanTierForUser, getRemoteUserProfileLoggedInUser, supabase, updateUserOnboardingProfileJson } from '../lib/supabase_db_new';
import { getPendingProfile, needsProfileSync, retryProfileSync, storeLocalOnboardingData } from '../lib/sync-status';
import { trackMetaDailySession } from '../lib/meta-events';
import {
  DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE,
  getCachedWeeklyCheckinScheduleMode,
  setCachedWeeklyCheckinScheduleMode,
  type WeeklyCheckinScheduleMode,
} from '../lib/weekly-checkin-schedule';
import { buildWeeklyReportChatContext } from '../lib/weekly-report-chat-context';
import { DEFAULT_BODYWEIGHT_KG, estimatePlannedWorkoutKcal } from '../lib/workout-energy';
import {
  fetchWeeklyReportMetrics,
  getMostRecentPromptReferenceDate,
  getReportingWeekKey,
  weeklyReportMetricsFingerprint,
  type WeeklyReportMetrics,
} from '../lib/weekly-report-metrics';
import { generateWeeklyReportNarrative } from '../lib/weekly-report-narrative';
import { ensureWeeklyReportNotificationScheduled } from '../lib/weekly-report-notifications';
import {
  getCachedWeeklyReportNarrative,
  markWeeklyReportCompleted,
  markWeeklyReportSkipped,
  setCachedWeeklyReportNarrative,
  shouldPromptWeeklyReportGate,
  type WeeklyReportNarrative,
} from '../lib/weekly-report-state';
import { upsertWeeklyCheckinReport } from '../lib/weekly-report-supabase';
import { hasPendingCircleInvites } from '../lib/forging-circle';
import { createActivityLog, getActivityLogById } from '../lib/activity-storage';
import { getInProgressWorkoutLog, getWorkoutLogById } from '../lib/workout-storage';
import { Onboard } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import { WorkoutDayOption, WorkoutLog } from '../types/workout';
import { ActivityLogModal, ActivityLogPrefill } from './ActivityLogModal';
import { BottomTabNavigation } from './BottomTabNavigation';
import ChatScreen from './ChatScreen';
import CoachDashboard from './CoachDashboard';
import { CommunityScreen } from './CommunityScreen';
import { DeveloperMode } from './DeveloperMode';
import { FeatureTour, markFeatureTourShown, resetFeatureTour, shouldShowFeatureTour } from './FeatureTour';
import { HamburgerButton } from './HamburgerButton';
import { HamburgerMenu } from './HamburgerMenu';
import { Icon } from './Icon';
import { PlanScreenSimple } from './PlanScreenSimple';
import { ProgressScreen } from './ProgressScreen';
import { SyncStatusBanner } from './SyncStatusBanner';
import { ThemedText } from './ThemedText';
import { WeeklyLogModal } from './WeeklyLogModal';
import { WeeklyProgressReportGateModal } from './WeeklyProgressReportGateModal';
import { WeeklyProgressReportModal } from './WeeklyProgressReportModal';
import { extractWorkoutOptionsFromPlan, WorkoutDaySelector } from './WorkoutDaySelector';
import { WorkoutLogModal } from './WorkoutLogModal';
import { ShareWorkoutModal, type ShareWorkoutPayload } from './ShareWorkoutModal';

interface MainAppContainerProps {
  onboardingData: Onboard;
  onLogout?: () => void;
  onDeleteAccount?: () => void;
  pendingNotificationMessage?: { body: string, sender?: 'ai_coach' | 'human_coach', render_screen?: string } | null; // render_screen e.g. weekly_progress_report
  onNotificationMessageProcessed?: () => void;
  shouldGenerateWelcome?: boolean;
  onWelcomeGenerated?: () => void;
}

export default function MainAppContainer({
  onboardingData,
  onLogout,
  onDeleteAccount,
  pendingNotificationMessage,
  onNotificationMessageProcessed,
  shouldGenerateWelcome,
  onWelcomeGenerated
}: MainAppContainerProps) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'home' | 'plan' | 'progress' | 'games'>('home');
  const [showChat, setShowChat] = useState(false);
  const [showHamburgerMenu, setShowHamburgerMenu] = useState(false);
  const [showDeveloperMode, setShowDeveloperMode] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  // Current coaching plan tier ({ key, displayName }); null = ai_only / not yet loaded.
  const [planTier, setPlanTier] = useState<{ key: string; displayName: string } | null>(null);
  const [pendingMealImage, setPendingMealImage] = useState<string | null>(null);
  const [prefilledMessage, setPrefilledMessage] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'failed'>('idle');
  const [isLogModalVisible, setIsLogModalVisible] = useState(false);
  const [shouldScrollToNutrition, setShouldScrollToNutrition] = useState(false);
  
  // Body composition modal state
  const [showBodyCompModal, setShowBodyCompModal] = useState(false);
  const [userId, setUserId] = useState<string>('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  
  // Workout logging modal state
  const [showWorkoutSelector, setShowWorkoutSelector] = useState(false);
  const [showWorkoutLogModal, setShowWorkoutLogModal] = useState(false);
  const [selectedWorkoutOption, setSelectedWorkoutOption] = useState<WorkoutDayOption | null>(null);
  const [workoutOptions, setWorkoutOptions] = useState<WorkoutDayOption[]>([]);

  // Draft workout banner state
  const [draftWorkout, setDraftWorkout] = useState<WorkoutLog | null>(null);
  const [draftWorkoutId, setDraftWorkoutId] = useState<number | null>(null);

  /** Shown when the user has pending forging-circle invites to accept. */
  const [hasCircleInviteBanner, setHasCircleInviteBanner] = useState(false);

  // Activity log modal state
  const [showActivityLogModal, setShowActivityLogModal] = useState(false);
  const [activityLogPrefill, setActivityLogPrefill] = useState<ActivityLogPrefill>(null);

  // Share workout modal state (post-workout social share flow)
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareWorkoutPayload, setShareWorkoutPayload] = useState<ShareWorkoutPayload | null>(null);
  /** Bumped after a successful share to nudge the Feed to refetch on next mount. */
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);
  /** Bumped from elsewhere (e.g. streak sheet) to force the Leaderboard sub-tab open. */
  const [leaderboardRequestKey, setLeaderboardRequestKey] = useState(0);
  /** When set, the next hamburger open lands directly on that sub-screen. */
  const [hamburgerInitialMode, setHamburgerInitialMode] = useState<'forging_circle' | undefined>(undefined);
  
  // Re-log meal state
  const [pendingRelogMeal, setPendingRelogMeal] = useState<MealLog | null>(null);
  const [shouldShowRecentMeals, setShouldShowRecentMeals] = useState(false);
  /** Brief pulse so Progress opens Training with the chosen trends/recent segment (same pattern as nutrition). */
  const [progressTrainingInitialView, setProgressTrainingInitialView] = useState<'trends' | 'recent' | null>(null);
  const [progressBodyScrollToCharts, setProgressBodyScrollToCharts] = useState(false);
  const [planOpenStepIndex, setPlanOpenStepIndex] = useState<number | null>(null);

  // Dashboard data refresh trigger — incremented after workout save to re-fetch data
  const [dashboardDataVersion, setDashboardDataVersion] = useState(0);

  // Streak history sheet trigger — set true to open it in CoachDashboard
  const [shouldShowStreak, setShouldShowStreak] = useState(false);

  // Feature Tour state
  const [showFeatureTour, setShowFeatureTour] = useState(false);
  const tourCheckedRef = useRef(false);

  const [weeklyReportGateVisible, setWeeklyReportGateVisible] = useState(false);
  const [weeklyReportFullVisible, setWeeklyReportFullVisible] = useState(false);
  const [weeklyReportMetrics, setWeeklyReportMetrics] = useState<WeeklyReportMetrics | null>(null);
  const [weeklyReportNarrative, setWeeklyReportNarrative] = useState<WeeklyReportNarrative | null>(null);
  const [weeklyReportNarrativeLoading, setWeeklyReportNarrativeLoading] = useState(false);
  const [weeklyReportChatContext, setWeeklyReportChatContext] = useState<string | null>(null);
  const weeklyReportPromptScheduledRef = useRef(false);
  /** Developer "Create check-in": same gate → full flow, using this reference date instead of real "now". */
  const weeklyReportDebugRef = useRef<{ referenceNow: Date } | null>(null);

  const { t } = useTranslation(['main', 'settings', 'common', 'chat']);
  const coachName = onboardingData.selectedCoach || 'Dey';
  const coachImageKey = `${coachName}_1.png` as keyof typeof coachImages;

  const genderQuestion = currentUserProfile?.onboardingProfile?.clarifyingQuestions?.find(
    (q: any) => q.question === 'gender_question'
  );
  const userGender = (genderQuestion?.answer || '').toString().toLowerCase();

  const [weeklyCheckinScheduleMode, setWeeklyCheckinScheduleMode] = useState<WeeklyCheckinScheduleMode>(
    DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE,
  );

  // Profile column when migrated; otherwise fall back to the local preference cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromProfile = currentUserProfile?.weekly_checkin_schedule_mode;
      if (fromProfile === 'sun_sat_sun1800' || fromProfile === 'mon_sun_mon1800') {
        if (!cancelled) setWeeklyCheckinScheduleMode(fromProfile);
        await setCachedWeeklyCheckinScheduleMode(fromProfile);
        return;
      }
      const cached = await getCachedWeeklyCheckinScheduleMode();
      if (!cancelled) setWeeklyCheckinScheduleMode(cached);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUserProfile?.weekly_checkin_schedule_mode, currentUserProfile?.user_id]);

  useEffect(() => {
    setCachedWeeklyCheckinScheduleMode(weeklyCheckinScheduleMode).catch(() => { /* noop */ });
  }, [weeklyCheckinScheduleMode]);

  // Load current user profile and check for pending sync
  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const profile = await getRemoteUserProfileLoggedInUser();
        setCurrentUserProfile(profile);
        if (profile?.user_id) {
          setPlanTier(await getCurrentPlanTierForUser(profile.user_id));
        }
      } catch (error) {
        console.error('Failed to load user profile:', error);
        setCurrentUserProfile(null);
      }
    };
    
    const checkAndRetrySync = async () => {
      if (await needsProfileSync()) {
        const pendingProfile = await getPendingProfile();
        if (pendingProfile) {
          setSyncStatus('failed');
          retryProfileSync(pendingProfile, setSyncStatus);
        }
      }
    };

    const loadUserData = async () => {
      try {
        const user = await getCurrentLoggedInUser();
        if (user) {
          setUserId(user.id);
          const pref = await getUserWeightPreference(user.id);
          setWeightUnit(pref);
        }
      } catch (error) {
        console.error('Failed to load user data:', error);
      }
    };
    
    loadUserProfile();
    checkAndRetrySync();
    loadUserData();
    // Re-run when the active account changes (e.g. dev "restore from profile")
    // so currentUserProfile/userId reflect the new user instead of staying
    // pinned to whoever was loaded at mount (stale avatar + email in the menu).
  }, [onboardingData.localUserId, onboardingData.name]);

  const draftRefreshSeqRef = useRef(0);

  const refreshDraftWorkout = useCallback(async (uid?: string) => {
    const id = uid ?? userId;
    if (!id) return;
    const seq = ++draftRefreshSeqRef.current;
    try {
      const draft = await getInProgressWorkoutLog(id);
      if (seq === draftRefreshSeqRef.current) {
        setDraftWorkout(draft);
      }
    } catch {
      // Keep the current banner if the DB read fails transiently.
    }
  }, [userId]);

  const dismissWorkoutLogModal = useCallback(() => {
    setShowWorkoutLogModal(false);
    setSelectedWorkoutOption(null);
    setDraftWorkoutId(null);
    void refreshDraftWorkout();
  }, [refreshDraftWorkout]);

  const handleWorkoutDraftSaved = useCallback((draft: WorkoutLog) => {
    setShowWorkoutLogModal(false);
    setSelectedWorkoutOption(null);
    setDraftWorkoutId(null);
    setDraftWorkout(draft);
    void refreshDraftWorkout();
  }, [refreshDraftWorkout]);

  // Check for a draft workout whenever userId becomes available
  useEffect(() => {
    if (userId) void refreshDraftWorkout(userId);
  }, [userId, refreshDraftWorkout]);

  // Reconcile banner after foregrounding (modal state resets on cold start).
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && !showWorkoutLogModal) {
        void refreshDraftWorkout();
      }
    });
    return () => sub.remove();
  }, [userId, showWorkoutLogModal, refreshDraftWorkout]);

  useEffect(() => {
    if (!userId) return;
    ensureWeeklyReportNotificationScheduled(weeklyCheckinScheduleMode);
  }, [userId, weeklyCheckinScheduleMode]);

  // Wire wearables sync once the active user is known. Idempotent and
  // safe to re-run; the orchestrator dedupes its observer/background
  // registrations internally.
  useEffect(() => {
    if (!userId) return;
    registerProviderSync(userId).catch(() => { /* logged inside */ });
  }, [userId]);

  const tryShowWeeklyReportGate = useCallback(async () => {
    if (!userId) return;
    if (showFeatureTour) return;
    if (weeklyReportGateVisible || weeklyReportFullVisible) return;

    const weekKey = getReportingWeekKey(new Date(), weeklyCheckinScheduleMode);
    const prompt = await shouldPromptWeeklyReportGate(weekKey, new Date(), weeklyCheckinScheduleMode);
    if (prompt) {
      setWeeklyReportGateVisible(true);
    }
  }, [userId, showFeatureTour, weeklyReportGateVisible, weeklyReportFullVisible, weeklyCheckinScheduleMode]);

  useEffect(() => {
    if (!userId) return;
    trackMetaDailySession();

    const schedulePrompt = () => {
      if (weeklyReportPromptScheduledRef.current) return;
      weeklyReportPromptScheduledRef.current = true;
      setTimeout(() => {
        weeklyReportPromptScheduledRef.current = false;
        tryShowWeeklyReportGate();
      }, 2200);
    };

    schedulePrompt();

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        trackMetaDailySession();
        schedulePrompt();
      }
    });

    return () => sub.remove();
  }, [userId, tryShowWeeklyReportGate]);

  // Extract workout options from the local plan (source of truth)
  useEffect(() => {
    if (onboardingData?.actionPlan?.steps) {
      const options = extractWorkoutOptionsFromPlan(onboardingData.actionPlan.steps);
      setWorkoutOptions(options);
    }
  }, [onboardingData]);

  // Reset feature tour + workout tutorial storage on fresh onboarding so it shows for new users
  useEffect(() => {
    if (shouldGenerateWelcome) {
      resetFeatureTour();
      AsyncStorage.removeItem('workoutTutorialViews').catch(() => {});
      tourCheckedRef.current = false;
    }
  }, [shouldGenerateWelcome]);

  // Feature tour: show on home tab, once per week for first 2 weeks
  useEffect(() => {
    if (activeTab === 'home' && !showChat && !tourCheckedRef.current) {
      const timer = setTimeout(() => {
        tourCheckedRef.current = true;
        shouldShowFeatureTour().then(should => {
          if (should) {
            setShowFeatureTour(true);
            markFeatureTourShown();
          }
        });
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [activeTab, showChat]);

  const plannedTrainingDaysLower = onboardingData.actionPlan?.steps?.[0]?.daysOfWeek?.map((d: string) => d.toLowerCase()) ?? [];

  const loadWeeklyReportContent = useCallback(
    async (referenceNow: Date, markCompletedWhenDone: boolean) => {
      if (!userId) {
        Alert.alert(t('main:weeklyCheckInNoUserTitle'), t('main:weeklyCheckInNoUserBody'));
        return;
      }
      setWeeklyReportFullVisible(true);
      setWeeklyReportNarrativeLoading(true);
      setWeeklyReportNarrative(null);
      setWeeklyReportMetrics(null);

      const weekKey = getReportingWeekKey(referenceNow, weeklyCheckinScheduleMode);

      try {
        const metrics = await fetchWeeklyReportMetrics(
          userId,
          plannedTrainingDaysLower,
          referenceNow,
          weeklyCheckinScheduleMode,
        );
        setWeeklyReportMetrics(metrics);

        const metricsFingerprint = weeklyReportMetricsFingerprint(metrics);
        let narrative = await getCachedWeeklyReportNarrative(weekKey);
        if (narrative?.metricsFingerprint !== metricsFingerprint) {
          narrative = null;
        }
        if (!narrative) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const cfg = require('../assets/onboarding_config');
          const coachEntry = cfg?.general_info?.coach_selection?.[coachName];
          const coachPersonality = coachEntry?.persona?.personality ?? 'Supportive, clear, and encouraging.';
          narrative = await generateWeeklyReportNarrative({
            coachName,
            coachPersonality,
            userFirstName: onboardingData.name?.split(/\s+/)[0] || 'there',
            metrics,
          });
          await setCachedWeeklyReportNarrative(weekKey, narrative);
        }
        setWeeklyReportNarrative(narrative);
        if (markCompletedWhenDone) {
          await markWeeklyReportCompleted(weekKey);
        }
        upsertWeeklyCheckinReport(userId, metrics, narrative).catch(() => {});
      } catch (e) {
        console.warn('[WeeklyReport] load failed', e);
        setWeeklyReportFullVisible(false);
      } finally {
        setWeeklyReportNarrativeLoading(false);
      }
    },
    [userId, plannedTrainingDaysLower, coachName, onboardingData.name, weeklyCheckinScheduleMode],
  );

  const handleWeeklyReportSkip = async () => {
    if (weeklyReportDebugRef.current) {
      weeklyReportDebugRef.current = null;
      setWeeklyReportGateVisible(false);
      return;
    }
    const weekKey = getReportingWeekKey(new Date(), weeklyCheckinScheduleMode);
    await markWeeklyReportSkipped(weekKey);
    setWeeklyReportGateVisible(false);
  };

  const handleWeeklyReportLetsGo = async () => {
    if (!userId) return;
    const debug = weeklyReportDebugRef.current;
    weeklyReportDebugRef.current = null;
    const referenceNow = debug?.referenceNow ?? new Date();
    const markCompleted = debug == null;
    setWeeklyReportGateVisible(false);
    await loadWeeklyReportContent(referenceNow, markCompleted);
  };

  const handleDebugCreateWeeklyReport = useCallback(() => {
    setShowDeveloperMode(false);
    weeklyReportDebugRef.current = {
      referenceNow: getMostRecentPromptReferenceDate(new Date(), weeklyCheckinScheduleMode),
    };
    setWeeklyReportGateVisible(true);
  }, [weeklyCheckinScheduleMode]);

  const handleWeeklyReportClose = () => {
    setWeeklyReportFullVisible(false);
    setWeeklyReportMetrics(null);
    setWeeklyReportNarrative(null);
  };

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onHardwareBack = () => {
      if (weeklyReportFullVisible) {
        setWeeklyReportFullVisible(false);
        setWeeklyReportMetrics(null);
        setWeeklyReportNarrative(null);
        return true;
      }
      if (weeklyReportGateVisible) {
        if (weeklyReportDebugRef.current) {
          weeklyReportDebugRef.current = null;
        }
        setWeeklyReportGateVisible(false);
        return true;
      }
      if (showActivityLogModal) {
        setShowActivityLogModal(false);
        setActivityLogPrefill(null);
        return true;
      }
      if (showWorkoutLogModal) {
        dismissWorkoutLogModal();
        return true;
      }
      if (showBodyCompModal) {
        setShowBodyCompModal(false);
        return true;
      }
      if (showWorkoutSelector) {
        setShowWorkoutSelector(false);
        return true;
      }
      if (showDeveloperMode) {
        setShowDeveloperMode(false);
        return true;
      }
      if (showHamburgerMenu) {
        setShowHamburgerMenu(false);
        return true;
      }
      if (isLogModalVisible) {
        setIsLogModalVisible(false);
        return true;
      }
      if (showFeatureTour) {
        setShowFeatureTour(false);
        return true;
      }
      if (showChat) {
        setShowChat(false);
        setActiveTab('home');
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [
    weeklyReportFullVisible,
    weeklyReportGateVisible,
    showActivityLogModal,
    showWorkoutLogModal,
    showBodyCompModal,
    showWorkoutSelector,
    showDeveloperMode,
    showHamburgerMenu,
    isLogModalVisible,
    showFeatureTour,
    showChat,
    userId,
    dismissWorkoutLogModal,
  ]);

  const handleTalkToCoachFromWeeklyReport = useCallback(() => {
    const ctx = buildWeeklyReportChatContext(weeklyReportMetrics, weeklyReportNarrative);
    setWeeklyReportChatContext(ctx);
    setPrefilledMessage(t('report:prefilledWeeklyReview'));
    setWeeklyReportFullVisible(false);
    setShowChat(true);
  }, [weeklyReportMetrics, weeklyReportNarrative]);

  const handleNavigateToChat = () => {
    // Force-close sheet modals before switching to chat. If a workout draft
    // sheet is still dismissing on iOS, opening chat immediately can leave a
    // ghost touch-blocking layer over the main UI.
    setShowWorkoutLogModal(false);
    setShowWorkoutSelector(false);
    setShowActivityLogModal(false);
    setActivityLogPrefill(null);
    setIsLogModalVisible(false);
    setShowChat(true);
  };

  const handleNavigateToChatWithMealImage = (imageUri: string) => {
    setShowWorkoutLogModal(false);
    setShowWorkoutSelector(false);
    setShowActivityLogModal(false);
    setActivityLogPrefill(null);
    setIsLogModalVisible(false);
    setPendingMealImage(imageUri);
    setShowChat(true);
  };

  const handleNavigateToChatWithMessage = (message: string) => {
    setShowWorkoutLogModal(false);
    setShowWorkoutSelector(false);
    setShowActivityLogModal(false);
    setActivityLogPrefill(null);
    setIsLogModalVisible(false);
    setPrefilledMessage(message);
    setShowChat(true);
  };

  const handleRelogMeal = (meal: MealLog) => {
    setPendingRelogMeal(meal);
    setShowChat(true);
  };

  const handleNavigateToRecentMeals = () => {
    setIsLogModalVisible(false);
    setShouldShowRecentMeals(true);
    setActiveTab('progress');
    setTimeout(() => setShouldShowRecentMeals(false), 500);
  };

  const handleNavigateProgressTraining = useCallback((view: 'trends' | 'recent') => {
    setProgressTrainingInitialView(view);
    setActiveTab('progress');
    setTimeout(() => setProgressTrainingInitialView(null), 500);
  }, []);

  const handleNavigateToPlanDetails = useCallback((stepIndex: number) => {
    setShowChat(false);
    setActiveTab('plan');
    setPlanOpenStepIndex(stepIndex);
  }, []);

  const handleNavigateToProgressBodyCharts = useCallback(() => {
    setActiveTab('progress');
    setProgressBodyScrollToCharts(true);
    setDashboardDataVersion(v => v + 1);
  }, []);

  /**
   * Called from the WorkoutLogModal / ActivityLogModal success overlays and
   * from Progress -> Recent. Switches to the Social tab so the share composer
   * feels rooted in the right context, then opens the modal once the tab
   * transition has had a moment to settle.
   *
   * social_posts FKs reference the Supabase row ids. Sync from the originating
   * modal runs in the background, so the in-memory log may not have a Supabase
   * id yet when the user taps Share. Poll SQLite for the freshly-synced id for
   * up to ~3s; this typically completes in well under a second. If it's still
   * null after that, we open the modal anyway with null — the post is stored
   * without the FK and the snapshot still renders the card.
   */
  const handleShareToSocial = useCallback(async (input: {
    localWorkoutLogId?: number | null;
    supabaseWorkoutLogId?: number | null;
    localActivityLogId?: number | null;
    supabaseActivityLogId?: number | null;
    displayTitle: string;
  }) => {
    setActiveTab('games');

    let supabaseWorkoutLogId = input.supabaseWorkoutLogId ?? null;
    let supabaseActivityLogId = input.supabaseActivityLogId ?? null;
    const localWorkoutLogId = input.localWorkoutLogId ?? null;
    const localActivityLogId = input.localActivityLogId ?? null;

    if (localWorkoutLogId && !supabaseWorkoutLogId) {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const fresh = await getWorkoutLogById(localWorkoutLogId);
          if (fresh?.supabaseId) {
            supabaseWorkoutLogId = fresh.supabaseId;
            break;
          }
        } catch {
          // ignore — fall through to next retry / null fallback
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (localActivityLogId && !supabaseActivityLogId) {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const fresh = await getActivityLogById(localActivityLogId);
          if (fresh?.supabaseId) {
            supabaseActivityLogId = fresh.supabaseId;
            break;
          }
        } catch {
          // ignore — fall through to next retry / null fallback
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setShareWorkoutPayload({
      localWorkoutLogId,
      supabaseWorkoutLogId,
      localActivityLogId,
      supabaseActivityLogId,
      displayTitle: input.displayTitle,
    });
    setShowShareModal(true);
  }, []);

  const handleShareModalClose = useCallback(() => {
    setShowShareModal(false);
    setShareWorkoutPayload(null);
  }, []);

  /**
   * Deep-links from the Community screen to the Forging Circle settings inside
   * the hamburger menu. The HamburgerMenu honors `initialMode` and bypasses
   * the main landing screen.
   */
  const handleOpenForgingCircle = useCallback(() => {
    setHamburgerInitialMode('forging_circle');
    setShowHamburgerMenu(true);
  }, []);

  // Handle notification-driven navigation based on render_screen
  useEffect(() => {
    if (!pendingNotificationMessage?.render_screen) return;

    const screen = pendingNotificationMessage.render_screen;

    if (screen === 'quick_log') {
      setIsLogModalVisible(true);
      onNotificationMessageProcessed?.();
    } else if (screen === 'weekly_progress_report') {
      setWeeklyReportGateVisible(true);
      onNotificationMessageProcessed?.();
    } else if (screen === 'forging_circle') {
      handleOpenForgingCircle();
      onNotificationMessageProcessed?.();
    } else if (screen === 'checkin_daily' || screen === 'checkin_weekly' || screen === 'chat_screen') {
      if (!showChat) {
        setShowChat(true);
      }
    }
  }, [pendingNotificationMessage, onNotificationMessageProcessed, showChat, handleOpenForgingCircle]);

  const refreshCircleInviteBanner = useCallback(async () => {
    if (!userId) {
      setHasCircleInviteBanner(false);
      return;
    }
    try {
      const pending = await hasPendingCircleInvites(userId);
      setHasCircleInviteBanner(pending);
    } catch {
      setHasCircleInviteBanner(false);
    }
  }, [userId]);

  useEffect(() => {
    refreshCircleInviteBanner();
  }, [refreshCircleInviteBanner]);

  useEffect(() => {
    if (!showHamburgerMenu) {
      refreshCircleInviteBanner();
    }
  }, [showHamburgerMenu, refreshCircleInviteBanner]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        refreshCircleInviteBanner();
      }
    });
    return () => sub.remove();
  }, [refreshCircleInviteBanner]);

  // Foreground push: refresh banner when a circle-invite notification arrives.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const screen = (notification.request.content.data as { render_screen?: string })?.render_screen;
      if (screen === 'forging_circle') {
        void refreshCircleInviteBanner();
      }
    });
    return () => sub.remove();
  }, [refreshCircleInviteBanner]);

  // Refresh invite banner as soon as a new row is written for this user.
  useEffect(() => {
    if (!userId || !supabase) return;
    const channel = supabase
      .channel(`circle-invite-banner-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'forging_circle_invites',
          filter: `invitee_user_id=eq.${userId}`,
        },
        () => {
          void refreshCircleInviteBanner();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, refreshCircleInviteBanner]);

  const handleHamburgerInitialModeConsumed = useCallback(() => {
    setHamburgerInitialMode(undefined);
  }, []);

  /**
   * Called from the consistency / streak sheet's "See other people's
   * consistency" button. Switches to the Social tab and bumps the leaderboard
   * request key so the sub-tab opens on the Leaderboard view.
   */
  const handleShowLeaderboard = useCallback(() => {
    setActiveTab('games');
    setLeaderboardRequestKey(k => k + 1);
  }, []);

  const handleSharePosted = useCallback(() => {
    setFeedRefreshKey(v => v + 1);
  }, []);

  const handleBackToHome = (options?: { scrollToSection?: 'nutrition' | 'recentMeals'; showStreak?: boolean }) => {
    setShowChat(false);
    setActiveTab(options?.scrollToSection === 'recentMeals' ? 'progress' : 'home');
    if (options?.showStreak) {
      setShouldShowStreak(true);
    }
    if (options?.scrollToSection === 'nutrition') {
      setTimeout(() => {
        setShouldScrollToNutrition(true);
      }, 100);
    }
    if (options?.scrollToSection === 'recentMeals') {
      setShouldShowRecentMeals(true);
      setTimeout(() => setShouldShowRecentMeals(false), 500);
    }
  };

  const handleHamburgerPress = () => {
    setShowHamburgerMenu(true);
  };

  const handleShowPlan = () => {
    setActiveTab('plan');
  };

  const handleShowDeveloper = () => {
    setShowHamburgerMenu(false);
    setShowDeveloperMode(true);
  };

  const handleCloseDeveloper = () => {
    setShowDeveloperMode(false);
  };

  const handleProfileUpdate = async () => {
    try {
      const profile = await getRemoteUserProfileLoggedInUser();
      setCurrentUserProfile(profile);
    } catch (error) {
      console.error('Failed to refresh user profile:', error);
    }
  };

  const showAwayModeInfo = () => {
    Alert.alert(
      t('main:awayModeTitle'),
      t('main:awayModeBody'),
      [{ text: t('main:awayModeGotIt') }]
    );
  };

  const handleLogPress = () => {
    setIsLogModalVisible(true);
  };

  const handleLogMealCamera = async () => {
    setIsLogModalVisible(false);
    setShowChat(true);
    // Small delay to ensure navigation completes
    setTimeout(async () => {
      const imageUri = await openCamera();
      if (imageUri) {
        setPendingMealImage(imageUri);
      }
    }, 300);
  };

  const handleLogMealGallery = async () => {
    setIsLogModalVisible(false);
    setShowChat(true);
    setTimeout(async () => {
      const imageUri = await openImageGallery();
      if (imageUri) {
        setPendingMealImage(imageUri);
      }
    }, 300);
  };

  const handleLogMealText = () => {
    setIsLogModalVisible(false);
    setPrefilledMessage(t('main:prefilledMealMessage'));
    setShowChat(true);
  };

  const handleLogCustomWorkout = () => {
    setShowWorkoutSelector(false);
    setPrefilledMessage(t('main:prefilledCustomWorkoutMessage'));
    setShowChat(true);
  };

  const handleLogWorkout = () => {
    setIsLogModalVisible(false);
    setShowWorkoutSelector(true);
  };

  const handleLogBodyComposition = () => {
    setIsLogModalVisible(false);
    setShowBodyCompModal(true);
  };

  const openWorkoutLog = (option: WorkoutDayOption, existingWorkoutLogId?: number) => {
    setSelectedWorkoutOption(option);
    setDraftWorkoutId(existingWorkoutLogId ?? null);
    setShowWorkoutLogModal(true);
  };

  const handleWorkoutSelect = (option: WorkoutDayOption) => {
    setShowWorkoutSelector(false);
    openWorkoutLog(option);
  };

  const handleDraftBannerPress = () => {
    if (!draftWorkout?.id) return;
    setDraftWorkoutId(draftWorkout.id);
    const matchingOption = workoutOptions.find(opt =>
      opt.dayName === draftWorkout.workoutDayName
    ) || null;
    setSelectedWorkoutOption(matchingOption);
    setShowWorkoutLogModal(true);
  };

  const handleWorkoutLogComplete = () => {
    setShowWorkoutLogModal(false);
    setSelectedWorkoutOption(null);
    setDraftWorkoutId(null);
    setDashboardDataVersion(v => v + 1);
    void refreshDraftWorkout();
  };

  const handleBodyCompSave = () => {
    setShowBodyCompModal(false);
    handleNavigateToProgressBodyCharts();
  };

  const handleStartWorkout = (stepId: string, dayName: string) => {
    const workoutOption = workoutOptions.find(opt => opt.stepId === stepId)
      || workoutOptions.find(opt => opt.dayName.toLowerCase() === dayName.toLowerCase());
    if (workoutOption) {
      setActiveTab('progress');
      setTimeout(() => {
        openWorkoutLog(workoutOption);
      }, 100);
    } else {
      setActiveTab('progress');
      setTimeout(() => {
        setShowWorkoutSelector(true);
      }, 100);
    }
  };

  const handleOpenWorkoutLogFromChat = (workoutData: WorkoutDayOption) => {
    // WorkoutLogModal is hidden while chat is fullscreen; leave chat first so the
    // sheet opens immediately and initialization runs with visible=true.
    setShowChat(false);
    setActiveTab('home');
    openWorkoutLog(workoutData);
  };

  const handleSaveWorkoutToPlan = async (workoutData: WorkoutDayOption) => {
    try {
      const steps = onboardingData.actionPlan?.steps;
      if (!steps || steps.length === 0) {
        Alert.alert(t('common:error'), t('main:noActionPlanError'));
        return;
      }

      const trainingStep = steps.find(s => s.id === 'step_1') || steps[0];
      if (!trainingStep) return;

      const weightMatch = onboardingData.weight?.match(/\((\d+)\s*kg\)/);
      const weightKg = weightMatch
        ? parseInt(weightMatch[1], 10)
        : DEFAULT_BODYWEIGHT_KG;
      const mappedExercises = workoutData.exercises.map((e) => ({
        exerciseId: e.exerciseId,
        name: e.name,
        sets: e.sets,
        reps: e.reps,
        restTimeSeconds: e.restTimeSeconds,
        rir: e.rir,
        notes: e.notes,
      }));
      const newDay = {
        dayName: workoutData.dayName,
        dayType: workoutData.dayType || 'mixed',
        estimatedDuration: 45,
        estimatedCaloriesBurned: estimatePlannedWorkoutKcal(mappedExercises, weightKg),
        exercises: mappedExercises,
        warmup: workoutData.warmup,
        cooldown: workoutData.cooldown,
      };

      const currentDetails = trainingStep.step_details;
      if (Array.isArray(currentDetails)) {
        trainingStep.step_details = [...currentDetails, newDay] as any;
      } else if (currentDetails && typeof currentDetails === 'object' && 'dayName' in currentDetails) {
        trainingStep.step_details = [currentDetails, newDay] as any;
      } else {
        trainingStep.step_details = newDay as any;
      }

      await storeLocalOnboardingData(onboardingData);

      if (userId) {
        try {
          await updateUserOnboardingProfileJson(userId, onboardingData);
        } catch (e) {
          console.warn('[MainAppContainer] Failed to sync plan to Supabase:', e);
        }
      }

      const options = extractWorkoutOptionsFromPlan(onboardingData.actionPlan!.steps);
      setWorkoutOptions(options);

      Alert.alert(t('main:workoutSavedTitle'), t('main:workoutSavedBody', { dayName: workoutData.dayName }));
    } catch (error) {
      console.error('[MainAppContainer] Error saving workout to plan:', error);
      Alert.alert(t('common:error'), t('main:workoutSaveError'));
    }
  };

  const handleResetAndLogout = () => {
    Alert.alert(
      t('main:logoutTitle'),
      t('main:logoutBody'),
      [
        {
          text: t('main:logoutCancel'),
          style: 'cancel',
        },
        {
          text: t('main:logoutConfirm'),
          style: 'destructive',
          onPress: () => {
            setShowHamburgerMenu(false);
            if (onLogout) {
              onLogout();
            }
          },
        },
      ]
    );
  };
 
  const renderContent = () => {
    // When chat is shown, hide the bottom navigation and coach ribbon
    if (showChat) {
      return (
        <ChatScreen
          onboardingData={onboardingData}
          onLogout={onLogout}
          pendingNotificationMessage={pendingNotificationMessage}
          onNotificationMessageProcessed={onNotificationMessageProcessed}
          shouldGenerateWelcome={shouldGenerateWelcome}
          onWelcomeGenerated={onWelcomeGenerated}
          onBackToHome={handleBackToHome}
          pendingMealImage={pendingMealImage}
          onMealImageProcessed={() => setPendingMealImage(null)}
          prefilledMessage={prefilledMessage}
          onPrefilledMessageProcessed={() => setPrefilledMessage(null)}
          onOpenWorkoutLogFromChat={handleOpenWorkoutLogFromChat}
          onSaveWorkoutToPlan={handleSaveWorkoutToPlan}
          onOpenActivityLogFromChat={(prefill) => {
            setActivityLogPrefill(prefill || null);
            setShowActivityLogModal(true);
          }}
          pendingRelogMeal={pendingRelogMeal}
          onRelogMealProcessed={() => setPendingRelogMeal(null)}
          onMealLogged={() => setDashboardDataVersion(v => v + 1)}
          onDebugCreateWeeklyReport={handleDebugCreateWeeklyReport}
          weeklyReportChatContext={weeklyReportChatContext}
          onWeeklyReportChatContextConsumed={() => setWeeklyReportChatContext(null)}
          onNavigateToPlanDetails={handleNavigateToPlanDetails}
        />
      );
    }

    switch (activeTab) {
      case 'home':
        return (
          <CoachDashboard
            onboardingData={onboardingData}
            onNavigateToChat={handleNavigateToChat}
            onNavigateToChatWithMealImage={handleNavigateToChatWithMealImage}
            onNavigateToChatWithMessage={handleNavigateToChatWithMessage}
            onNavigateToRecentMeals={handleNavigateToRecentMeals}
            onLogout={onLogout}
            onStartWorkout={handleStartWorkout}
            shouldScrollToNutrition={shouldScrollToNutrition}
            onScrollToNutritionHandled={() => setShouldScrollToNutrition(false)}
            dataVersion={dashboardDataVersion}
            initialShowStreak={shouldShowStreak}
            onInitialShowStreakHandled={() => setShouldShowStreak(false)}
            onShowLeaderboard={handleShowLeaderboard}
          />
        );
      case 'plan':
        // PlanScreenSimple is rendered as an always-mounted sibling below so
        // tab switches don't refetch/remount the plan. See the `content`
        // view in the main JSX.
        return null;
      case 'progress':
        return (
          <ProgressScreen
            onboardingData={onboardingData}
            onNavigateToChat={handleNavigateToChat}
            onNavigateToChatWithMealImage={handleNavigateToChatWithMealImage}
            onNavigateToChatWithMessage={handleNavigateToChatWithMessage}
            onOpenWorkoutLog={openWorkoutLog}
            onRelogMeal={handleRelogMeal}
            onOpenActivityLog={(prefill) => {
              setActivityLogPrefill(prefill ?? null);
              setShowActivityLogModal(true);
            }}
            dataVersion={dashboardDataVersion}
            onUserDataChanged={() => setDashboardDataVersion(v => v + 1)}
            coachName={coachName}
            plannedTrainingDays={onboardingData.actionPlan?.steps?.[0]?.daysOfWeek?.map((d: string) => d.toLowerCase()) || []}
            onShowStreak={() => {
              setActiveTab('home');
              setShouldShowStreak(true);
            }}
            onShareToSocial={handleShareToSocial}
            initialNutritionView={shouldShowRecentMeals ? 'recent' : undefined}
            initialTrainingView={progressTrainingInitialView ?? undefined}
            initialBodyScrollToCharts={progressBodyScrollToCharts}
            onInitialBodyScrollToChartsConsumed={() => setProgressBodyScrollToCharts(false)}
          />
        );
      case 'games':
        return (
          <CommunityScreen
            onboardingData={onboardingData}
            feedRefreshKey={feedRefreshKey}
            leaderboardRequestKey={leaderboardRequestKey}
            onOpenForgingCircle={handleOpenForgingCircle}
          />
        );
      default:
        return null;
    }
  };

  const renderCircleInviteBanner = () => {
    if (!hasCircleInviteBanner) return null;
    return (
      <TouchableOpacity
        style={styles.circleInviteBanner}
        onPress={handleOpenForgingCircle}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`${t('main:circleInviteBannerMessage')} ${t('main:circleInviteBannerCta')}`}
      >
        <Text style={styles.circleInviteBannerMessage}>{t('main:circleInviteBannerMessage')}</Text>
        <Text style={styles.circleInviteBannerCta}>{t('main:circleInviteBannerCta')}</Text>
      </TouchableOpacity>
    );
  };

  const renderDraftBanner = () => {
    if (!draftWorkout || showWorkoutLogModal) return null;
    return (
      <TouchableOpacity style={styles.draftWorkoutBanner} onPress={handleDraftBannerPress} activeOpacity={0.8}>
        <Icon source={appIcons.fitness_center} width={16} height={16} fill="#F47C3C" />
        <View style={styles.draftWorkoutBannerTextBlock}>
          <Text style={styles.draftWorkoutBannerLabel}>{t('main:draftWorkoutInProgress')}</Text>
          <Text style={styles.draftWorkoutBannerName} numberOfLines={1}>{draftWorkout.workoutDayName}</Text>
        </View>
        <Text style={styles.draftWorkoutBannerCta}>{t('main:draftWorkoutContinue')}</Text>
      </TouchableOpacity>
    );
  };

  // Modals that need to be available regardless of which screen is showing
  const renderGlobalModals = () => (
    <>
      {/* Workout Log Modal */}
      {userId ? (
        <WorkoutLogModal
          visible={showWorkoutLogModal && !showChat}
          userId={userId}
          workoutOption={selectedWorkoutOption}
          existingWorkoutLogId={draftWorkoutId ?? undefined}
          coachName={coachName}
          plannedTrainingDays={onboardingData.actionPlan?.steps?.[0]?.daysOfWeek?.map((d: string) => d.toLowerCase()) || []}
          userGender={userGender}
          onClose={dismissWorkoutLogModal}
          onDraftSaved={handleWorkoutDraftSaved}
          onSave={handleWorkoutLogComplete}
          onDelete={handleWorkoutLogComplete}
          onShowStreak={() => {
            setActiveTab('home');
            setShouldShowStreak(true);
          }}
          onAfterSuccessfulWorkoutLog={() => handleNavigateProgressTraining('trends')}
          onShareWorkout={handleShareToSocial}
        />
      ) : null}

      {/* Activity Log Modal */}
      {userId ? (
        <ActivityLogModal
          visible={showActivityLogModal}
          userId={userId}
          prefill={activityLogPrefill}
          onClose={() => {
            setShowActivityLogModal(false);
            setActivityLogPrefill(null);
          }}
          onSave={async (log) => {
            const created = await createActivityLog(log);
            // Recompute + upload the leaderboard score (no-op when this activity
            // can't change the capped score, e.g. a day that already counts).
            refreshConsistencyScoreAfterLog(userId).catch(() => {});
            setDashboardDataVersion(v => v + 1);
            return created;
          }}
          onAfterActivityLogged={() => handleNavigateProgressTraining('recent')}
          onShareActivity={handleShareToSocial}
          coachName={coachName}
        />
      ) : null}

      <WeeklyProgressReportGateModal
        visible={weeklyReportGateVisible}
        onSkip={handleWeeklyReportSkip}
        onLetsGo={handleWeeklyReportLetsGo}
      />

      <WeeklyProgressReportModal
        visible={weeklyReportFullVisible}
        coachImage={coachImages[coachName] ?? coachImages[coachImageKey]}
        coachName={coachName}
        userFirstName={onboardingData.name?.split(/\s+/)[0] || 'there'}
        metrics={weeklyReportMetrics}
        narrative={weeklyReportNarrative}
        loadingNarrative={weeklyReportNarrativeLoading}
        onClose={handleWeeklyReportClose}
        onTalkToCoach={handleTalkToCoachFromWeeklyReport}
        userGender={userGender}
        userGoal={onboardingData.selectedGoal}
      />

      {userId ? (
        <ShareWorkoutModal
          visible={showShareModal}
          userId={userId}
          payload={shareWorkoutPayload}
          authorDisplayName={onboardingData.name || currentUserProfile?.display_name || 'A Forger'}
          authorAvatarUrl={currentUserProfile?.avatar_url ?? null}
          onClose={handleShareModalClose}
          onPosted={handleSharePosted}
        />
      ) : null}
    </>
  );

  // When showing chat, render it fullscreen without navigation
  if (showChat) {
    return (
      <SafeAreaView style={styles.container}>
        <SyncStatusBanner syncStatus={syncStatus} onStatusChange={setSyncStatus} />
        {currentUserProfile?.away_mode && (
          <View style={styles.awayModeBanner}>
            <Text style={styles.awayModeBannerText}>{t('main:awayModeOnBanner')}</Text>
            <TouchableOpacity onPress={showAwayModeInfo} style={styles.awayModeInfoButton}>
              <Text style={styles.awayModeInfoIcon}>ℹ️</Text>
            </TouchableOpacity>
          </View>
        )}
        {renderCircleInviteBanner()}
        {renderDraftBanner()}
        {renderContent()}
        {renderGlobalModals()}
      </SafeAreaView>
    );
  }

  // Normal navigation with tabs and coach ribbon
  return (
    <SafeAreaView style={styles.container}>
      {/* Sync Status Banner */}
      <SyncStatusBanner syncStatus={syncStatus} onStatusChange={setSyncStatus} />
      
      {/* Away Mode Banner */}
      {currentUserProfile?.away_mode && (
        <View style={styles.awayModeBanner}>
          <Text style={styles.awayModeBannerText}>{t('main:awayModeOnBanner')}</Text>
          <TouchableOpacity onPress={showAwayModeInfo} style={styles.awayModeInfoButton}>
            <Text style={styles.awayModeInfoIcon}>ℹ️</Text>
          </TouchableOpacity>
        </View>
      )}

      {renderCircleInviteBanner()}

      {/* Draft Workout Banner */}
      {renderDraftBanner()}

      {/* Coach Chat Ribbon - Only visible when not in chat */}
      <View style={styles.coachRibbon}>
        <View style={styles.coachRibbonLeft}>
          <HamburgerButton onPress={handleHamburgerPress} />
        </View>
        <TouchableOpacity style={styles.coachChatButton} onPress={handleNavigateToChat}>
          {coachImages[coachImageKey] ? (
            coachName !== 'Ruth' ? (
              <View style={{ width: 36, height: 36, borderRadius: 18, overflow: 'hidden', marginRight: 10 }}>
                <Image 
                  source={coachImages[coachImageKey]} 
                  style={{ 
                    width: 36, 
                    height: 48,
                    marginTop: coachName === 'Alonso' ? -6 : 0
                  }}
                  resizeMode="cover"
                />
              </View>
            ) : (
              <Image 
                source={coachImages[coachImageKey]} 
                style={styles.coachImage}
              />
            )
          ) : (
            <View style={styles.coachImagePlaceholder}>
              <ThemedText type="defaultSemiBold" style={styles.coachImagePlaceholderText}>
                {coachName.charAt(0)}
              </ThemedText>
            </View>
          )}
          <ThemedText type="defaultSemiBold" style={styles.coachText}>Coach {coachName} Chat</ThemedText>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/*
          Keep the Plan tab mounted across tab switches so the plan UI does
          not remount and refetch on every visit. Visibility is toggled with
          `display: 'none'` and `pointerEvents` so the view is only active
          when the Plan tab is selected and chat is not showing. The
          `isPlanTabFocused` flag triggers a background sync on each focus.
        */}
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { display: !showChat && activeTab === 'plan' ? 'flex' : 'none' },
          ]}
          pointerEvents={!showChat && activeTab === 'plan' ? 'auto' : 'none'}
        >
          <PlanScreenSimple
            onboardingData={onboardingData}
            openStepDetailsIndex={planOpenStepIndex}
            onOpenStepDetailsConsumed={() => setPlanOpenStepIndex(null)}
            isPlanTabFocused={!showChat && activeTab === 'plan'}
          />
        </View>
        {renderContent()}
      </View>

      <BottomTabNavigation
        activeTab={activeTab}
        onTabPress={setActiveTab}
        onLogPress={handleLogPress}
      />

      {/* Feature Tour Overlay */}
      <FeatureTour
        visible={showFeatureTour}
        onDismiss={() => setShowFeatureTour(false)}
      />

      {/* Unified Log Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isLogModalVisible}
        onRequestClose={() => setIsLogModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.logModalOverlay}
          activeOpacity={1}
          onPress={() => setIsLogModalVisible(false)}
        >
          <Pressable
            style={[styles.logModalContent, { paddingBottom: Math.max(40, insets.bottom + 16) }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.logModalHandle} />
            <Text style={styles.logModalTitle}>{t('main:quickLogTitle')}</Text>
            <Text style={styles.logModalSubtitle}>{t('main:quickLogSubtitle')}</Text>

            {/* Meal Section */}
            <Text style={styles.logModalSectionLabel}>{t('main:quickLogSectionNutrition')}</Text>
            <View style={styles.logModalRow}>
              <TouchableOpacity style={styles.logModalOption} onPress={handleLogMealCamera} activeOpacity={0.7}>
                <View style={styles.logModalIconCircle}>
                  <Icon source={appIcons.camera} width={22} height={22} fill="#F47C3C" />
                </View>
                <Text style={styles.logModalOptionText}>{t('main:quickLogPhoto')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.logModalOption} onPress={handleLogMealGallery} activeOpacity={0.7}>
                <View style={styles.logModalIconCircle}>
                  <Icon source={appIcons.gallery_thumbnail} width={22} height={22} fill="#F47C3C" />
                </View>
                <Text style={styles.logModalOptionText}>{t('main:quickLogGallery')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.logModalOption} onPress={handleLogMealText} activeOpacity={0.7}>
                <View style={styles.logModalIconCircle}>
                  <Icon source={appIcons.chat} width={22} height={22} fill="#F47C3C" />
                </View>
                <Text style={styles.logModalOptionText}>{t('main:quickLogDescribe')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.logModalOption} onPress={handleNavigateToRecentMeals} activeOpacity={0.7}>
                <View style={styles.logModalIconCircle}>
                  <Icon source={appIcons.clock} width={22} height={22} fill="#F47C3C" />
                </View>
                <Text style={styles.logModalOptionText}>{t('main:quickLogRecent')}</Text>
              </TouchableOpacity>
            </View>

            {/* Workout Section */}
            <View style={styles.logModalSection}>
              <Text style={styles.logModalSectionLabel}>{t('main:quickLogSectionTraining')}</Text>
              <TouchableOpacity style={styles.logModalWorkoutButton} onPress={handleLogWorkout} activeOpacity={0.7}>
              <View style={styles.logModalIconCircle}>
                <Icon source={appIcons.fitness_center} width={22} height={22} fill="#F47C3C" />
              </View>
              <View style={styles.logModalWorkoutText}>
                <Text style={styles.logModalWorkoutTitle}>{t('main:quickLogWorkout')}</Text>
                <Text style={styles.logModalWorkoutHint}>{t('main:quickLogWorkoutDesc')}</Text>
              </View>
              <Text style={styles.logModalChevron}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.logModalWorkoutButton, { marginTop: 8 }]}
              onPress={() => {
                setIsLogModalVisible(false);
                setActivityLogPrefill(null);
                setShowActivityLogModal(true);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.logModalIconCircle, { backgroundColor: 'rgba(91, 155, 213, 0.15)' }]}>
                <Text style={{ fontSize: 20 }}>🏃</Text>
              </View>
              <View style={styles.logModalWorkoutText}>
                <Text style={styles.logModalWorkoutTitle}>{t('main:quickLogActivity')}</Text>
                <Text style={styles.logModalWorkoutHint}>{t('main:quickLogActivityDesc')}</Text>
              </View>
              <Text style={styles.logModalChevron}>›</Text>
            </TouchableOpacity>
            </View>

            {/* Body Composition Section */}
            <View style={styles.logModalSection}>
            <Text style={styles.logModalSectionLabel}>{t('main:quickLogSectionBody')}</Text>
            <TouchableOpacity style={styles.logModalWorkoutButton} onPress={handleLogBodyComposition} activeOpacity={0.7}>
              <View style={styles.logModalIconCircle}>
                <Icon source={appIcons.target} width={22} height={22} fill="#F47C3C" />
              </View>
              <View style={styles.logModalWorkoutText}>
                <Text style={styles.logModalWorkoutTitle}>{t('main:quickLogWeeklyLog')}</Text>
                <Text style={styles.logModalWorkoutHint}>{t('main:quickLogWeeklyLogDesc')}</Text>
              </View>
              <Text style={styles.logModalChevron}>›</Text>
            </TouchableOpacity>
            </View>
          </Pressable>
        </TouchableOpacity>
      </Modal>

      {/* Weekly Body Composition Log Modal */}
      {userId ? (
        <WeeklyLogModal
          visible={showBodyCompModal}
          userId={userId}
          initialWeightUnit={weightUnit}
          onClose={() => setShowBodyCompModal(false)}
          onSave={handleBodyCompSave}
        />
      ) : null}

      {/* Workout Day Selector Modal */}
      <WorkoutDaySelector
        visible={showWorkoutSelector}
        workoutOptions={workoutOptions}
        onSelect={handleWorkoutSelect}
        onCustomWorkout={handleLogCustomWorkout}
        onClose={() => setShowWorkoutSelector(false)}
      />

      {renderGlobalModals()}

      {/* Hamburger Menu */}
      <HamburgerMenu
        visible={showHamburgerMenu}
        onClose={() => setShowHamburgerMenu(false)}
        onboardingData={onboardingData}
        currentUserProfile={currentUserProfile}
        planTier={planTier}
        onLogout={onLogout || (() => {})}
        onResetAndLogout={handleResetAndLogout}
        onDeleteAccount={onDeleteAccount}
        onShowPlan={handleShowPlan}
        onShowDeveloper={handleShowDeveloper}
        onProfileUpdate={handleProfileUpdate}
        onConnectionsChanged={() => setDashboardDataVersion(v => v + 1)}
        initialMode={hamburgerInitialMode}
        onInitialModeConsumed={handleHamburgerInitialModeConsumed}
      />

      {/* Developer Mode */}
      <DeveloperMode
        visible={showDeveloperMode}
        onClose={handleCloseDeveloper}
        onDebugCreateWeeklyReport={handleDebugCreateWeeklyReport}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  coachRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0E1A1A',
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1A2426',
  },
  coachRibbonLeft: {
    width: 44,
    alignItems: 'flex-start',
  },
  coachChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    marginRight: 44,
  },
  coachImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  coachImagePlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F47C3C',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  coachImagePlaceholderText: {
    color: '#0B1114',
    fontSize: 15,
  },
  coachText: {
    fontSize: 16,
    color: '#F2F2EE',
  },
  content: {
    flex: 1,
  },
  awayModeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF3E0',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 8,
  },
  awayModeBannerText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#E65100',
  },
  awayModeInfoButton: {
    padding: 2,
  },
  awayModeInfoIcon: {
    fontSize: 14,
  },

  // ── Draft Workout Banner ────────────────────────────────────────────
  circleInviteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#2A2218',
    paddingVertical: 11,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#3D3020',
  },
  circleInviteBannerMessage: {
    flex: 1,
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    color: '#F2F2EE',
  },
  circleInviteBannerCta: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    color: '#F47C3C',
  },
  draftWorkoutBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A2820',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3E30',
  },
  draftWorkoutBannerTextBlock: {
    flex: 1,
  },
  draftWorkoutBannerLabel: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 11,
    color: '#F47C3C',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  draftWorkoutBannerName: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: '#F2F2EE',
    marginTop: 1,
  },
  draftWorkoutBannerCta: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    color: '#4CAF7A',
  },

  // ── Log Modal ───────────────────────────────────────────────────────
  logModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(11, 17, 20, 0.85)',
  },
  logModalContent: {
    backgroundColor: '#0E1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#1E2A2C',
  },
  logModalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#6F7A7E',
    alignSelf: 'center',
    marginBottom: 20,
    opacity: 0.5,
  },
  logModalTitle: {
    fontFamily: 'PlayfairDisplay-Bold',
    fontSize: 22,
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  logModalSubtitle: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: '#6F7A7E',
    textAlign: 'center',
    marginBottom: 24,
  },
  logModalSection: {
    marginTop: 32,
  },
  logModalSectionLabel: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 11,
    color: '#F47C3C',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  logModalRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 0,
  },
  logModalOption: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#141E1E',
    borderRadius: 16,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  logModalIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(244, 124, 60, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  logModalOptionText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 12,
    color: '#F2F2EE',
    letterSpacing: 0.2,
  },
  logModalWorkoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141E1E',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  logModalWorkoutText: {
    flex: 1,
    marginLeft: 14,
  },
  logModalWorkoutTitle: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 15,
    color: '#F2F2EE',
    marginBottom: 2,
  },
  logModalWorkoutHint: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    color: '#6F7A7E',
  },
  logModalChevron: {
    fontFamily: 'Inter-Regular',
    fontSize: 22,
    color: '#6F7A7E',
    marginLeft: 8,
  },
});
