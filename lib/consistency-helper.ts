import { getQualifyingActivityCountsByDate } from './activity-storage';
import { getLocalMealCountsByDate } from './nutrition-storage';
import { getLocalWorkoutCountsByDate } from './workout-storage';

export const CONSISTENCY_THRESHOLD = 80;

/** YYYY-MM-DD in local timezone — matches CoachDashboard / SQLite date keys */
export function formatLocalYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const WEEK_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Monday–Sunday bounds for the calendar week containing `now` (local). */
export function getWeekMondaySundayYmd(now: Date = new Date()): {
  monday: Date;
  mondayStr: string;
  sundayStr: string;
} {
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday, mondayStr: formatLocalYmd(monday), sundayStr: formatLocalYmd(sunday) };
}

/**
 * Same formula as CoachDashboard `thisWeekScore` ("until today" mode).
 * Used when uploading leaderboard scores without mounting the dashboard.
 */
export function computeThisWeekDashboardConsistencyScore(params: {
  now?: Date;
  plannedTrainingDayAbbrevs: Set<string>;
  weeklyMealCountsByDate: Record<string, number>;
  mergedTrainingCountsByDate: Record<string, number>;
  userJoinDateYmd: string | null;
}): number {
  const now = params.now ?? new Date();
  const { monday } = getWeekMondaySundayYmd(now);

  const todayDayIndex = now.getDay();
  const daysElapsedThisWeek = todayDayIndex === 0 ? 7 : todayDayIndex;

  const daysUntilToday = new Set(
    WEEK_DAY_KEYS.slice(0, daysElapsedThisWeek).filter(dayKey => {
      if (!params.userJoinDateYmd) return true;
      const idx = WEEK_DAY_KEYS.indexOf(dayKey);
      const d = new Date(monday);
      d.setDate(monday.getDate() + idx);
      return formatLocalYmd(d) >= params.userJoinDateYmd;
    }),
  );

  const mealsUntilTodayTarget = 3 * daysUntilToday.size;
  const plannedTrainingDaysUntilToday = [...params.plannedTrainingDayAbbrevs].filter(d =>
    daysUntilToday.has(d as (typeof WEEK_DAY_KEYS)[number]),
  ).length;

  const thisWeekMeals = Object.values(params.weeklyMealCountsByDate).reduce(
    (sum, c) => sum + Math.min(c, 3),
    0,
  );

  const scoreTodayStr = formatLocalYmd(now);
  const workoutsUntilToday = Object.entries(params.mergedTrainingCountsByDate)
    .filter(([date]) => date <= scoreTodayStr)
    .reduce((sum, [, c]) => sum + c, 0);

  const noTrainingExpectedYet = plannedTrainingDaysUntilToday === 0;
  if (noTrainingExpectedYet) {
    const nutritionPart =
      mealsUntilTodayTarget > 0
        ? Math.min((thisWeekMeals / mealsUntilTodayTarget) * 100, 100)
        : 0;
    return Math.round(nutritionPart);
  }

  const trainingPart = Math.min(
    (workoutsUntilToday / plannedTrainingDaysUntilToday) * 100 * 0.5,
    50,
  );
  const nutritionPart =
    mealsUntilTodayTarget > 0
      ? Math.min((thisWeekMeals / mealsUntilTodayTarget) * 100 * 0.5, 50)
      : 0;
  return Math.round(trainingPart + nutritionPart);
}

/**
 * Merge workout-day counts and qualifying-activity counts into a single map
 * with a daily cap of 1 training session per date. A logged gym workout AND
 * a hard run on the same day count once toward the planned-day denominator,
 * not twice. This keeps the score honest when users do strength + cardio.
 *
 * "Qualifying activity" = an activity_logs row that satisfies all of:
 *   - activity_type !== 'stretching'
 *   - duration_minutes >= 30
 *   - intensity in ('hard','max') OR (moderate AND duration >= 45 min)
 * (See `getQualifyingActivityCountsByDate` in activity-storage.ts.)
 */
export const mergeTrainingCountsWithDailyCap = (
  workoutCounts: Record<string, number>,
  qualifyingActivityCounts: Record<string, number>,
): Record<string, number> => {
  const merged: Record<string, number> = {};
  const dates = new Set<string>([
    ...Object.keys(workoutCounts),
    ...Object.keys(qualifyingActivityCounts),
  ]);
  for (const date of dates) {
    const w = workoutCounts[date] ?? 0;
    const a = qualifyingActivityCounts[date] ?? 0;
    merged[date] = w + a > 0 ? 1 : 0;
  }
  return merged;
};

/**
 * Calculates the current week's "Whole week" consistency score.
 *
 * Uses full-week targets as denominators — matches the "Whole week" mode
 * on the dashboard. This is the score used for the celebration trigger.
 *
 *   Training:  min(qualifying_training_days / total_planned_training_days, 1) × 50
 *   Nutrition: min(meals_logged (capped 3/day) / 21, 1) × 50
 *
 * Training counts a calendar day as "trained" iff there is at least one
 * non-deleted workout_log OR one qualifying activity (see above) on that
 * date — so a strength session + a hard run on the same day count as one,
 * not two.
 *
 * @param userId               The user's ID
 * @param plannedTrainingDays  Planned workout day abbreviations e.g. ['mon','wed','fri']
 */
export const calculateWeeklyConsistency = async (
  userId: string,
  plannedTrainingDays: string[],
  options?: { completedOnly?: boolean }
): Promise<number> => {
  try {
    const now = new Date();

    const todayDayIndex = now.getDay(); // 0=Sun, 1=Mon …
    const mondayOffset = todayDayIndex === 0 ? -6 : 1 - todayDayIndex;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const mondayStr = formatLocalYmd(monday);
    const sundayStr = formatLocalYmd(new Date(monday.getTime() + 6 * 86400000));
    const todayStr = formatLocalYmd(now);

    const totalPlannedWorkouts = plannedTrainingDays.length;

    const [mealCounts, workoutCounts, qualifyingActivityCounts] = await Promise.all([
      getLocalMealCountsByDate(userId, mondayStr, todayStr),
      getLocalWorkoutCountsByDate(userId, mondayStr, sundayStr),
      getQualifyingActivityCountsByDate(userId, mondayStr, sundayStr),
    ]);

    const thisWeekMeals = Object.values(mealCounts).reduce((sum, c) => sum + Math.min(c, 3), 0);
    const trainingDayMap = mergeTrainingCountsWithDailyCap(workoutCounts, qualifyingActivityCounts);
    const thisWeekTotalTraining = Object.values(trainingDayMap).reduce((sum, c) => sum + c, 0);

    if (totalPlannedWorkouts === 0) {
      return Math.round(Math.min((thisWeekMeals / 21) * 100, 100));
    }

    const trainingPart = Math.min((thisWeekTotalTraining / totalPlannedWorkouts) * 100 * 0.5, 50);
    const nutritionPart = Math.min((thisWeekMeals / 21) * 100 * 0.5, 50);

    return Math.round(trainingPart + nutritionPart);
  } catch (error) {
    console.error('[consistency-helper] Error calculating score:', error);
    return 0;
  }
};

/**
 * Returns true when the score has just crossed from below the threshold
 * to at-or-above it. Pure comparison — no stored state.
 */
export const didCrossConsistencyThreshold = (
  scoreBefore: number,
  scoreAfter: number
): boolean => scoreBefore < CONSISTENCY_THRESHOLD && scoreAfter >= CONSISTENCY_THRESHOLD;
