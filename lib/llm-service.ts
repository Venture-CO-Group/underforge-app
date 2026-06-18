import Anthropic from '@anthropic-ai/sdk';
import * as FileSystem from 'expo-file-system/legacy';
import { z } from 'zod';
import { copyOnboardWithoutActionPlan, Onboard, onboardToLLMString } from '../types/onboard';
import { getRecentConversations } from './conversation-storage';
import { fetchUserAwarenessSummary } from './user-awareness-summary';
import { harmonizeActionPlanResponse } from './exercise-harmonization';
import { DEFAULT_BODYWEIGHT_KG } from './workout-energy';
import { getExerciseIdsForPrompt, getExerciseListForPrompt } from './exercise-list';
import { glowLogger } from './glow-logger';
import { getCurrentLanguage } from './i18n';
import {
  estimateOccupationNeatKcal,
  getOccupationMultiplier,
} from './calories-balance-math';
import {
  computeBaselineMovement,
  type BaselineMovement,
} from './baseline-movement';

export { estimateOccupationNeatKcal, getOccupationMultiplier } from './calories-balance-math';

// DeepSeek API configuration (OpenAI-compatible)
interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DeepSeekResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// Configuration constants - max tokens for Claude Sonnet 4 is 8192
const LLM_CONFIG = {
  model: 'claude-sonnet-4-20250514',
  temperature: 0.7,
  maxTokens: { 
    chat: 400,
    questions: 1000,
    actionPlan: 8192,
    actionPlanStep: 8192,
    dedupe_questions: 8192,
  }
} as const;

// DeepSeek configuration
const DEEPSEEK_CONFIG = {
  model: 'deepseek-chat',
  apiUrl: 'https://api.deepseek.com/v1/chat/completions',
  temperature: 0.7,
} as const;

// Control whether to log prompts to files
const LOG_PROMPTS_TO_FILES = false;

// Control artificial fault injection for testing (50% probability)
const INJECT_ARTIFICIAL_FAULTS_50_PERCENT = false;

// Timeout for plan generation calls (in seconds)
const GENERATE_PLAN_TIMEOUT_SECS = 120;

// Retry configuration for API calls
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000; // Start with 1 second
const MAX_RETRY_DELAY_MS = 10000; // Max 10 seconds between retries

// Replace USER_NAME placeholder in a plain text response with the real name
function substituteUserName(text: string, realName: string): string {
  return text.replace(/USER_NAME/g, realName);
}

// Recursively replace USER_NAME in any structured (JSON) response object
function substituteUserNameInObject<T>(obj: T, realName: string): T {
  if (typeof obj === 'string') {
    return (obj as string).replace(/USER_NAME/g, realName) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => substituteUserNameInObject(item, realName)) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = substituteUserNameInObject(value, realName);
    }
    return result as unknown as T;
  }
  return obj;
}

// Schema for clarifying questions response
const ClarifyingQuestionsSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    question: z.string(),
    context: z.string().optional(),
  }))
});

// Schema for question deduplication response - simplified to just return deduplicated question texts
const QuestionDeduplicationSchema = z.object({
  deduplicated_questions: z.array(z.object({
    question_key: z.string(),
    question_text: z.string()
  }))
});

type ClarifyingQuestions = z.infer<typeof ClarifyingQuestionsSchema>;
type QuestionDeduplicationResponse = z.infer<typeof QuestionDeduplicationSchema>;

export function buildLanguageInstruction(): string {
  try {
    const lang = getCurrentLanguage();
    if (lang && lang.toLowerCase().startsWith('es')) {
      return [
        'IMPORTANT: Always respond in Spanish. Use a clear, neutral Latin American tone unless the user explicitly requests something else.',
        'All user-visible text fields must be in Spanish, including plan titles, descriptions, rationales, workout day names, warmups, cooldowns, notes, recovery hints, and chat text. Keep internal IDs, enum values, JSON keys, units, URLs, and code-like values unchanged.',
      ].join('\n');
    }
  } catch {
    // If language detection fails, fall back to English instruction.
  }

  return [
    'IMPORTANT: Always respond in clear, simple English that is easy to understand unless the user explicitly asks for another language.',
    'All user-visible text fields must use that same response language. Keep internal IDs, enum values, JSON keys, units, URLs, and code-like values unchanged.',
  ].join('\n');
}

// Interface for question deduplication input
export interface QuestionForDeduplication {
  question_key: string;
  question_text: string;
}

// Schema for action plan step
const ActionPlanStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  rationale: z.string(),
  detailed_rationale: z.array(z.object({
    text: z.string(),
  })).optional(),
  priority: z.enum(['high', 'medium', 'low']),
  dateAdded: z.string(),
  dateModified: z.string().optional(),
  daysOfWeek: z.array(z.string()).optional(),
  timeOfDay: z.string().optional(),
  step_details: z.union([
    z.string(),
    z.array(z.object({
      text: z.string(),
    })),
    z.object({
      text: z.string(),
    }),
    // Workout-specific step_details structure (single workout)
    z.object({
      dayName: z.string(),
      dayType: z.string().optional(),
      estimatedDuration: z.number().optional(),
      estimatedCaloriesBurned: z.number().optional(),
      warmup: z.string().optional(),
      cooldown: z.string().optional(),
      exercises: z.array(z.object({
        exerciseId: z.string().optional(),
        name: z.string(),
        sets: z.union([z.number(), z.string()]),
        reps: z.union([z.number(), z.string()]),
        restTimeSeconds: z.number().optional(),
        rir: z.union([z.number(), z.string()]).optional(),
        notes: z.string().optional(),
        alternatives: z.array(z.object({
          exerciseId: z.string().optional(),
          name: z.string(),
        })).optional(),
      })),
      recoveryHints: z.object({
        stretching: z.string().optional(),
        fasciaMassage: z.string().optional(),
        supplementation: z.string().optional(),
      }).optional(),
    }),
    // Workout-specific step_details structure (array of multiple workout days)
    z.array(z.object({
      dayName: z.string(),
      dayType: z.string().optional(),
      estimatedDuration: z.number().optional(),
      estimatedCaloriesBurned: z.number().optional(),
      warmup: z.string().optional(),
      cooldown: z.string().optional(),
      exercises: z.array(z.object({
        exerciseId: z.string().optional(),
        name: z.string(),
        sets: z.union([z.number(), z.string()]),
        reps: z.union([z.number(), z.string()]),
        restTimeSeconds: z.number().optional(),
        rir: z.union([z.number(), z.string()]).optional(),
        notes: z.string().optional(),
        alternatives: z.array(z.object({
          exerciseId: z.string().optional(),
          name: z.string(),
        })).optional(),
      })),
      recoveryHints: z.object({
        stretching: z.string().optional(),
        fasciaMassage: z.string().optional(),
        supplementation: z.string().optional(),
      }).optional(),
    })),
  ]),
  bonus_hacks: z.array(z.object({
    text: z.string(),
  })).optional(),
  step_title_scroll: z.string().optional(),
  nutrition_targets: z.object({
    caloriesTarget: z.number(),
    carbsTarget: z.number(),
    proteinTarget: z.number(),
    fatTarget: z.number(),
    fiberTarget: z.number(),
  }).optional(),
  dietary_plan: z.object({
    breakfast: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
    })),
    lunch: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
    })),
    dinner: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
    })),
  }).optional(),
  phase_2_title: z.string().optional(),
  phase_3_title: z.string().optional(),
});

// Schema for action plan response
const ActionPlanSchema = z.object({
  actionPlan: z.object({
    id: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    rationale: z.string(),
    steps: z.array(ActionPlanStepSchema)
  })
});

// Schema for hypothesis component
const HypothesisComponentSchema = z.object({
  id: z.string(),
  root_cause_hypothesis: z.string(),  // Legacy 
  root_cause_hypothesis_components: z.array(z.string()),
  summary: z.string(),
});

// Schema for hypothesis response
const HypothesisSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  overall_hypothesis: z.string(),
  overall_hypothesis_components: z.array(z.string()), // Added to sync with interface
  user_assessment_hypothesis: z.string().optional(),
  components: z.array(HypothesisComponentSchema),
});

type ActionPlanResponse = z.infer<typeof ActionPlanSchema>;
type HypothesisResponse = z.infer<typeof HypothesisSchema>;

const buildCoachChatSystemPrompt = (onboard_context: Onboard): string => {
  const selectedModule = onboard_context.selectedModules?.[0] || 'general wellness';

  const getQA = (key: string) =>
    onboard_context.clarifyingQuestions?.find(q => q.question === key)?.answer || '';

  const physicalStatsLines = [
    onboard_context.age            ? `Age: ${onboard_context.age}`                             : '',
    onboard_context.height         ? `Height: ${onboard_context.height}`                       : '',
    onboard_context.weight         ? `Weight: ${onboard_context.weight}`                       : '',
    onboard_context.gender         ? `Gender: ${onboard_context.gender}`                       : '',
    onboard_context.occupation_activity ? `Occupation activity: ${onboard_context.occupation_activity}` : '',
    getQA('existing_pain')         ? `Pain areas: ${getQA('existing_pain')}`                   : '',
    getQA('hours_sleep_per_night') ? `Sleep per night: ${getQA('hours_sleep_per_night')} hours`: '',
    getQA('current_stress_level')  ? `Stress level: ${getQA('current_stress_level')}/10`       : '',
  ].filter(Boolean);

  const physicalStatsSection = physicalStatsLines.length > 0
    ? `\nPhysical stats & health context:\n${physicalStatsLines.join('\n')}\n`
    : '';

  let systemPrompt = `You are ${onboard_context.selectedCoach}, a wellness coach. The user's primary wellness focus is: ${selectedModule}.
When addressing the user by name, use USER_NAME.

User's current situation:
${onboardToLLMString(onboard_context)}${physicalStatsSection}

=== RESPONSE LENGTH (highest priority — follow strictly) ===

Match your response length to the complexity of the user's message:
- Greetings, acknowledgments, simple yes/no questions: 1-2 sentences, under 30 words. Example: "Yes, creatine is well-supported by research. 3-5g daily is the standard dose."
- Standard coaching (most messages): 2-4 sentences, 50-100 words. Get to the point, then stop.
- Complex topics needing detail (new concept, multi-part question): up to 150 words max. Never exceed this.

Do NOT pad responses with filler, restatements of what the user said, or generic encouragement. If the answer is short, let it be short. A follow-up question is optional — only include one when it genuinely adds value (e.g., narrowing down their needs). Do NOT add a follow-up question to simple answers, acknowledgments, or when the conversation doesn't call for it.

Only use the user's name if it hasn't appeared in the last 5 chat messages. If empty context, use their name.

=== COACHING GUIDELINES ===

1. Be supportive and provide personalized advice based on their profile. Focus on their ${selectedModule} goals when relevant.

2. QUESTIONS vs PLAN MODIFICATION (critical): General Q&A in chat does not change the user's saved action plan. Plan changes are handled by a separate flow. Answer questions conversationally without implying the plan changed. If you suggest a formal plan update, finish your answer first, then ask if they want to update their plan. If they say yes, send a brief message explaining the proposed change (which step, what change) and mention that confirming will open the plan editor.

3. HOW-TO GUIDANCE: Be specific with practical examples. Mention evidence-based sources when relevant. One-off workout design ("propose a leg day") is handled by a separate workout-proposal flow, not the plan-edit flow.

4. PLAN INTEGRATION: Don't contradict the user's action plan without addressing the conflict. When relevant, reference their plan. First time this week they ask about plan topics, briefly remind them: "You can review your full plan in 'Plan'."

5. SEEK CLARIFICATION: When unsure, ask for specifics before answering. If ambiguous whether they want advice or a plan edit, ask briefly.

6. CONTEXT-AWARE RECOMMENDATIONS: Gather essential context before specific recommendations (location for gym suggestions, dietary preferences for nutrition, etc.). Never assume location. For female users, ask about gender-specific preferences when relevant.

7. PERSONALIZATION: Reference the user's preferences, constraints, and goals. Connect suggestions to their situation. When a USER AWARENESS block is attached below, it carries the live numbers (today's nutrition, 7-day averages, training count, weight & body composition deltas) — treat those as known facts and weave them in naturally. Use AT MOST one rounded figure per reply (e.g. "you were about 60 g under your protein target this week"). Recommendations should name specific foods/portions but skip per-item gram math; the user feels guided, not lectured.

8. CONVERSATION CONTINUITY: Build upon information from previous messages. Don't ignore recent context or switch topics without addressing their input.

9. NEVER ASK WHAT THE APP ALREADY KNOWS: Do not ask the user how much protein/calories they're getting, what they're eating, whether they trained this week, or how their weight is trending. The app logs that and surfaces it in the USER AWARENESS block. If a number you'd want is genuinely missing from the awareness block AND no detail block is attached, you may ask a precise follow-up — but prefer offering a specific recommendation grounded in what IS known, with one short qualifier if needed.

=== MEDICAL & SAFETY RULES ===

MEDICAL BOUNDARIES: Never provide medical advice, diagnosis, or treatment recommendations. For medical questions, respond: "UnderForge is for general fitness and wellness only. For health concerns, please consult a qualified healthcare professional."

INJURY & PAIN RULES (no exceptions):
- Injury rehab/treatment questions: deflect to healthcare professional. Offer to adjust the plan to work around it.
- Pain rated 5/10+: do NOT suggest exercises engaging the painful area. Recommend consulting a professional.
- Any injury: do NOT frame advice as "addressing recovery" or "helping heal." Focus on working around it. Include: "If you feel pain during a workout, discontinue and consult a healthcare professional."

NON-MEDICAL TEST INSIGHTS: You can discuss general wellness patterns from non-medical tests (blood panels, VO2 max, body composition, sleep data). Focus on lifestyle recommendations, not diagnosing or treating disease.

MEAL-LOGGING FAT ESTIMATION: The app estimates cooking oil/fat for logged meals. If users ask about fat accuracy: "Logged meals include estimated cooking oil/butter — approximately 5g fat (45 kcal) per teaspoon. Home-cooked meals with less oil may be lower; restaurant meals may be higher."

=== PRODUCT CAPABILITIES (reference only when user asks about app features) ===

UnderForge is a hybrid AI + human fitness/longevity coaching app. Key features:
- Action plan with 3 steps: training, nutrition, recovery. Reviewed by human coach when hybrid coaching is active.
- AI chat (you) for coaching, Q&A, and guidance. Human coach chat is asynchronous.
- Separate intents handle: food logging, workout logging/proposals, activity logging, plan edits. These are detected automatically — you only handle general coaching chat.
- Plan edits use a two-step confirmation flow (confirmation message → editor). One-off workout requests go to a separate workout proposal flow.
- Progress tab: Body (weight/composition charts), Nutrition (meal trends), Training (workout trends).
- Quick Log button: meal photo/text, workout log, activity log, weekly body composition.
- Social tab: consistency leaderboard and privacy toggle. Not a full social network.
- Plan management: view in Plan tab, edit via Plan tab or chat-initiated plan-edit flow.
- Data syncs across devices when signed in. Privacy policy: https://www.underforge.io/privacy-policy.html
- Push notifications remind users to log plan steps (capped at ~1/day).
- Feedback: chat or email support@underforge.app. Coaching inquiries: yourcoach@underforge.io.
- Not yet available: wearable sync, social features (friend lists, DMs, posts), data exports, web client.
- No specific brand/product recommendations — direct users to their human coach for those.
- Under active development; set expectations honestly about missing features.
`;
  return systemPrompt;
};

// --- BMR / TDEE / Calorie Target Calculation ---

function parseHeightCm(heightStr: string): number | null {
  const match = heightStr.match(/\((\d+)\s*cm\)/);
  return match ? parseInt(match[1]) : null;
}

function parseWeightKg(weightStr: string): number | null {
  const match = weightStr.match(/\((\d+)\s*kg\)/);
  return match ? parseInt(match[1]) : null;
}

function bodyWeightKgFromOnboard(onboardData: Onboard): number {
  const findCq = (q: string) =>
    onboardData.clarifyingQuestions?.find((cq) => cq.question === q)?.answer ?? '';
  const weightStr = onboardData.weight || findCq('current_weight_question') || '';
  return parseWeightKg(weightStr) ?? DEFAULT_BODYWEIGHT_KG;
}

/**
 * Baseline-movement (NEAT) recommendation from onboarding profile, in kcal/day.
 * Returns 0 when BMR inputs are missing.
 *
 * This is the kcal/day budget for non-training movement that the burn-card
 * `daily_movement` row uses as its target. It mirrors the same recommendation
 * surfaced to the user as minutes/day in the training plan UI.
 */
export function estimateBaselineMovementKcalFromOnboard(onboardData: Onboard): number {
  const calc = calculateBaseCalories(onboardData);
  if (!calc) return 0;
  return calc.baselineMovement.kcalPerDay;
}

