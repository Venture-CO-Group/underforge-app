/**
 * Unified intent classifier for the chat. All routing decisions are made by a single LLM call
 * (gpt-4o-mini primary, DeepSeek fallback). Output is structured JSON (`response_format: json_object`)
 * validated with plain TypeScript checks. No regex or keyword heuristics on user text.
 */
import OpenAI from 'openai';
import { glowLogger } from './glow-logger';
import { getCurrentLanguage } from './i18n';
import { buildLanguageInstruction } from './llm-service';

const openai = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY || '',
});

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';
const deepseekApiKey = process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY || process.env.EXPO_DEEPSEEK_API_KEY || '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserIntentType =
  | 'food_log'
  | 'plan_edit'
  | 'workout'
  | 'activity_log'
  | 'general_chat';

export type ExerciseHistoryScope = 'max' | 'last' | 'all';

export interface ExerciseHistoryQuery {
  /** Free-text exercise phrase as the user said it (e.g. "deadlift", "pull-ups"). */
  exercise: string;
  /** Coarse intent of the history question; null when the model is unsure. */
  scope: ExerciseHistoryScope | null;
}

export interface UserIntentResult {
  intent: UserIntentType;
  planStep: number | null;
  needsUserData: boolean;
  /**
   * Set when the user is asking an all-time / unbounded-history question
   * about a specific exercise (e.g. "what's my max pull-up weight?",
   * "when did I last deadlift?"). The caller resolves the phrase to a
   * catalog exerciseId and attaches a dedicated history block to the
   * coach prompt.
   */
  exerciseHistoryQuery?: ExerciseHistoryQuery;
}

export const STEP_NAMES = ['training', 'nutrition', 'recovery'] as const;

export type PlanEditFollowUpType = 'confirm' | 'more_changes' | 'other';

export interface PlanEditFollowUp {
  type: PlanEditFollowUpType;
  additionalFeedback?: string;
}

const STEP_TO_INDEX: Record<string, number> = { training: 0, nutrition: 1, recovery: 2 };

const VALID_INTENTS = new Set<UserIntentType>([
  'food_log', 'plan_edit', 'workout', 'activity_log', 'general_chat',
]);

// Map any legacy workout intent labels the model might still emit onto the unified 'workout' intent.
const LEGACY_INTENT_ALIASES: Record<string, UserIntentType> = {
  workout_log: 'workout',
  workout_propose: 'workout',
};

// ---------------------------------------------------------------------------
// DeepSeek fallback helper (OpenAI-compatible API)
// ---------------------------------------------------------------------------

interface DeepSeekResponse {
  choices: Array<{ message: { content: string } }>;
}

async function callDeepSeek(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<string> {
  if (!deepseekApiKey) throw new Error('DeepSeek API key not configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  const res = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} ${errorText}`);
  }

  const data: DeepSeekResponse = await res.json();
  return (data.choices[0]?.message?.content || '').trim();
}

// ---------------------------------------------------------------------------
// Generic LLM call: gpt-4o -> DeepSeek fallback
// ---------------------------------------------------------------------------

async function classifyWithFallback(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  label: string,
): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    return (response.choices[0]?.message?.content || '').trim();
  } catch (primaryError) {
    glowLogger.warn(`${label}: primary model (gpt-4o) failed, trying DeepSeek`, {
      error: primaryError instanceof Error ? primaryError.message : String(primaryError),
    });

    try {
      return await callDeepSeek(systemPrompt, userPrompt, maxTokens);
    } catch (fallbackError) {
      glowLogger.error(`${label}: DeepSeek fallback also failed`, {
        primary_error: primaryError instanceof Error ? primaryError.message : String(primaryError),
        fallback_error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
      throw fallbackError;
    }
  }
}

// ---------------------------------------------------------------------------
// JSON validators
// ---------------------------------------------------------------------------

function mapIntentJson(raw: unknown): UserIntentResult | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const intentRaw = typeof o.intent === 'string' ? o.intent.trim().toLowerCase() : null;
  const intent = intentRaw ? (LEGACY_INTENT_ALIASES[intentRaw] ?? intentRaw) : null;
  if (!intent || !VALID_INTENTS.has(intent as UserIntentType)) return null;

  let planStep: number | null = null;
  if (intent === 'plan_edit') {
    const step = o.plan_step;
    if (typeof step === 'string') {
      const norm = step.trim().toLowerCase();
      planStep = STEP_TO_INDEX[norm] ?? null;
    }
  }

  const needsUserData = o.needs_user_data === true;

  let exerciseHistoryQuery: ExerciseHistoryQuery | undefined;
  const ehqRaw = o.exercise_history_query;
  if (ehqRaw && typeof ehqRaw === 'object' && !Array.isArray(ehqRaw)) {
    const ehq = ehqRaw as Record<string, unknown>;
    const exerciseRaw = typeof ehq.exercise === 'string' ? ehq.exercise.trim() : '';
    if (exerciseRaw.length > 0) {
      let scope: ExerciseHistoryScope | null = null;
      if (typeof ehq.scope === 'string') {
        const norm = ehq.scope.trim().toLowerCase();
        if (norm === 'max' || norm === 'last' || norm === 'all') scope = norm;
      }
      exerciseHistoryQuery = { exercise: exerciseRaw, scope };
    }
  }

  return { intent: intent as UserIntentType, planStep, needsUserData, exerciseHistoryQuery };
}

