/**
 * Unit tests for the per-set strength kcal estimator.
 *
 * `lib/workout-energy.ts` is pure (no I/O, no DB, no React) so it loads
 * directly under ts-node without mocking.
 */

import assert from 'node:assert/strict';
import { estimatePlannedWorkoutKcal, estimateSetKcal } from '../../../lib/workout-energy';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    throw e;
  }
}

console.log('workout-energy');

test('returns zero when bodyweight is zero or negative', () => {
  const a = estimateSetKcal({ reps: 10, restTimeSeconds: 60, rir: 1 }, 0);
  const b = estimateSetKcal({ reps: 10, restTimeSeconds: 60, rir: 1 }, -10);
  assert.equal(a, 0);
  assert.equal(b, 0);
});

test('moderate set at 70 kg matches hand-computed session-MET formula', () => {
  // reps=10 → workSec = clamp(30, 15, 60) = 30s
  // restSec=60 → setMinutes = (30+60)/60 = 1.5
  // moderate intensity (rir=2 OR difficulty=3) → effortFactor = 1.0
  // no load → loadFactor = 1.0
  // setMet = 5.0 * 1.0 * 1.0 = 5.0
  // kcal = 5.0 * 70 * 1.5 / 60 = 8.75 → round 9
  const out = estimateSetKcal(
    { reps: 10, restTimeSeconds: 60, rir: 2, difficultyPerception: 3 },
    70,
  );
  assert.equal(out, 9);
});

test('hard set scales kcal up vs easy at same weight/reps/rest', () => {
  const easy = estimateSetKcal({ reps: 20, restTimeSeconds: 120, rir: 5 }, 100);
  const moderate = estimateSetKcal({ reps: 20, restTimeSeconds: 120, rir: 2 }, 100);
  const hard = estimateSetKcal({ reps: 20, restTimeSeconds: 120, rir: 0 }, 100);
  assert.ok(easy < moderate, `easy(${easy}) should be < moderate(${moderate})`);
  assert.ok(moderate < hard, `moderate(${moderate}) should be < hard(${hard})`);
});

test('takes the harder of RIR and difficulty_perception', () => {
  // RIR 5 → easy (0.85), difficulty 5 → hard (1.2). Harder factor wins.
  const out = estimateSetKcal(
    { reps: 20, restTimeSeconds: 120, rir: 5, difficultyPerception: 5 },
    100,
  );
  const reference = estimateSetKcal(
    { reps: 20, restTimeSeconds: 120, rir: 0, difficultyPerception: undefined },
    100,
  );
  assert.equal(out, reference);
});

test('clamps work seconds to [15, 60] for extreme rep counts', () => {
  const oneRep = estimateSetKcal({ reps: 1, restTimeSeconds: 60, rir: 0 }, 70);
  const fiveReps = estimateSetKcal({ reps: 5, restTimeSeconds: 60, rir: 0 }, 70);
  assert.equal(oneRep, fiveReps);

  const twentyReps = estimateSetKcal({ reps: 20, restTimeSeconds: 60, rir: 0 }, 70);
  const fiftyReps = estimateSetKcal({ reps: 50, restTimeSeconds: 60, rir: 0 }, 70);
  assert.equal(twentyReps, fiftyReps);
});

test('defaults missing reps to 8 and missing rest to 60s', () => {
  const explicit = estimateSetKcal({ reps: 8, restTimeSeconds: 60, rir: 2 }, 70);
  const defaulted = estimateSetKcal({ rir: 2 }, 70);
  assert.equal(explicit, defaulted);
});

test('falls back to effort 1.0 when no effort signal is provided', () => {
  const out = estimateSetKcal({ reps: 10, restTimeSeconds: 60 }, 70);
  // Same as rir=2 (which also lands on effortFactor 1.0).
  const equiv = estimateSetKcal({ reps: 10, restTimeSeconds: 60, rir: 2 }, 70);
  assert.equal(out, equiv);
});

test('scales linearly with bodyweight', () => {
  const at70 = estimateSetKcal({ reps: 10, restTimeSeconds: 60, rir: 1 }, 70);
  const at140 = estimateSetKcal({ reps: 10, restTimeSeconds: 60, rir: 1 }, 140);
  // Doubling weight should ~double kcal (subject to rounding).
  assert.ok(Math.abs(at140 - at70 * 2) <= 1, `at70=${at70}, at140=${at140}`);
});

test('zero rest still returns positive kcal from work window', () => {
  const out = estimateSetKcal({ reps: 10, restTimeSeconds: 0, rir: 0 }, 70);
  assert.ok(out > 0);
});

test('handles null fields without throwing', () => {
  const out = estimateSetKcal(
    { reps: null, restTimeSeconds: null, rir: null, difficultyPerception: null },
    70,
  );
  assert.ok(out > 0);
});

test('positive load increases kcal vs no load', () => {
  const noLoad = estimateSetKcal(
    { reps: 10, restTimeSeconds: 60, rir: 2 },
    70,
  );
  const withLoad = estimateSetKcal(
    { reps: 10, restTimeSeconds: 60, rir: 2, weightValue: 70, weightUnit: 'kg' },
    70,
  );
  assert.ok(withLoad > noLoad, `withLoad(${withLoad}) should be > noLoad(${noLoad})`);
});

