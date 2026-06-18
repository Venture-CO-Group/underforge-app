import { getExerciseLoggingUnitById } from './exercise-catalog';
import type { ExerciseLog, WeightUnit } from '../types/workout';

/**
 * Per-set kcal estimator for strength workouts.
 *
 * Models a session-average MET (compendium-style "vigorous resistance
 * training" baseline of 5.0) applied across the *entire* set duration —
 * work + rest combined — instead of giving rest its own near-resting MET.
 * The compendium values already implicitly average rest periods in, so
 * splitting them out and charging rest at MET 1.5 (the previous
 * implementation) double-discounted recovery and consistently produced
 * estimates ~50% below published references.
 *
 * The base MET is then scaled by two unitless multipliers:
 *
 *  - effortFactor ∈ {0.85, 1.0, 1.2}: from RIR or `difficulty_perception`
 *    (whichever is harder; partial input is not penalised).
 *  - loadFactor   ≥ 1.0: 1 + 0.3 × ln(1 + load_kg / bodyweight_kg).
 *    Bodyweight-only sets land at 1.0; bodyweight-equivalent load (e.g. a
 *    BW-loaded squat) lands at ≈1.21; 2× bodyweight at ≈1.33. Saturating
 *    by design so misreported load on a single rep can't blow up the row.
 *
 *   set_met  = 5.0 * effortFactor * loadFactor
 *   set_min  = (work_sec + rest_sec) / 60
 *   set_kcal = set_met * weightKg * set_min / 60
 *
 * Inputs map 1:1 to the columns on `workout_exercise_logs` so the same
 * formula is also inlined in SQL for the backfill in `lib/db.ts` —
 * keep them in sync if you tune coefficients.
 */

export interface SetKcalInput {
  reps?: number | null;
  restTimeSeconds?: number | null;
  rir?: number | null; // 0..5, lower = harder
  difficultyPerception?: number | null; // 1..5, higher = harder
  weightValue?: number | null; // load on the bar / external load
  weightUnit?: 'kg' | 'lbs' | null;
  /**
   * Whether the `reps` field represents a rep count ('reps', default) or a hold/duration
   * in seconds ('seconds'). Isometric holds and steady-state cardio use 'seconds' and the
   * value is treated as the work duration directly (no reps × 3s expansion).
   */
  loggingUnit?: 'reps' | 'seconds' | null;
}

const DEFAULT_REPS = 8;
const DEFAULT_REST_SECONDS = 60;
const SECONDS_PER_REP = 3;
const MIN_WORK_SECONDS = 15;
const MAX_WORK_SECONDS = 60;
// Seconds-based exercises (holds, cardio) cover a much wider duration range than
// rep-derived work. Cap at 1 hour to keep a single absurd entry from blowing up totals.
const MAX_WORK_SECONDS_SECONDS_UNIT = 3600;
const DEFAULT_WORK_SECONDS_SECONDS_UNIT = 30;
const BASE_MET = 5.0;
const LOAD_FACTOR_COEFF = 0.3;
const LBS_TO_KG = 0.453592;

/**
 * Returns the rounded kcal estimate for a single set. Always >= 0.
 * `weightKg` should be the user's bodyweight at the time of the session.
 */
export function estimateSetKcal(input: SetKcalInput, weightKg: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return 0;

  const restSec = numberOr(input.restTimeSeconds, DEFAULT_REST_SECONDS, { min: 0 });
  const workSec =
    input.loggingUnit === 'seconds'
      ? clamp(
          numberOr(input.reps, DEFAULT_WORK_SECONDS_SECONDS_UNIT, { min: 1 }),
          MIN_WORK_SECONDS,
          MAX_WORK_SECONDS_SECONDS_UNIT,
        )
      : clamp(
          numberOr(input.reps, DEFAULT_REPS, { min: 1 }) * SECONDS_PER_REP,
          MIN_WORK_SECONDS,
          MAX_WORK_SECONDS,
        );
  const setMinutes = (workSec + restSec) / 60;

  const fromRir = isFiniteNumber(input.rir)
    ? input.rir <= 1
      ? 1.2
      : input.rir <= 3
      ? 1.0
      : 0.85
    : null;
  const fromDifficulty = isFiniteNumber(input.difficultyPerception)
    ? input.difficultyPerception >= 4
      ? 1.2
      : input.difficultyPerception >= 2
      ? 1.0
      : 0.85
    : null;

  const effortFactor =
    fromRir == null && fromDifficulty == null
      ? 1.0
      : Math.max(fromRir ?? 0, fromDifficulty ?? 0);

  const loadKg = resolveLoadKg(input);
  const loadFactor = loadKg > 0 ? 1 + LOAD_FACTOR_COEFF * Math.log(1 + loadKg / weightKg) : 1.0;

  const setMet = BASE_MET * effortFactor * loadFactor;
  const kcal = (setMet * weightKg * setMinutes) / 60;
  return Math.max(0, Math.round(kcal));
}

export const DEFAULT_BODYWEIGHT_KG = 70;

/** External load on the bar/handle in kg, from a weight value + unit (0 for bodyweight). */
export function resolveLoadKgFromWeight(
  weightValue?: number | null,
  weightUnit?: WeightUnit | null,
): number {
  if (!isFiniteNumber(weightValue) || weightValue <= 0) return 0;
  return weightUnit === 'lbs' ? weightValue * LBS_TO_KG : weightValue;
}

