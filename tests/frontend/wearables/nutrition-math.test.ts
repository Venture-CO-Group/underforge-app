/**
 * Unit tests for the pure nutrition adjustment math.
 *
 * Run with:
 *   npx ts-node --transpile-only -P tests/frontend/wearables/tsconfig.json \
 *     tests/frontend/wearables/nutrition-math.test.ts
 *
 * Uses Node's built-in `assert` module so we don't need Jest/Vitest.
 */

import assert from 'node:assert/strict';
import {
  MAX_CALORIE_ADJUSTMENT_FRACTION,
  NEAT_STEP_BASELINE,
  buildInputsDigest,
  computeAdjustment,
  netMovementAboveBaseline,
  stepsNeatKcal,
  type NutritionTargetsLike,
} from '../../../lib/nutrition-math';

const base: NutritionTargetsLike = {
  caloriesTarget: 2000,
  carbsTarget: 220,
  proteinTarget: 140,
  fatTarget: 70,
  fiberTarget: 30,
};

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    throw e;
  }
}

console.log('nutrition-math');

test('no surplus leaves targets at baseline', () => {
  const out = computeAdjustment({ base, activityCalories: 0, stepsNeatCalories: 0 });
  assert.equal(out.adjustedCaloriesTarget, 2000);
  assert.equal(out.adjustedCarbsTargetGrams, 220);
  assert.equal(out.adjustedProteinTargetGrams, 140);
  assert.equal(out.adjustedFatTargetGrams, 70);
});

test('surplus from activity is split 70 carbs / 30 fat with protein fixed', () => {
  // 400 kcal surplus → 280 kcal to carbs (70 g) and 120 kcal to fat (~13.3 g).
  // Macro grams are rounded to integers by computeAdjustment.
  const out = computeAdjustment({ base, activityCalories: 400, stepsNeatCalories: 0 });
  assert.equal(out.adjustedCaloriesTarget, 2400);
  assert.equal(out.adjustedCarbsTargetGrams, 290);
  assert.equal(out.adjustedProteinTargetGrams, 140);
  assert.equal(out.adjustedFatTargetGrams, 83);
});

test('activity + steps surplus split 70/30 carbs/fat', () => {
  // 300 kcal surplus → 210 kcal carbs (52.5 g) + 90 kcal fat (10 g).
  const out = computeAdjustment({ base, activityCalories: 200, stepsNeatCalories: 100 });
  assert.equal(out.adjustedCaloriesTarget, 2300);
  assert.equal(out.adjustedCarbsTargetGrams, 273);
  assert.equal(out.adjustedProteinTargetGrams, 140);
  assert.equal(out.adjustedFatTargetGrams, 80);
});

test('adjustment capped at +40% to guard against misreports', () => {
  const out = computeAdjustment({ base, activityCalories: 5000, stepsNeatCalories: 0 });
  assert.equal(out.adjustedCaloriesTarget, Math.round(2000 * (1 + MAX_CALORIE_ADJUSTMENT_FRACTION)));
});

test('negative values from bad provider data are clamped', () => {
  const out = computeAdjustment({ base, activityCalories: -500, stepsNeatCalories: -200 });
  // Negative inputs contribute nothing; no surplus applied.
  assert.equal(out.adjustedCaloriesTarget, 2000);
  assert.equal(out.adjustedCarbsTargetGrams, 220);
});

test('fiber scales stepwise with total calories', () => {
  const small = computeAdjustment({ ...{ base: { ...base, caloriesTarget: 1600 } }, activityCalories: 0, stepsNeatCalories: 0 });
  const mid = computeAdjustment({ ...{ base: { ...base, caloriesTarget: 1800 } }, activityCalories: 0, stepsNeatCalories: 0 });
  const big = computeAdjustment({ ...{ base: { ...base, caloriesTarget: 2100 } }, activityCalories: 0, stepsNeatCalories: 0 });
  assert.equal(small.adjustedFiberTargetGrams, 21);
  assert.equal(mid.adjustedFiberTargetGrams, 25);
  assert.equal(big.adjustedFiberTargetGrams, 30);
});

test('steps below baseline contribute zero NEAT kcal', () => {
  assert.equal(stepsNeatKcal(NEAT_STEP_BASELINE - 1, 70), 0);
  assert.equal(stepsNeatKcal(0, 70), 0);
  assert.equal(stepsNeatKcal(-1, 70), 0);
});

