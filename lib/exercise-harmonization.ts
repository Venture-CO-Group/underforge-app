import OpenAI from 'openai';
import { AVAILABLE_EXERCISE_IDS, getExerciseListForPrompt } from './exercise-list';
import { BUILTIN_EXERCISES } from './exercise-catalog';
import {
  normalizeExerciseNameKey,
  normalizeExerciseNameLooseKey,
} from './exercise-localization';
import { glowLogger } from './glow-logger';
import { DEFAULT_BODYWEIGHT_KG, estimatePlannedWorkoutKcal } from './workout-energy';

const openai = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY || '',
});

/** Strong model for catalog matching — avoids mini-model mis-picks on synonyms / equipment variants. */
export const EXERCISE_HARMONIZE_MODEL = 'gpt-4o';

const knownIdSet = new Set<string>(AVAILABLE_EXERCISE_IDS);

/** Retired catalog ids mapped to their replacement (legacy plans may still reference the old id). */
const LEGACY_CATALOG_ID_ALIASES: Record<string, string> = {
  lunge: 'walking-lunge',
};

/** User-created custom exercises from "Add my own exercise" — never rewrite these IDs. */
const USER_CREATED_CUSTOM_ID =
  /^custom_(upper|lower|core)_(chest|back|shoulders|arms|legs|quads|hamstrings|glutes|adductors|calves|abs|obliques)_(compound|isolation)_/i;

/**
 * Deterministic name → catalog-id index, built once from the catalog. Lets us resolve
 * a logged/planned exercise to a stable catalog id by name (exact and plural/case-insensitive)
 * WITHOUT an LLM call, so the same display name always yields the same id (homologation).
 */
let catalogNameIndex: Map<string, string> | null = null;
function getCatalogNameIndex(): Map<string, string> {
  if (catalogNameIndex) return catalogNameIndex;
  const idx = new Map<string, string>();
  for (const ex of BUILTIN_EXERCISES) {
    const keys = [
      normalizeExerciseNameKey(ex.name),
      normalizeExerciseNameLooseKey(ex.name),
      ex.nameEs ? normalizeExerciseNameKey(ex.nameEs) : '',
      ex.nameEs ? normalizeExerciseNameLooseKey(ex.nameEs) : '',
    ];
    for (const key of keys) {
      if (key && !idx.has(key)) idx.set(key, ex.id);
    }
  }
  catalogNameIndex = idx;
  return idx;
}

/** Resolve a catalog id from a display name deterministically, or undefined when no match. */
function deterministicCatalogIdByName(name: string): string | undefined {
  const idx = getCatalogNameIndex();
  return idx.get(normalizeExerciseNameKey(name)) ?? idx.get(normalizeExerciseNameLooseKey(name));
}

export function isUserCreatedCustomExerciseId(exerciseId: string | undefined | null): boolean {
  if (!exerciseId) return false;
  return USER_CREATED_CUSTOM_ID.test(exerciseId);
}

export function isCatalogExerciseId(exerciseId: string | undefined | null): boolean {
  if (!exerciseId) return false;
  const normalized = exerciseId.replace(/_/g, '-');
  const aliased = LEGACY_CATALOG_ID_ALIASES[normalized] ?? normalized;
  return knownIdSet.has(aliased);
}

function normalizeCatalogExerciseId(exerciseId: string): string {
  const normalized = exerciseId.replace(/_/g, '-');
  return LEGACY_CATALOG_ID_ALIASES[normalized] ?? normalized;
}

/**
 * Drop duplicate main-list exercises (keeps first). Dedupes by canonical exerciseId AND by
 * case/plural-insensitive display name, so "Standing Calf Raise" + "Standing Calf Raises"
 * (or a catalog id + its custom fallback) collapse to one. Used after harmonization on new plans.
 */