/**
 * @deprecated Use `estimateBaselineMovementKcalFromOnboard`. The old occupation
 * multiplier embedded an implicit ~7,500-step assumption that we now make
 * explicit via `computeBaselineMovement`. Kept for one release for any
 * lingering caller; will be removed.
 */
export function estimateOccupationNeatFromOnboard(onboardData: Onboard): number {
  const calc = calculateBaseCalories(onboardData);
  if (!calc) return 0;
  return estimateOccupationNeatKcal(calc.bmr, (onboardData as any).occupation_activity || '');
}

export interface BaseCalorieCalcResult {
  bmr: number;
  /**
   * TDEE from explicit additive components: BMR + cardio + baseline-movement.
   * Plan-training kcal is added on top by the LLM/`persistPlanNutritionTargets`
   * once the action plan exists.
   */
  baseTdee: number;
  /** kcal/day from the user's habitual non-plan cardio (0 if not reported). */
  cardioKcalPerDay: number;
  /** Human-readable cardio summary for prompts; '' when the user did not answer. */
  cardioSummary: string;
  /** Explicit baseline-movement recommendation (minutes/kcal/steps). */
  baselineMovement: BaselineMovement;
  goalMultiplier: number;
  goalLabel: string;
  /** @deprecated Legacy field — populated for back-compat. New code should
   *  read `baselineMovement.kcalPerDay` instead. */
  occupationMultiplier: number;
  /** @deprecated Legacy field — populated for back-compat. New code should
   *  read `baselineMovement.kcalPerDay` instead. */
  occupationNeatKcal: number;
}

/**
 * Parse the `usual_cardio` triad answer into kcal/day and a short summary.
 *
 *   minutes_per_week = days * length_midpoint
 *   MET              = lookup by self-reported intensity
 *   kcal_per_week    = MET * weightKg * minutes_per_week / 60
 *   kcal_per_day     = round(kcal_per_week / 7)
 */
function computeUsualCardioKcalPerDay(
  onboardData: Onboard,
  weightKg: number,
): { kcalPerDay: number; summary: string } {
  const cq = onboardData.clarifyingQuestions?.find((q) => q.question === 'usual_cardio');
  const answer = cq?.answer ? String(cq.answer) : '';
  if (!answer) return { kcalPerDay: 0, summary: '' };

  // The widget stores JSON, but `getFilteredClarifyingQuestions` already
  // converts it to natural language for the LLM. Parse the natural-language
  // line so this works for both representations.
  let days: number | null = null;
  let lengthMinutes: number | null = null;
  let intensity: 'Easy' | 'Moderate' | 'Hard' | 'All-out' | null = null;

  // First try JSON (in case of upstream changes that pass raw data).
  try {
    const parsed = JSON.parse(answer);
    if (typeof parsed?.days === 'number') days = parsed.days;
    if (typeof parsed?.length === 'string') {
      lengthMinutes = ({ '<20': 15, '20-40': 30, '40-60': 50, '>60': 70 } as Record<string, number>)[parsed.length] ?? null;
    }
    if (typeof parsed?.intensity === 'string') intensity = parsed.intensity;
  } catch {
    // Fall through to natural-language parsing.
  }

  if (days === null) {
    const m = answer.match(/(\d+)\s*days?/i);
    if (m) days = parseInt(m[1], 10);
    if (/no days/i.test(answer)) days = 0;
  }
  if (lengthMinutes === null) {
    if (/under\s*20|<\s*20/i.test(answer)) lengthMinutes = 15;
    else if (/20[\u2013-]40|20\s*to\s*40/i.test(answer)) lengthMinutes = 30;
    else if (/40[\u2013-]60|40\s*to\s*60/i.test(answer)) lengthMinutes = 50;
    else if (/over\s*60|>\s*60/i.test(answer)) lengthMinutes = 70;
  }
  if (intensity === null) {
    if (/all[- ]?out/i.test(answer)) intensity = 'All-out';
    else if (/hard/i.test(answer)) intensity = 'Hard';
    else if (/moderate/i.test(answer)) intensity = 'Moderate';
    else if (/easy/i.test(answer)) intensity = 'Easy';
  }

  if (days === null || lengthMinutes === null || intensity === null) {
    return { kcalPerDay: 0, summary: '' };
  }
  if (days === 0 || lengthMinutes === 0) {
    return {
      kcalPerDay: 0,
      summary: `User reports doing no regular cardio outside of training.`,
    };
  }

  const metByIntensity: Record<string, number> = {
    Easy: 4.0,
    Moderate: 6.5,
    Hard: 8.5,
    'All-out': 10.5,
  };
  const met = metByIntensity[intensity];
  const minutesPerWeek = days * lengthMinutes;
  const kcalPerWeek = (met * weightKg * minutesPerWeek) / 60;
  const kcalPerDay = Math.round(kcalPerWeek / 7);

  const summary =
    `${days} day${days === 1 ? '' : 's'}/week × ~${lengthMinutes} min, ${intensity} ` +
    `→ MET ${met}, ~${kcalPerDay} kcal/day averaged over the week.`;

  return { kcalPerDay, summary };
}

/**
 * Calculate BMR and base TDEE (occupation only, no exercise) from onboard data.
 * Uses Harris-Benedict formula. Returns null if required fields are missing.
 * Exercise calories are estimated by the LLM based on the training plan it creates.
 */
export function calculateBaseCalories(onboardData: Onboard): BaseCalorieCalcResult | null {
  // Some users finished onboarding before we flattened the gender/age/height/
  // weight answers onto the top-level Onboard. Fall back to clarifyingQuestions
  // so the BMR is real (and the burned/balance card doesn't degrade to a
  // weight*24 approximation that flips the net deficit vs surplus label).
  const findCq = (key: string): string => {
    const q = onboardData.clarifyingQuestions?.find(
      (qq) => qq.question === key,
    );
    return q?.answer ? String(q.answer) : '';
  };

  const gender: string =
    (onboardData as any).gender || findCq('gender_question') || '';
  const ageStr: string =
    (onboardData as any).age || findCq('current_age_question') || '';
  const heightStr: string =
    onboardData.height || findCq('current_height_question') || '';
  const weightStr: string =
    onboardData.weight || findCq('current_weight_question') || '';
  const occupationActivity: string = (onboardData as any).occupation_activity || '';

  const age = parseInt(ageStr);
  const heightCm = parseHeightCm(heightStr);
  const weightKg = parseWeightKg(weightStr);

  if (!age || !heightCm || !weightKg) return null;

  let bmr: number;
  if (gender === 'Male') {
    bmr = 88.362 + (13.397 * weightKg) + (4.799 * heightCm) - (5.677 * age);
  } else if (gender === 'Female') {
    bmr = 447.593 + (9.247 * weightKg) + (3.098 * heightCm) - (4.330 * age);
  } else {
    const bmrMale = 88.362 + (13.397 * weightKg) + (4.799 * heightCm) - (5.677 * age);
    const bmrFemale = 447.593 + (9.247 * weightKg) + (3.098 * heightCm) - (4.330 * age);
    bmr = (bmrMale + bmrFemale) / 2;
  }

  // Habitual non-plan cardio is part of baseline TDEE — the LLM will add
  // the planned training kcal on top of `baseTdee` separately.
  const { kcalPerDay: cardioKcalPerDay, summary: cardioSummary } =
    computeUsualCardioKcalPerDay(onboardData, weightKg);

  // Explicit baseline-movement recommendation. Plan-training kcal is not
  // known here (the LLM hasn't generated step 1 yet); `persistPlanNutritionTargets`
  // recomputes the recommendation with the actual plan-training kcal once
  // the plan exists, and persists the result. This call provides the seed
  // value the LLM uses for its caloriesTarget calculation.
  const baselineMovement = computeBaselineMovement({
    occupationActivity,
    weightKg,
    cardioKcalPerDay,
    planTrainingKcalPerDay: 0,
  });

  // Legacy multiplier — surfaced on the result for back-compat, no longer
  // drives baseTdee.
  const occupationMultiplier = getOccupationMultiplier(occupationActivity);

  // New explicit additive TDEE: BMR + cardio + baseline-movement. Plan
  // training is added by the LLM on top of `baseTdee` (it integrates the
  // estimatedCaloriesBurned from the workouts it just generated).
  const baseTdee = Math.round(bmr + cardioKcalPerDay + baselineMovement.kcalPerDay);

  const goal = onboardData.selectedGoal?.toLowerCase() || '';
  let goalMultiplier: number;
  let goalLabel: string;

  if (goal.includes('burn') || goal.includes('fat') || goal.includes('lose')) {
    goalMultiplier = 0.80;
    goalLabel = '20% deficit for fat loss';
  } else if (goal.includes('build') || goal.includes('muscle')) {
    goalMultiplier = 1.10;
    goalLabel = '10% surplus for muscle building';
  } else if (goal.includes('strength')) {
    goalMultiplier = 1.05;
    goalLabel = '5% surplus for strength gains';
  } else {
    goalMultiplier = 1.0;
    goalLabel = 'maintenance';
  }

  return {
    bmr: Math.round(bmr),
    baseTdee,
    cardioKcalPerDay,
    cardioSummary,
    baselineMovement,
    goalMultiplier,
    goalLabel,
    // Legacy fields — back-compat only.
    occupationMultiplier,
    occupationNeatKcal: estimateOccupationNeatKcal(Math.round(bmr), occupationActivity),
  };
}

// Add type for check-in notification
export interface CheckinNotification {
  title: string;
  body: string;
}

class LLMService {
  private apiKey: string;
  private anthropic: Anthropic;
  private deepseekApiKey: string;

  constructor() {
    this.apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('Anthropic API key not found in environment variables');
    }
    
    this.anthropic = new Anthropic({
      apiKey: this.apiKey,
    });

