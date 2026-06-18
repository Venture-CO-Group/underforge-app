/**
 * Unit tests for burned-calorie bucket helpers.
 *
 * Run with:
 *   npx ts-node --transpile-only -P tests/frontend/wearables/tsconfig.json \
 *     tests/frontend/wearables/calories-balance.test.ts
 */

import assert from 'node:assert/strict';
import {
  activeBurnFromBreakdown,
  activeBurnHomeRowsFromBreakdown,
  applyNoWearableMovementEstimate,
  estimateOccupationNeatKcal,
  getOccupationMultiplier,
  resolveDailyMovementAchievedKcal,
  resolveDailyMovementTargetKcal,
  resolveSessionsTargetKcal,
} from '../../../lib/calories-balance-math';
import { NEAT_STEP_BASELINE, stepsNeatKcal } from '../../../lib/nutrition-math';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    throw e;
  }
}

console.log('calories-balance');

test('occupation NEAT scales with multiplier above 1', () => {
  assert.equal(getOccupationMultiplier('Mostly sitting'), 1.2);
  assert.equal(estimateOccupationNeatKcal(1500, 'Mostly sitting'), 300);
  assert.equal(estimateOccupationNeatKcal(1500, 'Very active'), 825);
});

test('sessions target on planned training day uses plan estimate or 30d avg', () => {
  assert.equal(resolveSessionsTargetKcal(0, 150, true, 0), 150);
  assert.equal(resolveSessionsTargetKcal(0, 150, true, 250), 250);
  assert.equal(resolveSessionsTargetKcal(200, 150, true, 250), 250);
  assert.equal(resolveSessionsTargetKcal(300, 150, true, 250), 300);
  assert.equal(resolveSessionsTargetKcal(0, 0, true, 0), 0);
});

test('planned training day prefers plan kcal over 30d avg when both positive', () => {
  assert.equal(resolveSessionsTargetKcal(0, 400, true, 250), 250);
});

test('rest day sessions target is logged burn only (no 30d ghost)', () => {
  assert.equal(resolveSessionsTargetKcal(0, 32, false), 0);
  assert.equal(resolveSessionsTargetKcal(50, 150, false), 50);
  assert.equal(resolveSessionsTargetKcal(200, 150, false), 200);
});

test('movement achieved prefers steps over active_energy and credits every step', () => {
  // Post-#24: when wearable steps are present we credit every step (no
  // baseline subtraction) — the user already has the hard data.
  const totalSteps = NEAT_STEP_BASELINE + 2500;
  const expectedFromZero = stepsNeatKcal(totalSteps, 70, { fromZero: true });
  assert.equal(
    resolveDailyMovementAchievedKcal({
      steps: totalSteps,
      activeEnergyKcal: 500,
      sessionsAchieved: 100,
      weightKg: 70,
    }),
    expectedFromZero,
  );
});

test('movement achieved uses active_energy residual when no steps', () => {
  assert.equal(
    resolveDailyMovementAchievedKcal({
      steps: 0,
      activeEnergyKcal: 400,
      sessionsAchieved: 120,
      weightKg: 70,
    }),
    280,
  );
});

test('movement target floors on onboarding occupation NEAT', () => {
  assert.equal(resolveDailyMovementTargetKcal(0, 0, 280), 280);
  assert.equal(resolveDailyMovementTargetKcal(50, 80, 280), 280);
  assert.equal(resolveDailyMovementTargetKcal(100, 80, 60), 100);
});

test('no wearable credits occupation movement as complete', () => {
  const out = applyNoWearableMovementEstimate({
    hasWearable: false,
    occupationNeatKcal: 280,
    measuredAchieved: 0,
    measuredTarget: 280,
  });
  assert.equal(out.achieved, 280);
  assert.equal(out.target, 280);
  assert.equal(out.estimatedFromOccupation, true);
});

test('wearable keeps measured movement', () => {
  const out = applyNoWearableMovementEstimate({
    hasWearable: true,
    occupationNeatKcal: 280,
    measuredAchieved: 40,
    measuredTarget: 120,
  });
  assert.equal(out.achieved, 40);
  assert.equal(out.target, 120);
  assert.equal(out.estimatedFromOccupation, false);
});

test('active burn with wearable includes sessions and movement', () => {
  const breakdown = {
    hasWearableMovement: true,
    achievedTotal: 1900,
    targetTotal: 2200,
    rows: [
      { key: 'bmr', achieved: 1500, target: 1500 },
      { key: 'sessions', achieved: 200, target: 300 },
      { key: 'daily_movement', achieved: 200, target: 400 },
    ],
  };
  assert.deepEqual(activeBurnFromBreakdown(breakdown), {
    achievedKcal: 400,
    targetKcal: 700,
  });
});

test('home burn rows show movement with by-end-of-day when no wearable', () => {
  const breakdown = {
    hasWearableMovement: false,
    achievedTotal: 1780,
    targetTotal: 1780,
    rows: [
      { key: 'bmr', achieved: 1500, target: 1500 },
      { key: 'sessions', achieved: 0, target: 0 },
      { key: 'daily_movement', achieved: 280, target: 280, estimatedFromOccupation: true },
    ],
  };
  assert.deepEqual(activeBurnHomeRowsFromBreakdown(breakdown), [
    { key: 'daily_movement', achievedKcal: 280, targetKcal: 280, showByEndOfDay: true },
  ]);
});

test('home burn rows include sessions when target is positive', () => {
  const breakdown = {
    hasWearableMovement: true,
    achievedTotal: 500,
    targetTotal: 700,
    rows: [
      { key: 'bmr', achieved: 1500, target: 1500 },
      { key: 'sessions', achieved: 120, target: 200 },
      { key: 'daily_movement', achieved: 80, target: 100 },
    ],
  };
  const rows = activeBurnHomeRowsFromBreakdown(breakdown);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.key, 'sessions');
  assert.equal(rows[1]?.key, 'daily_movement');
});

test('active burn without wearable is sessions only', () => {
  const breakdown = {
    hasWearableMovement: false,
    achievedTotal: 1980,
    targetTotal: 2080,
    rows: [
      { key: 'bmr', achieved: 1500, target: 1500 },
      { key: 'sessions', achieved: 200, target: 300 },
      {
        key: 'daily_movement',
        achieved: 280,
        target: 280,
        estimatedFromOccupation: true,
      },
    ],
  };
  assert.deepEqual(activeBurnFromBreakdown(breakdown), {
    achievedKcal: 200,
    targetKcal: 300,
  });
});

test('active burn floors at 0 if BMR exceeds totals (wearable)', () => {
  const breakdown = {
    hasWearableMovement: true,
    achievedTotal: 1400,
    targetTotal: 1400,
    rows: [{ key: 'bmr', achieved: 1500, target: 1500 }],
  };
  assert.deepEqual(activeBurnFromBreakdown(breakdown), {
    achievedKcal: 0,
    targetKcal: 0,
  });
});

console.log('\nAll calories-balance tests passed.');
