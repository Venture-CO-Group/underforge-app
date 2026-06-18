import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, ImageSourcePropType, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { ensureWorkoutExercisePrescription } from '../lib/exercise-harmonization';
import { getExerciseLoggingUnit, resolveCatalogExercise } from '../lib/exercise-catalog';
import { hydrateCustomExerciseFromId } from '../lib/custom-exercise-storage';
import { activationForExercise, aggregateActivation, scoresToBodyData } from '../lib/muscle-activation';
import { trainingFocus } from '../lib/training-focus';
import { MuscleActivationMap } from './MuscleActivationMap';
import { TrainingFocusBar } from './TrainingFocusBar';
import {
  getLocalizedExerciseName,
  getLocalizedExerciseVideoUrl,
} from '../lib/exercise-localization';
import { appIcons } from '../assets/icons';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize, LetterSpacing, LineHeight } from '../constants/Typography';
import { glowLogger } from '../lib/glow-logger';
import { getUserNutritionTargets, NutritionTargets } from '../lib/nutrition-storage';
import {
  descriptionMentionsSessionKcal,
  getTrainingSessionKcalInfo,
} from '../lib/plan-description-utils';
import {
  DEFAULT_BODYWEIGHT_KG,
  estimatePlannedWorkoutKcal,
} from '../lib/workout-energy';
import { ActionPlan, ActionStep, DietaryPlan, Onboard } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import { BaselineMovementCard } from './BaselineMovementCard';
import { HumanCoachStepNotesCard } from './HumanCoachStepNotesCard';
import { Exercise, formatRestTime, getMovementTypeDisplayName, getMuscleGroupDisplayName, PlannedExercise, WorkoutPlan } from '../types/workout';
import { FormattedStepDetails } from './FormattedStepDetails';
import { Icon } from './Icon';
import { MarkdownText } from './MarkdownText';

import { planImages } from '../assets/images/plan';

export const getPlanSectionImage = (stepId?: string, gender?: string): ImageSourcePropType | null => {
  if (!stepId) return null;
  // Treat anything that isn't explicitly 'male' as female, matching the muscle map
  // fallback used elsewhere so plan images and muscle maps stay consistent.
  const isFemale = gender?.toLowerCase() !== 'male';

  if (stepId === 'step_1') {
    return isFemale ? planImages['fem training'] : planImages['male training'];
  }
  if (stepId === 'step_2') {
    return isFemale ? planImages['fem nutrition'] : planImages['male nutrition'];
  }
  if (stepId === 'step_3') {
    return isFemale ? planImages['fem recovery'] : planImages['male recovery'];
  }
  return null;
};

const getExerciseDetails = (exerciseId: string, exerciseName?: string): Exercise | undefined => {
  return resolveCatalogExercise(exerciseId, exerciseName);
};

function normalizeWorkoutPlanPrescription(plan: WorkoutPlan): WorkoutPlan {
  if (!plan.exercises?.length) return plan;
  return {
    ...plan,
    exercises: plan.exercises.map((ex) => ensureWorkoutExercisePrescription(ex)),
  };
}

export const getWorkoutPlansFromStep = (step: ActionStep): WorkoutPlan[] => {
  if (!step.step_details) return [];
  
  if (Array.isArray(step.step_details)) {
    const raw = (step.step_details as any[]).filter(
      (d: any) => d.dayName && d.dayType
    ) as WorkoutPlan[];
    return raw.map(normalizeWorkoutPlanPrescription);
  }
  
  if (typeof step.step_details === 'object') {
    const details = step.step_details as any;
    if (details.dayName && details.dayType) {
      return [normalizeWorkoutPlanPrescription(details as WorkoutPlan)];
    }
  }
  
  return [];
};

export const isTrainingStepWithWorkouts = (step?: ActionStep): boolean => {
  if (!step) return false;
  return getWorkoutPlansFromStep(step).length > 0;
};

