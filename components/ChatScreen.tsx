import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Animated,
  BackHandler,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { coachImages } from '../assets/images/coaches';
import { Typography } from '../constants/Typography';
import { openCamera, openImageGallery } from '../lib/camera-helper';
import { checking_progress_this_week, CheckinProgress } from '../lib/checkin_helper';
import { calculateWeeklyConsistency, didCrossConsistencyThreshold } from '../lib/consistency-helper';
import { refreshConsistencyScoreAfterLog } from '../lib/leaderboard-storage';
import { addConversationEntry, chatEvents, clearAllChatHistory, initializeConversationDB, saveChatMessage, syncAndLoadChatHistory } from '../lib/conversation-storage';
import { deleteLoggedInUser, getActiveLoggedInUser, getCurrentLoggedInUser, setUserSeenIntroTutorial } from '../lib/db';
import { notifyCoachOfUserMessage } from '../lib/email-notification';
import { analyzeFoodImage, analyzeFoodText, FoodAnalysis, updateFoodAnalysisWithCorrection } from '../lib/food-vision-service';
import { glowLogger } from '../lib/glow-logger';
import { classifyPlanEditFollowUp, classifyUserIntent, generatePlanEditConfirmation, resolveContextualPlanEditRequest, STEP_NAMES } from '../lib/intent-classifier';
import { llmService } from '../lib/llm-service';
import { getUserNutritionTargets, MealLog, NutritionTargets, saveMealLog } from '../lib/nutrition-storage';
import { onboardingEvents } from '../lib/supabase_db';
import { resolveCoachConfig } from '../lib/coach-config';
import { getCoachEmailById, getCoachEmailForUser, getCoachIdForUser, getCoachTypeById, getRemoteUserProfileLoggedInUser } from '../lib/supabase_db_new';
import { fetchUserDataSnapshot } from '../lib/user-data-snapshot';
import { generateWorkoutResponse, parseActivityFromDescription, WorkoutConversationEntry } from '../lib/workout-intent-service';
import { getExerciseHistory } from '../lib/workout-storage';
import { harmonizeExerciseIdsWithCatalog } from '../lib/exercise-harmonization';
import { ConsistencyCelebrationModal } from './ConsistencyCelebrationModal';
import { MarkdownText } from './MarkdownText';

import { appIcons } from '../assets/icons';
import { CoachType, Onboard } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import ChatMessageBox from './ChatMessageBox'; // NEW
import CheckinDay from './CheckinDay';
import CoachDashboard from './CoachDashboard'; // NEW
import CoachDetailsModal from './CoachDetailsModal';
import { CommunityScreen } from './CommunityScreen';
import { DeveloperCoachEditPlan } from './DeveloperCoachEditPlan';
import { DeveloperMode } from './DeveloperMode';
import { EditPlanModal } from './EditPlanModal';
import { HamburgerButton } from './HamburgerButton';
import { HamburgerMenu } from './HamburgerMenu';
import { Icon } from './Icon';
import { LogDateSelector } from './LogDateSelector';
import MacrosChart from './MacrosChart';
import { MealQuantityEditor } from './MealQuantityEditor';
import { PlanView } from './PlanView';
import { ProgressScreen } from './ProgressScreen';
import { WorkoutSummaryCard } from './WorkoutSummaryCard';


interface ChatScreenProps {
  onboardingData: Onboard;
  onLogout?: () => void;
  pendingNotificationMessage?: { body: string, sender?: 'ai_coach' | 'human_coach', render_screen?: string } | null; // CHANGED
  onNotificationMessageProcessed?: () => void;
  shouldGenerateWelcome?: boolean;
  onWelcomeGenerated?: () => void;
  onBackToHome?: (options?: { scrollToSection?: 'nutrition' | 'recentMeals'; showStreak?: boolean }) => void;
  pendingMealImage?: string | null;
  pendingRelogMeal?: MealLog | null;
  onRelogMealProcessed?: () => void;
  /** Fired after a meal is successfully logged from chat, so parent can refresh dashboards/lists. */
  onMealLogged?: () => void;
  onMealImageProcessed?: () => void;
  prefilledMessage?: string | null;
  onPrefilledMessageProcessed?: () => void;
  onOpenMealLogModal?: () => void;
  onOpenWorkoutLogFromChat?: (workoutData: import('../types/workout').WorkoutDayOption) => void;
  onOpenActivityLogFromChat?: (prefill?: {
    activityType?: string;
    activityName?: string;
    durationMinutes?: number;
    intensity?: string;
    distanceValue?: number;
    distanceUnit?: string;
    elevationGain?: number;
    notes?: string;
    activityDate?: string;
  } | null) => void;
  onSaveWorkoutToPlan?: (workoutData: import('../types/workout').WorkoutDayOption) => void;
  /** Developer: preview weekly check-in (parent owns modal). */
  onDebugCreateWeeklyReport?: () => void;
  /** One-shot coach system-prompt context from weekly check-in (consumed on first AI reply). */
  weeklyReportChatContext?: string | null;
  onWeeklyReportChatContextConsumed?: () => void;
  /** After accepting plan edits in chat, open Plan tab on the edited pillar's details screen. */
  onNavigateToPlanDetails?: (stepIndex: number) => void;
}

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai_coach' | 'human_coach';
  timestamp: Date;
  isLoading?: boolean;
  imageUri?: string;
  mealAnalysis?: FoodAnalysis;
  /** Coach analysis bubble was successfully saved as a meal log — shows macros + Log again. */
  isMealAnalysisLogged?: boolean;
  /** Success bubble after confirming a meal log — shows the daily progress link. */
  isMealLoggedSuccess?: boolean;
  /** Failure bubble after a meal operation — shows a Retry button. */
  isMealLogFailed?: boolean;
  mealFailureKind?: 'save' | 'analyze_image' | 'analyze_text';
  /** The analysis to retry when mealFailureKind is 'save'. */
  mealAnalysisForRetry?: FoodAnalysis;
  /** Image URI to retry when mealFailureKind is 'analyze_image'. */
  mealImageRetryUri?: string;
  mealImageRetryComments?: string;
  /** Food description to retry when mealFailureKind is 'analyze_text'. */
  mealTextRetry?: string;
  workoutData?: import('../types/workout').WorkoutDayOption;
  isWorkoutProposal?: boolean;
}

/** Delimiter so we can strip meal follow-up prompts without relying on fragile per-locale regex. */
const MEAL_COACH_SUFFIX_MARK = '\n\n\u200BUF_MEAL_COACH_SUFFIX\u200B\n\n';

function stripMealCoachSuffix(text: string): string {
  return text
    .replace(/\n\n\u200BUF_MEAL_COACH_SUFFIX\u200B\n\n[\s\S]*$/u, '')
    .replace(/\n\nDo you have any corrections or clarifications\?[\s\S]*$/s, '')
    .replace(/\n\nAny corrections\?[\s\S]*$/s, '')
    .replace(/\n\nAsk for corrections or log below\.[\s\S]*$/s, '')
    .replace(/\n\n¿Tienes correcciones o aclaraciones\?[\s\S]*$/s, '')
    .replace(/\n\n¿Alguna corrección\?[\s\S]*$/s, '')
    .replace(/\n\nPide correcciones o registra abajo\.[\s\S]*$/s, '');
}

function withMealCoachSuffix(description: string, suffix: string): string {
  return `${description}${MEAL_COACH_SUFFIX_MARK}${suffix}`;
}

/**
 * Render-time cleanup: the delimiter token is plain visible text (only the
 * surrounding chars are zero-width), so it must be removed before display while
 * keeping the follow-up corrections prompt that comes after it.
 */
function hideMealCoachSuffixMark(text: string): string {
  return text.replace(/\n\n\u200BUF_MEAL_COACH_SUFFIX\u200B\n\n/gu, '\n\n');
}

