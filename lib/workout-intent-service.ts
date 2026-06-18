import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Onboard, onboardToLLMString } from '../types/onboard';
import { PlannedExercise, WorkoutDayOption } from '../types/workout';
import { resolveAndHarmonizeExercises } from './exercise-harmonization';
import { getExerciseListForPrompt } from './exercise-list';
import { glowLogger } from './glow-logger';
import { buildLanguageInstruction } from './llm-service';

const openai = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY || '',
});

const anthropic = new Anthropic({
  apiKey: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '',
});

const MAX_RETRIES = 2;

/** Whether the user transcribed a completed workout ('logged') or asked the AI to design one ('proposed'). */
export type WorkoutResponseMode = 'logged' | 'proposed';

export interface WorkoutResponse {
  /**
   * Conversational coach text. For 'logged' mode the caller may prefer a fixed,
   * pre-translated template (the workout is not saved until the user taps the button).
   */
  text: string;
  workout: WorkoutDayOption;
  mode: WorkoutResponseMode;
  /**
   * True when the user was correcting / adding to / changing the most recent workout
   * in the conversation rather than describing a brand-new, separate workout.
   */
  isModification: boolean;
}

export interface WorkoutConversationEntry {
  role: 'user' | 'coach';
  text: string;
  workout?: WorkoutDayOption;
  /** For coach entries carrying a workout: whether that card was a logged transcription or an AI proposal. */
  mode?: WorkoutResponseMode;
}

interface ParsedWorkoutResponse {
  mode?: string;
  isModification?: boolean;
  text?: string;
  workout: {
    dayName: string;
    dayType?: string;
    exercises: {
      exerciseId?: string | null;
      name: string;
      sets: number;
      reps: string;
      restTimeSeconds?: number;
      rir?: number;
      notes?: string;
    }[];
    warmup?: string;
    cooldown?: string;
  };
}

interface ParsedActivity {
  activityType: string;
  activityName: string;
  durationMinutes?: number;
  intensity?: 'easy' | 'moderate' | 'hard' | 'max';
  distanceValue?: number;
  distanceUnit?: 'km' | 'mi';
  notes?: string;
}

/**
 * Single unified handler for any workout message in chat. Replaces the old split between
 * parseWorkoutFromDescription (logging) and generateWorkoutProposal (proposing) — they
 * produced the same kind of card and the split caused corrections to a logged workout to
 * be treated as brand-new workouts.
 *
 * The LLM decides, from the message + recent workout conversation:
 *  - mode: 'logged' (transcribe exactly what the user did) vs 'proposed' (design a workout)
 *  - isModification: whether to merge changes into the most recent workout vs start fresh
 *
 * On a modification it returns the FULL updated workout (merged), not just the delta.
 */
