/**
 * Unit tests for the MET calorie estimator.
 *
 * Note: `lib/providers/met-table.ts` only imports from `types/workout.ts` and
 * `lib/providers/types.ts`, both of which are pure, so it's safe to import
 * into ts-node without mocking.
 */

import assert from 'node:assert/strict';
import {
  estimateCaloriesFromMet,
  reconcileProviderCalories,
  MET_BY_CATEGORY,
  INTENSITY_MULTIPLIER,
} from '../../../lib/providers/met-table';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    throw e;
  }
}

console.log('met-table');

test('matches MET formula for known inputs', () => {
  // 30 min running at 70 kg, moderate intensity:
  //   9.8 MET * 1.0 * 70 kg * 0.5 h = 343 kcal
  const out = estimateCaloriesFromMet({
    category: 'running',
    durationMinutes: 30,
    weightKg: 70,
    intensity: 'moderate',
  });
  assert.equal(out.caloriesBurned, 343);
  assert.equal(out.caloriesSource, 'estimated_met');
  assert.equal(out.caloriesConfidence, 'medium');
});

test('intensity multiplier scales calories monotonically', () => {
  const easy = estimateCaloriesFromMet({ category: 'cycling', durationMinutes: 60, weightKg: 70, intensity: 'easy' });
  const moderate = estimateCaloriesFromMet({ category: 'cycling', durationMinutes: 60, weightKg: 70, intensity: 'moderate' });
  const hard = estimateCaloriesFromMet({ category: 'cycling', durationMinutes: 60, weightKg: 70, intensity: 'hard' });
  const max = estimateCaloriesFromMet({ category: 'cycling', durationMinutes: 60, weightKg: 70, intensity: 'max' });
  assert.ok(easy.caloriesBurned < moderate.caloriesBurned);
  assert.ok(moderate.caloriesBurned < hard.caloriesBurned);
  assert.ok(hard.caloriesBurned < max.caloriesBurned);
  // And the intensity table itself is monotonically increasing.
  assert.ok(INTENSITY_MULTIPLIER.easy < INTENSITY_MULTIPLIER.moderate);
  assert.ok(INTENSITY_MULTIPLIER.moderate < INTENSITY_MULTIPLIER.hard);
  assert.ok(INTENSITY_MULTIPLIER.hard < INTENSITY_MULTIPLIER.max);
});

test('unknown weight falls back and lowers confidence', () => {
  const out = estimateCaloriesFromMet({ category: 'running', durationMinutes: 30 });
  assert.equal(out.caloriesConfidence, 'low');
  assert.ok(out.caloriesBurned > 0);
});

test('zero duration returns zero calories', () => {
  const out = estimateCaloriesFromMet({ category: 'running', durationMinutes: 0, weightKg: 70, intensity: 'moderate' });
  assert.equal(out.caloriesBurned, 0);
});

test('negative duration is clamped', () => {
  const out = estimateCaloriesFromMet({ category: 'running', durationMinutes: -60, weightKg: 70, intensity: 'moderate' });
  assert.equal(out.caloriesBurned, 0);
});

test('every ActivityCategory has a MET value', () => {
  // Guardrail: if someone adds a new ActivityCategory, ts-check will error if
  // they forget to add a MET entry. At runtime, this verifies the table is
  // non-empty and each entry is a positive number.
  for (const [cat, met] of Object.entries(MET_BY_CATEGORY)) {
    assert.ok(met > 0, `MET for ${cat} must be > 0`);
  }
});

test('reconcileProviderCalories trusts values inside sanity window', () => {
  const out = reconcileProviderCalories(350, {
    category: 'running',
    durationMinutes: 30,
    weightKg: 70,
    intensity: 'moderate',
  });
  assert.equal(out.caloriesBurned, 350);
  assert.equal(out.caloriesSource, 'provider');
  assert.equal(out.caloriesConfidence, 'high');
});

test('reconcileProviderCalories rejects implausibly high provider values', () => {
  // MET estimate is 343 kcal; 900 kcal is > 2x so treated as a misfire.
  const tooHigh = reconcileProviderCalories(900, {
    category: 'running',
    durationMinutes: 30,
    weightKg: 70,
    intensity: 'moderate',
  });
  assert.equal(tooHigh.caloriesSource, 'estimated_met');
  assert.equal(tooHigh.caloriesConfidence, 'low');
  assert.equal(tooHigh.caloriesBurned, 343);
});

test('reconcileProviderCalories trusts low provider values (no low floor)', () => {
  // MET estimate is 343 kcal; a device-measured 100 kcal (e.g. an easy
  // HR-based session) is below the old 0.5x floor but is the *accurate*
  // value, so it must be trusted rather than inflated to the MET estimate.
  const low = reconcileProviderCalories(100, {
    category: 'running',
    durationMinutes: 30,
    weightKg: 70,
    intensity: 'moderate',
  });
  assert.equal(low.caloriesSource, 'provider');
  assert.equal(low.caloriesBurned, 100);
  assert.equal(low.caloriesConfidence, 'high');
});

test('reconcileProviderCalories falls back to MET when provider value missing', () => {
  const out = reconcileProviderCalories(undefined, {
    category: 'cycling',
    durationMinutes: 45,
    weightKg: 80,
    intensity: 'moderate',
  });
  assert.equal(out.caloriesSource, 'estimated_met');
  assert.ok(out.caloriesBurned > 0);
});

console.log('met-table: OK');
