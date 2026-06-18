import {
    getActivityCaloriesForDateRange,
    getActivityDurationForDateRange,
    getQualifyingActivityCountsByDate,
} from './activity-storage';
import { getBodyCompositionLogsOnOrBefore, type BodyCompositionLogRow } from './body-composition-storage';
import { mergeTrainingCountsWithDailyCap } from './consistency-helper';
import {
    getLocalMealCountsByDate,
    getMacroTotalsForDateRange,
    getMealDescriptionsForDateRange,
    getTotalProteinGramsForDateRange,
    getUserNutritionTargets,
    macroCalorieSplitPercentsFromGrams,
    type MacroTotalsForDateRange,
    type NutritionTargets,
} from './nutrition-storage';
import {
    DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE,
    getReportingPeriodBounds as getPeriodBounds,
    promptTimeForMode,
    type WeeklyCheckinScheduleMode,
} from './weekly-checkin-schedule';
import { getLocalWorkoutCountsByDate, getVolumeLiftedKgForDateRange, getWorkoutLogsForDateRange } from './workout-storage';
import { resolveCatalogExercise } from './exercise-catalog';
import { hydrateCustomExerciseFromId, listCustomExercises } from './custom-exercise-storage';
import { DEFAULT_BODYWEIGHT_KG, loadFactorForSet } from './workout-energy';
import {
    activationForExercise,
    aggregateActivation,
    scoresToBodyData,
    topTrainedMuscles,
    underTrainedMuscles,
    type ActivationInput,
    type BodyDatum,
} from './muscle-activation';
import { trainingFocus, type TrainingFocus } from './training-focus';
import type { BodyPartSlug, Exercise } from '../types/workout';

export interface WeeklyReportWeekSlice {
  /** Local YYYY-MM-DD of the first day of this 7-day slice. */
  periodStartYmd: string;
  /** Local YYYY-MM-DD of the last day of this 7-day slice. */
  periodEndYmd: string;
  labelShort: string;
  consistency: number;
  workoutSessions: number;
  activitySessions: number;
  /** workoutSessions + activitySessions */
  totalTrainingSessions: number;
  mealsCapped: number;
}

/** Precomputed deltas for the LLM; all numbers are from local DB only. */
export interface WeeklyReportHighlightsForLLM {
  volumeLiftedKgThisWeek: number;
  volumeLiftedKgPriorWeek: number;
  proteinGramsThisWeek: number;
  proteinGramsPriorWeek: number;
  proteinChangePercentVsPriorWeek: number | null;
  volumeChangePercentVsPriorWeek: number | null;
  activityCaloriesBurnedThisWeek: number;
  activityCaloriesBurnedPriorWeek: number;
  activityDurationMinutesThisWeek: number;
  activityDurationMinutesPriorWeek: number;
  /** Rough estimate: volumeKg / 6 ≈ kcal from strength training. */
  estimatedWorkoutCaloriesThisWeek: number;
  estimatedWorkoutCaloriesPriorWeek: number;
  totalEstimatedCaloriesThisWeek: number;
  totalEstimatedCaloriesPriorWeek: number;
  bodyComposition?: {
    priorLogDate: string;
    latestLogDate: string;
    musclePercentLatest: number;
    fatPercentLatest: number;
    musclePercentDelta: number;
    fatPercentDelta: number;
    estimatedLeanMassKgLatest: number;
    estimatedLeanMassKgPrior: number;
    estimatedLeanMassKgDelta: number;
    weightKgLatest: number;
    weightKgPrior: number;
  };
}

export interface WeeklyReportMacroSnapshot {
  carbsGrams: number;
  proteinGrams: number;
  fatGrams: number;
  fiberGrams: number;
  calories: number;
  /** % of total logged calories from carbs (carbs*4 / total cals * 100) */
  carbsCalPct: number;
  proteinCalPct: number;
  fatCalPct: number;
}

