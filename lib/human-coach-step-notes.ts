import { supabase } from './supabase_db_new';
import { glowLogger } from './glow-logger';

/**
 * Per-step notes written manually by the human coach in Supabase Studio.
 *
 * Stored as a JSON string on `user_profile.human_coach_step_notes_json`
 * (kept out of `onboarding_profile_json` so plan regenerations / in-app
 * plan edits don't clobber them). Keys are the fixed action-step ids:
 *
 *   {
 *     "step_1": "Focus on hip hinge this block...",
 *     "step_2": "Keep protein at 1.8g/kg...",
 *     "step_3": "Prioritize 7.5h sleep..."
 *   }
 */
export type HumanCoachStepNotes = Record<string, string>;

export function parseHumanCoachStepNotesJson(
  raw: string | null | undefined
): HumanCoachStepNotes {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: HumanCoachStepNotes = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch (e) {
    glowLogger.warn('Failed to parse human_coach_step_notes_json', {
      error: e instanceof Error ? e.message : String(e),
    });
    return {};
  }
}

export function getHumanCoachNoteForStep(
  notes: HumanCoachStepNotes,
  stepId: string | undefined | null
): string | null {
  if (!stepId) return null;
  const value = notes[stepId];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Narrow fetch for just the notes column, so the step detail card can pick up
 * coach edits without forcing a full profile refresh. Returns the raw JSON
 * string so callers can pass it through `parseHumanCoachStepNotesJson`.
 */
export async function fetchHumanCoachStepNotes(
  userId: string | undefined | null
): Promise<string | null> {
  if (!userId || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from('user_profile')
      .select('human_coach_step_notes_json')
      .eq('user_id', userId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      glowLogger.warn('Failed to fetch human_coach_step_notes_json', {
        user_id: userId,
        error: error.message || String(error),
      });
      return null;
    }
    return (data?.human_coach_step_notes_json as string | null) ?? null;
  } catch (e) {
    glowLogger.warn('Exception fetching human_coach_step_notes_json', {
      user_id: userId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