    // DeepSeek API key (optional fallback)
    // Try both EXPO_PUBLIC_ prefix (for client-side Expo) and regular prefix
    this.deepseekApiKey = process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY || process.env.EXPO_DEEPSEEK_API_KEY || '';
    if (this.deepseekApiKey) {
      glowLogger.info('DeepSeek API key configured as fallback', { module: 'llm-service' });
    } else {
      glowLogger.warn('DeepSeek API key not found - fallback unavailable. Set EXPO_PUBLIC_DEEPSEEK_API_KEY in .env', { module: 'llm-service' });
    }
  }

  private async logPromptToFile(systemPrompt: string, userPrompt: string): Promise<string> {
    try {
      // Create timestamp-based filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `anthropic-call-${timestamp}.json`;
      const filePath = `${FileSystem.documentDirectory}llm-logs/${filename}`;
      
      // Ensure directory exists
      const dirPath = `${FileSystem.documentDirectory}llm-logs/`;
      const dirInfo = await FileSystem.getInfoAsync(dirPath);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
      }

      // Create log object
      const logData = {
        timestamp: new Date().toISOString(),
        systemPrompt,
        userPrompt,
        model: LLM_CONFIG.model,
        temperature: LLM_CONFIG.temperature
      };

      // Write to file
      await FileSystem.writeAsStringAsync(filePath, JSON.stringify(logData, null, 2));
      
      return filename;
    } catch (error) {
      glowLogger.error('Failed to log prompt to file', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 'log-failed';
    }
  }


  /**
   * Check if an error is retryable (5xx status codes, especially 529 overloaded)
   */
  private isRetryableError(error: any): boolean {
    // Check for 529 overloaded error in error message
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      if (errorMessage.includes('529') || errorMessage.includes('overloaded')) {
        return true;
      }
    }
    
    // Check for status code in error object (Anthropic SDK may expose this)
    if (error?.status && typeof error.status === 'number') {
      const status = error.status;
      // Retry on 5xx errors (server errors) and 429 (rate limit)
      if (status >= 500 || status === 429 || status === 529) {
        return true;
      }
    }
    
    // Check for status code in error string representation
    const errorString = String(error);
    if (errorString.includes('529') || errorString.includes('overloaded')) {
      return true;
    }
    
    return false;
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.3 * baseDelay; // Add up to 30% jitter
    const delay = Math.min(baseDelay + jitter, MAX_RETRY_DELAY_MS);
    return Math.floor(delay);
  }

  /**
   * Make DeepSeek API call (OpenAI-compatible API)
   */
  private async makeDeepSeekCall(
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
    temperature?: number,
    timeoutMs: number = 120000, // Default 5 minutes for DeepSeek (reasoning model is slower)
    priorMessages: { role: 'user' | 'assistant'; content: string }[] = []
  ) {
    if (!this.deepseekApiKey) {
      throw new Error('DeepSeek API key not configured');
    }

    glowLogger.info('DeepSeek API Call Started', {
      module: 'llm-service',
      event: 'deepseek_api_call_start',
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      prior_messages_count: priorMessages.length,
      max_tokens: maxTokens,
      temperature: temperature || DEEPSEEK_CONFIG.temperature,
      timeout_ms: timeoutMs,
    });

    const startTime = Date.now();

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(DEEPSEEK_CONFIG.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_CONFIG.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...priorMessages,
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: temperature || DEEPSEEK_CONFIG.temperature,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} ${errorText}`);
      }

      const data: DeepSeekResponse = await response.json();
      const duration = Date.now() - startTime;

      const textContent = data.choices[0]?.message?.content || '';

      glowLogger.info('DeepSeek API Call Success', {
        module: 'llm-service',
        event: 'deepseek_api_call_success',
        duration: duration.toString(),
        response: textContent,
      });

      // Return in the same format as Anthropic for compatibility
      return {
        choices: [{
          message: {
            content: textContent
          }
        }],
        sources: undefined
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if it's a timeout/abort error
      const isTimeout = error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));
      
      glowLogger.error('DeepSeek API Call Error', {
        module: 'llm-service',
        event: 'deepseek_api_call_error',
        duration: duration.toString(),
        is_timeout: isTimeout,
        error_message: error instanceof Error ? error.message : String(error),
      });

      if (isTimeout) {
        throw new Error(`DeepSeek API call timed out after ${timeoutMs / 1000} seconds`);
      }

      throw error;
    }
  }

  private async makeAnthropicCall(
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
    temperature?: number,
    useWebSearch: boolean = false,
    maxRetries: number = MAX_RETRIES,
    priorMessages: { role: 'user' | 'assistant'; content: string }[] = []
  ) {
    // Log to file and get filename only if enabled
    const logFilename = LOG_PROMPTS_TO_FILES 
      ? await this.logPromptToFile(systemPrompt, userPrompt)
      : 'logging-disabled';

    const startTime = Date.now();
    let lastError: any = null;

    // Retry loop for Anthropic
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        glowLogger.info('Anthropic claude LLM API Call Started', {
          module: 'llm-service',
          event: 'api_call_start',
          attempt,
          max_attempts: maxRetries,
          log_filename: logFilename,
          system_prompt: systemPrompt,
          user_prompt: userPrompt,
          prior_messages_count: priorMessages.length,
          max_tokens: maxTokens,
          temperature: temperature || LLM_CONFIG.temperature,
          using_web_search: useWebSearch
        });

        // Make Anthropic API call
        const result = await this.anthropic.messages.create({
          model: LLM_CONFIG.model,
          max_tokens: maxTokens,
          temperature: temperature || LLM_CONFIG.temperature,
          system: systemPrompt,
          messages: [
            ...priorMessages,
            { role: 'user', content: userPrompt }
          ],
        });

        const duration = Date.now() - startTime;

        // Extract text content from response
        const textContent = result.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as any).text)
          .join('');

        // Log successful response to glowLogger
        glowLogger.info('Anthropic API Call Success', {
          module: 'llm-service',
          event: 'api_call_success',
          duration: duration.toString(),
          attempt,
          response: textContent || '',
          used_web_search: useWebSearch.toString(),
        });

        // Return in the same format as the old OpenAI client for compatibility
        return {
          choices: [{
            message: {
              content: textContent
            }
          }],
          // Add sources to the response object if available (Anthropic doesn't have web search yet)
          sources: undefined
        };
      } catch (error) {
        lastError = error;
        const duration = Date.now() - startTime;
        
        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);
        const isLastAttempt = attempt === maxRetries;
        
        // Always use 'warn' level since we have DeepSeek fallback
        // Only use 'error' level after all providers fail (handled later)
        glowLogger.warn('Anthropic API Call Error', {
          module: 'llm-service',
          event: 'api_call_error',
          duration: duration.toString(),
          attempt,
          max_attempts: maxRetries,
          is_retryable: isRetryable,
          is_last_attempt: isLastAttempt,
          has_fallback: !!this.deepseekApiKey,
          error_message: error instanceof Error ? error.message : String(error),
          error_status: (error as any)?.status,
        });

        // If not retryable or last attempt, break to try fallback
        if (!isRetryable || isLastAttempt) {
          break;
        }

        // Calculate delay for retry with exponential backoff
        const retryDelay = this.calculateRetryDelay(attempt);
        
        glowLogger.info('Retrying Anthropic API call after delay', {
          module: 'llm-service',
          event: 'api_call_retry',
          attempt,
          next_attempt: attempt + 1,
          retry_delay_ms: retryDelay,
          error_type: error instanceof Error ? error.constructor.name : 'Unknown',
        });

        // Wait before retrying
        await this.sleep(retryDelay);
      }
    }

    // After all Anthropic retries failed, try DeepSeek as fallback
    if (this.deepseekApiKey) {
      glowLogger.warn('All Anthropic retries failed, falling back to DeepSeek', {
        module: 'llm-service',
        event: 'fallback_to_deepseek',
        anthropic_error: lastError instanceof Error ? lastError.message : String(lastError),
      });

      try {
        return await this.makeDeepSeekCall(systemPrompt, userPrompt, maxTokens, temperature, undefined, priorMessages);
      } catch (deepseekError) {
        glowLogger.error('All LLM providers failed', {
          module: 'llm-service',
          event: 'all_llm_providers_failed',
          deepseek_error: deepseekError instanceof Error ? deepseekError.message : String(deepseekError),
          anthropic_error: lastError instanceof Error ? lastError.message : String(lastError),
        });

        // Throw generic error message for users (no specific LLM names)
        throw new Error('Unable to process your request at this time. Please try again later.');
      }
    }

    // No DeepSeek fallback available, throw generic error
    glowLogger.error('Primary LLM provider failed and no fallback available', {
      module: 'llm-service',
      event: 'no_fallback_available',
      anthropic_error: lastError instanceof Error ? lastError.message : String(lastError),
    });
    throw new Error('Unable to process your request at this time. Please try again later.');
  }

  // Chat with coach - used by ChatScreen
  async chatWithCoach(userMessage: string, context: Onboard, userId?: string, dataSnapshot?: string): Promise<string> {
    try {
      // Build chronological prior conversation as real multi-turn messages.
      // We intentionally do NOT inject the conversation blob into the system
      // prompt anymore — the LLM gets a genuine user/assistant exchange
      // history, which is dramatically better at resolving follow-ups
      // ("can cardio help?" referring to belly fat, etc.).
      const MAX_PRIOR_EXCHANGES = 10;
      let priorMessages: { role: 'user' | 'assistant'; content: string }[] = [];
      if (userId) {
        try {
          // getRecentConversations returns newest-first; reverse to chronological.
          const recentConversations = await getRecentConversations(userId, MAX_PRIOR_EXCHANGES);
          const chronological = [...recentConversations].reverse();
          for (const conv of chronological as any[]) {
            if (typeof conv?.userMessage === 'string' && conv.userMessage.trim()) {
              priorMessages.push({ role: 'user', content: conv.userMessage });
            }
            if (typeof conv?.coachResponse === 'string' && conv.coachResponse.trim()) {
              priorMessages.push({ role: 'assistant', content: conv.coachResponse });
            }
          }
        } catch (error) {
          glowLogger.error('Failed to load recent conversations', {
            error: error instanceof Error ? error.message : String(error),
            user_id: userId
          });
        }
      }

      let systemPrompt = `${buildLanguageInstruction()}\n\n${buildCoachChatSystemPrompt(context)}`;

      // Always-on awareness block: small, precomputed aggregates so the coach
      // is never blind. Attached on every turn when we have a user id.
      let awarenessSummary = '';
      if (userId) {
        try {
          awarenessSummary = await fetchUserAwarenessSummary(userId, context);
        } catch (awarenessError) {
          glowLogger.warn('Failed to build awareness summary; continuing without it', {
            error: awarenessError instanceof Error ? awarenessError.message : String(awarenessError),
            user_id: userId,
          });
        }
      }

      if (awarenessSummary) {
        systemPrompt += `

${awarenessSummary}

USER-AWARENESS RULES (mandatory — always applied):
- The block above is the latest truth about the user. Treat it as known facts.
- NEVER ask the user for information that is already there. Forbidden examples: "how much protein are you currently getting?", "what are you eating?", "did you work out this week?", "how's your weight?". You already know.
- Sound human, not like a dashboard. Lead with one short observation that uses ONE rounded number (e.g. "you were ~60 g under your daily protein target"). Skip the rest of the numbers unless directly relevant. Never quote multiple averages, percentages, or calorie totals in the same reply.
- Round generously ("about 60 g short", "~25 g at breakfast"). Do NOT print "120g/day target 180g" formulas or restate the awareness block.
- Recommendations should be concrete and small. Name foods and approximate portions, but DO NOT spell out per-item gram math (no "+12g from two eggs"). The reader should feel guided, not lectured.
- Keep the response tight: ideally 3–5 short sentences. If a tangential nutrition tip would push you over that, drop it. The recommendation matters more than the trivia.
- If a section says "no meals logged" or "nothing logged", acknowledge that gracefully — don't pretend data exists.
- Do not invent numbers that are not in this block or in the detail snapshot below.

Example of the desired tone (for a "should I add eggs to breakfast?" type question):
"You were about 60 g under your daily protein target this week, and your breakfast is on the lighter side (~25 g). Bumping morning protein helps — 2–3 eggs plus a protein shake would close most of that gap. If you want to keep fat down, limit yolks to 1–2 and keep all the whites."
(Optional one-line tip only if the reply is still short, e.g. cooking note. Drop it if the answer is already 4+ sentences.)`;
      }

      if (dataSnapshot) {
        systemPrompt += `

User's recent activity detail (the app attached this for richer personalization):
${dataSnapshot}

DATA-GROUNDED REPLIES (mandatory when this detail block is present):
- Use this detail to ground your recommendation; don't recite it. Pull at most ONE concrete reference from it (e.g. "your breakfasts have mostly been oats and yogurt"), then move to the suggestion.
- For TODAY questions ("what am I missing today", "what should I eat now"), use the TODAY block first and reference what's still left in plain language (e.g. "you've got most of your protein still to hit today"). If a planned item is already logged, say so; do NOT tell them to do it again.
- If they logged few or no meals/workouts, acknowledge that and give practical next steps.
- Never invent numbers, times, or session details that are not in the data block.
- Keep it tight — same tone as the USER-AWARENESS RULES above. 3–5 short sentences. Lead with the observation, then the recommendation; drop tangential tips if you're already long.
`;
      }
      
      glowLogger.info('Chat request', {
        system_prompt: systemPrompt,
        user_message: userMessage,
        api_key_exists: !!this.apiKey
      });

      const response = await this.makeAnthropicCall(
        systemPrompt,
        userMessage,
        LLM_CONFIG.maxTokens.chat,
        undefined,
        false,
        1, // For chat functionality, only try Anthropic once before falling back to DeepSeek
        priorMessages
      );

      glowLogger.info('Chat response received', { 
        response: JSON.stringify(response) 
      });

      const messageContent = response.choices[0]?.message?.content;
      
      if (!messageContent) {
        throw new Error('No content in API response');
      }

      return substituteUserName(messageContent, context.name);
    } catch (error) {
      glowLogger.error('=== CHAT ERROR ===', {});
      glowLogger.error('Error type: ' + (error instanceof Error ? error.constructor.name : 'Unknown'), {});
      glowLogger.error('Error message: ' + (error instanceof Error ? error.message : String(error)), {});
      glowLogger.error('Error details: ' + String(error), {});
      glowLogger.error('==================', {});
      throw error;
    }
  }
  public static buildActionPlanSystemPrompt(): string {
    return `${buildLanguageInstruction()}

      You are an expert health and wellness coach, as well as the user's personal accountability partner.
      Generate a personalized action plan with specific, actionable steps based on the user's 
      onboarding responses and clarifying questions.
      When addressing the user by name, use the placeholder USER_NAME.
      User-facing plan content must follow the response language above, even when examples in this prompt are written in English.
      
      CRITICAL: The plan MUST always contain exactly 3 steps, in this exact order:
      - Step 1 (id: "step_1"): TRAINING - a structured workout/exercise program
      - Step 2 (id: "step_2"): NUTRITION - calculated daily calorie and macro targets with 4-6 short, evidence-based nutrition guidelines (no specific meal plans, no detailed principles yet)
      - Step 3 (id: "step_3"): RECOVERY & SLEEP - basic recovery and sleep guidelines based on available information
      
      Keep the plan overview (rationale) concise - maximum 1 sentence (15 words total).
      
      PHASE PROGRESSION: Only Step 1 (Training) MUST include phase_2_title and phase_3_title fields.
      These are specific, non-generic names for the next two progression phases:
      - Phase 1 = current plan title (the step title)
      - phase_2_title = what the user progresses to after 3 weeks of consistency (specific to their goals/level)
      - phase_3_title = mastery-level progression (specific to their goals/level)
      Example for training: Phase 1 "Foundation Strength", phase_2_title "Hypertrophy Focus", phase_3_title "Peak Performance"
      
      IMPORTANT: Step 2 (Nutrition) and Step 3 (Recovery) should NOT include phase_2_title or phase_3_title. These steps will be expanded later after the user completes dedicated nutrition and recovery surveys.
      
      WORKOUT STEPS (Step 1 - Training):
      When generating workout steps, the step_details field MUST be a structured JSON object with:
      {
        "dayName": "string - descriptive name like 'Upper Body Day', 'Leg Day', 'Full Body'",
        "dayType": "string - 'strength', 'hypertrophy', 'cardio', or 'mixed'",
        "estimatedDuration": "number - minutes",
        "warmup": "string - warmup instructions",
        "cooldown": "string - cooldown instructions",
        "exercises": [
          {
            "exerciseId": "string - exact catalog id (e.g., 'barbell-bench-press', 'barbell-back-squat', 'barbell-deadlift', 'dumbbell-bench-press')",
            "name": "string - display name",
            "sets": "number",
            "reps": "string - MUST be a single integer like '10', '8', '12'. NEVER a range like '8-12'",
            "restTimeSeconds": "number - rest between sets in seconds (30, 60, 90, 120, 180)",
            "rir": "number - Reps in Reserve 0-5 (0=failure, 2-3=moderate, 4-5=easy)",
            "notes": "string - optional technique tips",
            "alternatives": [{"exerciseId": "string", "name": "string"}]
          }
        ],
        "recoveryHints": {
          "stretching": "string - post-workout stretches",
          "fasciaMassage": "string - foam rolling recommendations",
          "supplementation": "string - recovery supplements",
          "other": "string - additional recovery tips"
        }
      }
      
      CRITICAL RULES FOR EXERCISE PARAMETERS:
      - "reps" MUST always be a single integer as a string (e.g. "10", "8", "12"). NEVER use ranges like "8-12" or "6-8". Pick the specific target rep count.
      - For exercises annotated "(seconds)" in the catalog (isometric holds and steady-state cardio), the "reps" field is a hold/duration in seconds — emit a sensible duration like "30", "60", "300", not a rep count.
      - "restTimeSeconds" MUST always be specified for every exercise. Never omit it.
      - "rir" MUST always be specified for every exercise. Never omit it.
      - "sets" MUST always be specified. Never omit it.
      
      For RiR (Reps in Reserve), use these guidelines based on expertise level:
      - Beginner: RiR 3-4 (leave several reps in the tank for safety and form)
      - Intermediate: RiR 2-3 (moderate intensity)
      - Advanced: RiR 0-2 (closer to failure for maximum stimulus)
      
      Rest time guidelines:
      - Compound exercises (squat, deadlift, bench): 90-180 seconds
      - Isolation exercises (curls, extensions): 45-90 seconds
      - HIIT/circuit: 30-45 seconds

      EXERCISE ALTERNATIVES (optional field):
      Only include "alternatives" on an exercise when there is a specific, practical reason the user might need a different option. Valid reasons include:
      - The exercise requires equipment the user may not have access to (e.g., barbell — offer dumbbell alternative)
      - The user reported an injury near the target area, so a lower-impact alternative might be needed
      - The exercise is advanced and the user is a beginner (offer a regression)
      Do NOT add alternatives to every exercise. Most exercises should have NO alternatives. When you do include them, provide exactly 1 alternative with its exerciseId and name.

      INJURY & PAIN RULES FOR PLAN GENERATION (non-negotiable):
      1. INJURY DISCLAIMER: If the user mentions any injury anywhere in their profile, clarifying questions, or survey answers, you MUST include this exact sentence at the very beginning of the plan overview (rationale): "If you feel pain during any workout, discontinue the session immediately and consult a healthcare professional as soon as possible."
      2. NO RECOVERY CLAIMS: Never frame the plan as treating, rehabilitating, or addressing the recovery of an injury. You can note that certain exercises are chosen to avoid stressing the injured area, but never imply the plan will heal or recover the injury.
      3. BODY MAP PAIN DATA: The user may report specific painful body areas via a body map selector. Look for the "existing_pain" clarifying question answer which lists specific body parts (e.g., "Pain in: Left Knee, Lower Back"). If the user reports pain in ANY body part:
         a. Do NOT include exercises that directly load or stress that body part in Step 1 (Training).
         b. Explicitly note in the step description which body areas are excluded and why.
         c. Offer alternative exercises that work around the affected areas.
         d. If the pain areas significantly limit exercise options, adjust the overall plan volume and recommend the user consult a healthcare professional for clearance.
      4. ANY PAIN LEVEL WITH INJURY: If the user has an injury (any pain level) and has not received medical clearance, modify Step 1 (Training) to exclude or substitute exercises that directly stress the injured body part. Add a note in that step explaining why those exercises were excluded.

      Respond with valid JSON only.

${buildLanguageInstruction()}`;
  }

  public static buildHypothesisSystemPrompt(): string {
    return `You are an expert health and wellness coach, as well as the user's personal accountability partner.
      Generate a hypothesis of what the user needs to reach their goals based on the user's 
      onboarding responses and clarifying questions.  Address the user directly, you are the coach.
      You are giving a hypothesis directly to the user, so use a friendly and supportive tone and 
      address the user directly rather than writing a report about the user.
      When addressing the user by name, use the placeholder USER_NAME.
      Limit the hypothesis to 3 components, since more than that risks overwhelming the user.  
      Respond with valid JSON only.

${buildLanguageInstruction()}`;
  }

  public static buildHypothesisUserPrompt(
    onboardData: Onboard,
    currentDate?: string
  ): string {
    const userGoal = onboardData.selectedGoal;
    
    // Create a copy without the action plan to avoid confusing the LLM
    const onboardDataWithoutActionPlan = copyOnboardWithoutActionPlan(onboardData);
    
    let userPrompt = `Based on the following user information: ${onboardToLLMString(onboardDataWithoutActionPlan)}`;

    userPrompt += `Generate a hypothesis of what the user needs to reach their goals:`;

    // Build clarifying questions and answers string
    const clarifyingQuestionsAndAnswers = onboardData.clarifyingQuestions?.map(qa => 
      `Question: ${qa.question}\nAnswer: ${qa.answer || 'No answer provided'} /Answer`
    ).join('\n\n') || 'No clarifying questions available';

    userPrompt += `Use the onboarding survey with clarifying questions to build a mental model of the user: "${clarifyingQuestionsAndAnswers}"`

    userPrompt += `
- Enhance your deep understanding of the user to take into account the user's goals: "${userGoal}" and motivation listed above.
- Try to figure out the root causes for the user that has been making it hard for them to reach their goals. 
- Identify the key challenges, obstacles, and motivations that are preventing the user from reaching their goals.  
- Break the key challenges down into components and sub-components as described below.
- Address the user directly, you are the coach talking to the user.  Use a friendly and supportive tone. 
- Develop a hypothesis that will form the foundation for a professional coach to be able to build a personalized action plan for the user.
- BODY PAIN: If the user reported pain in specific body areas via the "existing_pain" question (e.g., "Pain in: Left Knee, Lower Back"), factor this into your hypothesis. Consider how the pain limits their training options and may have contributed to past difficulties in reaching their goals. Recommend professional evaluation for painful areas.

The structure of a hypothesis is that it is broken down into HypothesisComponents, and each
HypothesisComponent is further broken down into 3 bullet points that describe the root causes of that 
particular component of the challenge. 

Keep the high level overview concise.  2 to 3 sentences max.

For each bullet point, keep it very brief in a single short sentence.

See the example JSON structure that will be automatically included in the prompt.

`;

    return userPrompt;
  }



  /**
   * Build user prompt for action plan generation
   */
  public static buildActionPlanUserPrompt(
    onboardData: Onboard,
    currentDate?: string
  ): string {
    const actualCurrentDate = currentDate || new Date().toISOString();
    const userGoal = onboardData.selectedGoal;
    
    // Calculate BMR and base TDEE (occupation only, exercise calories estimated by LLM)
    const calorieCalc = calculateBaseCalories(onboardData);
    
    // Create a copy without the action plan to avoid confusing the LLM
    const onboardDataWithoutActionPlan = copyOnboardWithoutActionPlan(onboardData);
    
    let userPrompt = `Based on the following user information: ${onboardToLLMString(onboardDataWithoutActionPlan)}`;

    // Add hypothesis if present in onboard data
    if (onboardData.hypothesis) {
      userPrompt += `\n\nA coach has read the interview and developed a hypothesis:\n${onboardData.hypothesis.toLLMString()}\n`;
    }

    userPrompt += `Generate a comprehensive action plan for the next 21 days with exactly 3 steps (Step 1: Training, Step 2: Nutrition, Step 3: Recovery & Sleep) that:`;

    // Build clarifying questions and answers string
    const clarifyingQuestionsAndAnswers = onboardData.clarifyingQuestions?.map(qa => 
      `Question: ${qa.question}\nAnswer: ${qa.answer || 'No answer provided'} /Answer`
    ).join('\n\n') || 'No clarifying questions available';

    userPrompt += `The user filled out the following onboarding survey with clarifying questions: "${clarifyingQuestionsAndAnswers}"`

    userPrompt += `
1. Directly and pragmatically address the user's goal: "${userGoal}"
2. Are tailored in focus and complexity to the user's current situation, lifestyle, preferences, expertise level of ${onboardData.expertise_level} and the responses to the clarifying questions.
3. Do NOT target something the user is already doing well (e.g., if user drinks 3 liters water daily, don't recommend hydration steps)
4. CRITICAL: This user has "${onboardData.time_available}" to work on their goals. The total time commitment across all 3 steps should NOT exceed this limit. Plan accordingly.
5. Are progressive and appropriate for a ${onboardData.expertise_level} level user.  If a beginner, give very simple, foundational steps.  If intermediate, give moderately challenging steps that build on existing knowledge.  If advanced, give advanced techniques that optimize current practices.
6. INJURY SAFETY (CRITICAL): Review the user's profile and clarifying question answers for any mention of injuries, pain, or physical limitations. In particular, check the "existing_pain" answer which lists specific painful body areas from the body map (e.g., "Pain in: Left Knee, Lower Back"). Apply the INJURY & PAIN RULES defined in the system prompt without exception: add the disclaimer to the plan overview if any pain is reported, exclude exercises that stress the reported painful body areas, and never claim the plan treats or recovers an injury.


Requirements for each step:
1. Each step must be concrete, realistic, and actionable with evidence-based rationale
2. RESPECT TIME CONSTRAINTS: Ensure each step fits within the user's available time (${onboardData.time_available}). If they have limited time, prioritize high-impact, low-time activities
3. MATCH EXPERTISE LEVEL: The user's expertise level is ${onboardData.expertise_level}.  If beginner, focus on simple, foundational habits that are easy to implement and maintain.  If intermediate, build upon existing knowledge with moderately challenging activities.  If advanced, provide advanced optimizations and fine-tuning techniques.
4. Always specify exactly when the user should follow the plan (specific days like Monday, Wednesday OR specific times like "mornings" for daily steps)
5. Include a specific time of day that makes sense for the activity (e.g., "07:00" for morning meditation, "21:00" for evening stretching, "12:00" for lunch meal prep, "18:00" for evening workout)
6. Include a concise one-sentence explanation of why you're proposing that step, specifically for that user at their ${onboardData.expertise_level} level
7. Be as specific as possible with recommendations (e.g., "Take 100mg of magnesium daily" not "Move more often")
8. Use evidence-based steps and explain why important for achieving their goals
9. Make steps sustainable and realistic for the user given their time availability and expertise level
10. For daysOfWeek, use specific days format ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] - do NOT use "Daily" or "Every day"
11. Speak directly as the selected coach ${onboardData.selectedCoach} in their style and tone (use "My plan for you" not "This plan")
12. For each step's description field: HARD LIMIT 30 words maximum (count every word). This text appears on the plan details screen. The overview card shows only the first 15 words — do not rely on the overview for important info. For Step 1 (Training), you may include average kcal per session within the 30-word cap (e.g. "~300 kcal/session"). Put precise per-day burn in estimatedCaloriesBurned on each workout day.
13. CRITICAL: Include a detailed plan for this recommended step (step_details field). The structure depends on which step:
   - Step 1 (Training): Use structured workout JSON format (see workout format instructions above).
   - Step 2 (Nutrition): Start step_details with a brief "How Your Targets Were Calculated" section explaining BMR, activity level, training calories, and goal adjustment. Then provide 4-6 SHORT, evidence-based and universally accepted nutrition guidelines aligned to the user's goal. These should be irrefutable, foundational principles like prioritizing lean protein, choosing good fats, eating enough fiber, mindful eating, adequate hydration, etc. Number them 1-6 (max) and keep each one to 1 sentence. DO NOT provide specific meal plans, detailed principles, or day-by-day menus. This is a baseline plan — more personalized nutrition advice will come after the user completes a dedicated nutrition survey.
   - Step 3 (Recovery & Sleep): Organize by protocols, guidelines, or sequential steps
   This is the primary detailed content users will see.
14. Include a list of bonus hacks that would help the user achieve their goal using clever tricks that don't take much effort (100-150 words total per step across all hacks for that step).
15. If you recommend a training exercise like pike push up, explain it in an easy way how to do this exercise that the user is able to just execute the exercise with a good form 
16. If you mention any tips from a book or a reference, you have to tell the user where to find more information about it, example is talking about habit stacking, it should be clear how it works and where the user finds more information about it
17. For time of day timeOfDay in actionStep, use 24-hour format like "07:30" or "21:00", not 12-hour format with am/pm.  It has to be a valid time, it can't be a description like "in the morning" or "as needed" as that will break downstream processing that expects a valid time.

CRITICAL - Tracking and Progress Guidelines:
For any tracking needs (progressive overloading for strength training, calorie tracking for weight management, sleep tracking, etc.):
- DO NOT recommend external apps like MyFitnessPal, Cronometer, Fitbit apps, or any third-party tracking applications. Also don't recommend any other apps like for meditation, breathing, sleep or any other use case.
- INSTEAD, direct users to use UnderForge's built-in chat feature for tracking assistance
- Use phrases like: "Your coach will help you track this through our chat - just share your progress and I'll keep track of it for you"
- Or: "We can handle all tracking right here in UnderForge - no need for external apps. Just message me with your numbers/progress"
- Or: "I'll help you monitor your progress through our conversations - simply update me daily/weekly on your results"

Guidelines for Supplement recommendations:
If you recommend a supplement, explain why this supplement makes sense referring to the plan and the actual outcome from current papers/studies
Give the user an overview under Bonus Hacks, what defines a good supplement using the following points
- Example of good bonus hacks: 
Output the checklist as exactly 6 numbered bullet points.
The checklist must include the following points:
	1.	Check the ingredient list – short, free from unnecessary additives or fillers, like sugar, sweeteners and so on.
	2.	Look for lab certificates – ideally from independent labs, not just internal testing, the certifivates should be visible directly on the product page.
	3.	Good bioavailability – ingredients in forms the body can absorb well.
	4.	Trusted certifications – e.g., Organic, GMP, ISO.
	5.	Spot unrealistic claims – promises like "lose 30 kg in 2 weeks" are red flags.
	6.	Evidence-based – the ingredient should be backed by solid scientific studies.
After the checklist, always add this exact sentence:
"If you have questions about topics like bioavailability or certifications, just write them in the chat and your coach will go through them with you."
Keep the language simple, warm and user-friendly.
When you give this checklist, just point out two example websites "https://www.sunday.de/en/" and "https://vetain.de" that the user has an example for looking up high quality supplements 
Name also, that this is not an affiliate partnership or something wich is biased

Time of Day Guidelines:
- Morning activities (meditation, exercise, supplements): 06:00 - 09:00
- Midday activities (meal prep, walks): 11:00 - 14:00  
- Evening activities (stretching, relaxation, sleep prep): 19:00 - 22:00
- Bedtime activities (sleep hygiene): 21:00 - 23:00
- Use 24-hour format like "07:30" or "21:00", not 12-hour format with am/pm

Example of good plan content for sleep improvement:
| 1. Magnesium intake 320mg | HIGH | Supports melatonin production for sleep-wake cycle regulation, recommended for females 25-60 | Take 320mg magnesium supplement at 21:00 | ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] |
| 2. Avoid caffeine after 11 am | MEDIUM | Caffeine stimulates nervous system and interferes with sleep quality | No coffee, tea, or caffeinated drinks after 11:00 | ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] |
| 3. Substitute HIIT for Yoga | HIGH | Your HIIT before bed spikes cortisol, disrupting sleep | Replace evening HIIT with 20min yoga or stretching at 20:30 | ["sun", "mon", "tue", "wed", "thu"] |