/** Weekly target totals (daily target × 7) used to compute under/over deltas vs logged macros. */
export interface WeeklyMacroTargets {
  caloriesTarget: number;
  carbsTarget: number;
  proteinTarget: number;
  fatTarget: number;
  fiberTarget: number;
}

/** Per-macro under/over framing for the LLM and chat context. */
export interface WeeklyMacroVsTargets {
  caloriesDelta: number;
  caloriesPctOfTarget: number;
  carbsDelta: number;
  carbsPctOfTarget: number;
  proteinDelta: number;
  proteinPctOfTarget: number;
  fatDelta: number;
  fatPctOfTarget: number;
}

export interface WeeklyReportMetrics {
  /** Local YYYY-MM-DD of the first day of the assessed period. */
  reportingPeriodStart: string;
  /** Local YYYY-MM-DD of the last day of the assessed period. */
  reportingPeriodEnd: string;
  /** Schedule mode that produced these bounds. */
  scheduleMode: WeeklyCheckinScheduleMode;
  weeks: WeeklyReportWeekSlice[];
  plannedTrainingDaysPerWeek: number;
  highlightsForLLM: WeeklyReportHighlightsForLLM;
  /** Summed macros for reporting week */
  macrosThisWeek: WeeklyReportMacroSnapshot | null;
  /** User's daily targets (used to compute weekly target reference) */
  nutritionTargets: NutritionTargets | null;
  /** Weekly target totals derived from `nutritionTargets` (× 7). */
  weeklyMacroTargets: WeeklyMacroTargets | null;
  /** Under/over comparisons vs `weeklyMacroTargets` for the assessed period. */
  macroVsTargets: WeeklyMacroVsTargets | null;
  /** Short, normalized meal description samples from `meal_logs` for hint generation. */
  mealDescriptionSamples: string[];
  /** Aggregated muscle activation for the reporting week + balance hints (null when no workouts logged). */
  muscleBalance: WeeklyMuscleBalance | null;
}

export interface WeeklyMuscleBalance {
  /** Heatmap data (slug + intensity 1–3) for the muscle map. */
  data: BodyDatum[];
  /** Most-trained muscle slugs this week (for the "we focused on X" copy). */
  topTrained: BodyPartSlug[];
  /** Trainable muscles low relative to the week (for the "explore targeting Z" copy). */
  underTrained: BodyPartSlug[];
  /** Strength vs cardio split of the week's training. */
  focus: TrainingFocus;
}

/** Bust AsyncStorage narrative cache when DB-backed weekly slices or highlights change. */
export function weeklyReportMetricsFingerprint(m: WeeklyReportMetrics): string {
  const weekSig = m.weeks
    .map(x => `${x.periodStartYmd}:${x.consistency}:${x.workoutSessions}:${x.activitySessions}:${x.mealsCapped}`)
    .join('|');
  const h = m.highlightsForLLM;
  const mv = m.macroVsTargets;
  const samplesSig = m.mealDescriptionSamples.slice(0, 12).join('|');
  return [
    m.scheduleMode,
    m.reportingPeriodStart,
    m.reportingPeriodEnd,
    weekSig,
    h.volumeLiftedKgThisWeek,
    h.volumeLiftedKgPriorWeek,
    h.proteinGramsThisWeek,
    h.proteinGramsPriorWeek,
    h.proteinChangePercentVsPriorWeek ?? 'x',
    h.volumeChangePercentVsPriorWeek ?? 'x',
    h.activityCaloriesBurnedThisWeek,
    h.activityCaloriesBurnedPriorWeek,
    h.activityDurationMinutesThisWeek,
    h.activityDurationMinutesPriorWeek,
    h.totalEstimatedCaloriesThisWeek,
    h.totalEstimatedCaloriesPriorWeek,
    m.macrosThisWeek ? `${m.macrosThisWeek.carbsGrams}:${m.macrosThisWeek.proteinGrams}:${m.macrosThisWeek.fatGrams}:${m.macrosThisWeek.calories}` : 'x',
    mv ? `${mv.caloriesPctOfTarget}:${mv.carbsPctOfTarget}:${mv.proteinPctOfTarget}:${mv.fatPctOfTarget}` : 'x',
    samplesSig,
  ].join('#');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return d;
}