function mapFollowUpJson(raw: unknown, userMessage: string): PlanEditFollowUp | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const v = o.follow_up;
  if (typeof v !== 'string') return null;
  const n = v.trim().toLowerCase();
  if (n === 'confirm') return { type: 'confirm' };
  if (n === 'more_changes') return { type: 'more_changes', additionalFeedback: userMessage };
  if (n === 'other') return { type: 'other' };
  return null;
}

// ---------------------------------------------------------------------------
// classifyUserIntent
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = 'You classify user messages for a fitness coaching app. Reply with valid JSON only, matching the schema described in the user message.';

export const classifyUserIntent = async (
  userMessage: string,
  chatHistory?: string[],
): Promise<UserIntentResult> => {
  try {
    glowLogger.info('Classifying user intent', { user_message: userMessage });

    const historyContext = chatHistory?.length
      ? `\nRecent conversation for context:\n${chatHistory.slice(-10).join('\n')}\n`
      : '';

    const userPrompt = `Classify this user message into exactly ONE intent category.
${historyContext}
CATEGORIES:

"food_log" — The user is reporting food they just ate/consumed (logging a meal).
Examples:
- "log a burger"
- "i just had a porridge"
- "ate chicken salad"
- "had a burger and fries"
- "just finished breakfast"
- "consumed a smoothie"
- "cesar salad without dressing"
- "protein bar of 45g"
- "banana"
- "coffee with milk"
- "chicken breast 200g"
NOT food_log:
- "what should I eat for breakfast?" (question)
- "how many calories in an apple?" (question)
- "banana or orange?" (comparison question)

"plan_edit" — The user wants to MODIFY their ongoing fitness plan/routine (training, nutrition, or recovery pillar). Requires a clear directive to change the plan, not a one-off request.
Examples:
- "add hiit workouts to all workout days" → training
- "add abs to every session" → training
- "switch to a push/pull/legs split" → training
- "remove leg day from my plan" → training
- "I want to train 5 days a week instead" → training
- "I want to change my workout routine" → training
- "add a concrete diet to my plan" → nutrition
- "add a pescatarian day to my diet" → nutrition
- "make my nutrition plan all vegan" → nutrition
- "include fasting in my plan" → nutrition
- "change my meals to high protein" → nutrition
- "add yoga to my recovery plan" → recovery
- "change my rest days" → recovery
- "update my sleep routine" → recovery
- "edit my plan" → plan_step null (ambiguous pillar)
- "add to plan" (after discussing a nutrition topic) → nutrition
- "add it" / "yes, change that" (after discussing a plan change) → infer from context
NOT plan_edit:
- "meditation is great for recovery" (opinion)
- "should I do more cardio?" (question)
- "I like strength training" (preference, no directive)

"workout" — Anything about ONE training session shown as a structured workout card. This covers THREE cases, all the same intent:
  (a) LOGGING a session the user already did (e.g. "I did 3x8 pull ups and 3x8 chin ups", "log this training: ...", "completed my pull day").
  (b) DESIGNING a new session the user asks you to create (e.g. "design a quick leg workout", "create a full body workout with dumbbells").
  (c) MODIFYING / correcting / adding to the most recent workout card in the conversation (e.g. "also add 3x8 normal push ups", "no, the pull ups were 3x10", "swap bench press for dumbbell press", "make it harder"). Covers any session type: strength, HIIT, cardio circuits, sprinting, calisthenics, etc.

CRITICAL RULE: If the chat history contains a recent workout card — tagged either [workout proposal with: ...] OR [logged workout: ...] — then SHORT or VAGUE follow-up messages from the user that could relate to that workout MUST be classified as workout. This includes corrections and additions ("add normal push ups", "the rest you had earlier", "also 3x8 diamond push ups", "no, make the pull ups 3x10") AND tweaks ("more advanced", "easier", "shorter", "longer", "add abs", "less rest", "too easy"). When a workout card is in the recent context, default to workout unless the message is clearly about a completely different topic (food, sleep, general question, etc.).

Examples (logging):
- "I did jumping squats, inverse rows, declined pushups and L sits - 3 sets each"
- "just finished a push workout with bench press and overhead press"
- "did 4 sets of squats, 3 sets of lunges and 3 sets of leg press"
- "I trained chest and triceps today"
Examples (designing):
- "propose a more intense workout for both strength and cardio"
- "design an alternative workout for today's upper body but only with calisthenics"
- "can you suggest a quick leg workout I can do at home?"
- "create a full body workout with dumbbells" / "design a HIIT workout"
Examples (modifying/correcting the recent workout card):
- "swap bench press for dumbbell press" / "change jumping jacks for something else"
- "make the workout harder" / "harder" / "easier" / "too easy"
- "shorter" / "longer" / "add more exercises" / "add abs"
- "also add 3x8 normal push ups" / "please also add the rest you had earlier"
- "no, the pull ups were 3x10" / "the wide push ups should be 3 sets"
- "update the rest to 60s for all exercises" / "only bodyweight"
NEVER workout (the word "propose"/"design" alone does NOT mean workout — check the topic):
- ANY request about meals, meal plan, weekly eating, diet, nutrition, recipes, macros, grocery list, what to eat — use general_chat (coach answers in chat) or plan_edit if they clearly want their saved nutrition plan changed.
- "propose a weekly meal plan" / "suggest meals for this week" / "give me a 7-day diet" → general_chat
NOT workout (these are plan edits — they change the ongoing program, not a single session):
- "change my training plan"
- "add more exercises to my plan"
- "change my training days"

"activity_log" — The user is describing a NON-EXERCISE activity they did (cardio, sport, etc.)
Examples:
- "I went for a 5k run"
- "just finished 45 min of cycling"
- "played tennis for an hour"
- "did a 30 minute yoga session"
- "went skiing today"
- "swam 1500m this morning"
- "hiked for 2 hours"
- "did some sprints"
- "sprinted 400m intervals"
- "did 10 x 100m sprints"

"general_chat" — Questions, advice, opinions, greetings, conversation — including meal planning, diet ideas, and nutrition coaching in chat (no structured workout card). IMPORTANT: Do NOT classify a message as general_chat if the recent history contains a workout card ([workout proposal] or [logged workout]) and the user's message could plausibly be a correction, addition, or modification request for that workout (e.g., "add normal push ups", "the rest you had earlier", "more advanced", "harder", "easier", "shorter"). Those go to workout.
Examples:
- "how much protein should I eat?"
- "what's a good bedtime routine?"
- "I feel tired today"
- "tell me about HIIT"
- "hi"
- "what are the benefits of fasting?"
- "propose a weekly meal plan" / "meal plan for the week" / "what should I eat this week?"
- "suggest healthy dinners" / "ideas for high-protein breakfasts"

User message: "${userMessage}"

Respond with a JSON object exactly in this shape (no other keys):
{
  "intent": "food_log" | "plan_edit" | "workout" | "activity_log" | "general_chat",
  "plan_step": "training" | "nutrition" | "recovery" | null,
  "needs_user_data": true | false,
  "exercise_history_query": { "exercise": "<phrase>", "scope": "max" | "last" | "all" | null } | null
}

Rules:
- Pick EXACTLY ONE intent.
- Set plan_step only when intent is "plan_edit". Use null for all other intents.
- If intent is "plan_edit" but the pillar is ambiguous, use null for plan_step.

exercise_history_query rules:
- Set this when the user asks an unbounded-history / all-time question about a SPECIFIC strength or gym exercise (e.g. "what's my max pull-up weight?", "when did I last deadlift?", "have I ever bench pressed 80kg?", "PR for squats?", "show me my pull-up history").
- "exercise" must be the exercise phrase as the user referred to it (e.g. "pull-up", "deadlift", "bench press"). Keep it short and singular when natural.
- "scope":
  - "max" for questions about maximum / peak / personal record / heaviest.
  - "last" for "when did I last ...", "most recent", "last time".
  - "all" for broader "show my history / progression" questions.
  - null if the scope isn't clear.
- Set to null whenever the question is generic ("how am I doing on training?", "did I work out this week?"), or about non-strength activities, meals, etc. The always-on awareness block already handles those.
- This field is independent of "intent" — it can be populated alongside "general_chat".

needs_user_data rules:
- Default to TRUE for anything the coach should answer in a personalized way for THIS user.
- Set to TRUE whenever the message touches on what the user eats, drinks, trains, sleeps, weighs, or how they're progressing — even if the user doesn't explicitly ask "for me". A live always-on awareness block already gives the coach today's nutrition + 7-day averages, but TRUE here also attaches richer per-meal/per-workout detail.
- Set to TRUE for any question about adding/removing/swapping a specific food, supplement, exercise, or habit (because the answer should be grounded in what they already do).
- Set to FALSE only for: pure greetings/thanks, abstract definitions of generic concepts that don't depend on the user's behavior, and meta questions about the app itself.

needs_user_data examples (true):
- "what am I missing today to reach my goals" / "how am I doing?" / "am I on track?"
- "am I eating enough protein?" / "how many calories have I had today?"
- "give me feedback on my consistency" / "how has my training progressed?"
- "what workouts did I do last week?"
- "make recommendations about my nutrition" / "nutrition advice for me"
- "feedback on my workouts" / "am I training enough"
- "should I add eggs to my breakfast?" / "is it ok if I add a protein shake?"
- "should I take creatine?" / "should I take biotin?" (supplements asked in context of the user's diet/goals)
- "are there foods I should add to hit my protein target?"
- "what should I eat for breakfast tomorrow?" / "give me high-protein dinner ideas"
- "log again yesterday's breakfast" / "log my workout from last Thursday"

needs_user_data examples (false):
- "hi" / "thanks" / "ok"
- "how does this app work?" / "what does the home screen show?"
- "what is creatine?" / "what does biotin do?" (purely definitional, no recommendation)
- "what's the science behind HIIT?" (abstract, not about them)`;

    const rawContent = await classifyWithFallback(SYSTEM_PROMPT, userPrompt, 120, 'classifyUserIntent');

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent) as unknown;
    } catch {
      glowLogger.warn('Intent classifier returned non-JSON', { raw_classifier: rawContent });
      return { intent: 'general_chat', planStep: null, needsUserData: false };
    }

    const mapped = mapIntentJson(parsed);
    if (!mapped) {
      glowLogger.warn('Intent classifier JSON failed validation', { raw_classifier: rawContent });
      return { intent: 'general_chat', planStep: null, needsUserData: false };
    }

    glowLogger.info('User intent classified', {
      user_message: userMessage,
      intent: mapped.intent,
      plan_step: mapped.planStep ?? 'n/a',
      needs_user_data: mapped.needsUserData,
      exercise_history_query: mapped.exerciseHistoryQuery ?? 'none',
      raw_classifier: rawContent,
    });

    return mapped;
  } catch (error) {
    glowLogger.error('Error classifying user intent', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { intent: 'general_chat', planStep: null, needsUserData: false };
  }
};

