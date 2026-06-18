/**
 * Pure helpers shared between the HealthKit and Health Connect adapters.
 *
 * Extracted into a standalone module so that:
 *   - The unit tests in `tests/frontend/wearables/` can import them under
 *     ts-node without pulling in `react-native` (which the platform
 *     adapters depend on).
 *   - Both adapters can share the *same* aggregation rules so a sleep
 *     night recorded by Apple Watch is bucketed identically to one
 *     recorded by a Pixel Watch via Health Connect.
 */

import type { ActivityCategory } from '../../types/workout';

/**
 * Map a HealthKit sleep `value` to one of:
 *   - 'asleep'        : counts toward `sleep_total_min`
 *   - 'awake_in_bed'  : counts toward the denominator of efficiency
 *   - 'inbed'         : ignored (overlaps with asleep samples)
 *   - 'unknown'       : ignored
 */
export function sleepTag(
  value: number | string | undefined,
): 'asleep' | 'awake_in_bed' | 'inbed' | 'unknown' {
  if (value == null) return 'unknown';
  const v = String(value).toUpperCase();
  if (v.startsWith('ASLEEP')) return 'asleep';
  if (v === 'AWAKE') return 'awake_in_bed';
  if (v === 'INBED') return 'inbed';
  return 'unknown';
}

/**
 * Map a Health Connect `SleepStage.stage` value to the same tags
 * `sleepTag` uses, so the aggregator can stay structurally identical
 * between the two providers.
 *
 * Health Connect sleep stage constants (per
 * `androidx.health.connect.client.records.SleepSessionRecord.STAGE_TYPE_*`):
 *   1 AWAKE
 *   2 SLEEPING (generic, used pre-staged)
 *   3 OUT_OF_BED
 *   4 LIGHT
 *   5 DEEP
 *   6 REM
 *   7 AWAKE_IN_BED
 */
export function sleepStageTag(
  stage: number | undefined,
): 'asleep' | 'awake_in_bed' | 'unknown' {
  switch (stage) {
    case 2: case 4: case 5: case 6: return 'asleep';
    case 1: case 7: return 'awake_in_bed';
    default: return 'unknown';
  }
}

/**
 * Map Health Connect's `exerciseType` integer to our `ActivityCategory`.
 *
 * Integers MUST match
 * `androidx.health.connect.client.records.ExerciseSessionRecord` (Health
 * Connect / AndroidX). Do not reuse older ad-hoc numberings — they mis-label
 * sessions (e.g. STRENGTH_TRAINING=70 was once confused with hiking).
 *
 * Coarse buckets only; MET estimation uses category. Unknown numeric IDs
 * fall through to keyword-matching on `title`, then `'other'`.
 */
export function mapHealthConnectExerciseToCategory(
  exerciseType: number | undefined,
  title: string | undefined,
): ActivityCategory {
  switch (exerciseType) {
    // --- running / walking (walk shares running MET bucket in our model) ---
    case 56: // RUNNING
    case 57: // RUNNING_TREADMILL
      return 'running';
    case 79: // WALKING
      return 'running';

    case 37: // HIKING
      return 'hiking';

    case 8: // BIKING
    case 9: // BIKING_STATIONARY
      return 'cycling';

    case 73: // SWIMMING_OPEN_WATER
    case 74: // SWIMMING_POOL
      return 'swimming';

    case 39: // ICE_SKATING
    case 61: // SKIING
    case 62: // SNOWBOARDING
    case 63: // SNOWSHOEING
      return 'winter_sports';

    case 2: // BADMINTON
    case 50: // RACQUETBALL
    case 66: // SQUASH
    case 75: // TABLE_TENNIS
    case 76: // TENNIS
      return 'racket_sports';

    case 4: // BASEBALL
    case 5: // BASKETBALL
    case 14: // CRICKET
    case 28: // FOOTBALL_AMERICAN
    case 29: // FOOTBALL_AUSTRALIAN
    case 35: // HANDBALL
    case 38: // ICE_HOCKEY
    case 52: // ROLLER_HOCKEY
    case 55: // RUGBY
    case 64: // SOCCER
    case 65: // SOFTBALL
    case 78: // VOLLEYBALL
    case 80: // WATER_POLO
      return 'team_sports';

    case 46: // PADDLING
    case 53: // ROWING (boat)
    case 58: // SAILING
    case 59: // SCUBA_DIVING
    case 72: // SURFING
      return 'water_sports';

    case 11: // BOXING
    case 27: // FENCING
    case 44: // MARTIAL_ARTS
      return 'martial_arts';

    case 33: // GUIDED_BREATHING
    case 48: // PILATES
    case 71: // STRETCHING
    case 83: // YOGA
      return 'mind_body';

    case 10: // BOOT_CAMP
    case 13: // CALISTHENICS
    case 16: // DANCING
    case 25: // ELLIPTICAL
    case 26: // EXERCISE_CLASS
    case 34: // GYMNASTICS
    case 36: // HIGH_INTENSITY_INTERVAL_TRAINING
    case 54: // ROWING_MACHINE
    case 68: // STAIR_CLIMBING
    case 69: // STAIR_CLIMBING_MACHINE
    case 70: // STRENGTH_TRAINING
    case 81: // WEIGHTLIFTING
      return 'gym_cardio';

    case 31: // FRISBEE_DISC
    case 32: // GOLF
    case 47: // PARAGLIDING
    case 51: // ROCK_CLIMBING
    case 60: // SKATING (roller / generic)
      return 'outdoor';

    case 82: // WHEELCHAIR — no dedicated bucket
      return 'other';
  }

  const n = (title ?? '').toLowerCase();
  if (n.includes('run')) return 'running';
  if (n.includes('walk') || n.includes('hike')) return n.includes('hike') ? 'hiking' : 'running';
  if (n.includes('cycl') || n.includes('bike')) return 'cycling';
  if (n.includes('swim')) return 'swimming';
  if (n.includes('ski') || n.includes('snowboard') || n.includes('skate')) return 'winter_sports';
  if (n.includes('tennis') || n.includes('badminton') || n.includes('pickle') || n.includes('squash')) return 'racket_sports';
  if (n.includes('soccer') || n.includes('football') || n.includes('basketball')) return 'team_sports';
  if (n.includes('row') || n.includes('kayak') || n.includes('canoe') || n.includes('surf')) return 'water_sports';
  if (n.includes('box') || n.includes('mma') || n.includes('judo') || n.includes('karate')) return 'martial_arts';
  if (n.includes('yoga') || n.includes('pilates') || n.includes('stretch')) return 'mind_body';
  if (
    n.includes('hiit')
    || n.includes('elliptical')
    || n.includes('rope')
    || n.includes('cardio')
    || n.includes('calisthenics')
    || n.includes('kraft') // e.g. Krafttraining
    || n.includes('strength')
    || n.includes('weight')
    || n.includes('gymnastics')
  ) return 'gym_cardio';
  if (n.includes('climb') || n.includes('golf')) return 'outdoor';
  return 'other';
}