/**
 * Local YYYY-MM-DD key uniquely identifying the assessed period for the active schedule mode.
 * The key is the period start date — Sunday for the default mode, Monday for the alternate.
 */
export function getReportingWeekKey(
  now: Date = new Date(),
  mode: WeeklyCheckinScheduleMode = DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE,
): string {
  return getPeriodBounds(now, mode).weekKey;
}

/**
 * Debug / preview: pretend "now" is just after the most recent prompt time for the given mode
 * (e.g. Sunday 19:00 local for default, Monday 19:00 local for alternate).
 */
export function getMostRecentPromptReferenceDate(
  now: Date = new Date(),
  mode: WeeklyCheckinScheduleMode = DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE,
): Date {
  const { weekday, hour } = promptTimeForMode(mode);
  const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = ref.getDay();
  const daysBack = day === weekday ? 0 : (day - weekday + 7) % 7;
  const anchor = addDays(ref, -daysBack);
  anchor.setHours(hour + 1, 0, 0, 0);
  return anchor;
}


async function consistencyForClosedWeek(
  userId: string,
  startStr: string,
  endStr: string,
  plannedTrainingDays: string[],
): Promise<number> {
  const [mealCounts, workoutCounts, qualifyingActivityCounts] = await Promise.all([
    getLocalMealCountsByDate(userId, startStr, endStr),
    getLocalWorkoutCountsByDate(userId, startStr, endStr),
    getQualifyingActivityCountsByDate(userId, startStr, endStr),
  ]);

  const mealsCapped = Object.values(mealCounts).reduce((sum, c) => sum + Math.min(c, 3), 0);
  const cappedTraining = mergeTrainingCountsWithDailyCap(workoutCounts, qualifyingActivityCounts);
  const totalTraining = Object.values(cappedTraining).reduce((sum, c) => sum + c, 0);
  const totalPlanned = plannedTrainingDays.length;

  if (totalPlanned === 0) {
    return Math.round(Math.min((mealsCapped / 21) * 100, 100));
  }

  const trainingPart = Math.min((totalTraining / totalPlanned) * 100 * 0.5, 50);
  const nutritionPart = Math.min((mealsCapped / 21) * 100 * 0.5, 50);
  return Math.round(trainingPart + nutritionPart);
}

function sumWorkouts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((s, c) => s + c, 0);
}

function sumMealsCapped(counts: Record<string, number>): number {
  return Object.values(counts).reduce((s, c) => s + Math.min(c, 3), 0);
}

function buildMacroSnapshot(m: MacroTotalsForDateRange): WeeklyReportMacroSnapshot | null {
  const totalCals = m.calories;
  if (totalCals <= 0) return null;
  const split = macroCalorieSplitPercentsFromGrams(m.carbsGrams, m.proteinGrams, m.fatGrams);
  const pcts = split ?? { carbsPct: 0, proteinPct: 0, fatPct: 0 };
  return {
    ...m,
    carbsCalPct: pcts.carbsPct,
    proteinCalPct: pcts.proteinPct,
    fatCalPct: pcts.fatPct,
  };
}

function weightToKg(value: number, unit: string): number {
  return unit === 'lbs' ? value / 2.2046226218 : value;
}