// ---------------------------------------------------------------------------
// classifyPlanEditFollowUp
// ---------------------------------------------------------------------------

export const classifyPlanEditFollowUp = async (
  userMessage: string,
  pendingChanges: string[],
): Promise<PlanEditFollowUp> => {
  try {
    const userPrompt = `The user was asked to confirm these plan changes: "${pendingChanges.join('; ')}"

They responded: "${userMessage}"

Classify their response:
- "confirm" — they agree/confirm (e.g. "yes", "ok", "sure", "go ahead", "do it", "sounds good", "let's do it")
- "more_changes" — they want to add or modify the changes (e.g. "also add X", "but make it Y instead", "and include Z")
- "other" — something else, declining, or changing topic

Respond with a JSON object exactly in this shape (no other keys):
{ "follow_up": "confirm" | "more_changes" | "other" }`;

    const rawContent = await classifyWithFallback(SYSTEM_PROMPT, userPrompt, 80, 'classifyPlanEditFollowUp');

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent) as unknown;
    } catch {
      glowLogger.warn('Plan edit follow-up classifier returned non-JSON', { raw_classifier: rawContent });
      return { type: 'other' };
    }

    const mapped = mapFollowUpJson(parsed, userMessage);
    if (!mapped) {
      glowLogger.warn('Plan edit follow-up JSON failed validation', { raw_classifier: rawContent });
      return { type: 'other' };
    }

    return mapped;
  } catch (error) {
    glowLogger.error('Error classifying plan edit follow-up', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { type: 'other' };
  }
};

