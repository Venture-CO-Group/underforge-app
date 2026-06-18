/**
 * Unit tests for baseline-movement recommendation math.
 *
 * Run with:
 *   npx ts-node --transpile-only -P tests/frontend/wearables/tsconfig.json \
 *     tests/frontend/wearables/baseline-movement.test.ts
 */

import assert from 'node:assert/strict';
import {
  BASELINE_MOVEMENT_CONSTANTS,
  computeBaselineMovement,
} from '../../../lib/baseline-movement';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    throw e;
  }
}

console.log('baseline-movement');

test('sedentary occupation, no cardio, no plan -> 50 min @ 70kg', () => {
  const r = computeBaselineMovement({
    occupationActivity: 'Mostly sitting',
    weightKg: 70,
  });
  assert.equal(r.minutesPerDay, 50);
  assert.equal(r.pace, 'brisk');
  // 4.3 MET * 70kg * 50min / 60 = ~250.83 -> 251
  assert.equal(r.kcalPerDay, 251);
  // 251 / 0.04 = 6275 -> rounded to nearest 100 = 6300
  assert.equal(r.stepsPerDayApprox, 6300);
});

test('very active occupation -> 20 min baseline', () => {
  const r = computeBaselineMovement({
    occupationActivity: 'Very active',
    weightKg: 70,
  });
  assert.equal(r.minutesPerDay, 20);
});

test('regular movement occupation -> 30 min baseline', () => {
  const r = computeBaselineMovement({
    occupationActivity: 'Regular movement',
    weightKg: 70,
  });
  assert.equal(r.minutesPerDay, 30);
});

test('standing/walking occupation -> 40 min baseline', () => {
  const r = computeBaselineMovement({
    occupationActivity: 'Some standing and walking',
    weightKg: 70,
  });
  assert.equal(r.minutesPerDay, 40);
});

test('cardio reduces minutes (capped at 20)', () => {
  // 100 kcal/day cardio -> 10 min off
  const r1 = computeBaselineMovement({
    occupationActivity: 'Mostly sitting',
    weightKg: 70,
    cardioKcalPerDay: 100,
  });
  assert.equal(r1.minutesPerDay, 40);

  // 500 kcal/day cardio would be 50 min off, capped at 20
  const r2 = computeBaselineMovement({
    occupationActivity: 'Mostly sitting',
    weightKg: 70,
    cardioKcalPerDay: 500,
  });
  assert.equal(r2.minutesPerDay, 30); // 50 - 20
});

test('plan training reduces minutes (capped at 10)', () => {
  // 150 kcal/day plan -> 10 min off (cap)
  const r = computeBaselineMovement({
    occupationActivity: 'Mostly sitting',
    weightKg: 70,
    planTrainingKcalPerDay: 150,
  });
  assert.equal(r.minutesPerDay, 40);

  // 500 kcal/day plan would be 33 min off, capped at 10
  const r2 = computeBaselineMovement({
    occupationActivity: 'Mostly sitting',
    weightKg: 70,
    planTrainingKcalPerDay: 500,
  });
  assert.equal(r2.minutesPerDay, 40); // 50 - 10
});

test('cardio + plan compound', () => {
  const r = computeBaselineMovement({
    occupationActivity: 'Mostly sitting',
    weightKg: 70,
    cardioKcalPerDay: 100,
    planTrainingKcalPerDay: 150,
  });
  // 50 - 10 (cardio) - 10 (plan cap) = 30
  assert.equal(r.minutesPerDay, 30);
});

test('floors at 15 minutes for very active + heavy cardio + heavy plan', () => {
  const r = computeBaselineMovement({
    occupationActivity: 'Very active',
    weightKg: 70,
    cardioKcalPerDay: 500,
    planTrainingKcalPerDay: 500,
  });
  // 20 base - 20 cardio cap - 10 plan cap = -10, floored to 15
  assert.equal(r.minutesPerDay, BASELINE_MOVEMENT_CONSTANTS.MINUTES_FLOOR);
  assert.equal(r.minutesPerDay, 15);
});

test('kcal scales linearly with bodyweight', () => {
  const at70 = computeBaselineMovement({
    occupationActivity: 'Mostly sitting',
    weightKg: 70,
  });
  const at100 = computeBaselineMovement({
    occupationActivity: 'Mostly sitting',
    weightKg: 100,
  });
  // Same minutes (50), kcal proportional to weight
  assert.equal(at70.minutesPerDay, at100.minutesPerDay);
  // 100 kcal = 70 kcal * (100/70) = ratio ~1.43; tolerate rounding
  const ratio = at100.kcalPerDay / at70.kcalPerDay;
  assert.ok(ratio > 1.4 && ratio < 1.45, `ratio out of band: ${ratio}`);
});

test('unrecognised occupation defaults to most sedentary bucket', () => {
  const r = computeBaselineMovement({
    occupationActivity: '',
    weightKg: 70,
  });
  assert.equal(r.minutesPerDay, 50);

  const r2 = computeBaselineMovement({
    occupationActivity: 'Some weird answer',
    weightKg: 70,
  });
  assert.equal(r2.minutesPerDay, 50);
});

test('non-finite or zero weight falls back to 70 kg', () => {
  const r = computeBaselineMovement({
    occupationActivity: 'Mostly sitting',
    weightKg: 0,
  });
  // Should match the 70kg result.
  const ref = computeBaselineMovement({
    occupationActivity: 'Mostly sitting',
    weightKg: 70,
  });
  assert.equal(r.minutesPerDay, ref.minutesPerDay);
  assert.equal(r.kcalPerDay, ref.kcalPerDay);
});

test('steps approx is rounded to nearest 100 and non-negative', () => {
  const r = computeBaselineMovement({
    occupationActivity: 'Very active',
    weightKg: 70,
  });
  assert.ok(r.stepsPerDayApprox >= 0);
  assert.equal(r.stepsPerDayApprox % 100, 0);
});

console.log('baseline-movement: all tests passed');