/**
 * Saturating per-set load multiplier (≥ 1.0) shared with the kcal model: bodyweight-only sets
 * return 1.0, bodyweight-equivalent load ≈ 1.21, 2× bodyweight ≈ 1.33. Used to weight muscle-map
 * activation by how heavy each set was without letting big lifts swamp lighter isolation work.
 */
export function loadFactorForSet(
  weightValue?: number | null,
  weightUnit?: WeightUnit | null,
  bodyweightKg: number = DEFAULT_BODYWEIGHT_KG,
): number {
  const bw = isFiniteNumber(bodyweightKg) && bodyweightKg > 0 ? bodyweightKg : DEFAULT_BODYWEIGHT_KG;
  const loadKg = resolveLoadKgFromWeight(weightValue, weightUnit);
  return loadKg > 0 ? 1 + LOAD_FACTOR_COEFF * Math.log(1 + loadKg / bw) : 1.0;
}

function parsePlannedReps(reps: string | number | undefined): number {
  if (reps == null) return DEFAULT_REPS;
  const s = String(reps).trim();
  const rangeMatch = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (rangeMatch) {
    const low = parseInt(rangeMatch[1], 10);
    const high = parseInt(rangeMatch[2], 10);
    return Math.ceil((low + high) / 2);
  }
  const firstInt = s.match(/\d+/);
  if (firstInt) {
    const n = parseInt(firstInt[0], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_REPS;
}

function parsePlannedSets(sets: number | string | undefined): number {
  if (typeof sets === 'number' && Number.isFinite(sets) && sets > 0) {
    return Math.round(sets);
  }
  if (typeof sets === 'string') {
    const n = parseInt(sets.replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 3;
}

function parsePlannedRir(rir: number | string | undefined): number | undefined {
  if (typeof rir === 'number' && Number.isFinite(rir)) return rir;
  if (typeof rir === 'string') {
    const n = parseInt(rir.replace(/[^\d-]/g, ''), 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Estimate kcal burned for a prescribed workout session (plan creation / display).
 * Uses the same per-set model as logged workouts, without external load on the bar.
 */
export type PlannedExerciseKcalInput = {
  exerciseId: string;
  sets: number | string;
  reps: string | number;
  restTimeSeconds?: number;
  rir?: number | string;
};

export function estimatePlannedWorkoutKcal(
  exercises: readonly PlannedExerciseKcalInput[],
  weightKg: number = DEFAULT_BODYWEIGHT_KG,
): number {
  const bodyKg = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : DEFAULT_BODYWEIGHT_KG;
  let total = 0;
  for (const ex of exercises) {
    const setCount = parsePlannedSets(ex.sets);
    const reps = parsePlannedReps(ex.reps);
    const rir = parsePlannedRir(ex.rir);
    const restTimeSeconds =
      typeof ex.restTimeSeconds === 'number' && ex.restTimeSeconds > 0
        ? ex.restTimeSeconds
        : DEFAULT_REST_SECONDS;
    const loggingUnit = getExerciseLoggingUnitById(ex.exerciseId);
    for (let i = 0; i < setCount; i++) {
      total += estimateSetKcal(
        { reps, restTimeSeconds, rir, loggingUnit },
        bodyKg,
      );
    }
  }
  return Math.max(0, Math.round(total));
}

export function isLoggedExerciseSet(
  ex: Pick<ExerciseLog, 'completed' | 'reps' | 'weightValue'>,
): boolean {
  return !!(ex.completed || ex.reps != null || ex.weightValue != null);
}

/** Sum burned kcal for all logged sets in a workout session. */
export function sumWorkoutLogBurnedKcal(
  exercises: readonly ExerciseLog[],
  weightKg: number = DEFAULT_BODYWEIGHT_KG,
): number {
  const bodyKg = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : DEFAULT_BODYWEIGHT_KG;
  let total = 0;
  for (const ex of exercises) {
    if (!isLoggedExerciseSet(ex)) continue;
    if (typeof ex.caloriesBurned === 'number' && Number.isFinite(ex.caloriesBurned)) {
      total += ex.caloriesBurned;
      continue;
    }
    total += estimateSetKcal(
      {
        reps: ex.reps,
        restTimeSeconds: ex.restTimeSeconds,
        rir: ex.rir,
        difficultyPerception: ex.difficultyPerception,
        weightValue: ex.weightValue,
        weightUnit: ex.weightUnit,
        loggingUnit: getExerciseLoggingUnitById(ex.exerciseId),
      },
      bodyKg,
    );
  }
  return Math.max(0, Math.round(total));
}

function resolveLoadKg(input: SetKcalInput): number {
  if (!isFiniteNumber(input.weightValue) || input.weightValue <= 0) return 0;
  if (input.weightUnit === 'lbs') return input.weightValue * LBS_TO_KG;
  return input.weightValue;
}

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOr(
  value: number | null | undefined,
  fallback: number,
  opts?: { min?: number },
): number {
  if (!isFiniteNumber(value)) return fallback;
  if (opts?.min != null && value < opts.min) return opts.min;
  return value;
}