export default function ChatScreen({
  onboardingData, 
  onLogout, 
  pendingNotificationMessage,
  onNotificationMessageProcessed,
  shouldGenerateWelcome,
  onWelcomeGenerated,
  onBackToHome,
  pendingMealImage,
  pendingRelogMeal,
  onRelogMealProcessed,
  onMealLogged,
  onMealImageProcessed,
  prefilledMessage,
  onPrefilledMessageProcessed,
  onOpenMealLogModal,
  onOpenWorkoutLogFromChat,
  onOpenActivityLogFromChat,
  onSaveWorkoutToPlan,
  onDebugCreateWeeklyReport,
  weeklyReportChatContext,
  onWeeklyReportChatContextConsumed,
  onNavigateToPlanDetails,
}: ChatScreenProps) {
  const { t, i18n } = useTranslation(['chat', 'common', 'home', 'workout', 'main', 'progress']);
  const [localOnboardingData, setLocalOnboardingData] = useState<Onboard>(onboardingData);
  const [messages, setMessages] = useState<Message[]>([]);
  const [consistencyScore, setConsistencyScore] = useState(0);
  const [showConsistencyModal, setShowConsistencyModal] = useState(false);
  const [isCoachTyping, setIsCoachTyping] = useState(false);
  const insets = useSafeAreaInsets();
  const sheetBottomPadding = Math.max(24, insets.bottom + 16);
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [showCoachDetails, setShowCoachDetails] = useState(false);
  const [showPlanView, setShowPlanView] = useState(false);
  const [showCheckinDay, setShowCheckinDay] = useState(false);
  const [showDeveloperMode, setShowDeveloperMode] = useState(false);
  const [showOnboardData, setShowOnboardData] = useState(false);
  const [showEditPlanFromChat, setShowEditPlanFromChat] = useState(false);
  const [editPlanChatStepIndex, setEditPlanChatStepIndex] = useState<number | undefined>(undefined);
  const [editPlanChatFeedback, setEditPlanChatFeedback] = useState<string | undefined>(undefined);

  type PendingPlanEditData = { stepIndex: number | null; feedback: string[] };
  const pendingPlanEditRef = useRef<PendingPlanEditData | null>(null);
  const weeklyReportCoachContextRef = useRef<string | null>(null);
  /** Proceed/Cancel target; kept in React state so sync/reload replacing `messages` does not drop it. */
  const [planEditConfirmationMessageId, setPlanEditConfirmationMessageId] = useState<string | null>(null);
  const setPendingPlanEdit = (value: PendingPlanEditData | null) => {
    pendingPlanEditRef.current = value;
    if (value === null) {
      setPlanEditConfirmationMessageId(null);
    }
  };
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [planProgress, setPlanProgress] = useState(0.4); // 0–1 progress; placeholder
  const [activeTab, setActiveTab] = useState<'home' | 'plan' | 'progress' | 'games'>('home');
  const [shouldShowStreak, setShouldShowStreak] = useState(false);
  const [checkinProgress, setCheckinProgress] = useState<CheckinProgress | null>(null);
  const [coachMode, setCoachMode] = useState<'human' | 'ai'>('ai'); // Default to AI mode
  // Live coach_type from the `coaches` table — the source of truth for human-chat
  // gating. We never trust the snapshot stored in onboardingData (it can be stale
  // for users who onboarded before coach_type existed, which is why AI-only coaches
  // like Manu were wrongly showing human chat). Defaults to null until fetched.
  const [liveCoachType, setLiveCoachType] = useState<CoachType | null>(null);
  const [showIntroOverlay, setShowIntroOverlay] = useState(false);
  const [pendingMealAnalysis, setPendingMealAnalysis] = useState<FoodAnalysis | null>(null);
  const [editedMealAnalysis, setEditedMealAnalysis] = useState<FoodAnalysis | null>(null);
  const [isConfirmingMeal, setIsConfirmingMeal] = useState(false);
  const [mealSaveError, setMealSaveError] = useState<string | null>(null);
  const [mealLogDate, setMealLogDate] = useState<string>(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  });
  const [isMealLogOptionsModalVisible, setIsMealLogOptionsModalVisible] = useState(false);
  const [isMealCommentsModalVisible, setIsMealCommentsModalVisible] = useState(false);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [mealComments, setMealComments] = useState<string>('');
  const [tempPrefilledMessage, setTempPrefilledMessage] = useState<string>('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [chatLoadError, setChatLoadError] = useState<string | null>(null);
  const [isRetryingChatLoad, setIsRetryingChatLoad] = useState(false);
  const [messageSyncStatus, setMessageSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'failed'>('idle');
  const [isRetryingMessageSync, setIsRetryingMessageSync] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserDisplayName, setCurrentUserDisplayName] = useState<string | null>(null);
  const [nutritionTargets, setNutritionTargets] = useState<NutritionTargets | null>(null);
  
  // Pagination state for chat messages
  const [messageOffset, setMessageOffset] = useState<number>(0);
  const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const MESSAGES_PER_PAGE = 20;

  const scrollViewRef = useRef<ScrollView>(null);
  const bottomSheetAnim = useRef(new Animated.Value(0)).current;
  const pendingCheckinOpenRef = useRef(false); // NEW: prevent duplicate opens
  const latestMealAnalysisRef = useRef<FoodAnalysis | null>(null); // Store latest meal analysis to avoid state update issues
  // Guards against duplicate logging when the user taps "Log This Meal" multiple
  // times before the async save resolves (which would double-count calories/macros).
  const isConfirmingMealRef = useRef(false);
  /** Coach message id for the active pending meal flow (relog / image / text). Confirm must update this row, not `lastMealMsgId` (which can be a newer unrelated meal bubble). */
  const pendingMealCoachMessageIdRef = useRef<string | null>(null);
  const mealAnalysisMapRef = useRef<Map<string, FoodAnalysis>>(new Map()); // Persist meal analysis by message ID across DB reloads
  const allSyncedMessagesRef = useRef<Message[]>([]); // Store all synced messages for pagination

  const lastMealMsgId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].mealAnalysis || mealAnalysisMapRef.current.has(messages[i].id)) return messages[i].id;
    }
    return null;
  }, [messages]);

  const activeMealCoachMessageId = pendingMealCoachMessageIdRef.current ?? lastMealMsgId;

  /** Debug: trace pending-meal qty edits vs chart (`editedMealAnalysis || pendingMealAnalysis`). */
  const onPendingMealQtyAnalysisChange = useCallback((updated: FoodAnalysis) => {
    glowLogger.info('nutrition.meal_qty_editor_propagate', {
      carbs: updated.carbs,
      protein: updated.protein,
      fat: updated.fat,
      fiber: updated.fiber,
      calories: updated.calories,
      food_quantities_preview: (updated.foodQuantities || '').slice(0, 160),
    });
    setEditedMealAnalysis(updated);
  }, []);

  // Embed nutrition data as a hidden marker appended to the saved message text so
  // it survives DB round-trips, app restarts, and component remounts.
  const MEAL_NUTRITION_START = '\n[[NUTRITION:';
  const MEAL_NUTRITION_END = ']]';

  const foodAnalysisToCompactEmbed = (analysis: FoodAnalysis): Record<string, unknown> => {
    const data: Record<string, unknown> = {
      c: Math.ceil(analysis.carbs),
      p: Math.ceil(analysis.protein),
      f: Math.ceil(analysis.fat),
      fb: Math.ceil(analysis.fiber),
      cal: Math.ceil(analysis.calories),
    };
    if (analysis.foodQuantities) data.fq = analysis.foodQuantities;
    if (analysis.foodItemMacros) data.fim = analysis.foodItemMacros;
    if (analysis.shortDescription) data.sd = analysis.shortDescription;
    if (analysis.description) data.d = analysis.description;
    return data;
  };

  const compactEmbedToFoodAnalysis = (data: Record<string, unknown>): FoodAnalysis => ({
    description: String(data.d || data.sd || ''),
    shortDescription: String(data.sd || data.d || ''),
    foodQuantities: String(data.fq || ''),
    foodItemMacros: data.fim as FoodAnalysis['foodItemMacros'],
    carbs: Number(data.c),
    protein: Number(data.p),
    fat: Number(data.f),
    fiber: Number(data.fb),
    calories: Number(data.cal),
  });

  const embedMealNutrition = (text: string, analysis: FoodAnalysis): string => {
    return `${text}${MEAL_NUTRITION_START}${JSON.stringify(foodAnalysisToCompactEmbed(analysis))}${MEAL_NUTRITION_END}`;
  };

  const extractMealNutrition = (text: string): { cleanText: string; analysis: FoodAnalysis | null } => {
    const startIdx = text.indexOf(MEAL_NUTRITION_START);
    if (startIdx === -1) return { cleanText: text, analysis: null };
    const endIdx = text.indexOf(MEAL_NUTRITION_END, startIdx + MEAL_NUTRITION_START.length);
    if (endIdx === -1) return { cleanText: text, analysis: null };
    const jsonStr = text.slice(startIdx + MEAL_NUTRITION_START.length, endIdx);
    try {
      const data = JSON.parse(jsonStr) as Record<string, unknown>;
      return {
        cleanText: text.slice(0, startIdx),
        analysis: compactEmbedToFoodAnalysis(data),
      };
    } catch {
      return { cleanText: text, analysis: null };
    }
  };

  const MEAL_SUCCESS_RELOG_START = '\n[[MEAL_SUCCESS_RELOG:';
  const MEAL_SUCCESS_RELOG_END = ']]';

  const embedMealSuccessRelog = (text: string, analysis: FoodAnalysis): string => {
    return `${text}${MEAL_SUCCESS_RELOG_START}${JSON.stringify(foodAnalysisToCompactEmbed(analysis))}${MEAL_SUCCESS_RELOG_END}`;
  };

  const extractMealSuccessRelog = (text: string): { cleanText: string; analysis: FoodAnalysis | null } => {
    const startIdx = text.indexOf(MEAL_SUCCESS_RELOG_START);
    if (startIdx === -1) return { cleanText: text, analysis: null };
    const endIdx = text.indexOf(MEAL_SUCCESS_RELOG_END, startIdx + MEAL_SUCCESS_RELOG_START.length);
    if (endIdx === -1) return { cleanText: text, analysis: null };
    const jsonStr = text.slice(startIdx + MEAL_SUCCESS_RELOG_START.length, endIdx);
    try {
      const data = JSON.parse(jsonStr) as Record<string, unknown>;
      return {
        cleanText: text.slice(0, startIdx),
        analysis: compactEmbedToFoodAnalysis(data),
      };
    } catch {
      return { cleanText: text, analysis: null };
    }
  };

  const MEAL_LOGGED_SUCCESS_TEXTS = new Set([
    'Meal logged! 🎉',
    'Logged!',
    'Great! Your meal has been logged successfully. 🎉',
    '¡Comida registrada! 🎉',
    '¡Registrado!',
    '¡Listo! Tu comida se registró correctamente. 🎉',
  ]);

  const isMealLoggedSuccessText = (text: string): boolean =>
    MEAL_LOGGED_SUCCESS_TEXTS.has(text) || text === t('chat:mealLoggedSuccess');

  const getMessageDisplayText = (message: Message): string => {
    if (message.isMealLoggedSuccess || isMealLoggedSuccessText(message.text)) {
      return t('chat:mealLoggedSuccess');
    }
    return hideMealCoachSuffixMark(message.text);
  };

  const WORKOUT_DATA_START = '\n[[WORKOUT:';
  const WORKOUT_DATA_END = ']]';

  const embedWorkoutData = (text: string, workout: import('../types/workout').WorkoutDayOption, isProposal?: boolean): string => {
    const data: Record<string, any> = {
      sId: workout.stepId,
      dn: workout.dayName,
      dt: workout.dayType,
      ex: workout.exercises.map(e => {
        const mapped: Record<string, any> = {
          id: e.exerciseId,
          n: e.name,
          s: e.sets,
          r: e.reps,
          rt: e.restTimeSeconds,
          nt: e.notes,
        };
        if (e.alternatives && e.alternatives.length > 0) {
          mapped.al = e.alternatives.map(a => ({ id: a.exerciseId, n: a.name }));
        }
        return mapped;
      }),
      ip: isProposal ? 1 : 0,
    };
    if (workout.warmup) data.wu = workout.warmup;
    if (workout.cooldown) data.cd = workout.cooldown;
    return `${text}${WORKOUT_DATA_START}${JSON.stringify(data)}${WORKOUT_DATA_END}`;
  };

  const extractWorkoutData = (text: string): { cleanText: string; workout: import('../types/workout').WorkoutDayOption | null; isProposal: boolean } => {
    const startIdx = text.indexOf(WORKOUT_DATA_START);
    if (startIdx === -1) return { cleanText: text, workout: null, isProposal: false };
    const endIdx = text.indexOf(WORKOUT_DATA_END, startIdx + WORKOUT_DATA_START.length);
    if (endIdx === -1) return { cleanText: text, workout: null, isProposal: false };
    const jsonStr = text.slice(startIdx + WORKOUT_DATA_START.length, endIdx);
    try {
      const data = JSON.parse(jsonStr);
      return {
        cleanText: text.slice(0, startIdx),
        workout: {
          stepId: data.sId,
          dayName: data.dn,
          dayType: data.dt,
          exercises: (data.ex || []).map((e: any) => ({
            exerciseId:
              e.id ||
              `custom_${(e.n || '').toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
            name: e.n,
            sets: e.s,
            reps: e.r,
            restTimeSeconds: e.rt,
            notes: e.nt,
            ...(e.al && e.al.length > 0 ? { alternatives: e.al.map((a: any) => ({ exerciseId: a.id || `custom_${(a.n || '').toLowerCase().replace(/[^a-z0-9]/g, '_')}`, name: a.n })) } : {}),
          })),
          warmup: data.wu,
          cooldown: data.cd,
        },
        isProposal: data.ip === 1,
      };
    } catch {
      return { cleanText: text, workout: null, isProposal: false };
    }
  };

  const parseRawMessage = (msg: { id: string; text: string; sender: string; timestamp: Date | string; imageUri?: string }): Message => {
    const { cleanText: textAfterRelog, analysis: relogAnalysis } = extractMealSuccessRelog(msg.text);
    const { cleanText: textAfterNutrition, analysis } = extractMealNutrition(textAfterRelog);
    const { cleanText, workout, isProposal } = extractWorkoutData(textAfterNutrition);
    const message: Message = {
      id: msg.id,
      text: cleanText,
      sender: msg.sender as 'user' | 'ai_coach' | 'human_coach',
      timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp as string),
    };
    if (msg.imageUri) message.imageUri = msg.imageUri;
    if (relogAnalysis) {
      message.isMealAnalysisLogged = true;
    }
    if (isMealLoggedSuccessText(cleanText)) {
      message.isMealLoggedSuccess = true;
    }
    if (analysis) {
      message.mealAnalysis = analysis;
      mealAnalysisMapRef.current.set(msg.id, analysis);
    }
    if (workout) {
      message.workoutData = workout;
      message.isWorkoutProposal = isProposal;
    }
    return message;
  };
  const previousMessageCountRef = useRef<number>(0); // Track message count to detect new messages vs loading old ones
  const scrollPositionRef = useRef<{ y: number; contentHeight: number } | null>(null); // Track scroll position before loading

  useEffect(() => {
    // Initialize database and load chat history when component mounts
    initializeChatAndLoadHistory();
     
  }, []);

  // Handle pending notification message from app startup
  useEffect(() => {
    if (
      pendingNotificationMessage &&
      pendingNotificationMessage.body &&
      messages.length > 0
    ) {
      // NEW: check render_screen before clearing
      if (pendingNotificationMessage.render_screen === 'checkin_daily') {
        glowLogger.info('Pending notification (app open) requests daily check-in screen', {
          render_screen: pendingNotificationMessage.render_screen,
          already_showing_checkin: showCheckinDay
        });
        openDailyCheckinModalFromNotification();
      }

      glowLogger.info('Processing pending notification message from app startup', {
        message: pendingNotificationMessage.body,
        sender: pendingNotificationMessage.sender,
        user_name: onboardingData.name
      });

      addNotificationAsCoachMessage(
        pendingNotificationMessage.body,
        pendingNotificationMessage.sender
      );

      // Clear AFTER modal logic
      if (onNotificationMessageProcessed) {
        onNotificationMessageProcessed();
      }
    }
  }, [
    pendingNotificationMessage,
    messages.length,
    onboardingData.name,
    showCheckinDay // NEW dep so effect knows if modal already showing
  ]);

  // NEW: fallback effect if body was empty but render_screen requested checkin (defensive)
  useEffect(() => {
    if (
      pendingNotificationMessage &&
      !pendingNotificationMessage.body &&
      pendingNotificationMessage.render_screen === 'checkin_daily' &&
      !showCheckinDay
    ) {
      glowLogger.info('Pending notification without body but with checkin_daily render_screen - opening modal', {});
      openDailyCheckinModalFromNotification();
      if (onNotificationMessageProcessed) {
        onNotificationMessageProcessed();
      }
    }
  }, [pendingNotificationMessage?.render_screen, pendingNotificationMessage?.body, showCheckinDay]);

  // Fetch the live coach_type from the `coaches` table. This is the source of
  // truth for whether human chat is available — not the stored snapshot. Prefer
  // the coachId on the profile; for older profiles that lack it, resolve the
  // coach id from the coach_user table so the lookup still works.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let coachId = onboardingData.coachId ?? null;
      if (coachId == null && currentUserId) {
        coachId = await getCoachIdForUser(currentUserId);
      }
      if (coachId == null) {
        // No way to resolve the coach — fail closed (AI only).
        if (!cancelled) {
          setLiveCoachType(CoachType.AI_ONLY);
        }
        return;
      }
      const type = await getCoachTypeById(coachId);
      if (!cancelled) {
        setLiveCoachType(type);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onboardingData.coachId, currentUserId]);

  // Effective coach_type from the live `coaches` row. Fail closed to AI_ONLY until
  // the fetch resolves so human chat never flashes open for an unsupported coach.
  const effectiveCoachType: CoachType = liveCoachType ?? CoachType.AI_ONLY;

  // The coach the user selected at onboarding (stored snapshot + config catalog).
  // Used to keep human chat disabled even if a stale DB row or assignment is wrong.
  const selectedCoachIsAiOnly = useMemo(() => {
    const stored = onboardingData.coach_type;
    if (stored === CoachType.AI_ONLY || stored === 'AI_ONLY') {
      return true;
    }
    try {
      const config = require('../assets/onboarding_config');
      const configCoach = resolveCoachConfig(
        config.general_info.coach_selection,
        onboardingData.selectedCoach
      );
      return configCoach?.type === 'AI-only';
    } catch {
      return false;
    }
  }, [onboardingData.coach_type, onboardingData.selectedCoach]);

  const isHumanChatAvailable =
    effectiveCoachType === CoachType.AI_HUMAN_HYBRID && !selectedCoachIsAiOnly;

  // Ensure AI-only coaches stay in AI mode
  useEffect(() => {
    if (!isHumanChatAvailable && coachMode !== 'ai') {
      glowLogger.info('Forcing AI mode for AI-only coach', {
        coach_type: effectiveCoachType,
        selected_coach: onboardingData.selectedCoach,
        current_mode: coachMode
      });
      setCoachMode('ai');
    }
  }, [isHumanChatAvailable, effectiveCoachType, coachMode, onboardingData.selectedCoach]);

  // Handle pending meal image processing
  useEffect(() => {
    if (pendingMealImage && !pendingMealAnalysis) {
      // Show comments modal first, then process image
      setSelectedImageUri(pendingMealImage);
      setMealComments('');
      setIsMealCommentsModalVisible(true);
      // Clear pendingMealImage to prevent reprocessing
      if (onMealImageProcessed) {
        onMealImageProcessed();
      }
    }
  }, [pendingMealImage]);

  // Handle prefilled message
  useEffect(() => {
    if (prefilledMessage && onPrefilledMessageProcessed) {
      // Clear the prefilled message after it's been set
      onPrefilledMessageProcessed();
    }
  }, [prefilledMessage]);

  const injectMealRelogFlow = useCallback(async (analysis: FoodAnalysis) => {
    setPendingMealAnalysis(analysis);
    setEditedMealAnalysis(null);
    setMealSaveError(null);
    latestMealAnalysisRef.current = analysis;
    setCoachMode('ai');

    const displayDescription = analysis.shortDescription || analysis.description;
    const analysisMessage = withMealCoachSuffix(
      displayDescription,
      t('chat:mealAnalysisClarifyLong'),
    );

    const newMessage: Message = {
      id: Date.now().toString(),
      text: analysisMessage,
      sender: 'ai_coach',
      timestamp: new Date(),
      mealAnalysis: analysis,
    };
    mealAnalysisMapRef.current.set(newMessage.id, analysis);
    pendingMealCoachMessageIdRef.current = newMessage.id;
    setMessages(prev => [...prev, newMessage]);

    if (currentUserId) {
      await saveChatMessage({
        id: newMessage.id,
        text: embedMealNutrition(newMessage.text, analysis),
        sender: newMessage.sender,
        timestamp: newMessage.timestamp,
        userId: currentUserId,
        userDisplayName: onboardingData.name,
      });
    }
  }, [currentUserId, onboardingData.name, t]);

  // Handle re-logging a previous meal (skip LLM, inject stored analysis)
  useEffect(() => {
    if (!pendingRelogMeal) return;

    glowLogger.info('nutrition.meal_relog_inject', {
      meal_log_id: pendingRelogMeal.id,
      had_edited_meal_analysis_before: editedMealAnalysis != null,
      food_quantities_len: (pendingRelogMeal.foodQuantities || '').length,
      carbs: pendingRelogMeal.carbs,
      protein: pendingRelogMeal.protein,
      fat: pendingRelogMeal.fat,
      calories: pendingRelogMeal.calories,
    });

    const analysis: FoodAnalysis = {
      description: pendingRelogMeal.mealDescription,
      shortDescription: pendingRelogMeal.mealDescription,
      foodQuantities: pendingRelogMeal.foodQuantities || '',
      foodItemMacros: pendingRelogMeal.foodItemMacros,
      carbs: pendingRelogMeal.carbs,
      protein: pendingRelogMeal.protein,
      fat: pendingRelogMeal.fat,
      fiber: pendingRelogMeal.fiber,
      calories: pendingRelogMeal.calories,
    };

    void injectMealRelogFlow(analysis);
    onRelogMealProcessed?.();
    // Intentionally omit `editedMealAnalysis`: this effect must only run when `pendingRelogMeal`
    // changes; re-running on qty edits would duplicate the injected chat message.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot log only
  }, [pendingRelogMeal, injectMealRelogFlow, onRelogMealProcessed]);

  useEffect(() => {
    if (weeklyReportChatContext) {
      weeklyReportCoachContextRef.current = weeklyReportChatContext;
      onWeeklyReportChatContextConsumed?.();
    }
  }, [weeklyReportChatContext, onWeeklyReportChatContextConsumed]);

  const appendMealFailureMessage = (
    text: string,
    retry:
      | { kind: 'save'; analysis: FoodAnalysis }
      | { kind: 'analyze_image'; imageUri: string; userComments?: string }
      | { kind: 'analyze_text'; foodDescription: string },
  ) => {
    const failMsg: Message = {
      id: Date.now().toString(),
      text,
      sender: 'ai_coach',
      timestamp: new Date(),
      isMealLogFailed: true,
      mealFailureKind: retry.kind,
      ...(retry.kind === 'save' ? { mealAnalysisForRetry: retry.analysis } : {}),
      ...(retry.kind === 'analyze_image'
        ? { mealImageRetryUri: retry.imageUri, mealImageRetryComments: retry.userComments }
        : {}),
      ...(retry.kind === 'analyze_text' ? { mealTextRetry: retry.foodDescription } : {}),
    };
    setMessages(prev => [...prev, failMsg]);
  };

  const handleMealFailureRetry = (message: Message) => {
    if (message.mealFailureKind === 'save' && message.mealAnalysisForRetry) {
      void handleConfirmMeal(message.mealAnalysisForRetry);
      return;
    }
    if (message.mealFailureKind === 'analyze_image' && message.mealImageRetryUri) {
      void processMealImage(message.mealImageRetryUri, message.mealImageRetryComments, { skipPhotoMessage: true });
      return;
    }
    if (message.mealFailureKind === 'analyze_text' && message.mealTextRetry) {
      void processMealText(message.mealTextRetry);
    }
  };

  const processMealImage = async (
    imageUri: string,
    userComments?: string,
    options?: { skipPhotoMessage?: boolean },
  ) => {
    let permanentImageUri = imageUri;
    try {
      // Switch to AI coach mode for food analysis
      setCoachMode('ai');
      
      glowLogger.info('Processing meal image', { original_uri: imageUri });
      
      // Copy image to permanent storage to avoid cache clearing
      try {
        const FileSystem = require('expo-file-system');
        const imageId = Date.now().toString();
        const fileExtension = imageUri.split('.').pop()?.split('?')[0] || 'jpg';
        const newPath = `${FileSystem.documentDirectory}meal_${imageId}.${fileExtension}`;
        
        if (imageUri.startsWith('http://') || imageUri.startsWith('https://')) {
          // Download remote image (simulator test images)
          await FileSystem.downloadAsync(imageUri, newPath);
        } else {
          // Copy local image
          await FileSystem.copyAsync({ from: imageUri, to: newPath });
        }
        
        permanentImageUri = newPath;
        glowLogger.info('Image saved to permanent storage', { permanent_uri: permanentImageUri });
      } catch (error) {
        glowLogger.error('Failed to save image permanently', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        // Continue with original URI if copy fails
      }
      
      if (!options?.skipPhotoMessage) {
        // Show user's photo message with actual image and user comments if provided
        const photoText =
          userComments && userComments.trim()
            ? t('chat:mealPhotoCaptionWithQuote', { quote: userComments.trim() })
            : t('chat:mealPhotoCaption');
        const photoMessage: Message = {
          id: Date.now().toString(),
          text: photoText,
          sender: 'user',
          timestamp: new Date(),
          imageUri: permanentImageUri,
        };
        setMessages(prev => [...prev, photoMessage]);
        await saveChatMessage({
          id: photoMessage.id,
          text: photoMessage.text,
          sender: photoMessage.sender,
          timestamp: photoMessage.timestamp,
          userId: currentUserId!, // CRITICAL: Use user_id for unique identification
          userDisplayName: onboardingData.name,
          imageUri: permanentImageUri
        });
      }

      setIsCoachTyping(true);
      const analysis = await analyzeFoodImage(imageUri, userComments);
      setPendingMealAnalysis(analysis);
      setMealSaveError(null);
      latestMealAnalysisRef.current = analysis; // Store in ref for immediate access
      
      const analysisMessage = withMealCoachSuffix(
        analysis.description,
        t('chat:mealAnalysisClarifyShort'),
      );
      
      const newMessage: Message = {
        id: Date.now().toString(),
        text: analysisMessage,
        sender: 'ai_coach',
        timestamp: new Date(),
        mealAnalysis: analysis,
      };
      mealAnalysisMapRef.current.set(newMessage.id, analysis);
      pendingMealCoachMessageIdRef.current = newMessage.id;

      setMessages(prev => [...prev, newMessage]);
      await saveChatMessage({
        id: newMessage.id,
        text: embedMealNutrition(newMessage.text, analysis),
        sender: newMessage.sender,
        timestamp: newMessage.timestamp,
        userId: currentUserId!,
        userDisplayName: onboardingData.name
      });
      
      if (onMealImageProcessed) {
        onMealImageProcessed();
      }
    } catch (error) {
      glowLogger.error('Error processing meal image', { error });
      appendMealFailureMessage(t('chat:errorAnalyzeImage'), {
        kind: 'analyze_image',
        imageUri: permanentImageUri,
        userComments,
      });
      if (onMealImageProcessed) {
        onMealImageProcessed();
      }
      setPendingMealAnalysis(null);
      latestMealAnalysisRef.current = null; // Clear ref as well
      pendingMealCoachMessageIdRef.current = null;
    } finally {
      setIsCoachTyping(false);
    }
  };

  /**
   * Whether a workout card originated from the user's saved plan (vs. created ad-hoc in chat).
   * Chat-created workouts carry a `custom_chat_` / `proposed_chat_` stepId; anything else is a
   * real plan step. Plan-sourced workouts already belong to the plan, so we hide "Save to plan".
   */
  const isWorkoutFromPlan = (workout?: import('../types/workout').WorkoutDayOption): boolean => {
    const stepId = workout?.stepId ?? '';
    return stepId.length > 0 && !stepId.startsWith('custom_chat_') && !stepId.startsWith('proposed_chat_');
  };

  const formatChatHistory = (messagesList: Message[]): string[] => {
    const recent = messagesList.slice(-25);
    return recent.map(msg => {
      const prefix =
        msg.sender === 'user'
          ? t('chat:historyPrefixUser')
          : msg.sender === 'ai_coach'
            ? t('chat:historyPrefixAiCoach')
            : msg.sender === 'human_coach'
              ? t('chat:historyPrefixHumanCoach')
              : t('chat:historyPrefixCoach');

      const tags: string[] = [];
      if (msg.isWorkoutProposal && msg.workoutData) {
        const names = msg.workoutData.exercises.map(e => e.name).join(', ');
        tags.push(t('chat:historyTagWorkoutProposal', { names }));
      } else if (msg.workoutData) {
        const names = msg.workoutData.exercises.map(e => e.name).join(', ');
        tags.push(t('chat:historyTagLoggedWorkout', { names }));
      }
      if (msg.mealAnalysis) {
        tags.push(t('chat:historyTagMealLog'));
      }

      const annotation = tags.length ? ` [${tags.join('; ')}]` : '';
      return `${prefix}${annotation}: ${msg.text}`;
    });
  };

  /**
   * Collect the last 3 workout cards (logged OR proposed) and interleaved user
   * messages so the unified workout handler understands the full modification
   * chain — including corrections/additions to a workout the user just logged.
   */
  const buildRecentWorkoutConversation = (messagesList: Message[]): WorkoutConversationEntry[] => {
    const entries: WorkoutConversationEntry[] = [];
    let cardCount = 0;
    for (let i = messagesList.length - 1; i >= 0 && cardCount < 3; i--) {
      const msg = messagesList[i];
      if (msg.workoutData) {
        entries.unshift({
          role: 'coach',
          text: msg.text,
          workout: msg.workoutData,
          mode: msg.isWorkoutProposal ? 'proposed' : 'logged',
        });
        cardCount++;
      } else if (msg.sender === 'user' && cardCount > 0) {
        entries.unshift({ role: 'user', text: msg.text });
      } else if (cardCount > 0) {
        break;
      }
    }
    return entries;
  };

  const processMealText = async (foodDescription: string) => {
    try {
      // Switch to AI coach mode for food analysis
      setCoachMode('ai');

      glowLogger.info('Processing meal text', { food_description: foodDescription });

      // Get last 25 messages for context (include the user message that was just added)
      // Since state updates are async, we construct the messages list manually
      const userMessage: Message = {
        id: Date.now().toString(),
        text: foodDescription,
        sender: 'user',
        timestamp: new Date()
      };
      const messagesWithUserInput = [...messages, userMessage];
      const chatHistory = formatChatHistory(messagesWithUserInput);

      setIsCoachTyping(true);
      const analysis = await analyzeFoodText(foodDescription, chatHistory);
      setPendingMealAnalysis(analysis);
      setMealSaveError(null);
      latestMealAnalysisRef.current = analysis; // Store in ref for immediate access
      
      const analysisMessage = withMealCoachSuffix(
        analysis.description,
        t('chat:mealAnalysisClarifyLong'),
      );
      
      const newMessage: Message = {
        id: Date.now().toString(),
        text: analysisMessage,
        sender: 'ai_coach',
        timestamp: new Date(),
        mealAnalysis: analysis,
      };
      mealAnalysisMapRef.current.set(newMessage.id, analysis);
      pendingMealCoachMessageIdRef.current = newMessage.id;

      setMessages(prev => [...prev, newMessage]);
      await saveChatMessage({
        id: newMessage.id,
        text: embedMealNutrition(newMessage.text, analysis),
        sender: newMessage.sender,
        timestamp: newMessage.timestamp,
        userId: currentUserId!,
        userDisplayName: onboardingData.name
      });
    } catch (error) {
      glowLogger.error('Error processing meal text', { error });
      appendMealFailureMessage(t('chat:errorAnalyzeText'), {
        kind: 'analyze_text',
        foodDescription,
      });
      setPendingMealAnalysis(null);
      latestMealAnalysisRef.current = null; // Clear ref as well
      pendingMealCoachMessageIdRef.current = null;
    } finally {
      setIsCoachTyping(false);
    }
  };

  const handleCancelMeal = async () => {
    // Drop the clarify suffix from the pending coach bubble so it is no longer
    // treated as "awaiting confirmation" on a later reload. We keep the nutrition
    // embed but never write the relog marker, so the cancelled bubble shows neither
    // the confirm panel nor a Log again button.
    const cancelledCoachId = pendingMealCoachMessageIdRef.current ?? lastMealMsgId;
    if (cancelledCoachId) {
      setMessages(prev => prev.map(m => {
        if (m.id !== cancelledCoachId) return m;
        const cleanText = stripMealCoachSuffix(m.text);
        const analysis = m.mealAnalysis ?? mealAnalysisMapRef.current.get(m.id);
        if (analysis && currentUserId) {
          saveChatMessage({
            id: m.id,
            text: embedMealNutrition(cleanText, analysis),
            sender: m.sender,
            timestamp: m.timestamp,
            userId: currentUserId,
            userDisplayName: onboardingData.name,
          });
        }
        return { ...m, text: cleanText };
      }));
    }

    // Add AI coach message about cancellation
    const cancelMessage: Message = {
      id: Date.now().toString(),
      text: t('chat:mealLogCancelledByUser'),
      sender: 'ai_coach',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, cancelMessage]);
    await saveChatMessage({
      id: cancelMessage.id,
      text: cancelMessage.text,
      sender: cancelMessage.sender,
      timestamp: cancelMessage.timestamp,
      userId: currentUserId!,
      userDisplayName: onboardingData.name
    });

    // Clear the pending meal analysis
    setPendingMealAnalysis(null);
    setEditedMealAnalysis(null);
    setMealSaveError(null);
    resetMealLogDate();
    latestMealAnalysisRef.current = null;
    pendingMealCoachMessageIdRef.current = null;
  };

  const resetMealLogDate = () => {
    const n = new Date();
    setMealLogDate(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`);
  };

  const handleConfirmMeal = async (analysisToSave?: FoodAnalysis) => {
    // Prevent duplicate logging: if a confirm is already in flight, ignore extra taps.
    if (isConfirmingMealRef.current) {
      glowLogger.info('nutrition.meal_confirm_ignored_duplicate', {});
      return;
    }
    // Use edited analysis if user adjusted quantities, then fall back chain
    const mealAnalysis = analysisToSave || editedMealAnalysis || latestMealAnalysisRef.current || pendingMealAnalysis;
    let confirmSource: 'analysisToSave' | 'editedMealAnalysis' | 'latestMealAnalysisRef' | 'pendingMealAnalysis' | 'none' = 'none';
    if (analysisToSave) confirmSource = 'analysisToSave';
    else if (editedMealAnalysis) confirmSource = 'editedMealAnalysis';
    else if (latestMealAnalysisRef.current) confirmSource = 'latestMealAnalysisRef';
    else if (pendingMealAnalysis) confirmSource = 'pendingMealAnalysis';
    const coachMessageIdForPersist =
      pendingMealCoachMessageIdRef.current ?? lastMealMsgId;
    glowLogger.info('nutrition.meal_confirm_resolve', {
      source: confirmSource,
      coach_message_id: coachMessageIdForPersist,
      used_pending_coach_ref: pendingMealCoachMessageIdRef.current != null,
      carbs: mealAnalysis?.carbs,
      protein: mealAnalysis?.protein,
      fat: mealAnalysis?.fat,
      calories: mealAnalysis?.calories,
      food_quantities_preview: mealAnalysis?.foodQuantities?.slice(0, 160),
    });
    if (!mealAnalysis) {
      glowLogger.error('handleConfirmMeal called with no meal analysis', {});
      Alert.alert(t('common:error'), t('chat:errorNoMealDataToSave'));
      return;
    }

    // Validate that all required properties exist
    if (!mealAnalysis.shortDescription || 
        typeof mealAnalysis.carbs !== 'number' ||
        typeof mealAnalysis.protein !== 'number' ||
        typeof mealAnalysis.fat !== 'number' ||
        typeof mealAnalysis.fiber !== 'number' ||
        typeof mealAnalysis.calories !== 'number') {
      glowLogger.error('Meal analysis has invalid or missing properties', {
        analysis: JSON.stringify(mealAnalysis),
        shortDescription: mealAnalysis.shortDescription,
        carbs: mealAnalysis.carbs,
        carbsType: typeof mealAnalysis.carbs,
        protein: mealAnalysis.protein,
        fat: mealAnalysis.fat,
        fiber: mealAnalysis.fiber,
        calories: mealAnalysis.calories
      });
      Alert.alert(t('common:error'), t('chat:errorMealDataIncomplete'));
      setPendingMealAnalysis(null);
      pendingMealCoachMessageIdRef.current = null;
      return;
    }

    // Lock immediately so rapid double-taps can't trigger a second save. Keep pending
    // state visible so the confirm panel stays on screen during the save attempt.
    isConfirmingMealRef.current = true;
    setIsConfirmingMeal(true);
    setMealSaveError(null);

    let savedSuccessfully = false;
    try {
      const user = await getCurrentLoggedInUser();
      if (!user) {
        Alert.alert(t('common:error'), t('chat:errorUserNotFound'));
        return;
      }

      const plannedTrainingDays = onboardingData.actionPlan?.steps?.[0]?.daysOfWeek?.map((d: string) => d.toLowerCase()) || [];
      let scoreBefore = 0;
      try {
        scoreBefore = await calculateWeeklyConsistency(user.id, plannedTrainingDays);
      } catch { /* keep 0 */ }

      glowLogger.info('Saving meal with values', {
        description: mealAnalysis.shortDescription,
        carbs: mealAnalysis.carbs,
        protein: mealAnalysis.protein,
        fat: mealAnalysis.fat,
        fiber: mealAnalysis.fiber,
        calories: mealAnalysis.calories
      });

      const success = await saveMealLog(
        user.id,
        mealAnalysis.shortDescription,
        Math.ceil(Number(mealAnalysis.carbs)),
        Math.ceil(Number(mealAnalysis.protein)),
        Math.ceil(Number(mealAnalysis.fat)),
        Math.ceil(Number(mealAnalysis.fiber)),
        Math.ceil(Number(mealAnalysis.calories)),
        mealLogDate,
        mealAnalysis.foodQuantities || undefined,
        mealAnalysis.foodItemMacros
      );

      if (success) {
        savedSuccessfully = true;
        onMealLogged?.();
        // Recompute + upload the leaderboard score (no-op when this meal can't
        // change the capped score, e.g. the 4th meal of the day).
        refreshConsistencyScoreAfterLog(user.id).catch(() => {});
        // Update the coach bubble for *this* pending flow (not necessarily the globally last meal message).
        if (coachMessageIdForPersist) {
          mealAnalysisMapRef.current.set(coachMessageIdForPersist, mealAnalysis);
          const persistLoggedBubble = (id: string, cleanText: string, timestamp: Date, sender: Message['sender']) => {
            saveChatMessage({
              id,
              text: embedMealSuccessRelog(embedMealNutrition(cleanText, mealAnalysis), mealAnalysis),
              sender,
              timestamp,
              userId: currentUserId!,
              userDisplayName: onboardingData.name,
            });
          };
          setMessages(prev => {
            if (prev.some(m => m.id === coachMessageIdForPersist)) {
              return prev.map(m => {
                if (m.id !== coachMessageIdForPersist) return m;
                const cleanText = stripMealCoachSuffix(m.text);
                persistLoggedBubble(m.id, cleanText, m.timestamp, m.sender);
                return { ...m, text: cleanText, mealAnalysis, isMealAnalysisLogged: true };
              });
            }
            // The coach bubble is not in the in-memory list — e.g. a relog from
            // recents remounts this screen and a history reload raced the injected
            // bubble out of `messages`. Re-create the logged record so the meal's
            // description + quantities always persist as a message, not just the
            // "Meal logged!" success bubble. Same id → DB upsert, no duplicate row.
            const desc = mealAnalysis.shortDescription || mealAnalysis.description || '';
            persistLoggedBubble(coachMessageIdForPersist, desc, new Date(), 'ai_coach');
            return [...prev, {
              id: coachMessageIdForPersist,
              text: desc,
              sender: 'ai_coach',
              timestamp: new Date(),
              mealAnalysis,
              isMealAnalysisLogged: true,
            }];
          });
        }

        // Push confirmation message into the chat stream
        const confirmMessage: Message = {
          id: Date.now().toString(),
          text: t('chat:mealLoggedSuccess'),
          sender: 'ai_coach',
          timestamp: new Date(),
          isMealLoggedSuccess: true,
        };
        setMessages(prev => [...prev, confirmMessage]);
        await saveChatMessage({
          id: confirmMessage.id,
          text: confirmMessage.text,
          sender: confirmMessage.sender,
          timestamp: confirmMessage.timestamp,
          userId: currentUserId!,
          userDisplayName: onboardingData.name,
        });

        setPendingMealAnalysis(null);
        setEditedMealAnalysis(null);
        setMealSaveError(null);
        resetMealLogDate();
        latestMealAnalysisRef.current = null;
        pendingMealCoachMessageIdRef.current = null;

        // Show celebration only if the score just crossed the threshold
        try {
          const scoreAfter = await calculateWeeklyConsistency(user.id, plannedTrainingDays);
          if (didCrossConsistencyThreshold(scoreBefore, scoreAfter)) {
            setConsistencyScore(scoreAfter);
            setShowConsistencyModal(true);
          }
        } catch (e) {
          console.warn('Error checking consistency:', e);
        }
      } else {
        setMealSaveError(t('chat:errorSaveMeal'));
        appendMealFailureMessage(t('chat:errorSaveMeal'), { kind: 'save', analysis: mealAnalysis });
      }
    } catch (error) {
      glowLogger.error('Error confirming meal', { error });
      setMealSaveError(t('chat:errorSaveMeal'));
      appendMealFailureMessage(t('chat:errorSaveMeal'), { kind: 'save', analysis: mealAnalysis });
    } finally {
      isConfirmingMealRef.current = false;
      setIsConfirmingMeal(false);
    }
  };

  // NEW helper to safely open daily check-in from notification
  const openDailyCheckinModalFromNotification = async () => {
    if (pendingCheckinOpenRef.current || showCheckinDay) {
      glowLogger.info('CheckinDay open request ignored (already pending or open)', {
        pending: pendingCheckinOpenRef.current,
        showCheckinDay
      });
      return;
    }
    pendingCheckinOpenRef.current = true;

    try {
      // Close any other modals that would block rendering
      if (showPlanView) setShowPlanView(false);
      if (showDeveloperMode) setShowDeveloperMode(false);
      if (showOnboardData) setShowOnboardData(false);
      if (showBottomSheet) setShowBottomSheet(false);
      if (showCoachDetails) setShowCoachDetails(false);

      // Ensure user profile loaded
      if (!currentUserProfile) {
        try {
          const userProfile = await getRemoteUserProfileLoggedInUser();
            if (userProfile) setCurrentUserProfile(userProfile);
        } catch (e) {
          glowLogger.error('Failed loading profile before opening CheckinDay', {
            error: e instanceof Error ? e.message : String(e)
          });
        }
      }

      // Small delay lets other modals unmount first
      setTimeout(() => {
        glowLogger.info('Opening CheckinDay modal after notification prep', {});
        setShowCheckinDay(true);
        pendingCheckinOpenRef.current = false;
      }, 180);
    } catch (e) {
      pendingCheckinOpenRef.current = false;
      glowLogger.error('Error during openDailyCheckinModalFromNotification', {
        error: e instanceof Error ? e.message : String(e)
      });
    }
  };

  // Subscribe to push notifications when app is in foreground
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(notification => {
      glowLogger.info('Push notification received while app in foreground', {
        notification_body: notification.request.content.body,
        notification_title: notification.request.content.title,
        notification_data: JSON.stringify(notification.request.content.data),
        notification_sender: notification.request.content.data?.sender || 'unknown',
        user_name: onboardingData.name,
        notification: notification.request.content
      });

      // Add notification body as coach message
      if (notification.request.content.body) {
        addNotificationAsCoachMessage(
          notification.request.content.body,
          notification.request.content.data?.sender as 'ai_coach' | 'human_coach' | undefined
        );
      }

      const renderScreen = (notification.request.content.data as any)?.render_screen;
      if (renderScreen === 'checkin_daily') {
        glowLogger.info('Notification requests daily check-in screen', {
          render_screen: renderScreen,
          showPlanView,
          showDeveloperMode,
          showOnboardData,
          showBottomSheet,
          showCoachDetails
        });
        openDailyCheckinModalFromNotification();
      }
    });

    return () => {
      try {
        subscription.remove(); // Updated: avoid deprecated removeNotificationSubscription
      } catch {}
    };
  // Added modal states so the effect rebinds with latest closures if those change
  }, [onboardingData.name, showPlanView, showDeveloperMode, showOnboardData, showBottomSheet, showCoachDetails, currentUserProfile]);

  // Subscribe to chatEvents for new messages
  useEffect(() => {
    const handler = (event: any) => {
      glowLogger.info('chatEvents newMessage event received', { event: JSON.stringify(event) });
      if (event?.userDisplayName === onboardingData.name) {
        glowLogger.info('Reloading chat messages from DB for user', { user_name: onboardingData.name });
        initializeChatAndLoadHistory();
      } else {
        glowLogger.info('Ignoring newMessage event for different user', { 
          event_user: event?.userDisplayName 
        });
      }
    };
    chatEvents.on('newMessage', handler);
    glowLogger.info('Subscribed to chatEvents newMessage', {});

    return () => {
      chatEvents.off('newMessage', handler);
      glowLogger.info('Unsubscribed from chatEvents newMessage', {});
    };
   
  }, [onboardingData.name]);

  // Subscribe to onboarding data changes
  useEffect(() => {
    const handler = async (event: any) => {
      glowLogger.info('onboardingDataChanged event received', { event: JSON.stringify(event) });
      try {
        // Reload the onboarding data from remote database
        const userProfileData = await getRemoteUserProfileLoggedInUser();
        if (userProfileData?.onboardingProfile) {
          setLocalOnboardingData(userProfileData.onboardingProfile);
          setCurrentUserProfile(userProfileData);
          
          // CRITICAL: Update currentUserId and currentUserDisplayName for profile restoration
          setCurrentUserId(userProfileData.user_id);
          setCurrentUserDisplayName(userProfileData.onboardingProfile.name);
          
          // CRITICAL: Update GlowLogger when onboarding data changes
          // Use localUserId from onboarding profile if available, otherwise use user_id
          const loggerUserId = userProfileData.onboardingProfile.localUserId || userProfileData.user_id;
          glowLogger.setUserIdentifier(userProfileData.onboardingProfile.name, loggerUserId);
          
          glowLogger.info('ChatScreen onboarding data reloaded successfully', {
            user_id: userProfileData.user_id,
            user_display_name: userProfileData.onboardingProfile.name,
            local_user_id: loggerUserId,
            has_action_plan: !!userProfileData.onboardingProfile.actionPlan
          });
        }
      } catch (error) {
        glowLogger.error('Error reloading onboarding data in ChatScreen', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };
    
    onboardingEvents.on('onboardingDataChanged', handler);
    glowLogger.info('Subscribed to onboardingDataChanged events', {});

    return () => {
      onboardingEvents.off('onboardingDataChanged', handler);
      glowLogger.info('Unsubscribed from onboardingDataChanged events', {});
    };
  }, []); // Remove email dependency to always listen for changes

  // Subscribe to checkin data changes
  useEffect(() => {
    const handler = (event: any) => {
      glowLogger.info('checkinDataChanged event received', { event: JSON.stringify(event) });
      // Reload checkin progress when checkin data changes
      loadCheckinProgressData();
    };
    
    onboardingEvents.on('checkinDataChanged', handler);
    glowLogger.info('Subscribed to checkinDataChanged events', {});

    return () => {
      onboardingEvents.off('checkinDataChanged', handler);
      glowLogger.info('Unsubscribed from checkinDataChanged events', {});
    };
  }, []);

  // Fetch nutrition targets when user ID is available
  useEffect(() => {
    if (currentUserId) {
      getUserNutritionTargets(currentUserId).then(setNutritionTargets).catch(() => {});
    }
  }, [currentUserId]);

  // Generate welcome message when shouldGenerateWelcome prop is true
  // CRITICAL: Wait for currentUserId to be set (from initializeChatAndLoadHistory) before generating
  useEffect(() => {
    if (shouldGenerateWelcome && currentUserId) {
      glowLogger.info('shouldGenerateWelcome is true and currentUserId is set, generating welcome message with typing indicator', {
        current_user: onboardingData.name,
        user_id: currentUserId
      });
      // Clear any existing messages and generate welcome message
      setMessages([]);
      generateWelcomeMessage();
      
      // Call callback to reset the flag
      if (onWelcomeGenerated) {
        onWelcomeGenerated();
      }
    } else if (shouldGenerateWelcome && !currentUserId) {
      glowLogger.info('shouldGenerateWelcome is true but waiting for currentUserId to be set', {
        current_user: onboardingData.name
      });
    }
  }, [shouldGenerateWelcome, currentUserId, onboardingData.name, onWelcomeGenerated]);

  // Function to load checkin progress data - extracted for reuse
  const loadCheckinProgressData = async () => {
    try {
      const currentUser = await getCurrentLoggedInUser();
      if (currentUser) {
        glowLogger.info('Loading checkin progress for current week', { user_id: currentUser.id });
        const progress = await checking_progress_this_week(currentUser.id);
        setCheckinProgress(progress);
        
        // Update the plan progress bar based on checkin data
        const progressRatio = progress.expected_checkins_this_week.length > 0 
          ? progress.num_checkins_this_week / progress.expected_checkins_this_week.length 
          : 0;
        setPlanProgress(Math.min(progressRatio, 1)); // Cap at 100%
        
        glowLogger.info('Checkin progress loaded successfully', {
          actual_checkins: progress.num_checkins_this_week,
          expected_checkins: progress.expected_checkins_this_week.length,
          progress_ratio: progressRatio
        });
      }
    } catch (error) {
      glowLogger.error('Failed to load checkin progress', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  // Load checkin progress data
  useEffect(() => {
    loadCheckinProgressData();
  }, [onboardingData]); // Reload when onboarding data changes

  const initializeChatAndLoadHistory = async () => {
    try {
      glowLogger.info('Loading chat messages from DB...', {});
      setChatLoadError(null); // Clear any previous error
      setMessageSyncStatus('syncing');
      
      // Reset pagination state
      setMessageOffset(0);
      setHasMoreMessages(false);
      
      // Initialize the database
      await initializeConversationDB();
      
      // Always reload onboarding data from remote to ensure we have the latest
      glowLogger.info('Reloading onboarding data from remote to ensure latest profile', {});
      const userProfileData = await getRemoteUserProfileLoggedInUser();
      
      if (userProfileData) {
        glowLogger.info('Using reloaded onboarding data', {
          name: userProfileData.onboardingProfile.name,
          email: userProfileData.onboardingProfile.email,
          coach: userProfileData.onboardingProfile.selectedCoach
        });
        setLocalOnboardingData(userProfileData.onboardingProfile);
        
        // Store user info for potential retry
        setCurrentUserId(userProfileData.user_id);
        setCurrentUserDisplayName(userProfileData.onboardingProfile.name);
        
        // CRITICAL: Update GlowLogger with the user info
        // Use localUserId from onboarding profile if available, otherwise use user_id
        const loggerUserId = userProfileData.onboardingProfile.localUserId || userProfileData.user_id;
        glowLogger.setUserIdentifier(userProfileData.onboardingProfile.name, loggerUserId);
        glowLogger.info('GlowLogger updated after loading profile', {
          user_display_name: userProfileData.onboardingProfile.name,
          local_user_id: loggerUserId
        });
        
        // First sync with remote to update local database
        // This ensures we have all messages from Supabase locally
        const syncResult = await syncAndLoadChatHistory(userProfileData.user_id);
        
        // Update sync status based on result
        if (syncResult.syncStatus === 'failed') {
          setMessageSyncStatus('failed');
          glowLogger.warn('Message sync failed, showing local messages only', {
            local_message_count: syncResult.messages.length
          });
        } else {
          setMessageSyncStatus('success');
          // Auto-hide success status after 2 seconds
          setTimeout(() => setMessageSyncStatus('idle'), 2000);
        }
        
        // Use messages directly from sync result (already sorted chronologically)
        // This avoids any timing issues with database writes
        const allMessages = syncResult.messages;
        const totalCount = allMessages.length;
        
        glowLogger.info(`Using messages from sync result`, { 
          total_count: totalCount,
          sync_status: syncResult.syncStatus,
          new_from_remote: syncResult.newMessageCount,
          user_name: userProfileData.onboardingProfile.name,
          user_id: userProfileData.user_id
        });
        
        if (totalCount > 0) {
          // Format ALL messages and store in ref for pagination
          const allFormattedMessages: Message[] = allMessages.map(parseRawMessage);
          allSyncedMessagesRef.current = allFormattedMessages;
          
          // Take only the last MESSAGES_PER_PAGE messages for initial display
          const messagesToDisplay = allFormattedMessages.slice(-MESSAGES_PER_PAGE);
          setMessages(messagesToDisplay);
          setHasMoreMessages(totalCount > MESSAGES_PER_PAGE);
          setMessageOffset(MESSAGES_PER_PAGE);

          // Restore an unconfirmed meal-log panel if the user navigated away
          // mid-flow (e.g. switched tabs, which unmounts this screen). The most
          // recent coach meal bubble that is NOT yet logged and still carries the
          // clarify suffix is awaiting confirmation — bring its Cancel / Log This
          // Meal panel back so the meal can still be logged. Logged bubbles drop
          // the suffix (and gain the relog marker); cancelled bubbles drop the
          // suffix too, so neither is mistaken for pending.
          if (!pendingMealAnalysis) {
            for (let i = messagesToDisplay.length - 1; i >= 0; i--) {
              const m = messagesToDisplay[i];
              if (m.sender !== 'ai_coach' || !m.mealAnalysis) continue;
              if (!m.isMealAnalysisLogged && m.text.includes(MEAL_COACH_SUFFIX_MARK)) {
                glowLogger.info('nutrition.meal_pending_restore', { coach_message_id: m.id });
                pendingMealCoachMessageIdRef.current = m.id;
                latestMealAnalysisRef.current = m.mealAnalysis;
                setPendingMealAnalysis(m.mealAnalysis);
              }
              break; // only the most recent meal bubble determines the pending state
            }
          }
        } else {
          allSyncedMessagesRef.current = [];
          glowLogger.info('No chat history found - welcome messages only generated via generateWelcomeMessage event', {
            user_name: userProfileData.onboardingProfile.name
          });
        }
      } else {
        glowLogger.error('No remote onboarding data found', {});
        throw new Error('No remote onboarding data found - cannot initialize chat');
      }
    } catch (error) {
      glowLogger.error('Error initializing chat and loading history', {
        error: error instanceof Error ? error.message : String(error)
      });
      setChatLoadError(t('chat:failedToLoadChat'));
      setMessageSyncStatus('idle');
    }
    
    glowLogger.info('initializeChatAndLoadHistory completed', {});
  };

  const handleRetryChatLoad = async () => {
    setIsRetryingChatLoad(true);
    try {
      await initializeChatAndLoadHistory();
    } finally {
      setIsRetryingChatLoad(false);
    }
  };

  // Retry message sync from Supabase
  const handleRetryMessageSync = async () => {
    if (!currentUserId || !currentUserDisplayName) {
      glowLogger.warn('Cannot retry message sync - missing user info', {});
      return;
    }
    
    setIsRetryingMessageSync(true);
    setMessageSyncStatus('syncing');
    
    try {
      const syncResult = await syncAndLoadChatHistory(currentUserId);
      
      if (syncResult.syncStatus === 'failed') {
        setMessageSyncStatus('failed');
      } else {
        setMessageSyncStatus('success');
        setTimeout(() => setMessageSyncStatus('idle'), 2000);
        
        // Update messages if we got new ones
        if (syncResult.newMessageCount > 0) {
          const formattedMessages: Message[] = syncResult.messages.map(parseRawMessage);
          setMessages(formattedMessages);
          
          glowLogger.info('Message sync retry successful - new messages loaded', {
            new_message_count: syncResult.newMessageCount,
            total_messages: syncResult.messages.length
          });
        }
      }
    } catch (error) {
      glowLogger.error('Message sync retry failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      setMessageSyncStatus('failed');
    } finally {
      setIsRetryingMessageSync(false);
    }
  };

  // Handle content size change to maintain scroll position when loading old messages
  const handleContentSizeChange = (contentWidth: number, contentHeight: number) => {
    if (isLoadingMore && scrollPositionRef.current && typeof scrollPositionRef.current.y === 'number') {
      const oldContentHeight = scrollPositionRef.current.contentHeight || 0;
      const oldScrollY = scrollPositionRef.current.y || 0;
      const heightDiff = contentHeight - oldContentHeight;
      
      // Scroll to maintain visual position
      if (heightDiff > 0) {
        scrollViewRef.current?.scrollTo({ 
          y: oldScrollY + heightDiff, 
          animated: false 
        });
      }
      
      // Clear the ref and reset loading flag
      scrollPositionRef.current = null;
      setIsLoadingMore(false);
    } else if (isLoadingMore) {
      // Reset loading flag even if we don't have position data
      setIsLoadingMore(false);
    }
  };

  // Load more messages (older messages) when user taps button
  const loadMoreMessages = () => {
    if (isLoadingMore || !hasMoreMessages) return;
    
    // Position is already being tracked by handleScroll continuously
    setIsLoadingMore(true);
    
    const allMessages = allSyncedMessagesRef.current;
    const totalCount = allMessages.length;
    
    // Calculate which messages to load next
    const endIndex = totalCount - messageOffset;
    const startIndex = Math.max(0, endIndex - MESSAGES_PER_PAGE);
    
    if (startIndex < endIndex) {
      const olderMessages = allMessages.slice(startIndex, endIndex);
      setMessages(prev => [...olderMessages, ...prev]);
      setMessageOffset(messageOffset + olderMessages.length);
      setHasMoreMessages(startIndex > 0);
    } else {
      setHasMoreMessages(false);
      setIsLoadingMore(false);
    }
  };
  
  // Track scroll position continuously
  const handleScroll = (event: any) => {
    if (event?.nativeEvent?.contentOffset && event?.nativeEvent?.contentSize) {
      const { contentOffset, contentSize } = event.nativeEvent;
      scrollPositionRef.current = {
        y: contentOffset.y || 0,
        contentHeight: contentSize.height || 0
      };
    }
  };


  useEffect(() => {
    // Auto-scroll to bottom only when NEW messages are added (not when loading older messages)
    const currentCount = messages.length;
    const previousCount = previousMessageCountRef.current;
    
    // Only scroll if:
    // 1. Message count increased AND
    // 2. We're not currently loading more messages (which prepends old messages)
    const isNewMessage = currentCount > previousCount && !isLoadingMore;
    
    if (messages.length > 0 && isNewMessage) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
    
    // Update the ref for next comparison
    previousMessageCountRef.current = currentCount;
  }, [messages, isLoadingMore]);

  // Handle keyboard show/hide events to ensure input is visible
  useEffect(() => {
    const keyboardWillShowListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        // Edge-to-edge means the window doesn't resize on Android, so both
        // platforms lift the chat column using the measured keyboard height.
        setKeyboardHeight(e.endCoordinates.height);
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    );

    const keyboardWillHideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );

    // autoFocus can open the keyboard before these listeners attach; seed the
    // current height so the input lifts even if the first show event is missed.
    const metrics = Keyboard.metrics?.();
    if (metrics?.height) {
      setKeyboardHeight(metrics.height);
    }

    return () => {
      keyboardWillShowListener.remove();
      keyboardWillHideListener.remove();
    };
  }, []);

  
  // Bottom sheet animation
  useEffect(() => {
    if (showBottomSheet) {
      Animated.spring(bottomSheetAnim, {
        toValue: 1,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.spring(bottomSheetAnim, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
    }
  }, [showBottomSheet, bottomSheetAnim]);

  const generateWelcomeMessage = async () => {
    try {
      glowLogger.info('Generating welcome message...', {});
      setIsCoachTyping(true); // Show typing indicator while generating welcome message
      const welcomeMessages = await llmService.generateWelcomeMessage(onboardingData);
      
      // Create message objects for each welcome message
      const messageObjects = welcomeMessages.map((text, index) => ({
        id: `welcome_${Date.now()}_${index + 1}`,
        text,
        sender: 'ai_coach' as const,
        timestamp: new Date()
      }));
      
      setMessages(messageObjects);
      glowLogger.info('setIsCoachTyping(false) - welcome message generated successfully', { 
        message_count: welcomeMessages.length 
      });
      setIsCoachTyping(false);
      
      // Save each welcome message to the database
      try {
        for (const message of messageObjects) {
          await saveChatMessage({
            id: message.id,
            text: message.text,
            sender: message.sender,
            timestamp: message.timestamp,
            userId: currentUserId!,
            userDisplayName: onboardingData.name
          });
        }
        glowLogger.info('Welcome messages saved to database', {});
      } catch (savingError) {
        glowLogger.error('Failed to save welcome messages to database', {
          error: savingError instanceof Error ? savingError.message : String(savingError)
        });
        // Don't throw - message saving failure shouldn't break the chat
      }
      
      // Record each message in the conversation (for backwards compatibility)
      try {
        for (const message of welcomeMessages) {
          await addConversationEntry('', message, currentUserId!, onboardingData.name);
        }
        glowLogger.info('Welcome messages recorded successfully', {});
      } catch (recordingError) {
        glowLogger.error('Failed to record welcome messages', {
          error: recordingError instanceof Error ? recordingError.message : String(recordingError)
        });
        // Don't throw - conversation recording failure shouldn't break the chat
      }
    } catch (error) {
      glowLogger.error('Failed to generate welcome message', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Fallback to a simple welcome message
      const fallbackMessage: Message = {
        id: `fallback_${Date.now()}`,
        text: t('chat:welcomeFallbackMessage', {
          name: onboardingData.name,
          coach: onboardingData.selectedCoach,
        }),
        sender: 'ai_coach',
        timestamp: new Date()
      };
      
      setMessages([fallbackMessage]);
      glowLogger.info('setIsCoachTyping(false) - fallback welcome message created', {});
      setIsCoachTyping(false);
      
      // Save fallback message to database
      try {
        await saveChatMessage({
          id: fallbackMessage.id,
          text: fallbackMessage.text,
          sender: fallbackMessage.sender,
          timestamp: fallbackMessage.timestamp,
          userId: currentUserId!,
          userDisplayName: onboardingData.name
        });
      } catch (savingError) {
        glowLogger.error('Failed to save fallback message', {
          error: savingError instanceof Error ? savingError.message : String(savingError)
        });
      }
    }
  };

  const dismissKeyboard = () => {
    Keyboard.dismiss();
  };

  // REFACTORED: sendMessage now receives the text from ChatMessageBox
  const sendMessage = async (messageText: string) => {
    const userInput = messageText.trim();
    if (!userInput) return;


    // Check if this is a meal image from the camera button
    if (userInput.startsWith('__MEAL_IMAGE__:')) {
      const imageUri = userInput.substring('__MEAL_IMAGE__:'.length);
      await processMealImage(imageUri);
      return;
    }

    // Check if user is confirming a pending meal analysis
    if (pendingMealAnalysis && userInput.toLowerCase() === 'ok') {
      const confirmMessage: Message = {
        id: Date.now().toString(),
        text: userInput,
        sender: 'user',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, confirmMessage]);
      await saveChatMessage({
        id: confirmMessage.id,
        text: confirmMessage.text,
        sender: confirmMessage.sender,
        timestamp: confirmMessage.timestamp,
        userId: currentUserId!,
        userDisplayName: onboardingData.name
      });
      await handleConfirmMeal();
      return;
    }

    // Check if user is correcting a pending meal analysis
    if (pendingMealAnalysis) {
      const newMessage: Message = {
        id: Date.now().toString(),
        text: userInput,
        sender: 'user',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, newMessage]);
      await saveChatMessage({
        id: newMessage.id,
        text: newMessage.text,
        sender: newMessage.sender,
        timestamp: newMessage.timestamp,
        userId: currentUserId!,
        userDisplayName: onboardingData.name
      });
      
      // Update analysis based on correction using AI
      setIsCoachTyping(true);
      try {
        // Get last 25 messages for context (including the correction message we just added)
        const messagesWithCorrection = [...messages, newMessage];
        const chatHistory = formatChatHistory(messagesWithCorrection);
        
        const analysisForCorrection = editedMealAnalysis || pendingMealAnalysis;

        // Freeze the edited analysis into the active pending meal message before it becomes history.
        const pendingMessageIdForCorrection =
          pendingMealCoachMessageIdRef.current ?? lastMealMsgId;
        if (editedMealAnalysis && pendingMessageIdForCorrection) {
          mealAnalysisMapRef.current.set(pendingMessageIdForCorrection, editedMealAnalysis);
          setMessages(prev => prev.map(m => {
            if (m.id !== pendingMessageIdForCorrection) return m;
            const cleanText = stripMealCoachSuffix(m.text);
            saveChatMessage({
              id: m.id,
              text: embedMealNutrition(cleanText, editedMealAnalysis),
              sender: m.sender,
              timestamp: m.timestamp,
              userId: currentUserId!,
              userDisplayName: onboardingData.name,
            });
            return { ...m, text: cleanText, mealAnalysis: editedMealAnalysis };
          }));
        }

        const updatedAnalysis = await updateFoodAnalysisWithCorrection(analysisForCorrection, userInput, chatHistory);
        setPendingMealAnalysis(updatedAnalysis);
        setEditedMealAnalysis(null);
        latestMealAnalysisRef.current = updatedAnalysis;
        
        glowLogger.info('Updated meal analysis after correction', {
          original_carbs: pendingMealAnalysis.carbs,
          updated_carbs: updatedAnalysis.carbs,
          original_protein: pendingMealAnalysis.protein,
          updated_protein: updatedAnalysis.protein,
          correction: userInput,
          updated_analysis_full: JSON.stringify(updatedAnalysis)
        });
        
        const responseMessage: Message = {
          id: Date.now().toString(),
          text: withMealCoachSuffix(
            updatedAnalysis.description,
            t('chat:mealAnalysisAfterCorrectionPrompt'),
          ),
          sender: 'ai_coach',
          timestamp: new Date(),
          mealAnalysis: updatedAnalysis,
        };
        mealAnalysisMapRef.current.set(responseMessage.id, updatedAnalysis);
        setMessages(prev => [...prev, responseMessage]);
        await saveChatMessage({
          id: responseMessage.id,
          text: embedMealNutrition(responseMessage.text, updatedAnalysis),
          sender: responseMessage.sender,
          timestamp: responseMessage.timestamp,
          userId: currentUserId!,
          userDisplayName: onboardingData.name
        });
      } catch (error) {
        glowLogger.error('Failed to update food analysis', {
          error: error instanceof Error ? error.message : String(error)
        });
        const errorMessage: Message = {
          id: Date.now().toString(),
          text: t('chat:mealAnalysisUpdateFailed', { okLabel: t('common:ok') }),
          sender: 'ai_coach',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
        await saveChatMessage({
          id: errorMessage.id,
          text: errorMessage.text,
          sender: errorMessage.sender,
          timestamp: errorMessage.timestamp,
          userId: currentUserId!,
          userDisplayName: onboardingData.name
        });
      } finally {
        setIsCoachTyping(false);
      }
      return;
    }

    // Save user message first (before intent detection)
    const newMessage: Message = {
      id: Date.now().toString(),
      text: userInput,
      sender: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newMessage]);
    glowLogger.info('User sent message', { user_input_length: userInput.length });

    // Save user message
    try {
      await saveChatMessage({
        id: newMessage.id,
        text: newMessage.text,
        sender: newMessage.sender,
        timestamp: newMessage.timestamp,
        userId: currentUserId!,
        userDisplayName: onboardingData.name
      });
    } catch (error) {
      glowLogger.error('Failed to save user message', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Data snapshot for context-aware responses (populated by classifier when needed)
    let dataSnapshot: string | undefined;

    // Intent classification (only in AI coach mode)
    if (coachMode === 'ai') {

      // Handle pending plan edit confirmation (user was asked to confirm a plan change)
      const currentPending = pendingPlanEditRef.current;
      if (currentPending) {
        try {
          setIsCoachTyping(true);
          const followUp = await classifyPlanEditFollowUp(userInput, currentPending.feedback);

          if (followUp.type === 'confirm') {
            glowLogger.info('Plan edit confirmed by user', { pending: currentPending });

            if (!currentUserProfile) {
              const profile = await getRemoteUserProfileLoggedInUser();
              if (profile) setCurrentUserProfile(profile);
            }

            const combinedFeedback = currentPending.feedback.join('. ');
            setEditPlanChatStepIndex(currentPending.stepIndex ?? undefined);
            setEditPlanChatFeedback(currentPending.stepIndex !== null ? combinedFeedback : undefined);
            setPendingPlanEdit(null);
            setIsCoachTyping(false);
            setShowEditPlanFromChat(true);
            return;
          }

          if (followUp.type === 'more_changes') {
            glowLogger.info('User requesting more plan changes', { additional: followUp.additionalFeedback });

            const additionalRaw = followUp.additionalFeedback || userInput;
            const recentHistoryForResolve = formatChatHistory(messages).slice(-10);
            const resolvedAdditional = await resolveContextualPlanEditRequest(additionalRaw, recentHistoryForResolve);

            const newFeedback = [...currentPending.feedback, resolvedAdditional];
            const stepName = currentPending.stepIndex !== null ? STEP_NAMES[currentPending.stepIndex] : null;

            const confirmationText = await generatePlanEditConfirmation(newFeedback, stepName);
            const coachResponse: Message = {
              id: (Date.now() + 1).toString(),
              text: confirmationText,
              sender: 'ai_coach',
              timestamp: new Date(),
            };
            setMessages(prev => [...prev, coachResponse]);
            await saveChatMessage({
              id: coachResponse.id,
              text: coachResponse.text,
              sender: coachResponse.sender,
              timestamp: coachResponse.timestamp,
              userId: currentUserId!,
              userDisplayName: onboardingData.name,
            });
            await addConversationEntry(userInput, confirmationText, currentUserId!, onboardingData.name);

            setPendingPlanEdit({ ...currentPending, feedback: newFeedback });
            setPlanEditConfirmationMessageId(coachResponse.id);
            return;
          }

          // type === 'other': user changed topic, clear pending and continue normal flow
          glowLogger.info('User changed topic, clearing pending plan edit', {});
          setPendingPlanEdit(null);
        } catch (error) {
          glowLogger.error('Error handling plan edit follow-up', {
            error: error instanceof Error ? error.message : String(error),
          });
          setPendingPlanEdit(null);
        } finally {
          setIsCoachTyping(false);
        }
      }

      // Single unified intent classification (replaces 3 serial classifier calls)
      try {
        setIsCoachTyping(true);
        const recentHistory = formatChatHistory(messages).slice(-10);
        const intentResult = await classifyUserIntent(userInput, recentHistory);

        glowLogger.info('User intent classified', {
          intent: intentResult.intent,
          plan_step: intentResult.planStep ?? 'n/a',
          needs_user_data: intentResult.needsUserData,
        });

        if (intentResult.needsUserData && currentUserId) {
          dataSnapshot = await fetchUserDataSnapshot(currentUserId, localOnboardingData) || undefined;
        }
        if (weeklyReportCoachContextRef.current && currentUserId && !dataSnapshot) {
          try {
            dataSnapshot = (await fetchUserDataSnapshot(currentUserId, localOnboardingData)) || undefined;
          } catch (snapErr) {
            glowLogger.warn('Weekly check-in chat: optional snapshot failed', {
              error: snapErr instanceof Error ? snapErr.message : String(snapErr),
            });
          }
        }

        // Unbounded-history exercise question (e.g. "max pull-up weight",
        // "when did I last deadlift?"). Resolve to a catalog id and attach
        // a dedicated all-time history block to the coach prompt, since the
        // fixed 2-week snapshot window cannot answer these reliably.
        if (intentResult.exerciseHistoryQuery && currentUserId) {
          const ehq = intentResult.exerciseHistoryQuery;
          try {
            const matchMap = await harmonizeExerciseIdsWithCatalog([
              { name: ehq.exercise, exerciseId: '' },
            ]);
            const matchedId = matchMap.get(0);
            if (matchedId) {
              const sessions = await getExerciseHistory(currentUserId, matchedId, { limitSessions: 45 });
              if (sessions.length > 0) {
                const lines: string[] = [];
                lines.push(`--- EXERCISE HISTORY (all-time, ${ehq.exercise} → ${matchedId}) ---`);
                for (const s of sessions) {
                  const setStrs = s.sets.map(set => {
                    const parts: (string | null)[] = [
                      set.reps != null ? `${set.reps} reps` : null,
                      set.weightValue != null ? `${set.weightValue}${set.weightUnit || 'kg'}` : null,
                      set.rir != null ? `RIR ${set.rir}` : null,
                    ];
                    const text = parts.filter(Boolean).join(' @ ') || 'bodyweight';
                    return set.comments && set.comments.trim()
                      ? `${text} [note: ${set.comments.trim()}]`
                      : text;
                  });
                  lines.push(`  ${s.workoutDate} (${s.workoutDayName}): ${setStrs.join(', ')}`);
                }
                const historyBlock = lines.join('\n');
                dataSnapshot = dataSnapshot
                  ? `${dataSnapshot}\n\n${historyBlock}`
                  : historyBlock;
                glowLogger.info('Attached exercise history block to coach context', {
                  exercise: ehq.exercise,
                  matched_id: matchedId,
                  scope: ehq.scope ?? 'unspecified',
                  sessions: sessions.length,
                });
              } else {
                glowLogger.info('Exercise history requested but no sessions found', {
                  exercise: ehq.exercise,
                  matched_id: matchedId,
                });
              }
            } else {
              glowLogger.info('Exercise history requested but no catalog match', {
                exercise: ehq.exercise,
              });
            }
          } catch (historyError) {
            glowLogger.warn('Failed to build exercise history block', {
              error: historyError instanceof Error ? historyError.message : String(historyError),
              exercise: ehq.exercise,
            });
          }
        }

        switch (intentResult.intent) {
          case 'food_log': {
            glowLogger.info('Food logging intent detected, processing meal text', { user_input: userInput });
            await processMealText(userInput);
            return;
          }

          case 'plan_edit': {
            const stepName = intentResult.planStep !== null
              ? STEP_NAMES[intentResult.planStep]
              : null;

            const resolvedRequest = await resolveContextualPlanEditRequest(userInput, recentHistory, dataSnapshot);

            const confirmationText = await generatePlanEditConfirmation([resolvedRequest], stepName);
            const coachResponse: Message = {
              id: (Date.now() + 1).toString(),
              text: confirmationText,
              sender: 'ai_coach',
              timestamp: new Date(),
            };
            setMessages(prev => [...prev, coachResponse]);
            await saveChatMessage({
              id: coachResponse.id,
              text: coachResponse.text,
              sender: coachResponse.sender,
              timestamp: coachResponse.timestamp,
              userId: currentUserId!,
              userDisplayName: onboardingData.name,
            });
            await addConversationEntry(userInput, confirmationText, currentUserId!, onboardingData.name);

            setPendingPlanEdit({
              stepIndex: intentResult.planStep,
              feedback: [resolvedRequest],
            });
            setPlanEditConfirmationMessageId(coachResponse.id);
            return;
          }

          case 'workout': {
            glowLogger.info('Workout intent detected', { user_input: userInput });
            try {
              const recentWorkoutConvo = buildRecentWorkoutConversation(messages);
              const result = await generateWorkoutResponse(
                userInput,
                localOnboardingData,
                recentWorkoutConvo.length > 0 ? recentWorkoutConvo : undefined,
              );
              const isProposal = result.mode === 'proposed';
              // 'logged' mode keeps the fixed, pre-translated confirmation (the workout
              // is not saved until the user taps the button); 'proposed' uses the LLM's prose.
              const responseText = isProposal
                ? result.text
                : t('chat:workoutParsedReady', { logCta: t('workout:logWorkout') });
              const savedText = embedWorkoutData(responseText, result.workout, isProposal);
              const coachResponse: Message = {
                id: (Date.now() + 1).toString(),
                text: responseText,
                sender: 'ai_coach',
                timestamp: new Date(),
                workoutData: result.workout,
                isWorkoutProposal: isProposal,
              };
              setMessages(prev => [...prev, coachResponse]);
              await saveChatMessage({
                id: coachResponse.id,
                text: savedText,
                sender: coachResponse.sender,
                timestamp: coachResponse.timestamp,
                userId: currentUserId!,
                userDisplayName: onboardingData.name,
              });
              await addConversationEntry(userInput, responseText, currentUserId!, onboardingData.name);
            } catch (workoutError) {
              glowLogger.error('Failed to handle workout message', {
                error: workoutError instanceof Error ? workoutError.message : String(workoutError),
              });
            }
            return;
          }

          case 'activity_log': {
            glowLogger.info('Activity logging intent detected', { user_input: userInput });
            try {
              const activityData = await parseActivityFromDescription(userInput, recentHistory);
              const responseText = t('chat:activityLogOpening', {
                activityName: activityData.activityName.toLowerCase(),
              });
              const coachResponse: Message = {
                id: (Date.now() + 1).toString(),
                text: responseText,
                sender: 'ai_coach',
                timestamp: new Date(),
              };
              setMessages(prev => [...prev, coachResponse]);
              await saveChatMessage({
                id: coachResponse.id,
                text: coachResponse.text,
                sender: coachResponse.sender,
                timestamp: coachResponse.timestamp,
                userId: currentUserId!,
                userDisplayName: onboardingData.name,
              });
              await addConversationEntry(userInput, responseText, currentUserId!, onboardingData.name);
              if (onOpenActivityLogFromChat) {
                onOpenActivityLogFromChat({
                  activityType: activityData.activityType,
                  activityName: activityData.activityName,
                  durationMinutes: activityData.durationMinutes,
                  intensity: activityData.intensity,
                  distanceValue: activityData.distanceValue,
                  distanceUnit: activityData.distanceUnit,
                });
              }
            } catch (activityError) {
              glowLogger.error('Failed to parse activity description', {
                error: activityError instanceof Error ? activityError.message : String(activityError),
              });
            }
            return;
          }

          case 'general_chat':
            break;
        }
      } catch (error) {
        glowLogger.error('Error classifying user intent', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsCoachTyping(false);
      }
    }

    // Human coach mode: send acknowledgment and exit
    if (coachMode !== 'ai') {
      weeklyReportCoachContextRef.current = null;
      glowLogger.info('Human coach mode - sending automatic acknowledgment', {});
      const humanAck: Message = {
        id: (Date.now() + 1).toString(),
        text: t('chat:humanCoachAckMessage', {
          name: onboardingData.name,
          coach: onboardingData.selectedCoach,
        }),
        sender: 'human_coach',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, humanAck]);

      // Save human coach acknowledgement
      try {
        await saveChatMessage({
          id: humanAck.id,
          text: humanAck.text,
          sender: humanAck.sender,
          timestamp: humanAck.timestamp,
          userId: currentUserId!,
          userDisplayName: onboardingData.name
        });
      } catch (error) {
        glowLogger.error('Failed to save human coach ack', {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      // Send email notification to coach (fire and forget - don't block UI)
      (async () => {
        try {
          let coachEmail: string | null = null;
          
          // Try to get coach email using coachId from onboarding data first
          if (onboardingData.coachId) {
            glowLogger.info('Attempting to get coach email by coachId', {
              coach_id: String(onboardingData.coachId),
              user_id: currentUserId
            });
            coachEmail = await getCoachEmailById(onboardingData.coachId);
          }
          
          // Fallback: if no coachId or email not found, look up via coach_user table
          if (!coachEmail && currentUserId) {
            glowLogger.info('Fallback: attempting to get coach email via coach_user table', {
              user_id: currentUserId
            });
            coachEmail = await getCoachEmailForUser(currentUserId);
          }
          
          if (coachEmail) {
            await notifyCoachOfUserMessage(coachEmail, onboardingData.name);
            glowLogger.info('Coach notified via email', {
              coach_id: String(onboardingData.coachId || 'looked_up'),
              user_name: onboardingData.name,
              user_id: currentUserId
            });
          } else {
            glowLogger.warn('Could not find coach email to send notification', {
              has_coach_id: !!onboardingData.coachId,
              coach_id: String(onboardingData.coachId || 'none'),
              user_id: currentUserId,
              selected_coach: onboardingData.selectedCoach
            });
          }
        } catch (emailError) {
          glowLogger.error('Failed to send email notification to coach', {
            error: emailError instanceof Error ? emailError.message : String(emailError),
            user_id: currentUserId
          });
        }
      })();

      // Record conversation (user input + ack)
      try {
        await addConversationEntry(userInput, humanAck.text, currentUserId!, onboardingData.name);
      } catch (conversationError) {
        glowLogger.error('Failed to record human coach conversation', {
          error: conversationError instanceof Error ? conversationError.message : String(conversationError)
        });
      }
      return;
    }

    // AI coach path
    glowLogger.info('setIsCoachTyping(true) - AI coach responding', {});
    setIsCoachTyping(true);
    try {
      let mergedSnapshot = dataSnapshot;
      if (weeklyReportCoachContextRef.current) {
        const block = weeklyReportCoachContextRef.current;
        weeklyReportCoachContextRef.current = null;
        mergedSnapshot = mergedSnapshot ? `${block}\n\n---\n\n${mergedSnapshot}` : block;
      }
      const coachResponseText = await llmService.chatWithCoach(
        userInput,
        onboardingData,
        currentUserId || undefined,
        mergedSnapshot,
      );
      const coachResponse: Message = {
        id: (Date.now() + 1).toString(),
        text: coachResponseText,
        sender: 'ai_coach',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, coachResponse]);

      // Save coach response
      try {
        await saveChatMessage({
          id: coachResponse.id,
          text: coachResponse.text,
          sender: coachResponse.sender,
          timestamp: coachResponse.timestamp,
          userId: currentUserId!,
          userDisplayName: onboardingData.name
        });
      } catch (error) {
        glowLogger.error('Failed to save coach message', {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      // Record conversation
      try {
        await addConversationEntry(userInput, coachResponseText, currentUserId!, onboardingData.name);
        glowLogger.info('Conversation recorded successfully', {});
      } catch (conversationError) {
        glowLogger.error('Failed to record conversation', {
          error: conversationError instanceof Error ? conversationError.message : String(conversationError)
        });
      }
    } catch (error) {
      glowLogger.error('Error in sendMessage (AI path)', {
        error: error instanceof Error ? error.message : String(error)
      });
      const errorResponse: Message = {
        id: (Date.now() + 1).toString(),
        text: t('chat:aiChatTemporaryError'),
        sender: 'ai_coach',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorResponse]);
      try {
        await saveChatMessage({
          id: errorResponse.id,
          text: errorResponse.text,
          sender: errorResponse.sender,
          timestamp: errorResponse.timestamp,
          userId: currentUserId!,
          userDisplayName: onboardingData.name
        });
      } catch (saveError) {
        glowLogger.error('Failed to save error message', {
          error: saveError instanceof Error ? saveError.message : String(saveError)
        });
      }
    } finally {
      glowLogger.info('setIsCoachTyping(false) - AI response complete', {});
      setIsCoachTyping(false);
    }
  };

  const handleHamburgerPress = async () => {
    try {
      glowLogger.info('Hamburger menu opened, fetching current user profile', {});
      
      // Fetch current user profile from Supabase
      const userProfile = await getRemoteUserProfileLoggedInUser();
      
      if (userProfile) {
        setCurrentUserProfile(userProfile);
        glowLogger.info('User profile fetched successfully for hamburger menu', {
          user_id: userProfile.user_id,
          display_name: userProfile.display_name,
          timezone: userProfile.timezone
        });
      } else {
        glowLogger.warn('No user profile found for hamburger menu', {});
        setCurrentUserProfile(null);
      }
    } catch (error) {
      glowLogger.error('Failed to fetch user profile for hamburger menu', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Set to null on error so hamburger menu still opens
      setCurrentUserProfile(null);
    }
    
    setShowBottomSheet(true);
  };

  const handleCloseBottomSheet = () => {
    setShowBottomSheet(false);
  };

  const handleShowPlan = async () => {
    try {
      // Fetch current user profile if not already loaded
      if (!currentUserProfile) {
        glowLogger.info('Fetching user profile for PlanView', {});
        const userProfile = await getRemoteUserProfileLoggedInUser();
        if (userProfile) {
          setCurrentUserProfile(userProfile);
          glowLogger.info('User profile fetched successfully for PlanView', {
            user_id: userProfile.user_id,
            display_name: userProfile.display_name || 'unknown'
          });
        } else {
          glowLogger.warn('No user profile found for PlanView', {});
          return; // Don't show plan if no profile
        }
      }
    } catch (error) {
      glowLogger.error('Failed to fetch user profile for PlanView', {
        error: error instanceof Error ? error.message : String(error)
      });
      return; // Don't show plan if profile fetch fails
    }
    
    setShowPlanView(true);
  };

  const handleClosePlanView = () => {
    setShowPlanView(false);
  };

  const handleConfirmPlanEditFromButton = async () => {
    const currentPending = pendingPlanEditRef.current;
    if (!currentPending) return;

    if (!currentUserProfile) {
      const profile = await getRemoteUserProfileLoggedInUser();
      if (profile) setCurrentUserProfile(profile);
    }

    const combinedFeedback = currentPending.feedback.join('. ');
    setEditPlanChatStepIndex(currentPending.stepIndex ?? undefined);
    setEditPlanChatFeedback(currentPending.stepIndex !== null ? combinedFeedback : undefined);
    setPendingPlanEdit(null);
    setShowEditPlanFromChat(true);
  };

  const handleCancelPlanEditFromButton = () => {
    setPendingPlanEdit(null);
  };

  const handleCloseEditPlanFromChat = () => {
    setShowEditPlanFromChat(false);
    setEditPlanChatStepIndex(undefined);
    setEditPlanChatFeedback(undefined);
    setPendingPlanEdit(null);
  };

  const handleEditPlanSaveFromChat = (selectedStepIndex: number, feedback: string) => {
    glowLogger.info('Plan edited from chat', { selectedStepIndex, feedback });
    setShowEditPlanFromChat(false);
    setEditPlanChatStepIndex(undefined);
    setEditPlanChatFeedback(undefined);
    setPendingPlanEdit(null);
    onNavigateToPlanDetails?.(selectedStepIndex);
  };

  const handleShowCheckinDay = async () => {
    try {
      // Fetch current user profile if not already loaded
      if (!currentUserProfile) {
        const userProfile = await getRemoteUserProfileLoggedInUser();
        if (userProfile) {
          setCurrentUserProfile(userProfile);
        }
      }
    } catch (error) {
      glowLogger.error('Failed to fetch user profile for CheckinDay', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    setShowCheckinDay(true);
  };

  const handleCloseCheckinDay = () => {
    setShowCheckinDay(false);
  };

  const handleShowDeveloper = () => {
    glowLogger.info('Opening developer mode', {});
    // Close any other modals first
    setShowBottomSheet(false);
    setShowCoachDetails(false);
    setShowPlanView(false);
    setShowCheckinDay(false);
    setShowOnboardData(false);
    
    // Small delay to ensure other modals are closed
    setTimeout(() => {
      setShowDeveloperMode(true);
    }, 100);
  };

  const handleCloseDeveloper = () => {
    glowLogger.info('Closing developer mode', {});
    setShowDeveloperMode(false);
  };

  const handleShowOnboardData = () => {
    glowLogger.info('Opening onboard data from developer mode', {});
    // Close developer mode first, then show onboard data
    setShowDeveloperMode(false);
    
    setTimeout(() => {
      setShowOnboardData(true);
    }, 100);
  };

  const handleCloseOnboardData = () => {
    glowLogger.info('Closing onboard data', {});
    setShowOnboardData(false);
  };

  const handleResetAndLogout = () => {
    Alert.alert(
      t('chat:resetLogoutTitle'),
      t('chat:resetLogoutBody'),
      [
        {
          text: t('common:cancel'),
          style: 'cancel',
        },
        {
          text: t('chat:resetLogoutTitle'),
          style: 'destructive',
          onPress: async () => {
            try {
              setShowBottomSheet(false);
              
              // Get current user before clearing data
              const currentUser = await getCurrentLoggedInUser();
              
              if (currentUser) {
                await deleteLoggedInUser(currentUser.id);
              }
              
              await clearAllChatHistory();
              if (onLogout) {
                onLogout();
              } else {
                // Fallback - reload the app
                window.location?.reload?.();
              }
            } catch (error) {
              glowLogger.error('Error during logout', {
                error: error instanceof Error ? error.message : String(error)
              });
              Alert.alert(t('common:error'), t('chat:errorLogoutFailed'));
            }
          },
        },
      ]
    );
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const messageYear = date.getFullYear();
    const isToday = now.toDateString() === date.toDateString();
    const isEs = Boolean(i18n.language?.startsWith('es'));
    const loc = isEs ? 'es' : 'en-US';

    const timeString = date
      .toLocaleTimeString(loc, {
        hour: 'numeric',
        minute: '2-digit',
        ...(isEs ? {} : { hour12: true }),
      })
      .toLowerCase();

    if (isToday) {
      return timeString;
    }

    if (isEs) {
      const datePart = date.toLocaleDateString('es', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        ...(messageYear !== currentYear ? { year: 'numeric' } : {}),
      });
      return `${timeString} ${datePart}`;
    }

    const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
    const monthDay = date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
    });
    const day = date.getDate();
    const ordinalSuffix = getOrdinalSuffix(day);
    const dayWithSuffix = day + ordinalSuffix;
    const monthDayWithOrdinal = monthDay.replace(day.toString(), dayWithSuffix);
    const yearString = messageYear !== currentYear ? ` ${messageYear}` : '';
    return `${timeString} ${dayOfWeek} ${monthDayWithOrdinal}${yearString}`;
  };

  const getOrdinalSuffix = (day: number) => {
    if (day >= 11 && day <= 13) {
      return 'th';
    }
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };

  const getUserFocus = () => {
    return onboardingData.selectedModules?.[0] || 'general wellness';
  };

  const getCoachImage = (imageName: string) => {
    return coachImages[imageName as keyof typeof coachImages] || null;
  };

  const getCoachInfo = () => {
    // Load coach info from config
    try {
      const config = require('../assets/onboarding_config');
      return config.general_info?.coach_selection?.[onboardingData.selectedCoach];
    } catch (error) {
      glowLogger.error('Error loading coach config', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  };

  const handleCoachInfoPress = () => {
    setShowCoachDetails(true);
  };

  const handleCloseCoachDetails = () => {
    setShowCoachDetails(false);
  };

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showIntroOverlay) {
        setShowIntroOverlay(false);
        return true;
      }
      if (isMealCommentsModalVisible) {
        setIsMealCommentsModalVisible(false);
        setSelectedImageUri(null);
        setMealComments('');
        return true;
      }
      if (isMealLogOptionsModalVisible) {
        setIsMealLogOptionsModalVisible(false);
        return true;
      }
      if (showConsistencyModal) {
        setShowConsistencyModal(false);
        return true;
      }
      if (showCheckinDay) {
        setShowCheckinDay(false);
        return true;
      }
      if (showEditPlanFromChat) {
        setShowEditPlanFromChat(false);
        setEditPlanChatStepIndex(undefined);
        setEditPlanChatFeedback(undefined);
        pendingPlanEditRef.current = null;
        return true;
      }
      if (showPlanView) {
        setShowPlanView(false);
        return true;
      }
      if (showDeveloperMode) {
        setShowDeveloperMode(false);
        return true;
      }
      if (showOnboardData) {
        setShowOnboardData(false);
        return true;
      }
      if (showCoachDetails) {
        setShowCoachDetails(false);
        return true;
      }
      if (showBottomSheet) {
        setShowBottomSheet(false);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [
    showIntroOverlay,
    isMealCommentsModalVisible,
    isMealLogOptionsModalVisible,
    showConsistencyModal,
    showCheckinDay,
    showEditPlanFromChat,
    showPlanView,
    showDeveloperMode,
    showOnboardData,
    showCoachDetails,
    showBottomSheet,
  ]);

  const reloadOnboardingData = async () => {
    try {
      const userProfileData = await getRemoteUserProfileLoggedInUser();
      if (userProfileData) {
        glowLogger.info('Successfully reloaded onboarding data', {
          new_coach: userProfileData.onboardingProfile.selectedCoach,
          new_goal: userProfileData.onboardingProfile.selectedGoal,
          new_email: userProfileData.onboardingProfile.email
        });
        setLocalOnboardingData(userProfileData.onboardingProfile);
        
        // Store user info for potential retry
        setCurrentUserId(userProfileData.user_id);
        setCurrentUserDisplayName(userProfileData.onboardingProfile.name);
        
        // Update GlowLogger with the current user name and local user ID
        if (userProfileData.onboardingProfile?.name && userProfileData.onboardingProfile?.localUserId) {
          glowLogger.setUserIdentifier(
            userProfileData.onboardingProfile.name,
            userProfileData.onboardingProfile.localUserId
          );
          glowLogger.info('GlowLogger updated after profile reload', {
            user_display_name: userProfileData.onboardingProfile.name,
            local_user_id: userProfileData.onboardingProfile.localUserId
          });
        }
        
        // Reload chat history with sync (fetches new messages from Supabase)
        // CRITICAL: Uses user_id (UUID) for unique identification
        glowLogger.info('Reloading chat history for updated profile with sync', {});
        try {
          const syncResult = await syncAndLoadChatHistory(userProfileData.user_id);
          
          // Update sync status
          if (syncResult.syncStatus === 'failed') {
            setMessageSyncStatus('failed');
          } else {
            setMessageSyncStatus('idle');
          }
          
          if (syncResult.messages.length > 0) {
            setMessages(syncResult.messages.map(parseRawMessage));
          }
        } catch (chatError) {
          glowLogger.error('[ChatScreen] Error reloading chat history', {
            error: chatError instanceof Error ? chatError.message : String(chatError)
          });
          setMessageSyncStatus('failed');
        }
      }
    } catch (error) {
      glowLogger.error('[ChatScreen] Error reloading onboarding data', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const reloadOnboardingDataAndChat = async () => {
    try {
      const userProfileData = await getRemoteUserProfileLoggedInUser();
      if (userProfileData) {
        glowLogger.info('Successfully reloaded onboarding data for profile restoration', {
          new_coach: userProfileData.onboardingProfile.selectedCoach,
          new_goal: userProfileData.onboardingProfile.selectedGoal,
          new_email: userProfileData.onboardingProfile.email
        });
        
        // Update local onboarding data first
        setLocalOnboardingData(userProfileData.onboardingProfile);
        
        // Store user info for potential retry
        setCurrentUserId(userProfileData.user_id);
        setCurrentUserDisplayName(userProfileData.onboardingProfile.name);
        
        // CRITICAL: Update GlowLogger with the restored user name and local user ID
        // Use localUserId from onboarding profile if available, otherwise use user_id as fallback
        const loggerUserId = userProfileData.onboardingProfile?.localUserId || userProfileData.user_id;
        glowLogger.setUserIdentifier(
          userProfileData.onboardingProfile.name,
          loggerUserId
        );
        glowLogger.info('GlowLogger updated after profile restoration', {
          user_display_name: userProfileData.onboardingProfile.name,
          local_user_id: loggerUserId,
          used_fallback: !userProfileData.onboardingProfile?.localUserId
        });
        
        // Clear current messages immediately
        setMessages([]);
        glowLogger.info('setIsCoachTyping(false) - profile restoration: cleared messages', {});
        setIsCoachTyping(false);
        
        // For profile restoration, load chat history with sync (fetches from Supabase)
        // CRITICAL: Uses user_id (UUID) for unique identification
        glowLogger.info('Loading chat history for restored profile with sync', { 
          user_id: userProfileData.user_id
        });
        try {
          const syncResult = await syncAndLoadChatHistory(userProfileData.user_id);
          
          // Update sync status
          if (syncResult.syncStatus === 'failed') {
            setMessageSyncStatus('failed');
          } else {
            setMessageSyncStatus('idle');
          }
          
          if (syncResult.messages.length > 0) {
            glowLogger.info(`Found existing messages for restored profile (with sync)`, { 
              message_count: syncResult.messages.length,
              sync_status: syncResult.syncStatus
            });
            setMessages(syncResult.messages.map(parseRawMessage));
          } else {
            glowLogger.info('No existing chat history for restored profile - welcome messages only generated during onboarding', {});
            // Do not generate welcome messages during profile restore
          }
        } catch (chatError) {
          glowLogger.error('[ChatScreen] Error loading chat history for restored profile', {
            error: chatError instanceof Error ? chatError.message : String(chatError)
          });
          setMessageSyncStatus('failed');
          // Do not generate welcome message as fallback - only during onboarding completion
        }
      }
    } catch (error) {
      glowLogger.error('[ChatScreen] Error reloading onboarding data and chat', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const addNotificationAsCoachMessage = async (notificationBody: string, sender?: 'ai_coach' | 'human_coach') => {
    try {
      // Default to ai_coach if no sender specified
      const messageSender = sender || 'ai_coach';
      
      // Check if the most recent message is the same to avoid duplicates
      const isDuplicate = messages.length > 0 && 
        messages[messages.length - 1].sender === messageSender &&
        messages[messages.length - 1].text === notificationBody;

      if (isDuplicate) {
        glowLogger.info('Skipping duplicate notification message', {
          message_text: notificationBody,
          user_name: onboardingData.name,
          sender: messageSender,
          reason: 'Same text as most recent coach message'
        });
        return;
      }

      const coachMessage: Message = {
        id: Date.now().toString(), // Use normal ID format, no notification_prefix
        text: notificationBody,
        sender: messageSender,
        timestamp: new Date()
      };

      // Add to messages state
      setMessages(prev => [...prev, coachMessage]);

      glowLogger.info('Saving chat message', {
        message_id: coachMessage.id,
        message_text: notificationBody,
        user_name: onboardingData.name,
        sender: messageSender,
        is_from_notification: true
      });

      // Save to database with explicit notification flag
      await saveChatMessage({
        id: coachMessage.id,
        text: coachMessage.text,
        sender: coachMessage.sender,
        timestamp: coachMessage.timestamp,
        userId: currentUserId!,
        userDisplayName: onboardingData.name,
        isFromNotification: true // Explicitly mark as notification
      });

      glowLogger.info('Notification added as coach message', {
        message_id: coachMessage.id,
        message_text: notificationBody,
        user_name: onboardingData.name,
        sender: messageSender,
        is_from_notification: true
      });

      // Record in conversation history for backwards compatibility
      try {
        await addConversationEntry('', notificationBody, currentUserId!, onboardingData.name);
      } catch (conversationError) {
        glowLogger.error('Failed to record notification in conversation', {
          error: conversationError instanceof Error ? conversationError.message : String(conversationError)
        });
      }
    } catch (error) {
      glowLogger.error('Failed to add notification as coach message', {
        error: error instanceof Error ? error.message : String(error),
        notification_body: notificationBody,
        sender: sender || 'ai_coach'
      });
    }
  };

  const coachInfo = getCoachInfo();
  const coachImage = coachInfo ? getCoachImage(coachInfo.image) : null;
  const effectiveCoachImage = coachMode === 'human' ? coachImage : null; // NEW

  useEffect(() => {
    // Plan progress is now calculated from checkin data in the checkin progress useEffect
    // This useEffect is kept for future plan-related progress calculations
  }, [localOnboardingData]);

  const introTutorialHandledRef = useRef(false);
  useEffect(() => {
    // Wait until the live coach_type has resolved (or there is no coachId to
    // resolve) so the AI/human switch tutorial only shows for true hybrid coaches.
    if (introTutorialHandledRef.current) return;
    if (onboardingData.coachId != null && liveCoachType === null) return;
    introTutorialHandledRef.current = true;
    // On initial load, check active user intro tutorial flag
    // Only show the AI/human switch tutorial for hybrid coach types
    (async () => {
      try {
        const user = await getActiveLoggedInUser();
        if (user && !user.seen_intro_tutorial) {
          if (isHumanChatAvailable) {
            setShowIntroOverlay(true);
          }
          await setUserSeenIntroTutorial(user.id);
          glowLogger.info('Intro tutorial set to seen for active user on ChatScreen load', {
            user_id: user.id,
            display_name: user.display_name,
            coach_type: effectiveCoachType,
            overlay_shown: isHumanChatAvailable,
          });
        }
      } catch (e) {
        glowLogger.error('Failed to set intro tutorial seen on ChatScreen load', {
          error: e instanceof Error ? e.message : String(e)
        });
      }
    })();
  }, [liveCoachType, effectiveCoachType, isHumanChatAvailable, onboardingData.coachId]);

  // Render main content based on active tab
  const renderTabContent = () => {
    switch (activeTab) {
      case 'home':
        return (
          <CoachDashboard
            onboardingData={onboardingData}
            onNavigateToChat={() => setActiveTab('home')}
            initialShowStreak={shouldShowStreak}
            onInitialShowStreakHandled={() => setShouldShowStreak(false)}
          />
        );
      case 'plan':
        return (
          <PlanView
            onboardingData={onboardingData}
          />
        );
      case 'progress':
        return (
          <ProgressScreen
            onOpenActivityLog={onOpenActivityLogFromChat}
          />
        );
      case 'games':
        return <CommunityScreen onboardingData={onboardingData} />;
      default:
        return null;
    }
  };

  // The app runs edge-to-edge (Expo SDK 55 / RN 0.83), so the window does NOT
  // resize for the keyboard on Android; we lift the chat column in JS by the
  // measured keyboard height.
  // - Android: keyboardDidShow reports the height from the top of the nav bar,
  //   so we lift by the full height (subtracting insets.bottom would leave the
  //   input partially behind the keyboard).
  // - iOS: keyboardWillShow reports the height from the true screen bottom, and
  //   the SafeAreaView already reserves insets.bottom, so we subtract it.
  const chatContainerKeyboardInset =
    keyboardHeight > 0
      ? Platform.OS === 'android'
        ? keyboardHeight
        : Math.max(0, keyboardHeight - insets.bottom)
      : 0;

  const renderChatContent = () => {
    const messagesAndInput = (
      <>
          {/* Error Ribbon for chat load failure */}
          {chatLoadError && (
            <View style={styles.errorRibbon}>
              <Text style={styles.errorRibbonText}>{chatLoadError}</Text>
              <TouchableOpacity 
                style={styles.retryButton} 
                onPress={handleRetryChatLoad}
                disabled={isRetryingChatLoad}
              >
                <Text style={styles.retryButtonText}>
                  {isRetryingChatLoad ? t('chat:errorRibbonRetrying') : t('chat:errorRibbonRetryNow')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          
          {/* Message Sync Status Ribbon */}
          {messageSyncStatus === 'failed' && (
            <View style={styles.syncFailedRibbon}>
              <Text style={styles.syncRibbonText}>
                {t('chat:syncFailed')}
              </Text>
              <TouchableOpacity 
                style={styles.syncRetryButton} 
                onPress={handleRetryMessageSync}
                disabled={isRetryingMessageSync}
              >
                <Text style={styles.syncRetryButtonText}>
                  {isRetryingMessageSync ? t('chat:syncingMessages') : t('chat:retrySync')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          {messageSyncStatus === 'syncing' && (
            <View style={styles.syncingRibbon}>
              <Text style={styles.syncRibbonText}>{t('chat:syncingMessages')}</Text>
            </View>
          )}

          {/* Always-visible Sync Messages Button */}
          {messageSyncStatus !== 'syncing' && (
            <TouchableOpacity 
              style={styles.syncMessagesButton} 
              onPress={handleRetryMessageSync}
              disabled={isRetryingMessageSync}
            >
              <View style={styles.syncMessagesButtonContent}>
                <Icon source={appIcons.refresh} width={10} height={10} fill="rgba(255, 255, 255, 0.7)" />
                <Text style={styles.syncMessagesButtonText}>{t('chat:syncMessagesFromCoach')}</Text>
              </View>
            </TouchableOpacity>
          )}

          <ScrollView
            ref={scrollViewRef}
            style={styles.messagesContainer}
            contentContainerStyle={[
              styles.messagesContent,
              { paddingBottom: keyboardHeight > 0 ? 20 : 8 }
            ]}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="never"
            keyboardDismissMode="interactive"
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onContentSizeChange={handleContentSizeChange}
          >
              {/* Load more indicator at the top */}
              {hasMoreMessages && (
                <TouchableOpacity 
                  style={styles.loadMoreContainer}
                  onPress={loadMoreMessages}
                  disabled={isLoadingMore}
                >
                  <Text style={styles.loadMoreText}>
                    {isLoadingMore ? t('chat:loading') : t('chat:loadEarlierMessages')}
                  </Text>
                </TouchableOpacity>
              )}
              {messages.map((message) => (
                <View
                  key={message.id}
                  style={[
                    styles.messageContainer,
                    message.sender === 'user' ? styles.userMessageContainer : styles.coachMessageContainer
                  ]}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      message.sender === 'user' 
                        ? styles.userMessageBubble 
                        : message.sender === 'human_coach'
                        ? styles.humanCoachMessageBubble
                        : styles.coachMessageBubble
                    ]}
                  >
                    {message.imageUri && (
                      <Image 
                        source={{ uri: message.imageUri }} 
                        style={styles.messageImage}
                        resizeMode="cover"
                      />
                    )}
                    <MarkdownText
                      text={getMessageDisplayText(message)}
                      style={[
                        styles.messageText,
                        message.sender === 'user' ? styles.userMessageText : styles.coachMessageText
                      ]}
                      linkColor={message.sender === 'user' ? '#B3D9FF' : '#F47C3C'}
                    />
                    {(() => {
                      const isMealSuccessBubble =
                        message.isMealLoggedSuccess || isMealLoggedSuccessText(message.text);
                      const analysis = message.mealAnalysis ?? mealAnalysisMapRef.current.get(message.id);
                      if (!analysis || !nutritionTargets || isMealSuccessBubble) return null;
                      if (!message.isMealAnalysisLogged) return null;
                      const isPending =
                        (pendingMealAnalysis || isConfirmingMeal) &&
                        message.id === activeMealCoachMessageId;
                      if (isPending) return null;
                      return (
                        <>
                          {analysis.foodQuantities ? (
                            <View style={{ marginTop: 20, marginBottom: 2 }}>
                              <MealQuantityEditor
                                analysis={analysis}
                                onAnalysisChange={() => {}}
                                readOnly
                                inline
                              />
                            </View>
                          ) : null}
                          <MacrosChart
                            carbs={Math.ceil(analysis.carbs)}
                            protein={Math.ceil(analysis.protein)}
                            fat={Math.ceil(analysis.fat)}
                            fiber={Math.ceil(analysis.fiber)}
                            totalCalories={Math.ceil(analysis.calories)}
                            carbsTarget={nutritionTargets.carbsTarget}
                            proteinTarget={nutritionTargets.proteinTarget}
                            fatTarget={nutritionTargets.fatTarget}
                            fiberTarget={nutritionTargets.fiberTarget}
                            caloriesTarget={nutritionTargets.caloriesTarget}
                            showFooter={false}
                            showTargetInBars={false}
                            compact
                          />
                          <TouchableOpacity
                            style={styles.mealLogAgainButton}
                            onPress={() => void injectMealRelogFlow(analysis)}
                            activeOpacity={0.85}
                          >
                            <Text style={styles.mealLogAgainButtonText}>{t('progress:logAgain')}</Text>
                          </TouchableOpacity>
                        </>
                      );
                    })()}
                    {(() => {
                      const isMealSuccessBubble =
                        message.isMealLoggedSuccess || isMealLoggedSuccessText(message.text);
                      if (!isMealSuccessBubble) return null;
                      return (
                        <TouchableOpacity
                          style={styles.dailyProgressLink}
                          onPress={() => {
                            if (onBackToHome) {
                              onBackToHome({ scrollToSection: 'nutrition' });
                            }
                          }}
                        >
                          <Text style={styles.dailyProgressText}>see daily progress</Text>
                          <Text style={styles.dailyProgressArrow}>→</Text>
                        </TouchableOpacity>
                      );
                    })()}
                    {message.isMealLogFailed && message.mealFailureKind && (
                      <TouchableOpacity
                        style={styles.mealLogAgainButton}
                        onPress={() => handleMealFailureRetry(message)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.mealLogAgainButtonText}>{t('chat:retryMealLog')}</Text>
                      </TouchableOpacity>
                    )}
                    {message.id === planEditConfirmationMessageId && (
                      <View style={styles.planConfirmButtons}>
                        <TouchableOpacity
                          style={styles.planConfirmCancel}
                          onPress={handleCancelPlanEditFromButton}
                        >
                          <Text style={styles.planConfirmCancelText}>{t('chat:planEditCancel')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.planConfirmOk}
                          onPress={handleConfirmPlanEditFromButton}
                        >
                          <Text style={styles.planConfirmOkText}>{t('chat:planEditProceed')}</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {message.workoutData && (
                      <WorkoutSummaryCard
                        workout={message.workoutData}
                        isProposal={message.isWorkoutProposal}
                        alreadyInPlan={isWorkoutFromPlan(message.workoutData)}
                        onLogWorkout={(w) => onOpenWorkoutLogFromChat?.(w)}
                        onSaveToPlan={(w) => onSaveWorkoutToPlan?.(w)}
                      />
                    )}
                    <View style={styles.messageFooter}>
                      <Text
                        style={[
                          styles.messageTime,
                          message.sender === 'user' ? styles.userMessageTime : styles.coachMessageTime
                        ]}
                      >
                        {formatTime(message.timestamp)}
                      </Text>
                      {(message.sender === 'ai_coach' || message.sender === 'human_coach') && (
                        message.sender === 'ai_coach' ? (
                          <Icon source={appIcons.cognition} width={20} height={20} fill="#FFFFFF" />
                        ) : (
                          coachImage ? (
                            <Image
                              source={coachImage}
                              style={styles.coachPhotoIconLarge}
                            />
                          ) : (
                            <Icon source={appIcons.cognition} width={20} height={20} fill="#FFFFFF" />
                          )
                        )
                      )}
                    </View>
                  </View>
                </View>
              ))}
              {pendingMealAnalysis && (
                <View>
                  <MealQuantityEditor
                    key={`pending_${pendingMealAnalysis.foodQuantities}_${pendingMealAnalysis.carbs}_${pendingMealAnalysis.protein}_${pendingMealAnalysis.fat}`}
                    analysis={pendingMealAnalysis}
                    onAnalysisChange={onPendingMealQtyAnalysisChange}
                  />
                  {nutritionTargets && (() => {
                    const liveAnalysis = editedMealAnalysis || pendingMealAnalysis;
                    return (
                      <View style={styles.liveMacrosContainer}>
                        <MacrosChart
                          carbs={Math.ceil(liveAnalysis.carbs)}
                          protein={Math.ceil(liveAnalysis.protein)}
                          fat={Math.ceil(liveAnalysis.fat)}
                          fiber={Math.ceil(liveAnalysis.fiber)}
                          totalCalories={Math.ceil(liveAnalysis.calories)}
                          carbsTarget={nutritionTargets.carbsTarget}
                          proteinTarget={nutritionTargets.proteinTarget}
                          fatTarget={nutritionTargets.fatTarget}
                          fiberTarget={nutritionTargets.fiberTarget}
                          caloriesTarget={nutritionTargets.caloriesTarget}
                          showFooter={false}
                          showTargetInBars={false}
                          compact
                        />
                      </View>
                    );
                  })()}
                  <LogDateSelector
                    selectedDate={mealLogDate}
                    onDateChange={setMealLogDate}
                  />
                  {mealSaveError ? (
                    <Text style={styles.mealSaveErrorText}>{mealSaveError}</Text>
                  ) : null}
                  <View style={styles.mealConfirmButtonsContainer}>
                    <TouchableOpacity
                      style={[styles.mealConfirmButton, styles.cancelButton]}
                      onPress={handleCancelMeal}
                      disabled={isConfirmingMeal}
                    >
                      <Text style={styles.cancelButtonText}>{t('chat:cancelMeal')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.mealConfirmButton, styles.okButton, isConfirmingMeal && styles.mealConfirmButtonDisabled]}
                      onPress={() => {
                        if (mealSaveError) {
                          setMealSaveError(null);
                        }
                        void handleConfirmMeal();
                      }}
                      disabled={isConfirmingMeal}
                    >
                      <Text style={styles.okButtonText}>
                        {isConfirmingMeal
                          ? t('chat:savingMeal')
                          : mealSaveError
                            ? t('chat:retryMealLog')
                            : '✓ Log This Meal'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              {isCoachTyping && (
                <View style={[styles.messageContainer, styles.coachMessageContainer]}>
                  <View style={[styles.messageBubble, styles.coachMessageBubble]}>
                    <Text style={[styles.messageText, styles.coachMessageText]}>
                      {t('chat:aiCoachIsTyping', { coach: onboardingData.selectedCoach })}
                    </Text>
                  </View>
                </View>
              )}
          </ScrollView>

          {/* REPLACED INLINE INPUT WITH COMPONENT */}
          <ChatMessageBox
            onSend={sendMessage}
            disabled={isCoachTyping || !!chatLoadError}
            coachTyping={isCoachTyping}
            placeholder={chatLoadError ? t('chat:chatDisabledPlaceholder') : t('chat:typePlaceholder')}
            maxLength={2000}
            initialText={prefilledMessage || tempPrefilledMessage || ''}
            onOpenMealLogModal={() => setIsMealLogOptionsModalVisible(true)}
          />
      </>
    );

    return (
    <View style={styles.container}>
      <View style={styles.keyboardAvoidingView}>
        {/* Header (top bar only) */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerLeft}>
              <HamburgerButton onPress={handleHamburgerPress} />
            </View>

            <TouchableOpacity onPress={handleCoachInfoPress} style={styles.headerCenter} accessibilityRole="button" accessibilityLabel={t('chat:a11yCoachDetails')}>
              <View style={styles.coachInfoContainer}>
                {coachMode === 'ai' ? (
                  <View style={[styles.headerCoachImage, { justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)' }]}>
                    <Icon source={appIcons.cognition} width={30} height={30} fill="#FFFFFF" />
                  </View>
                ) : effectiveCoachImage ? (
                  onboardingData.selectedCoach !== 'Ruth' ? (
                    <View style={{ width: 48, height: 48, borderRadius: 24, overflow: 'hidden', marginRight: 14 }}>
                      <Image 
                        source={effectiveCoachImage} 
                        style={{ 
                          width: 48, 
                          height: 64,
                          marginTop: onboardingData.selectedCoach === 'Alonso' ? -8 : 0
                        }}
                        resizeMode="cover"
                      />
                    </View>
                  ) : (
                    <Image source={effectiveCoachImage} style={styles.headerCoachImage} />
                  )
                ) : (
                  <View style={styles.headerCoachImagePlaceholder}>
                    <Text style={styles.headerCoachImageText}>
                      {onboardingData.selectedCoach.charAt(0)}
                    </Text>
                  </View>
                )}
                <View style={styles.coachNameContainer}>
                  <Text style={styles.headerTitle}>
                    {onboardingData.selectedCoach}
                  </Text>
                  <Text style={styles.headerSubtitle}>
                    {coachMode === 'ai' ? t('chat:labelAI') : t('chat:labelHuman')}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            <View style={styles.headerRight}>
              <TouchableOpacity 
                onPress={() => onBackToHome?.()} 
                style={styles.homeButton}
                accessibilityRole="button"
                accessibilityLabel={t('chat:a11yBackToHome')}
              >
                <Icon source={appIcons.home_actual} width={20} height={20} fill="#F47C3C" />
                <Text style={styles.homeButtonText}>{t('chat:homeButton')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Mode Switch Bar - Below the Header */}
        <View style={styles.modeSwitchContainer}>
          <TouchableOpacity 
            style={[styles.modeSwitchButton, coachMode === 'ai' && styles.modeSwitchButtonActive]}
            onPress={() => setCoachMode('ai')}
            accessibilityRole="button"
            accessibilityLabel={t('chat:a11ySwitchAiMode')}
          >
            <Text style={[styles.modeSwitchText, coachMode === 'ai' && styles.modeSwitchTextActive]}>
              {t('chat:aiChat')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[
              styles.modeSwitchButton, 
              coachMode === 'human' && isHumanChatAvailable && styles.modeSwitchButtonActive,
              !isHumanChatAvailable && styles.modeSwitchButtonDisabled
            ]}
            onPress={() => {
              if (!isHumanChatAvailable) {
                Alert.alert(
                  t('chat:humanCoachUnavailableTitle'),
                  t('chat:humanCoachUnavailableBody'),
                  [
                    {
                      text: t('chat:humanCoachSendEmail'),
                      onPress: () => {
                        const subject = t('chat:humanCoachEmailSubject');
                        const body = t('chat:humanCoachEmailBody', {
                          name: onboardingData.name,
                          coach: onboardingData.selectedCoach,
                        });
                        const mailtoUrl = `mailto:yourcoach@underforge.io?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                        
                        Linking.openURL(mailtoUrl).catch((err) => {
                          glowLogger.error('Failed to open email client', { error: err });
                          Alert.alert(t('common:error'), t('chat:errorOpenEmailClient', { email: 'yourcoach@underforge.io' }));
                        });
                      }
                    },
                    { text: t('common:cancel'), style: 'cancel' }
                  ]
                );
                return;
              }
              setCoachMode('human');
            }}
            accessibilityRole="button"
            accessibilityLabel={!isHumanChatAvailable ? t('chat:a11yHumanChatUnavailable') : t('chat:a11ySwitchCoachMode')}
          >
            <Text style={[
              styles.modeSwitchText, 
              coachMode === 'human' && isHumanChatAvailable && styles.modeSwitchTextActive,
              !isHumanChatAvailable && styles.modeSwitchTextDisabled
            ]}>
              {t('chat:humanChat')}
            </Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.chatContainer,
            chatContainerKeyboardInset > 0 && { paddingBottom: chatContainerKeyboardInset },
          ]}
        >
          {messagesAndInput}
        </View>
      </View>

      {/* Hamburger Menu - Only show when no other modals are open */}
      {!showDeveloperMode && !showOnboardData && !showPlanView && !showCoachDetails && !showCheckinDay && (
        <HamburgerMenu
          visible={showBottomSheet}
          onClose={handleCloseBottomSheet}
          onboardingData={onboardingData}
          currentUserProfile={currentUserProfile}
          onLogout={onLogout}
          onResetAndLogout={handleResetAndLogout}
          onShowPlan={handleShowPlan}
          onShowDeveloper={handleShowDeveloper}
        />
      )}

      {/* Plan View Modal */}
      {showPlanView && currentUserProfile && !showDeveloperMode && !showOnboardData && !showCheckinDay && (
        <PlanView
          userProfile={currentUserProfile}
          visible={showPlanView}
          onClose={handleClosePlanView}
        />
      )}

      {/* Edit Plan from Chat */}
      {showEditPlanFromChat && currentUserProfile && (
        <EditPlanModal
          visible={showEditPlanFromChat}
          userProfile={currentUserProfile}
          onClose={handleCloseEditPlanFromChat}
          onSave={handleEditPlanSaveFromChat}
          initialStepIndex={editPlanChatStepIndex}
          initialFeedback={editPlanChatFeedback}
        />
      )}

      {/* CheckinDay Modal */}
      {showCheckinDay && !showDeveloperMode && !showOnboardData && !showPlanView && (
        <CheckinDay
          visible={showCheckinDay}
          onClose={handleCloseCheckinDay}
          checkinProgress={checkinProgress}
          userProfile={currentUserProfile}
        />
      )}

      {/* Developer Mode Modal - Only show when onboard data is not showing */}
      {showDeveloperMode && !showOnboardData && !showPlanView && !showCheckinDay && (
        <DeveloperMode
          visible={showDeveloperMode}
          onClose={handleCloseDeveloper}
          onDebugCreateWeeklyReport={() => {
            setShowDeveloperMode(false);
            onDebugCreateWeeklyReport?.();
          }}
        />
      )}

      {/* Onboard Data Modal - Only show when developer mode is not showing */}
      {showOnboardData && !showDeveloperMode && !showPlanView && !showCheckinDay && (
        <DeveloperCoachEditPlan
          visible={showOnboardData}
          onClose={handleCloseOnboardData}
          onboardingData={localOnboardingData}
          readOnly={true}
        />
      )}

      {/* Coach Details Modal */}
      {!showDeveloperMode && !showOnboardData && !showPlanView && !showCheckinDay && (
        <CoachDetailsModal
          visible={showCoachDetails}
          onClose={handleCloseCoachDetails}
          coachInfo={coachInfo}
          coachName={onboardingData.selectedCoach}
        />
      )}

      {/* Consistency Celebration Modal */}
      <ConsistencyCelebrationModal
        visible={showConsistencyModal}
        score={consistencyScore}
        coachName={onboardingData.selectedCoach}
        onClose={() => setShowConsistencyModal(false)}
        onShowStreak={() => {
          setShowConsistencyModal(false);
          if (onBackToHome) {
            onBackToHome({ showStreak: true });
            return;
          }
          setActiveTab('home');
          setShouldShowStreak(true);
        }}
      />

      {showIntroOverlay && (
        <TouchableWithoutFeedback onPress={() => setShowIntroOverlay(false)}>
          <View style={styles.tutorialOverlay} pointerEvents="auto">
            <View style={styles.tutorialBubble}>
              <Text style={styles.tutorialBubbleText}>{t('chat:tutorialSwitchTip')}</Text>
              <Pressable style={styles.tutorialGotItButton} onPress={() => setShowIntroOverlay(false)}>
                <Text style={styles.tutorialGotItButtonText}>{t('chat:tutorialGotIt')}</Text>
              </Pressable>
              <View style={styles.tutorialBubblePointerUp} />
            </View>
          </View>
        </TouchableWithoutFeedback>
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
            <Text style={styles.mealLogOptionsTitle}>{t('chat:mealLogTitle')}</Text>
            <Text style={styles.mealLogOptionsSubtitle}>{t('chat:mealLogSubtitle')}</Text>
            <View style={styles.mealLogOptionsButtons}>
              <TouchableOpacity
                style={styles.mealLogOptionButton}
                onPress={async () => {
                  setIsMealLogOptionsModalVisible(false);
                  const imageUri = await openCamera();
                  if (imageUri) {
                    setSelectedImageUri(imageUri);
                    setMealComments('');
                    setIsMealCommentsModalVisible(true);
                  }
                }}
              >
                <Icon source={appIcons.camera} width={35} height={35} fill="#F47C3C" style={styles.mealOptionIconWrapper} />
                <Text style={styles.mealOptionTitle}>{t('chat:mealOptionPhoto')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mealLogOptionButton}
                onPress={async () => {
                  setIsMealLogOptionsModalVisible(false);
                  const imageUri = await openImageGallery();
                  if (imageUri) {
                    setSelectedImageUri(imageUri);
                    setMealComments('');
                    setIsMealCommentsModalVisible(true);
                  }
                }}
              >
                <Icon source={appIcons.gallery_thumbnail} width={35} height={35} fill="#F47C3C" style={styles.mealOptionIconWrapper} />
                <Text style={styles.mealOptionTitle}>{t('chat:mealOptionGallery')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mealLogOptionButton}
                onPress={() => {
                  setIsMealLogOptionsModalVisible(false);
                  setTempPrefilledMessage(t('main:prefilledMealMessage'));
                  setTimeout(() => {
                    setTempPrefilledMessage('');
                  }, 500);
                }}
              >
                <Icon source={appIcons.chat} width={35} height={35} fill="#F47C3C" style={styles.mealOptionIconWrapper} />
                <Text style={styles.mealOptionTitle}>{t('chat:mealOptionText')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mealLogOptionButton}
                onPress={() => {
                  setIsMealLogOptionsModalVisible(false);
                  onBackToHome?.({ scrollToSection: 'recentMeals' });
                }}
              >
                <Icon source={appIcons.clock} width={35} height={35} fill="#F47C3C" style={styles.mealOptionIconWrapper} />
                <Text style={styles.mealOptionTitle}>{t('home:mealOptionRecent')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </TouchableOpacity>
      </Modal>

      {/* Meal Comments Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isMealCommentsModalVisible}
        onRequestClose={() => {
          setIsMealCommentsModalVisible(false);
          setSelectedImageUri(null);
          setMealComments('');
        }}
      >
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.commentsModalContainer}
        >
          <TouchableOpacity
            style={styles.commentsModalOverlay}
            activeOpacity={1}
            onPress={() => {
              setIsMealCommentsModalVisible(false);
              setSelectedImageUri(null);
              setMealComments('');
            }}
          >
            <View style={[styles.commentsModalContent, { paddingBottom: sheetBottomPadding }]} onStartShouldSetResponder={() => true}>
              <Text style={styles.commentsModalTitle}>{t('chat:mealDetailsTitle')}</Text>
              <Text style={styles.commentsModalSubtitle}>
                {t('chat:mealDetailsSubtitle')}
              </Text>
              <TextInput
                style={styles.commentsInput}
                placeholder={t('chat:mealDetailsInputPlaceholder')}
                placeholderTextColor="#6F7A7E"
                value={mealComments}
                onChangeText={setMealComments}
                multiline={true}
                textAlignVertical="top"
                scrollEnabled={false}
                autoFocus={true}
              />
              <View style={styles.commentsModalButtons}>
                <TouchableOpacity
                  style={[styles.commentsModalButton, styles.commentsModalButtonCancel]}
                  onPress={() => {
                    setIsMealCommentsModalVisible(false);
                    setSelectedImageUri(null);
                    setMealComments('');
                  }}
                >
                  <Text style={styles.commentsModalButtonCancelText}>{t('chat:mealSkip')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.commentsModalButton, styles.commentsModalButtonSubmit]}
                  onPress={async () => {
                    if (selectedImageUri) {
                      setIsMealCommentsModalVisible(false);
                      const comments = mealComments.trim() || undefined;
                      await processMealImage(selectedImageUri, comments);
                      setSelectedImageUri(null);
                      setMealComments('');
                    }
                  }}
                >
                  <Text style={styles.commentsModalButtonSubmitText}>{t('chat:mealContinue')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    );
  };

  // Return the actual chat content, not BottomTabNavigation
  return renderChatContent();
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  chatKeyboardAvoid: {
    flex: 1,
  },
  header: {
    // top app bar styling
    backgroundColor: '#0E1A1A',
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#1A2426',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 70,
  },
  headerLeft: {
    width: 44,
    alignItems: 'flex-start',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    minWidth: 64,
    alignItems: 'flex-end',
  },
  hamburgerButton: {
    padding: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hamburgerLine: {
    width: 22,
    height: 2,
    backgroundColor: '#F2F2EE',
    marginVertical: 2.5,
    borderRadius: 1,
  },
  coachInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCoachImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 14,
  },
  headerCoachImagePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F47C3C',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  headerCoachImageText: {
    color: '#0B1114',
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: Typography.fontFamily.bold,
  },
  coachNameContainer: {
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
    lineHeight: 22,
    fontFamily: Typography.fontFamily.semiBold,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#9AA3A6',
    marginTop: 2,
    lineHeight: 18,
    fontFamily: Typography.fontFamily.regular,
  },
  modeSwitchContainer: {
    flexDirection: 'row',
    backgroundColor: '#0E1A1A',
    paddingHorizontal: 18,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1A2426',
  },
  modeSwitchButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#141E1E',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  modeSwitchButtonActive: {
    backgroundColor: '#F47C3C',
    borderColor: '#F47C3C',
  },
  modeSwitchText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9AA3A6',
    fontFamily: Typography.fontFamily.semiBold,
  },
  modeSwitchTextActive: {
    color: '#0B1114',
    fontWeight: '600',
  },
  modeSwitchButtonDisabled: {
    backgroundColor: '#0F1616',
    borderColor: '#1A2426',
    opacity: 0.7,
  },
  modeSwitchTextDisabled: {
    color: '#6B7578',
  },
  chatContainer: {
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 18,
    paddingBottom: 10,
    flexGrow: 1,
  },
  messageContainer: {
    marginBottom: 18,
  },
  userMessageContainer: {
    alignItems: 'flex-end',
  },
  coachMessageContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '85%',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 20,
    flexShrink: 1,
  },
  userMessageBubble: {
    backgroundColor: '#F47C3C',
    borderBottomRightRadius: 6,
  },
  coachMessageBubble: {
    backgroundColor: '#141E1E',
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  humanCoachMessageBubble: {
    backgroundColor: 'rgba(79, 174, 138, 0.15)', // Muted green for human coach
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(79, 174, 138, 0.3)',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: Typography.fontFamily.regular,
  },
  userMessageText: {
    color: '#0B1114',
  },
  coachMessageText: {
    color: '#F2F2EE',
  },
  messageTime: {
    fontSize: 12,
    flex: 1,
  },
  userMessageTime: {
    color: 'rgba(11, 17, 20, 0.6)',
    textAlign: 'right',
  },
  coachMessageTime: {
    color: '#6F7A7E',
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  coachIcon: {
    fontSize: 12,
    marginLeft: 8,
  },
  coachPhotoIcon: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    marginLeft: 8,
  },
  // Add larger versions for bottom right icon
  coachIconLarge: {
    fontSize: 15, // 25% larger than 12
    marginLeft: 8,
  },
  coachIconLargeImage: {
    width: 15,
    height: 15,
    marginLeft: 8,
  },
  coachPhotoIconLarge: {
    width: 19, // 25% larger than 15
    height: 19,
    borderRadius: 9.5,
    marginLeft: 8,
  },
  // Bottom Sheet Styles
  bottomSheetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11, 17, 20, 0.9)',
    zIndex: 999,
  },
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0E1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: '#1E2A2C',
    zIndex: 1000,
    maxHeight: '60%',
  },
  bottomSheetHeader: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  bottomSheetHandle: {
    width: 44,
    height: 4,
    backgroundColor: '#2A3638',
    borderRadius: 2,
  },
  bottomSheetContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  userInfoSection: {
    marginBottom: 34,
  },
  userInfoTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 24,
    textAlign: 'center',
  },
  userInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1A2426',
  },
  userInfoLabel: {
    fontSize: 16,
    color: '#9AA3A6',
    fontWeight: '500',
  },
  userInfoValue: {
    fontSize: 16,
    color: '#F2F2EE',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  bottomSheetActions: {
    gap: 14,
  },
  resetButton: {
    backgroundColor: '#C65B5B',
    paddingVertical: 18,
    paddingHorizontal: 28,
    borderRadius: 14,
    alignItems: 'center',
  },
  resetButtonText: {
    color: '#0B1114',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0B1114',
    zIndex: 2000,
  },
  tutorialOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11, 17, 20, 0.9)',
    zIndex: 9999,
    justifyContent: 'flex-start',
    paddingTop: 160,
    paddingHorizontal: 24,
  },
  tutorialBubble: {
    backgroundColor: '#0E1A1A',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 24,
    maxWidth: '85%',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  tutorialBubbleText: {
    color: '#F2F2EE',
    fontSize: 16,
    marginBottom: 14,
    lineHeight: 24,
    textAlign: 'center',
    fontFamily: Typography.fontFamily.regular,
  },
  tutorialBubblePointer: {
    position: 'absolute',
    bottom: -12,
    left: 24,
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderTopWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#0E1A1A',
  },
  tutorialBubblePointerUp: {
    position: 'absolute',
    top: -12,
    left: '50%',
    marginLeft: -12,
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#0E1A1A',
  },
  tutorialGotItButton: {
    alignSelf: 'center',
    backgroundColor: '#F47C3C',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  tutorialGotItButtonText: {
    color: '#0B1114',
    fontWeight: '600',
    fontFamily: Typography.fontFamily.semiBold,
  },
  homeButton: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    minWidth: 54,
  },
  cameraEmoji: {
    fontSize: 18,
  },
  homeButtonText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#F47C3C',
    marginTop: 3,
    fontFamily: Typography.fontFamily.semiBold,
  },
  liveMacrosContainer: {
    marginHorizontal: 18,
    marginTop: 0,
    marginBottom: 0,
  },
  mealConfirmButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  mealConfirmButton: {
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 14,
    minWidth: 200,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#1D2F2F',
    marginRight: 12,
  },
  cancelButtonText: {
    color: '#F2F2F7',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: Typography.fontFamily.semiBold,
  },
  okButton: {
    backgroundColor: '#F47C3C',
  },
  okButtonText: {
    color: '#0B1114',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: Typography.fontFamily.semiBold,
  },
  mealConfirmButtonDisabled: {
    opacity: 0.7,
  },
  mealSaveErrorText: {
    color: '#E88B8B',
    fontSize: 14,
    fontFamily: Typography.fontFamily.semiBold,
    textAlign: 'center',
    paddingHorizontal: 18,
    paddingBottom: 4,
  },
  messageImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    marginBottom: 10,
  },
  errorRibbon: {
    backgroundColor: 'rgba(198, 91, 91, 0.15)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(198, 91, 91, 0.3)',
    paddingVertical: 12,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorRibbonText: {
    color: '#C65B5B',
    fontSize: 14,
    fontFamily: Typography.fontFamily.regular,
    flex: 1,
    marginRight: 14,
  },
  retryButton: {
    backgroundColor: '#C65B5B',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#0B1114',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Typography.fontFamily.semiBold,
  },
  // Message sync status ribbons
  syncFailedRibbon: {
    backgroundColor: 'rgba(224, 164, 88, 0.15)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(224, 164, 88, 0.3)',
    paddingVertical: 12,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  syncingRibbon: {
    backgroundColor: 'rgba(91, 155, 213, 0.15)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(91, 155, 213, 0.3)',
    paddingVertical: 12,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncRibbonText: {
    color: '#E0A458',
    fontSize: 14,
    fontFamily: Typography.fontFamily.regular,
    flex: 1,
    marginRight: 14,
  },
  syncRetryButton: {
    backgroundColor: '#E0A458',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  syncRetryButtonText: {
    color: '#0B1114',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Typography.fontFamily.semiBold,
  },
  // Always-visible Sync Messages Button
  syncMessagesButton: {
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 7,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncMessagesButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  syncMessagesButtonText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 8,
    fontWeight: '400',
    fontFamily: Typography.fontFamily.regular,
  },
  mealLogModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(11, 17, 20, 0.9)',
  },
  mealLogAgainButton: {
    marginTop: 10,
    alignSelf: 'stretch',
    backgroundColor: '#F47C3C',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealLogAgainButtonText: {
    color: '#0B1114',
    fontSize: 14,
    fontFamily: Typography.fontFamily.semiBold,
    letterSpacing: 0.2,
  },
  dailyProgressLink: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  dailyProgressText: {
    color: '#F47C3C',
    fontSize: 14,
    fontFamily: Typography.fontFamily.semiBold,
    marginRight: 6,
    textDecorationLine: 'underline',
  },
  dailyProgressArrow: {
    color: '#F47C3C',
    fontSize: 18,
    fontFamily: Typography.fontFamily.bold,
    marginTop: -2,
  },
  planConfirmButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  planConfirmOk: {
    flex: 1,
    backgroundColor: '#F47C3C',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  planConfirmOkText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: Typography.fontFamily.semiBold,
  },
  planConfirmCancel: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  planConfirmCancelText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontFamily: Typography.fontFamily.regular,
  },
  mealLogOptionsModalContent: {
    backgroundColor: '#0E1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 34,
    width: '100%',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#1E2A2C',
    maxHeight: '70%',
  },
  mealLogOptionsTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 12,
    textAlign: 'center',
    fontFamily: Typography.fontFamily.bold,
  },
  mealLogOptionsSubtitle: {
    fontSize: 14,
    color: '#9AA3A6',
    marginBottom: 14,
    textAlign: 'center',
    fontFamily: Typography.fontFamily.regular,
  },
  mealLogOptionsButtons: {
    flexDirection: 'column',
    gap: 9,
    paddingVertical: 6,
  },
  mealLogOptionButton: {
    backgroundColor: '#141E1E',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E2A2C',
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
    textAlign: 'center',
    fontFamily: Typography.fontFamily.semiBold,
  },
  mealOptionSubtitle: {
    fontSize: 12,
    color: '#9AA3A6',
    textAlign: 'center',
    fontFamily: Typography.fontFamily.regular,
  },
  loadMoreContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 8,
    marginHorizontal: 40,
    backgroundColor: 'rgba(154, 163, 166, 0.1)',
    borderRadius: 8,
  },
  loadMoreText: {
    color: '#9AA3A6',
    fontSize: 14,
    fontFamily: Typography.fontFamily.regular,
  },
  commentsModalContainer: {
    flex: 1,
  },
  commentsModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(11, 17, 20, 0.9)',
  },
  commentsModalContent: {
    backgroundColor: '#0E1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#1E2A2C',
  },
  commentsModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: Typography.fontFamily.bold,
  },
  commentsModalSubtitle: {
    fontSize: 14,
    color: '#9AA3A6',
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: Typography.fontFamily.regular,
  },
  commentsInput: {
    backgroundColor: '#141E1E',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#F2F2EE',
    minHeight: 100,
    borderWidth: 1,
    borderColor: '#1E2A2C',
    marginBottom: 20,
    fontFamily: Typography.fontFamily.regular,
  },
  commentsModalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  commentsModalButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentsModalButtonCancel: {
    backgroundColor: '#141E1E',
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  commentsModalButtonCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9AA3A6',
    fontFamily: Typography.fontFamily.semiBold,
  },
  commentsModalButtonSubmit: {
    backgroundColor: '#F47C3C',
  },
  commentsModalButtonSubmitText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    fontFamily: Typography.fontFamily.semiBold,
  },
});