import { useActiveOverlay } from '@/hooks/useActiveOverlay';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  findNodeHandle,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { appIcons } from '../assets/icons';
import { getLatestUserWeightKg, getQualifyingActivityCountsByDate, retryPendingActivityLogs, syncActivityLogsFromSupabase } from '../lib/activity-storage';
import { getWeekNumber } from '../lib/body-composition-storage';
import {
  activeBurnHomeRowsFromBreakdown,
  computeCaloriesBurnedBreakdown,
  type CaloriesBurnedBreakdown,
} from '../lib/calories-balance';
import { openCamera, openImageGallery } from '../lib/camera-helper';
import { CheckinProgress } from '../lib/checkin_helper';
import { CONSISTENCY_THRESHOLD, mergeTrainingCountsWithDailyCap } from '../lib/consistency-helper';
import { retryPendingChatMessages } from '../lib/conversation-storage';
import { getCanonicalDailyMetric, syncDailyMetricsFromSupabase } from '../lib/daily-metrics-storage';
import { getCurrentLoggedInUser } from '../lib/db';
import { saveConsistencyScoreToSupabase, saveLocalConsistencyScore } from '../lib/leaderboard-storage';
import { calculateBaseCalories, estimateBaselineMovementKcalFromOnboard } from '../lib/llm-service';
import { getAdjustmentForDate, isWearablesV1Enabled, recomputeDailyAdjustment, type NutritionAdjustment } from '../lib/nutrition-adjustment';
import { DailyNutritionTotals, getLocalMealCountsByDate, getPersistedBaselineMovement, getTodayNutrition, initializeNutritionTargetsIfNeeded, isPlannedTrainingDay, plannedTrainingKcalPerSession, syncMealLogsFromSupabase, syncNutritionTargetsFromSupabase } from '../lib/nutrition-storage';
import { getTrainingDayUiForDate, type TrainingDayUi } from '../lib/training-day-status';
import {
  getTodayTaskCompletionsFromSupabase,
  getWeeklyTaskCompletions,
  saveTaskCompletionToSupabase
} from '../lib/supabase-task-completion';
import { getRemoteUserProfileLoggedInUser } from '../lib/supabase_db_new';
import { retryPendingMealLogs, retryPendingWorkoutDeletions } from '../lib/sync-status';
import { getLocalWorkoutCountsByDate, getLocalWorkoutDateNamePairs, getLocalWorkoutDayNames, retryPendingExerciseLogs, retryPendingWorkoutLogs } from '../lib/workout-storage';
import { styles } from '../styles/CoachDashboard.styles';
import { Onboard } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import CaloriesBalanceCard from './CaloriesBalanceCard';
import { detectPlanDeviation, type PlanDeviationSignal } from '../lib/plan-deviation-detector';
import CheckinDay from './CheckinDay';
import { Icon } from './Icon';
import LinkActivityPill from './LinkActivityPill';

interface CoachDashboardProps {
  onboardingData: Onboard;
  onNavigateToChat: () => void;
  onNavigateToChatWithMealImage?: (imageUri: string) => void;
  onNavigateToChatWithMessage?: (message: string) => void;
  onNavigateToRecentMeals?: () => void;
  onLogout?: () => void;
  onStartWorkout?: (stepId: string, dayName: string) => void;
  shouldScrollToNutrition?: boolean;
  onScrollToNutritionHandled?: () => void;
  dataVersion?: number;
  initialShowStreak?: boolean;
  onInitialShowStreakHandled?: () => void;
  /**
   * Optional deep-link from the streak detail sheet to the Social tab's
   * Leaderboard sub-tab — wired up by MainAppContainer.
   */
  onShowLeaderboard?: () => void;
}

interface TaskStatus {
  [stepId: string]: boolean;
}

// Helper to get local date string (YYYY-MM-DD) without timezone conversion
const getLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper to get day key from completion_date (YYYY-MM-DD format)
const dayKeyFromCompletionDate = (dateStr?: string | null): string | null => {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
};

// ==========================================
// Electric Border — Perlin noise utilities
// (Ported from https://reactbits.dev/animations/electric-border)
// ==========================================
const eRandom = (x: number): number => (Math.sin(x * 12.9898) * 43758.5453) % 1;

const eNoise2D = (x: number, y: number): number => {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const a = eRandom(i + j * 57);
  const b = eRandom(i + 1 + j * 57);
  const c = eRandom(i + (j + 1) * 57);
  const d = eRandom(i + 1 + (j + 1) * 57);
  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
};

const eOctavedNoise = (
  x: number, octaves: number, lacunarity: number, gain: number,
  amplitude: number, frequency: number, time: number, seed: number, flatness: number,
): number => {
  let y = 0;
  let amp = amplitude;
  let freq = frequency;
  for (let i = 0; i < octaves; i++) {
    y += (i === 0 ? amp * flatness : amp) * eNoise2D(freq * x + seed * 100, time * freq * 0.3);
    freq *= lacunarity;
    amp *= gain;
  }
  return y;
};

const eGetRoundedRectPoint = (
  t: number, left: number, top: number, w: number, h: number, r: number,
): { x: number; y: number } => {
  const sw = w - 2 * r;
  const sh = h - 2 * r;
  const ca = (Math.PI * r) / 2;
  const total = 2 * sw + 2 * sh + 4 * ca;
  const dist = t * total;
  let acc = 0;

  if (dist <= acc + sw) return { x: left + r + ((dist - acc) / sw) * sw, y: top };
  acc += sw;
  if (dist <= acc + ca) {
    const a = -Math.PI / 2 + ((dist - acc) / ca) * (Math.PI / 2);
    return { x: left + w - r + r * Math.cos(a), y: top + r + r * Math.sin(a) };
  }
  acc += ca;
  if (dist <= acc + sh) return { x: left + w, y: top + r + ((dist - acc) / sh) * sh };
  acc += sh;
  if (dist <= acc + ca) {
    const a = ((dist - acc) / ca) * (Math.PI / 2);
    return { x: left + w - r + r * Math.cos(a), y: top + h - r + r * Math.sin(a) };
  }
  acc += ca;
  if (dist <= acc + sw) return { x: left + w - r - ((dist - acc) / sw) * sw, y: top + h };
  acc += sw;
  if (dist <= acc + ca) {
    const a = Math.PI / 2 + ((dist - acc) / ca) * (Math.PI / 2);
    return { x: left + r + r * Math.cos(a), y: top + h - r + r * Math.sin(a) };
  }
  acc += ca;
  if (dist <= acc + sh) return { x: left, y: top + h - r - ((dist - acc) / sh) * sh };
  acc += sh;
  const a = Math.PI + ((dist - acc) / ca) * (Math.PI / 2);
  return { x: left + r + r * Math.cos(a), y: top + r + r * Math.sin(a) };
};

const generateElectricPath = (
  w: number, h: number, radius: number, time: number,
  chaos: number, displacement: number, ox: number, oy: number,
): string => {
  const r = Math.min(radius, Math.min(w, h) / 2);
  const sw = w - 2 * r;
  const sh = h - 2 * r;
  const ca = (Math.PI * r) / 2;
  const perim = 2 * sw + 2 * sh + 4 * ca;
  const count = Math.max(80, Math.floor(perim / 3));
  const parts: string[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const pt = eGetRoundedRectPoint(t, ox, oy, w, h, r);
    const nx = eOctavedNoise(t * 8, 6, 1.6, 0.7, chaos, 10, time, 0, 0);
    const ny = eOctavedNoise(t * 8, 6, 1.6, 0.7, chaos, 10, time, 1, 0);
    const x = (pt.x + nx * displacement).toFixed(1);
    const y = (pt.y + ny * displacement).toFixed(1);
    parts.push(i === 0 ? `M${x} ${y}` : `L${x} ${y}`);
  }
  parts.push('Z');
  return parts.join('');
};

// Electric Border Ribbon Component
const ElectricBorderRibbon: React.FC<{
  todayPendingWorkout: { stepId: string; dayName: string; title: string };
  onStartWorkout?: (stepId: string, dayName: string) => void;
}> = ({ todayPendingWorkout, onStartWorkout }) => {
  const { t } = useTranslation(['home']);
  const [layout, setLayout] = useState<{ width: number; height: number } | null>(null);
  const [pathData, setPathData] = useState('');
  const timeRef = useRef(0);
  const lastFrameRef = useRef(0);
  const animRef = useRef<number | null>(null);

  const PADDING = 20;
  const BORDER_RADIUS = 16;
  const CHAOS = 0.15;
  const DISPLACEMENT = 35;
  const SPEED = 0.4;
  const TARGET_FPS = 24;
  const FRAME_INTERVAL = 1000 / TARGET_FPS;

  useEffect(() => {
    if (!layout) return;

    const animate = (timestamp: number) => {
      const delta = timestamp - lastFrameRef.current;
      if (delta >= FRAME_INTERVAL) {
        timeRef.current += (delta / 1000) * SPEED;
        lastFrameRef.current = timestamp;
        const path = generateElectricPath(
          layout.width, layout.height, BORDER_RADIUS,
          timeRef.current, CHAOS, DISPLACEMENT, PADDING, PADDING,
        );
        setPathData(path);
      }
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => {
      if (animRef.current != null) cancelAnimationFrame(animRef.current);
    };
  }, [layout]);

  const svgW = layout ? layout.width + PADDING * 2 : 0;
  const svgH = layout ? layout.height + PADDING * 2 : 0;

  return (
    <View style={styles.workoutRibbonContainer}>
      <TouchableOpacity
        style={styles.workoutRibbon}
        onPress={() => {
          if (onStartWorkout) {
            onStartWorkout(todayPendingWorkout.stepId, todayPendingWorkout.dayName);
          }
        }}
        activeOpacity={0.7}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setLayout({ width, height });
        }}
      >
        {/* Edge-glow background — uses layout pixel dimensions for reliable rendering */}
        {layout && (
          <View style={styles.workoutRibbonGradient} pointerEvents="none">
            <Svg width={layout.width} height={layout.height}>
              <Defs>
                {/* Vertical glow: top & bottom edges lit, center dark */}
                <LinearGradient id="vGlow" x1="0" y1="0" x2="0" y2={layout.height} gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor="#FF6B35" stopOpacity="0.20" />
                  <Stop offset="0.35" stopColor="#FF6B35" stopOpacity="0" />
                  <Stop offset="0.65" stopColor="#FF6B35" stopOpacity="0" />
                  <Stop offset="1" stopColor="#FF6B35" stopOpacity="0.20" />
                </LinearGradient>
                {/* Horizontal glow: left & right edges lit, center dark */}
                <LinearGradient id="hGlow" x1="0" y1="0" x2={layout.width} y2="0" gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor="#FF6B35" stopOpacity="0.16" />
                  <Stop offset="0.15" stopColor="#FF6B35" stopOpacity="0" />
                  <Stop offset="0.85" stopColor="#FF6B35" stopOpacity="0" />
                  <Stop offset="1" stopColor="#FF6B35" stopOpacity="0.16" />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width={layout.width} height={layout.height} fill="url(#vGlow)" />
              <Rect x={0} y={0} width={layout.width} height={layout.height} fill="url(#hGlow)" />
            </Svg>
          </View>
        )}
        
        <View style={styles.workoutRibbonContent}>
          <View style={styles.workoutRibbonLeft}>
            <Text style={styles.workoutRibbonLabel}>{t('home:today')}</Text>
            <Text style={styles.workoutRibbonDayName}>{todayPendingWorkout.dayName}</Text>
          </View>
          <Text style={styles.workoutRibbonCta}>{t('home:startNow')}</Text>
        </View>
        <Text style={styles.workoutRibbonArrow}>›</Text>
      </TouchableOpacity>

      {/* Animated electric border SVG — rendered ON TOP so waves are visible inside the ribbon */}
      {layout && pathData ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -PADDING,
            left: -PADDING,
            width: svgW,
            height: svgH,
            zIndex: 10,
          }}
        >
          <Svg width={svgW} height={svgH}>
            {/* Main electric line */}
            <Path d={pathData} stroke="rgba(255, 140, 107, 0.75)" strokeWidth={2.5} fill="none" />
            {/* Bright core highlight */}
            <Path d={pathData} stroke="rgba(255, 210, 190, 0.6)" strokeWidth={1} fill="none" />
          </Svg>
        </View>
      ) : null}
    </View>
  );
};