const ExerciseRow: React.FC<{ exercise: PlannedExercise }> = ({ exercise }) => {
  const { t, i18n } = useTranslation(['plan', 'common']);
  const details = getExerciseDetails(exercise.exerciseId, exercise.name);
  const displayName = getLocalizedExerciseName(details, exercise.name, i18n.language);
  const videoUrl = getLocalizedExerciseVideoUrl(details, i18n.language);
  const isSecondsExercise = getExerciseLoggingUnit(details) === 'seconds';

  return (
    <View style={styles.exerciseRow}>
      <View style={styles.exerciseRowHeader}>
        <Text style={styles.exerciseRowName}>{displayName}</Text>
        {videoUrl && (
          <TouchableOpacity
            style={styles.exerciseVideoButton}
            onPress={async () => {
              try {
                await Linking.openURL(videoUrl);
              } catch {
                Alert.alert(t('common:error'), t('plan:stepVideoOpenError'));
              }
            }}
          >
            <Icon source={appIcons.video_library} width={16} height={16} fill="#5B9BD5" />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.exerciseMetaRow}>
        {details && (
          <>
            <View style={styles.exerciseMetaBadge}>
              <Text style={styles.exerciseMetaBadgeText}>
                {getMuscleGroupDisplayName(details.muscleGroup)}
              </Text>
            </View>
            <View style={[styles.exerciseMetaBadge, styles.exerciseMetaBadgeSecondary]}>
              <Text style={styles.exerciseMetaBadgeTextSecondary}>
                {getMovementTypeDisplayName(details.movementType)}
              </Text>
            </View>
          </>
        )}
      </View>
      <View style={styles.exerciseStatsRow}>
        <View style={styles.exerciseStat}>
          <Text style={styles.exerciseStatLabel}>{t('plan:stepExerciseSets')}</Text>
          <Text style={styles.exerciseStatValue}>{exercise.sets}</Text>
        </View>
        <View style={styles.exerciseStat}>
          <Text style={styles.exerciseStatLabel}>{isSecondsExercise ? t('plan:stepExerciseSecs') : t('plan:stepExerciseReps')}</Text>
          <Text style={styles.exerciseStatValue}>{exercise.reps}</Text>
        </View>
        <View style={styles.exerciseStat}>
          <Text style={styles.exerciseStatLabel}>{t('plan:stepExerciseRest')}</Text>
          <Text style={styles.exerciseStatValue}>{formatRestTime(exercise.restTimeSeconds)}</Text>
        </View>
        {exercise.rir !== undefined && (
          <View style={styles.exerciseStat}>
            <Text style={styles.exerciseStatLabel}>{t('plan:stepExerciseRiR')}</Text>
            <Text style={styles.exerciseStatValue}>{exercise.rir}</Text>
          </View>
        )}
      </View>
      {exercise.notes && (
        <Text style={styles.exerciseNotes}>{exercise.notes}</Text>
      )}
    </View>
  );
};

function resolveBodyWeightKg(
  userProfile?: UserProfile,
  onboardData?: Onboard,
): number {
  const fromProfile = userProfile?.onboardingProfile?.weight;
  if (fromProfile) {
    const m = fromProfile.match(/\((\d+)\s*kg\)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const fromOnboard = onboardData?.weight;
  if (fromOnboard) {
    const m = fromOnboard.match(/\((\d+)\s*kg\)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const cq = userProfile?.onboardingProfile?.clarifyingQuestions?.find(
    (q) => q.question === 'current_weight_question',
  )?.answer;
  if (cq) {
    const m = cq.match(/\((\d+)\s*kg\)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return DEFAULT_BODYWEIGHT_KG;
}

function sessionKcalForPlan(plan: WorkoutPlan, weightKg: number): number {
  if (
    typeof plan.estimatedCaloriesBurned === 'number' &&
    plan.estimatedCaloriesBurned > 0
  ) {
    return plan.estimatedCaloriesBurned;
  }
  return estimatePlannedWorkoutKcal(plan.exercises, weightKg);
}

function resolvePlanExercise(ex: PlannedExercise): Exercise | undefined {
  return (
    resolveCatalogExercise(ex.exerciseId, ex.name) ||
    hydrateCustomExerciseFromId(ex.exerciseId, ex.name) ||
    undefined
  );
}

function planDaySetCount(ex: PlannedExercise): number {
  const n =
    typeof ex.sets === 'number'
      ? ex.sets
      : parseInt(String(ex.sets ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/**
 * Detect cardio work described in free-text warmup / cooldown so a day whose only cardio lives
 * in the warm-up ("5 min easy jog") still registers some cardio in the focus split, instead of
 * reading as 100% strength. Returns a modest cardio weight (~a couple of sets) when matched.
 */
const WARMUP_CARDIO_KEYWORDS = [
  'cardio', 'jog', 'run', 'running', 'row', 'rowing', 'bike', 'cycl', 'treadmill', 'elliptical',
  'jump rope', 'jumping jack', 'skipping', 'sprint', 'stair', 'ski erg', 'assault bike',
  'burpee', 'mountain climber', 'high knee', 'shuttle', 'swim',
];
function cardioWeightFromText(text?: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  return WARMUP_CARDIO_KEYWORDS.some((k) => lower.includes(k)) ? 3 : 0;
}

type PlanDayResolved = { detail: Exercise | undefined; sets: number };

function resolvePlanDayExercises(plan: WorkoutPlan): PlanDayResolved[] {
  return plan.exercises.map((ex) => ({
    detail: resolvePlanExercise(ex),
    sets: planDaySetCount(ex),
  }));
}

/** Strength/cardio focus for a day, weighted by planned sets, incl. cardio mentioned in warmup/cooldown. */
function planDayFocus(plan: WorkoutPlan) {
  const focusItems = resolvePlanDayExercises(plan).map((r) => ({
    category: r.detail?.category,
    weight: r.sets,
  }));
  const warmCardio = cardioWeightFromText(`${plan.warmup ?? ''} ${plan.cooldown ?? ''}`);
  if (warmCardio > 0) focusItems.push({ category: 'endurance', weight: warmCardio });
  return trainingFocus(focusItems);
}

/** Per-day muscle heatmap data, weighted by planned set counts. */
function planDayMmap(plan: WorkoutPlan) {
  return scoresToBodyData(
    aggregateActivation(
      resolvePlanDayExercises(plan).map((r) => ({
        activation: activationForExercise(r.detail),
        weight: r.sets,
      })),
    ),
  );
}

/** Whole-program muscle heatmap: aggregate every training day's planned-set-weighted activation. */
export function wholePlanMap(plans: WorkoutPlan[]) {
  const items = plans.flatMap((plan) =>
    resolvePlanDayExercises(plan).map((r) => ({
      activation: activationForExercise(r.detail),
      weight: r.sets,
    })),
  );
  return scoresToBodyData(aggregateActivation(items));
}

const WorkoutDayCard: React.FC<{
  plan: WorkoutPlan;
  isExpanded: boolean;
  onToggle: () => void;
  weightKg: number;
  gender: 'male' | 'female';
}> = ({ plan, isExpanded, onToggle, weightKg, gender }) => {
  const { t } = useTranslation(['plan', 'workout']);
  const sessionKcal = sessionKcalForPlan(plan, weightKg);
  const exerciseCount = plan.exercises.length;
  // Focus is shown in the header (always), so it reads as belonging to the day. The (heavier)
  // muscle map is computed lazily only while the day is expanded.
  const focus = planDayFocus(plan);
  const mapData = isExpanded ? planDayMmap(plan) : null;
  return (
    <View style={styles.workoutDayCard}>
      <TouchableOpacity
        style={styles.workoutDayHeader}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <View style={styles.workoutDayHeaderInfo}>
          <Text style={styles.workoutDayName}>{plan.dayName}</Text>
          <Text style={styles.workoutDayMeta}>
            {exerciseCount === 1
              ? t('plan:stepWorkoutSessionMetaOne', {
                  minutes: plan.estimatedDuration,
                  kcal: sessionKcal,
                })
              : t('plan:stepWorkoutSessionMeta', {
                  count: exerciseCount,
                  minutes: plan.estimatedDuration,
                  kcal: sessionKcal,
                })}
          </Text>
          {!focus.empty && (
            <View style={styles.workoutDayHeaderFocus}>
              <TrainingFocusBar focus={focus} />
            </View>
          )}
        </View>
        <Text style={styles.workoutDayChevron}>{isExpanded ? '▼' : '▶'}</Text>
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.workoutDayBody}>
          {mapData && mapData.length > 0 && (
            <View style={styles.workoutDaySummary}>
              <MuscleActivationMap
                data={mapData}
                gender={gender}
                sizeFactor={0.6}
                caption={t('workout:musclesWorkedCaption', { defaultValue: 'Muscles worked' })}
              />
            </View>
          )}
          {plan.warmup && (
            <View style={styles.warmupCooldownSection}>
              <Text style={styles.warmupCooldownTitle}>{t('plan:stepWarmup')}</Text>
              <Text style={styles.warmupCooldownText}>{plan.warmup}</Text>
            </View>
          )}
          {plan.exercises.map((exercise, idx) => (
            <ExerciseRow key={`${exercise.exerciseId}-${idx}`} exercise={exercise} />
          ))}
          {plan.cooldown && (
            <View style={styles.warmupCooldownSection}>
              <Text style={styles.warmupCooldownTitle}>{t('plan:stepCooldown')}</Text>
              <Text style={styles.warmupCooldownText}>{plan.cooldown}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const TrainingDetailsView: React.FC<{
  step: ActionStep;
  weightKg: number;
  gender: 'male' | 'female';
}> = ({ step, weightKg, gender }) => {
  const workoutPlans = getWorkoutPlansFromStep(step);
  // Independent accordion: each day toggles on its own and others stay as-is. This keeps the
  // tapped card in place — collapsing a previously-open day above would shift the viewport down.
  const [expandedDays, setExpandedDays] = useState<Set<number>>(() => new Set([0]));
  const toggleDay = (index: number) =>
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <View style={styles.trainingDetailsContainer}>
      {workoutPlans.map((plan, index) => (
        <WorkoutDayCard
          key={`${plan.dayName}-${index}`}
          plan={plan}
          isExpanded={expandedDays.has(index)}
          onToggle={() => toggleDay(index)}
          weightKg={weightKg}
          gender={gender}
        />
      ))}
    </View>
  );
};

const generateMacroExplanation = (
  macroType: 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber',
  value: number,
  userProfile?: UserProfile,
  selectedGoal?: string,
  t?: (key: string) => string
): string => {
  const goal = (selectedGoal || userProfile?.onboardingProfile?.selectedGoal || '').toLowerCase();
  const hasWeightLoss = goal.includes('weight loss') || goal.includes('lose weight') || goal.includes('fat loss');
  const hasMuscleGain = goal.includes('muscle') || goal.includes('strength') || goal.includes('athletic');
  const hasLongevity = goal.includes('longevity') || goal.includes('healthy aging') || goal.includes('lifespan');

  const tr = t || ((k: string) => k);

  const explanations: Record<string, string> = {
    calories: hasWeightLoss
      ? tr('plan:macroCaloriesWeightLoss')
      : hasMuscleGain
      ? tr('plan:macroCaloriesMuscle')
      : tr('plan:macroCaloriesDefault'),
    protein: hasMuscleGain
      ? tr('plan:macroProteinMuscle')
      : hasWeightLoss
      ? tr('plan:macroProteinWeightLoss')
      : tr('plan:macroProteinDefault'),
    carbs: hasMuscleGain
      ? tr('plan:macroCarbsMuscle')
      : hasWeightLoss
      ? tr('plan:macroCarbsWeightLoss')
      : tr('plan:macroCarbsDefault'),
    fat: hasLongevity
      ? tr('plan:macroFatLongevity')
      : hasMuscleGain
      ? tr('plan:macroFatMuscle')
      : tr('plan:macroFatDefault'),
    fiber: hasLongevity
      ? tr('plan:macroFiberLongevity')
      : hasWeightLoss
      ? tr('plan:macroFiberWeightLoss')
      : tr('plan:macroFiberDefault'),
  };

  return explanations[macroType];
};

interface MacroCardProps {
  icon: any;
  title: string;
  value: number;
  unit: string;
  color: string;
  explanation: string;
}

const MacroCard: React.FC<MacroCardProps> = ({ icon, title, value, unit, color, explanation }) => (
  <View style={styles.macroCard}>
    <View style={styles.macroCardHeader}>
      <View style={[styles.macroIconContainer, { backgroundColor: color + '20' }]}>
        <Icon source={icon} width={32} height={32} fill={color} />
      </View>
      <View style={styles.macroCardTitleContainer}>
        <Text style={styles.macroCardTitle}>{title}</Text>
        <Text style={styles.macroCardValue}>
          {value}
          <Text style={styles.macroCardUnit}>{unit}</Text>
        </Text>
      </View>
    </View>
    <Text style={styles.macroCardExplanation}>{explanation}</Text>
  </View>
);

interface CollapsibleSectionCardProps {
  icon: any;
  title: string;
  children: React.ReactNode;
  initiallyExpanded?: boolean;
}

const CollapsibleSectionCard: React.FC<CollapsibleSectionCardProps> = ({
  icon,
  title,
  children,
  initiallyExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <View style={styles.collapsibleCard}>
      <TouchableOpacity
        style={styles.collapsibleHeaderRow}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={title}
      >
        <View style={styles.collapsibleHeaderLeft}>
          <Icon source={icon} width={18} height={18} fill={BrandColors.accent} />
          <Text style={styles.collapsibleTitle}>{title}</Text>
        </View>
        <View style={styles.collapsibleChevronHit}>
          <Text style={styles.collapsibleChevron}>{expanded ? '▼' : '▶'}</Text>
        </View>
      </TouchableOpacity>
      {expanded && <View style={styles.collapsibleBody}>{children}</View>}
    </View>
  );
};

const DietaryPlanCard: React.FC<{ dietaryPlan: DietaryPlan }> = ({ dietaryPlan }) => {
  const { t } = useTranslation(['plan']);

  const renderMeal = (label: string, options: { name: string; description?: string }[]) => {
    if (!options || options.length === 0) return null;
    return (
      <View style={styles.dietaryMealGroup} key={label}>
        <Text style={styles.dietaryMealLabel}>{label}</Text>
        {options.map((option, idx) => (
          <View style={styles.dietaryOption} key={`${label}-${idx}`}>
            <Text style={styles.dietaryOptionName}>{option.name}</Text>
            {option.description ? (
              <Text style={styles.dietaryOptionDescription}>{option.description}</Text>
            ) : null}
          </View>
        ))}
      </View>
    );
  };

  return (
    <CollapsibleSectionCard
      icon={appIcons.breakfast}
      title={t('plan:stepDietaryPlanTitle')}
    >
      {renderMeal(t('plan:stepDietaryBreakfast'), dietaryPlan.breakfast)}
      {renderMeal(t('plan:stepDietaryLunch'), dietaryPlan.lunch)}
      {renderMeal(t('plan:stepDietaryDinner'), dietaryPlan.dinner)}
    </CollapsibleSectionCard>
  );
};

const NutritionTargetsView: React.FC<{ 
  userId?: string; 
  userProfile?: UserProfile;
  selectedGoal?: string;
  stepNutritionTargets?: NutritionTargets;
}> = ({ userId, userProfile, selectedGoal, stepNutritionTargets }) => {
  const { t } = useTranslation(['plan']);
  // Always prefer the persisted runtime row (`user_nutrition_targets`) so
  // there is a single source of truth — `stepNutritionTargets` from the
  // plan JSON is only the seed at onboarding and may drift from the user's
  // latest targets after regeneration or plan edits.
  const [targets, setTargets] = useState<NutritionTargets | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      // No persisted source available yet (e.g. plan preview before
      // onboarding completes) — fall back to the plan JSON values.
      setTargets(stepNutritionTargets ?? null);
      setLoading(false);
      return;
    }

    const loadTargets = async () => {
      try {
        const nutritionTargets = await getUserNutritionTargets(userId);
        setTargets(nutritionTargets);
      } catch (error) {
        glowLogger.error('Error loading nutrition targets', {
          error: error instanceof Error ? error.message : String(error)
        });
        setTargets(stepNutritionTargets ?? null);
      } finally {
        setLoading(false);
      }
    };

    loadTargets();
  }, [userId, stepNutritionTargets]);

  if (loading || !targets) {
    return (
      <View style={styles.nutritionTargetsContainer}>
        <Text style={styles.nutritionLoadingText}>{t('plan:stepNutritionLoading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.nutritionTargetsContainer}>
      <Text style={styles.nutritionTargetsHeader}>{t('plan:stepNutritionHeader')}</Text>
      <MacroCard icon={appIcons.calories_heat} title={t('plan:stepNutritionCalories')} value={targets.caloriesTarget} unit=" kcal" color="#F47C3C"
        explanation={generateMacroExplanation('calories', targets.caloriesTarget, userProfile, selectedGoal, t)} />
      <MacroCard icon={appIcons.kebab} title={t('plan:stepNutritionProtein')} value={targets.proteinTarget} unit="g" color="#5A9E97"
        explanation={generateMacroExplanation('protein', targets.proteinTarget, userProfile, selectedGoal, t)} />
      <MacroCard icon={appIcons.avocado} title={t('plan:stepNutritionFat')} value={targets.fatTarget} unit="g" color="#D4A574"
        explanation={generateMacroExplanation('fat', targets.fatTarget, userProfile, selectedGoal, t)} />
      <MacroCard icon={appIcons.breakfast} title={t('plan:stepNutritionCarbs')} value={targets.carbsTarget} unit="g" color="#8B6E6E"
        explanation={generateMacroExplanation('carbs', targets.carbsTarget, userProfile, selectedGoal, t)} />
      <MacroCard icon={appIcons.fiber_leaf} title={t('plan:stepNutritionFiber')} value={targets.fiberTarget} unit="g" color="#7BA05B"
        explanation={generateMacroExplanation('fiber', targets.fiberTarget, userProfile, selectedGoal, t)} />
    </View>
  );
};

export const SurveyBanner: React.FC<{
  surveyType: 'nutrition' | 'recovery';
  onPress: () => void;
}> = ({ surveyType, onPress }) => {
  const { t } = useTranslation(['plan']);
  const shimmerAnim = useRef(new Animated.Value(-1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: -1, duration: 0, useNativeDriver: true }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0, duration: 1200, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const borderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(244,124,60,0.25)', 'rgba(244,124,60,0.75)'],
  });

  const iconSource = surveyType === 'nutrition' ? appIcons.avocado : appIcons.sleep;
  const text = surveyType === 'nutrition'
    ? t('plan:surveyNutritionBanner')
    : t('plan:surveyRecoveryBanner');

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.surveyBannerWrapper}>
      <Animated.View style={[styles.surveyBanner, { borderColor }]}>
        <View style={styles.surveyBannerStripe} />
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Animated.View
            style={{
              ...StyleSheet.absoluteFillObject,
              transform: [{
                translateX: shimmerAnim.interpolate({
                  inputRange: [-1, 1],
                  outputRange: [-220, 220],
                }),
              }],
            }}
          >
            <LinearGradient
              colors={['transparent', 'rgba(244,124,60,0.08)', 'rgba(244,124,60,0.14)', 'rgba(244,124,60,0.08)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1, width: 120 }}
            />
          </Animated.View>
        </View>
        <View style={styles.surveyBannerContent}>
          <Icon source={iconSource} width={20} height={20} fill={'#F47C3C'} style={{ marginRight: 10 }} />
          <View style={styles.surveyBannerTextContainer}>
            <Text style={styles.surveyBannerText}>{text}</Text>
          </View>
          <Text style={styles.surveyBannerArrow}>›</Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
};

// --- Main exported component ---

export interface StepDetailContentProps {
  step?: ActionStep;
  stepIndex?: number;
  actionPlan?: ActionPlan;
  onboardData?: Onboard;
  userProfile?: UserProfile;
  userGender?: string;
  selectedGoal?: string;
  userLocalId?: string;
  showImage?: boolean;
  onLogWorkout?: (step: ActionStep) => void;
  onStartSurvey?: (surveyType: 'nutrition' | 'recovery') => void;
  nutritionSurveyCompleted?: boolean;
  recoverySurveyCompleted?: boolean;
  onSchedulePress?: () => void;
  scheduleEditable?: boolean;
}

function formatScheduleText(
  days: string[] | undefined,
  timeOfDay: string | undefined,
  t: (key: string) => string,
): string {
  if (!days || days.length === 0) return t('plan:scheduleAsNeeded');

  const dayMap: { [key: string]: string } = {
    mon: t('plan:scheduleDayMon'),
    tue: t('plan:scheduleDayTue'),
    wed: t('plan:scheduleDayWed'),
    thu: t('plan:scheduleDayThu'),
    fri: t('plan:scheduleDayFri'),
    sat: t('plan:scheduleDaySat'),
    sun: t('plan:scheduleDaySun'),
  };

  let scheduleText = '';
  if (days.length === 7) {
    scheduleText = t('plan:scheduleDaily');
  } else if (
    days.length === 5 &&
    ['mon', 'tue', 'wed', 'thu', 'fri'].every((d) => days.includes(d))
  ) {
    scheduleText = t('plan:scheduleWeekdays');
  } else if (days.length === 2 && ['sat', 'sun'].every((d) => days.includes(d))) {
    scheduleText = t('plan:scheduleWeekends');
  } else {
    scheduleText = days.map((d) => dayMap[d] || d).join(', ');
  }

  if (timeOfDay) {
    scheduleText += t('plan:scheduleAtTime') + timeOfDay;
  }

  return scheduleText;
}

export const StepDetailContent: React.FC<StepDetailContentProps> = ({
  step,
  stepIndex,
  actionPlan,
  onboardData,
  userProfile,
  userGender: userGenderProp,
  selectedGoal,
  userLocalId,
  showImage = true,
  onLogWorkout,
  onStartSurvey,
  nutritionSurveyCompleted = false,
  recoverySurveyCompleted = false,
  onSchedulePress,
  scheduleEditable = false,
}) => {
  const { t } = useTranslation(['plan', 'workout']);
  const genderQuestion = userProfile?.onboardingProfile?.clarifyingQuestions?.find(
    (q: any) => q.question === 'gender_question'
  );
  const userGender = (userGenderProp || genderQuestion?.answer || '').toString().toLowerCase();
  const userId = userLocalId || userProfile?.onboardingProfile?.localUserId;
  const bodyWeightKg = resolveBodyWeightKg(userProfile, onboardData);

  const isTrainingStep = stepIndex === 0;
  const isNutritionStep = stepIndex === 1;
  const isRecoveryStep = stepIndex === 2;

  if (!step) return null;

  const detailDescription = step.description?.trim() ?? '';
  const sessionKcalInfo = isTrainingStep ? getTrainingSessionKcalInfo(step) : null;
  const showSessionKcal =
    isTrainingStep &&
    sessionKcalInfo &&
    (!detailDescription || !descriptionMentionsSessionKcal(detailDescription));
  const stepDetailsContent = step.step_details as string | { text: string }[] | undefined;
  const sessionKcalText = showSessionKcal
    ? sessionKcalInfo!.kind === 'single'
      ? t('plan:trainingSessionKcalSingle', { kcal: sessionKcalInfo!.kcal })
      : t('plan:trainingSessionKcalMulti', {
          sessions: sessionKcalInfo!.sessions
            .map((s) => `${s.dayName} ~${s.kcal} kcal`)
            .join(', '),
        })
    : null;
  return (
    <View>
      {showImage && step.id && getPlanSectionImage(step.id, userGender) && (
        <View style={styles.stepImageContainer}>
          <Image
            source={getPlanSectionImage(step.id, userGender)!}
            style={styles.stepImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
          />
          <View style={styles.stepTitleOverlay}>
            <Text style={styles.stepTitleOverlayText}>{step.title}</Text>
          </View>
        </View>
      )}

      {showImage && (!step.id || !getPlanSectionImage(step.id, userGender)) && (
        <Text style={styles.stepTitle}>{step.title}</Text>
      )}

      {!showImage && (
        <Text style={styles.stepTitle}>{step.title}</Text>
      )}

      {onLogWorkout && (
        isTrainingStep ||
        step.title?.toLowerCase().includes('workout') ||
        step.title?.toLowerCase().includes('training') ||
        step.title?.toLowerCase().includes('exercise')
      ) && (
        <TouchableOpacity
          style={styles.logWorkoutButton}
          onPress={() => onLogWorkout(step)}
          activeOpacity={0.8}
        >
          <Icon source={appIcons.fitness_center} width={20} height={20} fill="#FFFFFF" />
          <Text style={styles.logWorkoutText}>+ {t('workout:logWorkout')}</Text>
        </TouchableOpacity>
      )}

      {detailDescription ? (
        <MarkdownText
          text={detailDescription}
          style={styles.stepDescription}
          linkColor="#F47C3C"
        />
      ) : null}

      {(step.daysOfWeek || step.timeOfDay) && (
        scheduleEditable && onSchedulePress ? (
          <TouchableOpacity
            style={styles.compactScheduleRow}
            onPress={onSchedulePress}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('plan:stepDetailsTitle')}
          >
            <Text style={styles.compactScheduleIcon}>📅</Text>
            <Text style={styles.compactScheduleText} numberOfLines={2}>
              {formatScheduleText(step.daysOfWeek, step.timeOfDay, t)}
            </Text>
            <Text style={styles.compactScheduleChevron}>›</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.compactScheduleRow}>
            <Text style={styles.compactScheduleIcon}>📅</Text>
            <Text style={styles.compactScheduleText} numberOfLines={2}>
              {formatScheduleText(step.daysOfWeek, step.timeOfDay, t)}
            </Text>
          </View>
        )
      )}

      {sessionKcalText ? (
        <Text style={styles.sessionKcalNote}>{sessionKcalText}</Text>
      ) : null}

      {isNutritionStep && !nutritionSurveyCompleted && onStartSurvey && (
        <SurveyBanner surveyType="nutrition" onPress={() => onStartSurvey('nutrition')} />
      )}

      {isRecoveryStep && !recoverySurveyCompleted && onStartSurvey && (
        <SurveyBanner surveyType="recovery" onPress={() => onStartSurvey('recovery')} />
      )}

      {isNutritionStep && (step.nutrition_targets || userId) && (
        <NutritionTargetsView 
          userId={userId} 
          userProfile={userProfile} 
          selectedGoal={selectedGoal}
          stepNutritionTargets={step.nutrition_targets}
        />
      )}

      {isNutritionStep && step.dietary_plan && (
        <DietaryPlanCard dietaryPlan={step.dietary_plan} />
      )}

      {isNutritionStep && step.step_details && (
        <CollapsibleSectionCard
          icon={appIcons.avocado}
          title={t('plan:stepNutritionGuidelines')}
        >
          <FormattedStepDetails
            details={stepDetailsContent}
            textStyle={styles.stepDetailsText}
            linkColor="#F47C3C"
          />
        </CollapsibleSectionCard>
      )}

      {isTrainingStepWithWorkouts(step) && (
        <TrainingDetailsView
          step={step}
          weightKg={bodyWeightKg}
          gender={userGender === 'male' ? 'male' : 'female'}
        />
      )}

      {isTrainingStep && (
        <BaselineMovementCard
          userProfile={userProfile}
          onboardData={onboardData}
          actionPlan={actionPlan}
        />
      )}

      {stepDetailsContent && !isTrainingStepWithWorkouts(step) && !isNutritionStep && (
        <View style={styles.section}>
          <View style={styles.stepDetailsContainer}>
            <FormattedStepDetails
              details={stepDetailsContent}
              textStyle={styles.stepDetailsText}
              linkColor="#F47C3C"
            />
          </View>
        </View>
      )}

      <HumanCoachStepNotesCard
        stepId={step.id}
        userId={userProfile?.user_id ?? userId}
        notesJson={userProfile?.human_coach_step_notes_json ?? null}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  stepImageContainer: {
    height: 200,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
    position: 'relative',
  },
  stepImage: {
    width: '100%',
    height: '100%',
  },
  stepTitleOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  stepTitleOverlayText: {
    color: '#F2F2EE',
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  stepTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 16,
    lineHeight: 34,
  },
  logWorkoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F47C3C',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 20,
    shadowColor: '#F47C3C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  logWorkoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  stepDescription: {
    fontSize: 17,
    color: '#9AA3A6',
    lineHeight: 24,
    marginBottom: 16,
  },
  compactScheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1A1A',
    borderRadius: 8,
    paddingHorizontal: 11,
    minHeight: 44,
    paddingVertical: 6,
    marginBottom: 20,
    alignSelf: 'flex-start',
  },
  compactScheduleIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  compactScheduleText: {
    fontSize: 11,
    lineHeight: 15,
    color: '#F2F2EE',
    fontWeight: '600',
    flexShrink: 1,
  },
  compactScheduleChevron: {
    fontSize: 14,
    color: '#9AA3A6',
    marginLeft: 6,
    fontWeight: '500',
  },
  sessionKcalNote: {
    fontSize: 15,
    color: '#9AA3A6',
    lineHeight: 22,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  surveyBannerWrapper: {
    marginLeft: 16,
    marginBottom: 20,
  },
  surveyBanner: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 124, 60, 0.25)',
    overflow: 'hidden',
    flexDirection: 'row',
  },
  surveyBannerStripe: {
    width: 4,
    backgroundColor: '#F47C3C',
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  surveyBannerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  surveyBannerTextContainer: {
    flex: 1,
    paddingRight: 8,
  },
  surveyBannerText: {
    fontSize: 13,
    color: '#C8CDD0',
    lineHeight: 19,
    fontStyle: 'italic',
  },
  surveyBannerArrow: {
    fontSize: 24,
    color: '#F47C3C',
    fontWeight: '600',
  },
  collapsibleCard: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    marginTop: 24,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
  },
  collapsibleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collapsibleHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  collapsibleChevronHit: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -8,
  },
  collapsibleChevron: {
    fontSize: 14,
    color: BrandColors.accent,
    fontWeight: '600',
  },
  collapsibleTitle: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.accent,
    letterSpacing: LetterSpacing.extraWide,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  collapsibleBody: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BrandColors.cardBorder,
  },
  dietaryMealGroup: {
    marginBottom: 16,
  },
  dietaryMealLabel: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.meta,
    color: BrandColors.accent,
    letterSpacing: LetterSpacing.wide,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  dietaryOption: {
    marginBottom: 10,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: BrandColors.cardBorder,
  },
  dietaryOptionName: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 15,
    lineHeight: 20,
    color: BrandColors.textPrimary,
    marginBottom: 2,
  },
  dietaryOptionDescription: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
    color: BrandColors.textSecondary,
  },
  nutritionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 16,
  },
  nutritionDividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(244, 124, 60, 0.3)',
  },
  nutritionDividerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F47C3C',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: 12,
  },
  section: {
    marginBottom: 24,
  },
  stepDetailsContainer: {
    backgroundColor: '#0E1A1A',
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#F47C3C',
  },
  stepDetailsText: {
    fontSize: 16,
    color: '#9AA3A6',
    lineHeight: 22,
  },
  trainingDetailsContainer: {
    gap: 12,
    marginBottom: 8,
  },
  workoutDayCard: {
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    overflow: 'hidden',
  },
  workoutDayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  workoutDayHeaderInfo: {
    flex: 1,
  },
  workoutDayName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 2,
  },
  workoutDayMeta: {
    fontSize: 13,
    color: '#9AA3A6',
  },
  workoutDayChevron: {
    fontSize: 12,
    color: '#C7C7CC',
    marginLeft: 8,
  },
  workoutDayBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2A3638',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  workoutDayHeaderFocus: {
    marginTop: 10,
  },
  workoutDaySummary: {
    backgroundColor: '#141E1E',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  warmupCooldownSection: {
    backgroundColor: '#141E1E',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  warmupCooldownTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F47C3C',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  warmupCooldownText: {
    fontSize: 14,
    color: '#9AA3A6',
    lineHeight: 20,
  },
  exerciseRow: {
    backgroundColor: '#141E1E',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  exerciseRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  exerciseRowName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    flex: 1,
  },
  exerciseVideoButton: {
    padding: 4,
    marginLeft: 8,
  },
  exerciseMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  exerciseMetaBadge: {
    backgroundColor: '#2A3638',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  exerciseMetaBadgeText: {
    fontSize: 11,
    color: '#F47C3C',
    fontWeight: '500',
  },
  exerciseMetaBadgeSecondary: {
    backgroundColor: '#0E1A1A',
  },
  exerciseMetaBadgeTextSecondary: {
    fontSize: 11,
    color: '#9AA3A6',
    fontWeight: '500',
  },
  exerciseStatsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  exerciseStat: {
    flex: 1,
    backgroundColor: '#0E1A1A',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  exerciseStatLabel: {
    fontSize: 10,
    color: '#9AA3A6',
    fontWeight: '500',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  exerciseStatValue: {
    fontSize: 14,
    color: '#F2F2EE',
    fontWeight: '600',
  },
  exerciseNotes: {
    fontSize: 13,
    color: '#9AA3A6',
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 18,
  },
  nutritionTargetsContainer: {
    gap: 16,
    marginBottom: 24,
  },
  nutritionTargetsHeader: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  nutritionLoadingText: {
    fontSize: 16,
    color: '#9AA3A6',
    textAlign: 'center',
    paddingVertical: 40,
  },
  macroCard: {
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#F47C3C',
  },
  macroCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  macroIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  macroCardTitleContainer: {
    flex: 1,
  },
  macroCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 4,
  },
  macroCardValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F47C3C',
  },
  macroCardUnit: {
    fontSize: 18,
    fontWeight: '400',
    color: '#9AA3A6',
  },
  macroCardExplanation: {
    fontSize: 14,
    color: '#9AA3A6',
    lineHeight: 20,
  },
});