export const generateWorkoutResponse = async (
  userMessage: string,
  context: Onboard,
  recentWorkoutConversation?: WorkoutConversationEntry[],
): Promise<WorkoutResponse> => {
  const hasHistory = recentWorkoutConversation && recentWorkoutConversation.length > 0;

  glowLogger.info('Handling workout message', {
    user_message: userMessage,
    has_history: hasHistory,
    history_entries: recentWorkoutConversation?.length ?? 0,
  });

  const userContext = onboardToLLMString(context);
  const exerciseRef = getExerciseListForPrompt();

  const serializeWorkout = (w: WorkoutDayOption) => JSON.stringify({
    dayName: w.dayName,
    dayType: w.dayType,
    exercises: w.exercises.map(e => ({ name: e.name, exerciseId: e.exerciseId, sets: e.sets, reps: e.reps, restTimeSeconds: e.restTimeSeconds, rir: e.rir, notes: e.notes })),
    warmup: w.warmup,
    cooldown: w.cooldown,
  }, null, 2);

  let conversationSection = '';
  if (hasHistory) {
    const lines = recentWorkoutConversation!.map(entry => {
      if (entry.role === 'user') {
        return `User: "${entry.text}"`;
      }
      const tag = entry.mode ? ` [${entry.mode}]` : '';
      const workoutJson = entry.workout ? `\nWorkout${tag}:\n${serializeWorkout(entry.workout)}` : '';
      return `Coach: ${entry.text}${workoutJson}`;
    });
    conversationSection = `
WORKOUT CONVERSATION HISTORY (the LAST workout below is the "most recent workout" the user may be correcting or adding to):
${lines.join('\n\n')}
`;
  }

  const prompt = `${buildLanguageInstruction()}

You are a fitness coach handling a single workout in chat. Read the user's message and the recent workout conversation, then do THREE things: decide the mode, decide whether it's a modification, and produce the workout JSON.

USER CONTEXT:
${userContext}

USER MESSAGE: "${userMessage}"
${conversationSection}
${exerciseRef}

STEP 1 — Decide "mode":
- "logged": the user is reporting/transcribing a workout they ALREADY DID (e.g. "I did 3x8 pull ups and 3x8 chin ups", "just finished push day", "log this training: ..."). You must transcribe EXACTLY what they describe.
- "proposed": the user is asking you to DESIGN, suggest, or create a workout (e.g. "give me a push day", "design a quick leg workout", "make it harder").
- If the user is correcting or adding to a workout already in the conversation history, KEEP THE SAME mode as that most recent workout (see the [logged] / [proposed] annotation on it).

STEP 2 — Decide "isModification":
- true if the user is correcting, adding to, removing from, or otherwise changing the MOST RECENT workout in the conversation history (e.g. "also add 3x8 normal push ups", "no, the pull ups were 3x10", "swap chin ups for rows", "make it harder", "add the rest you had earlier").
- false if the user is describing or asking for a brand-new, separate workout.

STEP 3 — Produce JSON in exactly this shape (no other keys):
{
  "mode": "logged" | "proposed",
  "isModification": true | false,
  "text": "conversational coach text (see per-mode rules below)",
  "workout": {
    "dayName": "Short descriptive name (e.g. 'Upper Body', 'Push Day', 'HIIT Cardio')",
    "dayType": "strength|hypertrophy|cardio|mixed|flexibility|custom",
    "exercises": [
      { "exerciseId": "matching ID from AVAILABLE EXERCISES, or null", "name": "Exercise Name", "sets": 3, "reps": "10", "restTimeSeconds": 60, "rir": 3, "notes": "" }
    ],
    "warmup": "",
    "cooldown": ""
  }
}

GENERAL RULES:
- STRONGLY prefer exercises from the AVAILABLE EXERCISES list above; return their exerciseId. Use null only when nothing in the list is a reasonable match.
- Use the human-readable form for "name" (e.g. "Pull-up", "Barbell Bench Press") regardless of whether exerciseId matched.
- "reps" MUST be a single integer as a string (e.g. "10", "8"). NEVER a range like "8-12". For exercises annotated "(seconds)" in the list (isometric holds, steady-state cardio), "reps" is a duration in seconds like "30", "60".
- User-visible labels and text (dayName, names, notes, text) follow the language instruction above. Keep exerciseId values, JSON keys, and enum values unchanged.

WHEN mode = "logged" (transcription — accuracy is CRITICAL):
- Transcribe EXACTLY what the user described. Each distinct exercise the user names is its OWN separate entry. NEVER merge two different exercises into one, and NEVER drop an exercise the user listed. If the user lists 5 exercises, return exactly 5 entries, in the order given.
- Do NOT invent exercises, warmup, cooldown, or rir the user did not mention. Leave "warmup" and "cooldown" as empty strings and omit "rir" unless the user stated it.
- If sets aren't specified, default to 3. If reps aren't specified, estimate a sensible number (10 strength, 15 endurance).
- "text": a brief confirmation (1 short sentence). Do NOT claim the workout is saved or logged — the user still has to tap a button.

WHEN mode = "proposed" (design):
- Build a complete, well-structured workout (typically 4-8 exercises) primarily from the AVAILABLE EXERCISES, fitting the user's level, goals, and equipment from USER CONTEXT.
- ALWAYS include "restTimeSeconds" and "rir" for every exercise, and include "warmup" and "cooldown".
- "text": a friendly 2-3 sentence explanation of the workout and why it fits. Do NOT mention logging — the user sees a log button automatically.

WHEN isModification = true (either mode):
- Apply ONLY the change the user requested to the MOST RECENT workout in the history. Keep every other exercise, set, rep, rest time, and the ordering exactly the same unless the user explicitly asked to change them. Return the FULL updated workout (all exercises, merged), not just the delta. Briefly mention what changed in "text".

Only respond with valid JSON, nothing else.`;

  const buildResult = async (parsed: ParsedWorkoutResponse): Promise<WorkoutResponse> => {
    const mode: WorkoutResponseMode = parsed.mode === 'proposed' ? 'proposed' : 'logged';
    const isModification = parsed.isModification === true;
    const harmonized = (await resolveAndHarmonizeExercises(parsed.workout.exercises)) as PlannedExercise[];
    const warmup = parsed.workout.warmup?.trim() ? parsed.workout.warmup : undefined;
    const cooldown = parsed.workout.cooldown?.trim() ? parsed.workout.cooldown : undefined;
    return {
      text: parsed.text || '',
      mode,
      isModification,
      workout: {
        stepId: `${mode === 'proposed' ? 'proposed' : 'custom'}_chat_${Date.now()}`,
        dayName: parsed.workout.dayName,
        dayType: parsed.workout.dayType || (mode === 'proposed' ? 'mixed' : 'custom'),
        exercises: harmonized,
        warmup: mode === 'proposed' ? warmup : undefined,
        cooldown: mode === 'proposed' ? cooldown : undefined,
      },
    };
  };

  let lastError: any;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_completion_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are an expert fitness coach. Always respond with valid JSON only.' },
          { role: 'user', content: prompt },
        ],
      });

      const content = response.choices[0]?.message?.content || '';
      const parsed: ParsedWorkoutResponse = JSON.parse(content);
      glowLogger.info('Workout message handled (GPT)', {
        mode: parsed.mode,
        is_modification: parsed.isModification,
        day_name: parsed.workout.dayName,
        exercise_count: parsed.workout.exercises.length,
      });
      return await buildResult(parsed);
    } catch (error) {
      lastError = error;
      glowLogger.warn('GPT workout handling attempt failed', {
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Fallback to Claude
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');
    const jsonStr = content.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed: ParsedWorkoutResponse = JSON.parse(jsonStr);
    glowLogger.info('Workout message handled (Claude fallback)', {
      mode: parsed.mode,
      is_modification: parsed.isModification,
      day_name: parsed.workout.dayName,
      exercise_count: parsed.workout.exercises.length,
    });
    return await buildResult(parsed);
  } catch (anthropicError) {
    glowLogger.error('All providers failed for workout handling', {
      gpt_error: lastError instanceof Error ? lastError.message : String(lastError),
      anthropic_error: anthropicError instanceof Error ? anthropicError.message : String(anthropicError),
    });
    throw new Error('Unable to process workout. Please try again.');
  }
};

/**
 * Parse a user's activity description into structured data.
 * Used when intent is 'activity' — running, cycling, etc.
 */
export const parseActivityFromDescription = async (
  userMessage: string,
  chatHistory?: string[],
): Promise<ParsedActivity> => {
  glowLogger.info('Parsing activity from description', {
    user_message: userMessage,
    chat_history_length: chatHistory?.length || 0,
  });

  const chatHistorySection = chatHistory && chatHistory.length > 0
    ? `\nRecent chat history for context (use this to resolve short references like "log that" — the activity to log is the one most recently discussed with the user):\n${chatHistory.join('\n')}\n`
    : '';

  const prompt = `${buildLanguageInstruction()}

Parse this activity description into structured data. The user is describing a physical activity they completed (not a gym workout with exercises).

User message: "${userMessage}"
${chatHistorySection}

Return a JSON object with:
{
  "activityType": "The activity type ID from this list: run, trail_run, sprint, treadmill, walk, hike, rucking, road_cycling, mountain_biking, gravel_cycling, indoor_cycling, stationary_bike, pool_swim, open_water_swim, downhill_skiing, cross_country_skiing, snowboarding, ice_skating, snowshoeing, tennis, padel, badminton, squash, pickleball, table_tennis, soccer, basketball, football, volleyball, baseball, rugby, hockey, lacrosse, cricket, handball, softball, water_polo, rowing, kayaking, canoeing, paddleboarding, surfing, windsurfing, kitesurfing, sailing, boxing, kickboxing, mma, judo, jiu_jitsu, wrestling, karate, taekwondo, muay_thai, fencing, yoga, pilates, tai_chi, stretching, elliptical, stair_climber, rowing_machine, jump_rope, hiit_class, dance, aerobics, climbing, bouldering, horseback_riding, golf, skateboarding, roller_skating, parkour, custom",
  "activityName": "Human-readable activity name (e.g. 'Running', 'Road Cycling')",
  "durationMinutes": 30,
  "intensity": "easy|moderate|hard|max",
  "distanceValue": 5.0,
  "distanceUnit": "km|mi",
  "notes": "any additional context from the message"
}

Rules:
- User-visible text such as activityName and notes should follow the selected app language from the language instruction above. Keep activityType, intensity, distanceUnit, and JSON keys unchanged.
- Match to the closest activityType from the list
- If duration is mentioned, extract it; otherwise omit the field
- If distance is mentioned, extract it with appropriate unit
- If intensity is implied by words like "easy", "hard", "intense", map accordingly
- Only include fields that can be reasonably inferred from the message

Only respond with valid JSON, nothing else.`;

  let lastError: any;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_completion_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a fitness tracking assistant. Always respond with valid JSON only.' },
          { role: 'user', content: prompt },
        ],
      });

      const content = response.choices[0]?.message?.content || '';
      const parsed: ParsedActivity = JSON.parse(content);
      glowLogger.info('Activity parsed from description (GPT)', {
        activity_type: parsed.activityType,
        activity_name: parsed.activityName,
      });
      return parsed;
    } catch (error) {
      lastError = error;
      glowLogger.warn('GPT activity parse attempt failed', {
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');
    const jsonStr = content.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed: ParsedActivity = JSON.parse(jsonStr);
    glowLogger.info('Activity parsed from description (Claude fallback)', {
      activity_type: parsed.activityType,
      activity_name: parsed.activityName,
    });
    return parsed;
  } catch (anthropicError) {
    glowLogger.error('All providers failed for activity parsing', {
      gpt_error: lastError instanceof Error ? lastError.message : String(lastError),
      anthropic_error: anthropicError instanceof Error ? anthropicError.message : String(anthropicError),
    });
    throw new Error('Unable to parse activity description. Please try again.');
  }
};