function buildHighlightsForLLM(
  volumeThis: number,
  volumePrior: number,
  proteinThis: number,
  proteinPrior: number,
  bodyRows: BodyCompositionLogRow[],
  actCalThis: number,
  actCalPrior: number,
  actDurThis: number,
  actDurPrior: number,
): WeeklyReportHighlightsForLLM {
  const proteinChange =
    proteinPrior > 0 ? Math.round(((proteinThis - proteinPrior) / proteinPrior) * 1000) / 10 : null;
  const volumeChange =
    volumePrior > 0 ? Math.round(((volumeThis - volumePrior) / volumePrior) * 1000) / 10 : null;

  let bodyComposition: WeeklyReportHighlightsForLLM['bodyComposition'];
  if (bodyRows.length >= 2) {
    const latest = bodyRows[0];
    const prior = bodyRows[1];
    const wLatest = weightToKg(latest.weightValue, latest.weightUnit);
    const wPrior = weightToKg(prior.weightValue, prior.weightUnit);
    const leanLatest = Math.round(wLatest * (latest.musclePercent / 100) * 10) / 10;
    const leanPrior = Math.round(wPrior * (prior.musclePercent / 100) * 10) / 10;
    bodyComposition = {
      priorLogDate: prior.logDate,
      latestLogDate: latest.logDate,
      musclePercentLatest: latest.musclePercent,
      fatPercentLatest: latest.fatPercent,
      musclePercentDelta: Math.round((latest.musclePercent - prior.musclePercent) * 10) / 10,
      fatPercentDelta: Math.round((latest.fatPercent - prior.fatPercent) * 10) / 10,
      estimatedLeanMassKgLatest: leanLatest,
      estimatedLeanMassKgPrior: leanPrior,
      estimatedLeanMassKgDelta: Math.round((leanLatest - leanPrior) * 10) / 10,
      weightKgLatest: Math.round(wLatest * 10) / 10,
      weightKgPrior: Math.round(wPrior * 10) / 10,
    };
  }

  const estWorkoutCalThis = Math.round(volumeThis / 6);
  const estWorkoutCalPrior = Math.round(volumePrior / 6);

  return {
    volumeLiftedKgThisWeek: volumeThis,
    volumeLiftedKgPriorWeek: volumePrior,
    proteinGramsThisWeek: proteinThis,
    proteinGramsPriorWeek: proteinPrior,
    proteinChangePercentVsPriorWeek: proteinChange,
    volumeChangePercentVsPriorWeek: volumeChange,
    activityCaloriesBurnedThisWeek: actCalThis,
    activityCaloriesBurnedPriorWeek: actCalPrior,
    activityDurationMinutesThisWeek: actDurThis,
    activityDurationMinutesPriorWeek: actDurPrior,
    estimatedWorkoutCaloriesThisWeek: estWorkoutCalThis,
    estimatedWorkoutCaloriesPriorWeek: estWorkoutCalPrior,
    totalEstimatedCaloriesThisWeek: actCalThis + estWorkoutCalThis,
    totalEstimatedCaloriesPriorWeek: actCalPrior + estWorkoutCalPrior,
    bodyComposition,
  };
}

function buildWeeklyMacroTargets(t: NutritionTargets | null): WeeklyMacroTargets | null {
  if (!t) return null;
  return {
    caloriesTarget: t.caloriesTarget * 7,
    carbsTarget: t.carbsTarget * 7,
    proteinTarget: t.proteinTarget * 7,
    fatTarget: t.fatTarget * 7,
    fiberTarget: t.fiberTarget * 7,
  };
}

function buildMacroVsTargets(
  snap: WeeklyReportMacroSnapshot | null,
  targets: WeeklyMacroTargets | null,
): WeeklyMacroVsTargets | null {
  if (!snap || !targets) return null;
  const pct = (logged: number, target: number) =>
    target > 0 ? Math.round((logged / target) * 100) : 0;
  return {
    caloriesDelta: Math.round(snap.calories - targets.caloriesTarget),
    caloriesPctOfTarget: pct(snap.calories, targets.caloriesTarget),
    carbsDelta: Math.round(snap.carbsGrams - targets.carbsTarget),
    carbsPctOfTarget: pct(snap.carbsGrams, targets.carbsTarget),
    proteinDelta: Math.round(snap.proteinGrams - targets.proteinTarget),
    proteinPctOfTarget: pct(snap.proteinGrams, targets.proteinTarget),
    fatDelta: Math.round(snap.fatGrams - targets.fatTarget),
    fatPctOfTarget: pct(snap.fatGrams, targets.fatTarget),
  };
}