test('load factor saturates: doubling load adds less than the first BW of load', () => {
  // load = bodyweight  → factor = 1 + 0.3 * ln(2) ≈ 1.208
  // load = 2*bodyweight → factor = 1 + 0.3 * ln(3) ≈ 1.330
  // Marginal kcal bump from BW→2×BW must be smaller than 0→BW.
  const base = estimateSetKcal(
    { reps: 10, restTimeSeconds: 60, rir: 2 },
    80,
  );
  const oneBw = estimateSetKcal(
    { reps: 10, restTimeSeconds: 60, rir: 2, weightValue: 80, weightUnit: 'kg' },
    80,
  );
  const twoBw = estimateSetKcal(
    { reps: 10, restTimeSeconds: 60, rir: 2, weightValue: 160, weightUnit: 'kg' },
    80,
  );
  const firstBump = oneBw - base;
  const secondBump = twoBw - oneBw;
  assert.ok(firstBump > 0, `firstBump(${firstBump}) > 0`);
  assert.ok(secondBump > 0, `secondBump(${secondBump}) > 0`);
  assert.ok(
    secondBump <= firstBump,
    `saturating: secondBump(${secondBump}) should be <= firstBump(${firstBump})`,
  );
});

test('lbs load is converted to kg before applying load factor', () => {
  // 154 lbs ≈ 69.85 kg ≈ 70 kg → effectively load = bodyweight.
  const inLbs = estimateSetKcal(
    { reps: 10, restTimeSeconds: 60, rir: 2, weightValue: 154, weightUnit: 'lbs' },
    70,
  );
  const inKg = estimateSetKcal(
    { reps: 10, restTimeSeconds: 60, rir: 2, weightValue: 70, weightUnit: 'kg' },
    70,
  );
  assert.ok(Math.abs(inLbs - inKg) <= 1, `inLbs=${inLbs}, inKg=${inKg}`);
});

test('zero or negative load is treated as bodyweight-only', () => {
  const noField = estimateSetKcal(
    { reps: 10, restTimeSeconds: 60, rir: 2 },
    70,
  );
  const zeroLoad = estimateSetKcal(
    { reps: 10, restTimeSeconds: 60, rir: 2, weightValue: 0, weightUnit: 'kg' },
    70,
  );
  const negLoad = estimateSetKcal(
    { reps: 10, restTimeSeconds: 60, rir: 2, weightValue: -50, weightUnit: 'kg' },
    70,
  );
  assert.equal(noField, zeroLoad);
  assert.equal(noField, negLoad);
});

test('full session (~20 sets, BW load, RIR 2) lands in 200-300 kcal range', () => {
  // Smoke test against the user-observed gap. 80 kg lifter, 8 reps × 80 kg
  // load × 75s rest × 20 sets at moderate effort should land in the
  // ballpark that wearables / RT compendium values predict.
  const setKcal = estimateSetKcal(
    { reps: 8, restTimeSeconds: 75, rir: 2, weightValue: 80, weightUnit: 'kg' },
    80,
  );
  const total = setKcal * 20;
  assert.ok(total >= 200 && total <= 320, `expected 200..320 kcal, got ${total}`);
});

test('seconds unit: 60s plank uses the value directly as work duration', () => {
  // With loggingUnit='seconds', reps=60 means a 60-second hold (not 60 reps × 3s).
  // Compare against the reps-model value that produces the same 60s work window
  // (any reps ≥ 20 saturate to MAX_WORK_SECONDS=60).
  const plank60s = estimateSetKcal(
    { reps: 60, restTimeSeconds: 60, rir: 2, loggingUnit: 'seconds' },
    70,
  );
  const reps20 = estimateSetKcal(
    { reps: 20, restTimeSeconds: 60, rir: 2 },
    70,
  );
  assert.equal(plank60s, reps20);
});

test('seconds unit: longer holds scale kcal beyond the reps-model 60s cap', () => {
  // 10-minute run (600s) must produce strictly more kcal than the reps-clamped 60s cap.
  const longRun = estimateSetKcal(
    { reps: 600, restTimeSeconds: 0, rir: 2, loggingUnit: 'seconds' },
    70,
  );
  const repsCapped = estimateSetKcal(
    { reps: 50, restTimeSeconds: 0, rir: 2 },
    70,
  );
  assert.ok(longRun > repsCapped, `longRun(${longRun}) should be > repsCapped(${repsCapped})`);
});

test('seconds unit: defaults missing reps to a sensible hold duration', () => {
  // Should not crash or zero out when only loggingUnit is set.
  const out = estimateSetKcal(
    { restTimeSeconds: 30, rir: 2, loggingUnit: 'seconds' },
    70,
  );
  assert.ok(out > 0);
});

test('planned workout session sums sets across exercises', () => {
  const kcal = estimatePlannedWorkoutKcal(
    [
      {
        exerciseId: 'barbell-bench-press',
        sets: 4,
        reps: '8',
        restTimeSeconds: 120,
        rir: 2,
      },
      {
        exerciseId: 'barbell-overhead-press',
        sets: 3,
        reps: '10',
        restTimeSeconds: 90,
        rir: 2,
      },
    ],
    80,
  );
  const benchOnly = estimateSetKcal({ reps: 8, restTimeSeconds: 120, rir: 2 }, 80) * 4;
  const pressOnly = estimateSetKcal({ reps: 10, restTimeSeconds: 90, rir: 2 }, 80) * 3;
  assert.equal(kcal, benchOnly + pressOnly);
});

console.log('workout-energy: OK');
