/**
 * Unit tests for the pure cross-provider normalization helpers.
 *
 * These functions are deliberately split into `lib/providers/normalize-helpers.ts`
 * (free of `react-native` deps) so they can be exercised with ts-node + node:assert
 * exactly the way the existing `met-table` and `dedupe-fingerprint` tests are.
 */

import assert from 'node:assert/strict';
import {
  mapHealthConnectExerciseToCategory,
  sleepStageTag,
  sleepTag,
} from '../../../lib/providers/normalize-helpers';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    throw e;
  }
}

console.log('normalize-helpers: sleepTag (HealthKit)');

test('asleep variants map to "asleep"', () => {
  assert.equal(sleepTag('ASLEEP'), 'asleep');
  assert.equal(sleepTag('ASLEEP_CORE'), 'asleep');
  assert.equal(sleepTag('ASLEEP_DEEP'), 'asleep');
  assert.equal(sleepTag('ASLEEP_REM'), 'asleep');
  // Lowercase variants from older react-native-health builds also work.
  assert.equal(sleepTag('asleep'), 'asleep');
});

test('AWAKE maps to "awake_in_bed"', () => {
  assert.equal(sleepTag('AWAKE'), 'awake_in_bed');
});

test('INBED maps to "inbed" (ignored by the aggregator)', () => {
  assert.equal(sleepTag('INBED'), 'inbed');
});

test('unknown / nullish values map to "unknown"', () => {
  assert.equal(sleepTag(undefined), 'unknown');
  assert.equal(sleepTag('FOO'), 'unknown');
  assert.equal(sleepTag(0), 'unknown');
});

console.log('\nnormalize-helpers: sleepStageTag (Health Connect)');

test('SLEEPING / LIGHT / DEEP / REM map to "asleep"', () => {
  assert.equal(sleepStageTag(2), 'asleep');
  assert.equal(sleepStageTag(4), 'asleep');
  assert.equal(sleepStageTag(5), 'asleep');
  assert.equal(sleepStageTag(6), 'asleep');
});

test('AWAKE / AWAKE_IN_BED map to "awake_in_bed"', () => {
  assert.equal(sleepStageTag(1), 'awake_in_bed');
  assert.equal(sleepStageTag(7), 'awake_in_bed');
});

test('OUT_OF_BED / unknown map to "unknown"', () => {
  assert.equal(sleepStageTag(3), 'unknown');
  assert.equal(sleepStageTag(undefined), 'unknown');
  assert.equal(sleepStageTag(99), 'unknown');
});

console.log('\nnormalize-helpers: mapHealthConnectExerciseToCategory');

test('cycling (bike + stationary) resolves to cycling', () => {
  assert.equal(mapHealthConnectExerciseToCategory(8, undefined), 'cycling');
  assert.equal(mapHealthConnectExerciseToCategory(9, undefined), 'cycling');
});

test('calisthenics (13) maps to gym_cardio, not cycling', () => {
  assert.equal(mapHealthConnectExerciseToCategory(13, undefined), 'gym_cardio');
});

test('running + treadmill resolve to running', () => {
  assert.equal(mapHealthConnectExerciseToCategory(56, undefined), 'running');
  assert.equal(mapHealthConnectExerciseToCategory(57, undefined), 'running');
});

test('handball (35) maps to team_sports, not running', () => {
  assert.equal(mapHealthConnectExerciseToCategory(35, undefined), 'team_sports');
});

test('yoga / pilates / stretching use mind_body', () => {
  assert.equal(mapHealthConnectExerciseToCategory(83, undefined), 'mind_body');
  assert.equal(mapHealthConnectExerciseToCategory(48, undefined), 'mind_body');
  assert.equal(mapHealthConnectExerciseToCategory(71, undefined), 'mind_body');
});

test('racquetball (50) maps to racket_sports', () => {
  assert.equal(mapHealthConnectExerciseToCategory(50, undefined), 'racket_sports');
});

test('EXERCISE_CLASS (26), gymnastics (34), strength (70) map to gym_cardio', () => {
  assert.equal(mapHealthConnectExerciseToCategory(26, undefined), 'gym_cardio');
  assert.equal(mapHealthConnectExerciseToCategory(34, undefined), 'gym_cardio');
  assert.equal(mapHealthConnectExerciseToCategory(70, undefined), 'gym_cardio');
});

test('guided breathing (33) maps to mind_body, not outdoor', () => {
  assert.equal(mapHealthConnectExerciseToCategory(33, undefined), 'mind_body');
});

test('OTHER_WORKOUT (0) uses title keywords when present', () => {
  assert.equal(mapHealthConnectExerciseToCategory(0, 'Calisthenics'), 'gym_cardio');
  assert.equal(mapHealthConnectExerciseToCategory(0, ''), 'other');
});

test('unknown enum falls back to keyword title match', () => {
  // Unknown id 9999 with a "Powerlifting" title should NOT match running/yoga,
  // and should fall through to 'other' since none of the keywords hit.
  assert.equal(mapHealthConnectExerciseToCategory(9999, 'Powerlifting'), 'other');
  // Title-only fallback for "Trail Run" hits the running keyword.
  assert.equal(mapHealthConnectExerciseToCategory(9999, 'Trail Run'), 'running');
  // "Rowing Machine" should resolve to water_sports per the keyword rules.
  assert.equal(mapHealthConnectExerciseToCategory(9999, 'Rowing Machine'), 'water_sports');
});

test('completely unknown input lands on "other"', () => {
  assert.equal(mapHealthConnectExerciseToCategory(undefined, undefined), 'other');
  assert.equal(mapHealthConnectExerciseToCategory(undefined, 'Nothing here'), 'other');
});