export async function fetchWeeklyReportMetrics(
  userId: string,
  plannedTrainingDays: string[],
  now: Date = new Date(),
  mode: WeeklyCheckinScheduleMode = DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE,
): Promise<WeeklyReportMetrics> {
  const bounds = getPeriodBounds(now, mode);
  const reportingPeriodStart = bounds.periodStartYmd;
  const reportingPeriodEnd = bounds.periodEndYmd;

  const weeks: WeeklyReportWeekSlice[] = [];

  for (let offset = 0; offset < 4; offset++) {
    const start = addDays(bounds.periodStart, -7 * offset);
    const end = addDays(start, 6);
    const startStr = toYMD(start);
    const endStr = toYMD(end);

    const [mealCounts, workoutCounts, qualifyingActivityCounts] = await Promise.all([
      getLocalMealCountsByDate(userId, startStr, endStr),
      getLocalWorkoutCountsByDate(userId, startStr, endStr),
      getQualifyingActivityCountsByDate(userId, startStr, endStr),
    ]);

    const consistency = await consistencyForClosedWeek(userId, startStr, endStr, plannedTrainingDays);
    const workoutSessions = sumWorkouts(workoutCounts);
    const activitySessions = sumWorkouts(qualifyingActivityCounts);
    const mealsCapped = sumMealsCapped(mealCounts);

    let labelShort: string;
    if (offset === 0) labelShort = 'This week';
    else if (offset === 1) labelShort = '−1 wk';
    else if (offset === 2) labelShort = '−2 wk';
    else labelShort = '−3 wk';

    weeks.push({
      periodStartYmd: startStr,
      periodEndYmd: endStr,
      labelShort,
      consistency,
      workoutSessions,
      activitySessions,
      totalTrainingSessions: workoutSessions + activitySessions,
      mealsCapped,
    });
  }

  const priorPeriodStart = addDays(bounds.periodStart, -7);
  const priorPeriodEnd = addDays(priorPeriodStart, 6);
  const priorStartStr = toYMD(priorPeriodStart);
  const priorEndStr = toYMD(priorPeriodEnd);

  const [
    volumeThis, volumePrior,
    proteinThis, proteinPrior,
    bodyRows,
    actCalThis, actCalPrior,
    actDurThis, actDurPrior,
    macroTotals,
    nutritionTargets,
    mealDescriptionSamples,
  ] = await Promise.all([
    getVolumeLiftedKgForDateRange(userId, reportingPeriodStart, reportingPeriodEnd),
    getVolumeLiftedKgForDateRange(userId, priorStartStr, priorEndStr),
    getTotalProteinGramsForDateRange(userId, reportingPeriodStart, reportingPeriodEnd),
    getTotalProteinGramsForDateRange(userId, priorStartStr, priorEndStr),
    getBodyCompositionLogsOnOrBefore(userId, reportingPeriodEnd, 4),
    getActivityCaloriesForDateRange(userId, reportingPeriodStart, reportingPeriodEnd),
    getActivityCaloriesForDateRange(userId, priorStartStr, priorEndStr),
    getActivityDurationForDateRange(userId, reportingPeriodStart, reportingPeriodEnd),
    getActivityDurationForDateRange(userId, priorStartStr, priorEndStr),
    getMacroTotalsForDateRange(userId, reportingPeriodStart, reportingPeriodEnd),
    getUserNutritionTargets(userId),
    getMealDescriptionsForDateRange(userId, reportingPeriodStart, reportingPeriodEnd, 40),
  ]);

  const highlightsForLLM = buildHighlightsForLLM(
    volumeThis, volumePrior,
    proteinThis, proteinPrior,
    bodyRows,
    actCalThis, actCalPrior,
    actDurThis, actDurPrior,
  );

  const macrosThisWeek = buildMacroSnapshot(macroTotals);
  const weeklyMacroTargets = buildWeeklyMacroTargets(nutritionTargets);
  const macroVsTargets = buildMacroVsTargets(macrosThisWeek, weeklyMacroTargets);
  const latestBodyweightKg = resolveLatestBodyweightKg(bodyRows);
  const muscleBalance = await buildWeeklyMuscleBalance(
    userId,
    reportingPeriodStart,
    reportingPeriodEnd,
    latestBodyweightKg,
  );

  return {
    reportingPeriodStart,
    reportingPeriodEnd,
    scheduleMode: mode,
    weeks,
    plannedTrainingDaysPerWeek: plannedTrainingDays.length,
    highlightsForLLM,
    macrosThisWeek,
    nutritionTargets,
    weeklyMacroTargets,
    macroVsTargets,
    mealDescriptionSamples,
    muscleBalance,
  };
}

