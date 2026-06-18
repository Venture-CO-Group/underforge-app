import { getDatabase } from './db';
import { isPlannedTrainingDay } from './nutrition-storage';
import { getManualRestDayOverride } from './training-day-override';

export type TrainingDaySignals = {
  /** Distinct completed strength sessions logged in the app today. */
  completedWorkouts: number;
  /** Activities ≥10 min logged manually in the app (not wearable import). */
  manualActivities: number;
  /** Activities ≥10 min imported from HealthKit / wearables. */
  importedActivities: number;
};

export type TrainingDaySwapKind =
  | 'workout_on_rest'
  | 'manual_activity_on_rest'
  | 'imported_activity_on_rest'
  | 'missed_planned_workout'
  | 'manual_rest_override';

export type TrainingDayUi = {
  dayType: 'training' | 'rest';
  daySwapped: boolean;
  swapKind?: TrainingDaySwapKind;
};

const WEARABLE_SOURCES = new Set(['healthkit', 'whoop', 'garmin', 'healthconnect']);

/**
 * What actually happened today for training-day UI and nutrition alignment.
 */
export async function getTrainingDaySignals(
  userId: string,
  ymd: string,
): Promise<TrainingDaySignals> {
  try {
    const db = getDatabase();
    const w = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(DISTINCT workout_day_name) AS c FROM workout_logs
        WHERE user_id = ? AND workout_date = ? AND status = 'completed'`,
      [userId, ymd],
    );
    const activities = await db.getAllAsync<{ source: string }>(
      `SELECT COALESCE(source, 'manual') AS source FROM activity_logs
        WHERE user_id = ? AND activity_date = ?
          AND status != 'deleted'
          AND COALESCE(duration_minutes, 0) >= 10`,
      [userId, ymd],
    );
    let manualActivities = 0;
    let importedActivities = 0;
    for (const row of activities) {
      if (WEARABLE_SOURCES.has(row.source)) importedActivities += 1;
      else manualActivities += 1;
    }
    return {
      completedWorkouts: w?.c ?? 0,
      manualActivities,
      importedActivities,
    };
  } catch {
    return { completedWorkouts: 0, manualActivities: 0, importedActivities: 0 };
  }
}

/** Same rule as nutrition adjustment: any logged training signal counts for targets. */
export function hasAnyTrainingSignal(signals: TrainingDaySignals): boolean {
  return (
    signals.completedWorkouts > 0 ||
    signals.manualActivities > 0 ||
    signals.importedActivities > 0
  );
}

export function deriveTrainingDayUi(
  plannedTraining: boolean,
  signals: TrainingDaySignals,
  isAfter9pm: boolean,
  manualRestOverride = false,
): TrainingDayUi {
  const logged = hasAnyTrainingSignal(signals);

  if (manualRestOverride && plannedTraining) {
    return { dayType: 'rest', daySwapped: true, swapKind: 'manual_rest_override' };
  }

  const dayType: 'training' | 'rest' = plannedTraining || logged ? 'training' : 'rest';

  if (plannedTraining && !logged && isAfter9pm) {
    return { dayType, daySwapped: true, swapKind: 'missed_planned_workout' };
  }

  if (!plannedTraining && logged) {
    let swapKind: TrainingDaySwapKind;
    if (signals.completedWorkouts > 0) {
      swapKind = 'workout_on_rest';
    } else if (signals.manualActivities > 0) {
      swapKind = 'manual_activity_on_rest';
    } else {
      swapKind = 'imported_activity_on_rest';
    }
    return { dayType, daySwapped: true, swapKind };
  }

  return { dayType, daySwapped: false };
}

export async function getTrainingDayUiForDate(
  userId: string,
  ymd: string,
  actionPlan: unknown,
  isAfter9pm: boolean = new Date().getHours() >= 21,
): Promise<TrainingDayUi> {
  const plannedTraining = actionPlan ? isPlannedTrainingDay(actionPlan, ymd) : false;
  const [signals, manualRestOverride] = await Promise.all([
    getTrainingDaySignals(userId, ymd),
    getManualRestDayOverride(userId, ymd),
  ]);
  return deriveTrainingDayUi(plannedTraining, signals, isAfter9pm, manualRestOverride);
}

export async function resolveEffectiveDayType(
  userId: string,
  ymd: string,
  actionPlan: unknown,
): Promise<'training' | 'rest'> {
  const ui = await getTrainingDayUiForDate(userId, ymd, actionPlan);
  return ui.dayType;
}