Use "${actualCurrentDate}" for all date fields. Make the plan practical and achievable based on their responses.

CRITICAL TEXT FORMATTING for step_details:
All text in step_details MUST use \\n for line breaks within JSON strings. Use:
- \\n\\n between sections/paragraphs (e.g., between "Day 1" and "Day 2", or between "Morning" and "Afternoon")
- \\n before each bullet point (lines starting with -)
- **Section Name** for bold section headers (e.g., **Day 1:**, **Morning (07:00-09:00):**, **Protocol 1:**)
This ensures proper readability. Never output step_details text as one continuous paragraph.

The step_details field should follow these formatting styles based on activity type:

FOR WORKOUTS (CRITICAL - use structured JSON format):

For Step 1 (Training), step_details format depends on whether you have a single workout or multiple workout days:

A) SINGLE WORKOUT (same workout each training day, e.g., Full Body 3x/week):
Use a single JSON object:
{
  "dayName": "Full Body Strength",
  "dayType": "strength",
  "estimatedDuration": 45,
  "estimatedCaloriesBurned": 350,
  "warmup": "5 min light cardio, arm circles, leg swings",
  "cooldown": "5 min walking, static stretches",
  "exercises": [
    {
      "exerciseId": "barbell-back-squat",
      "name": "Barbell Back Squat",
      "sets": 4,
      "reps": "8",
      "restTimeSeconds": 120,
      "rir": 2,
      "notes": "Keep chest up, knees tracking over toes"
    },
    {
      "exerciseId": "barbell-bench-press",
      "name": "Barbell Bench Press",
      "sets": 3,
      "reps": "10",
      "restTimeSeconds": 90,
      "rir": 2,
      "notes": "Squeeze chest at top"
    }
  ],
  "recoveryHints": {
    "stretching": "Quad stretch, chest doorway stretch - 30s each",
    "fasciaMassage": "Foam roll quads, glutes, upper back - 60s each",
    "supplementation": "Protein shake within 30 min"
  }
}

B) MULTIPLE WORKOUT DAYS (split routine, e.g., Push/Pull/Legs, Upper/Lower):
Use an ARRAY of workout objects:
[
  {
    "dayName": "Push Day",
    "dayType": "strength",
    "estimatedDuration": 50,
    "estimatedCaloriesBurned": 320,
    "warmup": "5 min cardio, arm circles, band pull-aparts",
    "cooldown": "5 min walking, static stretches",
    "exercises": [
      {"exerciseId": "barbell-bench-press", "name": "Barbell Bench Press", "sets": 4, "reps": "8", "restTimeSeconds": 120, "rir": 2, "notes": "Squeeze chest"},
      {"exerciseId": "barbell-overhead-press", "name": "Barbell Overhead Press", "sets": 3, "reps": "10", "restTimeSeconds": 90, "rir": 2, "notes": "Keep core tight"}
    ],
    "recoveryHints": {"stretching": "Chest and shoulder stretches", "supplementation": "Protein shake"}
  },
  {
    "dayName": "Pull Day",
    "dayType": "strength",
    "estimatedDuration": 50,
    "estimatedCaloriesBurned": 340,
    "warmup": "5 min cardio, band pull-aparts, scapular retractions",
    "cooldown": "5 min walking, static stretches",
    "exercises": [
      {"exerciseId": "barbell-deadlift", "name": "Barbell Deadlift", "sets": 4, "reps": "6", "restTimeSeconds": 150, "rir": 2, "notes": "Keep back neutral"},
      {"exerciseId": "barbell-row", "name": "Barbell Row", "sets": 3, "reps": "10", "restTimeSeconds": 90, "rir": 2, "notes": "Pull to lower chest"}
    ],
    "recoveryHints": {"stretching": "Lat and hamstring stretches", "supplementation": "Protein shake"}
  },
  {
    "dayName": "Leg Day",
    "dayType": "strength",
    "estimatedDuration": 50,
    "estimatedCaloriesBurned": 380,
    "warmup": "5 min cardio, leg swings, bodyweight squats",
    "cooldown": "5 min walking, static stretches",
    "exercises": [
      {"exerciseId": "barbell-back-squat", "name": "Barbell Back Squat", "sets": 4, "reps": "8", "restTimeSeconds": 120, "rir": 2, "notes": "Depth and control"},
      {"exerciseId": "leg-curl", "name": "Leg Curl", "sets": 3, "reps": "12", "restTimeSeconds": 60, "rir": 2, "notes": "Control the negative"}
    ],
    "recoveryHints": {"stretching": "Quad and hip flexor stretches", "fasciaMassage": "Foam roll quads and glutes", "supplementation": "Protein shake"}
  }
]

IMPORTANT: Choose format A or B based on the training program structure. Most intermediate/advanced programs benefit from split routines (format B).

IMPORTANT: Each workout day object MUST include "estimatedCaloriesBurned" (integer, kcal). Estimate realistically based on the exercises, sets, reps, duration, and the user's body weight. These values are used to calculate the nutrition targets in Step 2.

IMPORTANT: Step 1 description = 30 words max (may mention average kcal/session within that limit). Put per-day numbers in each workout's "estimatedCaloriesBurned" field.

IMPORTANT: Only use exercise IDs from the available exercise database. The complete list of available exercise IDs is:

${getExerciseIdsForPrompt()}

Always use these exact IDs when creating workouts. Do not invent new exercise IDs.

RiR Guidelines by expertise:
- Beginner: RiR 3-4 (focus on form, stay far from failure)
- Intermediate: RiR 2-3 (moderate challenge)
- Advanced: RiR 0-2 (push closer to failure)

Rest Time Guidelines:
- Heavy compound (squat, deadlift): 120-180 seconds
- Moderate compound (bench, rows): 90-120 seconds
- Isolation exercises: 45-90 seconds
- HIIT/circuits: 30-45 seconds

FOR DIETS/NUTRITION (step_details text with \\n):
IMPORTANT: Start the nutrition step_details with a brief "**How Your Targets Were Calculated:**" section (3-4 lines) explaining the key factors. Include:
- Base metabolic rate (BMR) and occupation activity level
- Average daily calories burned from training (from Step 1)
- Goal adjustment (deficit/surplus/maintenance)

Then provide 4-6 SHORT, evidence-based nutrition guidelines as a numbered list. Put a blank line (\\n\\n) between each numbered item. These should be:
- Universally accepted, irrefutable nutrition principles aligned to the user's goal
- Foundational guidelines like: prioritize lean protein, choose quality fats, eat enough fiber, stay hydrated, practice mindful eating, eat whole foods, go for whole grain options
- 1 sentence each — short and clear
- DO NOT include specific meal plans, rigid schedules, or "eat X at Y time" prescriptions. Provide general, flexible guidance only.

IMPORTANT: This is a BASELINE nutrition plan. More personalized advice incorporating the user's food preferences will be provided after they complete a dedicated nutrition survey later.

Example structure: "**How Your Targets Were Calculated:**\\nYour daily target of 2,400 kcal is based on your BMR (~1,650 kcal), occupation activity level, average training burn (~170 kcal/day), and a 10% surplus for muscle growth.\\n\\n**Nutrition Guidelines:**\\n\\n1. **Prioritize lean protein:** Aim for 1.6-2.2g per kg of body weight daily from sources like chicken, fish, eggs, and legumes.\\n\\n2. **Choose quality fats:** Include healthy fats from olive oil, nuts, avocados, and fatty fish for hormone health and satiety.\\n\\n3. **Eat enough fiber:** Target 25-35g daily from vegetables, fruits, and whole grains to support digestion and gut health.\\n\\n4. **Stay hydrated:** Drink at least 2-3 liters of water daily, more on training days.\\n\\n5. **Eat mostly whole foods:** Get 80%+ of your calories from minimally processed, nutrient-dense sources.\\n\\n6. **Practice mindful eating:** Eat without distractions, chew thoroughly, and listen to hunger and fullness signals."