// ---------------------------------------------------------------------------
// resolveContextualPlanEditRequest
// ---------------------------------------------------------------------------
// Resolves vague / anaphoric user requests ("add those guidelines", "yes, change
// that") into a concrete, self-contained description using conversation context.

export const resolveContextualPlanEditRequest = async (
  userMessage: string,
  chatHistory?: string[],
  userContext?: string,
): Promise<string> => {
  if (!chatHistory?.length && !userContext) return userMessage;

  try {
    const historyBlock = chatHistory?.length ? chatHistory.slice(-10).join('\n') : '';
    const contextBlock = userContext ? `\nUser's current plan and activity data:\n${userContext}\n` : '';

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_completion_tokens: 150,
      messages: [
        {
          role: 'system',
          content: `You resolve vague or context-dependent plan-change requests into a clear, self-contained description.

${buildLanguageInstruction()}

The user is chatting with a fitness coach. Their latest message asks to change their plan, but it may use pronouns or references ("those", "that", "it", "the ones you mentioned") that only make sense with the preceding conversation or the user's data.

Your job: output a SINGLE concise sentence that captures EXACTLY what the user wants changed, replacing all vague references with the concrete details from the conversation or data. If the user's message is already specific and self-contained, return it unchanged.

Rules:
- Output ONLY the resolved request, nothing else
- Keep it concise (one sentence)
- Output in the selected app language from the language instruction above.
- Preserve the user's original intent precisely — do not add, infer, or embellish beyond what was discussed
- If you cannot determine what the user is referring to, return the original message unchanged`,
        },
        {
          role: 'user',
          content: `${historyBlock ? `Conversation:\n${historyBlock}\n` : ''}${contextBlock}\nUser's plan-change request: "${userMessage}"`,
        },
      ],
    });

    const resolved = (response.choices[0]?.message?.content || '').trim();
    if (!resolved) return userMessage;

    glowLogger.info('Resolved contextual plan edit request', {
      original: userMessage,
      resolved,
    });

    return resolved;
  } catch (error) {
    glowLogger.warn('Failed to resolve contextual plan edit, using original message', {
      error: error instanceof Error ? error.message : String(error),
    });
    return userMessage;
  }
};

