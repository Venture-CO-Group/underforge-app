import { getDatabase } from './db';
import { glowLogger } from './glow-logger';
import {
  BodyRegion,
  CustomExercise,
  Exercise,
  ExerciseCategory,
  MuscleGroup,
  MovementType,
} from '../types/workout';

interface CustomExerciseRow {
  id: string;
  user_id: string;
  name: string;
  body_region: BodyRegion;
  muscle_group: MuscleGroup;
  movement_type: MovementType;
  category: ExerciseCategory | null;
  created_at: string;
  updated_at: string;
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function slugifyName(name: string): string {
  const slug = normalizeName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'exercise';
}

function mapRowToCustomExercise(row: CustomExerciseRow): CustomExercise {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    bodyRegion: row.body_region,
    muscleGroup: row.muscle_group,
    movementType: row.movement_type,
    category: row.category ?? 'strength',
    equipment: [],
    videoUrl: '',
    instructions: '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function hydrateCustomExerciseFromId(
  exerciseId: string,
  exerciseName: string,
  userId = '',
): Exercise | null {
  const match = exerciseId.match(
    /^custom_(upper|lower|core)_(chest|back|shoulders|arms|legs|quads|hamstrings|glutes|adductors|calves|abs|obliques)_(compound|isolation)_(.+)$/i,
  );

  if (!match) return null;

  return {
    id: exerciseId,
    userId,
    name: exerciseName,
    bodyRegion: match[1] as BodyRegion,
    muscleGroup: match[2] as MuscleGroup,
    movementType: match[3] as MovementType,
    category: 'strength',
    equipment: [],
    videoUrl: '',
    instructions: '',
  } as CustomExercise;
}

export async function listCustomExercises(userId: string): Promise<CustomExercise[]> {
  try {
    const db = getDatabase();
    const rows = await db.getAllAsync<CustomExerciseRow>(
      `SELECT *
       FROM custom_exercises
       WHERE user_id = ?
       ORDER BY LOWER(name) ASC`,
      [userId],
    );
    return rows.map(mapRowToCustomExercise);
  } catch (error) {
    glowLogger.error('Failed to list custom exercises', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return [];
  }
}

export async function getCustomExerciseById(
  userId: string,
  exerciseId: string,
): Promise<CustomExercise | null> {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<CustomExerciseRow>(
      `SELECT *
       FROM custom_exercises
       WHERE user_id = ? AND id = ?
       LIMIT 1`,
      [userId, exerciseId],
    );
    return row ? mapRowToCustomExercise(row) : null;
  } catch (error) {
    glowLogger.error('Failed to get custom exercise by id', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      exercise_id: exerciseId,
    });
    return null;
  }
}

export async function createCustomExercise(
  userId: string,
  input: {
    name: string;
    bodyRegion: BodyRegion;
    muscleGroup: MuscleGroup;
    movementType: MovementType;
    category?: ExerciseCategory;
  },
): Promise<CustomExercise | null> {
  const normalizedName = normalizeName(input.name);
  if (!normalizedName) return null;
  const category: ExerciseCategory = input.category ?? 'strength';

  try {
    const db = getDatabase();

    const existing = await db.getFirstAsync<CustomExerciseRow>(
      `SELECT *
       FROM custom_exercises
       WHERE user_id = ? AND LOWER(name) = LOWER(?)
       LIMIT 1`,
      [userId, normalizedName],
    );
    if (existing) {
      return mapRowToCustomExercise(existing);
    }

    const now = new Date().toISOString();
    const baseId = `custom_${input.bodyRegion}_${input.muscleGroup}_${input.movementType}_${slugifyName(normalizedName)}`;
    let exerciseId = baseId;
    let suffix = 2;

    while (true) {
      const taken = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM custom_exercises WHERE user_id = ? AND id = ? LIMIT 1',
        [userId, exerciseId],
      );
      if (!taken) break;
      exerciseId = `${baseId}_${suffix}`;
      suffix += 1;
    }

    await db.runAsync(
      `INSERT INTO custom_exercises (
         id, user_id, name, body_region, muscle_group, movement_type, category, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        exerciseId,
        userId,
        normalizedName,
        input.bodyRegion,
        input.muscleGroup,
        input.movementType,
        category,
        now,
        now,
      ],
    );

    glowLogger.info('Custom exercise created', {
      user_id: userId,
      exercise_id: exerciseId,
      name: normalizedName,
    });

    return {
      id: exerciseId,
      userId,
      name: normalizedName,
      bodyRegion: input.bodyRegion,
      muscleGroup: input.muscleGroup,
      movementType: input.movementType,
      category,
      equipment: [],
      videoUrl: '',
      instructions: '',
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    glowLogger.error('Failed to create custom exercise', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      name: normalizedName,
    });
    return null;
  }
}

export async function listExercisesForUser(
  userId: string,
  builtinExercises: Exercise[],
): Promise<Exercise[]> {
  const customExercises = await listCustomExercises(userId);
  return [...builtinExercises, ...customExercises];
}