export function deduplicateExercisesById<T extends { exerciseId: string; name: string }>(
  exercises: T[],
): T[] {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const result: T[] = [];
  for (const ex of exercises) {
    const id = normalizeCatalogExerciseId(ex.exerciseId);
    const nameKey = normalizeExerciseNameLooseKey(ex.name);
    if (seenIds.has(id) || (nameKey && seenNames.has(nameKey))) {
      glowLogger.info('Duplicate exercise removed from workout', {
        exerciseId: id,
        name: ex.name,
      });
      continue;
    }
    seenIds.add(id);
    if (nameKey) seenNames.add(nameKey);
    result.push(id === ex.exerciseId ? ex : { ...ex, exerciseId: id });
  }
  return result;
}

function fallbackCustomId(name: string): string {
  return `custom_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
}

export interface ExerciseIdNamePair {
  exerciseId?: string | null;
  name: string;
}

/**
 * LLM pass: verify each exercise maps to a catalog ID (synonyms, word order, typos).
 * Skips user-created custom exercises. Does not use keyword/deterministic matching.
 */
export async function harmonizeExerciseIdsWithCatalog(
  exercises: ExerciseIdNamePair[],
): Promise<Map<number, string>> {
  const toVerify: { index: number; proposedId: string; name: string }[] = [];

  exercises.forEach((ex, index) => {
    if (isUserCreatedCustomExerciseId(ex.exerciseId ?? undefined)) return;
    toVerify.push({
      index,
      proposedId: (ex.exerciseId ?? '').trim(),
      name: ex.name.trim(),
    });
  });

  if (toVerify.length === 0) return new Map();

  const exerciseRef = getExerciseListForPrompt();
  const lines = toVerify
    .map(
      (e, i) =>
        `${i + 1}. proposedExerciseId: "${e.proposedId || '(none)'}" | displayName: "${e.name}"`,
    )
    .join('\n');

  const prompt = `Verify each exercise against the catalog below. For each numbered row, pick the best matching catalog exerciseId.

${exerciseRef}

Exercises to verify:
${lines}

Return JSON: { "matches": { "1": "catalog-id-or-null", "2": "catalog-id-or-null", ... } }
Use string keys "1", "2", ... matching the row numbers above.

Rules:
- Match synonyms and reordered wording (e.g. "split bulgarians" → bulgarian-split-squat) when it clearly refers to one catalog exercise.
- If proposedExerciseId is already a valid catalog id AND matches the displayName/equipment intent, return that same id.
- If proposedExerciseId is wrong, missing, or generic (e.g. bench-press, deadlift, squat), pick the correct catalog id using displayName and equipment words (barbell, dumbbell, cable, machine).
- NEVER substitute between equipment variants: barbell-bench-press ≠ dumbbell-bench-press, barbell-deadlift ≠ romanian-deadlift, etc., unless displayName clearly indicates that variant.
- If there is no reasonable catalog match, use null for that row.
- Only use ids from the catalog list above.

Only respond with valid JSON.`;

  try {
    const response = await openai.chat.completions.create({
      model: EXERCISE_HARMONIZE_MODEL,
      max_completion_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You match workout exercise names to a fixed exercise catalog. Return only valid JSON. Never merge different equipment variants.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const content = response.choices[0]?.message?.content || '';
    const parsed = JSON.parse(content) as { matches?: Record<string, string | null> };
    const matches =
      parsed.matches && typeof parsed.matches === 'object' ? parsed.matches : parsed;
    const result = new Map<number, string>();

    toVerify.forEach((entry, listIndex) => {
      const key = String(listIndex + 1);
      const matchedId = matches[key];
      if (matchedId && knownIdSet.has(matchedId)) {
        result.set(entry.index, matchedId);
        if (matchedId !== entry.proposedId) {
          glowLogger.info('Exercise ID harmonized', {
            name: entry.name,
            from: entry.proposedId || '(none)',
            to: matchedId,
          });
        }
      }
    });

    return result;
  } catch (error) {
    glowLogger.warn('Exercise harmonization failed, keeping proposed IDs', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}

function resolveRepRange(reps: string | number | undefined): string {
  if (reps == null) return '';
  const s = String(reps).trim();
  const rangeMatch = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (rangeMatch) {
    const low = parseInt(rangeMatch[1], 10);
    const high = parseInt(rangeMatch[2], 10);
    return String(Math.ceil((low + high) / 2));
  }
  if (/^\d+$/.test(s)) return s;
  return '';
}

function normalizeSets(sets: number | string | undefined): number {
  if (typeof sets === 'number' && Number.isFinite(sets) && sets > 0) {
    return Math.round(sets);
  }
  if (typeof sets === 'string') {
    const n = parseInt(sets.replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 3;
}

function normalizeRir(rir: number | string | undefined): number {
  if (typeof rir === 'number' && Number.isFinite(rir)) {
    return Math.max(0, Math.min(5, Math.round(rir)));
  }
  if (typeof rir === 'string') {
    const n = parseInt(rir.replace(/[^\d-]/g, ''), 10);
    if (Number.isFinite(n)) return Math.max(0, Math.min(5, n));
  }
  return 2;
}

/**
 * Guarantees numeric rep target, positive rest, RiR, and set count for plan / log UIs.
 * LLM output and Zod validation still allow empty reps or missing rest; this fixes those gaps.
 */
export function ensureWorkoutExercisePrescription<
  T extends WorkoutExerciseRow & { exerciseId?: string | null },
>(ex: T): T & { reps: string; restTimeSeconds: number; rir: number; sets: number } {
  const sets = normalizeSets(ex.sets);

  let repsStr = resolveRepRange(ex.reps);
  if (!repsStr || !/^\d+$/.test(repsStr)) {
    const raw = ex.reps == null ? '' : String(ex.reps).trim();
    const firstInt = raw.match(/\d+/);
    repsStr = firstInt ? firstInt[0] : '10';
  }

  let rest = ex.restTimeSeconds;
  if (typeof rest !== 'number' || !Number.isFinite(rest) || rest <= 0) {
    rest = 90;
  }

  const rir = normalizeRir(ex.rir);

  return { ...ex, sets, reps: repsStr, restTimeSeconds: rest, rir };
}

type WorkoutExerciseRow = {
  exerciseId?: string | null;
  name: string;
  sets?: number | string;
  reps?: string | number;
  restTimeSeconds?: number;
  rir?: number | string;
  notes?: string;
  alternatives?: { exerciseId?: string | null; name: string }[];
};

function applyHarmonizedId(
  proposedId: string | null | undefined,
  name: string,
  matched: string | undefined,
): string {
  if (isUserCreatedCustomExerciseId(proposedId ?? undefined)) {
    return proposedId!;
  }
  if (matched) return normalizeCatalogExerciseId(matched);
  if (proposedId && isCatalogExerciseId(proposedId)) {
    return normalizeCatalogExerciseId(proposedId);
  }
  // Deterministic catalog match by name before falling back to a custom id — keeps the
  // same display name mapped to the same id even when the LLM pass returns nothing.
  const byName = deterministicCatalogIdByName(name);
  if (byName) return byName;
  return fallbackCustomId(name);
}

/**
 * LLM catalog verification for workout / plan exercises. Used on every path that emits exerciseIds.
 */
export async function resolveAndHarmonize<T extends WorkoutExerciseRow>(
  exercises: T[],
): Promise<(T & { exerciseId: string })[]> {
  if (exercises.length === 0) return exercises as (T & { exerciseId: string })[];

  const mainHarmonize = await harmonizeExerciseIdsWithCatalog(
    exercises.map((ex) => ({ exerciseId: ex.exerciseId, name: ex.name })),
  );

  return exercises.map((ex, index) => {
    const reps = resolveRepRange(ex.reps) || ex.reps;
    const exerciseId = applyHarmonizedId(ex.exerciseId, ex.name, mainHarmonize.get(index));
    return ensureWorkoutExercisePrescription({ ...ex, exerciseId, reps });
  });
}

async function harmonizeAlternatives(
  alternatives: { exerciseId?: string | null; name: string }[] | undefined,
): Promise<{ exerciseId?: string | null; name: string }[] | undefined> {
  if (!alternatives?.length) return alternatives;

  const altHarmonize = await harmonizeExerciseIdsWithCatalog(alternatives);
  return alternatives.map((alt, i) => {
    if (isUserCreatedCustomExerciseId(alt.exerciseId ?? undefined)) return alt;
    const matched = altHarmonize.get(i);
    if (matched) return { ...alt, exerciseId: normalizeCatalogExerciseId(matched) };
    if (isCatalogExerciseId(alt.exerciseId)) {
      return { ...alt, exerciseId: normalizeCatalogExerciseId(alt.exerciseId!) };
    }
    const byName = deterministicCatalogIdByName(alt.name);
    if (byName) return { ...alt, exerciseId: byName };
    return { ...alt, exerciseId: fallbackCustomId(alt.name) };
  });
}

/** Resolve + harmonize including alternatives (second pass for alts). */
export async function resolveAndHarmonizeExercises<
  T extends WorkoutExerciseRow & { exerciseId?: string | null },
>(
  exercises: T[],
): Promise<(T & { exerciseId: string })[]> {
  const base = await resolveAndHarmonize(exercises);
  const withAlts = await Promise.all(
    base.map(async (ex) => {
      if (!ex.alternatives?.length) return ex;
      const alternatives = await harmonizeAlternatives(ex.alternatives);
      return { ...ex, alternatives };
    }),
  );
  return deduplicateExercisesById(withAlts);
}

function isWorkoutDayObject(value: unknown): value is { exercises?: WorkoutExerciseRow[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { exercises?: unknown }).exercises)
  );
}

export async function harmonizeWorkoutDayExercises(
  day: unknown,
  weightKg: number = DEFAULT_BODYWEIGHT_KG,
): Promise<unknown> {
  if (!isWorkoutDayObject(day)) return day;
  const exercises = day.exercises ?? [];
  if (exercises.length === 0) return day;
  const harmonized = await resolveAndHarmonizeExercises(exercises);
  const estimatedCaloriesBurned = estimatePlannedWorkoutKcal(harmonized, weightKg);
  return { ...day, exercises: harmonized, estimatedCaloriesBurned };
}

export async function harmonizeStepDetails(
  stepDetails: unknown,
  weightKg: number = DEFAULT_BODYWEIGHT_KG,
): Promise<unknown> {
  if (stepDetails == null) return stepDetails;
  if (Array.isArray(stepDetails)) {
    const first = stepDetails[0];
    if (isWorkoutDayObject(first)) {
      return Promise.all(stepDetails.map((d) => harmonizeWorkoutDayExercises(d, weightKg)));
    }
    return stepDetails;
  }
  if (isWorkoutDayObject(stepDetails)) {
    return harmonizeWorkoutDayExercises(stepDetails, weightKg);
  }
  return stepDetails;
}

export async function harmonizeActionPlanResponse<
  T extends { actionPlan?: { steps?: { id: string; step_details?: unknown }[] } },
>(response: T, options?: { weightKg?: number }): Promise<T> {
  const steps = response.actionPlan?.steps;
  if (!steps?.length) return response;

  const weightKg =
    options?.weightKg != null && options.weightKg > 0
      ? options.weightKg
      : DEFAULT_BODYWEIGHT_KG;

  const updatedSteps = await Promise.all(
    steps.map(async (step) => {
      if (step.id !== 'step_1' || step.step_details == null) return step;
      return {
        ...step,
        step_details: await harmonizeStepDetails(step.step_details, weightKg),
      };
    }),
  );

  return {
    ...response,
    actionPlan: {
      ...response.actionPlan!,
      steps: updatedSteps,
    },
  };
}
