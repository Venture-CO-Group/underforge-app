import { Onboard } from '../types/onboard';
import { glowLogger } from './glow-logger';
import {
  getEffectiveNutritionTargets,
  getMacroTotalsForDateRange,
  getMealLogsForDateRange,
  getTodayNutrition,
} from './nutrition-storage';
import { getWorkoutLogsForDateRange } from './workout-storage';
import { getActivityLogsForDateRange } from './activity-storage';
import { getBodyCompositionLogsOnOrBefore } from './body-composition-storage';

// Compact, ALWAYS-ON awareness block attached to every chat turn. The goal is
// to make the coach feel genuinely aware of the user without forcing the
// conversation. Aggregates (averages, gaps vs target, trends) are precomputed
// here so the LLM doesn't have to mentally summarize raw logs — it can just
// quote the numbers naturally and propose specific gap-closing actions.
//
// This block is intentionally distinct from the on-demand `fetchUserDataSnapshot`
// (which lists raw meals/workouts when the classifier decides detail is needed).
// Awareness is small (~15-20 lines) and cheap; detail can be layered on top.

const DAY_FULL_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function signed(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `${n}`;
}

function gapPhrase(consumed: number, target: number, unit: string): string {
  if (target <= 0) return `${consumed}${unit} (no target set)`;
  const diff = consumed - target;
  if (diff === 0) return `${consumed}${unit} (on target)`;
  const absDiff = Math.abs(diff);
  const verb = diff < 0 ? 'short' : 'over';
  return `${consumed}${unit} / target ${target}${unit} (${absDiff}${unit} ${verb})`;
}

