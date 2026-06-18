import type { Exercise } from '../types/workout';
import { getLocalizedExerciseName } from './exercise-localization';

/** Extra Spanish (and English) tokens so search matches how users type, not only catalog `nameEs`. */
const SEARCH_ALIASES: Record<string, string[]> = {
  running: ['correr', 'trotar', 'jogging', 'run'],
  walking: ['caminar', 'caminata', 'andar', 'walk'],
  cycling: ['ciclismo', 'bicicleta', 'bici', 'bike', 'cycle'],
  swimming: ['nadar', 'natación', 'natacion', 'swim'],
  hiking: ['senderismo', 'excursion', 'hike'],
  'jump-rope': ['saltar la cuerda', 'comba', 'cuerda', 'jump rope'],
  'rowing-machine': ['remo', 'ergometro', 'ergómetro', 'rower'],
  'ski-erg': ['esqui', 'esquí', 'ski erg'],
  'stair-climber': ['escaladora', 'subir escaleras', 'stairs'],
  elliptical: ['elíptica', 'eliptica', 'elliptical'],
  'assault-bike': ['air bike', 'bicicleta de aire'],
  'sprint-intervals': ['sprints', 'velocidad', 'intervalos'],
  rucking: ['mochila', 'marcha con peso'],
  'incline-walking': ['cinta inclinada', 'caminata inclinada'],
};

export type ExercisePickerCategory = 'all' | 'strength' | 'endurance';

export function exerciseMatchesPickerCategory(
  exercise: Exercise,
  picker: ExercisePickerCategory,
): boolean {
  if (picker === 'all') return true;
  const cat = exercise.category ?? 'strength';
  if (picker === 'endurance') {
    return cat === 'endurance' || cat === 'conditioning';
  }
  return cat !== 'endurance' && cat !== 'conditioning';
}

export function exerciseMatchesSearchQuery(
  exercise: Exercise,
  query: string,
  lang?: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const display = getLocalizedExerciseName(exercise, exercise.name, lang).toLowerCase();
  const tokens = [
    display,
    exercise.name.toLowerCase(),
    exercise.id.replace(/-/g, ' '),
    exercise.muscleGroup.toLowerCase(),
    exercise.movementType.toLowerCase(),
    ...(exercise.nameEs ? [exercise.nameEs.toLowerCase()] : []),
    ...(SEARCH_ALIASES[exercise.id] ?? []).map((a) => a.toLowerCase()),
  ];

  return tokens.some((token) => token.includes(q));
}