test('steps above baseline scale roughly with weight', () => {
  // At 70 kg: 2500 extra steps * 0.04 = 100 kcal.
  assert.equal(stepsNeatKcal(NEAT_STEP_BASELINE + 2500, 70), 100);
  // At 84 kg: same steps should burn ~20% more.
  assert.equal(stepsNeatKcal(NEAT_STEP_BASELINE + 2500, 84), 120);
  // At 56 kg: same steps should burn ~20% less.
  assert.equal(stepsNeatKcal(NEAT_STEP_BASELINE + 2500, 56), 80);
});

test('fromZero mode credits every step (no 7,500 baseline subtraction)', () => {
  // At 70 kg: 5,000 steps * 0.04 = 200 kcal.
  assert.equal(stepsNeatKcal(5_000, 70, { fromZero: true }), 200);
  // At 70 kg: exactly the legacy baseline still counts, 7,500 * 0.04 = 300.
  assert.equal(stepsNeatKcal(NEAT_STEP_BASELINE, 70, { fromZero: true }), 300);
  // Weight scales linearly: 10,000 steps * 0.04 * (84/70) = 480.
  assert.equal(stepsNeatKcal(10_000, 84, { fromZero: true }), 480);
  // Zero / negative still short-circuits to 0.
  assert.equal(stepsNeatKcal(0, 70, { fromZero: true }), 0);
  assert.equal(stepsNeatKcal(-1, 70, { fromZero: true }), 0);
});

test('fromZero mode produces strictly more kcal than default for sub-baseline counts', () => {
  // The whole point of this mode: a 5,000-steps/day user goes from 0 to a
  // positive credit on the burned breakdown the moment a wearable lands data.
  const legacy = stepsNeatKcal(5_000, 70);
  const live = stepsNeatKcal(5_000, 70, { fromZero: true });
  assert.equal(legacy, 0);
  assert.equal(live, 200);
});

test('netMovementAboveBaseline: walking exactly baseline credits nothing', () => {
  // Base target already embeds ~300 kcal of assumed daily walking; a from-zero
  // step credit of exactly that amount must net to 0 (no double-count).
  assert.equal(netMovementAboveBaseline(300, 300), 0);
  assert.equal(netMovementAboveBaseline(250, 300), 0); // below baseline → still 0
});

test('netMovementAboveBaseline: only movement above baseline is credited', () => {
  // ~2x the assumed baseline → credit only the excess half.
  assert.equal(netMovementAboveBaseline(600, 300), 300);
  assert.equal(netMovementAboveBaseline(720, 300), 420);
});

test('netMovementAboveBaseline: no movement data (0) never claws back the target', () => {
  // No wearable / no steps → 0 credit regardless of the embedded baseline.
  assert.equal(netMovementAboveBaseline(0, 300), 0);
});

test('netMovementAboveBaseline: zero baseline credits the full from-zero count', () => {
  assert.equal(netMovementAboveBaseline(450, 0), 450);
});

test('netMovementAboveBaseline: non-finite / negative inputs clamp to 0', () => {
  assert.equal(netMovementAboveBaseline(NaN, 300), 0);
  assert.equal(netMovementAboveBaseline(400, NaN), 400);
  assert.equal(netMovementAboveBaseline(-100, 300), 0);
  assert.equal(netMovementAboveBaseline(400, -50), 400);
});

test('buildInputsDigest is stable for identical inputs', () => {
  const a = buildInputsDigest({ baseCals: 2000, activityCalories: 300, stepsNeatCalories: 50, weightKg: 72, strategy: 'protein_floor_v1' });
  const b = buildInputsDigest({ baseCals: 2000, activityCalories: 300, stepsNeatCalories: 50, weightKg: 72, strategy: 'protein_floor_v1' });
  assert.equal(a, b);
});

test('buildInputsDigest differs when any input differs', () => {
  const a = buildInputsDigest({ baseCals: 2000, activityCalories: 300, stepsNeatCalories: 50, weightKg: 72, strategy: 'protein_floor_v1' });
  const b = buildInputsDigest({ baseCals: 2000, activityCalories: 301, stepsNeatCalories: 50, weightKg: 72, strategy: 'protein_floor_v1' });
  assert.notEqual(a, b);
});

test('buildInputsDigest invalidates when strategy version changes', () => {
  const a = buildInputsDigest({ baseCals: 2000, activityCalories: 300, stepsNeatCalories: 50, weightKg: 72, strategy: 'carbs_first_v1' });
  const b = buildInputsDigest({ baseCals: 2000, activityCalories: 300, stepsNeatCalories: 50, weightKg: 72, strategy: 'protein_floor_v1' });
  assert.notEqual(a, b);
});

console.log('nutrition-math: OK');