FOR OTHER RECOMMENDATIONS / RECOVERY (step_details text with \\n):
IMPORTANT: This is a BASELINE recovery plan. Only basic sleep and stress guidelines are available from the initial onboarding. Provide 4-6 foundational, evidence-based recovery principles as a numbered list with a blank line (\\n\\n) between each item. More detailed recovery protocols will be provided after the user completes a dedicated recovery survey.

Example structure: "**Recovery & Sleep Guidelines:**\\n\\n1. **Consistent sleep schedule:** Go to bed and wake up at the same time every day, even on weekends, to regulate your circadian rhythm.\\n\\n2. **Optimize sleep environment:** Keep your room dark, cool (18-20°C), and quiet for better sleep quality.\\n\\n3. **Manage stress actively:** Take 5-10 minutes daily for deep breathing, journaling, or a short walk to lower cortisol levels.\\n\\n4. **Rest between training days:** Allow 48 hours between training the same muscle group for proper recovery.\\n\\n5. **Limit screen time before bed:** Reduce blue light exposure 30-60 minutes before sleep to improve melatonin production."


CRITICAL - NUTRITION TARGETS (REQUIRED for Step 2 - Nutrition):
Step 2 (id: "step_2") MUST include a "nutrition_targets" field with personalized daily targets.

${calorieCalc ? `PRE-CALCULATED BASE ENERGY EXPENDITURE FOR THIS USER (lifestyle only, NO structured training plan):
- BMR (Basal Metabolic Rate): ${calorieCalc.bmr} kcal/day
- Habitual non-plan cardio component: ${calorieCalc.cardioKcalPerDay} kcal/day${calorieCalc.cardioSummary ? ` (${calorieCalc.cardioSummary})` : ' (user did not report regular cardio)'}
- Baseline movement recommendation (NEAT outside training/cardio): ${calorieCalc.baselineMovement.kcalPerDay} kcal/day (~${calorieCalc.baselineMovement.minutesPerDay} min/day brisk walking, ~${calorieCalc.baselineMovement.stepsPerDayApprox} steps)
- Base TDEE (BMR + cardio + baseline movement, no plan training): ${calorieCalc.baseTdee} kcal/day
- Goal adjustment: ${calorieCalc.goalLabel} (×${calorieCalc.goalMultiplier})

HOW TO CALCULATE caloriesTarget:
1. Sum the estimatedCaloriesBurned from ALL workout days you created in Step 1
2. Divide by 7 to get average daily training calories
3. Full TDEE = Base TDEE (${calorieCalc.baseTdee}) + average daily training calories
4. caloriesTarget = Full TDEE × ${calorieCalc.goalMultiplier} (${calorieCalc.goalLabel})
You MUST follow this formula. The Base TDEE already includes the user's habitual cardio AND the baseline-movement recommendation — do NOT add either again. Do NOT ignore the training calories from Step 1.` : `Calculate the calorie target based on the user's stats and the training plan you created in Step 1:
1. Estimate BMR from user stats (age, gender, weight, height)
2. Add habitual non-plan cardio kcal/day if reported by the user
3. Add a baseline-movement (NEAT) allowance based on occupation activity
4. Add the average daily training calories (sum estimatedCaloriesBurned from Step 1 workouts ÷ 7)
5. Apply goal adjustment (deficit for fat loss, surplus for muscle gain)`}

Macronutrient ratios to apply:
- For muscle gain: Higher protein (30-35% of calories), moderate carbs (40-45%), moderate fat (25-30%)
- For weight loss: High protein (30-35%), moderate carbs (30-40%), moderate fat (30-35%)
- For maintenance/general health: Balanced (protein 25-30%, carbs 40-45%, fat 25-30%)
Fiber target: 25-30g for women, 30-38g for men

Macro calculation:
- Protein grams: (calories × protein_percentage) ÷ 4
- Carb grams: (calories × carbs_percentage) ÷ 4
- Fat grams: (calories × fat_percentage) ÷ 9

Format:
Please respond with a JSON object in this format:
{
  "actionPlan": {
    "id": "unique_plan_id",
    "createdAt": "${actualCurrentDate}",
    "updatedAt": "${actualCurrentDate}",
    "rationale": "Concise 1-sentence overview (15 words max) of why this plan will help the user",
    "steps": [
      {
        "id": "step_1",
        "title": "Training step title",
        "description": "Training program summary — 30 words max",
        "rationale": "one-sentence, evidence-based explanation",
        "detailed_rationale": [
          {"text": "15-20 word bullet point explaining why this step works scientifically"}, 
          {"text": "Another 15-20 word explanation with evidence-based reasoning"}, 
          {"text": "Third bullet point with scientific backing (15-20 words)"}
        ], 
        "priority": "high",
        "dateAdded": "${actualCurrentDate}",
        "daysOfWeek": ["mon", "wed", "fri"],
        "timeOfDay": "18:00",
        "step_details": "Structured workout JSON (see workout format above)",
        "bonus_hacks": [
          {"text": "🔥 Hack 1: 50-70 word practical tip"}, 
          {"text": "💡 Hack 2: Another 50-70 word hack"}, 
          {"text": "⚡ Hack 3: Third hack with 50-70 words"}
        ],
        "step_title_scroll": "Strength Training",
        "phase_2_title": "Hypertrophy Focus",
        "phase_3_title": "Peak Performance"
      },
      {
        "id": "step_2",
        "title": "Nutrition step title",
        "description": "Nutrition plan summary — 30 words max",
        "rationale": "one-sentence, evidence-based explanation",
        "detailed_rationale": [...],
        "priority": "high",
        "dateAdded": "${actualCurrentDate}",
        "daysOfWeek": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        "timeOfDay": "12:00",
        "step_details": [{"text": "**How Your Targets Were Calculated:**\\n...brief explanation...\\n\\n**Nutrition Guidelines:**\\n\\n1. **Prioritize lean protein:** ...\\n\\n2. **Choose quality fats:** ...\\n\\n3. **Eat enough fiber:** ...\\n\\n4. **Stay hydrated:** ...\\n\\n5. **Eat mostly whole foods:** ..."}],
        "bonus_hacks": [...],
        "step_title_scroll": "Nutrition",
        "nutrition_targets": {
          "caloriesTarget": 2000,
          "carbsTarget": 200,
          "proteinTarget": 150,
          "fatTarget": 67,
          "fiberTarget": 30
        }
      },
      {
        "id": "step_3",
        "title": "Recovery & Sleep step title",
        "description": "Recovery plan summary — 30 words max",
        "rationale": "one-sentence, evidence-based explanation",
        "detailed_rationale": [...],
        "priority": "high",
        "dateAdded": "${actualCurrentDate}",
        "daysOfWeek": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        "timeOfDay": "21:00",
        "step_details": [{"text": "**Recovery & Sleep Guidelines:**\\n\\n1. **Consistent sleep schedule:** ...\\n\\n2. **Optimize sleep environment:** ...\\n\\n3. **Manage stress:** ...\\n\\n4. **Rest between training:** ..."}],
        "bonus_hacks": [...],
        "step_title_scroll": "Sleep & Recovery"
      }
    ]
  }
    CRITICAL: You MUST generate exactly 3 steps in this exact order:
    - step_1: Training (structured workout program — detailed, with phase progression)
    - step_2: Nutrition (calorie/macro targets + 4-6 short evidence-based guidelines — baseline only, no detailed principles)
    - step_3: Recovery & Sleep (4-6 basic recovery/sleep guidelines — baseline only)
    
    Make sure to include ALL fields in your response and that:
    - rationale (plan overview): MUST be 15 words max (1 concise sentence)
    - description (each step): MUST be 30 words max — details screen shows this; overview shows first 15 words only
    - step IDs: MUST be "step_1", "step_2", "step_3" in that exact order
    - step_title_scroll: MUST be MAX 3 WORDS (e.g., "Strength Training", "Morning Cardio", "Nutrition")
    - step_details for step_1: MUST be 150-200 words with detailed workout plan
    - step_details for step_2: Brief — calorie calculation explanation + 4-6 one-sentence guidelines (80-120 words total)
    - step_details for step_3: Brief — 4-6 one-sentence recovery guidelines (80-120 words total)
    - detailed_rationale: MUST be 100-150 words total PER STEP across all bullet points for that step
    - bonus_hacks: MUST be 150-200 words total for step_1. For step_2 and step_3, include 2-3 short hacks (50-100 words total)
    - nutrition_targets: REQUIRED on step_2 (Nutrition) - must include calculated caloriesTarget, carbsTarget, proteinTarget, fatTarget, and fiberTarget
    - phase_2_title and phase_3_title: REQUIRED on step_1 (Training) ONLY — specific progression names for next phases
    - DO NOT include phase_2_title or phase_3_title on step_2 or step_3 (these will be added later after dedicated surveys)
}`;

    return userPrompt;
  }

  private buildActionPlanPrompts(onboardData: Onboard): { systemPrompt: string, userPrompt: string } {
    const systemPrompt = LLMService.buildActionPlanSystemPrompt();
    const userPrompt = LLMService.buildActionPlanUserPrompt(onboardData);

    return { systemPrompt, userPrompt };
  }

  private buildHypothesisPlanPrompts(onboardData: Onboard): { systemPrompt: string, userPrompt: string } {
    const systemPrompt = LLMService.buildHypothesisSystemPrompt();
    const userPrompt = LLMService.buildHypothesisUserPrompt(onboardData);

    return { systemPrompt, userPrompt };
  }

  private buildReviseSpecificActionPlanStepPrompts(onboardData: Onboard, userChangeRequest: string, stepToUpdate: any): { systemPrompt: string, userPrompt: string } {
    
    // Determine which step type we're updating to provide specific guidance
    const stepId = stepToUpdate.id;
    let stepTypeGuidance = '';
    
    if (stepId === 'step_1') {
      stepTypeGuidance = `
      
CRITICAL - This is Step 1 (TRAINING):
This step MUST be a structured workout/exercise program. The step_details field MUST be a structured JSON object (or array of objects) with this exact format:
{
  "dayName": "string - descriptive name like 'Upper Body Day', 'Leg Day', 'Full Body'",
  "dayType": "string - 'strength', 'hypertrophy', 'cardio', or 'mixed'",
  "estimatedDuration": "number - minutes",
  "warmup": "string - warmup instructions",
  "cooldown": "string - cooldown instructions",
  "exercises": [
    {
      "exerciseId": "string - exact catalog id (e.g., 'barbell-bench-press', 'barbell-back-squat', 'barbell-deadlift', 'dumbbell-bench-press')",
      "name": "string - display name",
      "sets": "number",
      "reps": "string - MUST be a single integer like '10', '8', '12'. NEVER a range like '8-12'",
      "restTimeSeconds": "number - rest between sets in seconds (30, 60, 90, 120, 180). ALWAYS specify.",
      "rir": "number - Reps in Reserve 0-5 (0=failure, 2-3=moderate, 4-5=easy). ALWAYS specify.",
      "notes": "string - optional technique tips"
    }
  ],
  "recoveryHints": {
    "stretching": "string - post-workout stretches",
    "fasciaMassage": "string - foam rolling recommendations",
    "supplementation": "string - recovery supplements",
    "other": "string - additional recovery tips"
  }
}

IMPORTANT: Only use exerciseId values from this catalog:
${getExerciseListForPrompt()}

CRITICAL: "reps" MUST always be a single integer as a string (e.g. "10", "8", "12"). NEVER use ranges like "8-12". Always specify restTimeSeconds and rir for every exercise. For exercises annotated "(seconds)" in the catalog (isometric holds and steady-state cardio), "reps" is a duration in seconds (e.g. "30", "60", "300"), not a rep count.

For RiR (Reps in Reserve), use these guidelines based on expertise level:
- Beginner: RiR 3-4 (leave several reps in the tank for safety and form)
- Intermediate: RiR 2-3 (moderate intensity)
- Advanced: RiR 0-2 (closer to failure for maximum stimulus)

Rest time guidelines:
- Compound exercises (squat, deadlift, bench): 90-180 seconds
- Isolation exercises (curls, extensions): 45-90 seconds
- HIIT/circuit: 30-45 seconds

Keep the step description at 30 words max (may mention average kcal/session). Use estimatedCaloriesBurned on each workout day for precise values.`;
    } else if (stepId === 'step_2') {
      stepTypeGuidance = `

CRITICAL - This is Step 2 (NUTRITION):
This step MUST contain calculated daily macro targets (nutrition_targets) and 10 personalized nutrition principles.

The step_details field should start with a "How Your Targets Were Calculated" section explaining BMR, activity level, training calories, and goal adjustment. Then provide EXACTLY 10 personalized nutrition principles tailored to the user's goals, preferences, and lifestyle.

Each principle should be actionable, specific, and evidence-based (e.g., "Prioritize protein at breakfast: aim for 30-40g within 2 hours of waking to optimize muscle protein synthesis", "Time your carbs around training: consume 60-70% of daily carbs within 3 hours of your workout for better performance and recovery").

Number them 1-10 and keep each principle concise (1-2 sentences). DO NOT provide specific meal plans or day-by-day menus.`;
    } else if (stepId === 'step_3') {
      stepTypeGuidance = `

CRITICAL - This is Step 3 (RECOVERY & SLEEP):
This step focuses on recovery protocols, sleep optimization, and stress management. Organize step_details by protocols, guidelines, or sequential steps (not by days or meals).`;
    }
    
    const systemPrompt = `
You are an expert health and wellness coach. 
The user has requested to revise a specific step in their action plan based on their feedback.
Generate a revised version of this specific step that incorporates their requested changes.

MINIMAL-CHANGE RULES (highest priority after safety):
- Make the smallest possible change that fully satisfies the user's request.
- Preserve everything the user did NOT ask to change.
- Do NOT rewrite, rebalance, or "improve" unrelated parts of the step.
- Keep the same overall structure, same intent, and same level of detail unless the user's request explicitly requires a broader change.
- If a tiny dependent update is necessary for internal consistency, make only that dependent update and nothing else.
- When in doubt, preserve the existing content exactly.

CONTEXT - The 3-Step Fixed Structure:
All action plans follow a fixed 3-step structure:
- Step 1 (id: "step_1"): TRAINING - a structured workout/exercise program
- Step 2 (id: "step_2"): NUTRITION - 10 personalized nutrition principles with calculated daily macro targets (no specific meal plans)
- Step 3 (id: "step_3"): RECOVERY & SLEEP - recovery protocols, sleep optimization, stress management

PHASE PROGRESSION: The revised step MUST include phase_2_title and phase_3_title fields.
These are specific, non-generic names for the next two progression phases:
- Phase 1 = current plan title (the step title)
- phase_2_title = what the user progresses to after 3 weeks of consistency (specific to their goals/level)
- phase_3_title = mastery-level progression (specific to their goals/level)
Example for training: Phase 1 "Foundation Strength", phase_2_title "Hypertrophy Focus", phase_3_title "Peak Performance"
Example for nutrition: Phase 1 "Clean Eating Basics", phase_2_title "Macro Optimization", phase_3_title "Periodized Nutrition"
Example for recovery: Phase 1 "Sleep Hygiene Setup", phase_2_title "Advanced Recovery", phase_3_title "Elite Recovery Protocol"
${stepTypeGuidance}

STEP-SPECIFIC PRESERVATION RULES:
- Training: if the step contains multiple workout days and the user asks to change only one day, preserve every other workout day exactly.
- Training: if the user asks to change one exercise, one difficulty element, one intensity parameter, or one day, do not change unrelated days, exercise order, or exercise selection elsewhere.
- Nutrition: preserve existing targets, principles, and guidance unless the user explicitly asked to change them or a tiny dependent update is required.
- Recovery: preserve existing protocols, sleep guidance, stress-management guidance, and timing unless the user explicitly asked to change them or a tiny dependent update is required.
- Titles, phase names, daysOfWeek, timeOfDay, rationale, detailed_rationale, bonus_hacks, and nutrition_targets should remain unchanged unless the user explicitly asked to change them or a minimal dependent update is required.

INJURY & PAIN RULES FOR PLAN REVISION (non-negotiable):
1. INJURY DISCLAIMER: If the user's revision request or their profile mentions any injury, you MUST include this exact sentence at the very beginning of the revised step's description or rationale: "If you feel pain during any workout, discontinue the session immediately and consult a healthcare professional as soon as possible."
2. NO RECOVERY CLAIMS: Never frame the revised step as treating, rehabilitating, or addressing recovery from an injury. You may note that certain exercises are chosen to avoid stressing the injured area, but never imply the plan will heal the injury.
3. BODY MAP PAIN DATA: Check the "existing_pain" clarifying question answer which lists specific painful body areas from a body map (e.g., "Pain in: Left Knee, Lower Back"). If pain is reported in ANY body part, do NOT include exercises that engage that body part in the revised Training step. Explicitly note which areas are excluded and offer alternatives.
4. ANY INJURY: If the user has an injury (any pain level), exclude or substitute any exercises that directly stress the injured body part and add a note explaining why.