// ---------------------------------------------------------------------------
// generatePlanEditConfirmation (copy generation, not classification)
// ---------------------------------------------------------------------------

export const generatePlanEditConfirmation = async (
  changes: string[],
  stepName: string | null,
): Promise<string> => {
  try {
    const changesText = changes.join('; ');
    const planLabel = stepName || 'fitness';
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_completion_tokens: 80,
      messages: [
        {
          role: 'system',
          content: `${buildLanguageInstruction()}

You restate a user's requested plan changes as a clear, specific proposal. Output a SINGLE sentence following this exact pattern:

"I'll propose [concrete description of the changes] to your ${planLabel} plan. Do you want me to proceed?"

Rules:
- Translate/localize the whole sentence into the selected app language from the language instruction above.
- Be specific about WHAT will change (e.g. "adding ab exercises to every session" not "adding abs work going forward")
- End with the localized equivalent of "Do you want me to proceed?"
- One sentence only, no emojis, no extra commentary`,
        },
        {
          role: 'user',
          content: `User wants: "${changesText}"`,
        },
      ],
    });

    return (response.choices[0]?.message?.content || '').trim();
  } catch (error) {
    glowLogger.error('Error generating plan edit confirmation', {
      error: error instanceof Error ? error.message : String(error),
    });
    const planLabel = stepName || 'fitness';
    if (getCurrentLanguage().toLowerCase().startsWith('es')) {
      return `Propondré estos cambios en tu plan de ${planLabel}. ¿Quieres que continúe?`;
    }
    return `I'll propose these changes to your ${planLabel} plan. Do you want me to proceed?`;
  }
};
