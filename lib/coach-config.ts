import type { Coach } from '../types/onboarding_config';

/** DB first names without accents → onboarding_coaches.json keys */
const CONFIG_KEY_ALIASES: Record<string, string> = {
  Jesus: 'Jesús',
};

export function getCanonicalCoachKey(firstName: string): string {
  const normalized = firstName.normalize('NFC').trim();
  return CONFIG_KEY_ALIASES[normalized] ?? normalized;
}

export function resolveCoachConfig(
  coachSelection: Record<string, Coach>,
  firstName: string,
): Coach | null {
  const key = getCanonicalCoachKey(firstName);
  if (!key) return null;
  return coachSelection[key] ?? null;
}

export function getCoachShortDescription(coach: Coach | null | undefined, isSpanish: boolean): string | undefined {
  if (!coach) return undefined;
  if (isSpanish && coach.short_description_es) return coach.short_description_es;
  return coach.short_description;
}

export function getCoachDescription(coach: Coach | null | undefined, isSpanish: boolean): string | undefined {
  if (!coach) return undefined;
  if (isSpanish && coach.description_es) return coach.description_es;
  return coach.description;
}