${buildLanguageInstruction()}

Respond with valid JSON only.`.trim();

    let userPrompt = `${this.buildUserContext(onboardData)}`;

    // Build clarifying questions and answers string
    const clarifyingQuestionsAndAnswers = onboardData.clarifyingQuestions?.map(qa => 
      `Question: ${qa.question}\nAnswer: ${qa.answer || 'No answer provided'} /Answer`
    ).join('\n\n') || 'No clarifying questions available';

    // Calculate BMR and base TDEE for nutrition context
    const calorieCalc = calculateBaseCalories(onboardData);

    userPrompt += `The user filled out the following onboarding survey with clarifying questions: "${clarifyingQuestionsAndAnswers}"

${stepId === 'step_2' && calorieCalc ? `
CALORIE CALCULATIONS (for Nutrition step):
- BMR (Basal Metabolic Rate): ${calorieCalc.bmr} kcal/day
- Base TDEE (BMR + cardio + baseline movement, no plan training): ${calorieCalc.baseTdee} kcal/day
- Habitual cardio component already included: ${calorieCalc.cardioKcalPerDay} kcal/day${calorieCalc.cardioSummary ? ` (${calorieCalc.cardioSummary})` : ''}
- Baseline movement (non-training NEAT) already included: ${calorieCalc.baselineMovement.kcalPerDay} kcal/day (~${calorieCalc.baselineMovement.minutesPerDay} min/day brisk walk)
- You should estimate additional plan-training calories from Step 1 and add them to base TDEE (do NOT double-count the habitual cardio)
- Then adjust for their goal (deficit for fat loss, surplus for muscle gain, maintenance for body recomp)
` : ''}

Current Step to Revise (${stepId}):
Title: ${stepToUpdate.title}
Description: ${stepToUpdate.description}
Rationale: ${stepToUpdate.rationale}
Days of Week: ${stepToUpdate.daysOfWeek?.join(', ') || 'N/A'}
Time of Day: ${stepToUpdate.timeOfDay || 'N/A'}
${stepToUpdate.phase_2_title ? `Phase 2 Title: ${stepToUpdate.phase_2_title}` : ''}
${stepToUpdate.phase_3_title ? `Phase 3 Title: ${stepToUpdate.phase_3_title}` : ''}

CURRENT STEP JSON (source of truth - preserve unchanged parts):
${JSON.stringify(stepToUpdate, null, 2)}

User's Change Request:
"${userChangeRequest}"

Regenerate this action plan step based on the user's specific change request, their goal and clarifying questions, available time of ${onboardData.time_available}, and expertise level of ${onboardData.expertise_level}.

CRITICAL Requirements:
1. The new step must have the same step id "${stepToUpdate.id}" as the step being replaced
2. RESPECT TIME CONSTRAINTS: Ensure the step fits within the user's available time (${onboardData.time_available})
3. MATCH EXPERTISE LEVEL: The user's expertise level is ${onboardData.expertise_level}
4. Include a specific time of day in 24-hour format (e.g., "07:00" for morning, "18:00" for evening, "21:00" for sleep prep)
5. For daysOfWeek, use specific days format ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] - do NOT use "Daily" or "Every day"
6. Speak directly as the selected coach ${onboardData.selectedCoach} in their style and tone
7. INJURY SAFETY (CRITICAL): Review the user's change request and profile for any mention of injuries, pain, or physical limitations. Apply the INJURY & PAIN RULES defined in the system prompt without exception.
8. Apply the MINIMAL-CHANGE RULES: only change the exact part of the step the user asked about.
9. Preserve all unchanged fields and sub-sections from the CURRENT STEP JSON exactly unless a minimal dependent update is required.
10. If the user asks to modify only one workout day, one exercise, one guideline, one protocol, or one parameter, leave every other part of the step untouched.

CRITICAL - Tracking and Progress Guidelines:
For any tracking needs (progressive overloading for strength training, calorie tracking for weight management, sleep tracking, etc.):
- DO NOT recommend external apps like MyFitnessPal, Cronometer, Fitbit apps, or any third-party tracking applications. Also don't recommend any other apps like for meditation, breathing, sleep or any other use case.
- INSTEAD, direct users to use UnderForge's built-in chat feature for tracking assistance
- Use phrases like: "Your coach will help you track this through our chat - just share your progress and I'll keep track of it for you"
- Or: "We can handle tracking right here in UnderForge - no need for external apps. Just click 'Log' to track your progress."
- Or: "I'll help you monitor your progress through our conversations - simply update me daily/weekly on your results"

Time of Day Guidelines:
- Morning activities (meditation, exercise, supplements): 06:00 - 09:00
- Midday activities (meal prep, walks): 11:00 - 14:00  
- Evening activities (stretching, relaxation, sleep prep): 19:00 - 22:00
- Bedtime activities (sleep hygiene): 21:00 - 23:00
- Use 24-hour format like "07:30" or "21:00", not 12-hour format with am/pm

Make sure to include ALL fields in your response:
- step_details field: MUST be 150-200 words with detailed implementation plan. Follow the structure requirements for ${stepId} shown above.
- detailed_rationale: MUST be 100-150 words total with 3-5 bullet points of evidence-based reasoning
- bonus_hacks: MUST be 150-200 words total with clever tricks that don't take much effort
- phase_2_title and phase_3_title: MUST be specific, non-generic progression phase names (see examples above)

${stepId === 'step_1' ? 'If you recommend a training exercise, explain it in an easy way so the user can execute it with good form.' : ''}
${stepId === 'step_2' ? `
Guidelines for Supplement recommendations:
If you recommend a supplement, explain why this supplement makes sense referring to the plan and the actual outcome from current papers/studies.
Give the user an overview under Bonus Hacks, what defines a good supplement using exactly 6 numbered bullet points:
1. Check the ingredient list – short, free from unnecessary additives or fillers, like sugar, sweeteners and so on.
2. Look for lab certificates – ideally from independent labs, not just internal testing, the certificates should be visible directly on the product page.
3. Good bioavailability – ingredients in forms the body can absorb well.
4. Trusted certifications – e.g., Organic, GMP, ISO.
5. Spot unrealistic claims – promises like "lose 30 kg in 2 weeks" are red flags.
6. Evidence-based – the ingredient should be backed by solid scientific studies.
` : ''}

