// Edge-function-side normalizer for provider payloads. Mirrors the shape of
// the on-device provider adapter so `activity_logs` and `daily_metrics`
// rows look identical regardless of ingestion path.
//
// Currently targets Whoop's v2 API.

import type { ProviderSource } from './canonical.ts';

export type ActivityCategory =
  | 'running'
  | 'hiking'
  | 'cycling'
  | 'swimming'
  | 'winter_sports'
  | 'racket_sports'
  | 'team_sports'
  | 'water_sports'
  | 'martial_arts'
  | 'mind_body'
  | 'gym_cardio'
  | 'outdoor'
  | 'other';

export type ActivityIntensity = 'easy' | 'moderate' | 'hard' | 'max';

export interface NormalizedActivity {
  user_id: string;
  source: ProviderSource;
  external_id: string;
  activity_date: string;          // YYYY-MM-DD
  started_at: string;             // ISO
  ended_at: string;               // ISO
  duration_minutes: number;
  activity_type: string;          // our app-level activity_type id
  activity_name: string;
  intensity: ActivityIntensity;
  distance_value?: number;
  distance_unit?: 'km' | 'mi';
  elevation_gain?: number;
  calories_burned: number;
  calories_source: 'provider' | 'estimated_met' | 'estimated_hr' | 'manual';
  calories_confidence: 'high' | 'medium' | 'low';
  avg_heart_rate?: number;
  notes?: string;
  dedupe_fingerprint: string;
}

const MET_BY_CATEGORY: Record<ActivityCategory, number> = {
  running: 9.8,
  hiking: 6.0,
  cycling: 7.5,
  swimming: 8.0,
  winter_sports: 6.0,
  racket_sports: 7.0,
  team_sports: 7.5,
  water_sports: 5.5,
  martial_arts: 8.5,
  mind_body: 3.0,
  gym_cardio: 7.0,
  outdoor: 5.5,
  other: 5.0,
};

/**
 * Estimate calories via MET, then sanity-check a provider-reported value
 * against that estimate. If the provider value is within [0.5x, 2x] of the
 * MET baseline we trust it; otherwise we fall back to MET and flag low
 * confidence.
 *
 * Duplicated with lib/providers/met-table.ts — the plan accepts this
 * duplication in v1; a future pass should share via a codegen JSON schema.
 */
export function reconcileCalories(
  providerKcal: number | undefined,
  category: ActivityCategory,
  durationMinutes: number,
  weightKg: number,
): { kcal: number; source: 'provider' | 'estimated_met'; confidence: 'high' | 'medium' | 'low' } {
  const baseMet = MET_BY_CATEGORY[category] ?? MET_BY_CATEGORY.other;
  const metKcal = Math.round((baseMet * weightKg * durationMinutes) / 60);

  if (typeof providerKcal === 'number' && providerKcal > 0 && Number.isFinite(providerKcal)) {
    if (providerKcal >= metKcal * 0.5 && providerKcal <= metKcal * 2) {
      return { kcal: Math.round(providerKcal), source: 'provider', confidence: 'high' };
    }
    return { kcal: metKcal, source: 'estimated_met', confidence: 'low' };
  }
  return { kcal: metKcal, source: 'estimated_met', confidence: 'medium' };
}

export function fingerprint(
  startedAtIso: string,
  category: ActivityCategory,
  durationMinutes: number,
): string {
  const bucketMinutes = 10;
  const bucket = Math.floor(new Date(startedAtIso).getTime() / (bucketMinutes * 60 * 1000));
  return `${bucket}|${category}|${Math.round(durationMinutes)}`;
}

