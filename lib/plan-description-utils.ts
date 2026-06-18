import { ActionStep } from '../types/onboard';
import { WorkoutPlan } from '../types/workout';

/** Words shown on plan overview cards (training, nutrition, recovery). */
export const PLAN_OVERVIEW_MAX_WORDS = 15;

/** Max words the LLM may write per step description (details page). */
export const PLAN_DETAIL_DESCRIPTION_MAX_WORDS = 30;

function getWorkoutPlansFromStep(step: ActionStep): WorkoutPlan[] {
  if (!step.step_details) return [];
  if (Array.isArray(step.step_details)) {
    return (step.step_details as WorkoutPlan[]).filter((d) => d.dayName && d.dayType);
  }
  const details = step.step_details as WorkoutPlan;
  if (details.dayName && details.dayType) return [details];
  return [];
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g);
  if (!parts?.length) return [text];
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** True when a sentence is mainly about per-session calorie burn (overview should omit). */
export function isTrainingKcalBurnSentence(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  if (!/\bkcal\b|calor[ií]as/.test(lower)) return false;
  return (
    /burn|quema|burned|quemad|estimated calories|calor[ií]as\s+quemadas/i.test(lower) ||
    /aproximadamente|approximately|per session|por sesi[oó]n|each session|cada sesi[oó]n/i.test(
      lower
    )
  );
}

export function stripTrainingKcalBurnSentences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const sentences = splitSentences(trimmed);
  if (sentences.length <= 1) {
    return isTrainingKcalBurnSentence(trimmed) ? '' : trimmed;
  }
  const kept = sentences.filter((s) => !isTrainingKcalBurnSentence(s));
  return kept.join(' ').trim();
}

export function truncateToMaxWords(
  text: string,
  maxWords: number,
  addEllipsis = true
): string {
  const normalized = text.trim();
  if (!normalized || maxWords <= 0) return '';
  const words = normalized.split(/\s+/);
  if (words.length <= maxWords) return normalized;
  const clipped = words.slice(0, maxWords).join(' ');
  return addEllipsis ? `${clipped}…` : clipped;
}

/** Overview card copy: first 15 words (training omits kcal-burn sentences first). */
export function getOverviewStepDescription(
  description: string | undefined,
  sectionKey: string
): string {
  if (!description?.trim()) return '';
  let text = description;
  if (sectionKey === 'training') {
    text = stripTrainingKcalBurnSentences(text);
    if (!text.trim()) return '';
  }
  return truncateToMaxWords(text, PLAN_OVERVIEW_MAX_WORDS);
}

export type TrainingSessionKcalInfo =
  | { kind: 'single'; kcal: number }
  | { kind: 'multi'; sessions: Array<{ dayName: string; kcal: number }> };

export function getTrainingSessionKcalInfo(step: ActionStep): TrainingSessionKcalInfo | null {
  const plans = getWorkoutPlansFromStep(step);
  const withKcal = plans.filter(
    (p) => typeof p.estimatedCaloriesBurned === 'number' && p.estimatedCaloriesBurned > 0
  );
  if (!withKcal.length) return null;
  if (withKcal.length === 1) {
    return { kind: 'single', kcal: withKcal[0].estimatedCaloriesBurned! };
  }
  return {
    kind: 'multi',
    sessions: withKcal.map((p) => ({
      dayName: p.dayName,
      kcal: p.estimatedCaloriesBurned!,
    })),
  };
}

/** Whether the full description already mentions session kcal burn. */
export function descriptionMentionsSessionKcal(text: string): boolean {
  return isTrainingKcalBurnSentence(text) || /\bestimatedCaloriesBurned\b/i.test(text);
}