export default function CoachDashboard({ onboardingData, onNavigateToChat, onNavigateToChatWithMealImage, onNavigateToChatWithMessage, onNavigateToRecentMeals, onLogout, onStartWorkout, shouldScrollToNutrition, onScrollToNutritionHandled, dataVersion, initialShowStreak, onInitialShowStreakHandled, onShowLeaderboard }: CoachDashboardProps) {
  const { t } = useTranslation(['home', 'common', 'social']);
  const insets = useSafeAreaInsets();
  const sheetBottomPadding = Math.max(24, insets.bottom + 16);
  const scrollViewRef = useRef<ScrollView>(null);
  const nutritionSectionRef = useRef<View>(null);

  useEffect(() => {
    if (!shouldScrollToNutrition) return;

    const tryScrollToNutrition = (attempt = 0) => {
      const scrollHandle = findNodeHandle(
        (scrollViewRef.current as ScrollView & { getInnerViewNode?: () => unknown })
          ?.getInnerViewNode?.() ?? scrollViewRef.current,
      );
      const sectionHandle = findNodeHandle(nutritionSectionRef.current);
      if (scrollHandle == null || sectionHandle == null) {
        if (attempt < 10) {
          setTimeout(() => tryScrollToNutrition(attempt + 1), 120);
        } else {
          onScrollToNutritionHandled?.();
        }
        return;
      }
      UIManager.measureLayout(
        sectionHandle,
        scrollHandle,
        () => {
          if (attempt < 10) {
            setTimeout(() => tryScrollToNutrition(attempt + 1), 120);
          } else {
            onScrollToNutritionHandled?.();
          }
        },
        (_x: number, y: number) => {
          scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
          onScrollToNutritionHandled?.();
        },
      );
    };

    setTimeout(tryScrollToNutrition, 100);
  }, [shouldScrollToNutrition, onScrollToNutritionHandled]);

  useEffect(() => {
    if (initialShowStreak) {
      const timer = setTimeout(() => {
        setShowStreakDetail(true);
        if (onInitialShowStreakHandled) onInitialShowStreakHandled();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [initialShowStreak]);

  const coachName = onboardingData.selectedCoach || 'Alonso';
  const userName = onboardingData.name || 'there';
  const [completedTasks, setCompletedTasks] = useState<TaskStatus>({});
  const [userId, setUserId] = useState<string | null>(null);
  
  const [nutritionData, setNutritionData] = useState<DailyNutritionTotals | null>(null);
  // Wearables v1: dynamic per-day adjustment layered over baseline nutrition
  // targets. Null means "no adjustment row yet" -> UI falls back to baseline.
  const [nutritionAdjustment, setNutritionAdjustment] = useState<NutritionAdjustment | null>(null);
  const [planDeviationSignal, setPlanDeviationSignal] = useState<PlanDeviationSignal | null>(null);
  const [canonicalStepsToday, setCanonicalStepsToday] = useState<{ value: number; source: string } | null>(null);
  const [burnedBreakdown, setBurnedBreakdown] = useState<CaloriesBurnedBreakdown | null>(null);
  const [bmrKcalCached, setBmrKcalCached] = useState<number | null>(null);
  const [weightKgCached, setWeightKgCached] = useState<number | null>(null);
  // Resolved baseline-movement kcal/day. Persisted value (from
  // user_nutrition_targets) when available, otherwise a runtime recompute
  // from onboarding answers. Cached so the modalInputs block at render
  // time uses the same source as the breakdown effect above.
  const [baselineMovementKcalCached, setBaselineMovementKcalCached] = useState<number | null>(null);

  const [checkinProgress, setCheckinProgress] = useState<CheckinProgress | null>(null);
  const [planProgress, setPlanProgress] = useState(0.4);
  const [showCheckinDay, setShowCheckinDay] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [isMealLogOptionsModalVisible, setIsMealLogOptionsModalVisible] = useState(false);
  const [weeklyMealCounts, setWeeklyMealCounts] = useState<Record<string, number>>({});
  const [weeklyWorkoutDays, setWeeklyWorkoutDays] = useState<Set<string>>(new Set());
  const [weeklyWorkoutCounts, setWeeklyWorkoutCounts] = useState<Record<string, number>>({});
  // Gate the leaderboard score upload: until the first local read completes the
  // meal/workout counts are empty `{}`, which computes to a score of 0. Uploading
  // that 0 can overwrite a real stored score if the corrective upload never lands
  // (network drop, user leaves immediately). Stay false until counts are loaded.
  const [consistencyDataLoaded, setConsistencyDataLoaded] = useState(false);
  const [todayTrainingUi, setTodayTrainingUi] = useState<TrainingDayUi | null>(null);
  const [weeklyLoggedWorkoutNames, setWeeklyLoggedWorkoutNames] = useState<string[]>([]);
  // Most recently completed workout's day name (all-time, not week-scoped). Drives
  // the rolling workout-day rotation so the next suggested session is the one that
  // follows it in the plan, rather than resetting to the start of the week.
  const [lastCompletedWorkoutName, setLastCompletedWorkoutName] = useState<string | null>(null);
  const [lastWeekMealCount, setLastWeekMealCount] = useState<number | null>(null); // null = no data
  const [lastWeekWorkoutCount, setLastWeekWorkoutCount] = useState<number | null>(null); // null = no data
  const [weeklyConsistencyScores, setWeeklyConsistencyScores] = useState<Array<{ weekStart: string; weekEnd: string; score: number; hasMeals: boolean; hasWorkouts: boolean }>>([]);
  const [showStreakDetail, setShowStreakDetail] = useState(false);
  const [scoreMode, setScoreMode] = useState<'until_today' | 'whole_week'>('until_today');
  const {
    isOpen: showScoreModeDropdown,
    closeSelf: closeScoreModeDropdown,
    toggle: toggleScoreModeDropdown,
  } = useActiveOverlay('coachDashboard.scoreMode');
  const [headerLayout, setHeaderLayout] = useState<{ width: number; height: number } | null>(null);
  const [showCatchUpNudge, setShowCatchUpNudge] = useState(false);

  // Stable digest of the BMR-relevant onboarding fields. Without this, the
  // CoachDashboard parent re-creates `onboardingData` on every render and the
  // effect below cancels in a loop.
  const bmrInputDigest = useMemo(() => {
    const cq = onboardingData?.clarifyingQuestions ?? [];
    const get = (k: string) => cq.find((q) => q.question === k)?.answer ?? '';
    return [
      (onboardingData as any)?.gender || get('gender_question') || '',
      (onboardingData as any)?.age || get('current_age_question') || '',
      onboardingData?.height || get('current_height_question') || '',
      onboardingData?.weight || get('current_weight_question') || '',
      (onboardingData as any)?.occupation_activity || '',
    ].join('|');
  }, [onboardingData]);

  const todayYmdLocal = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const plannedTrainingToday = useMemo(
    () => isPlannedTrainingDay(onboardingData.actionPlan, todayYmdLocal),
    [onboardingData.actionPlan, todayYmdLocal],
  );

  const plannedTrainingForBurnTarget = useMemo(() => {
    if (!plannedTrainingToday) return false;
    if (todayTrainingUi?.dayType === 'rest') return false;
    return true;
  }, [plannedTrainingToday, todayTrainingUi?.dayType]);

  const plannedSessionBurnTargetKcal = useMemo(() => {
    if (!plannedTrainingForBurnTarget) return 0;
    const trainingStep =
      onboardingData.actionPlan?.steps?.find((s: any) => s?.id === 'step_1') ??
      onboardingData.actionPlan?.steps?.[0];
    return plannedTrainingKcalPerSession(trainingStep);
  }, [plannedTrainingForBurnTarget, onboardingData.actionPlan?.steps]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const w = (await getLatestUserWeightKg(userId)) ?? 70;
      if (cancelled) return;
      setWeightKgCached(w);

      const calc = calculateBaseCalories(onboardingData);
      const bmr = calc ? Math.round(calc.bmr) : Math.round(w * 24);
      // Prefer the explicit baseline-movement value persisted alongside the
      // user's nutrition targets (set by `persistPlanNutritionTargets` on
      // plan creation/regeneration). Fall back to a runtime recompute from
      // onboarding answers for users whose row predates the column.
      const persisted = await getPersistedBaselineMovement(userId);
      if (cancelled) return;
      const baselineMovementKcal = persisted
        ? persisted.kcalPerDay
        : estimateBaselineMovementKcalFromOnboard(onboardingData);
      setBmrKcalCached(bmr);
      setBaselineMovementKcalCached(baselineMovementKcal);

      if (!cancelled) {
        setBurnedBreakdown(null);
      }

      try {
        const breakdown = await computeCaloriesBurnedBreakdown({
          userId,
          todayYmd: todayYmdLocal,
          bmrKcal: bmr,
          weightKg: w,
          occupationNeatKcal: baselineMovementKcal,
          plannedTrainingToday: plannedTrainingForBurnTarget,
          plannedSessionTargetKcal: plannedSessionBurnTargetKcal,
        });
        if (!cancelled) {
          setBurnedBreakdown(breakdown);
        }
      } catch {
        /* keep BMR-only fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, bmrInputDigest, dataVersion, todayYmdLocal, plannedTrainingForBurnTarget, plannedSessionBurnTargetKcal]);

  // Get all steps from the action plan
  const allSteps = onboardingData.actionPlan?.steps || [];
 
  // Onboarding gender (if provided in clarifyingQuestions)
  const _genderQuestion = onboardingData?.clarifyingQuestions?.find(q => q.question === 'gender_question');
  const onboardingGender = (_genderQuestion?.answer || '').toString().toLowerCase();
  // Choose background image based on gender: female -> feminine image, otherwise keep current image
  const bgImageSource =
    onboardingGender === 'female'
      ? require('../assets/images/fem_standing_fit.png')
      : require('../assets/images/male_fit_standing_profile.jpeg');
  
  // Get current day of week in lowercase format (mon, tue, wed, etc.)
  const getCurrentDayOfWeek = () => {
    const dayIndex = new Date().getDay(); // 0 = Sunday, 1 = Monday, etc.
    return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dayIndex];
  };

  // Calculate total expected checkins per week (sum of all daysOfWeek across all steps)
  const totalCheckinsPerWeek = useMemo(() => {
    return allSteps.reduce((total, step) => {
      return total + (step.daysOfWeek?.length || 0);
    }, 0);
  }, [allSteps]);

  // Week days for the tracker table
  const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const WEEK_DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

  // Planned training days derived from action plan (step_1 is always training)
  const plannedTrainingDays = useMemo(() => {
    const days = new Set<string>();
    const trainingStep = allSteps[0]; // Step 1 is always training
    if (trainingStep) {
      trainingStep.daysOfWeek?.forEach(d => days.add(d.toLowerCase()));
    }
    return days;
  }, [allSteps]);

  // Today's pending workout info — follows the plan's workout day rotation as a
  // rolling sequence: the next session is the one that comes *after* whatever was
  // completed most recently, so the same workout is never suggested twice in a row
  // (the rotation rolls forward instead of resetting at the start of each week).
  const todayPendingWorkout = useMemo(() => {
    const today = getCurrentDayOfWeek();
    const todayDateStr = getLocalDateString(new Date());
    if (weeklyWorkoutDays.has(todayDateStr)) return null;

    // If the user manually marked today as a rest day (override on a planned
    // training day), today's session is no longer due — hide the ribbon. The
    // override is keyed per-date, so the skipped workout still rolls forward to
    // the next planned training day via the rotation logic below (which anchors
    // on the last *completed* workout, not the calendar).
    if (todayTrainingUi?.dayType === 'rest') return null;

    // Once the weekly training target has been met, today's session is no longer
    // a pending obligation, so don't surface the "Start now" ribbon.
    const weekWorkoutTotal = Object.values(weeklyWorkoutCounts).reduce((sum, c) => sum + c, 0);
    if (plannedTrainingDays.size > 0 && weekWorkoutTotal >= plannedTrainingDays.size) return null;

    const trainingStep = allSteps[0]; // Step 1 is always training
    if (!trainingStep?.daysOfWeek?.some(d => d.toLowerCase() === today)) return null;

    const stepDetails = trainingStep.step_details as any;
    if (!Array.isArray(stepDetails) || stepDetails.length === 0) {
      // Single workout or no structured details — simple case
      const dayName = (stepDetails && typeof stepDetails === 'object' && stepDetails.dayName)
        ? stepDetails.dayName
        : trainingStep.title || 'Workout';
      return { stepId: trainingStep.id, dayName, title: trainingStep.title };
    }

    // Multiple workout days in the plan (e.g., Push/Pull/Legs rotation).
    const workouts = stepDetails.filter((d: any) => d && d.dayName);
    if (workouts.length === 0) return null;

    // Anchor the rotation on the most recently completed workout and advance one
    // step, so we never re-suggest the session the user just did — even if it was
    // their last workout in a previous week.
    let startIdx = 0;
    if (lastCompletedWorkoutName) {
      const lastIdx = workouts.findIndex(
        (d: any) => d.dayName.toLowerCase() === lastCompletedWorkoutName.toLowerCase(),
      );
      if (lastIdx >= 0) startIdx = (lastIdx + 1) % workouts.length;
    }

    // From the rolling start point, prefer the first session not already logged
    // this week; fall back to the rolling-next entry if every session is done.
    const loggedNamesSet = new Set(weeklyLoggedWorkoutNames.map(n => n.toLowerCase()));
    let nextWorkout = workouts[startIdx];
    for (let i = 0; i < workouts.length; i++) {
      const candidate = workouts[(startIdx + i) % workouts.length];
      if (!loggedNamesSet.has(candidate.dayName.toLowerCase())) {
        nextWorkout = candidate;
        break;
      }
    }

    const dayName = nextWorkout.dayName;
    const dayIndex = stepDetails.indexOf(nextWorkout);
    return {
      stepId: `${trainingStep.id}_${dayIndex}`,
      dayName,
      title: trainingStep.title,
    };
  }, [allSteps, weeklyWorkoutDays, weeklyLoggedWorkoutNames, lastCompletedWorkoutName, weeklyWorkoutCounts, plannedTrainingDays, todayTrainingUi?.dayType]);

  // Get current week Monday-Sunday date range
  const getWeekDateRange = useCallback(() => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { monday, sunday };
  }, []);

  // Get previous week Monday-Sunday date range
  const getPreviousWeekDateRange = useCallback(() => {
    const { monday: thisMonday } = getWeekDateRange();
    const prevMonday = new Date(thisMonday);
    prevMonday.setDate(thisMonday.getDate() - 7);
    prevMonday.setHours(0, 0, 0, 0);
    const prevSunday = new Date(prevMonday);
    prevSunday.setDate(prevMonday.getDate() + 6);
    prevSunday.setHours(23, 59, 59, 999);
    return { monday: prevMonday, sunday: prevSunday };
  }, [getWeekDateRange]);

  // Get date string (YYYY-MM-DD) for a specific day of the current week
  const getDateForWeekDay = useCallback((dayAbbrev: string) => {
    const { monday } = getWeekDateRange();
    const dayIndex = WEEK_DAYS.indexOf(dayAbbrev as typeof WEEK_DAYS[number]);
    if (dayIndex === -1) return '';
    const date = new Date(monday);
    date.setDate(monday.getDate() + dayIndex);
    return getLocalDateString(date);
  }, [getWeekDateRange]);

  const todayDayAbbrev = getCurrentDayOfWeek();

  // Function to refresh progress data (called on mount and when CheckinDay reports changes)
  const refreshProgressData = useCallback(async (userIdToUse?: string) => {
    const uid = userIdToUse || userId;
    if (!uid) return;
    
    try {
      // Get expected checkins from current user profile
      const expectedCheckins = currentUserProfile?.onboardingProfile?.actionPlan?.steps.reduce((checkins: any[], step) => {
        if (step.daysOfWeek && step.daysOfWeek.length > 0) {
          step.daysOfWeek.forEach(dayOfWeek => {
            checkins.push({
              step_id: step.id,
              step_title: step.title,
              dayOfWeek: dayOfWeek,
              timeOfDay: step.timeOfDay,
            });
          });
        }
        return checkins;
      }, []) || [];
      
      // Fetch weekly task completions and calculate MATCHED completions
      const weeklyCompletions = await getWeeklyTaskCompletions(uid);
      
      // Create a lookup map for completed tasks: key = "step_id|dayKey"
      const completedMap = new Map<string, boolean>();
      weeklyCompletions.forEach((c) => {
        const derivedDay = dayKeyFromCompletionDate(c.completion_date);
        if (derivedDay && c.completed) {
          const key = `${c.step_id}|${derivedDay}`;
          completedMap.set(key, true);
        }
      });

      // Count how many expected checkins have a matching completion
      let matchedCount = 0;
      expectedCheckins.forEach((exp: any) => {
        const day = exp.dayOfWeek?.toLowerCase();
        if (day) {
          const lookupKey = `${exp.step_id}|${day}`;
          if (completedMap.has(lookupKey)) {
            matchedCount++;
          }
        }
      });
      
      // Create CheckinProgress with matched completion count
      const progress: CheckinProgress = {
        num_checkins_this_week: matchedCount,
        expected_checkins_this_week: expectedCheckins,
        isUserOnTrack: () => 'on_schedule' as any
      };
      setCheckinProgress(progress);
      
      // Update plan progress based on matched completions
      const progressRatio = expectedCheckins.length > 0 
        ? matchedCount / expectedCheckins.length 
        : 0;
      setPlanProgress(Math.min(progressRatio, 1));
      
      // Also refresh today's completions for the UI
      const todayCompletions = await getTodayTaskCompletionsFromSupabase(uid);
      setCompletedTasks(todayCompletions);
    } catch (error) {
      console.error('Error refreshing progress data:', error);
    }
  }, [userId, currentUserProfile]);

  const refreshTodayTrainingState = useCallback(async () => {
    if (!userId) return;
    const todayDate = new Date();
    const todayYmd = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
    const ui = await getTrainingDayUiForDate(userId, todayYmd, onboardingData.actionPlan);
    setTodayTrainingUi(ui);
    const weightKg = (await getLatestUserWeightKg(userId).catch(() => undefined)) ?? 72;
    const adjustment = await recomputeDailyAdjustment({
      userId,
      adjustmentDate: todayYmd,
      weightKg,
      onboardData: onboardingData,
      actionPlan: onboardingData.actionPlan,
      selectedGoal: onboardingData.selectedGoal ?? null,
      forceRecompute: true,
    }).catch(() => null);
    const resolvedAdjustment = adjustment ?? (await getAdjustmentForDate(userId, todayYmd));
    setNutritionAdjustment(resolvedAdjustment);
    const nutrition = await getTodayNutrition(userId, {
      dayType: ui.dayType,
      actionPlan: onboardingData.actionPlan,
    });
    setNutritionData(nutrition);
  }, [userId, onboardingData.actionPlan, onboardingData.selectedGoal]);

  // Helper: compute all-time weekly consistency scores from local data.
  // Training counts a calendar day as "trained" iff there is at least one
  // workout_log OR one qualifying activity on that date — a strength
  // session + a hard run on the same day count as one, not two. See
  // `mergeTrainingCountsWithDailyCap` in lib/consistency-helper.ts.
  const computeWeeklyConsistencyScoresFromLocal = useCallback((
    allMealCountsByDate: Record<string, number>,
    allWorkoutPairs: Array<{ workout_date: string; workout_day_name: string }>,
    currentMonday: Date,
    qualifyingActivityCountsByDate: Record<string, number> = {},
  ) => {
    const allDates = [
      ...Object.keys(allMealCountsByDate),
      ...allWorkoutPairs.map(w => w.workout_date),
      ...Object.keys(qualifyingActivityCountsByDate),
    ];
    if (allDates.length === 0) return [];

    const earliestDate = allDates.sort()[0];
    const earliestDateObj = new Date(earliestDate + 'T00:00:00');
    const earliestDow = earliestDateObj.getDay();
    const earliestMondayOffset = earliestDow === 0 ? -6 : 1 - earliestDow;
    const earliestMonday = new Date(earliestDateObj);
    earliestMonday.setDate(earliestDateObj.getDate() + earliestMondayOffset);
    earliestMonday.setHours(0, 0, 0, 0);

    // Pre-aggregate workout-day counts so we can apply the daily cap.
    const workoutCountsByDate: Record<string, number> = {};
    for (const w of allWorkoutPairs) {
      workoutCountsByDate[w.workout_date] = (workoutCountsByDate[w.workout_date] ?? 0) + 1;
    }
    const cappedTrainingByDate = mergeTrainingCountsWithDailyCap(
      workoutCountsByDate,
      qualifyingActivityCountsByDate,
    );

    const T = plannedTrainingDays.size;
    const N = 21;
    const scores: Array<{ weekStart: string; weekEnd: string; score: number; hasMeals: boolean; hasWorkouts: boolean }> = [];
    const wStart = new Date(earliestMonday);

    while (wStart <= currentMonday) {
      const wEnd = new Date(wStart);
      wEnd.setDate(wStart.getDate() + 6);
      const wStartStr = getLocalDateString(wStart);
      const wEndStr = getLocalDateString(wEnd);

      let weekMealTotal = 0;
      for (const [date, count] of Object.entries(allMealCountsByDate)) {
        if (date >= wStartStr && date <= wEndStr) weekMealTotal += Math.min(count, 3);
      }
      let weekTotalTraining = 0;
      for (const [date, count] of Object.entries(cappedTrainingByDate)) {
        if (date >= wStartStr && date <= wEndStr) weekTotalTraining += count;
      }

      let weekScore: number;
      if (T === 0) {
        weekScore = Math.round(Math.min((weekMealTotal / N) * 100, 100));
      } else {
        const tPart = Math.min((weekTotalTraining / T) * 100 * 0.5, 50);
        const nPart = Math.min((weekMealTotal / N) * 100 * 0.5, 50);
        weekScore = Math.round(tPart + nPart);
      }
      scores.push({
        weekStart: wStartStr,
        weekEnd: wEndStr,
        score: weekScore,
        hasMeals: weekMealTotal > 0,
        hasWorkouts: weekTotalTraining > 0,
      });

      wStart.setDate(wStart.getDate() + 7);
    }
    return scores;
  }, [plannedTrainingDays.size]);

  // Load dashboard data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const user = await getCurrentLoggedInUser();
        if (!user) return;
        setUserId(user.id);

        // ====================================================================
        // Phase 1: FAST LOCAL READS (instant display, no Supabase)
        // ====================================================================
        const { monday, sunday } = getWeekDateRange();
        const mondayStr = getLocalDateString(monday);
        const sundayStr = getLocalDateString(sunday);
        const todayStr = getLocalDateString(new Date());
        const allTimeStart = '2024-01-01'; // Safe start date before app existed

        // Lightweight SQLite queries - gets ALL historical data in one shot each.
        // Activity counts split into two: qualifying (used for the consistency
        // score and the tracker green-checks) and full (kept around in case a
        // future surface needs every logged activity, e.g. stretching reminders).
        const [
          allMealCountsByDate,
          allWorkoutPairs,
          thisWeekWorkoutNames,
          thisWeekWorkoutCounts,
          allQualifyingActivityCounts,
          thisWeekQualifyingActivityCounts,
        ] = await Promise.all([
          getLocalMealCountsByDate(user.id, allTimeStart, todayStr),
          getLocalWorkoutDateNamePairs(user.id, allTimeStart, todayStr),
          getLocalWorkoutDayNames(user.id, mondayStr, sundayStr),
          getLocalWorkoutCountsByDate(user.id, mondayStr, sundayStr),
          getQualifyingActivityCountsByDate(user.id, allTimeStart, todayStr),
          getQualifyingActivityCountsByDate(user.id, mondayStr, sundayStr),
        ]);

        // Daily cap of 1: a workout + a qualifying activity on the same day
        // counts as a single trained day on the tracker, not two. Stretching
        // / yoga-easy / etc. don't show up here at all (they are excluded by
        // getQualifyingActivityCountsByDate).
        const mergedThisWeekCounts = mergeTrainingCountsWithDailyCap(
          thisWeekWorkoutCounts,
          thisWeekQualifyingActivityCounts,
        );

        // Derive unique trained dates for tracker display (workout OR qualifying activity)
        const allWorkoutDates = [...new Set(allWorkoutPairs.map(w => w.workout_date))];
        const allActivityDates = Object.keys(allQualifyingActivityCounts);
        const allTrainingDates = [...new Set([...allWorkoutDates, ...allActivityDates])];

        // Derive current week tracker data from the full dataset
        const currentWeekMealCounts: Record<string, number> = {};
        for (const [date, count] of Object.entries(allMealCountsByDate)) {
          if (date >= mondayStr && date <= sundayStr) {
            currentWeekMealCounts[date] = count;
          }
        }
        setWeeklyMealCounts(currentWeekMealCounts);
        setWeeklyWorkoutDays(new Set(allTrainingDates.filter(d => d >= mondayStr && d <= sundayStr)));
        setWeeklyWorkoutCounts(mergedThisWeekCounts);
        setWeeklyLoggedWorkoutNames(thisWeekWorkoutNames);
        // Most recent completed workout (pairs are ordered by date ascending).
        setLastCompletedWorkoutName(
          allWorkoutPairs.length > 0
            ? allWorkoutPairs[allWorkoutPairs.length - 1].workout_day_name
            : null,
        );
        // Local counts are now populated — the score upload effect may run.
        setConsistencyDataLoaded(true);

        // Derive previous week data with the same daily cap as the current
        // week so the "5 of 7 days last week" display stays consistent.
        const { monday: prevMonday, sunday: prevSunday } = getPreviousWeekDateRange();
        const prevMondayStr = getLocalDateString(prevMonday);
        const prevSundayStr = getLocalDateString(prevSunday);
        const prevWeekWorkoutCounts: Record<string, number> = {};
        for (const w of allWorkoutPairs) {
          if (w.workout_date >= prevMondayStr && w.workout_date <= prevSundayStr) {
            prevWeekWorkoutCounts[w.workout_date] = (prevWeekWorkoutCounts[w.workout_date] ?? 0) + 1;
          }
        }
        const prevWeekQualifyingCounts: Record<string, number> = {};
        for (const [date, c] of Object.entries(allQualifyingActivityCounts)) {
          if (date >= prevMondayStr && date <= prevSundayStr) prevWeekQualifyingCounts[date] = c;
        }
        const prevWeekTrainingCap = mergeTrainingCountsWithDailyCap(
          prevWeekWorkoutCounts,
          prevWeekQualifyingCounts,
        );
        const prevWeekTotalTraining = Object.values(prevWeekTrainingCap).reduce((sum, c) => sum + c, 0);
        const prevWeekMeals = Object.entries(allMealCountsByDate)
          .filter(([date]) => date >= prevMondayStr && date <= prevSundayStr)
          .reduce((sum, [, count]) => sum + Math.min(count, 3), 0);

        if (prevWeekMeals > 0 || prevWeekTotalTraining > 0) {
          setLastWeekMealCount(prevWeekMeals);
          setLastWeekWorkoutCount(prevWeekTotalTraining);
        } else {
          setLastWeekMealCount(null);
          setLastWeekWorkoutCount(null);
        }

        // Compute ALL-TIME weekly consistency scores (for streak + chart)
        const allScores = computeWeeklyConsistencyScoresFromLocal(allMealCountsByDate, allWorkoutPairs, monday, allQualifyingActivityCounts);
        setWeeklyConsistencyScores(allScores);

        // Load today's nutrition (pure local SQLite)
        const nutrition = await getTodayNutrition(user.id, {
          actionPlan: onboardingData.actionPlan,
        });
        setNutritionData(nutrition);
        const todayDateForAdjustment = new Date();
        const todayYmdForAdjustment = `${todayDateForAdjustment.getFullYear()}-${String(todayDateForAdjustment.getMonth() + 1).padStart(2, '0')}-${String(todayDateForAdjustment.getDate()).padStart(2, '0')}`;
        const localAdjustmentWeightKg = (await getLatestUserWeightKg(user.id).catch(() => undefined)) ?? 72;
        const localAdjustment = await recomputeDailyAdjustment({
          userId: user.id,
          adjustmentDate: todayYmdForAdjustment,
          weightKg: localAdjustmentWeightKg,
          onboardData: onboardingData,
          actionPlan: onboardingData.actionPlan,
          selectedGoal: onboardingData.selectedGoal ?? null,
        }).catch(() => null);
        setNutritionAdjustment(localAdjustment ?? (await getAdjustmentForDate(user.id, todayYmdForAdjustment)));
        getTrainingDayUiForDate(user.id, todayYmdForAdjustment, onboardingData.actionPlan)
          .then(setTodayTrainingUi)
          .catch(() => setTodayTrainingUi(null));

        // Sustained plan-vs-reality deviation → coach card with CTA to plan
        // regeneration. Best-effort, no silent writes.
        detectPlanDeviation({
          userId: user.id,
          actionPlan: onboardingData.actionPlan,
          todayYmd: todayYmdForAdjustment,
        })
          .then((signal) => setPlanDeviationSignal(signal))
          .catch(() => setPlanDeviationSignal(null));

        // ====================================================================
        // Phase 2: BACKGROUND SUPABASE SYNC (non-blocking)
        // ====================================================================
        // Fire-and-forget: retry any pending syncs
        retryPendingMealLogs().catch(err => console.error('[CoachDashboard] Error retrying pending meal logs:', err));
        retryPendingWorkoutDeletions().catch(err =>
          console.error('[CoachDashboard] Error retrying pending workout deletions:', err)
        );
        retryPendingWorkoutLogs()
          .then(() => retryPendingExerciseLogs())
          .catch(err => console.error('[CoachDashboard] Error retrying pending workout/exercise logs:', err));
        retryPendingActivityLogs().catch(err => console.error('[CoachDashboard] Error retrying pending activity logs:', err));
        retryPendingChatMessages().catch(err => console.error('[CoachDashboard] Error retrying pending chat messages:', err));

        // Background: sync nutrition targets + meal logs from Supabase, then refresh nutrition display
        const genderQuestion = onboardingData?.clarifyingQuestions?.find(q => q.question === 'gender_question');
        const userGender = genderQuestion?.answer || null;
        (async () => {
          try {
            await syncNutritionTargetsFromSupabase(user.id).catch(() => {});
            await initializeNutritionTargetsIfNeeded(user.id, userGender).catch(() => {});
            await syncMealLogsFromSupabase(user.id).catch(() => {});
            await syncActivityLogsFromSupabase(user.id).catch(() => {});
            // Wearables v1: pull daily metrics and recompute the adjustment
            // layer. Entire block is gated by the feature flag so shipping
            // infra ahead of UI doesn't change behaviour for current users.
            if (isWearablesV1Enabled()) {
              await syncDailyMetricsFromSupabase(user.id).catch(() => {});
            }
            const todayDate = new Date();
            const todayYmd = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
            const adjustmentWeightKg = (await getLatestUserWeightKg(user.id).catch(() => undefined)) ?? 72;
            const adjustment = await recomputeDailyAdjustment({
              userId: user.id,
              adjustmentDate: todayYmd,
              weightKg: adjustmentWeightKg,
              onboardData: onboardingData,
              actionPlan: onboardingData.actionPlan,
              selectedGoal: onboardingData.selectedGoal ?? null,
            }).catch(() => null);
            setNutritionAdjustment(adjustment ?? (await getAdjustmentForDate(user.id, todayYmd)));
            const stepsRow = await getCanonicalDailyMetric(user.id, todayYmd, 'steps').catch(() => null);
            setCanonicalStepsToday(stepsRow ? { value: stepsRow.value, source: stepsRow.source } : null);
            // Refresh nutrition after sync in case new data came from Supabase
            const refreshedNutrition = await getTodayNutrition(user.id, {
              actionPlan: onboardingData.actionPlan,
            });
            setNutritionData(refreshedNutrition);
            // Also refresh meal counts + scores after sync
            const refreshedMealCounts = await getLocalMealCountsByDate(user.id, allTimeStart, todayStr);
            const refreshedWorkoutPairs = await getLocalWorkoutDateNamePairs(user.id, allTimeStart, todayStr);
            const refreshedWorkoutDates = [...new Set(refreshedWorkoutPairs.map(w => w.workout_date))];
            const refreshedAllQualifyingCounts = await getQualifyingActivityCountsByDate(user.id, allTimeStart, todayStr);
            const refreshedThisWeekQualifyingCounts = await getQualifyingActivityCountsByDate(user.id, mondayStr, sundayStr);
            const refreshedQualifyingDates = Object.keys(refreshedAllQualifyingCounts);
            const refreshedAllTrainingDates = [...new Set([...refreshedWorkoutDates, ...refreshedQualifyingDates])];
            // Update current week
            const updatedWeekMeals: Record<string, number> = {};
            for (const [date, count] of Object.entries(refreshedMealCounts)) {
              if (date >= mondayStr && date <= sundayStr) updatedWeekMeals[date] = count;
            }
            setWeeklyMealCounts(updatedWeekMeals);
            setWeeklyWorkoutDays(new Set(refreshedAllTrainingDates.filter(d => d >= mondayStr && d <= sundayStr)));
            // Refresh workout counts (merged with qualifying activities, daily cap = 1)
            const refreshedWorkoutCounts = await getLocalWorkoutCountsByDate(user.id, mondayStr, sundayStr);
            const refreshedMergedCounts = mergeTrainingCountsWithDailyCap(
              refreshedWorkoutCounts,
              refreshedThisWeekQualifyingCounts,
            );
            setWeeklyWorkoutCounts(refreshedMergedCounts);
            getTrainingDayUiForDate(user.id, todayYmd, onboardingData.actionPlan)
              .then(setTodayTrainingUi)
              .catch(() => setTodayTrainingUi(null));
            getLocalWorkoutDayNames(user.id, mondayStr, sundayStr).then(names => setWeeklyLoggedWorkoutNames(names)).catch(() => {});
            setLastCompletedWorkoutName(
              refreshedWorkoutPairs.length > 0
                ? refreshedWorkoutPairs[refreshedWorkoutPairs.length - 1].workout_day_name
                : null,
            );
            // Update previous week with the same daily cap as the live week
            const updPrevMeals = Object.entries(refreshedMealCounts)
              .filter(([date]) => date >= prevMondayStr && date <= prevSundayStr)
              .reduce((sum, [, count]) => sum + Math.min(count, 3), 0);
            const updPrevWorkoutCounts: Record<string, number> = {};
            for (const w of refreshedWorkoutPairs) {
              if (w.workout_date >= prevMondayStr && w.workout_date <= prevSundayStr) {
                updPrevWorkoutCounts[w.workout_date] = (updPrevWorkoutCounts[w.workout_date] ?? 0) + 1;
              }
            }
            const updPrevQualifyingCounts: Record<string, number> = {};
            for (const [date, c] of Object.entries(refreshedAllQualifyingCounts)) {
              if (date >= prevMondayStr && date <= prevSundayStr) updPrevQualifyingCounts[date] = c;
            }
            const updPrevTotalTraining = Object.values(
              mergeTrainingCountsWithDailyCap(updPrevWorkoutCounts, updPrevQualifyingCounts),
            ).reduce((sum, c) => sum + c, 0);
            if (updPrevMeals > 0 || updPrevTotalTraining > 0) {
              setLastWeekMealCount(updPrevMeals);
              setLastWeekWorkoutCount(updPrevTotalTraining);
            }
            // Update all-time scores
            setWeeklyConsistencyScores(computeWeeklyConsistencyScoresFromLocal(refreshedMealCounts, refreshedWorkoutPairs, monday, refreshedAllQualifyingCounts));
          } catch (err) {
            console.error('[CoachDashboard] Background sync error:', err);
          }
        })();

        // Background: load task completions from Supabase
        getTodayTaskCompletionsFromSupabase(user.id).then(completions => {
          setCompletedTasks(completions);
        }).catch(err => console.error('[CoachDashboard] Error loading task completions:', err));

        // Background: load user profile and checkin progress
        getRemoteUserProfileLoggedInUser().then(async (userProfile) => {
          if (!userProfile) return;
          setCurrentUserProfile(userProfile);

          const expectedCheckins = userProfile.onboardingProfile?.actionPlan?.steps.reduce((checkins: any[], step) => {
            if (step.daysOfWeek && step.daysOfWeek.length > 0) {
              step.daysOfWeek.forEach(dayOfWeek => {
                checkins.push({
                  step_id: step.id,
                  step_title: step.title,
                  dayOfWeek: dayOfWeek,
                  timeOfDay: step.timeOfDay,
                });
              });
            }
            return checkins;
          }, []) || [];

          const weeklyCompletions = await getWeeklyTaskCompletions(user.id);
          const completedMap = new Map<string, boolean>();
          weeklyCompletions.forEach((c) => {
            const derivedDay = dayKeyFromCompletionDate(c.completion_date);
            if (derivedDay && c.completed) {
              completedMap.set(`${c.step_id}|${derivedDay}`, true);
            }
          });

          let matchedCount = 0;
          expectedCheckins.forEach((exp: any) => {
            const day = exp.dayOfWeek?.toLowerCase();
            if (day && completedMap.has(`${exp.step_id}|${day}`)) matchedCount++;
          });

          setCheckinProgress({
            num_checkins_this_week: matchedCount,
            expected_checkins_this_week: expectedCheckins,
            isUserOnTrack: () => 'on_schedule' as any
          });

          const progressRatio = expectedCheckins.length > 0 ? matchedCount / expectedCheckins.length : 0;
          setPlanProgress(Math.min(progressRatio, 1));
        }).catch(err => console.error('[CoachDashboard] Error loading user profile:', err));
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };

    loadData();
  }, [totalCheckinsPerWeek, dataVersion]);

  const toggleTaskCompletion = async (stepId: string) => {
    // MINIMAL FIX: Prevent silent failure when userId is not loaded
    if (!userId) {
      console.warn('Cannot toggle task - user not loaded yet');
      return;
    }
    
    const newCompletionState = !completedTasks[stepId];
    
    // Optimistically update UI
    setCompletedTasks(prev => ({
      ...prev,
      [stepId]: newCompletionState
    }));
    
    // Persist to Supabase
    try {
      await saveTaskCompletionToSupabase(userId, stepId, newCompletionState);
      
      // Refresh progress using matched completion logic
      await refreshProgressData();
    } catch (error) {
      console.error('Error saving task completion:', error);
      // Revert on error
      setCompletedTasks(prev => ({
        ...prev,
        [stepId]: !newCompletionState
      }));
    }
  };

  const handleShowCheckinDay = () => {
    setShowCheckinDay(true);
  };

  const handleCloseCheckinDay = () => {
    setShowCheckinDay(false);
  };

  // Weekly consistency score calculation
  // Formula: score = min((t/T)*100*50%, 50) + min((n/N)*100*50%, 50)
  // t = workouts logged this week until today, T = planned training days until today
  // n = meals logged this week until today,    N = 3 meals/day × days elapsed since join (or Mon, whichever is later)
  const todayDayIndex = new Date().getDay(); // 0=Sun, 1=Mon...
  const daysElapsedThisWeek = todayDayIndex === 0 ? 7 : todayDayIndex; // Mon=1 → Sun=7
  const WEEK_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  // User's account start date — days before this should not count as missed
  const userStartDateStr = currentUserProfile?.created_at
    ? getLocalDateString(new Date(currentUserProfile.created_at))
    : null;
  const { monday: _scoreMonday } = getWeekDateRange();
  // Only count week days that fall on or after the user's join date
  const daysUntilToday = new Set(
    WEEK_DAY_KEYS.slice(0, daysElapsedThisWeek).filter(dayKey => {
      if (!userStartDateStr) return true;
      const idx = WEEK_DAY_KEYS.indexOf(dayKey);
      const d = new Date(_scoreMonday);
      d.setDate(_scoreMonday.getDate() + idx);
      return getLocalDateString(d) >= userStartDateStr;
    })
  );
  // Extra workouts on unplanned days can "cover" earlier missed planned days,
  // removing the X from the tracker and making the missed day appear empty.
  const coveredMissedDays = useMemo(() => {
    let extraWorkoutCount = 0;
    for (const dateStr of weeklyWorkoutDays) {
      const d = new Date(dateStr + 'T00:00:00');
      const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()];
      if (!plannedTrainingDays.has(dayKey)) {
        extraWorkoutCount += (weeklyWorkoutCounts[dateStr] || 1);
      }
    }
    if (extraWorkoutCount === 0) return new Set<string>();

    const todayStr = getLocalDateString(new Date());
    const missedDays: string[] = [];
    for (const day of WEEK_DAYS) {
      const dateStr = getDateForWeekDay(day);
      if (dateStr >= todayStr) continue;
      if (userStartDateStr && dateStr < userStartDateStr) continue;
      if (!plannedTrainingDays.has(day)) continue;
      if (weeklyWorkoutDays.has(dateStr)) continue;
      missedDays.push(day);
    }

    return new Set(missedDays.slice(0, extraWorkoutCount));
  }, [weeklyWorkoutDays, weeklyWorkoutCounts, plannedTrainingDays, getDateForWeekDay, userStartDateStr]);

  // Show a catch-up nudge at most once per week when there are uncovered missed workouts
  useEffect(() => {
    const checkCatchUpNudge = async () => {
      const todayStr = getLocalDateString(new Date());
      let hasUncoveredMissed = false;
      for (const day of WEEK_DAYS) {
        const dateStr = getDateForWeekDay(day);
        if (dateStr >= todayStr) continue;
        if (userStartDateStr && dateStr < userStartDateStr) continue;
        if (!plannedTrainingDays.has(day)) continue;
        if (weeklyWorkoutDays.has(dateStr)) continue;
        if (coveredMissedDays.has(day)) continue;
        hasUncoveredMissed = true;
        break;
      }

      if (!hasUncoveredMissed) {
        setShowCatchUpNudge(false);
        return;
      }

      const { monday } = getWeekDateRange();
      const weekStr = getLocalDateString(monday);
      const lastDismissed = await AsyncStorage.getItem('catchUpNudgeDismissedWeek');
      if (lastDismissed === weekStr) {
        setShowCatchUpNudge(false);
        return;
      }

      setShowCatchUpNudge(true);
    };

    checkCatchUpNudge().catch(() => {});
  }, [weeklyWorkoutDays, plannedTrainingDays, coveredMissedDays, getDateForWeekDay, userStartDateStr, getWeekDateRange]);

  const MEALS_UNTIL_TODAY = 3 * daysUntilToday.size;
  const plannedTrainingDaysUntilToday = [...plannedTrainingDays].filter(d => daysUntilToday.has(d)).length;
  
  // Meals: cap each day at 3 so extra meals on one day don't cover for another
  const thisWeekMeals = Object.values(weeklyMealCounts).reduce((sum, c) => sum + Math.min(c, 3), 0);
  // Workouts: count total sessions (cumulative, no per-day cap)
  const scoreTodayStr = getLocalDateString(new Date());
  const workoutsUntilToday = Object.entries(weeklyWorkoutCounts)
    .filter(([date]) => date <= scoreTodayStr)
    .reduce((sum, [, c]) => sum + c, 0);
  const allWeekWorkouts = Object.values(weeklyWorkoutCounts).reduce((sum, c) => sum + c, 0);

  // Once the user has logged at least as many sessions as their weekly training
  // target, any remaining planned days (today or upcoming) are no longer pending
  // obligations, so we stop surfacing the empty "pending" training box for them.
  const weeklyTrainingGoalMet =
    plannedTrainingDays.size > 0 && allWeekWorkouts >= plannedTrainingDays.size;

  const noTrainingExpectedYet = plannedTrainingDaysUntilToday === 0;
  let thisWeekScore: number;
  let trainingPart: number;
  let nutritionPart: number;

  if (noTrainingExpectedYet) {
    trainingPart = 0;
    nutritionPart = MEALS_UNTIL_TODAY > 0
      ? Math.min((thisWeekMeals / MEALS_UNTIL_TODAY) * 100, 100)
      : 0;
    thisWeekScore = Math.round(nutritionPart);
  } else {
    trainingPart = Math.min((workoutsUntilToday / plannedTrainingDaysUntilToday) * 100 * 0.5, 50);
    nutritionPart = MEALS_UNTIL_TODAY > 0
      ? Math.min((thisWeekMeals / MEALS_UNTIL_TODAY) * 100 * 0.5, 50)
      : 0;
    thisWeekScore = Math.round(trainingPart + nutritionPart);
  }

  // "Whole week" score: what's been done so far vs. full week targets
  const MEALS_PER_FULL_WEEK = 21;
  const totalPlannedTrainingDays = plannedTrainingDays.size;
  let wholeWeekScore: number;
  if (totalPlannedTrainingDays === 0) {
    wholeWeekScore = Math.round(Math.min((thisWeekMeals / MEALS_PER_FULL_WEEK) * 100, 100));
  } else {
    const wholeTrainingPart = Math.min((allWeekWorkouts / totalPlannedTrainingDays) * 100 * 0.5, 50);
    const wholeNutritionPart = Math.min((thisWeekMeals / MEALS_PER_FULL_WEEK) * 100 * 0.5, 50);
    wholeWeekScore = Math.round(wholeTrainingPart + wholeNutritionPart);
  }

  const consistencyStreak = useMemo(() => {
    if (weeklyConsistencyScores.length === 0) return 0;
    let streak = 0;
    if (wholeWeekScore >= CONSISTENCY_THRESHOLD) streak = 1;
    for (let i = weeklyConsistencyScores.length - 2; i >= 0; i--) {
      if (weeklyConsistencyScores[i].score >= CONSISTENCY_THRESHOLD) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }, [weeklyConsistencyScores, wholeWeekScore]);

  const displayedScore = scoreMode === 'until_today' ? thisWeekScore : wholeWeekScore;

  // Debug: log score calculation inputs so we can trace unexpected values
  console.log('[CoachDashboard] Score breakdown:', JSON.stringify({
    todayDayIndex,
    daysElapsedThisWeek,
    MEALS_UNTIL_TODAY,
    plannedTrainingDays: [...plannedTrainingDays],
    daysUntilToday: [...daysUntilToday],
    plannedTrainingDaysUntilToday,
    workoutsUntilToday,
    allWeekWorkouts,
    thisWeekMeals,
    weeklyMealCounts,
    weeklyWorkoutCounts,
    trainingPart,
    nutritionPart,
    thisWeekScore,
    wholeWeekScore,
    scoreMode,
  }));
  const lastWeekHasData = lastWeekMealCount !== null || lastWeekWorkoutCount !== null;
  const lastWeekScore: number | null = lastWeekHasData
    ? (() => {
        if (totalPlannedTrainingDays === 0) {
          return Math.round(Math.min(((lastWeekMealCount ?? 0) / MEALS_PER_FULL_WEEK) * 100, 100));
        }
        const lwTrainingPart = Math.min(((lastWeekWorkoutCount ?? 0) / totalPlannedTrainingDays) * 100 * 0.5, 50);
        const lwNutritionPart = Math.min(((lastWeekMealCount ?? 0) / MEALS_PER_FULL_WEEK) * 100 * 0.5, 50);
        return Math.round(lwTrainingPart + lwNutritionPart);
      })()
    : null;

  // Save current week score to local DB + Supabase for leaderboard.
  // Gated on `consistencyDataLoaded` so we never upload the transient 0 computed
  // before local meal/workout counts have been read.
  useEffect(() => {
    if (!userId || !consistencyDataLoaded) return;
    const { monday } = getWeekDateRange();
    const weekStartStr = getLocalDateString(monday);
    console.log('[CoachDashboard] Saving consistency score:', {
      userId,
      weekStartStr,
      thisWeekScore,
      workoutsUntilToday,
      allWeekWorkouts,
      thisWeekMeals,
      trainingPart,
      nutritionPart,
    });
    // Save locally (fast, always works)
    saveLocalConsistencyScore(userId, weekStartStr, thisWeekScore).catch(() => {});
    // Background sync to Supabase
    saveConsistencyScoreToSupabase(userId, weekStartStr, thisWeekScore).catch(() => {});
  }, [userId, thisWeekScore, getWeekDateRange, consistencyDataLoaded]);

  const outerRadius = 76;
  const innerRadius = 60;
  const strokeWidth = 8;
  const outerCircumference = 2 * Math.PI * outerRadius;
  const innerCircumference = 2 * Math.PI * innerRadius;
  const outerOffset = outerCircumference - (displayedScore / 100) * outerCircumference;
  const innerOffset = lastWeekScore !== null
    ? innerCircumference - (lastWeekScore / 100) * innerCircumference
    : innerCircumference; // Full offset = empty ring when no data
  const svgSize = (outerRadius + strokeWidth) * 2;

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={closeScoreModeDropdown}
      >
        {/* Header with Background Image - extends to just before Weekly Tasks */}
        <View style={styles.headerContainer} onLayout={(e) => setHeaderLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
          <View style={styles.scoreSectionBgImageContainer}>
            <Image
              source={bgImageSource}
              style={[styles.scoreSectionBgImage, onboardingGender === 'female' && styles.bgImageZoom]}
              resizeMode="cover"
            />
            {/* Smooth gradient overlay - image visible at top, gradually fades to background before Weekly Tasks */}
            {headerLayout && headerLayout.height > 0 && (
              <Svg style={styles.scoreSectionGradientSvg} width={headerLayout.width} height={headerLayout.height}>
                <Defs>
                  <LinearGradient id="headerFade" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#0B1114" stopOpacity="0" />
                    <Stop offset="0.4" stopColor="#0B1114" stopOpacity="0" />
                    <Stop offset="0.55" stopColor="#0B1114" stopOpacity="0.3" />
                    <Stop offset="0.7" stopColor="#0B1114" stopOpacity="0.6" />
                    <Stop offset="0.85" stopColor="#0B1114" stopOpacity="0.88" />
                    <Stop offset="1" stopColor="#0B1114" stopOpacity="1" />
                  </LinearGradient>
                </Defs>
                <Rect x={0} y={0} width={headerLayout.width} height={headerLayout.height} fill="url(#headerFade)" />
              </Svg>
            )}
          </View>

          {/* Consistency Score Ring */}
          <View style={styles.scoreSection}>
            <View style={styles.scoreGradientOverlay}>
              <Text style={styles.scoreLabel}>{t('home:weeklyScore')}</Text>
              <View style={styles.scoreModeRow}>
                <TouchableOpacity
                  style={styles.scoreModeToggle}
                  onPress={toggleScoreModeDropdown}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.scoreModeText}>{scoreMode === 'until_today' ? t('home:untilToday') : t('home:wholeWeek')}</Text>
                  <Text style={styles.scoreModeChevron}>▾</Text>
                </TouchableOpacity>
              </View>
              {showScoreModeDropdown && (
                <View style={styles.scoreModeDropdown}>
                  <TouchableOpacity
                    style={[styles.scoreModeOption, scoreMode === 'until_today' && styles.scoreModeOptionActive]}
                    onPress={() => { setScoreMode('until_today'); closeScoreModeDropdown(); }}
                  >
                    <Text style={[styles.scoreModeOptionText, scoreMode === 'until_today' && styles.scoreModeOptionTextActive]}>{t('home:untilToday')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.scoreModeOption, scoreMode === 'whole_week' && styles.scoreModeOptionActive]}
                    onPress={() => { setScoreMode('whole_week'); closeScoreModeDropdown(); }}
                  >
                    <Text style={[styles.scoreModeOptionText, scoreMode === 'whole_week' && styles.scoreModeOptionTextActive]}>{t('home:wholeWeek')}</Text>
                  </TouchableOpacity>
                </View>
              )}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => { closeScoreModeDropdown(); setShowStreakDetail(true); }}
              >
              <View style={styles.ringContainer}>
              <Svg width={svgSize} height={svgSize}>
                {/* Outer ring track */}
                <Circle
                  cx={svgSize / 2}
                  cy={svgSize / 2}
                  r={outerRadius}
                  stroke="#1E2A2C"
                  strokeWidth={strokeWidth}
                  fill="none"
                />
                {/* Outer ring fill - this week */}
                <Circle
                  cx={svgSize / 2}
                  cy={svgSize / 2}
                  r={outerRadius}
                  stroke="#F47C3C"
                  strokeWidth={strokeWidth}
                  fill="none"
                  strokeDasharray={`${outerCircumference}`}
                  strokeDashoffset={outerOffset}
                  strokeLinecap="round"
                  rotation={-90}
                  origin={`${svgSize / 2}, ${svgSize / 2}`}
                />
                {/* Inner ring track */}
                <Circle
                  cx={svgSize / 2}
                  cy={svgSize / 2}
                  r={innerRadius}
                  stroke={lastWeekScore !== null ? '#1E2A2C' : '#161E20'}
                  strokeWidth={strokeWidth - 2}
                  fill="none"
                  strokeDasharray={lastWeekScore === null ? '4,6' : undefined}
                  opacity={lastWeekScore === null ? 0.5 : 1}
                />
                {/* Inner ring fill - last week (only render when there's data) */}
                {lastWeekScore !== null && (
                  <Circle
                    cx={svgSize / 2}
                    cy={svgSize / 2}
                    r={innerRadius}
                    stroke="#9AA3A6"
                    strokeWidth={strokeWidth - 2}
                    fill="none"
                    strokeDasharray={`${innerCircumference}`}
                    strokeDashoffset={innerOffset}
                    strokeLinecap="round"
                    rotation={-90}
                    origin={`${svgSize / 2}, ${svgSize / 2}`}
                  />
                )}
              </Svg>
              {/* Center text overlay */}
              <View style={styles.ringCenterText}>
                <Text style={styles.scoreNumber}>{displayedScore}</Text>
                <Text style={styles.scoreTitle}>{t('home:consistency')}</Text>
              </View>
            </View>
            {/* Legend with numeric scores */}
            <View style={styles.scoreLegend}>
              <View style={styles.scoreLegendItem}>
                <View style={[styles.scoreLegendDot, { backgroundColor: '#F47C3C' }]} />
                <View>
                  <Text style={styles.scoreLegendText}>{t('home:thisWeek')}</Text>
                  <Text style={styles.scoreLegendValue}>{displayedScore}</Text>
                </View>
              </View>
              <View style={styles.scoreLegendItem}>
                <View style={[styles.scoreLegendDot, { backgroundColor: lastWeekScore !== null ? '#9AA3A6' : '#2A3638' }]} />
                <View>
                  <Text style={styles.scoreLegendText}>{t('home:lastWeek')}</Text>
                  {lastWeekScore !== null ? (
                    <Text style={styles.scoreLegendValueMuted}>{lastWeekScore}</Text>
                  ) : (
                    <Text style={styles.scoreLegendNoData}>{t('home:noData')}</Text>
                  )}
                </View>
              </View>
            </View>
              </TouchableOpacity>
            {/* Discrete arrow to streak detail */}
            <TouchableOpacity
              style={styles.scoreArrow}
              onPress={() => setShowStreakDetail(true)}
              activeOpacity={0.6}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            >
              <Text style={styles.scoreArrowText}>›</Text>
            </TouchableOpacity>
            </View>
          </View>

          {/* Today's Workout Ribbon */}
          {todayPendingWorkout && (
            <ElectricBorderRibbon
              todayPendingWorkout={todayPendingWorkout}
              onStartWorkout={onStartWorkout}
            />
          )}
        </View>

        {/* Weekly Tracker Table */}
        <View style={styles.trackerSection}>
          <Text style={styles.trackerTitle}>{t('home:weeklyTasks')}</Text>
          {/* One-tap confirmation when a wearable activity might be a duplicate of a logged workout */}
          {userId ? (
            <LinkActivityPill
              userId={userId}
              dataVersion={dataVersion}
              onResolved={() => {
                if (typeof refreshProgressData === 'function') void refreshProgressData();
              }}
            />
          ) : null}
          {/* Day headers */}
          <View style={styles.trackerRow}>
            <View style={styles.trackerRowLabel} />
            {WEEK_DAYS.map((day, i) => (
              <View key={day} style={[styles.trackerHeaderCell, todayDayAbbrev === day && styles.trackerTodayTop]}>
                <Text style={[styles.trackerDayText, todayDayAbbrev === day && styles.trackerTodayText]}>
                  {WEEK_DAY_LABELS[i]}
                </Text>
              </View>
            ))}
          </View>
          {/* Nutrition row */}
          <View style={styles.trackerRow}>
            <View style={styles.trackerRowLabel}>
              <Text style={styles.trackerRowLabelText}>{t('home:rowNutrition')}</Text>
            </View>
            {WEEK_DAYS.map((day) => {
              const dateStr = getDateForWeekDay(day);
              const todayStr = getLocalDateString(new Date());
              const isFuture = dateStr > todayStr;
              const isBeforeStart = userStartDateStr ? dateStr < userStartDateStr : false;
              const isToday = dateStr === todayStr;
              const mealCount = (isFuture || isBeforeStart) ? -1 : (weeklyMealCounts[dateStr] || 0);
              const clampedMeals = mealCount < 0 ? -1 : Math.min(mealCount, 3);
              // -1 = future/before-join (empty), 0 = no background, 1 = light orange, 2 = medium orange, 3 = full accent
              const nutritionBg = clampedMeals <= 0
                ? 'transparent'
                : clampedMeals === 1
                  ? 'rgba(244, 124, 60, 0.2)'
                  : clampedMeals === 2
                    ? 'rgba(244, 124, 60, 0.5)'
                    : '#F47C3C';
              const nutritionTextColor = clampedMeals === 3 ? '#0B1114' : clampedMeals === 0 ? '#6F7A7E' : '#F2F2EE';
              return (
                <View key={day} style={[styles.trackerCell, todayDayAbbrev === day && styles.trackerTodayMiddle]}>
                  {(isFuture || isBeforeStart) ? (
                    <View style={[styles.trackerIndicator, { backgroundColor: 'transparent', borderColor: 'transparent' }]} />
                  ) : (
                    <View style={[
                      styles.trackerIndicator,
                      { backgroundColor: nutritionBg, borderColor: clampedMeals === 0 ? '#1E2A2C' : nutritionBg },
                    ]}>
                      {clampedMeals === 3 ? (
                        <Text style={styles.trackerCheckmark}>✓</Text>
                      ) : clampedMeals === 0 && !isToday ? (
                        <Text style={styles.trackerMissed}>X</Text>
                      ) : clampedMeals > 0 ? (
                        <Text style={[styles.trackerNutritionText, { color: nutritionTextColor }]}>
                          {clampedMeals}
                        </Text>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
          {/* Training row */}
          <View style={styles.trackerRow}>
            <View style={styles.trackerRowLabel}>
              <Text style={styles.trackerRowLabelText}>{t('home:rowTraining')}</Text>
            </View>
            {WEEK_DAYS.map((day) => {
              const dateStr = getDateForWeekDay(day);
              const todayStr = getLocalDateString(new Date());
              const isFuture = dateStr > todayStr;
              const isBeforeStart = userStartDateStr ? dateStr < userStartDateStr : false;
              const isPlanned = plannedTrainingDays.has(day);
              const isLogged = weeklyWorkoutDays.has(dateStr);
              const isPast = dateStr < todayStr && !isBeforeStart;
              const isTodayOrFuture = dateStr >= todayStr;
              const workoutCount = weeklyWorkoutCounts[dateStr] || 0;
              // Hide the pending box for today/upcoming planned days once the
              // user has already met their weekly training target.
              const pendingButGoalMet = isTodayOrFuture && weeklyTrainingGoalMet;
              return (
                <View key={day} style={[styles.trackerCell, todayDayAbbrev === day && styles.trackerTodayBottom]}>
                  {(isFuture || isBeforeStart) ? (
                    <View style={[styles.trackerIndicator, { backgroundColor: 'transparent', borderColor: 'transparent' }]} />
                  ) : isLogged ? (
                    <View style={{ position: 'relative' }}>
                      <View style={[styles.trackerIndicator, styles.trackerIndicatorLogged]}>
                        <Text style={styles.trackerCheckmark}>✓</Text>
                      </View>
                      {workoutCount > 1 && (
                        <View style={styles.workoutCountBadge}>
                          <Text style={styles.workoutCountBadgeText}>{workoutCount}</Text>
                        </View>
                      )}
                    </View>
                  ) : (isPlanned && !coveredMissedDays.has(day) && !pendingButGoalMet) ? (
                    <View style={[styles.trackerIndicator, styles.trackerIndicatorPlanned]}>
                      {isPast ? (
                        <Text style={styles.trackerMissed}>X</Text>
                      ) : null}
                    </View>
                  ) : (
                    <View style={[styles.trackerIndicator, { backgroundColor: 'transparent', borderColor: 'transparent' }]} />
                  )}
                </View>
              );
            })}
          </View>
          {showCatchUpNudge && (
            <View style={styles.catchUpNudge}>
              <Text style={styles.catchUpNudgeText}>{t('home:catchUpNudge')}</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowCatchUpNudge(false);
                  const { monday } = getWeekDateRange();
                  AsyncStorage.setItem('catchUpNudgeDismissedWeek', getLocalDateString(monday)).catch(() => {});
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.catchUpNudgeDismiss}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {planDeviationSignal && onNavigateToChatWithMessage ? (
          <TouchableOpacity
            style={styles.deviationCard}
            activeOpacity={0.85}
            onPress={() => {
              onNavigateToChatWithMessage(
                t('home:planDeviationCta', {
                  defaultValue: "I'd like to refresh my plan based on the past two weeks.",
                }),
              );
            }}
          >
            <Text style={styles.deviationCardTitle}>
              {planDeviationSignal.driver === 'activity'
                ? t('home:planDeviationActivityTitle', {
                    defaultValue: 'Your activity has drifted from your plan',
                  })
                : planDeviationSignal.driver === 'intake'
                ? t('home:planDeviationIntakeTitle', {
                    defaultValue: 'Your intake has drifted from your target',
                  })
                : t('home:planDeviationBothTitle', {
                    defaultValue: 'Your habits look different from your plan',
                  })}
            </Text>
            <Text style={styles.deviationCardBody}>
              {planDeviationSignal.direction === 'over'
                ? t('home:planDeviationOverBody', {
                    defaultValue:
                      "We've seen sustained over-shoots vs the plan for the past two weeks. Want to refresh your targets?",
                  })
                : t('home:planDeviationUnderBody', {
                    defaultValue:
                      "We've seen sustained under-shoots vs the plan for the past two weeks. Want to refresh your targets?",
                  })}
            </Text>
            <Text style={styles.deviationCardCta}>
              {t('home:planDeviationCtaLabel', { defaultValue: 'Talk to your coach →' })}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Consume + active-burn blocks. BMR is hidden on the burn bar and only
            surfaces inside the breakdown modal. */}
        {userId ? (() => {
          const wFallback = weightKgCached ?? 70;
          const bmrFallback = bmrKcalCached ?? Math.round(wFallback * 24);
          // Use the same baseline-movement value the burn-card effect resolved
          // (persisted-first with onboarding fallback). Falls back to a sync
          // recompute on the very first render before the effect runs.
          const baselineMovementForModal =
            baselineMovementKcalCached ?? estimateBaselineMovementKcalFromOnboard(onboardingData);
          const activeBurnRows = burnedBreakdown
            ? activeBurnHomeRowsFromBreakdown(burnedBreakdown)
            : undefined;
          return (
            <View ref={nutritionSectionRef} collapsable={false}>
              <CaloriesBalanceCard
                nutritionData={nutritionData}
                nutritionAdjustment={nutritionAdjustment}
                activeBurnRows={activeBurnRows}
                dayType={todayTrainingUi?.dayType}
                daySwapped={todayTrainingUi?.daySwapped}
                swapKind={todayTrainingUi?.swapKind}
                plannedTraining={plannedTrainingToday}
                onDayTypeOverrideChanged={refreshTodayTrainingState}
                modalInputs={{
                  userId,
                  todayYmd: todayYmdLocal,
                  bmrKcal: bmrFallback,
                  weightKg: wFallback,
                  occupationNeatKcal: baselineMovementForModal,
                  plannedTrainingToday: plannedTrainingForBurnTarget,
                  plannedSessionTargetKcal: plannedSessionBurnTargetKcal,
                }}
              />
            </View>
          );
        })() : null}

      </ScrollView>

      {/* CheckinDay Modal */}
      {showCheckinDay && (
        <CheckinDay
          visible={showCheckinDay}
          onClose={handleCloseCheckinDay}
          checkinProgress={checkinProgress}
          userProfile={currentUserProfile}
          onDataChange={refreshProgressData}
        />
      )}

      {/* Meal Log Options Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isMealLogOptionsModalVisible}
        onRequestClose={() => setIsMealLogOptionsModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.mealLogModalOverlay}
          activeOpacity={1}
          onPress={() => setIsMealLogOptionsModalVisible(false)}
        >
          <Pressable style={[styles.mealLogOptionsModalContent, { paddingBottom: sheetBottomPadding }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.mealLogOptionsTitle}>{t('home:mealLogTitle')}</Text>
            <Text style={styles.mealLogOptionsSubtitle}>{t('home:mealLogSubtitle')}</Text>
            <View style={styles.mealLogOptionsButtons}>
              <TouchableOpacity
                style={styles.mealLogOptionButton}
                onPress={async () => {
                  setIsMealLogOptionsModalVisible(false);
                  if (onNavigateToChat) {
                    onNavigateToChat();
                  }
                  // Small delay to ensure navigation completes
                  setTimeout(async () => {
                    const imageUri = await openCamera();
                    if (imageUri && onNavigateToChatWithMealImage) {
                      onNavigateToChatWithMealImage(imageUri);
                    }
                  }, 300);
                }}
              >
                    <Icon source={appIcons.camera} width={35} height={35} fill="#F47C3C" style={styles.mealOptionIconWrapper} />
                    <Text style={styles.mealOptionTitle}>{t('home:mealOptionPhoto')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mealLogOptionButton}
                onPress={async () => {
                  setIsMealLogOptionsModalVisible(false);
                  if (onNavigateToChat) {
                    onNavigateToChat();
                  }
                  // Small delay to ensure navigation completes
                  setTimeout(async () => {
                    const imageUri = await openImageGallery();
                    if (imageUri && onNavigateToChatWithMealImage) {
                      onNavigateToChatWithMealImage(imageUri);
                    }
                  }, 300);
                }}
              >
                    <Icon source={appIcons.gallery_thumbnail} width={35} height={35} fill="#F47C3C" style={styles.mealOptionIconWrapper} />
                    <Text style={styles.mealOptionTitle}>{t('home:mealOptionGallery')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mealLogOptionButton}
                onPress={() => {
                  setIsMealLogOptionsModalVisible(false);
                  if (onNavigateToChatWithMessage) {
                    onNavigateToChatWithMessage(t('main:prefilledMealMessage'));
                  }
                }}
              >
                    <Icon source={appIcons.chat} width={35} height={35} fill="#F47C3C" style={styles.mealOptionIconWrapper} />
                    <Text style={styles.mealOptionTitle}>{t('home:mealOptionText')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mealLogOptionButton}
                onPress={() => {
                  setIsMealLogOptionsModalVisible(false);
                  if (onNavigateToRecentMeals) {
                    onNavigateToRecentMeals();
                  }
                }}
              >
                    <Icon source={appIcons.lists} width={35} height={35} fill="#F47C3C" style={styles.mealOptionIconWrapper} />
                    <Text style={styles.mealOptionTitle}>{t('home:mealOptionRecent')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </TouchableOpacity>
      </Modal>

      {/* Streak Detail Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showStreakDetail}
        onRequestClose={() => setShowStreakDetail(false)}
      >
        <TouchableOpacity
          style={styles.mealLogModalOverlay}
          activeOpacity={1}
          onPress={() => setShowStreakDetail(false)}
        >
          <Pressable style={[styles.streakDetailModal, { paddingBottom: sheetBottomPadding }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.streakDetailHandle} />
            <Text style={styles.streakTitle}>
              {t('home:streakTitle', { streak: consistencyStreak })}
            </Text>

            {/* Explanation */}
            <Text style={styles.consistencyExplanation}>
              {t('home:streakExplanation')}
            </Text>
            <Text style={styles.streakThresholdNote}>
              {t('home:streakThreshold', { threshold: CONSISTENCY_THRESHOLD })}
            </Text>
            
            {/* SVG Bar Chart (last 6 weeks) */}
            {(() => {
              const chartScores = weeklyConsistencyScores.slice(-6);
              const svgWidth = 320;
              const svgHeight = 200;
              const paddingLeft = 30;
              const paddingRight = 10;
              const paddingTop = 15;
              const paddingBottom = 45;
              const chartWidth = svgWidth - paddingLeft - paddingRight;
              const chartHeight = svgHeight - paddingTop - paddingBottom;
              
              const barCount = chartScores.length || 1;
              const barGap = 8;
              const maxBarWidth = 35;
              const availableWidth = chartWidth - (barGap * (barCount - 1));
              const barWidth = Math.min(maxBarWidth, availableWidth / barCount);
              const totalBarsWidth = (barWidth * barCount) + (barGap * (barCount - 1));
              const startX = paddingLeft + (chartWidth - totalBarsWidth) / 2;
              
              const yScale = (val: number) => paddingTop + chartHeight - (val / 100) * chartHeight;
              const yTicks = [0, 25, 50, 75, 100];
              
              return (
                <View style={styles.svgChartContainer}>
                  <Svg width={svgWidth} height={svgHeight}>
                    <Line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + chartHeight} stroke="#2A3638" strokeWidth={1} />
                    {yTicks.map((tick) => (
                      <G key={`y-tick-${tick}`}>
                        <Line x1={paddingLeft - 4} y1={yScale(tick)} x2={paddingLeft} y2={yScale(tick)} stroke="#2A3638" strokeWidth={1} />
                        <SvgText x={paddingLeft - 8} y={yScale(tick) + 3} fontSize={9} fill="#6F7A7E" textAnchor="end">{tick}</SvgText>
                        <Line x1={paddingLeft} y1={yScale(tick)} x2={svgWidth - paddingRight} y2={yScale(tick)} stroke="#1A2426" strokeWidth={1} />
                      </G>
                    ))}
                    <Line x1={paddingLeft} y1={paddingTop + chartHeight} x2={svgWidth - paddingRight} y2={paddingTop + chartHeight} stroke="#2A3638" strokeWidth={1} />
                    {chartScores.map((data, i) => {
                      const weekStart = new Date(data.weekStart + 'T00:00:00');
                      const weekNum = getWeekNumber(weekStart);
                      const weekLabel = `W${weekNum}`;
                      const dateLabel = `${String(weekStart.getDate()).padStart(2, '0')}.${String(weekStart.getMonth() + 1).padStart(2, '0')}`;
                      const x = startX + i * (barWidth + barGap);
                      const isCurrentWeek = data.weekStart === getLocalDateString(getWeekDateRange().monday);
                      const barScore = isCurrentWeek ? wholeWeekScore : data.score;
                      const barHeight = (barScore / 100) * chartHeight;
                      const y = paddingTop + chartHeight - barHeight;
                      return (
                        <G key={`bar-${i}`}>
                          <Rect
                            x={x}
                            y={barScore > 0 ? y : paddingTop + chartHeight - 2}
                            width={barWidth}
                            height={Math.max(barHeight, 2)}
                            fill={isCurrentWeek ? '#F47C3C' : 'rgba(244, 124, 60, 0.55)'}
                            rx={3}
                            ry={3}
                          />
                          {barScore > 0 && (
                            <SvgText x={x + barWidth / 2} y={y - 4} fontSize={8} fill="#F2F2EE" textAnchor="middle" fontWeight="600">{barScore}</SvgText>
                          )}
                          <SvgText x={x + barWidth / 2} y={paddingTop + chartHeight + 14} fontSize={10} fill={isCurrentWeek ? '#F47C3C' : '#9AA3A6'} textAnchor="middle" fontWeight="600">{weekLabel}</SvgText>
                          <SvgText x={x + barWidth / 2} y={paddingTop + chartHeight + 26} fontSize={9} fill="#6F7A7E" textAnchor="middle">{dateLabel}</SvgText>
                        </G>
                      );
                    })}
                  </Svg>
                </View>
              );
            })()}

            {onShowLeaderboard && (
              <TouchableOpacity
                style={styles.seeOthersConsistencyButton}
                onPress={() => {
                  setShowStreakDetail(false);
                  onShowLeaderboard();
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.seeOthersConsistencyButtonText}>
                  {t('social:seeOthersConsistency')}
                </Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

