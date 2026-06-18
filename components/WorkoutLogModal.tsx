import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Image as ExpoImage } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Image,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { appIcons } from '../assets/icons';
import { getExerciseLoggingUnit, resolveCatalogExercise } from '../lib/exercise-catalog';
import {
  buildEnduranceDurationMinutes,
  defaultRepsForExercise,
  formatStoredRepsForDisplay,
  isEnduranceDurationExercise,
  minutesToStorageSeconds,
} from '../lib/exercise-duration';
import {
  getExerciseCatalogLabel,
  getLocalizedExerciseName,
  getLocalizedExerciseVideoUrl,
} from '../lib/exercise-localization';
import { hydrateCustomExerciseFromId, listCustomExercises } from '../lib/custom-exercise-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { activationForExercise, aggregateActivation, scoresToBodyData } from '../lib/muscle-activation';
import { DEFAULT_BODYWEIGHT_KG, loadFactorForSet } from '../lib/workout-energy';
import { trainingFocus } from '../lib/training-focus';
import { getLiftEquivalent } from '../lib/lift-equivalents';
import { buildShareMetrics, type WorkoutShareMetrics } from '../lib/workout-share-metrics';
import { MuscleActivationMap } from './MuscleActivationMap';
import { TrainingFocusBar } from './TrainingFocusBar';
import { getDatabase } from '../lib/db';
import { supabase } from '../lib/supabase_db_new';
import { normalizeDecimalInput } from '../lib/validation';
import {
  createWorkoutLog,
  deleteWorkoutLog,
  getLastWorkoutForExercise,
  getWorkoutLogById,
  saveExerciseLog,
  updateWorkoutDate,
  updateWorkoutLogStatus,
} from '../lib/workout-storage';
import {
  getExerciseCommentDisplay,
  getLastCheckedSet,
  getPersistedSetComment,
  getPreviousExerciseComment,
  normalizeAllExerciseComments,
  reassignExerciseCommentInSets,
} from '../lib/workout-exercise-comments';
import {
  DifficultyPerception,
  Exercise,
  PlannedExercise,
  REST_TIME_OPTIONS,
  WeightUnit,
  WorkoutDayOption,
  WorkoutLog,
  formatRestTime,
  getMovementTypeDisplayName,
  getMuscleGroupDisplayName
} from '../types/workout';
import { ExerciseSubstitutionModal } from './ExerciseSubstitutionModal';
import { ExerciseAlternativeSelector } from './ExerciseAlternativeSelector';
import { TIMER_SOUND_SILENT_MODE_KEY } from './HamburgerMenu';
import { Icon } from './Icon';
import { LogDateSelector } from './LogDateSelector';

import { planImages } from '../assets/images/plan';
import { calculateWeeklyConsistency, didCrossConsistencyThreshold } from '../lib/consistency-helper';
import { glowLogger } from '../lib/glow-logger';
import { refreshConsistencyScoreAfterLog } from '../lib/leaderboard-storage';
import { withRetry } from '../lib/retry';
import { storePendingWorkoutLog } from '../lib/sync-status';
import { ConsistencyCelebrationModal } from './ConsistencyCelebrationModal';
import { useActiveOverlayControls } from '@/hooks/useActiveOverlay';

const REPS_OVERLAY_PREFIX = 'workoutLog.reps:';
const REST_OVERLAY_PREFIX = 'workoutLog.rest:';
const PICKER_ITEM_HEIGHT = 49;

