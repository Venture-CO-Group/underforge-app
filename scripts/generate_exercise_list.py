#!/usr/bin/env python3
"""
Generate exercise-list.ts from exercises.json for use in LLM prompts
"""

import json
import os

# Path to exercises.json
EXERCISES_PATH = os.path.join(os.path.dirname(__file__), '..', 'assets', 'exercises', 'exercises.json')
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'lib', 'exercise-list.ts')

with open(EXERCISES_PATH, 'r') as f:
    data = json.load(f)

exercises = data['exercises']

# Generate exercise IDs list
all_ids = [ex['id'] for ex in exercises]
ids_formatted = ',\n  '.join([f"'{id}'" for id in sorted(all_ids)])

# Exercises measured in seconds (isometrics + steady-state endurance)
seconds_ids = sorted([ex['id'] for ex in exercises if ex.get('loggingUnit') == 'seconds'])
seconds_ids_formatted = ', '.join([f"'{id}'" for id in seconds_ids])

# Group by muscle
by_muscle = {}
for ex in exercises:
    muscle = ex['muscleGroup']
    if muscle not in by_muscle:
        by_muscle[muscle] = []
    by_muscle[muscle].append(ex['id'])

muscle_groups_formatted = '{\n'
for muscle in sorted(by_muscle.keys()):
    ids_list = ', '.join([f"'{id}'" for id in sorted(by_muscle[muscle])])
    muscle_groups_formatted += f"  '{muscle}': [{ids_list}],\n"
muscle_groups_formatted += '}'

# Generate TypeScript content
ts_content = f'''/**
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated from assets/exercises/exercises.json
 * Run: python3 scripts/generate_exercise_list.py to regenerate
 */

/**
 * Complete list of all available exercise IDs for use in LLM prompts
 * Total: {len(exercises)} exercises
 */
export const AVAILABLE_EXERCISE_IDS = [
  {ids_formatted}
] as const;

/**
 * Exercise IDs grouped by muscle group for structured recommendations
 */
export const EXERCISES_BY_MUSCLE_GROUP = {muscle_groups_formatted} as const;

/**
 * Exercise IDs whose middle log column is measured in seconds (isometrics and
 * steady-state endurance) rather than reps. All other catalog ids are reps.
 */
export const SECONDS_EXERCISE_IDS = new Set<string>([{seconds_ids_formatted}]);

/**
 * Helper to get all exercise IDs as a comma-separated string for LLM prompts
 */
export function getExerciseIdsForPrompt(): string {{
  return AVAILABLE_EXERCISE_IDS.join(', ');
}}

/**
 * Helper to get exercise list formatted for LLM workout planning.
 * Exercises whose "reps" value should be expressed in seconds (holds and cardio)
 * are annotated inline so the planner emits a duration instead of a rep count.
 */
export function getExerciseListForPrompt(): string {{
  let result = 'AVAILABLE EXERCISES:\\n';
  for (const [muscle, ids] of Object.entries(EXERCISES_BY_MUSCLE_GROUP)) {{
    result += `\\n${{muscle.toUpperCase()}}:\\n`;
    ids.forEach((id: string) => {{
      const unit = SECONDS_EXERCISE_IDS.has(id) ? ' (seconds)' : '';
      result += `  - ${{id}}${{unit}}\\n`;
    }});
  }}
  return result;
}}
'''

# Write to file
with open(OUTPUT_PATH, 'w') as f:
    f.write(ts_content)

print(f'✅ Generated {OUTPUT_PATH}')
print(f'   Total exercises: {len(exercises)}')
print(f'   Muscle groups: {len(by_muscle)}')