async function buildTodayBlock(userId: string, onboardData: Onboard, now: Date): Promise<string[]> {
  const dayLabel = DAY_FULL_NAMES[now.getDay()];
  const lines: string[] = [`Today (${dayLabel}, ${ymd(now)}):`];
  try {
    const n = await getTodayNutrition(userId, { actionPlan: onboardData.actionPlan });
    if (n.caloriesTarget > 0) {
      lines.push(
        `  Calories consumed: ${n.totalCalories} / ${n.caloriesTarget} kcal (${Math.round(n.caloriesPercentOfTarget)}%) — ${Math.max(0, n.caloriesTarget - n.totalCalories)} kcal left`,
        `  Protein consumed:  ${n.totalProtein} / ${n.proteinTarget} g (${Math.round(n.proteinPercentOfTarget)}%) — ${Math.max(0, n.proteinTarget - n.totalProtein)} g left`,
        `  Carbs consumed:    ${n.totalCarbs} / ${n.carbsTarget} g`,
        `  Fat consumed:      ${n.totalFat} / ${n.fatTarget} g`,
      );
    } else {
      lines.push('  (no nutrition targets configured yet)');
    }
  } catch (err) {
    glowLogger.warn('Awareness: today nutrition fetch failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return lines;
}

async function buildNutritionAveragesBlock(
  userId: string,
  startStr: string,
  endStr: string,
  days: number,
): Promise<string[]> {
  const lines: string[] = [];
  try {
    const [totals, meals, targetsResult] = await Promise.all([
      getMacroTotalsForDateRange(userId, startStr, endStr),
      getMealLogsForDateRange(userId, startStr, endStr),
      getEffectiveNutritionTargets(userId, endStr, { dayType: 'rest' }).catch(() => null),
    ]);

    const mealCount = meals.length;
    const daysLogged = new Set(meals.map(m => m.logDate)).size;
    const baselineTarget = targetsResult?.targets;

    if (mealCount === 0) {
      lines.push(`Last ${days} days nutrition: no meals logged yet.`);
      return lines;
    }

    const avgCalories = Math.round(totals.calories / days);
    const avgProtein = Math.round(totals.proteinGrams / days);
    const avgCarbs = Math.round(totals.carbsGrams / days);
    const avgFat = Math.round(totals.fatGrams / days);
    const avgProteinPerMeal = mealCount > 0 ? Math.round(totals.proteinGrams / mealCount) : 0;

    lines.push(`Last ${days} days nutrition averages (logged ${daysLogged}/${days} days, ${mealCount} meals):`);
    if (baselineTarget) {
      lines.push(
        `  Calories/day avg: ${gapPhrase(avgCalories, baselineTarget.caloriesTarget, ' kcal')}`,
        `  Protein/day avg:  ${gapPhrase(avgProtein, baselineTarget.proteinTarget, 'g')} — avg ${avgProteinPerMeal}g per logged meal`,
        `  Carbs/day avg:    ${gapPhrase(avgCarbs, baselineTarget.carbsTarget, 'g')}`,
        `  Fat/day avg:      ${gapPhrase(avgFat, baselineTarget.fatTarget, 'g')}`,
      );
    } else {
      lines.push(
        `  Calories/day avg: ${avgCalories} kcal`,
        `  Protein/day avg:  ${avgProtein}g — avg ${avgProteinPerMeal}g per logged meal`,
        `  Carbs/day avg:    ${avgCarbs}g`,
        `  Fat/day avg:      ${avgFat}g`,
      );
    }
  } catch (err) {
    glowLogger.warn('Awareness: nutrition averages failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return lines;
}

async function buildTrainingBlock(
  userId: string,
  startStr: string,
  endStr: string,
  days: number,
): Promise<string[]> {
  const lines: string[] = [];
  try {
    const [workouts, activities] = await Promise.all([
      getWorkoutLogsForDateRange(userId, startStr, endStr),
      getActivityLogsForDateRange(userId, startStr, endStr),
    ]);

    const completedWorkouts = workouts.filter(w => w.status === 'completed');
    // getActivityLogsForDateRange already filters out deleted rows.
    const completedActivities = activities;
    const totalActivityMin = completedActivities.reduce((s, a) => s + (a.durationMinutes || 0), 0);

    if (completedWorkouts.length === 0 && completedActivities.length === 0) {
      lines.push(`Last ${days} days training: nothing logged.`);
      return lines;
    }

    const parts: string[] = [];
    if (completedWorkouts.length > 0) {
      parts.push(`${completedWorkouts.length} workout${completedWorkouts.length === 1 ? '' : 's'}`);
    }
    if (completedActivities.length > 0) {
      const hours = Math.round((totalActivityMin / 60) * 10) / 10;
      parts.push(`${completedActivities.length} activit${completedActivities.length === 1 ? 'y' : 'ies'} (${hours}h total)`);
    }
    lines.push(`Last ${days} days training: ${parts.join(', ')}.`);
  } catch (err) {
    glowLogger.warn('Awareness: training block failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return lines;
}

async function buildBodyCompBlock(userId: string, todayStr: string): Promise<string[]> {
  const lines: string[] = [];
  try {
    // Pull recent body comp rows. Take latest as "now" and find one ~4 weeks
    // older as the comparison baseline (≥21 days ago).
    const rows = await getBodyCompositionLogsOnOrBefore(userId, todayStr, 12);
    if (!rows || rows.length === 0) {
      return lines;
    }
    const latest = rows[0];
    const latestDate = new Date(latest.logDate);

    const baseline = rows.find(r => {
      const diffDays = (latestDate.getTime() - new Date(r.logDate).getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 21;
    });

    const weightLabel = `${Math.round(latest.weightValue * 10) / 10}${latest.weightUnit}`;
    if (baseline) {
      const wDelta = Math.round((latest.weightValue - baseline.weightValue) * 10) / 10;
      const mDelta = Math.round((latest.musclePercent - baseline.musclePercent) * 10) / 10;
      const fDelta = Math.round((latest.fatPercent - baseline.fatPercent) * 10) / 10;
      const daysAgo = Math.round(
        (latestDate.getTime() - new Date(baseline.logDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      lines.push(
        `Body composition (latest ${latest.logDate}, vs ${daysAgo}d ago):`,
        `  Weight: ${weightLabel} (${signed(wDelta)}${latest.weightUnit})`,
        `  Muscle: ${latest.musclePercent}% (${signed(mDelta)}pp), Fat: ${latest.fatPercent}% (${signed(fDelta)}pp)`,
      );
    } else {
      lines.push(
        `Body composition (latest ${latest.logDate}, no prior baseline):`,
        `  Weight: ${weightLabel}, Muscle: ${latest.musclePercent}%, Fat: ${latest.fatPercent}%`,
      );
    }
  } catch (err) {
    glowLogger.warn('Awareness: body comp block failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return lines;
}

/**
 * Compact always-on summary of what the app knows about the user RIGHT NOW.
 * Returns an empty string if it can't build anything useful (errors are
 * swallowed so chat is never blocked by this).
 */
export async function fetchUserAwarenessSummary(
  userId: string,
  onboardData: Onboard,
): Promise<string> {
  try {
    const now = new Date();
    const todayStr = ymd(now);
    const sevenDaysAgo = ymd(addDays(now, -6)); // 7 days inclusive
    const SEVEN = 7;

    const [todayLines, nutritionLines, trainingLines, bodyCompLines] = await Promise.all([
      buildTodayBlock(userId, onboardData, now),
      buildNutritionAveragesBlock(userId, sevenDaysAgo, todayStr, SEVEN),
      buildTrainingBlock(userId, sevenDaysAgo, todayStr, SEVEN),
      buildBodyCompBlock(userId, todayStr),
    ]);

    const sections: string[][] = [todayLines, nutritionLines, trainingLines, bodyCompLines]
      .filter(s => s.length > 0);

    if (sections.length === 0) return '';

    const body = sections.map(s => s.join('\n')).join('\n');
    const summary = `--- USER AWARENESS (live) ---\n${body}`;
    glowLogger.info('Built user awareness summary', { length: summary.length });
    return summary;
  } catch (error) {
    glowLogger.error('Failed to build user awareness summary', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
