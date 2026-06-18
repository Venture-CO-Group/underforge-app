/**
 * Pure burned-calorie bucket math (no DB / Expo). Unit-tested via ts-node.
 */

import { stepsNeatKcal } from './nutrition-math';

export function getOccupationMultiplier(occupationActivity: string): number {
  if (occupationActivity.includes('Very active')) return 1.55;
  if (occupationActivity.includes('Regular')) return 1.4;
  if (occupationActivity.includes('standing') || occupationActivity.includes('walking')) return 1.3;
  return 1.2;
}

export function estimateOccupationNeatKcal(bmrKcal: number, occupationActivity: string): number {
  const bmr = Math.max(0, Math.round(bmrKcal));
  if (bmr <= 0) return 0;
  return Math.max(0, Math.round(bmr * (getOccupationMultiplier(occupationActivity) - 1)));
}

/**
 * Sessions target for the burn card / breakdown.
 * - Planned training day: at least the plan's estimated session burn (or
 *   recent 30-day session average when the plan has no estimate) so the bar
 *   is not empty; still at least what you've already logged.
 * - Rest day: today's logged sessions only — no 30-day ghost target.
 */
export function resolveSessionsTargetKcal(
  achieved: number,
  avg30d: number,
  plannedTrainingToday: boolean,
  plannedSessionTargetKcal = 0,
): number {
  const ach = Math.max(0, Math.round(achieved));
  const avg = Math.max(0, Math.round(avg30d));
  const plan = Math.max(0, Math.round(plannedSessionTargetKcal));

  if (plannedTrainingToday) {
    const baseline = plan > 0 ? plan : avg;
    return Math.max(ach, baseline);
  }
  return ach;
}

/**
 * Steps NEAT preferred; else active_energy minus sessions (active_energy excludes BMR).
 *
 * When real step data exists (from a wearable / external source), every
 * step is credited as kcal — no 7,500-step baseline subtraction. The
 * "occupation NEAT credit" path in `applyNoWearableMovementEstimate`
 * already replaces that math when no live source is connected, so the
 * baseline subtraction is unnecessary here and would just under-credit
 * users who actually have hard step data. See PR discussion in the
 * merge commit for the full rationale.
 */
export function resolveDailyMovementAchievedKcal(params: {
  steps: number;
  activeEnergyKcal: number;
  sessionsAchieved: number;
  weightKg: number;
}): number {
  const { steps, activeEnergyKcal, sessionsAchieved, weightKg } = params;
  if (steps > 0) return stepsNeatKcal(steps, weightKg, { fromZero: true });
  if (activeEnergyKcal > 0) {
    return Math.max(0, Math.round(activeEnergyKcal) - sessionsAchieved);
  }
  return 0;
}

export function resolveDailyMovementTargetKcal(
  achieved: number,
  avg30d: number,
  occupationNeatKcal: number,
): number {
  return Math.max(achieved, avg30d, occupationNeatKcal);
}

/**
 * Without a wearable, daily movement cannot be verified — credit occupation
 * NEAT as already complete (achieved = target) instead of showing pending burn.
 */
export function applyNoWearableMovementEstimate(params: {
  hasWearable: boolean;
  occupationNeatKcal: number;
  measuredAchieved: number;
  measuredTarget: number;
}): {
  achieved: number;
  target: number;
  estimatedFromOccupation: boolean;
} {
  const occupation = Math.max(0, Math.round(params.occupationNeatKcal));
  if (params.hasWearable || occupation <= 0) {
    return {
      achieved: params.measuredAchieved,
      target: params.measuredTarget,
      estimatedFromOccupation: false,
    };
  }
  return {
    achieved: occupation,
    target: occupation,
    estimatedFromOccupation: true,
  };
}

/**
 * Structural shape of a burned breakdown for pure helpers. Mirrors the
 * `CaloriesBurnedBreakdown` produced by `lib/calories-balance.ts` but stays
 * free of DB / Expo imports so it can be unit-tested with ts-node.
 */
export interface BurnedBreakdownLike {
  achievedTotal: number;
  targetTotal: number;
  /** When false, home "actively burn" uses sessions only (no daily movement). */
  hasWearableMovement?: boolean;
  rows: ReadonlyArray<{
    key: string;
    achieved: number;
    target: number;
    estimatedFromOccupation?: boolean;
  }>;
}

/**
 * Active (non-BMR) burn for the home card. With a wearable/external movement
 * source: sessions + daily movement (progress vs target). Without one:
 * sessions only — occupation-estimated NEAT stays in the modal, not the bar.
 */
export function activeBurnFromBreakdown(
  breakdown: BurnedBreakdownLike,
): { achievedKcal: number; targetKcal: number } {
  if (breakdown.hasWearableMovement !== true) {
    const sessions = breakdown.rows.find((r) => r.key === 'sessions');
    return {
      achievedKcal: Math.max(0, Math.round(sessions?.achieved ?? 0)),
      targetKcal: Math.max(0, Math.round(sessions?.target ?? 0)),
    };
  }

  const bmr = breakdown.rows.find((r) => r.key === 'bmr');
  const bmrAchieved = bmr?.achieved ?? 0;
  const bmrTarget = bmr?.target ?? 0;
  return {
    achievedKcal: Math.max(0, breakdown.achievedTotal - bmrAchieved),
    targetKcal: Math.max(0, breakdown.targetTotal - bmrTarget),
  };
}

export type ActiveBurnHomeRowKey = 'sessions' | 'daily_movement';

export interface ActiveBurnHomeRow {
  key: ActiveBurnHomeRowKey;
  achievedKcal: number;
  targetKcal: number;
  /** Sessions row when today's target is 0 (planned rest / training day). */
  dimmed?: boolean;
  /** Daily movement without live wearable tracking. */
  showByEndOfDay?: boolean;
}

/** Per-category rows for the home "Calories to actively burn" card (no BMR). */
export function activeBurnHomeRowsFromBreakdown(
  breakdown: BurnedBreakdownLike,
): ActiveBurnHomeRow[] {
  const rows: ActiveBurnHomeRow[] = [];
  const sessions = breakdown.rows.find((r) => r.key === 'sessions');
  const movement = breakdown.rows.find((r) => r.key === 'daily_movement');

  if (sessions) {
    const targetKcal = Math.max(0, Math.round(sessions.target));
    const achievedKcal = Math.max(0, Math.round(sessions.achieved));
    // Home card hides zero-target sessions; the modal still shows them grayed out.
    if (targetKcal > 0) {
      rows.push({
        key: 'sessions',
        achievedKcal,
        targetKcal,
      });
    }
  }

  if (movement) {
    const targetKcal = Math.max(0, Math.round(movement.target));
    const achievedKcal = Math.max(0, Math.round(movement.achieved));
    const noWearable = breakdown.hasWearableMovement !== true;
    rows.push({
      key: 'daily_movement',
      achievedKcal,
      targetKcal: noWearable ? Math.max(targetKcal, achievedKcal) : targetKcal,
      showByEndOfDay: noWearable || movement.estimatedFromOccupation === true,
    });
  }

  return rows;
}