function findClosestPickerIndex(values: number[], target: number): number {
  if (!Number.isFinite(target) || target <= 0 || values.length === 0) return -1;
  const exact = values.indexOf(target);
  if (exact >= 0) return exact;
  let bestIdx = 0;
  let bestDiff = Math.abs(values[0] - target);
  for (let i = 1; i < values.length; i++) {
    const diff = Math.abs(values[i] - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function buildRepsPickerValues(
  pickerIsEnduranceTime: boolean,
  pickerIsSeconds: boolean,
): number[] {
  if (pickerIsEnduranceTime) return buildEnduranceDurationMinutes();
  if (pickerIsSeconds) return Array.from({ length: 120 }, (_, i) => (i + 1) * 5);
  return Array.from({ length: 100 }, (_, i) => i + 1);
}

function resolveRepsPickerTargetValue(
  storedReps: string | undefined,
  pickerIsEnduranceTime: boolean,
): number | null {
  const n = parseInt(storedReps ?? '', 10);
  if (!storedReps?.trim() || isNaN(n) || n <= 0) return null;
  if (pickerIsEnduranceTime) return n / 60;
  return n;
}

// Coach Images - Applauding (Standard Success)
const COACH_APPLAUDING_IMAGES: Record<string, any> = {
  Manu: require('../assets/images/coaches/emotions/1_manu_rodriguez_applauding.jpeg'),
  Dey: require('../assets/images/coaches/emotions/2_dey_schwarz_applauding.jpeg'),
  Alonso: require('../assets/images/coaches/emotions/3_alonso_prieto_applauding.jpeg'),
  Ruth: require('../assets/images/coaches/emotions/4_ruth_morais_applauding.jpeg'),
  Dana: require('../assets/images/coaches/emotions/5_dana_thompson_applauding.jpeg'),
  Jesús: require('../assets/images/coaches/emotions/6_jesus_guerrero_applauding.jpeg'),
};

// Coach Images - Celebrate (Consistency Milestone)
const COACH_CELEBRATE_IMAGES: Record<string, any> = {
  Manu: require('../assets/images/coaches/emotions/1_manu_rodriguez_celebrate.jpeg'),
  Dey: require('../assets/images/coaches/emotions/2_dey_schwarz_celebrate.jpeg'),
  Alonso: require('../assets/images/coaches/emotions/3_alonso_prieto_celebrate.jpeg'),
  Ruth: require('../assets/images/coaches/emotions/4_ruth_morais_celebrate.jpeg'),
  Dana: require('../assets/images/coaches/emotions/5_dana_thompson_celebrate.jpeg'),
  Jesús: require('../assets/images/coaches/emotions/6_jesus_guerrero_celebrate.jpeg'),
};

const DEFAULT_SUCCESS_IMAGE = require('../assets/images/workout_logged.png');

interface WorkoutLogModalProps {
  visible: boolean;
  userId: string;
  workoutOption: WorkoutDayOption | null;
  existingWorkoutLogId?: number;
  coachName?: string;
  plannedTrainingDays?: string[];
  userGender?: string;
  onClose: () => void;
  /** Called after the user saves a draft (not on workout completion). */
  onDraftSaved?: (draft: WorkoutLog) => void;
  onSave: () => void;
  onDelete?: () => void;
  onShowStreak?: () => void;
  /** Called after the user dismisses the workout-logged success sheet ("Keep it up!"). */
  onAfterSuccessfulWorkoutLog?: () => void;
  /**
   * Called when the user taps "Share in UnderForge Social" on the success overlay.
   * Receives the local + (best-effort) Supabase workout log ids plus the display
   * title (workout day name) so the parent can switch the Social tab and open the
   * share modal with metrics. The parent may return a Promise (e.g. to await a
   * Supabase sync) — this callsite is fire-and-forget so the success overlay can
   * dismiss immediately.
   */
  onShareWorkout?: (payload: {
    localWorkoutLogId: number;
    supabaseWorkoutLogId: number | null;
    displayTitle: string;
  }) => void | Promise<void>;
}

interface ExerciseSetState {
  exerciseId: string;
  exerciseName: string;
  setNumber: number;
  weightValue: string;
  weightUnit: WeightUnit;
  reps: string;
  restTimeSeconds: number | undefined;
  rir: number | undefined;
  difficultyPerception: DifficultyPerception | undefined;
  comments: string;
  isSaved: boolean;
  completed: boolean; // Whether this set is marked as done
  substitutedFrom?: string; // Original exercise name if this was substituted
}

interface LastWorkoutData {
  [exerciseId: string]: {
    [setNumber: number]: {
      weightValue?: number;
      weightUnit?: WeightUnit;
      reps?: number;
      restTimeSeconds?: number;
      rir?: number;
      comments?: string;
    };
  };
}

/**
 * Convert rep ranges like "8-12" to a single target number (midpoint, rounded up).
 * "10" → "10", "8-12" → "10", "AMRAP" → "", "" → ""
 */
function resolveRepRange(reps: string | number | undefined): string {
  if (reps == null) return '';
  const s = String(reps).trim();
  const rangeMatch = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (rangeMatch) {
    const low = parseInt(rangeMatch[1], 10);
    const high = parseInt(rangeMatch[2], 10);
    return String(Math.ceil((low + high) / 2));
  }
  if (/^\d+$/.test(s)) return s;
  return '';
}

function normalizeRepsInput(text: string): string {
  return text.replace(/[^0-9]/g, '');
}

const getExerciseDetails = (exerciseId: string, exerciseName?: string): Exercise | undefined => {
  // Resolve by id, then by exact / plural-insensitive name so legacy logs whose
  // exerciseId is a generic slug still recover `category` + `muscleActivation`.
  return resolveCatalogExercise(exerciseId, exerciseName);
};

export const WorkoutLogModal: React.FC<WorkoutLogModalProps> = ({
  visible,
  userId,
  workoutOption,
  existingWorkoutLogId,
  coachName,
  plannedTrainingDays = [],
  userGender,
  onClose,
  onDraftSaved,
  onSave,
  onDelete,
  onShowStreak,
  onAfterSuccessfulWorkoutLog,
  onShareWorkout,
}) => {
  const { t, i18n } = useTranslation(['workout', 'auth', 'common', 'social']);
  const insets = useSafeAreaInsets();
  const workoutScrollRef = useRef<ScrollView>(null);
  const repsPickerScrollRef = useRef<ScrollView>(null);
  const repsPickerViewportHeightRef = useRef(0);
  const focusedInputTargetRef = useRef<number | null>(null);
  const saveForLaterInFlightRef = useRef(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [workoutLog, setWorkoutLog] = useState<WorkoutLog | null>(null);
  const [exerciseSets, setExerciseSets] = useState<ExerciseSetState[]>([]);
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const { activeId, open: openOverlay, closeAny } = useActiveOverlayControls();
  const showRepsDropdown = activeId?.startsWith(REPS_OVERLAY_PREFIX)
    ? activeId.slice(REPS_OVERLAY_PREFIX.length)
    : null;
  const showRestTimeDropdown = activeId?.startsWith(REST_OVERLAY_PREFIX)
    ? activeId.slice(REST_OVERLAY_PREFIX.length)
    : null;
  const setShowRepsDropdown = useCallback(
    (key: string | null) => {
      if (!key) {
        closeAny();
        return;
      }
      const fullId = `${REPS_OVERLAY_PREFIX}${key}`;
      if (activeId === fullId) {
        closeAny();
        return;
      }
      openOverlay(fullId);
    },
    [activeId, openOverlay, closeAny],
  );
  const setShowRestTimeDropdown = useCallback(
    (key: string | null) => {
      if (key) openOverlay(`${REST_OVERLAY_PREFIX}${key}`);
      else closeAny();
    },
    [openOverlay, closeAny],
  );
  const [substitutingExerciseId, setSubstitutingExerciseId] = useState<string | null>(null);
  const [lastWorkoutData, setLastWorkoutData] = useState<LastWorkoutData>({});
  const [showLogConfirmation, setShowLogConfirmation] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [workoutsThisMonth, setWorkoutsThisMonth] = useState(1);
  const [consistencyScore, setConsistencyScore] = useState(0);
  const [showConsistencyCelebration, setShowConsistencyCelebration] = useState(false);
  const [showCelebrationModal, setShowCelebrationModal] = useState(false);
  const [isAddingExercise, setIsAddingExercise] = useState(false);
  const [customExercises, setCustomExercises] = useState<Exercise[]>([]);
  const [alternativeExercise, setAlternativeExercise] = useState<PlannedExercise | null>(null);
  const [resolvedAlternativeExerciseIds, setResolvedAlternativeExerciseIds] = useState<Set<string>>(() => new Set());

  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialViews, setTutorialViews] = useState(0);
  const [workoutDateStr, setWorkoutDateStr] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  });

  // Warm-up / Cooldown state
  const [warmupExpanded, setWarmupExpanded] = useState(true);
  const [warmupChecked, setWarmupChecked] = useState(false);
  const [cooldownExpanded, setCooldownExpanded] = useState(false);
  const [cooldownChecked, setCooldownChecked] = useState(false);
  const [workoutSectionExpanded, setWorkoutSectionExpanded] = useState(true);

  // Rest timer state
  const [restTimerVisible, setRestTimerVisible] = useState(false);
  const [restTimerSeconds, setRestTimerSeconds] = useState(0);
  const [restTimerTotal, setRestTimerTotal] = useState(0);
  const restTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restTimerProgress = useRef(new Animated.Value(1)).current;
  const restTimerEndTime = useRef<number | null>(null);
  const notificationId = useRef<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forgingSoundRef = useRef<AudioPlayer | null>(null);
  const soundPlayedRef = useRef(false);

  const activateRestTimerKeepAwake = useCallback(async () => {
    if (Platform.OS === 'android' && AppState.currentState !== 'active') return;
    try {
      await activateKeepAwakeAsync();
    } catch (error) {
      console.warn('Failed to activate keep awake:', error);
    }
  }, []);

  const deactivateRestTimerKeepAwake = useCallback(() => {
    try {
      Promise.resolve(deactivateKeepAwake()).catch((error) => {
        console.warn('Failed to deactivate keep awake:', error);
      });
    } catch (error) {
      console.warn('Failed to deactivate keep awake:', error);
    }
  }, []);

  const getKeyboardInset = useCallback(
    (height: number) => {
      if (height <= 0) return 0;
      if (Platform.OS === 'ios') {
        return Math.max(0, height - insets.bottom);
      }
      return height;
    },
    [insets.bottom],
  );

  const scrollTargetAboveFooter = useCallback(
    (target: number, insetOverride?: number) => {
      const inset = insetOverride ?? getKeyboardInset(keyboardHeight);
      requestAnimationFrame(() => {
        setTimeout(() => {
          const responder = workoutScrollRef.current?.getScrollResponder?.();
          responder?.scrollResponderScrollNativeHandleToKeyboard?.(
            target,
            24 + inset,
            true,
          );
        }, Platform.OS === 'ios' ? 70 : 40);
      });
    },
    [getKeyboardInset, keyboardHeight],
  );

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, e => {
      const nextHeight = Math.max(0, e.endCoordinates?.height ?? 0);
      const nextInset = getKeyboardInset(nextHeight);
      setKeyboardHeight(nextHeight);

      const focusedTarget = focusedInputTargetRef.current;
      if (focusedTarget) {
        // Initial and delayed pass to handle keyboard animation timing jitter.
        scrollTargetAboveFooter(focusedTarget, nextInset);
        setTimeout(() => scrollTargetAboveFooter(focusedTarget, nextInset), 180);
      }
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [getKeyboardInset, scrollTargetAboveFooter]);

  // Success modal always uses the applauding image; ConsistencyCelebrationModal handles the celebrate image
  const successImage = useMemo(() => {
    if (!coachName) return DEFAULT_SUCCESS_IMAGE;
    return COACH_APPLAUDING_IMAGES[coachName] || DEFAULT_SUCCESS_IMAGE;
  }, [coachName]);

  // Lazily load the forging sound the first time the modal is opened.
  // This modal is always mounted (it's a global modal), so doing audio setup on
  // mount would run on app launch — and configuring the iOS audio session there
  // interrupts the user's other audio (music/podcasts). Defer until the user
  // actually opens the sheet, and use mixWithOthers so we never stop their audio.
  useEffect(() => {
    if (!visible || forgingSoundRef.current) return;
    let cancelled = false;
    const loadSound = async () => {
      try {
        const silentMode = await AsyncStorage.getItem(TIMER_SOUND_SILENT_MODE_KEY);
        const playsInSilent = silentMode === null ? true : silentMode === 'true';
        await setAudioModeAsync({ playsInSilentMode: playsInSilent, interruptionMode: 'mixWithOthers' });
        if (cancelled) return;
        forgingSoundRef.current = createAudioPlayer(
          require('../assets/sounds/forging_sound.wav')
        );
      } catch (e) {
        console.warn('Failed to load forging sound:', e);
      }
    };
    loadSound();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Release the player when the modal unmounts.
  useEffect(() => {
    return () => {
      forgingSoundRef.current?.remove();
    };
  }, []);

  // Rest timer functions
  const startRestTimer = useCallback(async (seconds: number) => {
    if (seconds <= 0) return;

    // Dismiss the keyboard so it doesn't cover the rest timer overlay
    Keyboard.dismiss();

    // Clear any existing timer
    if (restTimerRef.current) {
      clearInterval(restTimerRef.current);
    }
    
    // Cancel any pending hide timeout from a previous timer completion
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    
    // Cancel any existing notification
    if (notificationId.current) {
      await Notifications.cancelScheduledNotificationAsync(notificationId.current);
      notificationId.current = null;
    }
    
    // Keep screen awake during timer
    await activateRestTimerKeepAwake();
    
    // Store end time for background handling
    restTimerEndTime.current = Date.now() + seconds * 1000;
    
    setRestTimerTotal(seconds);
    setRestTimerSeconds(seconds);
    setRestTimerVisible(true);
    soundPlayedRef.current = false;
    restTimerProgress.setValue(1);
    
    Animated.timing(restTimerProgress, {
      toValue: 0,
      duration: seconds * 1000,
      useNativeDriver: false,
    }).start();

    // Schedule notification for when timer completes
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: t('workout:restCompleteTitle'),
          body: t('workout:restCompleteBody'),
          sound: 'forging_sound.wav',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: seconds,
        } as Notifications.TimeIntervalTriggerInput,
      });
      notificationId.current = id;
    } catch (error) {
      console.warn('Failed to schedule notification:', error);
    }

    restTimerRef.current = setInterval(() => {
      setRestTimerSeconds(prev => {
        // Play sound when hitting 2 seconds
        if (prev === 3 && !soundPlayedRef.current) {
          soundPlayedRef.current = true;
          try {
            forgingSoundRef.current?.seekTo(0);
            forgingSoundRef.current?.play();
          } catch {};
        }
        if (prev <= 1) {
          if (restTimerRef.current) {
            clearInterval(restTimerRef.current);
            restTimerRef.current = null;
          }
          restTimerEndTime.current = null;
          Vibration.vibrate([0, 200, 100, 200]);
          deactivateRestTimerKeepAwake();
          // show briefly then auto-hide (original behavior)
          hideTimerRef.current = setTimeout(() => {
            setRestTimerVisible(false);
            hideTimerRef.current = null;
          }, 1500);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [activateRestTimerKeepAwake, deactivateRestTimerKeepAwake, restTimerProgress]);

  const stopRestTimer = useCallback(async () => {
    if (restTimerRef.current) {
      clearInterval(restTimerRef.current);
      restTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    restTimerProgress.stopAnimation();
    restTimerEndTime.current = null;
    setRestTimerVisible(false);
    try { forgingSoundRef.current?.pause(); } catch {}
    
    // Cancel notification if it exists
    if (notificationId.current) {
      await Notifications.cancelScheduledNotificationAsync(notificationId.current);
      notificationId.current = null;
    }
    
    // Deactivate keep awake
    try {
      deactivateRestTimerKeepAwake();
    } catch (error) {
      console.warn('Failed to deactivate keep awake:', error);
    }
  }, [deactivateRestTimerKeepAwake, restTimerProgress]);

  useEffect(() => {
    if (!visible) {
      void stopRestTimer();
    }
  }, [visible, stopRestTimer]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (restTimerRef.current) {
        clearInterval(restTimerRef.current);
        restTimerRef.current = null;
      }
      // Cancel any pending hide timeout
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      // Cancel scheduled notification
      if (notificationId.current) {
        Notifications.cancelScheduledNotificationAsync(notificationId.current).catch(() => {});
        notificationId.current = null;
      }
      restTimerProgress.stopAnimation();
      deactivateRestTimerKeepAwake();
    };
  }, [deactivateRestTimerKeepAwake, restTimerProgress]);

  // Re-activate audio session and force-play the forging sound.
  // Must be async because setAudioModeAsync needs to complete
  // before playback will work after returning from background.
  const playForgingSoundAfterBackground = useCallback(async () => {
    try {
      const silentMode = await AsyncStorage.getItem(TIMER_SOUND_SILENT_MODE_KEY);
      const playsInSilent = silentMode === null ? true : silentMode === 'true';
      await setAudioModeAsync({ playsInSilentMode: playsInSilent, interruptionMode: 'mixWithOthers' });
      forgingSoundRef.current?.pause();
      forgingSoundRef.current?.seekTo(0);
      forgingSoundRef.current?.play();
    } catch {
      console.warn('Failed to play forging sound after background return');
    }
  }, []);

  // Handle app state changes to sync timer when returning from background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active' && restTimerEndTime.current) {
        const now = Date.now();
        const remainingMs = restTimerEndTime.current - now;
        
        if (remainingMs <= 0) {
          // Timer completed while backgrounded — notification already played sound
          if (restTimerRef.current) {
            clearInterval(restTimerRef.current);
            restTimerRef.current = null;
          }
          setRestTimerSeconds(0);
          restTimerEndTime.current = null;
          restTimerProgress.stopAnimation();
          restTimerProgress.setValue(0);
          soundPlayedRef.current = true;
          Vibration.vibrate([0, 200, 100, 200]);
          hideTimerRef.current = setTimeout(() => {
            setRestTimerVisible(false);
            hideTimerRef.current = null;
          }, 1500);
          deactivateRestTimerKeepAwake();
        } else {
          // Timer still running, update to correct remaining time
          const remainingSeconds = Math.ceil(remainingMs / 1000);
          setRestTimerSeconds(remainingSeconds);

          // If <=3s remain, force-play the sound (background attempt may have been silent)
          if (remainingSeconds <= 3) {
            soundPlayedRef.current = true;
            playForgingSoundAfterBackground();
          }

          // Resync the progress animation to match remaining time
          const totalMs = restTimerTotal * 1000;
          const progressValue = totalMs > 0 ? remainingMs / totalMs : 0;
          restTimerProgress.stopAnimation();
          restTimerProgress.setValue(progressValue);
          Animated.timing(restTimerProgress, {
            toValue: 0,
            duration: remainingMs,
            useNativeDriver: false,
          }).start();
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [deactivateRestTimerKeepAwake, restTimerProgress, restTimerTotal, playForgingSoundAfterBackground]);

  // Load tutorial views count
  useEffect(() => {
    const loadTutorialViews = async () => {
      try {
        const views = await AsyncStorage.getItem('workoutTutorialViews');
        setTutorialViews(parseInt(views || '0', 10));
      } catch (error) {
        console.error('Error loading tutorial views:', error);
      }
    };
    loadTutorialViews();
  }, []);

  const resetTransientOverlayState = useCallback(() => {
    setShowSuccessModal(false);
    setShowCelebrationModal(false);
    setShowConsistencyCelebration(false);
    setShowLogConfirmation(false);
    setShowTutorial(false);
    setAlternativeExercise(null);
    setSubstitutingExerciseId(null);
    setIsAddingExercise(false);
    closeAny();
  }, [closeAny]);

  // Reset child-modal states whenever the sheet opens or closes so stale flags
  // from a previous session never leave a ghost native layer blocking touches.
  useEffect(() => {
    if (visible) {
      resetTransientOverlayState();
      setIsSaving(false);
      setResolvedAlternativeExerciseIds(new Set());
    } else {
      resetTransientOverlayState();
    }
  }, [visible, resetTransientOverlayState]);

  // Initialize or load workout log
  useEffect(() => {
    if (!visible) return;

    const initializeWorkout = async () => {
      setIsLoading(true);
      console.log('[WorkoutLogModal] Initializing workout:', {
        existingWorkoutLogId,
        workoutOptionDayName: workoutOption?.dayName,
        workoutOptionExercisesCount: workoutOption?.exercises?.length || 0,
      });
      
      try {
        if (existingWorkoutLogId) {
          // Load existing workout (continuing a draft)
          console.log('[WorkoutLogModal] Loading existing draft with ID:', existingWorkoutLogId);
          const existing = await getWorkoutLogById(existingWorkoutLogId);
          if (existing) {
            console.log('[WorkoutLogModal] Loaded draft:', existing.workoutDayName, 'with', existing.exercises.length, 'exercise logs');
            setWorkoutLog(existing);
            if (existing.workoutDate) setWorkoutDateStr(existing.workoutDate);
            await initializeExerciseSetsFromLog(existing);
            
            // Load warmup/cooldown checked states from AsyncStorage
            try {
              const warmupKey = `workout_${existingWorkoutLogId}_warmup_checked`;
              const cooldownKey = `workout_${existingWorkoutLogId}_cooldown_checked`;
              const warmupValue = await AsyncStorage.getItem(warmupKey);
              const cooldownValue = await AsyncStorage.getItem(cooldownKey);
              
              if (warmupValue !== null) {
                setWarmupChecked(warmupValue === 'true');
              }
              if (cooldownValue !== null) {
                setCooldownChecked(cooldownValue === 'true');
              }
            } catch (error) {
              console.warn('[WorkoutLogModal] Failed to load warmup/cooldown state:', error);
            }
          } else {
            console.log('[WorkoutLogModal] ERROR: Could not load draft with ID:', existingWorkoutLogId);
          }
        } else if (workoutOption) {
          // Create new workout
          console.log('[WorkoutLogModal] Creating new workout for:', workoutOption.dayName);
          const newLog = await createWorkoutLog(
            userId,
            workoutOption.dayName,
            workoutOption.stepId
          );
          if (newLog) {
            setWorkoutLog(newLog);
            const draftIsEmptyPlaceholder =
              newLog.exercises.length > 0 &&
              newLog.exercises.every(
                ex =>
                  ex.weightValue == null &&
                  ex.reps == null &&
                  !ex.completed,
              );
            if (newLog.exercises.length > 0 && !draftIsEmptyPlaceholder) {
              await initializeExerciseSetsFromLog(newLog);
            } else if (workoutOption) {
              await initializeExerciseSetsFromPlan(workoutOption, newLog.id);
            }
          }
        }
      } catch (error) {
        console.error('Error initializing workout:', error);
        Alert.alert(t('auth:alertErrorTitle'), t('workout:initError'));
      } finally {
        setIsLoading(false);
      }
    };

    initializeWorkout();
  }, [visible, existingWorkoutLogId, workoutOption, userId]);

  useEffect(() => {
    // Show tutorial on the 1st and 3rd workout open (tutorialViews === 0 or 2)
    const shouldShow = tutorialViews === 0 || tutorialViews === 2;
    if (visible && exerciseSets.length > 0 && !isLoading && shouldShow) {
      const timer = setTimeout(async () => {
        setShowTutorial(true);
        const newViews = tutorialViews + 1;
        setTutorialViews(newViews);
        try {
          await AsyncStorage.setItem('workoutTutorialViews', newViews.toString());
        } catch (error) {
          console.error('Error saving tutorial views:', error);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [visible, exerciseSets.length, isLoading, tutorialViews]);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    const loadCustomExercises = async () => {
      const exercises = await listCustomExercises(userId);
      if (!cancelled) {
        setCustomExercises(exercises);
      }
    };

    loadCustomExercises();
    return () => {
      cancelled = true;
    };
  }, [visible, userId]);

  const customExerciseMap = useMemo(() => {
    const map = new Map<string, Exercise>();
    customExercises.forEach(exercise => {
      map.set(exercise.id, exercise);
    });
    return map;
  }, [customExercises]);

  const getExerciseDetailsForUser = useCallback((exerciseId: string, exerciseName?: string) => {
    return (
      customExerciseMap.get(exerciseId) ||
      getExerciseDetails(exerciseId, exerciseName) ||
      (exerciseName ? hydrateCustomExerciseFromId(exerciseId, exerciseName, userId) : null) ||
      undefined
    );
  }, [customExerciseMap, userId]);

  const repsPickerScrollIndex = useMemo(() => {
    if (!showRepsDropdown) return -1;
    const dropdownKey = showRepsDropdown;
    const lastHyphenIndex = dropdownKey.lastIndexOf('-');
    const exId = dropdownKey.substring(0, lastHyphenIndex);
    const setNumber = parseInt(dropdownKey.substring(lastHyphenIndex + 1), 10);
    const currentSet = exerciseSets.find(
      s => s.exerciseId === exId && s.setNumber === setNumber,
    );
    const pickerExercise = getExerciseDetailsForUser(exId, currentSet?.exerciseName);
    const pickerUnit = getExerciseLoggingUnit(pickerExercise);
    const pickerIsEnduranceTime = isEnduranceDurationExercise(pickerExercise);
    const pickerIsSeconds = pickerUnit === 'seconds' && !pickerIsEnduranceTime;
    const pickerValues = buildRepsPickerValues(pickerIsEnduranceTime, pickerIsSeconds);
    const target = resolveRepsPickerTargetValue(currentSet?.reps, pickerIsEnduranceTime);
    if (target === null) return -1;
    return findClosestPickerIndex(pickerValues, target);
  }, [showRepsDropdown, exerciseSets, getExerciseDetailsForUser]);

  const scrollRepsPickerToIndex = useCallback((index: number) => {
    const viewportH = repsPickerViewportHeightRef.current;
    if (index < 0 || viewportH <= 0) return;
    const offset = index * PICKER_ITEM_HEIGHT - viewportH / 2 + PICKER_ITEM_HEIGHT / 2;
    repsPickerScrollRef.current?.scrollTo({ y: Math.max(0, offset), animated: false });
  }, []);

  useEffect(() => {
    if (!showRepsDropdown || repsPickerScrollIndex < 0) return;
    const id = requestAnimationFrame(() => {
      scrollRepsPickerToIndex(repsPickerScrollIndex);
    });
    return () => cancelAnimationFrame(id);
  }, [showRepsDropdown, repsPickerScrollIndex, scrollRepsPickerToIndex]);

  /** Body model gender for the muscle map (normalize the free-text profile value). */
  const mapGender: 'male' | 'female' = (userGender || '').toLowerCase().startsWith('m')
    ? 'male'
    : 'female';

  /**
   * Aggregated muscle activation for this session from the ACTUAL logged sets, weighting each
   * exercise by load (heavier sets count more; bodyweight sets register at 1.0). Uses
   * DEFAULT_BODYWEIGHT_KG since the user's bodyweight isn't available in this modal.
   */
  const sessionMuscleData = useMemo(() => {
    const byExercise = new Map<string, { name: string; weight: number }>();
    for (const s of exerciseSets) {
      // Count sets the user actually performed (done, or with reps/weight entered).
      if (!s.completed && !s.reps && !s.weightValue) continue;
      const key = s.exerciseId || s.exerciseName;
      const w = loadFactorForSet(parseFloat(s.weightValue), s.weightUnit, DEFAULT_BODYWEIGHT_KG);
      const prev = byExercise.get(key);
      if (prev) prev.weight += w;
      else byExercise.set(key, { name: s.exerciseName, weight: w });
    }
    const items = [...byExercise.entries()].map(([key, v]) => ({
      activation: activationForExercise(getExerciseDetailsForUser(key, v.name)),
      weight: v.weight,
    }));
    return scoresToBodyData(aggregateActivation(items));
  }, [exerciseSets, getExerciseDetailsForUser]);

  /** Strength vs cardio focus for this session, weighted by each exercise's logged load. */
  const sessionFocus = useMemo(() => {
    const byExercise = new Map<string, { name: string; weight: number }>();
    for (const s of exerciseSets) {
      if (!s.completed && !s.reps && !s.weightValue) continue;
      const key = s.exerciseId || s.exerciseName;
      const w = loadFactorForSet(parseFloat(s.weightValue), s.weightUnit, DEFAULT_BODYWEIGHT_KG);
      const prev = byExercise.get(key);
      if (prev) prev.weight += w;
      else byExercise.set(key, { name: s.exerciseName, weight: w });
    }
    return trainingFocus(
      [...byExercise.entries()].map(([key, v]) => ({
        category: getExerciseDetailsForUser(key, v.name)?.category,
        weight: v.weight,
      })),
    );
  }, [exerciseSets, getExerciseDetailsForUser]);

  /** Share-style summary (volume, kcal, PRs, …) loaded when the success modal opens. */
  const [shareSummary, setShareSummary] = useState<WorkoutShareMetrics | null>(null);
  useEffect(() => {
    if (!showSuccessModal || !workoutLog?.id || !userId) {
      setShareSummary(null);
      return;
    }
    let cancelled = false;
    buildShareMetrics(userId, { workoutLogId: workoutLog.id })
      .then((m) => {
        if (!cancelled) setShareSummary(m);
      })
      .catch(() => {
        if (!cancelled) setShareSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showSuccessModal, workoutLog?.id, userId]);

  /** Headline workout stats for the success summary — share metrics when loaded, else logged sets. */
  const successStats = useMemo(() => {
    const performed = exerciseSets.filter((s) => s.completed || s.reps || s.weightValue);
    let fallbackVolume = 0;
    for (const s of performed) {
      const w = parseFloat(s.weightValue);
      const r = parseInt(s.reps, 10);
      if (Number.isFinite(w) && Number.isFinite(r)) {
        fallbackVolume += (s.weightUnit === 'lbs' ? w * 0.453592 : w) * r;
      }
    }
    return {
      sets: shareSummary
        ? shareSummary.exercises.reduce((a, e) => a + e.setsCompleted, 0)
        : performed.length,
      exercises: shareSummary
        ? shareSummary.exercises.length
        : new Set(performed.map((s) => s.exerciseId || s.exerciseName)).size,
      volumeKg: shareSummary ? shareSummary.totalVolumeKg : Math.round(fallbackVolume * 10) / 10,
      kcal: shareSummary?.totalKcal ?? null,
      prs: shareSummary?.newPRs ?? [],
    };
  }, [shareSummary, exerciseSets]);

  const formatVolumeKg = (kg: number): string =>
    kg >= 1000 ? `${(kg / 1000).toFixed(1)}t` : `${Math.round(kg)} kg`;

  // Initialize exercise sets from plan
  const initializeExerciseSetsFromPlan = async (option: WorkoutDayOption, workoutLogId?: number) => {
    const sets: ExerciseSetState[] = [];

    if (option.exercises && option.exercises.length > 0) {
      // Deduplicate exercises by exerciseId to prevent the same exercise
      // appearing twice (e.g., LLM generating two names that resolve to the same ID)
      const seenExerciseIds = new Set<string>();
      const deduplicatedExercises = option.exercises.filter(ex => {
        if (seenExerciseIds.has(ex.exerciseId)) {
          console.warn('[WorkoutLogModal] Duplicate exercise filtered:', ex.exerciseId, ex.name);
          return false;
        }
        seenExerciseIds.add(ex.exerciseId);
        return true;
      });

      // Fetch last workout data for all exercises in this workout
      const lastWorkoutDataMap: LastWorkoutData = {};
      for (const exercise of deduplicatedExercises) {
        const lastData = await getLastWorkoutForExercise(userId, exercise.exerciseId);
        if (Object.keys(lastData).length > 0) {
          lastWorkoutDataMap[exercise.exerciseId] = lastData;
        }
      }
      setLastWorkoutData(lastWorkoutDataMap);

      // Structured workout with exercises
      for (const exercise of deduplicatedExercises) {
        const numSets = exercise.sets || 3;
        const catalog = getExerciseDetails(exercise.exerciseId, exercise.name);
        const planReps = defaultRepsForExercise(catalog, resolveRepRange(exercise.reps));
        
        for (let setNum = 1; setNum <= numSets; setNum++) {
          const lastSetData = lastWorkoutDataMap[exercise.exerciseId]?.[setNum];
          const exerciseName = catalog
            ? getExerciseCatalogLabel(catalog, i18n.language)
            : exercise.name;

          sets.push({
            exerciseId: exercise.exerciseId,
            exerciseName,
            setNumber: setNum,
            weightValue: lastSetData?.weightValue?.toString() || '',
            weightUnit: lastSetData?.weightUnit || 'kg',
            reps: lastSetData?.reps?.toString() || planReps,
            restTimeSeconds: lastSetData?.restTimeSeconds || exercise.restTimeSeconds,
            rir: lastSetData?.rir ?? exercise.rir,
            difficultyPerception: undefined,
            comments: '',
            isSaved: false,
            completed: false,
          });
        }
      }
    } else {
      // Legacy workout without structured exercises - create empty placeholder
      sets.push({
        exerciseId: 'custom-exercise',
        exerciseName: 'Add Exercise',
        setNumber: 1,
        weightValue: '',
        weightUnit: 'kg',
        reps: '',
        restTimeSeconds: undefined,
        rir: undefined,
        difficultyPerception: undefined,
        comments: '',
        isSaved: false,
        completed: false,
      });
    }

    setExerciseSets(sets);
    if (sets.length > 0) {
      setExpandedExercise(sets[0].exerciseId);
    }

    // Use explicitly passed ID to avoid stale closure over workoutLog state
    const effectiveLogId = workoutLogId ?? workoutLog?.id;
    if (effectiveLogId && sets.length > 0) {
      console.log('[WorkoutLogModal] Saving placeholder exercise logs for', sets.length, 'sets');
      for (const set of sets) {
        try {
          const weightNum = set.weightValue ? parseFloat(set.weightValue) : undefined;
          const repsNum = set.reps ? parseInt(set.reps, 10) : undefined;
          await saveExerciseLog(
            effectiveLogId,
            set.exerciseId,
            set.exerciseName,
            set.setNumber,
            Number.isFinite(weightNum) ? weightNum : undefined,
            set.weightUnit,
            Number.isFinite(repsNum) ? repsNum : undefined,
            set.restTimeSeconds,
            set.rir,
            undefined,
            undefined,
          );
        } catch (error) {
          console.error('[WorkoutLogModal] Error saving placeholder log:', error);
        }
      }
      // Mark all sets as saved
      setExerciseSets(prev => prev.map(s => ({ ...s, isSaved: true })));
    }
  };

  // Initialize exercise sets from existing log
  const initializeExerciseSetsFromLog = async (log: WorkoutLog) => {
    console.log('[WorkoutLogModal] Loading draft - exercises from DB:', log.exercises.length);
    console.log('[WorkoutLogModal] Exercise names:', log.exercises.map(e => `${e.exerciseName} (${e.exerciseId})`).join(', '));
    
    // Fetch last workout data for exercises in this draft
    const uniqueExerciseIds = [...new Set(log.exercises.map(ex => ex.exerciseId))];
    const lastWorkoutDataMap: LastWorkoutData = {};
    for (const exerciseId of uniqueExerciseIds) {
      const lastData = await getLastWorkoutForExercise(userId, exerciseId, log.id);
      if (Object.keys(lastData).length > 0) {
        lastWorkoutDataMap[exerciseId] = lastData;
      }
    }
    setLastWorkoutData(lastWorkoutDataMap);
    
    const sets: ExerciseSetState[] = normalizeAllExerciseComments(
      log.exercises.map(ex => ({
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        setNumber: ex.setNumber,
        weightValue: ex.weightValue?.toString() || '',
        weightUnit: ex.weightUnit || 'kg',
        reps: ex.reps?.toString() || '',
        restTimeSeconds: ex.restTimeSeconds,
        rir: ex.rir,
        difficultyPerception: ex.difficultyPerception,
        comments: ex.comments || '',
        isSaved: true,
        completed: ex.completed || false,
      })),
    );

    // If no exercises from DB, initialize from plan
    // This happens when a new workout is created but no exercises have been saved yet
    if (sets.length === 0 && workoutOption && workoutOption.exercises.length > 0) {
      console.log('[WorkoutLogModal] No exercises in DB, initializing from plan');
      await initializeExerciseSetsFromPlan(workoutOption);
    } else {
      console.log('[WorkoutLogModal] Setting', sets.length, 'exercise sets from DB');
      setExerciseSets(sets);
      if (sets.length > 0) {
        // Restore position to the exercise the user was last working on:
        // Find the first exercise that has at least one incomplete set
        // (i.e., the exercise where the user left off)
        const exerciseOrder: string[] = [];
        for (const s of sets) {
          if (!exerciseOrder.includes(s.exerciseId)) {
            exerciseOrder.push(s.exerciseId);
          }
        }
        
        let resumeExerciseId = exerciseOrder[0]; // default to first
        for (const exId of exerciseOrder) {
          const exSets = sets.filter(s => s.exerciseId === exId);
          const hasIncomplete = exSets.some(s => !s.completed);
          if (hasIncomplete) {
            // This exercise has work remaining — resume here
            resumeExerciseId = exId;
            break;
          }
        }
        
        console.log('[WorkoutLogModal] Resuming at exercise:', resumeExerciseId);
        setExpandedExercise(resumeExerciseId);
      }
    }
  };

  // Group sets by exercise
  const groups = useMemo(() => {
    const result: { [exerciseId: string]: ExerciseSetState[] } = {};
    for (const set of exerciseSets) {
      if (!result[set.exerciseId]) {
        result[set.exerciseId] = [];
      }
      result[set.exerciseId].push(set);
    }
    return result;
  }, [exerciseSets]);

  const keyboardBottomInset = useMemo(
    () => getKeyboardInset(keyboardHeight),
    [getKeyboardInset, keyboardHeight],
  );

  const ensureInputVisible = useCallback(
    (target: number | null | undefined) => {
      if (!target) return;
      focusedInputTargetRef.current = target;
      scrollTargetAboveFooter(target);
    },
    [scrollTargetAboveFooter],
  );

  // Update a set value
  const updateSetValue = (
    exerciseId: string,
    setNumber: number,
    field: keyof ExerciseSetState,
    value: any
  ) => {
    setExerciseSets(prev => {
      const newSets = prev.map(set => {
        if (set.exerciseId === exerciseId && set.setNumber === setNumber) {
          return { ...set, [field]: value, isSaved: false };
        }
        return set;
      });
      return newSets;
    });
  };

  // Save a single set (exercise note is stored on the last checked set only)
  const saveSet = async (set: ExerciseSetState, allSets?: ExerciseSetState[]) => {
    if (!workoutLog?.id) return;

    const snapshot = allSets ?? exerciseSets;
    const setsForExercise = snapshot.filter(s => s.exerciseId === set.exerciseId);

    try {
      await saveExerciseLog(
        workoutLog.id,
        set.exerciseId,
        set.exerciseName,
        set.setNumber,
        set.weightValue ? parseFloat(set.weightValue) : undefined,
        set.weightValue ? set.weightUnit : undefined,
        set.reps ? parseInt(set.reps) : undefined,
        set.restTimeSeconds,
        set.rir,
        set.difficultyPerception,
        getPersistedSetComment(set, setsForExercise),
        false, // syncToSupabase
        set.completed || false // completed state
      );

      setExerciseSets(prev =>
        prev.map(s =>
          s.exerciseId === set.exerciseId && s.setNumber === set.setNumber
            ? { ...s, isSaved: true }
            : s
        )
      );
    } catch (error) {
      console.error('Error saving set:', error);
    }
  };

  const saveExerciseComment = async (exerciseId: string, allSets: ExerciseSetState[]) => {
    const setsForExercise = allSets.filter(s => s.exerciseId === exerciseId);
    const target = getLastCheckedSet(setsForExercise);
    if (!target) return;
    await saveSet(target, allSets);
  };

  // Propagate a freshly committed reps/weight/rest value to subsequent sets of the
  // same exercise whose corresponding field is still empty. This is a UX convenience —
  // the user can always edit individual sets later. Reads via the functional setter
  // so it always sees the latest committed value (even if onBlur fires with a stale
  // closure over `set`).
  const propagateValueToEmpty = useCallback(
    (exerciseId: string, fromSetNumber: number, field: 'reps' | 'weightValue' | 'restTimeSeconds') => {
      setExerciseSets(prev => {
        const source = prev.find(
          s => s.exerciseId === exerciseId && s.setNumber === fromSetNumber,
        );
        if (!source) return prev;
        if (field === 'restTimeSeconds') {
          if (source.restTimeSeconds == null || source.restTimeSeconds <= 0) return prev;
        } else {
          const sourceValue = field === 'reps' ? source.reps : source.weightValue;
          if (!sourceValue || !sourceValue.toString().trim()) return prev;
        }
        let didChange = false;
        const next = prev.map(s => {
          if (s.exerciseId !== exerciseId || s.setNumber <= fromSetNumber) return s;
          if (field === 'restTimeSeconds') {
            if (s.restTimeSeconds != null && s.restTimeSeconds > 0) return s;
          } else {
            const currentVal = field === 'reps' ? s.reps : s.weightValue;
            if (currentVal && currentVal.toString().trim()) return s;
          }
          didChange = true;
          const updated: ExerciseSetState =
            field === 'reps'
              ? { ...s, reps: source.reps, isSaved: false }
              : field === 'weightValue'
                ? {
                    ...s,
                    weightValue: source.weightValue,
                    weightUnit: source.weightUnit,
                    isSaved: false,
                  }
                : { ...s, restTimeSeconds: source.restTimeSeconds, isSaved: false };
          saveSet(updated);
          return updated;
        });
        return didChange ? next : prev;
      });
    },
    [],
  );

  const handleCheckAllSets = (exerciseId: string) => {
    const setsForExercise = exerciseSets.filter(s => s.exerciseId === exerciseId);
    const allChecked = setsForExercise.every(s => s.completed);
    const newCompleted = !allChecked;
    glowLogger.info(newCompleted ? 'Check all sets' : 'Uncheck all sets', {
      exercise_id: exerciseId,
      set_count: setsForExercise.length,
    });

    if (newCompleted) {
      const planExercise = workoutOption?.exercises?.find(e => e.exerciseId === exerciseId);
      const exerciseDetails = getExerciseDetailsForUser(
        exerciseId,
        setsForExercise[0]?.exerciseName,
      );
      const fallbackReps = defaultRepsForExercise(
        exerciseDetails,
        resolveRepRange(planExercise?.reps),
      );

      const hasEmptyReps = setsForExercise.some(s => {
        const n = parseInt(s.reps, 10);
        return !s.reps || isNaN(n) || n <= 0;
      });

      if (hasEmptyReps && !fallbackReps) {
        const unit = getExerciseLoggingUnit(exerciseDetails);
        const isEnduranceTime = isEnduranceDurationExercise(exerciseDetails);
        const isSeconds = unit === 'seconds' && !isEnduranceTime;
        const exerciseName = setsForExercise[0]?.exerciseName || 'this exercise';
        Alert.alert(
          isEnduranceTime
            ? t('workout:specifyTimeTitle')
            : isSeconds
              ? t('workout:specifySecsTitle', { defaultValue: 'Seconds performed' })
              : t('workout:specifyRepsTitle', { defaultValue: 'Reps performed' }),
          isEnduranceTime
            ? t('workout:checkAllNeedsTime', { name: exerciseName })
            : isSeconds
              ? t('workout:checkAllNeedsSecs', {
                  defaultValue: `Please fill in the seconds for ${exerciseName} before checking all sets.`,
                  name: exerciseName,
                })
              : t('workout:checkAllNeedsReps', {
                  defaultValue: `Please fill in the reps for ${exerciseName} before checking all sets.`,
                  name: exerciseName,
                }),
        );
        return;
      }

      setExerciseSets(prev => {
        let next = prev.map(s => {
          if (s.exerciseId === exerciseId && !s.completed) {
            const repsNum = parseInt(s.reps, 10);
            const needsReps = !s.reps || isNaN(repsNum) || repsNum <= 0;
            return {
              ...s,
              completed: true,
              reps: needsReps ? fallbackReps : s.reps,
              isSaved: false,
            };
          }
          return s;
        });
        next = reassignExerciseCommentInSets(next, exerciseId);
        const toSave = next.filter(x => x.exerciseId === exerciseId && x.completed);
        if (toSave.length > 0) {
          queueMicrotask(() => {
            for (const s of toSave) {
              void saveSet(s, next);
            }
          });
        }
        return next;
      });
    } else {
      setExerciseSets(prev => {
        let next = prev.map(s => {
          if (s.exerciseId === exerciseId && s.completed) {
            return { ...s, completed: false, isSaved: false };
          }
          return s;
        });
        next = reassignExerciseCommentInSets(next, exerciseId);
        const toSave = next.filter(x => x.exerciseId === exerciseId);
        if (toSave.length > 0) {
          queueMicrotask(() => {
            for (const s of toSave) {
              void saveSet(s, next);
            }
          });
        }
        return next;
      });
    }
  };

  // Add a new set to an exercise
  const addSet = (exerciseId: string, exerciseName: string) => {
    const existingSets = exerciseSets.filter(s => s.exerciseId === exerciseId);
    const lastSet = existingSets[existingSets.length - 1];
    const newSetNumber = existingSets.length + 1;

    setExerciseSets(prev =>
      reassignExerciseCommentInSets(
        [
          ...prev,
          {
            exerciseId,
            exerciseName,
            setNumber: newSetNumber,
            weightValue: lastSet?.weightValue || '',
            weightUnit: lastSet?.weightUnit || weightUnit,
            reps: lastSet?.reps || '',
            restTimeSeconds: lastSet?.restTimeSeconds,
            rir: lastSet?.rir,
            difficultyPerception: undefined,
            comments: '',
            isSaved: false,
            completed: false,
          },
        ],
        exerciseId,
      ),
    );
  };

  // Move an exercise up or down in the order
  const moveExercise = (exerciseId: string, direction: 'up' | 'down') => {
    const exerciseOrder = Object.keys(groups);
    const currentIndex = exerciseOrder.indexOf(exerciseId);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= exerciseOrder.length) return;

    const [moved] = exerciseOrder.splice(currentIndex, 1);
    exerciseOrder.splice(targetIndex, 0, moved);

    const reordered: ExerciseSetState[] = [];
    for (const exId of exerciseOrder) {
      reordered.push(...groups[exId]);
    }
    setExerciseSets(reordered);
  };

  // Delete an exercise and all its sets
  const deleteExercise = (exerciseId: string, exerciseName: string) => {
    Alert.alert(
      t('workout:deleteExerciseTitle'),
      t('workout:deleteExerciseBody', { name: exerciseName }),
      [
        { text: t('workout:deleteExerciseCancel'), style: 'cancel' },
        {
          text: t('workout:deleteExerciseConfirm'),
          style: 'destructive',
          onPress: () => {
            // Remove all sets for this exercise
            setExerciseSets(prev => prev.filter(s => s.exerciseId !== exerciseId));
            // Close the exercise if it was expanded
            if (expandedExercise === exerciseId) {
              setExpandedExercise(null);
            }
          },
        },
      ]
    );
  };

  const handleVideoPress = async (exerciseId: string, exerciseName?: string) => {
    const exercise = getExerciseDetailsForUser(exerciseId, exerciseName);
    const url = getLocalizedExerciseVideoUrl(exercise, i18n.language);
    if (url) {
      try {
        await Linking.openURL(url);
      } catch (error) {
        Alert.alert(t('common:error'), t('workout:couldNotOpenVideo'));
      }
    }
  };

  const getPlanExerciseWithAlternatives = (exerciseId: string) => {
    return workoutOption?.exercises?.find(ex =>
      ex.exerciseId === exerciseId &&
      ex.alternatives &&
      ex.alternatives.length > 0
    ) ?? null;
  };

  const handleExerciseHeaderPress = (exerciseId: string, isExpanded: boolean) => {
    setShowRepsDropdown(null);
    setShowRestTimeDropdown(null);

    const planExercise = getPlanExerciseWithAlternatives(exerciseId);
    if (planExercise && !resolvedAlternativeExerciseIds.has(exerciseId)) {
      setAlternativeExercise(planExercise);
      return;
    }

    setExpandedExercise(isExpanded ? null : exerciseId);
  };

  const handleAlternativeExerciseConfirmed = async (resolvedOption: WorkoutDayOption) => {
    if (!alternativeExercise) return;

    const originalExercise = alternativeExercise;
    const resolvedExercise = resolvedOption.exercises[0];
    setAlternativeExercise(null);
    setResolvedAlternativeExerciseIds(prev => new Set(prev).add(originalExercise.exerciseId));

    if (!resolvedExercise || resolvedExercise.exerciseId === originalExercise.exerciseId) {
      setExpandedExercise(originalExercise.exerciseId);
      return;
    }

    const lastData = await getLastWorkoutForExercise(userId, resolvedExercise.exerciseId);
    if (Object.keys(lastData).length > 0) {
      setLastWorkoutData(prev => ({ ...prev, [resolvedExercise.exerciseId]: lastData }));
    }

    const existingSets = exerciseSets.filter(s => s.exerciseId === originalExercise.exerciseId);
    const targetSetCount = existingSets.length || resolvedExercise.sets || 3;
    const resolvedCat = getExerciseDetails(resolvedExercise.exerciseId, resolvedExercise.name);
    const planReps = defaultRepsForExercise(resolvedCat, resolveRepRange(resolvedExercise.reps));
    const replacementSets: ExerciseSetState[] = Array.from({ length: targetSetCount }, (_, index) => {
      const setNumber = index + 1;
      const lastSetData = lastData[setNumber];
      const resolvedName = resolvedCat
        ? getExerciseCatalogLabel(resolvedCat, i18n.language)
        : resolvedExercise.name;
      return {
        exerciseId: resolvedExercise.exerciseId,
        exerciseName: resolvedName,
        setNumber,
        weightValue: lastSetData?.weightValue?.toString() || '',
        weightUnit: lastSetData?.weightUnit || 'kg',
        reps: lastSetData?.reps?.toString() || planReps,
        restTimeSeconds: lastSetData?.restTimeSeconds || resolvedExercise.restTimeSeconds,
        rir: lastSetData?.rir ?? resolvedExercise.rir,
        difficultyPerception: undefined,
        comments: '',
        isSaved: false,
        completed: false,
      };
    });

    setExerciseSets(prevSets => {
      const nextSets: ExerciseSetState[] = [];
      let insertedReplacement = false;

      for (const set of prevSets) {
        if (set.exerciseId === originalExercise.exerciseId) {
          if (!insertedReplacement) {
            nextSets.push(...replacementSets);
            insertedReplacement = true;
          }
        } else {
          nextSets.push(set);
        }
      }

      return insertedReplacement ? nextSets : [...nextSets, ...replacementSets];
    });
    setExpandedExercise(resolvedExercise.exerciseId);

    if (workoutLog?.id) {
      try {
        const db = getDatabase();
        await db.runAsync(
          'DELETE FROM workout_exercise_logs WHERE workout_log_id = ? AND exercise_id = ?',
          [workoutLog.id, originalExercise.exerciseId]
        );
        for (const set of replacementSets) {
          await saveExerciseLog(
            workoutLog.id,
            set.exerciseId,
            set.exerciseName,
            set.setNumber,
            undefined,
            undefined,
            undefined,
            set.restTimeSeconds,
            set.rir,
            undefined,
            undefined,
            false,
            false
          );
        }
        setExerciseSets(prevSets => prevSets.map(set =>
          set.exerciseId === resolvedExercise.exerciseId
            ? { ...set, isSaved: true }
            : set
        ));
      } catch (error) {
        console.warn('[WorkoutLogModal] Failed to persist planned alternative selection:', error);
      }
    }
  };

  // Handle exercise substitution
  const handleExerciseSubstitution = async (oldExerciseId: string, newExercise: Exercise) => {
    if (newExercise.id.startsWith('custom_')) {
      setCustomExercises(prev => prev.some(ex => ex.id === newExercise.id) ? prev : [...prev, newExercise]);
    }
    const oldExerciseSets = exerciseSets.filter(s => s.exerciseId === oldExerciseId);
    const oldExerciseName = oldExerciseSets[0]?.exerciseName;
    
    // Fetch last workout data for the new exercise
    const lastData = await getLastWorkoutForExercise(userId, newExercise.id);
    if (Object.keys(lastData).length > 0) {
      setLastWorkoutData(prev => ({ ...prev, [newExercise.id]: lastData }));
    }
    
    // Create 3 new sets for the new exercise, pre-filled from last workout if available
    const newSets: ExerciseSetState[] = [1, 2, 3].map(setNum => {
      const lastSetData = lastData[setNum];
      return {
        exerciseId: newExercise.id,
        exerciseName: getExerciseCatalogLabel(newExercise, i18n.language),
        setNumber: setNum,
        // Pre-fill from last workout if available
        weightValue: lastSetData?.weightValue?.toString() || '',
        weightUnit: lastSetData?.weightUnit || 'kg' as WeightUnit,
        reps: lastSetData?.reps?.toString() || '',
        restTimeSeconds: lastSetData?.restTimeSeconds,
        rir: lastSetData?.rir,
        difficultyPerception: undefined,
        comments: '',
        isSaved: false,
        completed: false,
        substitutedFrom: oldExerciseName,
      };
    });
    
    // Replace old exercise sets with new empty sets at the same position
    setExerciseSets(prevSets => {
      const result: ExerciseSetState[] = [];
      let substituted = false;
      
      for (const set of prevSets) {
        if (set.exerciseId === oldExerciseId) {
          // First time we encounter the old exercise, insert all new sets
          if (!substituted) {
            result.push(...newSets);
            substituted = true;
          }
          // Skip all old exercise sets (don't add them to result)
        } else {
          // Keep all other exercises in their original position
          result.push(set);
        }
      }
      
      return result;
    });
    
    setSubstitutingExerciseId(null);
    Alert.alert(
      t('workout:exerciseSubstitutedTitle'),
      t('workout:exerciseSubstitutedBody', { old: oldExerciseName, new: getExerciseCatalogLabel(newExercise, i18n.language) }),
      [{ text: t('common:ok') }]
    );
  };

  // Handle adding a new exercise
  const handleAddExercise = async (newExercise: Exercise) => {
    if (newExercise.id.startsWith('custom_')) {
      setCustomExercises(prev => prev.some(ex => ex.id === newExercise.id) ? prev : [...prev, newExercise]);
    }
    // Fetch last workout data for the new exercise
    const lastData = await getLastWorkoutForExercise(userId, newExercise.id);
    if (Object.keys(lastData).length > 0) {
      setLastWorkoutData(prev => ({ ...prev, [newExercise.id]: lastData }));
    }
    
    // Create 3 new sets for the new exercise, pre-filled from last workout if available
    const newSets: ExerciseSetState[] = [1, 2, 3].map(setNum => {
      const lastSetData = lastData[setNum];
      return {
        exerciseId: newExercise.id,
        exerciseName: getExerciseCatalogLabel(newExercise, i18n.language),
        setNumber: setNum,
        // Pre-fill from last workout if available
        weightValue: lastSetData?.weightValue?.toString() || '',
        weightUnit: lastSetData?.weightUnit || 'kg' as WeightUnit,
        reps: lastSetData?.reps?.toString() || '',
        restTimeSeconds: lastSetData?.restTimeSeconds,
        rir: lastSetData?.rir,
        difficultyPerception: undefined,
        comments: '',
        isSaved: false,
        completed: false,
      };
    });
    
    // Add the new sets to the end
    setExerciseSets(prevSets => [...prevSets, ...newSets]);
    setExpandedExercise(newExercise.id);
    setIsAddingExercise(false);
  };

  // Save all and complete workout (with retry for resilience against network/DB issues)
  const handleLogWorkout = async () => {
    if (!workoutLog?.id) return;

    const checkedSets = exerciseSets.filter(s => s.completed).length;
    const uncheckedSets = exerciseSets.filter(s => !s.completed).length;
    glowLogger.info('Logging workout', {
      workout_id: workoutLog.id,
      workout_day: workoutLog.workoutDayName,
      checked_sets: checkedSets,
      unchecked_sets: uncheckedSets,
      total_exercises: Object.keys(groups).length,
    });

    setIsSaving(true);
    let scoreBefore = 0;
    try {
      scoreBefore = await calculateWeeklyConsistency(userId, plannedTrainingDays, { completedOnly: true });
    } catch { /* keep 0 */ }
    try {
      const db = getDatabase();
      const workoutLogId = workoutLog.id;

      // ── Step 1: Local SQLite save (with retry for transient DB locks) ──
      await withRetry(
        async () => {
          console.log('[WorkoutLogModal] Saving workout with', exerciseSets.length, 'total sets');
          await db.withTransactionAsync(async () => {
            console.log('[WorkoutLogModal] Clearing old exercise logs for workout', workoutLogId);
            await db.runAsync(
              'DELETE FROM workout_exercise_logs WHERE workout_log_id = ?',
              [workoutLogId],
            );

            for (const set of exerciseSets) {
              if (!set.completed) continue;
              const setsForExercise = exerciseSets.filter(s => s.exerciseId === set.exerciseId);
              await saveExerciseLog(
                workoutLogId,
                set.exerciseId,
                set.exerciseName,
                set.setNumber,
                set.weightValue ? parseFloat(set.weightValue) : undefined,
                set.weightValue ? set.weightUnit : undefined,
                set.reps ? parseInt(set.reps) : undefined,
                set.restTimeSeconds,
                set.rir,
                set.difficultyPerception,
                getPersistedSetComment(set, setsForExercise),
                false,
                true,
              );
            }
          });
        },
        { maxAttempts: 3, baseDelayMs: 500, label: 'LocalSave' },
      );

      // Mark completed locally (retried so the status is always persisted)
      // Use the user-selected date (defaults to today).
      const todayDate = workoutDateStr;
      await withRetry(
        async () => {
          await updateWorkoutLogStatus(workoutLogId, 'completed');
          await db.runAsync(
            'UPDATE workout_logs SET workout_date = ? WHERE id = ?',
            [todayDate, workoutLogId],
          );
        },
        { maxAttempts: 3, baseDelayMs: 500, label: 'LocalStatusUpdate' },
      );

      // ── Step 2: Supabase sync (best-effort with retry + pending queue) ──
      // All Supabase work runs after the local save is confirmed — if it
      // fails completely the data is queued and retried on next app launch.
      const syncToSupabase = async () => {
        let supabaseWorkoutId = workoutLog.supabaseId;

        // 2a. Ensure workout log exists in Supabase
        if (!supabaseWorkoutId) {
          console.log('[WorkoutLogModal] Workout not synced to Supabase, syncing now...');
          try {
            supabaseWorkoutId = await withRetry(
              async () => {
                const { data, error } = await supabase
                  .from('workout_logs')
                  .insert({
                    user_id: userId,
                    workout_date: todayDate,
                    workout_day_name: workoutLog.workoutDayName,
                    step_id: workoutLog.stepId || null,
                    status: 'completed',
                  })
                  .select('id')
                  .single();

                if (error) throw new Error(error.message);
                return data.id as number;
              },
              { maxAttempts: 3, baseDelayMs: 1000, label: 'SupabaseWorkoutInsert' },
            );

            await db.runAsync(
              'UPDATE workout_logs SET supabase_id = ?, synced = 1 WHERE id = ?',
              [supabaseWorkoutId!, workoutLogId],
            );
            console.log('[WorkoutLogModal] Workout synced to Supabase:', supabaseWorkoutId);
          } catch {
            console.warn('[WorkoutLogModal] All retries failed for Supabase workout insert, queuing for later');
            await storePendingWorkoutLog({
              localId: workoutLogId,
              userId,
              workoutDate: todayDate,
              workoutDayName: workoutLog.workoutDayName,
              stepId: workoutLog.stepId,
              status: 'completed',
              timestamp: Date.now(),
            });
            return; // Exercise sync depends on the parent row — skip until retry
          }
        } else {
          // Parent row already exists — update its status and date to completed
          try {
            await withRetry(
              async () => {
                const { error } = await supabase
                  .from('workout_logs')
                  .update({ status: 'completed', workout_date: todayDate, updated_at: new Date().toISOString() })
                  .eq('id', supabaseWorkoutId);
                if (error) throw new Error(error.message);
              },
              { maxAttempts: 3, baseDelayMs: 1000, label: 'SupabaseStatusUpdate' },
            );
          } catch {
            console.warn('[WorkoutLogModal] Failed to update Supabase workout status after retries');
          }
        }

        // 2b. Clear old exercise logs from Supabase
        if (supabaseWorkoutId) {
          try {
            await withRetry(
              async () => {
                const { error } = await supabase
                  .from('workout_exercise_logs')
                  .delete()
                  .eq('workout_log_id', supabaseWorkoutId);
                if (error) throw new Error(error.message);
              },
              { maxAttempts: 2, baseDelayMs: 1000, label: 'SupabaseClearExerciseLogs' },
            );
            console.log('[WorkoutLogModal] Cleared exercise logs from Supabase');
          } catch {
            console.warn('[WorkoutLogModal] Failed to clear Supabase exercise logs after retries');
          }
        }

        // 2c. Sync completed sets (saveExerciseLog already queues failures)
        for (const set of exerciseSets) {
          if (!set.completed) continue;
          const setsForExercise = exerciseSets.filter(s => s.exerciseId === set.exerciseId);
          try {
            await saveExerciseLog(
              workoutLogId,
              set.exerciseId,
              set.exerciseName,
              set.setNumber,
              set.weightValue ? parseFloat(set.weightValue) : undefined,
              set.weightValue ? set.weightUnit : undefined,
              set.reps ? parseInt(set.reps) : undefined,
              set.restTimeSeconds,
              set.rir,
              set.difficultyPerception,
              getPersistedSetComment(set, setsForExercise),
              true,
              true,
            );
          } catch (syncErr) {
            console.warn('[WorkoutLogModal] Failed to sync exercise to Supabase, queued for retry:', syncErr);
          }
        }
      };

      // Fire Supabase sync — don't block the success UI if it takes long
      syncToSupabase().catch(e =>
        console.warn('[WorkoutLogModal] Supabase sync background error:', e),
      );

      // ── Step 3: UI updates (success celebration, monthly count) ──
      try {
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-31`;
        const result = await db.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM workout_logs
           WHERE user_id = ? AND status = 'completed'
           AND workout_date >= ? AND workout_date <= ?`,
          [userId, monthStart, monthEnd],
        );
        setWorkoutsThisMonth(Math.max(result?.count ?? 1, 1));
      } catch {
        setWorkoutsThisMonth(1);
      }

      try {
        const scoreAfter = await calculateWeeklyConsistency(userId, plannedTrainingDays, { completedOnly: true });
        setConsistencyScore(scoreAfter);
        const crossed = didCrossConsistencyThreshold(scoreBefore, scoreAfter);
        setShowConsistencyCelebration(crossed);
        if (crossed) {
          setShowCelebrationModal(true);
        } else {
          setShowSuccessModal(true);
        }
      } catch (e) {
        console.warn('Error checking consistency:', e);
        setShowSuccessModal(true);
      }

      // Recompute + upload the leaderboard score (no-op when this session can't
      // change the capped score, e.g. a day that already counts as trained).
      refreshConsistencyScoreAfterLog(userId).catch(() => {});
    } catch (error) {
      console.error('Error logging workout:', error);
      Alert.alert(t('common:error'), t('workout:failedSaveWorkout'));
    } finally {
      setIsSaving(false);
    }
  };

  // Save for later (keep in progress)
  const handleSaveForLater = async () => {
    if (!workoutLog?.id) {
      onClose();
      return;
    }
    if (saveForLaterInFlightRef.current) return;
    saveForLaterInFlightRef.current = true;

    setIsSaving(true);
    try {
      const current = await getWorkoutLogById(workoutLog.id);
      if (!current || current.status !== 'in_progress') {
        onClose();
        return;
      }

      const db = getDatabase();
      
      // Delete all existing exercise logs for this workout to ensure clean state
      // This removes old exercises that were substituted
      console.log('[WorkoutLogModal] Clearing old exercise logs for workout', workoutLog.id);
      await db.runAsync(`
        DELETE FROM workout_exercise_logs
        WHERE workout_log_id = ?
      `, [workoutLog.id]);

      // Also delete from Supabase if workout is synced
      if (workoutLog.supabaseId) {
        try {
          await supabase
            .from('workout_exercise_logs')
            .delete()
            .eq('workout_log_id', workoutLog.supabaseId);
          console.log('[WorkoutLogModal] Cleared exercise logs from Supabase');
        } catch (e) {
          console.warn('[WorkoutLogModal] Failed to clear Supabase exercise logs:', e);
        }
      }

      // Save ALL sets - including empty ones and substitutions
      // This preserves the workout structure when reopening the draft
      // Don't sync to Supabase for drafts - only save locally
      console.log('[WorkoutLogModal] Saving draft with', exerciseSets.length, 'sets');
      for (const set of exerciseSets) {
        const setsForExercise = exerciseSets.filter(s => s.exerciseId === set.exerciseId);
        await saveExerciseLog(
          workoutLog.id,
          set.exerciseId,
          set.exerciseName,
          set.setNumber,
          set.weightValue ? parseFloat(set.weightValue) : undefined,
          set.weightValue ? set.weightUnit : undefined,
          set.reps ? parseInt(set.reps) : undefined,
          set.restTimeSeconds,
          set.rir,
          set.difficultyPerception,
          getPersistedSetComment(set, setsForExercise),
          false, // Don't sync to Supabase for drafts
          set.completed // Preserve checked/completed state
        );
      }
      
      // Save warmup/cooldown checked states to AsyncStorage
      try {
        const warmupKey = `workout_${workoutLog.id}_warmup_checked`;
        const cooldownKey = `workout_${workoutLog.id}_cooldown_checked`;
        await AsyncStorage.setItem(warmupKey, warmupChecked.toString());
        await AsyncStorage.setItem(cooldownKey, cooldownChecked.toString());
        console.log('[WorkoutLogModal] Saved warmup/cooldown state');
      } catch (error) {
        console.warn('[WorkoutLogModal] Failed to save warmup/cooldown state:', error);
      }
      
      console.log('[WorkoutLogModal] Draft saved successfully');

      resetTransientOverlayState();
      await stopRestTimer();

      const draftSnapshot: WorkoutLog = {
        ...workoutLog,
        status: 'in_progress',
        workoutDate: workoutDateStr,
      };
      if (onDraftSaved) {
        onDraftSaved(draftSnapshot);
      } else {
        onClose();
      }
    } catch (error) {
      console.error('Error saving workout:', error);
      Alert.alert(t('common:error'), t('workout:failedSaveWorkoutShort'));
    } finally {
      setIsSaving(false);
      saveForLaterInFlightRef.current = false;
    }
  };

  const handleWorkoutDateChange = async (newDate: string) => {
    setWorkoutDateStr(newDate);
    if (workoutLog?.id) {
      await updateWorkoutDate(workoutLog.id, newDate);
    }
  };

  // Delete workout
  const handleDelete = () => {
    Alert.alert(
      t('workout:deleteWorkoutTitle'),
      t('workout:deleteWorkoutBody'),
      [
        { text: t('workout:deleteWorkoutCancel'), style: 'cancel' },
        {
          text: t('workout:deleteWorkoutConfirm'),
          style: 'destructive',
          onPress: async () => {
            if (workoutLog?.id) {
              setIsSaving(true);
              try {
                console.log('[WorkoutLogModal] Deleting workout log:', workoutLog.id);
                const success = await deleteWorkoutLog(userId, workoutLog.id);
                console.log('[WorkoutLogModal] Delete result:', success);
                
                if (success) {
                  // Call refresh first to update the data
                  if (onDelete) {
                    onDelete();
                  }
                  // Small delay then close modal
                  setTimeout(() => {
                    onClose();
                  }, 100);
                } else {
                  Alert.alert(t('common:error'), t('workout:failedDeleteWorkout'));
                }
              } catch (error) {
                console.error('[WorkoutLogModal] Error deleting workout:', error);
                Alert.alert(t('common:error'), t('workout:failedDeleteWorkout'));
              } finally {
                setIsSaving(false);
              }
            }
          },
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleSaveForLater}
      onDismiss={onClose}
    >
      <View style={styles.modalRoot}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleSaveForLater} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>{t('workout:saveDraft')}</Text>
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {workoutOption?.dayName || workoutLog?.workoutDayName || t('workout:logWorkout')}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.headerButton, styles.headerDeleteButton]}
            onPress={handleDelete}
          >
            <Text style={styles.headerDeleteButtonText}>{t('workout:delete')}</Text>
          </TouchableOpacity>
        </View>
        <LogDateSelector
          selectedDate={workoutDateStr}
          onDateChange={handleWorkoutDateChange}
        />
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#F47C3C" />
            <Text style={styles.loadingText}>{t('workout:loadingWorkout')}</Text>
          </View>
        ) : (
          <View style={styles.keyboardView}>
            {/* Tutorial Overlay */}
            {showTutorial && (
              <View style={styles.tutorialOverlay}>
                <ScrollView
                  style={styles.tutorialScrollView}
                  contentContainerStyle={styles.tutorialScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Gender-appropriate training image */}
                  <View style={styles.tutorialImageContainer}>
                    <ExpoImage
                      source={
                        userGender === 'female'
                          ? planImages['fem training']
                          : planImages['male training']
                      }
                      style={styles.tutorialImage}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={120}
                    />
                    <View style={styles.tutorialImageGradient} />
                  </View>

                  <View style={styles.tutorialContent}>
                    <Text style={styles.tutorialTitle}>{t('workout:tutorialTitle')}</Text>

                    {/* Tip 1 - Video demos */}
                    <View style={styles.tutorialTipRow}>
                      <View style={[styles.tutorialTipIcon, styles.tutorialTipIconVideo]}>
                        <Icon source={appIcons.video_library} width={18} height={18} fill="#5B9BD5" />
                      </View>
                      <Text style={styles.tutorialTipText}>
                        {t('workout:tutorialTip1')}
                      </Text>
                    </View>

                    {/* Tip 2 - Expand exercises */}
                    <View style={styles.tutorialTipRow}>
                      <View style={styles.tutorialTipIcon}>
                        <Text style={styles.tutorialTipIconText}>▶</Text>
                      </View>
                      <Text style={styles.tutorialTipText}>
                        {t('workout:tutorialTip2')}
                      </Text>
                    </View>

                    {/* Tip 3 - Check sets */}
                    <View style={styles.tutorialTipRow}>
                      <View style={[styles.tutorialTipIcon, styles.tutorialTipIconCheck]}>
                        <Text style={styles.tutorialTipIconCheckText}>✓</Text>
                      </View>
                      <Text style={styles.tutorialTipText}>
                        {t('workout:tutorialTip3')}
                      </Text>
                    </View>

                    {/* Tip 4 - Substitute */}
                    <View style={styles.tutorialTipRow}>
                      <View style={[styles.tutorialTipIcon, styles.tutorialTipIconSubstitute]}>
                        <Icon source={appIcons.refresh} width={18} height={18} fill="#F47C3C" />
                      </View>
                      <Text style={styles.tutorialTipText}>
                        {t('workout:tutorialTip4')}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={styles.tutorialGotItButton}
                      onPress={() => setShowTutorial(false)}
                    >
                      <Text style={styles.tutorialGotItButtonText}>{t('workout:tutorialGotIt')}</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </View>
            )}

            <ScrollView
              ref={workoutScrollRef}
              style={styles.scrollView}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingBottom: 28 + 88 + keyboardBottomInset },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="interactive"
              nestedScrollEnabled
              onScrollBeginDrag={() => { closeAny(); Keyboard.dismiss(); }}
            >
              <Pressable onPress={() => { closeAny(); Keyboard.dismiss(); }}>
              {/* === WARM-UP SECTION === */}
              {workoutOption?.warmup && (
                <View style={styles.sectionCard}>
                  <TouchableOpacity
                    style={styles.sectionHeader}
                    onPress={() => setWarmupExpanded(!warmupExpanded)}
                    activeOpacity={0.7}
                  >
                    <TouchableOpacity
                      style={[styles.sectionCheckbox, warmupChecked && styles.sectionCheckboxChecked]}
                      onPress={() => setWarmupChecked(!warmupChecked)}
                    >
                      {warmupChecked && <Text style={styles.sectionCheckboxCheck}>✓</Text>}
                    </TouchableOpacity>
                    <View style={styles.sectionHeaderContent}>
                      <Text style={[styles.sectionTitle, warmupChecked && styles.sectionTitleChecked]}>
                        {t('workout:sectionWarmup')}
                      </Text>
                    </View>
                    <Text style={styles.expandIcon}>{warmupExpanded ? '▼' : '▶'}</Text>
                  </TouchableOpacity>
                  {warmupExpanded && (
                    <View style={styles.sectionBody}>
                      <Text style={[styles.sectionBodyText, warmupChecked && styles.sectionBodyTextChecked]}>
                        {workoutOption.warmup}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* === WORKOUT SECTION HEADER === */}
              <TouchableOpacity
                style={styles.workoutSectionHeader}
                onPress={() => setWorkoutSectionExpanded(!workoutSectionExpanded)}
                activeOpacity={0.7}
              >
                <Text style={styles.workoutSectionTitle}>{t('workout:sectionWorkout')}</Text>
                <Text style={styles.workoutSectionMeta}>
                  {t('workout:setsCount', { done: exerciseSets.filter(s => s.completed).length, total: exerciseSets.length })}
                </Text>
                <Text style={styles.expandIcon}>{workoutSectionExpanded ? '▼' : '▶'}</Text>
              </TouchableOpacity>

              {/* === EXERCISES === */}
              {workoutSectionExpanded && Object.entries(groups).map(([exerciseId, sets], groupIndex, groupEntries) => {
                const firstSetForLookup = sets[0];
                const exercise = getExerciseDetailsForUser(exerciseId, firstSetForLookup?.exerciseName);
                const loggingUnit = getExerciseLoggingUnit(exercise);
                const isEnduranceTime = isEnduranceDurationExercise(exercise);
                const isSecondsExercise = loggingUnit === 'seconds' && !isEnduranceTime;
                const isExpanded = expandedExercise === exerciseId;
                const firstSet = sets[0];
                const allSetsCompleted = sets.length > 0 && sets.every(s => s.completed);
                const isFirst = groupIndex === 0;
                const isLast = groupIndex === groupEntries.length - 1;

                return (
                  <View
                    key={`${exerciseId}-${allSetsCompleted ? 'completed' : 'active'}`}
                    style={[styles.exerciseCard, allSetsCompleted && styles.exerciseCardCompleted]}
                  >
                    {/* Exercise Header */}
                    <TouchableOpacity
                      style={styles.exerciseHeader}
                      onPress={() => handleExerciseHeaderPress(exerciseId, isExpanded)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.exerciseInfo}>
                        <View style={styles.exerciseNameRow}>
                          {allSetsCompleted && (
                            <View style={styles.exerciseCompletedCheck}>
                              <Text style={styles.exerciseCompletedCheckText}>✓</Text>
                            </View>
                          )}
                          <Text style={[styles.exerciseName, allSetsCompleted && styles.exerciseNameCompleted]}>
                            {getLocalizedExerciseName(exercise, firstSet.exerciseName, i18n.language)}
                          </Text>
                          {firstSet.substitutedFrom && (
                            <View style={styles.substitutedBadge}>
                              <Text style={styles.substitutedBadgeText}>{t('workout:substituted')}</Text>
                            </View>
                          )}
                        </View>
                        {firstSet.substitutedFrom && (
                          <Text style={styles.substitutedFromText}>
                            {t('workout:substitutedFrom', { name: firstSet.substitutedFrom })}
                          </Text>
                        )}
                        <View style={styles.exerciseMeta}>
                          {exercise && (
                            <>
                              <View style={styles.metaBadge}>
                                <Text style={styles.metaBadgeText}>
                                  {getMuscleGroupDisplayName(exercise.muscleGroup)}
                                </Text>
                              </View>
                              <View style={[styles.metaBadge, styles.metaBadgeSecondary]}>
                                <Text style={styles.metaBadgeTextSecondary}>
                                  {getMovementTypeDisplayName(exercise.movementType)}
                                </Text>
                              </View>
                            </>
                          )}
                          <Text style={styles.setsCount}>{sets.length} {t('workout:setsLabel')}</Text>
                        </View>
                      </View>
                      <View style={styles.exerciseActions}>
                        <View style={styles.reorderButtons}>
                          <TouchableOpacity
                            style={[styles.reorderButton, isFirst && styles.reorderButtonDisabled]}
                            onPress={(e) => { e.stopPropagation(); if (!isFirst) moveExercise(exerciseId, 'up'); }}
                            disabled={isFirst}
                            hitSlop={{ top: 8, bottom: 4, left: 8, right: 8 }}
                          >
                            <Text style={[styles.reorderButtonText, isFirst && styles.reorderButtonTextDisabled]}>▲</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.reorderButton, isLast && styles.reorderButtonDisabled]}
                            onPress={(e) => { e.stopPropagation(); if (!isLast) moveExercise(exerciseId, 'down'); }}
                            disabled={isLast}
                            hitSlop={{ top: 4, bottom: 8, left: 8, right: 8 }}
                          >
                            <Text style={[styles.reorderButtonText, isLast && styles.reorderButtonTextDisabled]}>▼</Text>
                          </TouchableOpacity>
                        </View>
                        {getLocalizedExerciseVideoUrl(exercise, i18n.language) && (
                          <TouchableOpacity
                            style={styles.videoButton}
                            onPress={(e) => {
                              e.stopPropagation();
                              handleVideoPress(exerciseId, firstSetForLookup?.exerciseName);
                            }}
                          >
                            <Icon source={appIcons.video_library} width={16} height={16} fill="#5B9BD5" />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.substituteButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            setSubstitutingExerciseId(exerciseId);
                          }}
                        >
                          <Icon source={appIcons.refresh} width={16} height={16} fill="#F47C3C" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.deleteExerciseButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            deleteExercise(exerciseId, firstSet.exerciseName);
                          }}
                        >
                          <Icon source={appIcons.close} width={16} height={16} fill="#FF6B6B" />
                        </TouchableOpacity>
                        <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
                      </View>
                    </TouchableOpacity>

                    {/* Exercise Sets */}
                    {isExpanded && (
                      <View style={styles.setsContainer}>
                        {/* Check all / Uncheck all */}
                        <TouchableOpacity
                          style={styles.checkAllButton}
                          onPress={() => handleCheckAllSets(exerciseId)}
                          hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
                        >
                          <Text style={styles.checkAllButtonText}>
                            {allSetsCompleted ? t('workout:uncheckAll', { defaultValue: 'Uncheck all' }) : t('workout:checkAll', { defaultValue: 'Check all' })}
                          </Text>
                        </TouchableOpacity>

                        {/* Previous workout comment */}
                        {(() => {
                          const lastExData = lastWorkoutData[exerciseId];
                          if (!lastExData) return null;
                          const prevComment = getPreviousExerciseComment(lastExData);
                          if (!prevComment) return null;
                          return (
                            <Text style={styles.previousCommentText}>"{prevComment}"</Text>
                          );
                        })()}
                        {/* Sets Header */}
                        <View style={styles.setsHeader}>
                          {/* First row - main headers */}
                          <View style={styles.headerRow}>
                            <Text style={[styles.setHeaderText, styles.setHeaderDone]}>✓</Text>
                            <Text style={[styles.setHeaderText, styles.setHeaderSet]} numberOfLines={1} adjustsFontSizeToFit>{t('workout:colSet')}</Text>
                            <Text style={[styles.setHeaderText, styles.setHeaderWeight]} numberOfLines={1} adjustsFontSizeToFit>{t('workout:colWeight')}</Text>
                            <Text style={[styles.setHeaderText, styles.setHeaderReps]} numberOfLines={1} adjustsFontSizeToFit>
                              {isEnduranceTime || isSecondsExercise ? t('workout:colTime') : t('workout:colReps')}
                            </Text>
                            <Text style={[styles.setHeaderText, styles.setHeaderRest]} numberOfLines={1} adjustsFontSizeToFit>{t('workout:colRest')}</Text>
                            <Text style={[styles.setHeaderText, styles.setHeaderRir]} numberOfLines={1} adjustsFontSizeToFit>{t('workout:colRir')}</Text>
                          </View>
                          {/* Second row - "Last" labels */}
                          <View style={styles.headerRow}>
                            <Text style={[styles.lastWorkoutText, styles.setHeaderDone]}></Text>
                            <Text style={[styles.lastWorkoutText, styles.setHeaderSet]}></Text>
                            <Text style={[styles.lastWorkoutText, styles.setHeaderWeight, { paddingLeft: 20 }]} numberOfLines={1} adjustsFontSizeToFit>{t('workout:colLast')}</Text>
                            <Text style={[styles.lastWorkoutText, styles.setHeaderReps]} numberOfLines={1} adjustsFontSizeToFit>{t('workout:colLast')}</Text>
                            <Text style={[styles.lastWorkoutText, styles.setHeaderRest]}></Text>
                            <Text style={[styles.lastWorkoutText, styles.setHeaderRir]}></Text>
                          </View>
                        </View>

                        {/* Individual Sets */}
                        {sets.map((set, index) => {
                          const lastSetData = lastWorkoutData[exerciseId]?.[set.setNumber];
                          const isCompleted = set.completed;
                          
                          return (
                          <View key={`${exerciseId}-${set.setNumber}`} style={styles.setRowContainer}>
                            <View style={styles.setRow}>
                              {/* Checkbox */}
                              <TouchableOpacity
                                style={[styles.checkboxContainer, isCompleted && styles.checkboxContainerChecked]}
                                onPress={() => {
                                  const wasCompleted = set.completed;

                                  if (wasCompleted) {
                                    setExerciseSets(prev => {
                                      let next = prev.map(s => {
                                        if (s.exerciseId === exerciseId && s.setNumber === set.setNumber) {
                                          return { ...s, completed: false, isSaved: false };
                                        }
                                        return s;
                                      });
                                      next = reassignExerciseCommentInSets(next, exerciseId);
                                      for (const s of next.filter(x => x.exerciseId === exerciseId)) {
                                        void saveSet(s, next);
                                      }
                                      return next;
                                    });
                                    return;
                                  }

                                  const repsNum = parseInt(set.reps, 10);
                                  if (!set.reps || isNaN(repsNum) || repsNum <= 0) {
                                    setShowRepsDropdown(`${exerciseId}-${set.setNumber}`);
                                    return;
                                  }

                                  setExerciseSets(prev => {
                                    let next = prev.map(s => {
                                      if (s.exerciseId === exerciseId && s.setNumber === set.setNumber) {
                                        return { ...s, completed: true, isSaved: false };
                                      }
                                      return s;
                                    });
                                    next = reassignExerciseCommentInSets(next, exerciseId);
                                    for (const s of next.filter(x => x.exerciseId === exerciseId)) {
                                      void saveSet(s, next);
                                    }
                                    return next;
                                  });
                                  if (set.restTimeSeconds && set.restTimeSeconds > 0) {
                                    startRestTimer(set.restTimeSeconds);
                                  }
                                }}
                              >
                                {isCompleted && <Text style={styles.checkboxCheck}>✓</Text>}
                              </TouchableOpacity>

                              <View style={styles.setNumber}>
                                <Text style={[styles.setNumberText, isCompleted && styles.completedText]}>{set.setNumber}</Text>
                              </View>

                              {/* Weight Input with Last Workout Hint */}
                              <View style={styles.inputColumn}>
                                <View style={styles.weightContainer}>
                                  {isCompleted ? (
                                    <View style={[styles.weightInput, styles.completedInput, styles.completedWeightContainer]}>
                                      <Text style={styles.completedText}>{set.weightValue || '-'}</Text>
                                    </View>
                                  ) : (
                                    <TextInput
                                      style={styles.weightInput}
                                      textAlignVertical="center"
                                      placeholder="-"
                                      placeholderTextColor="#C7C7CC"
                                      keyboardType="decimal-pad"
                                      value={set.weightValue}
                                      onFocus={e => ensureInputVisible(e.nativeEvent.target)}
                                      onChangeText={v => updateSetValue(exerciseId, set.setNumber, 'weightValue', normalizeDecimalInput(v))}
                                      onBlur={() => {
                                        if (set.weightValue) saveSet(set);
                                        propagateValueToEmpty(exerciseId, set.setNumber, 'weightValue');
                                      }}
                                    />
                                  )}
                                  <TouchableOpacity
                                    style={styles.unitToggle}
                                    onPress={() => {
                                      if (isCompleted) return;
                                      const newUnit: WeightUnit = set.weightUnit === 'kg' ? 'lbs' : 'kg';
                                      updateSetValue(exerciseId, set.setNumber, 'weightUnit', newUnit);
                                      // Save to local DB after changing unit
                                      const updatedSet: ExerciseSetState = { ...set, weightUnit: newUnit, isSaved: false };
                                      saveSet(updatedSet);
                                    }}
                                    disabled={isCompleted}
                                  >
                                    <Text style={[styles.unitToggleText, isCompleted && styles.completedText]}>{set.weightUnit}</Text>
                                  </TouchableOpacity>
                                </View>
                                {lastSetData?.weightValue !== undefined && (
                                  <Text style={styles.lastWorkoutText}>{lastSetData.weightValue}{lastSetData.weightUnit || 'kg'}</Text>
                                )}
                              </View>

                              {/* Reps / seconds — picker only (no free-text entry) */}
                              <View style={styles.inputColumn}>
                                {isCompleted ? (
                                  <View style={[styles.repsButton, { alignSelf: 'stretch' }, styles.completedInput]}>
                                    <Text style={styles.completedText}>
                                      {set.reps?.trim()
                                        ? formatStoredRepsForDisplay(set.reps, isEnduranceTime)
                                        : '-'}
                                    </Text>
                                  </View>
                                ) : (
                                  <TouchableOpacity
                                    style={[styles.repsButton, { alignSelf: 'stretch' }]}
                                    onPress={() => {
                                      const k = `${exerciseId}-${set.setNumber}`;
                                      setShowRepsDropdown(showRepsDropdown === k ? null : k);
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel={
                                      isEnduranceTime || isSecondsExercise
                                        ? t('workout:colTime')
                                        : t('workout:colReps', { defaultValue: 'Reps' })
                                    }
                                  >
                                    <Text style={styles.repsButtonText}>
                                      {set.reps?.trim()
                                        ? formatStoredRepsForDisplay(set.reps, isEnduranceTime)
                                        : '-'}
                                    </Text>
                                  </TouchableOpacity>
                                )}
                                {lastSetData?.reps !== undefined && (
                                  <Text style={styles.lastWorkoutText}>
                                    {formatStoredRepsForDisplay(String(lastSetData.reps), isEnduranceTime)}{' '}
                                    {isEnduranceTime
                                      ? t('workout:minLabel')
                                      : isSecondsExercise
                                        ? t('workout:secsLabel')
                                        : t('workout:repsLabel')}
                                  </Text>
                                )}
                              </View>

                              {/* Rest Time */}
                              {isCompleted ? (
                                <View style={[styles.restButton, styles.completedInput]}>
                                  <Text style={styles.completedText}>
                                    {set.restTimeSeconds ? formatRestTime(set.restTimeSeconds) : '-'}
                                  </Text>
                                </View>
                              ) : (
                                <TouchableOpacity
                                  style={styles.restButton}
                                  onPress={() => setShowRestTimeDropdown(showRestTimeDropdown === `${exerciseId}-${set.setNumber}` ? null : `${exerciseId}-${set.setNumber}`)}
                                >
                                  <Text style={styles.restButtonText}>
                                    {set.restTimeSeconds ? formatRestTime(set.restTimeSeconds) : '-'}
                                  </Text>
                                </TouchableOpacity>
                              )}

                              {/* RiR */}
                              {isCompleted ? (
                                <View style={[styles.rirButton, styles.completedInput]}>
                                  <Text style={styles.completedText}>
                                    {set.rir !== undefined ? set.rir : '-'}
                                  </Text>
                                </View>
                              ) : (
                                <TouchableOpacity
                                  style={styles.rirButton}
                                  onPress={() => {
                                    closeAny();
                                    Keyboard.dismiss();
                                    const currentRir = set.rir;
                                    const newRir = currentRir === undefined ? 1 : (currentRir + 1) % 6;
                                    setExerciseSets(prev => {
                                      const updated = prev.map(s => {
                                        if (s.exerciseId === exerciseId && s.setNumber === set.setNumber) {
                                          const updatedSet = { ...s, rir: newRir, isSaved: false };
                                          saveSet(updatedSet);
                                          return updatedSet;
                                        }
                                        return s;
                                      });
                                      return updated;
                                    });
                                  }}
                                >
                                  <Text style={styles.rirButtonText}>
                                    {set.rir !== undefined ? set.rir : '-'}
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>
                        );
                        })}

                        {/* Difficulty & Comments (for last set) */}
                        <View style={styles.extraFields}>
                          <View style={styles.difficultyRow}>
                            <Text style={styles.extraLabel}>{t('workout:difficultyLabel')}</Text>
                            <View style={styles.difficultyStars}>
                              {[1, 2, 3, 4, 5].map(star => (
                                <TouchableOpacity
                                  key={star}
                                  onPress={() => {
                                    const lastSet = sets[sets.length - 1];
                                    updateSetValue(exerciseId, lastSet.setNumber, 'difficultyPerception', star as DifficultyPerception);
                                    // Save to local DB after setting difficulty
                                    const updatedSet = { ...lastSet, difficultyPerception: star as DifficultyPerception, isSaved: false };
                                    saveSet(updatedSet);
                                  }}
                                >
                                  <Text style={[
                                    styles.star,
                                    sets[sets.length - 1]?.difficultyPerception && sets[sets.length - 1].difficultyPerception! >= star && styles.starFilled
                                  ]}>
                                    ★
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>

                          <TextInput
                            style={styles.commentsInput}
                            placeholder={t('workout:addCommentsPlaceholder')}
                            placeholderTextColor="#C7C7CC"
                            value={getExerciseCommentDisplay(sets)}
                            onFocus={e => ensureInputVisible(e.nativeEvent.target)}
                            onChangeText={v => {
                              setExerciseSets(prev => {
                                const forEx = prev.filter(s => s.exerciseId === exerciseId);
                                const target = getLastCheckedSet(forEx) ?? forEx[forEx.length - 1];
                                if (!target) return prev;
                                return prev.map(s => {
                                  if (s.exerciseId !== exerciseId) return s;
                                  if (s.setNumber === target.setNumber) {
                                    return { ...s, comments: v, isSaved: false };
                                  }
                                  if (s.comments) return { ...s, comments: '', isSaved: false };
                                  return s;
                                });
                              });
                            }}
                            onBlur={() => {
                              setExerciseSets(prev => {
                                void saveExerciseComment(exerciseId, prev);
                                return prev;
                              });
                            }}
                            multiline
                            textAlignVertical="top"
                            scrollEnabled
                          />
                        </View>

                        {/* Add Set Button */}
                        <TouchableOpacity
                          style={styles.addSetButton}
                          onPress={() => addSet(exerciseId, firstSet.exerciseName)}
                        >
                          <Text style={styles.addSetButtonText}>{t('workout:addSet')}</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}

              {/* Add Exercise Button */}
              {workoutSectionExpanded && (
                <TouchableOpacity
                  style={styles.addExerciseButton}
                  onPress={() => setIsAddingExercise(true)}
                >
                  <Text style={styles.addExerciseButtonText}>{t('workout:addExercise')}</Text>
                </TouchableOpacity>
              )}

              {/* === COOLDOWN SECTION === */}
              {workoutOption?.cooldown && (
                <View style={[styles.sectionCard, { marginTop: 16 }]}>
                  <TouchableOpacity
                    style={styles.sectionHeader}
                    onPress={() => setCooldownExpanded(!cooldownExpanded)}
                    activeOpacity={0.7}
                  >
                    <TouchableOpacity
                      style={[styles.sectionCheckbox, cooldownChecked && styles.sectionCheckboxChecked]}
                      onPress={() => setCooldownChecked(!cooldownChecked)}
                    >
                      {cooldownChecked && <Text style={styles.sectionCheckboxCheck}>✓</Text>}
                    </TouchableOpacity>
                    <View style={styles.sectionHeaderContent}>
                      <Text style={[styles.sectionTitle, cooldownChecked && styles.sectionTitleChecked]}>
                        {t('workout:sectionCooldown') || 'Cool-down'}
                      </Text>
                    </View>
                    <Text style={styles.expandIcon}>{cooldownExpanded ? '▼' : '▶'}</Text>
                  </TouchableOpacity>
                  {cooldownExpanded && (
                    <View style={styles.sectionBody}>
                      <Text style={[styles.sectionBodyText, cooldownChecked && styles.sectionBodyTextChecked]}>
                        {workoutOption.cooldown}
                      </Text>
                    </View>
                  )}
                </View>
              )}
              </Pressable>
            </ScrollView>

            <View
              style={[
                styles.footer,
                { paddingBottom: Math.max(insets.bottom, 16) + 12 + keyboardBottomInset },
              ]}
            >
              <TouchableOpacity
                style={styles.footerLogButton}
                onPress={() => {
                  const checkedCount = exerciseSets.filter(s => s.completed).length;
                  if (checkedCount === 0) {
                    glowLogger.warn('Workout log blocked: zero checked sets', {
                      workout_id: workoutLog?.id,
                      total_sets: exerciseSets.length,
                    });
                    Alert.alert(
                      t('workout:noCheckedSetsTitle', { defaultValue: 'No sets checked' }),
                      t('workout:noCheckedSetsMessage', { defaultValue: 'You need to check at least one set before logging this workout.' }),
                    );
                    return;
                  }
                  setShowLogConfirmation(true);
                }}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.footerLogButtonText}>{t('workout:logWorkout')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

      </SafeAreaView>

      {/* Exercise Substitution Modal */}
      {alternativeExercise && (
        <ExerciseAlternativeSelector
          visible={!!alternativeExercise}
          workoutOption={{
            stepId: workoutOption?.stepId || 'planned-exercise-alternative',
            dayName: workoutOption?.dayName || workoutLog?.workoutDayName || t('workout:logWorkout'),
            dayType: workoutOption?.dayType,
            exercises: [alternativeExercise],
          }}
          onConfirm={handleAlternativeExerciseConfirmed}
          onClose={() => setAlternativeExercise(null)}
          confirmLabel={t('workout:exerciseAltUseExercise', { defaultValue: 'Use exercise' })}
        />
      )}

      {substitutingExerciseId && (
        <ExerciseSubstitutionModal
          visible={!!substitutingExerciseId}
          userId={userId}
          currentExercise={{
            id: substitutingExerciseId,
            name: exerciseSets.find(s => s.exerciseId === substitutingExerciseId)?.exerciseName || '',
          }}
          onSelect={(exercise) => handleExerciseSubstitution(substitutingExerciseId, exercise)}
          onClose={() => setSubstitutingExerciseId(null)}
          gender={mapGender}
        />
      )}

      {/* Add Exercise Modal */}
      {isAddingExercise && (
        <ExerciseSubstitutionModal
          visible={isAddingExercise}
          userId={userId}
          currentExercise={null}
          onSelect={handleAddExercise}
          onClose={() => setIsAddingExercise(false)}
          gender={mapGender}
        />
      )}

      {/* Rest Timer Overlay */}
      {restTimerVisible && (
        <View style={[StyleSheet.absoluteFill, styles.timerOverlay]}>
          <View style={styles.timerModal}>
            <Text style={styles.timerLabel}>{t('workout:restTimerTitle')}</Text>
            <View style={styles.timerCircleContainer}>
              <View style={styles.timerCircleBg}>
                <Animated.View
                  style={[
                    styles.timerCircleProgress,
                    {
                      transform: [{
                        rotate: restTimerProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg'],
                        }),
                      }],
                    },
                  ]}
                />
              </View>
              <Text style={styles.timerText}>
                {Math.floor(restTimerSeconds / 60)}:{(restTimerSeconds % 60).toString().padStart(2, '0')}
              </Text>
            </View>
            <Text style={styles.timerTotalText}>
              {t('workout:restTimerOfTotal', {
                time: `${Math.floor(restTimerTotal / 60)}:${(restTimerTotal % 60).toString().padStart(2, '0')}`,
              })}
            </Text>
            <TouchableOpacity style={styles.timerSkipButton} onPress={stopRestTimer}>
              <Text style={styles.timerSkipText}>{t('workout:skipTimer')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Workout Success Overlay */}
      {showSuccessModal && (
        <View style={[StyleSheet.absoluteFill, styles.successOverlay]}>
          <View style={styles.successModal}>
            <ScrollView
              style={styles.successScroll}
              contentContainerStyle={styles.successScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Coach image that fades into the content below (signals "scroll for more") */}
              <View style={styles.successImageWrap}>
                <Image source={successImage} style={styles.successImage} resizeMode="cover" />
                <LinearGradient
                  colors={['transparent', 'rgba(14,26,26,0.55)', '#0E1A1A']}
                  style={styles.successImageFade}
                  pointerEvents="none"
                />
              </View>

              <View style={styles.successContent}>
                <Text style={styles.successTitle}>{t('workout:successTitle')}</Text>
                <Text style={styles.successMessage}>
                  {t('workout:successMessage', {
                    ordinal:
                      workoutsThisMonth === 1
                        ? t('workout:successOrdinal1')
                        : workoutsThisMonth === 2
                          ? t('workout:successOrdinal2')
                          : workoutsThisMonth === 3
                            ? t('workout:successOrdinal3')
                            : t('workout:successOrdinalN', { count: workoutsThisMonth }),
                  })}
                </Text>

                {/* Headline stats (mirrors the pre-share summary) */}
                <View style={styles.successStatsRow}>
                  <View style={styles.successStat}>
                    <Text style={styles.successStatValue}>{successStats.exercises}</Text>
                    <Text style={styles.successStatLabel}>{t('workout:statExercises', { defaultValue: 'Exercises' })}</Text>
                  </View>
                  <View style={styles.successStat}>
                    <Text style={styles.successStatValue}>{successStats.sets}</Text>
                    <Text style={styles.successStatLabel}>{t('workout:statSets', { defaultValue: 'Sets' })}</Text>
                  </View>
                  {successStats.volumeKg > 0 && (
                    <View style={styles.successStat}>
                      <Text style={styles.successStatValue}>{formatVolumeKg(successStats.volumeKg)}</Text>
                      <Text style={styles.successStatLabel}>{t('workout:statVolume', { defaultValue: 'Volume' })}</Text>
                    </View>
                  )}
                  {successStats.kcal != null && successStats.kcal > 0 && (
                    <View style={styles.successStat}>
                      <Text style={styles.successStatValue}>{successStats.kcal}</Text>
                      <Text style={styles.successStatLabel}>{t('workout:statKcal', { defaultValue: 'Kcal' })}</Text>
                    </View>
                  )}
                </View>

                {(() => {
                  const equivalent = getLiftEquivalent(successStats.volumeKg);
                  if (!equivalent) return null;
                  return (
                    <View style={styles.successEquivalentRow}>
                      <Text style={styles.successEquivalentEmoji}>{equivalent.emoji}</Text>
                      <Text style={styles.successEquivalentText}>
                        {t('workout:liftEquivalent', {
                          object: t(`workout:${equivalent.objectKey}`),
                        })}
                      </Text>
                    </View>
                  );
                })()}

                {successStats.prs.length > 0 && (
                  <View style={styles.successPrRow}>
                    {successStats.prs.slice(0, 3).map((pr, i) => (
                      <View key={`${pr.exerciseName}-${i}`} style={styles.successPrChip}>
                        <Text style={styles.successPrText}>
                          🏆 {pr.exerciseName} · {Math.round(pr.weightKg)}kg × {pr.reps}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {!sessionFocus.empty && (
                  <View style={styles.successSection}>
                    <TrainingFocusBar focus={sessionFocus} />
                  </View>
                )}

                {sessionMuscleData.length > 0 && (
                  <View style={styles.successSection}>
                    <MuscleActivationMap
                      data={sessionMuscleData}
                      gender={mapGender}
                      caption={t('workout:musclesWorkedCaption', { defaultValue: 'Muscles worked' })}
                    />
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Pinned action footer — always reachable */}
            <View style={[styles.successFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <TouchableOpacity
                style={styles.successButton}
                onPress={() => {
                  if (!workoutLog?.id) return;
                  const payload = {
                    localWorkoutLogId: workoutLog.id,
                    supabaseWorkoutLogId: workoutLog.supabaseId ?? null,
                    displayTitle: workoutLog.workoutDayName,
                  };
                  setShowSuccessModal(false);
                  onSave();
                  onClose();
                  onShareWorkout?.(payload);
                }}
              >
                <Text style={styles.successButtonText}>{t('social:shareInUnderForge')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.successSecondaryButton}
                onPress={() => {
                  setShowSuccessModal(false);
                  onSave();
                  onClose();
                  onAfterSuccessfulWorkoutLog?.();
                }}
              >
                <Text style={styles.successSecondaryButtonText}>{t('workout:keepItUp')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Consistency Celebration Modal */}
      <ConsistencyCelebrationModal
        visible={showCelebrationModal}
        score={consistencyScore}
        coachName={coachName}
        onClose={() => {
          setShowCelebrationModal(false);
          setShowConsistencyCelebration(false);
          onSave();
          onClose();
        }}
        onShowStreak={onShowStreak ? () => {
          setShowCelebrationModal(false);
          setShowConsistencyCelebration(false);
          onSave();
          onClose();
          onShowStreak();
        } : undefined}
      />

      {/* Log Confirmation Overlay */}
      {showLogConfirmation && (
        <View style={[StyleSheet.absoluteFill, styles.confirmationOverlay]}>
          <View style={styles.confirmationModal}>
            <Text style={styles.confirmationTitle}>{t('workout:confirmTitle')}</Text>
            
            {/* Summary */}
            <View style={styles.confirmationSummary}>
              <Text style={styles.confirmationSummaryText}>
                {t('workout:confirmSetsCompleted', { done: exerciseSets.filter(s => s.completed).length, total: exerciseSets.length })}
              </Text>
            </View>

            {/* Warning for unchecked sets */}
            {exerciseSets.some(s => !s.completed) && (
              <View style={styles.confirmationWarningProminent}>
                <Icon source={appIcons.warning} width={24} height={24} fill="#F5C842" />
                <Text style={styles.confirmationWarningTextProminent}>
                  {t('workout:confirmUncheckedWarning', { count: exerciseSets.filter(s => !s.completed).length })}
                </Text>
              </View>
            )}

            <Text style={styles.confirmationDescription}>
              {t('workout:confirmDescription')}
            </Text>

            <View style={styles.confirmationButtons}>
              <TouchableOpacity
                style={styles.confirmationCancelButton}
                onPress={() => setShowLogConfirmation(false)}
              >
                <Text style={styles.confirmationCancelText}>{t('workout:confirmCancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmationLogButton}
                onPress={() => {
                  setShowLogConfirmation(false);
                  handleLogWorkout();
                }}
              >
                <Text style={styles.confirmationLogText}>{t('workout:confirmProceed')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Reps Picker — floating panel anchored above the keyboard */}
      {!!showRepsDropdown && (() => {
        const dropdownKey = showRepsDropdown;
        const lastHyphenIndex = dropdownKey.lastIndexOf('-');
        const exId = dropdownKey.substring(0, lastHyphenIndex);
        const setNumber = parseInt(dropdownKey.substring(lastHyphenIndex + 1));
        const exerciseNameForLookup = exerciseSets.find(
          s => s.exerciseId === exId,
        )?.exerciseName;
        const pickerExercise = getExerciseDetailsForUser(exId, exerciseNameForLookup);
        const pickerUnit = getExerciseLoggingUnit(pickerExercise);
        const pickerIsEnduranceTime = isEnduranceDurationExercise(pickerExercise);
        const pickerIsSeconds = pickerUnit === 'seconds' && !pickerIsEnduranceTime;
        const pickerValues = buildRepsPickerValues(pickerIsEnduranceTime, pickerIsSeconds);
        const applyReps = (raw: string) => {
          const normalized = normalizeRepsInput(raw);
          if (!normalized) return;
          const stored =
            pickerIsEnduranceTime
              ? String(minutesToStorageSeconds(parseInt(normalized, 10)))
              : normalized;
          setShowRepsDropdown(null);
          setExerciseSets(prev => prev.map(s => {
            if (s.exerciseId !== exId) return s;
            if (s.setNumber === setNumber) {
              const updatedSet = { ...s, reps: stored, isSaved: false };
              saveSet(updatedSet);
              return updatedSet;
            }
            // Propagate to following sets whose reps field is still empty.
            if (s.setNumber > setNumber && !s.reps?.toString().trim()) {
              const updated = { ...s, reps: stored, isSaved: false };
              saveSet(updated);
              return updated;
            }
            return s;
          }));
        };
        return (
          <>
            <Pressable
              style={styles.pickerBackdrop}
              onPress={() => setShowRepsDropdown(null)}
            />
            <View
              style={[
                styles.pickerPanel,
                { bottom: insets.bottom + keyboardBottomInset + 8 },
              ]}
            >
              <View style={styles.pickerHandle} />
              <Text style={styles.pickerTitle}>
                {pickerIsEnduranceTime || pickerIsSeconds
                  ? t('workout:colTime')
                  : t('workout:colReps')}
              </Text>
              <ScrollView
                ref={repsPickerScrollRef}
                style={styles.pickerScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
                onLayout={e => {
                  repsPickerViewportHeightRef.current = e.nativeEvent.layout.height;
                  if (repsPickerScrollIndex >= 0) {
                    scrollRepsPickerToIndex(repsPickerScrollIndex);
                  }
                }}
              >
                {pickerValues.map(value => (
                  <TouchableOpacity
                    key={value}
                    style={styles.pickerItem}
                    onPress={() => applyReps(value.toString())}
                  >
                    <Text style={styles.pickerItemText}>
                      {pickerIsEnduranceTime ? `${value} ${t('workout:minLabel')}` : value}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </>
        );
      })()}

      {/* Rest Time Picker — floating panel anchored above the keyboard (or safe area) */}
      {!!showRestTimeDropdown && (
        <>
          <Pressable
            style={styles.pickerBackdrop}
            onPress={() => setShowRestTimeDropdown(null)}
          />
          <View
            style={[
              styles.pickerPanel,
              { bottom: insets.bottom + keyboardBottomInset + 8 },
            ]}
          >
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>{t('workout:colRest')}</Text>
            <ScrollView
              style={styles.pickerScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {REST_TIME_OPTIONS.map(option => (
                <TouchableOpacity
                  key={option.value}
                  style={styles.pickerItem}
                  onPress={() => {
                    const dropdownKey = showRestTimeDropdown || '';
                    const lastHyphenIndex = dropdownKey.lastIndexOf('-');
                    const exId = dropdownKey.substring(0, lastHyphenIndex);
                    const setNumber = parseInt(dropdownKey.substring(lastHyphenIndex + 1));
                    setShowRestTimeDropdown(null);
                    setExerciseSets(prev => prev.map(s => {
                      if (s.exerciseId === exId && s.setNumber === setNumber) {
                        const updatedSet = { ...s, restTimeSeconds: option.value, isSaved: false };
                        saveSet(updatedSet);
                        return updatedSet;
                      }
                      return s;
                    }));
                    propagateValueToEmpty(exId, setNumber, 'restTimeSeconds');
                  }}
                >
                  <Text style={styles.pickerItemText}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </>
      )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0E1A1A',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  headerButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  headerButtonText: {
    fontSize: 16,
    color: '#9AA3A6',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#9AA3A6',
    marginTop: 2,
  },
  logButton: {
    backgroundColor: '#F47C3C',
    borderRadius: 8,
    paddingHorizontal: 20,
  },
  logButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#9AA3A6',
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 28,
  },
  exerciseCard: {
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  exerciseCardCompleted: {
    borderWidth: 1,
    borderColor: '#2D6A4F',
    // Avoid `opacity` on the card — Android composites children into one layer and
    // can fail to repaint correctly when toggling back to incomplete (see RN #24128).
    backgroundColor: '#101F1C',
  },
  exerciseCompletedCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2D6A4F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  exerciseCompletedCheckText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  exerciseNameCompleted: {
    color: '#9AA3A6',
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  exerciseName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  substitutedBadge: {
    backgroundColor: '#2A3638',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  substitutedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FF7A50',
  },
  substitutedFromText: {
    fontSize: 12,
    color: '#9AA3A6',
    fontStyle: 'italic',
    marginBottom: 4,
  },
  exerciseMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaBadge: {
    backgroundColor: '#2A3638',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  metaBadgeText: {
    fontSize: 11,
    color: '#F47C3C',
    fontWeight: '500',
  },
  metaBadgeSecondary: {
    backgroundColor: '#141E1E',
  },
  metaBadgeTextSecondary: {
    fontSize: 11,
    color: '#9AA3A6',
    fontWeight: '500',
  },
  setsCount: {
    fontSize: 12,
    color: '#9AA3A6',
  },
  exerciseActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reorderButtons: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  reorderButton: {
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  reorderButtonDisabled: {
    opacity: 0.2,
  },
  reorderButtonText: {
    fontSize: 10,
    color: '#9AA3A6',
  },
  reorderButtonTextDisabled: {
    color: '#4A5558',
  },
  substituteButton: {
    padding: 4,
    marginRight: 4,
  },
  substituteButtonText: {
    fontSize: 16,
  },
  videoButton: {
    padding: 4,
  },
  videoButtonText: {
    fontSize: 14,
  },
  deleteExerciseButton: {
    padding: 4,
  },
  deleteExerciseButtonText: {
    fontSize: 12,
  },
  expandIcon: {
    fontSize: 12,
    color: '#C7C7CC',
  },
  previousCommentText: {
    fontSize: 11,
    color: '#F47C3C',
    fontWeight: '500',
    fontStyle: 'italic',
    marginBottom: 8,
    lineHeight: 14,
  },
  checkAllButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(244, 124, 60, 0.12)',
    marginBottom: 8,
  },
  checkAllButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F47C3C',
  },
  setsContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  setsHeader: {
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  setHeaderText: {
    fontSize: 11,
    color: '#9AA3A6',
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  setHeaderDone: {
    width: 20, // Match checkboxContainer width (16) + marginRight (4)
    textAlign: 'left',
    paddingLeft: 2,
  },
  setHeaderSet: {
    width: 32, // Match setNumber width exactly
    textAlign: 'center',
    marginLeft: 0,
  },
  setHeaderWeight: {
    flex: 1,
    marginLeft: 4, // Match inputColumn marginLeft
    textAlign: 'left', // Align left to be over the input box, not the unit
    paddingLeft: 8, // Add padding to align with input box
  },
  setHeaderReps: {
    flex: 1,
    marginLeft: 4, // Match inputColumn marginLeft
    textAlign: 'center',
  },
  setHeaderRest: {
    width: 56, // Match restButton width exactly
    marginLeft: 4,
    textAlign: 'center',
  },
  setHeaderRir: {
    width: 32, // Match rirButton width exactly
    marginLeft: 4,
    textAlign: 'center',
  },
  setRowContainer: {
    marginBottom: 8,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'flex-start', // Align all elements to the top
  },
  checkboxContainer: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: '#C7C7CC',
    backgroundColor: '#0E1A1A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
    marginTop: 8, // Center checkbox vertically with 32px set number circle
  },
  checkboxContainerChecked: {
    backgroundColor: '#FF9B7A',
    borderColor: '#FF9B7A',
  },
  checkboxCheck: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#fff',
  },
  setNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#141E1E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  setNumberText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9AA3A6',
  },
  completedText: {
    color: '#525252',
    textDecorationLine: 'line-through',
  },
  completedInput: {
    backgroundColor: '#141E1E',
    borderColor: '#1F2A2A',
  },
  completedWeightContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputColumn: {
    flex: 1,
    marginLeft: 4,
  },
  weightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weightInput: {
    flex: 1,
    height: 32,
    backgroundColor: '#0E1A1A',
    borderRadius: 6,
    paddingHorizontal: 8,
    fontSize: 14,
    lineHeight: 18,
    color: '#F2F2EE',
    borderWidth: 1,
    borderColor: '#2A3638',
    ...Platform.select({
      android: {
        includeFontPadding: false,
        textAlignVertical: 'center',
        paddingVertical: 0,
      },
    }),
  },
  unitToggle: {
    marginLeft: 2,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: '#141E1E',
    borderRadius: 4,
  },
  unitToggleText: {
    fontSize: 10,
    color: '#F47C3C',
    fontWeight: '600',
  },
  repsButton: {
    height: 32,
    backgroundColor: '#0E1A1A',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  repsButtonText: {
    fontSize: 12,
    color: '#F2F2EE',
    fontWeight: '500',
  },
  pickerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  pickerPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: '#0E1A1A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2A3638',
    paddingTop: 8,
    paddingBottom: 4,
    maxHeight: 320,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 12,
  },
  pickerHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3A484A',
    marginBottom: 6,
  },
  pickerTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9AA3A6',
    textAlign: 'center',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pickerScroll: {
    flexGrow: 0,
  },
  pickerItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A3638',
  },
  pickerItemText: {
    fontSize: 16,
    color: '#F2F2EE',
    textAlign: 'center',
  },
  restButton: {
    width: 56,
    height: 32,
    backgroundColor: '#0E1A1A',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  restButtonText: {
    fontSize: 12,
    color: '#9AA3A6',
  },
  rirButton: {
    width: 32,
    height: 32,
    backgroundColor: '#0E1A1A',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  rirButtonText: {
    fontSize: 14,
    color: '#9AA3A6',
    fontWeight: '500',
  },
  extraFields: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
  },
  difficultyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  extraLabel: {
    fontSize: 14,
    color: '#9AA3A6',
    marginRight: 12,
  },
  difficultyStars: {
    flexDirection: 'row',
    gap: 4,
  },
  star: {
    fontSize: 24,
    color: '#E5E5EA',
  },
  starFilled: {
    color: '#FFD700',
  },
  commentsInput: {
    backgroundColor: '#0E1A1A',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#F2F2EE',
    minHeight: 60,
    maxHeight: 176,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  addSetButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderStyle: 'dashed',
  },
  addSetButtonText: {
    fontSize: 14,
    color: '#9AA3A6',
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#0E1A1A',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
  },
  deleteButton: {
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#2A3638',
    borderWidth: 1,
    borderColor: '#C65B5B',
  },
  deleteButtonText: {
    fontSize: 16,
    color: '#C65B5B',
    fontWeight: '600',
  },
  headerDeleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#2A3638',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C65B5B',
  },
  headerDeleteButtonText: {
    fontSize: 14,
    color: '#C65B5B',
    fontWeight: '600',
  },
  footerLogButton: {
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#F47C3C',
  },
  footerLogButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  lastWorkoutText: {
    fontSize: 10,
    color: '#8E8E93',
    fontStyle: 'italic',
    marginTop: 2,
    textAlign: 'center',
  },
  addExerciseButton: {
    marginTop: 16,
    marginBottom: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A3638',
    borderStyle: 'dashed',
    backgroundColor: '#0E1A1A',
  },
  addExerciseButtonText: {
    fontSize: 15,
    color: '#8E8E93',
    fontWeight: '500',
  },
  // Tutorial Styles
  tutorialOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11, 17, 20, 0.95)',
    zIndex: 1000,
  },
  tutorialScrollView: {
    flex: 1,
  },
  tutorialScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  tutorialImageContainer: {
    width: '100%',
    height: 220,
    overflow: 'hidden',
    position: 'relative',
  },
  tutorialImage: {
    width: '100%',
    height: '100%',
  },
  tutorialImageGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
    backgroundColor: 'transparent',
    // Simulated gradient via layered shadow
    borderTopWidth: 0,
  },
  tutorialContent: {
    paddingHorizontal: 28,
    paddingTop: 24,
  },
  tutorialTitle: {
    color: '#F2F2EE',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 28,
    letterSpacing: 0.3,
  },
  tutorialTipRow: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    marginBottom: 20,
    gap: 14,
  },
  tutorialTipIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1A2A2D',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: '#2A3638',
    flexShrink: 0,
  },
  tutorialTipIconText: {
    color: '#F2F2EE',
    fontSize: 16,
    fontWeight: '600',
  },
  tutorialTipIconCheck: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    borderColor: 'rgba(76, 175, 80, 0.3)',
  },
  tutorialTipIconCheckText: {
    color: '#4CAF50',
    fontSize: 18,
    fontWeight: '700',
  },
  tutorialTipIconVideo: {
    backgroundColor: 'rgba(91, 155, 213, 0.15)',
    borderColor: 'rgba(91, 155, 213, 0.3)',
  },
  tutorialTipIconSubstitute: {
    backgroundColor: 'rgba(244, 124, 60, 0.15)',
    borderColor: 'rgba(244, 124, 60, 0.3)',
  },
  tutorialTipText: {
    color: '#C5C9C7',
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  tutorialGotItButton: {
    alignSelf: 'center' as const,
    backgroundColor: '#F47C3C',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 14,
    marginTop: 16,
  },
  tutorialGotItButtonText: {
    color: '#0B1114',
    fontWeight: '700',
    fontSize: 17,
    letterSpacing: 0.3,
  },
  // Section (Warm-up / Cooldown) Styles
  sectionCard: {
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sectionCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#9AA3A6',
    backgroundColor: '#0E1A1A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sectionCheckboxChecked: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  sectionCheckboxCheck: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fff',
  },
  sectionHeaderContent: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  sectionTitleChecked: {
    color: '#525252',
    textDecorationLine: 'line-through',
  },
  sectionBody: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 0,
  },
  sectionBodyText: {
    fontSize: 14,
    color: '#9AA3A6',
    lineHeight: 20,
  },
  sectionBodyTextChecked: {
    color: '#525252',
    textDecorationLine: 'line-through',
  },
  // Workout Section Header
  workoutSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  workoutSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F2F2EE',
    flex: 1,
  },
  workoutSectionMeta: {
    fontSize: 13,
    color: '#9AA3A6',
    marginRight: 8,
  },
  // Rest Timer Styles
  timerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerModal: {
    backgroundColor: '#0E1A1A',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: 280,
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  timerLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9AA3A6',
    marginBottom: 24,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  timerCircleContainer: {
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  timerCircleBg: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 6,
    borderColor: '#2A3638',
  },
  timerCircleProgress: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 6,
    borderColor: '#F47C3C',
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
  },
  timerText: {
    fontSize: 48,
    fontWeight: '700',
    color: '#F2F2EE',
    fontVariant: ['tabular-nums'],
  },
  timerTotalText: {
    fontSize: 14,
    color: '#9AA3A6',
    marginBottom: 24,
  },
  timerSkipButton: {
    paddingVertical: 14,
    paddingHorizontal: 48,
    backgroundColor: '#2A3638',
    borderRadius: 12,
  },
  timerSkipText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  timerForgeEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  timerForgeTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F47C3C',
    marginBottom: 28,
  },
  timerForgeButton: {
    paddingVertical: 16,
    paddingHorizontal: 52,
    backgroundColor: '#F47C3C',
    borderRadius: 14,
  },
  timerForgeButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0B1114',
  },
  // Confirmation Modal Styles
  confirmationOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmationModal: {
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  confirmationTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 16,
  },
  confirmationSummary: {
    backgroundColor: '#1A2628',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  confirmationSummaryText: {
    fontSize: 15,
    color: '#F2F2EE',
    fontWeight: '600',
  },
  confirmationWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 200, 66, 0.1)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  confirmationWarningText: {
    fontSize: 13,
    color: '#F5C842',
    flex: 1,
  },
  confirmationWarningProminent: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 200, 66, 0.15)',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#F5C842',
    padding: 14,
    marginBottom: 14,
    gap: 12,
  },
  confirmationWarningTextProminent: {
    fontSize: 15,
    color: '#F5C842',
    fontWeight: '700',
    flex: 1,
  },
  confirmationDescription: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 20,
  },
  confirmationButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  confirmationCancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2A3638',
    alignItems: 'center',
  },
  confirmationCancelText: {
    fontSize: 15,
    color: '#F2F2EE',
    fontWeight: '600',
  },
  confirmationLogButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#F47C3C',
    alignItems: 'center',
  },
  confirmationLogText: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  // Success Modal Styles
  successOverlay: {
    flex: 1,
    backgroundColor: '#0E1A1A',
  },
  successModal: {
    backgroundColor: '#0E1A1A',
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  successScroll: {
    flex: 1,
  },
  successScrollContent: {
    paddingBottom: 8,
  },
  successImageWrap: {
    width: '100%',
    height: 300,
  },
  successImage: {
    width: '100%',
    height: 300,
  },
  successImageFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 120,
  },
  successContent: {
    paddingHorizontal: 24,
    paddingTop: 6,
    paddingBottom: 16,
    alignItems: 'center',
  },
  successStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 22,
    rowGap: 10,
    marginTop: 6,
    marginBottom: 4,
  },
  successStat: {
    alignItems: 'center',
    minWidth: 56,
  },
  successStatValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F2F2EE',
  },
  successStatLabel: {
    fontSize: 11,
    color: '#6F7A7E',
    marginTop: 2,
  },
  successEquivalentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(244, 124, 60, 0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244, 124, 60, 0.28)',
  },
  successEquivalentEmoji: {
    fontSize: 24,
  },
  successEquivalentText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#F2F2EE',
    textAlign: 'center',
  },
  successPrRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  successPrChip: {
    backgroundColor: 'rgba(244, 124, 60, 0.14)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  successPrText: {
    fontSize: 12,
    color: '#F4A06A',
    fontWeight: '600',
  },
  successSection: {
    width: '100%',
    marginTop: 18,
  },
  successFooter: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2A3638',
    backgroundColor: '#0E1A1A',
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F2F2EE',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  successMessage: {
    fontSize: 16,
    color: '#9AA3A6',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
  },
  successHighlight: {
    color: '#F47C3C',
    fontWeight: '700',
  },
  successMuscleMap: {
    width: '100%',
    marginBottom: 24,
  },
  successButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 14,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  successButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  successSecondaryButton: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  successSecondaryButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6F7A7E',
    letterSpacing: 0.2,
  },
  streakBanner: {
    marginTop: 16,
    alignSelf: 'center',
  },
  streakBannerText: {
    fontSize: 14,
    color: '#9AA3A6',
    letterSpacing: 0.2,
  },
});

export default WorkoutLogModal;