export function toLocalYmd(iso: string): string {
  // Whoop emits UTC timestamps. For activity_date we use UTC date to match
  // how HealthKit tags workouts. If later we surface a mismatch with the
  // user's local timezone we can ingest `user_profile.timezone` here.
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Map a Whoop `sport_id` / sport name into our app taxonomy. Coarse on
 * purpose; see the plan for rationale.
 */
export function mapWhoopSportToCategory(name: string | undefined): {
  category: ActivityCategory;
  activityType: string;
} {
  const n = (name ?? '').toLowerCase();
  if (n.includes('run')) return { category: 'running', activityType: 'run' };
  if (n.includes('hike')) return { category: 'hiking', activityType: 'hike' };
  if (n.includes('walk')) return { category: 'running', activityType: 'walk' };
  if (n.includes('cycl') || n.includes('bike')) return { category: 'cycling', activityType: 'road_cycling' };
  if (n.includes('swim')) return { category: 'swimming', activityType: 'pool_swim' };
  if (n.includes('ski') || n.includes('snowboard')) return { category: 'winter_sports', activityType: 'downhill_skiing' };
  if (n.includes('tennis') || n.includes('pickle') || n.includes('padel') || n.includes('squash') || n.includes('badminton')) return { category: 'racket_sports', activityType: 'tennis' };
  if (n.includes('soccer') || n.includes('football') || n.includes('basketball') || n.includes('rugby') || n.includes('hockey') || n.includes('baseball')) return { category: 'team_sports', activityType: 'soccer' };
  if (n.includes('row') || n.includes('kayak') || n.includes('surf') || n.includes('sail')) return { category: 'water_sports', activityType: 'rowing' };
  if (n.includes('box') || n.includes('mma') || n.includes('judo') || n.includes('karate') || n.includes('muay')) return { category: 'martial_arts', activityType: 'boxing' };
  if (n.includes('yoga') || n.includes('pilates') || n.includes('stretch')) return { category: 'mind_body', activityType: 'yoga' };
  if (n.includes('weight') || n.includes('strength') || n.includes('lift')) return { category: 'gym_cardio', activityType: 'hiit_class' };
  if (n.includes('hiit') || n.includes('cross')) return { category: 'gym_cardio', activityType: 'hiit_class' };
  if (n.includes('climb') || n.includes('bouldering')) return { category: 'outdoor', activityType: 'climbing' };
  return { category: 'other', activityType: 'other_activity' };
}

// ---------------------------------------------------------------------------
// Sleep + Recovery (daily metrics, no activity_logs row)
// ---------------------------------------------------------------------------

/**
 * Whoop sleep payload (abridged). Only the fields we care about for the
 * "main indicators" dashboard: total time asleep + efficiency.
 */
export interface WhoopSleepPayload {
  id: number | string;
  cycle_id?: number | string;
  user_id: number | string;
  start: string;
  end: string;
  nap?: boolean;
  score_state?: string;
  score?: {
    sleep_efficiency_percentage?: number;
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    stage_summary?: {
      total_light_sleep_time_milli?: number;
      total_slow_wave_sleep_time_milli?: number;
      total_rem_sleep_time_milli?: number;
      total_in_bed_time_milli?: number;
      total_awake_time_milli?: number;
    };
  };
}

export interface NormalizedSleepIndicators {
  /** UTC date the user woke up — keyed by `end`, not `start`. */
  metric_date: string;
  total_min: number | null;
  efficiency_pct: number | null;
}

/**
 * Reduce a Whoop sleep record to (date, total minutes, efficiency).
 * Returns null for naps, unscored sessions, or anything we cannot place on a
 * date. The caller decides how to handle multiple records on the same date
 * (we collapse to the longest one in the poller).
 */
export function normalizeWhoopSleep(
  payload: WhoopSleepPayload,
): NormalizedSleepIndicators | null {
  if (!payload?.id || !payload.start || !payload.end) return null;
  if (payload.nap) return null;
  if (payload.score_state && payload.score_state !== 'SCORED') return null;

  const stages = payload.score?.stage_summary;
  const milli =
    (stages?.total_light_sleep_time_milli ?? 0) +
    (stages?.total_slow_wave_sleep_time_milli ?? 0) +
    (stages?.total_rem_sleep_time_milli ?? 0);
  const totalMin = milli > 0 ? Math.round(milli / 60_000) : null;

  const eff = payload.score?.sleep_efficiency_percentage;
  const efficiencyPct =
    typeof eff === 'number' && Number.isFinite(eff)
      ? Math.round(eff * 10) / 10
      : null;

  if (totalMin === null && efficiencyPct === null) return null;

  return {
    metric_date: toLocalYmd(payload.end),
    total_min: totalMin,
    efficiency_pct: efficiencyPct,
  };
}

/**
 * Whoop recovery payload (abridged). One record per cycle.
 */
export interface WhoopRecoveryPayload {
  cycle_id: number | string;
  sleep_id?: number | string;
  user_id: number | string;
  created_at: string;
  updated_at?: string;
  score_state?: string;
  score?: {
    user_calibrating?: boolean;
    recovery_score?: number;
    resting_heart_rate?: number;
    hrv_rmssd_milli?: number;
  };
}

export interface NormalizedRecoveryIndicators {
  /** UTC date keyed by `created_at` (recovery is scored a few hours after wake). */
  metric_date: string;
  recovery_score: number | null;
  resting_hr_bpm: number | null;
  hrv_rmssd_ms: number | null;
}

export function normalizeWhoopRecovery(
  payload: WhoopRecoveryPayload,
): NormalizedRecoveryIndicators | null {
  if (!payload?.cycle_id || !payload.created_at) return null;
  if (payload.score_state && payload.score_state !== 'SCORED') return null;
  if (payload.score?.user_calibrating) return null;

  const score = payload.score ?? {};
  const recoveryScore =
    typeof score.recovery_score === 'number' && Number.isFinite(score.recovery_score)
      ? Math.round(score.recovery_score)
      : null;
  const rhr =
    typeof score.resting_heart_rate === 'number' &&
    Number.isFinite(score.resting_heart_rate)
      ? Math.round(score.resting_heart_rate)
      : null;
  const hrv =
    typeof score.hrv_rmssd_milli === 'number' && Number.isFinite(score.hrv_rmssd_milli)
      ? Math.round(score.hrv_rmssd_milli * 10) / 10
      : null;

  if (recoveryScore === null && rhr === null && hrv === null) return null;

  return {
    metric_date: toLocalYmd(payload.created_at),
    recovery_score: recoveryScore,
    resting_hr_bpm: rhr,
    hrv_rmssd_ms: hrv,
  };
}

/**
 * Whoop workout payload (abridged). See
 * https://developer.whoop.com/docs/developing/user-data/workout for the
 * full schema — we only use the fields that map cleanly onto our model.
 */
export interface WhoopWorkoutPayload {
  id: number | string;
  user_id: number | string;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset?: string;
  sport_name?: string;
  sport_id?: number;
  score_state?: string;
  score?: {
    strain?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
    kilojoule?: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
  };
}

/**
 * Approximate steps for a Whoop walk/run/hike workout from `distance_meter`.
 * Whoop V2 does not expose raw step counts, so we use category-tuned strides.
 *
 * Returns null if the workout isn't step-bearing or has no usable distance.
 *   - walk: 1400 steps/km (~0.71 m stride)
 *   - hike: 1300 steps/km (~0.77 m stride)
 *   - run:   950 steps/km (~1.05 m stride)
 *
 * Anything else (cycling, swim, weights, yoga, …) returns null because the
 * step count for those is meaningless or already zero.
 */
export function estimateWhoopWorkoutSteps(payload: WhoopWorkoutPayload): number | null {
  const sport = (payload?.sport_name ?? '').toLowerCase();
  const distMeters = payload?.score?.distance_meter;
  if (typeof distMeters !== 'number' || !Number.isFinite(distMeters) || distMeters <= 0) {
    return null;
  }

  let stepsPerKm: number;
  if (sport.includes('run')) stepsPerKm = 950;
  else if (sport.includes('hike')) stepsPerKm = 1300;
  else if (sport.includes('walk')) stepsPerKm = 1400;
  else return null;

  const km = distMeters / 1000;
  const steps = Math.round(km * stepsPerKm);
  return steps > 0 ? steps : null;
}

export function normalizeWhoopWorkout(
  userId: string,
  payload: WhoopWorkoutPayload,
  weightKg: number,
): NormalizedActivity | null {
  if (!payload?.id || !payload.start || !payload.end) return null;
  const start = new Date(payload.start);
  const end = new Date(payload.end);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (durationMinutes <= 0) return null;

  const { category, activityType } = mapWhoopSportToCategory(payload.sport_name);
  const providerKcal = payload.score?.kilojoule
    ? payload.score.kilojoule / 4.184
    : undefined;
  const calories = reconcileCalories(providerKcal, category, durationMinutes, weightKg);

  const strain = payload.score?.strain ?? 0;
  const intensity: ActivityIntensity =
    strain < 8 ? 'easy' : strain < 14 ? 'moderate' : strain < 18 ? 'hard' : 'max';

  const distanceMeters = payload.score?.distance_meter;
  const distanceKm = typeof distanceMeters === 'number' ? distanceMeters / 1000 : undefined;

  return {
    user_id: userId,
    source: 'whoop',
    external_id: String(payload.id),
    activity_date: toLocalYmd(payload.start),
    started_at: payload.start,
    ended_at: payload.end,
    duration_minutes: durationMinutes,
    activity_type: activityType,
    activity_name: payload.sport_name ?? 'Workout',
    intensity,
    distance_value: distanceKm,
    distance_unit: typeof distanceKm === 'number' ? 'km' : undefined,
    elevation_gain: payload.score?.altitude_gain_meter ?? undefined,
    calories_burned: calories.kcal,
    calories_source: calories.source,
    calories_confidence: calories.confidence,
    avg_heart_rate: payload.score?.average_heart_rate,
    dedupe_fingerprint: fingerprint(payload.start, category, durationMinutes),
  };
}
