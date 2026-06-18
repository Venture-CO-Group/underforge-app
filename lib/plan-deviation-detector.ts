/**
 * Pragmatic "regular deviation → suggest plan update" detector.
 *
 * No silent mutations. We pull the last 14 days of `(adjusted_target,
 * consumed, actual_adjustable_kcal, planned_adjustable_kcal)`, compute two
 * sustained-deviation signals, and surface a coach card on the dashboard
 * when BOTH exceed their thresholds for at least 10 of the 14 days:
 *
 *   intakeDelta   = avg(consumed - adjusted_target) over the 14d window;
 *   activityDelta = avg(actual_adjustable - planned_adjustable) over 14d.
 *
 * The card explains which signal is driving it and CTAs into the existing
 * plan regeneration flow. See the caloric-balance gap-fixes plan §3.4.
 */
import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import { isPlannedTrainingDay, plannedTrainingKcalPerSession } from './nutrition-storage';

const WINDOW_DAYS = 14;
const MIN_DAYS_REQUIRED = 10;
const INTAKE_THRESHOLD = 0.15;
const ACTIVITY_THRESHOLD = 0.20;

export type DeviationDriver = 'intake' | 'activity' | 'both';
export type DeviationDirection = 'over' | 'under';

export interface PlanDeviationSignal {
  driver: DeviationDriver;
  direction: DeviationDirection;
  intakeDeltaPct: number;
  activityDeltaPct: number;
  daysCounted: number;
}

export async function detectPlanDeviation(params: {
  userId: string;
  actionPlan: any;
  todayYmd?: string;
}): Promise<PlanDeviationSignal | null> {
  try {
    const todayYmd = params.todayYmd ?? todayYmdLocal();
    const startYmd = ymdMinusDays(todayYmd, WINDOW_DAYS);

    const db = getDatabase();
    const adjustments = await db.getAllAsync<{
      adjustment_date: string;
      adjusted_calories_target: number;
      activity_calories_burned: number;
      steps_neat_calories: number;
    }>(
      `SELECT adjustment_date, adjusted_calories_target, activity_calories_burned, steps_neat_calories
         FROM nutrition_daily_adjustments
        WHERE user_id = ? AND adjustment_date >= ? AND adjustment_date < ?`,
      [params.userId, startYmd, todayYmd],
    );
    if (adjustments.length < MIN_DAYS_REQUIRED) return null;

    const consumedByDate = await loadConsumedByDate(params.userId, startYmd, todayYmd);

    const trainingStep = params.actionPlan?.steps?.find?.((s: any) => s?.id === 'step_1') ?? null;
    const perSession = plannedTrainingKcalPerSession(trainingStep);

    let intakeDays = 0;
    let activityDays = 0;
    let intakeDeltaSum = 0;
    let activityDeltaSum = 0;
    let intakeOver = 0;
    let activityOver = 0;
    let intakeUnder = 0;
    let activityUnder = 0;

    for (const a of adjustments) {
      const consumed = consumedByDate[a.adjustment_date] ?? 0;
      if (consumed > 0) {
        const intakeDelta = consumed - a.adjusted_calories_target;
        const intakePct = a.adjusted_calories_target > 0 ? intakeDelta / a.adjusted_calories_target : 0;
        if (Math.abs(intakePct) >= INTAKE_THRESHOLD) intakeDays++;
        if (intakePct > 0) intakeOver++;
        else if (intakePct < 0) intakeUnder++;
        intakeDeltaSum += intakePct;
      }

      const actualAdjustable = (a.activity_calories_burned ?? 0) + (a.steps_neat_calories ?? 0);
      const plannedAdjustable = isPlannedTrainingDay(params.actionPlan, a.adjustment_date) ? perSession : 0;
      const denom = Math.max(plannedAdjustable, 200); // avoid /0 on rest days
      const activityDelta = actualAdjustable - plannedAdjustable;
      const activityPct = activityDelta / denom;
      if (Math.abs(activityPct) >= ACTIVITY_THRESHOLD) activityDays++;
      if (activityPct > 0) activityOver++;
      else if (activityPct < 0) activityUnder++;
      activityDeltaSum += activityPct;
    }

    const triggered =
      intakeDays >= MIN_DAYS_REQUIRED && activityDays >= MIN_DAYS_REQUIRED;
    if (!triggered) return null;

    const intakeDeltaPct = intakeDeltaSum / adjustments.length;
    const activityDeltaPct = activityDeltaSum / adjustments.length;

    const driver: DeviationDriver =
      Math.abs(activityDeltaPct) > Math.abs(intakeDeltaPct) ? 'activity'
        : Math.abs(activityDeltaPct) < Math.abs(intakeDeltaPct) ? 'intake'
        : 'both';

    const direction: DeviationDirection =
      driver === 'activity'
        ? activityOver >= activityUnder ? 'over' : 'under'
        : intakeOver >= intakeUnder ? 'over' : 'under';

    return {
      driver,
      direction,
      intakeDeltaPct,
      activityDeltaPct,
      daysCounted: adjustments.length,
    };
  } catch (error) {
    glowLogger.warn('detectPlanDeviation failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function loadConsumedByDate(
  userId: string,
  startYmd: string,
  endYmdExclusive: string,
): Promise<Record<string, number>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ log_date: string; cals: number }>(
    `SELECT log_date, COALESCE(SUM(calories), 0) AS cals
       FROM meal_logs
      WHERE user_id = ? AND log_date >= ? AND log_date < ?
      GROUP BY log_date`,
    [userId, startYmd, endYmdExclusive],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.log_date] = Math.round(r.cals);
  return out;
}

function todayYmdLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ymdMinusDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