/**
 * Aggregate muscle activation across the reporting week's completed workouts. Resolves each
 * logged exercise to the catalog (or a custom exercise) for its `muscleActivation`, weighted by
 * the number of sets logged. Returns null when nothing was trained.
 */
function resolveLatestBodyweightKg(rows: BodyCompositionLogRow[]): number {
  const latest = rows?.[0];
  if (!latest || !(latest.weightValue > 0)) return DEFAULT_BODYWEIGHT_KG;
  return latest.weightUnit === 'lbs' ? latest.weightValue * 0.453592 : latest.weightValue;
}

async function buildWeeklyMuscleBalance(
  userId: string,
  startYmd: string,
  endYmd: string,
  bodyweightKg: number,
): Promise<WeeklyMuscleBalance | null> {
  try {
    const [logs, customExercises] = await Promise.all([
      getWorkoutLogsForDateRange(userId, startYmd, endYmd, true),
      listCustomExercises(userId),
    ]);

    const customById = new Map<string, Exercise>(customExercises.map((e) => [e.id, e]));
    const resolve = (exerciseId: string, name: string): Exercise | undefined => {
      return (
        customById.get(exerciseId) ||
        resolveCatalogExercise(exerciseId, name) ||
        hydrateCustomExerciseFromId(exerciseId, name, userId) ||
        undefined
      );
    };

    // Sum a load-weighted contribution per exercise across completed sessions: each logged set
    // counts by how heavy it was (loadFactorForSet), so a heavy squat outweighs a light one.
    const exerciseLoads = new Map<string, { name: string; weight: number }>();
    for (const log of logs) {
      if (log.status !== 'completed' || !log.exercises) continue;
      for (const ex of log.exercises) {
        const key = ex.exerciseId || ex.exerciseName;
        const w = loadFactorForSet(ex.weightValue, ex.weightUnit, bodyweightKg);
        const prev = exerciseLoads.get(key);
        if (prev) prev.weight += w;
        else exerciseLoads.set(key, { name: ex.exerciseName, weight: w });
      }
    }
    if (exerciseLoads.size === 0) return null;

    const items: ActivationInput[] = [];
    const focusItems: { category?: Exercise['category']; weight: number }[] = [];
    for (const [key, { name, weight }] of exerciseLoads) {
      const detail = resolve(key, name);
      items.push({ activation: activationForExercise(detail), weight });
      focusItems.push({ category: detail?.category, weight });
    }

    const scores = aggregateActivation(items);
    const data: BodyDatum[] = scoresToBodyData(scores);
    if (data.length === 0) return null;

    return {
      data,
      topTrained: topTrainedMuscles(scores, 2),
      underTrained: underTrainedMuscles(scores).slice(0, 3),
      focus: trainingFocus(focusItems),
    };
  } catch {
    return null;
  }
}