If you mention any tips from a book or reference, tell the user where to find more information about it (e.g., habit stacking should explain how it works and where to learn more).
`;

    return { systemPrompt, userPrompt };
  }

  // Generate fake action plan with fake data for testing
  private generateFakePlan(): ActionPlanResponse {
    const currentDate = new Date().toISOString();
    return {
      actionPlan: {
        id: `fake_plan_${Date.now()}`,
        createdAt: currentDate,
        updatedAt: currentDate,
        rationale: "Balanced approach for sustainable progress.",
        steps: [
          {
            id: "step_1",
            title: "Full Body Training Program",
            description: "3-day full body strength training program (Mon/Wed/Fri) targeting all major muscle groups with compound lifts and progressive overload.",
            rationale: "Compound movements build functional strength and accelerate muscle growth for beginners.",
            detailed_rationale: [
              {"text": "Full body training maximizes frequency and recovery for optimal muscle protein synthesis"},
              {"text": "Compound exercises recruit multiple muscle groups for efficient time usage"},
              {"text": "Progressive overload ensures continuous adaptation and strength gains"}
            ],
            priority: "high" as const,
            dateAdded: currentDate,
            daysOfWeek: ["mon", "wed", "fri"],
            timeOfDay: "18:00",
            step_title_scroll: "Strength Training",
            phase_2_title: "Hypertrophy Focus",
            phase_3_title: "Strength Peaking",
            step_details: [
              {
                dayName: "Full Body A — Push",
                dayType: "strength",
                estimatedDuration: 55,
                warmup: "5 min light cardio (rowing or bike), then 2 rounds: 10 arm circles, 10 hip circles, 10 bodyweight squats, 10 band pull-aparts.",
                cooldown: "5 min walk, then hold each stretch 30s: chest doorway, quad standing, hamstring seated, hip flexor lunge.",
                exercises: [
                  { exerciseId: "barbell-back-squat", name: "Barbell Back Squat", sets: 4, reps: "8", restTimeSeconds: 120, rir: 2, notes: "Keep chest up, knees tracking over toes." },
                  { exerciseId: "barbell-bench-press", name: "Barbell Bench Press", sets: 4, reps: "8", restTimeSeconds: 120, rir: 2, notes: "Retract scapula, feet flat on floor." },
                  { exerciseId: "romanian-deadlift", name: "Romanian Deadlift", sets: 3, reps: "10", restTimeSeconds: 90, rir: 2, notes: "Hinge at hips, slight knee bend, bar close to legs." },
                  { exerciseId: "dumbbell-overhead-press", name: "Dumbbell Overhead Press", sets: 3, reps: "10", restTimeSeconds: 90, rir: 2, notes: "Press straight up, avoid flaring elbows excessively." },
                  { exerciseId: "dumbbell-row", name: "Dumbbell Row", sets: 3, reps: "10", restTimeSeconds: 75, rir: 2, notes: "Brace core, row elbow to hip, don't rotate torso." },
                  { exerciseId: "plank", name: "Plank", sets: 3, reps: "45", restTimeSeconds: 45, rir: 3, notes: "Neutral spine, squeeze glutes and abs throughout. 45 seconds hold." }
                ],
                recoveryHints: {
                  stretching: "Focus on chest, quads and hip flexors post-session.",
                  fasciaMassage: "Optional: 10 min foam roll on quads, IT band and upper back."
                }
              },
              {
                dayName: "Full Body B — Pull",
                dayType: "strength",
                estimatedDuration: 55,
                warmup: "5 min light cardio, then 2 rounds: 10 cat-cow, 10 leg swings per side, 10 face pulls with band, 5 slow deadlift warm-up reps with empty bar.",
                cooldown: "5 min walk, then 30s each: lat doorway stretch, standing pigeon, seated hamstring, child's pose.",
                exercises: [
                  { exerciseId: "barbell-deadlift", name: "Barbell Deadlift", sets: 4, reps: "5", restTimeSeconds: 150, rir: 2, notes: "Brace hard, push the floor away, lockout glutes at top." },
                  { exerciseId: "pull-up", name: "Pull-Up", sets: 4, reps: "8", restTimeSeconds: 120, rir: 2, notes: "Full hang at bottom, chin clears bar at top. Use band assistance if needed." },
                  { exerciseId: "incline-dumbbell-press", name: "Incline Dumbbell Press", sets: 3, reps: "10", restTimeSeconds: 90, rir: 2, notes: "45° incline, lower to chest level, press to full extension." },
                  { exerciseId: "barbell-row", name: "Barbell Row", sets: 3, reps: "10", restTimeSeconds: 90, rir: 2, notes: "Slight hip hinge, pull bar to lower chest, controlled eccentric." },
                  { exerciseId: "lateral-raise", name: "Dumbbell Lateral Raise", sets: 3, reps: "12", restTimeSeconds: 60, rir: 1, notes: "Slight forward lean, raise to shoulder height, pinky slightly higher." },
                  { exerciseId: "bicycle_crunch", name: "Bicycle Crunch", sets: 3, reps: "15", restTimeSeconds: 45, rir: 3, notes: "Slow and controlled, focus on rotation, not speed." }
                ],
                recoveryHints: {
                  stretching: "Focus on lats, hamstrings and lower back post-session.",
                  fasciaMassage: "Optional: 10 min foam roll on hamstrings, glutes and upper back."
                }
              },
              {
                dayName: "Full Body C — Legs",
                dayType: "strength",
                estimatedDuration: 60,
                warmup: "5 min light bike or skip, then 2 rounds: 10 glute bridges, 10 lateral band walks per side, 10 bodyweight squats with pause.",
                cooldown: "5 min walk, then 30s each: seated quad stretch, pigeon pose per side, standing calf stretch, adductor side lunge hold.",
                exercises: [
                  { exerciseId: "barbell-front-squat", name: "Front Squat", sets: 4, reps: "8", restTimeSeconds: 120, rir: 2, notes: "Elbows high, upright torso, go to parallel or below." },
                  { exerciseId: "hip-thrust", name: "Barbell Hip Thrust", sets: 4, reps: "10", restTimeSeconds: 90, rir: 2, notes: "Drive through heels, full hip extension at top, squeeze glutes." },
                  { exerciseId: "leg-press", name: "Leg Press", sets: 3, reps: "12", restTimeSeconds: 75, rir: 1, notes: "Feet shoulder-width, lower until 90° knee angle, don't lock out knees." },
                  { exerciseId: "walking-lunge", name: "Walking Lunge", sets: 3, reps: "12", restTimeSeconds: 75, rir: 2, notes: "Step long enough so front shin stays vertical. 12 per leg." },
                  { exerciseId: "leg-curl", name: "Lying Leg Curl", sets: 3, reps: "12", restTimeSeconds: 60, rir: 1, notes: "Full range of motion, pause at peak contraction." },
                  { exerciseId: "ab-rollout", name: "Ab Wheel Rollout", sets: 3, reps: "10", restTimeSeconds: 60, rir: 3, notes: "Keep hips in line with torso, don't let lower back sag." }
                ],
                recoveryHints: {
                  stretching: "Focus on hip flexors, quads and glutes post-session.",
                  fasciaMassage: "Optional: 10 min foam roll on quads, IT band and calves."
                }
              }
            ],
            bonus_hacks: [
              {"text": "🔥 Set your workout clothes next to your bed the night before to remove friction and make it easier to start your routine."},
              {"text": "💡 Use the 2-minute rule - commit to just 2 minutes of exercise. Usually you'll continue once started."},
              {"text": "⚡ Play energizing music during workouts. Research shows upbeat music can increase performance by 15%."}
            ]
          },
          {
            id: "step_2",
            title: "Balanced Nutrition Plan",
            description: "High-protein meals with balanced macros to support muscle growth and sustained energy throughout the day.",
            rationale: "Adequate protein intake combined with strategic meal timing optimizes muscle recovery and energy.",
            detailed_rationale: [
              {"text": "High protein intake supports muscle protein synthesis and recovery after training sessions"},
              {"text": "Balanced macronutrient distribution prevents energy crashes and supports metabolic health"},
              {"text": "Consistent meal timing stabilizes blood sugar and improves nutrient absorption"}
            ],
            priority: "high" as const,
            dateAdded: currentDate,
            daysOfWeek: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            timeOfDay: "12:00",
            step_title_scroll: "Meal Plan",
            phase_2_title: "Macro Optimization",
            phase_3_title: "Periodized Nutrition",
            step_details: [
              {"text": "**Day 1:**\n\n**Morning (07:00-09:00):**\n- Breakfast: Greek yogurt (200g) with berries and almonds\n- Supplements: Vitamin D (2000 IU), Omega-3 (1g)\n- Hydration: 500ml water upon waking\n\n**Afternoon (12:00-14:00):**\n- Lunch: Grilled chicken breast (150g) with quinoa (100g) and mixed vegetables\n- Snack: Apple with almond butter (2 tbsp)\n\n**Evening (18:00-20:00):**\n- Dinner: Salmon (180g) with sweet potato (150g) and steamed broccoli\n- Pre-sleep: Herbal tea (chamomile)\n\n**Day 2:**\n\n**Morning (07:00-09:00):**\n- Breakfast: Scrambled eggs (3) with whole grain toast and avocado\n- Supplements: Vitamin D (2000 IU), Omega-3 (1g)\n\n**Afternoon (12:00-14:00):**\n- Lunch: Turkey wrap with hummus and vegetables\n- Snack: Mixed nuts (30g)\n\n**Evening (18:00-20:00):**\n- Dinner: Lean beef stir-fry with brown rice and mixed vegetables"},
              {"text": "\n**General Guidelines:**\n- Focus on whole foods and lean proteins\n- Prepare meals in advance on Sundays\n- Drink 8-10 glasses of water daily\n- Adjust portions based on hunger and energy levels"}
            ],
            bonus_hacks: [
              {"text": "🥗 Meal prep tip: Wash and chop vegetables after grocery shopping. Store in clear containers for grab-and-go convenience during busy weekdays."},
              {"text": "💧 Hydration hack: Use a marked water bottle to track daily intake. Add lemon slices for flavor without added calories."},
              {"text": "⏰ Timing tip: Eat your largest meal when most active (typically lunch). This aligns with natural metabolism cycles for better energy distribution."}
            ],
            nutrition_targets: {
              caloriesTarget: 2200,
              carbsTarget: 220,
              proteinTarget: 165,
              fatTarget: 73,
              fiberTarget: 30
            }
          },
          {
            id: "step_3",
            title: "Sleep & Recovery Optimization",
            description: "Evening routine and sleep hygiene protocols to maximize recovery and prepare for next day's training.",
            rationale: "Quality sleep drives recovery, hormone regulation, and muscle repair after training sessions.",
            detailed_rationale: [
              {"text": "7-9 hours of quality sleep improves cognitive function and physical recovery dramatically"},
              {"text": "Consistent circadian rhythm optimization affects metabolism and mood regulation positively"},
              {"text": "Evening wind-down routines reduce stress hormones and improve sleep onset latency"}
            ],
            priority: "high" as const,
            dateAdded: currentDate,
            daysOfWeek: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
            timeOfDay: "21:30",
            step_title_scroll: "Sleep & Recovery",
            phase_2_title: "Deep Recovery",
            phase_3_title: "Regeneration Mastery",
            step_details: [
              {"text": "**Protocol 1: Sleep Environment Setup**\n- Room temperature: 18-20°C (65-68°F)\n- Complete darkness: blackout curtains or eye mask\n- Noise reduction: earplugs or white noise machine\n- Cool, breathable bedding\n\n**Protocol 2: Evening Wind-Down Routine**\n- 21:00: Dim all lights in home, avoid screens\n- 21:30: Start relaxation activity (reading, meditation, stretching)\n- 22:00: Begin sleep hygiene routine (shower, skincare)\n- 22:30: Lights out, no phone/screens\n\n**Protocol 3: Morning Optimization**\n- Consistent wake time (even weekends)\n- Natural light exposure within 30 minutes\n- Light movement or stretching upon waking"},
              {"text": "\n**Key Reminders:**\n- Maintain the same sleep schedule 7 days per week\n- Avoid caffeine after 2 PM\n- No large meals 3 hours before bedtime\n- Consider magnesium supplementation (300-400mg) in the evening"}
            ],
            bonus_hacks: [
              {"text": "😴 Red light hack: Use a red light bulb in your bedroom lamp. Red light doesn't interfere with melatonin production like blue or white light."},
              {"text": "📱 Digital detox: Set phone to airplane mode 1 hour before bed. Use a traditional alarm clock to avoid late-night scrolling temptation."},
              {"text": "🛏️ Temperature tip: Keep bedroom slightly cool (18-19°C). Your body temperature naturally drops for sleep, and a cool room facilitates this process."}
            ]
          }
        ]
      }
    };
  }

  // Generate fake hypothesis with fake data for testing
  private generateFakeHypothesis(): HypothesisResponse {
    const currentDate = new Date().toISOString();
    return {
      id: `fake_hypothesis_${Date.now()}`,
      createdAt: currentDate,
      updatedAt: currentDate,
      overall_hypothesis: "Lorem ipsum dolor sit amet, based on your responses, I believe your main challenges stem from consectetur adipiscing elit. Your goals around sed do eiusmod tempor are achievable with the right approach focusing on ut labore et dolore magna aliqua.",
      overall_hypothesis_components: [
        "Time constraints and irregular routines reduce consistency",
        "Stress and recovery patterns may be limiting sleep quality",
        "Nutrition timing/structure may not support sustained energy"
      ], // Added to satisfy updated schema
      user_assessment_hypothesis: "Looks good but I don't think you mentioned anything about my diet.",
      components: [
        {
          id: "fake_component_1",
          root_cause_hypothesis: "Lorem ipsum time constraints and irregular schedule are creating barriers to consistent wellness habits, leading to frustration and inconsistent progress.",
          root_cause_hypothesis_components: ["Lorem ipsum time", "constraints and irregular schedule are creating barriers", "to consistent wellness habits, leading to frustration and inconsistent progress."],
          summary: "Focus on consistency over perfection with time-efficient wellness routines"
        },
        {
          id: "fake_component_2",
          root_cause_hypothesis: "Consectetur adipiscing elit indicates potential stress and energy management issues that may be affecting sleep quality and recovery patterns.",
          root_cause_hypothesis_components: ["Lorem ipsum time", "constraints and irregular schedule are creating barriers", "to consistent wellness habits, leading to frustration and inconsistent progress."],
          summary: "Prioritize sleep optimization and stress management for foundational wellness"
        },
        {
          id: "fake_component_3",
          root_cause_hypothesis: "Sed do eiusmod tempor suggests nutrition patterns may not be supporting your energy needs and wellness goals effectively throughout the day.",
          root_cause_hypothesis_components: ["Lorem ipsum time", "constraints and irregular schedule are creating barriers", "to consistent wellness habits, leading to frustration and inconsistent progress."],
          summary: "Implement strategic nutrition timing for sustained energy and performance"
        }
      ]
    };
  }

  // Generate action plan based on user data and clarifying questions
  async generateActionPlan(
    onboardData: Onboard,
    systemPromptParam?: string,
    userPromptParam?: string,
    genFakePlan: boolean = false
  ): Promise<ActionPlanResponse> {
    glowLogger.info('generateActionPlan called', { genFakePlan });

    // Return fake plan if requested
    if (genFakePlan) {
      glowLogger.info('Returning fake action plan for testing', {});
      return harmonizeActionPlanResponse(this.generateFakePlan(), {
        weightKg: bodyWeightKgFromOnboard(onboardData),
      });
    }

    // Artificial fault injection for testing (50% probability)
    if (INJECT_ARTIFICIAL_FAULTS_50_PERCENT && Math.random() < 0.5) {
      throw new Error('Artificial fault injected for testing: Action plan generation failed');
    }

    try {
      let systemPrompt: string;
      let userPrompt: string;

      // If custom prompts provided, use them; otherwise use buildActionPlanPrompts
      if (systemPromptParam && userPromptParam) {
        systemPrompt = systemPromptParam;
        userPrompt = userPromptParam;
      } else {
        const prompts = this.buildActionPlanPrompts(onboardData);
        systemPrompt = prompts.systemPrompt;
        userPrompt = prompts.userPrompt;
      }

      glowLogger.info('Onboard data for plan generation', {
        onboard_data: onboardData,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        selected_goal: onboardData.selectedGoal,
        selected_coach: onboardData.selectedCoach,
        max_tokens: LLM_CONFIG.maxTokens.actionPlan
      });

      const result = await this.makeStructuredAPICall(
        systemPrompt,
        userPrompt,
        ActionPlanSchema,
        LLM_CONFIG.maxTokens.actionPlan,
        'ACTION PLAN',
        false, // Enable web search for action plan generation
        300 // 5 minutes timeout for plan generation (DeepSeek reasoner needs more time)
      );
      const withNames = substituteUserNameInObject(result, onboardData.name);
      return harmonizeActionPlanResponse(withNames, {
        weightKg: bodyWeightKgFromOnboard(onboardData),
      });
    } catch (error) {
      glowLogger.error('generateActionPlan failed', {
        error: error instanceof Error ? error.message : String(error),
        user_name: onboardData.name,
        selected_goal: onboardData.selectedGoal
      });
      
      // Re-throw the error so it can be caught by the calling code and shown to the user
      throw new Error(`Failed to generate action plan: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Generate hypothesis about how the user needs to improve their lifestyle
  async generateHypothesis(
    onboardData: Onboard, 
    systemPromptParam?: string, 
    userPromptParam?: string,
    genFakeHypothesis: boolean = false
  ): Promise<HypothesisResponse> {
    glowLogger.info('generateHypothesis called', { genFakeHypothesis });

    // Return fake hypothesis if requested
    if (genFakeHypothesis) {
      glowLogger.info('Returning fake hypothesis for testing', {});
      return this.generateFakeHypothesis();
    }

    try {
      // Artificial fault injection for testing (50% probability)
      if (INJECT_ARTIFICIAL_FAULTS_50_PERCENT && Math.random() < 0.5) {
        throw new Error('Artificial fault injected for testing: Hypothesis generation failed');
      }

      let systemPrompt: string;
      let userPrompt: string;

      // Validate and determine prompt sources
      if (systemPromptParam !== undefined && userPromptParam !== undefined) {
        // Both parameters provided - validate neither is empty
        if (!systemPromptParam || !userPromptParam) {
          throw new Error('If both systemPrompt and userPrompt are provided, neither can be empty');
        }
        systemPrompt = systemPromptParam;
        userPrompt = userPromptParam;
      } else if (systemPromptParam === undefined && userPromptParam === undefined) {
        // Neither parameter provided - use buildHypothesisPlanPrompts
        const prompts = this.buildHypothesisPlanPrompts(onboardData);
        systemPrompt = prompts.systemPrompt;
        userPrompt = prompts.userPrompt;
      } else {
        // Only one parameter provided - throw exception
        throw new Error('Both systemPrompt and userPrompt must be provided together, or neither should be provided');
      }

      glowLogger.info('Onboard data for hypothesis generation', {
        onboard_data: onboardData,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        selected_goal: onboardData.selectedGoal,
        selected_coach: onboardData.selectedCoach,
        max_tokens: LLM_CONFIG.maxTokens.actionPlan
      });

      const result = await this.makeStructuredAPICall(
        systemPrompt,
        userPrompt,
        HypothesisSchema,
        LLM_CONFIG.maxTokens.actionPlan,
        'HYPOTHESIS',
        false // Enable web search for hypothesis generation
      );
      return substituteUserNameInObject(result, onboardData.name);
    } catch (error) {
      glowLogger.error('generateHypothesis failed', {
        error: error instanceof Error ? error.message : String(error),
        user_name: onboardData.name,
        selected_goal: onboardData.selectedGoal
      });
      
      // Re-throw the error so it can be caught by the calling code and shown to the user
      throw new Error(`Failed to generate hypothesis: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async generateUserEditedActionPlanStep(onboardData: Onboard, stepIndexToUpdate: number, userChangeRequest: string): Promise<ActionPlanResponse> {
    glowLogger.info('generateUserEditedActionPlanStep called', { 
      step_index: stepIndexToUpdate,
      change_request: userChangeRequest 
    });

    // Artificial fault injection for testing (50% probability)
    if (INJECT_ARTIFICIAL_FAULTS_50_PERCENT && Math.random() < 0.5) {
      throw new Error('Artificial fault injected for testing: Action plan step edit failed');
    }

    try {
      // Extract the current plan and validate step index
      const currentPlan = onboardData.actionPlan;
      if (!currentPlan?.steps || currentPlan.steps.length === 0) {
        throw new Error('No action plan found in onboard data');
      }

      if (stepIndexToUpdate < 0 || stepIndexToUpdate >= currentPlan.steps.length) {
        throw new Error(`Invalid step index ${stepIndexToUpdate}. Plan has ${currentPlan.steps.length} steps.`);
      }

      const stepToUpdate = currentPlan.steps[stepIndexToUpdate];
      const oldActionPlanStepId = stepToUpdate.id;

      // Generate prompts for revising the specific step
      const { systemPrompt, userPrompt } = this.buildReviseSpecificActionPlanStepPrompts(
        onboardData, 
        userChangeRequest, 
        stepToUpdate
      );

      // Call LLM to generate the revised step
      const newActionPlanStep = await this.makeStructuredAPICall(
        systemPrompt,
        userPrompt,
        ActionPlanStepSchema,
        LLM_CONFIG.maxTokens.actionPlanStep,
        'PLAN STEP REVISION',
        false // Enable web search for action plan step revision
      );

      glowLogger.info('generateUserEditedActionPlanStep - Updating plan', {
        old_action_plan_step_id: oldActionPlanStepId,
        new_action_plan_step: JSON.stringify(newActionPlanStep)
      });

      // Update the plan with the new step
      const newActionPlan = this.updateModifiedActionPlanWithStep(
        oldActionPlanStepId,
        currentPlan,
        newActionPlanStep
      );

      glowLogger.info('generateUserEditedActionPlanStep - Final result', { 
        new_action_plan: JSON.stringify(newActionPlan) 
      });

      return harmonizeActionPlanResponse(newActionPlan, {
        weightKg: bodyWeightKgFromOnboard(onboardData),
      });
    } catch (error) {
      glowLogger.error('generateUserEditedActionPlanStep failed', {
        error: error instanceof Error ? error.message : String(error),
        user_name: onboardData.name,
        step_index: stepIndexToUpdate,
        change_request: userChangeRequest
      });
      
      // Re-throw the error so it can be caught by the calling code and shown to the user
      throw new Error(`Failed to edit action plan step: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  private updateModifiedActionPlanWithStep(
    stepIdToReplace: string,
    currentPlan: any,
    newStep: any
  ): ActionPlanResponse {
    // Handle both nested actionPlan structure and flat structure
    const actionPlan = currentPlan.actionPlan || currentPlan;
    const currentSteps = actionPlan.steps || [];
    
    // Find the index of the step to replace
    const stepIndex = currentSteps.findIndex((step: any) => step.id === stepIdToReplace);
    
    if (stepIndex === -1) {
      throw new Error(`Step with id ${stepIdToReplace} not found in current plan`);
    }
    
    // Create new steps array with the replaced step
    const updatedSteps = [...currentSteps];
    updatedSteps[stepIndex] = {
      ...newStep,
      dateModified: new Date().toISOString()
    };
    
    // Return the updated action plan in the correct format
    return {
      actionPlan: {
        id: actionPlan.id,
        createdAt: actionPlan.createdAt,
        updatedAt: new Date().toISOString(),
        rationale: actionPlan.rationale,
        steps: updatedSteps
      }
    };
  }

  // Wrapper to add timeout to async operations
  private withTimeout<T>(
    promise: Promise<T>, 
    timeoutSeconds: number, 
    operationName: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutSeconds} seconds`));
      }, timeoutSeconds * 1000);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  private async makeStructuredAPICall<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodSchema<T>,
    maxTokens: number,
    debugLabel: string,
    useWebSearch: boolean = false,
    timeoutSeconds: number = GENERATE_PLAN_TIMEOUT_SECS
  ): Promise<T> {
    // Generate JSON schema example and append to user prompt
    const schemaExample = this.generateSchemaExample(schema);
    const enhancedUserPrompt = `${userPrompt}\n\nRespond with valid JSON only in this exact format:\n${schemaExample}`;
    
    const executeCall = async (): Promise<T> => {
      const maxAttempts = 3;
      let lastParseError: Error | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        glowLogger.info(`${debugLabel} structured API LLM call started`, {
          attempt,
          system_prompt: systemPrompt,
          user_prompt: userPrompt,
          max_tokens: maxTokens,
          use_web_search: useWebSearch
        });

        const response = await this.makeAnthropicCall(
          systemPrompt,
          enhancedUserPrompt,
          maxTokens,
          undefined,
          useWebSearch
        );

        const messageContent = response.choices[0]?.message?.content;
        glowLogger.info('Message content received', { content: messageContent });

        if (!messageContent) {
          throw new Error('No content in API response');
        }

        // Parse and clean JSON response
        let cleanedContent = messageContent
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();

        glowLogger.info('Cleaned content', { cleaned_content: cleanedContent });

        let parsedResponse;
        try {
          parsedResponse = JSON.parse(cleanedContent);
        } catch (parseError) {
          lastParseError = parseError instanceof Error ? parseError : new Error(String(parseError));
          // Only log for debugging, do NOT show error in UI unless final attempt
          glowLogger.debug('JSON parse error (internal, will retry if attempts left)', {
            error: lastParseError.message,
            raw_content: messageContent,
            attempt
          });
          if (attempt < maxAttempts) {
            glowLogger.info(`JSON parse failed on attempt ${attempt}, will retry (remaining: ${maxAttempts - attempt})`, {});
            // Do NOT throw, just continue to next attempt (no UI error)
            continue;
          } else {
            // After all attempts, log as warning (never show errors to users)
            glowLogger.warn('JSON parse error (final attempt)', {
              error: lastParseError.message,
              raw_content: messageContent,
              attempt,
              debug_label: debugLabel
            });
            throw new Error(`Failed to parse JSON response after ${maxAttempts} attempts: ${lastParseError.message}`);
          }
        }

        const validatedResponse = schema.parse(parsedResponse);

        glowLogger.info(`${debugLabel} generated successfully`, {
          validated_response: JSON.stringify(validatedResponse)
        });

        return validatedResponse;
      } catch (error) {
        // Always log as warnings (never show errors to users)
        glowLogger.warn(`=== ${debugLabel} ERROR ===`, {});
        glowLogger.warn('Error type: ' + (error instanceof Error ? error.constructor.name : 'Unknown'), {});
        glowLogger.warn('Error message: ' + (error instanceof Error ? error.message : String(error)), {});
        glowLogger.warn('Error stack: ' + (error instanceof Error ? error.stack || 'No stack trace' : 'No stack trace'), {});
        glowLogger.warn('=== END ERROR ===', {});
        // Only throw if not a JSON parse error (which is handled above)
        if (!(lastParseError && error instanceof Error && error.message?.includes('Failed to parse JSON response'))) {
          throw error;
        }
        // Otherwise, intermediate parse errors are hidden from UI
      }
      }
      // If all attempts failed due to JSON parse error, throw last error (shows in UI)
      throw new Error(`Failed to parse JSON response after ${maxAttempts} attempts: ${lastParseError?.message || 'Unknown error'}`);
      };

    return this.withTimeout(executeCall(), timeoutSeconds, `${debugLabel} API call`);
  }

  // Generate initial welcome messages from coach (returns array of separate messages)
  async generateWelcomeMessage(context: Onboard): Promise<string[]> {
    try {
      glowLogger.info('Generating welcome message', { user_name: context.name });
      
      const systemPrompt = `You are ${context.selectedCoach}, a wellness coach. Generate a warm, personalized welcome sequence for your new client who just completed onboarding and accepted their action plan. Create exactly 2 separate messages that will be sent sequentially. Use appropriate emojis and match your coaching style as ${context.selectedCoach}.

${buildLanguageInstruction()}`;
      
      const userPrompt = `${this.buildUserContext(context)}

The user ${context.name} has just completed onboarding and accepted their personalized action plan for: ${context.selectedGoal}

Generate exactly 2 separate welcome texts following this structure:

FIRST TEXT: Express excitement about starting their journey, reference their specific plan/goal, and ask if they're clear with their plan. Keep it encouraging and personal.

SECOND TEXT: Let them know they can share how they feel or just chat casually. Make it feel supportive and open.

Requirements:
- Each text should be separate and complete
- Use 1-2 relevant emojis per text
- Keep each conversational yet concise (25-35 words)
- Match your coaching style as ${context.selectedCoach}
- Be specific about their goal: ${context.selectedGoal}
- Reference their actual plan when relevant
- DO NOT use the word "Message" in any of the texts

Format your response as a JSON array of exactly 2 strings:
["first welcome text here", "second welcome text here"]`;

      const response = await this.makeAnthropicCall(
        systemPrompt,
        userPrompt,
        800,
        0.8,
        false, // No web search for welcome messages
        1 // For welcome messages, only try Anthropic once before falling back to DeepSeek
      );

      const messageContent = response.choices[0]?.message?.content;
      
      if (!messageContent) {
        throw new Error('No content in API response');
      }

      // Parse JSON response
      let messages: string[];
      try {
        const cleanedContent = messageContent
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        
        const parsedResponse = JSON.parse(cleanedContent);
        
        // Handle both array format and object format responses
        if (Array.isArray(parsedResponse)) {
          messages = parsedResponse;
        } else if (parsedResponse.messages && Array.isArray(parsedResponse.messages)) {
          messages = parsedResponse.messages;
        } else {
          throw new Error('Response is not a valid array format');
        }
      } catch (parseError) {
        glowLogger.error('JSON parse error', {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          raw_content: messageContent
        });
        // Try the old separator method as fallback
        const fallbackMessages = messageContent.split('---').map(msg => msg.trim()).filter(msg => msg.length > 0);
        if (fallbackMessages.length === 2) {
          messages = fallbackMessages;
        } else {
          return this.createFallbackMessages(context);
        }
      }
      
      if (messages.length !== 2) {
        glowLogger.info('Expected 2 messages, got different count', { 
          message_count: messages.length 
        });
        return this.createFallbackMessages(context);
      }

      glowLogger.info('Generated welcome messages', { messages: JSON.stringify(messages) });
      return messages;
    } catch (error) {
      glowLogger.error('=== generateWelcomeMessage ERROR ===', {});
      glowLogger.error('Error: ' + String(error), {});
      glowLogger.error('=== END ERROR ===', {});
      
      // Fallback messages if LLM fails
      return this.createFallbackMessages(context);
    }
  }

  private createFallbackMessages(context: Onboard): string[] {
    return [
      `Hi ${context.name}! 👋 I'm so excited to start the ${context.selectedGoal} journey with you. Are you clear with your plan?`,
      `Also I am here for you if you just want to chat! 😊`,
      `I can also help you set reminders 🔔. I'm here to support you every step of the way!`
    ];
  }

  private buildUserContext(onboardData: Onboard): string {
    return `Based on the following user information: ${onboardToLLMString(onboardData)}`;
  }

  private generateSchemaExample<T>(schema: z.ZodSchema<T>): string {
    // Create a simple example JSON structure based on the schema
    // This is a basic implementation - for more complex schemas, you might want a more sophisticated approach
    
    try {
      // Generate a simple example based on schema structure
      if (schema instanceof z.ZodObject) {
        const shape = (schema as any).shape;
        const example: any = {};
        
        for (const [key, value] of Object.entries(shape)) {
          example[key] = this.generateValueExample(value as z.ZodTypeAny);
        }
        
        return JSON.stringify(example, null, 2);
      }
    } catch (error) {
      glowLogger.warn('Failed to generate schema example', { error: String(error) });
    }
    
    // Fallback to basic JSON structure
    return '{\n  "// Replace with actual values based on the schema"\n}';
  }

  private generateValueExample(zodType: z.ZodTypeAny): any {
    if (zodType instanceof z.ZodString) {
      return "string_value";
    } else if (zodType instanceof z.ZodNumber) {
      return 0;
    } else if (zodType instanceof z.ZodBoolean) {
      return true;
    } else if (zodType instanceof z.ZodArray) {
      return [this.generateValueExample((zodType as any)._def.type)];
    } else if (zodType instanceof z.ZodObject) {
      const shape = (zodType as any).shape;
      const obj: any = {};
      for (const [key, value] of Object.entries(shape)) {
        obj[key] = this.generateValueExample(value as z.ZodTypeAny);
      }
      return obj;
    } else if (zodType instanceof z.ZodEnum) {
      const options = (zodType as any)._def.values;
      return options[0];
    } else if (zodType instanceof z.ZodOptional) {
      return this.generateValueExample((zodType as any)._def.innerType);
    }
    
    return "value";
  }

  // ─── Dimension-Specific Survey Plan Generation ───────────────────────────

  public static buildDimensionSurveySystemPrompt(dimension: 'nutrition' | 'recovery'): string {
    if (dimension === 'nutrition') {
      return `You are an expert sports nutritionist and wellness coach.
Generate ONLY an updated Nutrition step (step_2) based on the user's detailed nutrition survey answers combined with their existing training plan context.

CRITICAL GUIDELINES STYLE:
- Provide GENERAL nutrition guidelines, NOT rigid meal schedules or "eat X at Y time" prescriptions.
- Suggest food categories and specific foods the user likes (from their survey answers) as natural options. For example: "Start mornings with oats and berries" or "Choose whole-grain options when possible" — NOT "Eat 200g oats at 7:00 AM."
- Incorporate the user's food preferences: recommend foods they enjoy, avoid foods they dislike, and respect their dietary restrictions.
- If the user has barriers to eating at home (time, travel, cooking skills), tailor recommendations accordingly — e.g., quick meal prep ideas, portable options, or simple no-cook meals.

The response must be a single action plan step in JSON with ALL of these fields:
- id: "step_2"
- title: clear, specific title for this nutrition plan
- description: 30 words max (overview shows first 15 words only)
- rationale: one-sentence evidence-based explanation
- detailed_rationale: array of 3-5 objects with "text" field (15-20 words each)
- priority: "high"
- dateAdded: current date string
- daysOfWeek: ["mon","tue","wed","thu","fri","sat","sun"]
- timeOfDay: "12:00"
- step_details: detailed nutrition plan as array of {text: string} — include "How Your Targets Were Calculated" section, then personalized guidelines organized by principle (protein, carbs, fats, hydration, meal ideas). Use the user's preferred foods. Do NOT create rigid meal schedules.
- bonus_hacks: array of 3-4 objects with "text" field
- step_title_scroll: max 3 words
- nutrition_targets: object with caloriesTarget, carbsTarget, proteinTarget, fatTarget, fiberTarget (numbers)
- dietary_plan: object with three keys (breakfast, lunch, dinner). Each key is an array of EXACTLY 2-3 concrete meal options. Each option has:
   - name: short title for the meal (e.g. "Greek yogurt parfait", "Sheet-pan salmon and veggies")
   - description: one short sentence (10-20 words) describing the meal, key ingredients, and approximate macros or rough portion guidance.
   Build these options ONLY from foods the user said they like (from "healthy_foods_liked" and "typical_day_eating"); never include foods listed in "foods_dislike" or "dietary_restrictions". Honor "barriers_eating_at_home" and the user's available time: if they have time constraints / can't cook / travel often, prefer quick (≤15 min), no-cook, portable, or batch-cook friendly options. The options across breakfast/lunch/dinner should together approximate the nutrition_targets when one of each is chosen.
- phase_2_title: clear, understandable name for the next progression (e.g. "Meal Timing Optimization", "Macro Periodization")
- phase_3_title: clear, understandable name for the mastery phase (e.g. "Advanced Nutrition Cycling", "Competition Prep Nutrition")

Phase names must be clear and understandable, not fancy jargon.
Respond with valid JSON only.

${buildLanguageInstruction()}`;
    }

    return `You are an expert recovery and sleep specialist, and wellness coach.
Generate ONLY an updated Recovery & Sleep step (step_3) based on the user's detailed recovery survey answers combined with their existing training plan context.

The response must be a single action plan step in JSON with ALL of these fields:
- id: "step_3"
- title: clear, specific title for this recovery plan
- description: 30 words max (overview shows first 15 words only)
- rationale: one-sentence evidence-based explanation
- detailed_rationale: array of 3-5 objects with "text" field (15-20 words each)
- priority: "high"
- dateAdded: current date string
- daysOfWeek: ["mon","tue","wed","thu","fri","sat","sun"]
- timeOfDay: "21:00"
- step_details: detailed recovery plan as array of {text: string} — include personalized sleep protocols, stress management techniques, recovery timing relative to training, and specific supplement recommendations
- bonus_hacks: array of 3-4 objects with "text" field
- step_title_scroll: max 3 words
- phase_2_title: clear, understandable name for the next progression (e.g. "Sleep Quality Optimization", "Active Recovery Protocols")
- phase_3_title: clear, understandable name for the mastery phase (e.g. "Advanced Recovery Tracking", "Peak Recovery System")

Phase names must be clear and understandable, not fancy jargon.
Respond with valid JSON only.

${buildLanguageInstruction()}`;
  }

  public static buildDimensionSurveyUserPrompt(
    dimension: 'nutrition' | 'recovery',
    onboardData: Onboard,
    surveyAnswers: Array<{question: string; answer: string}>,
    existingStep?: any
  ): string {
    const actualCurrentDate = new Date().toISOString();
    const calorieCalc = calculateBaseCalories(onboardData);

    const surveyQA = surveyAnswers.map(qa =>
      `Question: ${qa.question}\nAnswer: ${qa.answer}`
    ).join('\n\n');

    const onboardDataWithoutActionPlan = copyOnboardWithoutActionPlan(onboardData);
    const userContext = onboardToLLMString(onboardDataWithoutActionPlan);

    if (dimension === 'nutrition') {
      return `User context: ${userContext}

The user has completed a detailed nutrition survey. Their answers:
${surveyQA}

${existingStep ? `Current baseline nutrition plan:\nTitle: ${existingStep.title}\nDescription: ${existingStep.description}\nStep details: ${JSON.stringify(existingStep.step_details)}` : ''}

${calorieCalc ? `Pre-calculated base energy expenditure:
- BMR: ${calorieCalc.bmr} kcal/day
- Base TDEE (BMR + cardio + baseline movement, no plan training): ${calorieCalc.baseTdee} kcal/day
- Habitual cardio component already included: ${calorieCalc.cardioKcalPerDay} kcal/day${calorieCalc.cardioSummary ? ` (${calorieCalc.cardioSummary})` : ''}
- Baseline movement (non-training NEAT) already included: ${calorieCalc.baselineMovement.kcalPerDay} kcal/day (~${calorieCalc.baselineMovement.minutesPerDay} min/day brisk walk)
- Goal adjustment: ${calorieCalc.goalLabel} (×${calorieCalc.goalMultiplier})` : ''}

The user's goal is: "${onboardData.selectedGoal}"
Expertise level: ${onboardData.expertise_level}
Time available: ${onboardData.time_available}

Generate a comprehensive, personalized nutrition plan step (step_2) that:
1. Incorporates all survey answers (dietary restrictions, eating patterns, food preferences, cooking barriers, hydration, supplements)
2. Aligns with their training plan and goal
3. Uses GENERAL guidelines — NOT rigid meal schedules. For example:
   - If the user likes oats and berries → "Start mornings with oats topped with berries for sustained energy"
   - If they like salmon and avocado → "Include salmon or avocado-based meals 2-3 times per week for omega-3s"
   - Suggest whole grain options, lean protein choices, and healthy snack ideas based on what they like
4. AVOID prescriptive schedules like "eat X at 7AM, eat Y at 12PM". Instead provide flexible, lifestyle-friendly guidance.
5. If user has barriers (time, travel, can't cook), suggest practical solutions: quick prep, batch cooking, no-cook options
6. Provides clear, actionable nutrition_targets with calculated macros
7. Provides a concrete dietary_plan with 2-3 options each for breakfast, lunch, and dinner:
   - Use ONLY foods the user said they enjoy (from healthy_foods_liked and typical_day_eating). Strictly avoid anything in foods_dislike or that conflicts with dietary_restrictions.
   - Adapt complexity and prep time to time_available and barriers_eating_at_home. If they have little time, can't cook, or travel often, favor quick (≤15 min), no-cook, portable, or batch-cookable options. If they cook comfortably and have time, options can be a bit more involved.
   - Each option must include a short name plus a one-sentence description with the main ingredients and a rough portion or macro hint.
   - The set of options should plausibly combine (one breakfast + one lunch + one dinner) to land near the daily nutrition_targets, but do NOT lock the user into rigid times.
8. Has phase_2_title and phase_3_title with clear, understandable progression names
9. Uses "${actualCurrentDate}" for dateAdded

CRITICAL TEXT FORMATTING for step_details:
Use \\n for line breaks, \\n\\n between sections, **Bold Headers** for section names.`;
    }

    return `User context: ${userContext}

The user has completed a detailed recovery survey. Their answers:
${surveyQA}

${existingStep ? `Current baseline recovery plan:\nTitle: ${existingStep.title}\nDescription: ${existingStep.description}\nStep details: ${JSON.stringify(existingStep.step_details)}` : ''}

The user's goal is: "${onboardData.selectedGoal}"
Expertise level: ${onboardData.expertise_level}
Time available: ${onboardData.time_available}

Generate a comprehensive, personalized recovery & sleep plan step (step_3) that:
1. Incorporates all survey answers (sleep quality, routines, meditation, supplements, injuries)
2. Aligns with their training plan and goal
3. Includes specific sleep protocols, stress management techniques, and recovery timing
4. If the user reported pain in specific body areas (check "existing_pain" in their onboarding answers), include targeted recovery guidance for those areas (e.g., mobility work, stretching, foam rolling) while being careful NOT to frame it as medical treatment
4. Has phase_2_title and phase_3_title with clear, understandable progression names
5. Uses "${actualCurrentDate}" for dateAdded

CRITICAL TEXT FORMATTING for step_details:
Use \\n for line breaks, \\n\\n between sections, **Bold Headers** for section names.`;
  }

  async generateDimensionPlan(
    dimension: 'nutrition' | 'recovery',
    onboardData: Onboard,
    surveyAnswers: Array<{question: string; answer: string}>,
    existingStep?: any
  ): Promise<z.infer<typeof ActionPlanStepSchema>> {
    glowLogger.info(`generateDimensionPlan called for ${dimension}`, {});

    try {
      const systemPrompt = LLMService.buildDimensionSurveySystemPrompt(dimension);
      const userPrompt = LLMService.buildDimensionSurveyUserPrompt(dimension, onboardData, surveyAnswers, existingStep);

      glowLogger.info(`Dimension plan prompts built for ${dimension}`, {
        system_prompt_length: systemPrompt.length,
        user_prompt_length: userPrompt.length,
      });

      return await this.makeStructuredAPICall(
        systemPrompt,
        userPrompt,
        ActionPlanStepSchema,
        LLM_CONFIG.maxTokens.actionPlan,
        `DIMENSION PLAN (${dimension})`,
        false,
        300
      );
    } catch (error) {
      glowLogger.error(`generateDimensionPlan failed for ${dimension}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to generate ${dimension} plan: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
    
}

export const llmService = new LLMService();
export { ActionPlanStepSchema, HypothesisComponentSchema, HypothesisSchema, LLMService };
export type { ActionPlanResponse, ClarifyingQuestions, HypothesisResponse };


