import OpenAI from 'openai';
import {
  weeklyReportMetricsFingerprint,
  type WeeklyReportMetrics,
  type WeeklyReportWeekSlice,
} from './weekly-report-metrics';
import type { WeeklyReportHeroMood, WeeklyReportNarrative } from './weekly-report-state';
import { glowLogger } from './glow-logger';
import { getCurrentLanguage } from './i18n';

const openai = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY || '',
});

/** Strong default for coach copy; avoids the cheapest mini models. */
const WEEKLY_REPORT_MODEL = 'gpt-4o';

export interface WeeklyReportNarrativeInput {
  coachName: string;
  coachPersonality: string;
  userFirstName: string;
  metrics: WeeklyReportMetrics;
}

function weeklyReportLanguageBlock(): string {
  const lang = getCurrentLanguage();
  if (lang?.toLowerCase().startsWith('es')) {
    return '\n\nIMPORTANT: Write every JSON string value in Spanish (clear Latin American tone), keeping the same schema and coach voice.';
  }
  return '\n\nIMPORTANT: Write every JSON string value in clear English.';
}

function replaceName(s: string, first: string): string {
  return s.replace(/USER_NAME/g, first);
}

function normalizeHeroMood(raw: unknown): WeeklyReportHeroMood {
  if (raw === 'applauding' || raw === 'celebrate' || raw === 'explaining') return raw;
  return 'explaining';
}

function attachFingerprint(
  narrative: Omit<WeeklyReportNarrative, 'metricsFingerprint'>,
  metrics: WeeklyReportMetrics,
): WeeklyReportNarrative {
  return { ...narrative, metricsFingerprint: weeklyReportMetricsFingerprint(metrics) };
}

function trainingTrendSummary(w0: WeeklyReportWeekSlice, w1?: WeeklyReportWeekSlice): string {
  if (!w1) return 'use this week as a baseline and add sessions when life allows.';
  if (w0.totalTrainingSessions > w1.totalTrainingSessions) return 'more sessions than the week before.';
  if (w0.totalTrainingSessions < w1.totalTrainingSessions) return 'fewer sessions than the week before.';
  return 'the same number of sessions as the week before.';
}

function mealTrendSummary(w0: WeeklyReportWeekSlice, w1?: WeeklyReportWeekSlice): string {
  if (!w1) return 'keep logging meals to clarify patterns over time.';
  if (w0.mealsCapped > w1.mealsCapped) return 'more meal logs than last week.';
  if (w0.mealsCapped < w1.mealsCapped) return 'fewer meal logs than last week.';
  return 'about the same meal logging as last week.';
}

function inferFallbackMood(metrics: WeeklyReportMetrics): WeeklyReportHeroMood {
  const c = metrics.weeks[0]?.consistency ?? 0;
  const vol = metrics.highlightsForLLM.volumeLiftedKgThisWeek;
  const actCal = metrics.highlightsForLLM.activityCaloriesBurnedThisWeek;
  const w0 = metrics.weeks[0];
  const w1 = metrics.weeks[1];
  const sessionsUp = Boolean(w0 && w1 && w0.totalTrainingSessions > w1.totalTrainingSessions);
  if (c >= 80 || (sessionsUp && c >= 65 && (vol >= 2000 || actCal >= 1500))) return 'celebrate';
  if (c >= 55 || sessionsUp || vol >= 1500 || actCal >= 800) return 'applauding';
  return 'explaining';
}

/**
 * Choose a single heavy-object comparison for the user's total training volume.
 * Tiers escalate from "washing machine" up to "vehicle scale" and are only emitted
 * once the lifted total feels impressive (≥ 1500 kg). Smaller domestic objects (TVs,
 * microwaves) are deliberately avoided — they don't read as celebratory.
 */
function heavyObjectVolumeComparison(volumeKg: number): string | null {
  if (volumeKg < 1500) return null;
  const tiers: Array<{ kg: number; object: string }> = [
    { kg: 70, object: 'washing machine' },
    { kg: 200, object: 'upright piano' },
    { kg: 500, object: 'grand piano' },
    { kg: 900, object: 'small car' },
    { kg: 1500, object: 'mid-size car' },
    { kg: 3000, object: 'pickup truck' },
  ];
  let chosen = tiers[0];
  for (const tier of tiers) {
    if (volumeKg / tier.kg >= 1.2) chosen = tier;
  }
  const mult = volumeKg / chosen.kg;
  const multStr = mult >= 10 ? mult.toFixed(0) : mult.toFixed(1);
  return `You moved ${Math.round(volumeKg)} kg in training — roughly ${multStr}× a ${chosen.object}.`;
}

function buildFallbackSpotlightFacts(input: WeeklyReportNarrativeInput): string[] {
  const { metrics, userFirstName } = input;
  const h = metrics.highlightsForLLM;
  const w0 = metrics.weeks[0];
  const w1 = metrics.weeks[1];
  const facts: string[] = [];

  const heavyObject = heavyObjectVolumeComparison(h.volumeLiftedKgThisWeek);
  if (heavyObject) {
    facts.push(heavyObject);
  }

  if (h.proteinChangePercentVsPriorWeek !== null && h.proteinChangePercentVsPriorWeek >= 5 && h.proteinGramsPriorWeek > 0) {
    facts.push(`Protein logging was up about ${Math.round(h.proteinChangePercentVsPriorWeek)}% vs last week.`);
  }

  const bc = h.bodyComposition;
  if (bc) {
    if (bc.fatPercentDelta <= -0.3) {
      facts.push(`Body-composition trend: fat % down about ${Math.abs(bc.fatPercentDelta).toFixed(1)} points since your prior check-in.`);
    } else if (bc.estimatedLeanMassKgDelta >= 0.2) {
      facts.push(
        `Estimated lean mass from your scans is up about ${bc.estimatedLeanMassKgDelta.toFixed(1)} kg — nice trajectory.`,
      );
    } else if (bc.musclePercentDelta >= 0.3) {
      facts.push(`Muscle % is up about ${bc.musclePercentDelta.toFixed(1)} points vs your previous log.`);
    }
  }

  if (h.totalEstimatedCaloriesThisWeek >= 300) {
    facts.push(
      `You burned an estimated ${h.totalEstimatedCaloriesThisWeek.toLocaleString()} calories across all training this week!`,
    );
  } else if (h.activityDurationMinutesThisWeek >= 30) {
    const hrs = Math.round(h.activityDurationMinutesThisWeek / 6) / 10;
    facts.push(
      `${hrs}h of logged activities this week — movement is medicine.`,
    );
  }

  if (facts.length === 0 && w0) {
    facts.push(`${w0.totalTrainingSessions} training sessions logged — every rep counts.`);
    if (w1 && w0.consistency > w1.consistency) {
      facts.push('Consistency edged up compared with last week.');
    }
  }

  return facts.slice(0, 3);
}

/** Surface the most-off macro relative to weekly targets as a gentle next-week focus. */
function macroFocusImprovement(input: WeeklyReportNarrativeInput): string | null {
  const v = input.metrics.macroVsTargets;
  if (!v) return null;
  const candidates: Array<{ label: string; pct: number; delta: number; unit: string }> = [
    { label: 'calories', pct: v.caloriesPctOfTarget, delta: v.caloriesDelta, unit: 'kcal' },
    { label: 'carbs', pct: v.carbsPctOfTarget, delta: v.carbsDelta, unit: 'g' },
    { label: 'protein', pct: v.proteinPctOfTarget, delta: v.proteinDelta, unit: 'g' },
    { label: 'fat', pct: v.fatPctOfTarget, delta: v.fatDelta, unit: 'g' },
  ];
  const offTarget = candidates.filter(c => c.pct > 0 && (c.pct < 85 || c.pct > 115));
  if (offTarget.length === 0) return null;
  offTarget.sort((a, b) => Math.abs(b.pct - 100) - Math.abs(a.pct - 100));
  const top = offTarget[0];
  if (top.pct < 100) {
    return `You came in about ${100 - top.pct}% under your weekly ${top.label} target — nudging up ${Math.abs(top.delta)} ${top.unit} could help next week.`;
  }
  return `You ran about ${top.pct - 100}% above your weekly ${top.label} target — easing back ~${Math.abs(top.delta)} ${top.unit} next week keeps you in range.`;
}

/** Pick the most frequent meaningful token from meal descriptions and turn it into a gentle hint. */
function mealHintFromSamples(samples: string[]): string | null {
  if (samples.length < 3) return null;
  const stop = new Set([
    'with', 'and', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'or',
    'breakfast', 'lunch', 'dinner', 'snack', 'meal', 'small', 'large', 'big', 'mini',
    'side', 'plate', 'bowl', 'cup', 'glass', 'serving',
  ]);
  const counts = new Map<string, number>();
  for (const s of samples) {
    const tokens = s.toLowerCase().replace(/[^a-záéíóúñ\s]/gi, ' ').split(/\s+/);
    const seen = new Set<string>();
    for (const tok of tokens) {
      if (tok.length < 4 || stop.has(tok)) continue;
      if (seen.has(tok)) continue;
      seen.add(tok);
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  let topToken: string | null = null;
  let topCount = 0;
  for (const [tok, c] of counts.entries()) {
    if (c > topCount) {
      topToken = tok;
      topCount = c;
    }
  }
  if (!topToken || topCount < 3) return null;
  if (topToken === 'rice') {
    return 'You often logged rice — if it usually means white rice, brown or wild rice has a lower glycemic index and still fuels your sessions.';
  }
  if (topToken === 'bread' || topToken === 'pasta') {
    return `You logged ${topToken} a few times — swapping in a whole-grain version once or twice keeps the carbs but adds fiber.`;
  }
  if (topToken === 'chicken' || topToken === 'beef' || topToken === 'pork' || topToken === 'salmon' || topToken === 'fish' || topToken === 'eggs') {
    return `Lots of ${topToken} this week — solid protein anchor. Rotating in another protein source mid-week keeps amino-acid variety up.`;
  }
  return `You logged ${topToken} ${topCount}× this week — worth checking with me if there's a tweak that fits your goals better.`;
}

function buildFallbackNarrative(input: WeeklyReportNarrativeInput): WeeklyReportNarrative {
  const { metrics, coachName, userFirstName } = input;
  const w0 = metrics.weeks[0];
  const w1 = metrics.weeks[1];
  const trainTrend = trainingTrendSummary(w0, w1);
  const mealTrend = mealTrendSummary(w0, w1);

  const mood = inferFallbackMood(metrics);
  const titles: Record<WeeklyReportHeroMood, string> = {
    celebrate: `${userFirstName}, what a week!`,
    applauding: `${userFirstName}, solid momentum`,
    explaining: `${userFirstName}, your week decoded`,
  };

  const improvementBullets: string[] = [];
  const macroFocus = macroFocusImprovement(input);
  if (macroFocus) improvementBullets.push(macroFocus);
  const mealHint = mealHintFromSamples(metrics.mealDescriptionSamples);
  if (mealHint) improvementBullets.push(mealHint);
  if (improvementBullets.length === 0) {
    improvementBullets.push(
      w0.consistency < 60
        ? 'Focus on one extra workout or one more logged meal day next week to lift your score.'
        : 'Pick one habit to tighten next week (e.g. post-workout meal or an extra session).',
    );
  }

  return attachFingerprint(
    {
      reportTitle: titles[mood],
      heroMood: mood,
      heroTagline: `${userFirstName}, let's analyze your progress…`,
      spotlightFacts: buildFallbackSpotlightFacts(input),
      headline: `${userFirstName}, here's your week in motion`,
      winsBullets: [
        `Consistency score this week: ${w0.consistency}/100.`,
        w0.activitySessions > 0
          ? `${w0.workoutSessions} workout(s) + ${w0.activitySessions} activity session(s) logged — ${trainTrend}`
          : `${w0.workoutSessions} workout session(s) logged — ${trainTrend}`,
        `${w0.mealsCapped} meal credits toward your weekly nutrition target (max 21) — ${mealTrend}`,
      ],
      improvementBullets: improvementBullets.slice(0, 3),
      closing: `— ${coachName}`,
    },
    metrics,
  );
}

export async function generateWeeklyReportNarrative(
  input: WeeklyReportNarrativeInput,
): Promise<WeeklyReportNarrative> {
  const fallback = buildFallbackNarrative(input);

  if (!process.env.EXPO_PUBLIC_OPENAI_API_KEY) {
    return fallback;
  }

  const metricsJson = JSON.stringify({
    weeks: input.metrics.weeks.map(w => ({
      label: w.labelShort,
      consistency: w.consistency,
      workouts: w.workoutSessions,
      activities: w.activitySessions,
      totalTraining: w.totalTrainingSessions,
      mealsCapped: w.mealsCapped,
    })),
    plannedTrainingDaysPerWeek: input.metrics.plannedTrainingDaysPerWeek,
    highlights: input.metrics.highlightsForLLM,
    macrosThisWeek: input.metrics.macrosThisWeek,
    weeklyMacroTargets: input.metrics.weeklyMacroTargets,
    macroVsTargets: input.metrics.macroVsTargets,
    mealDescriptionSamples: input.metrics.mealDescriptionSamples.slice(0, 20),
  });

  try {
    const response = await openai.chat.completions.create({
      model: WEEKLY_REPORT_MODEL,
      max_completion_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are ${input.coachName}, a wellness coach. Personality: ${input.coachPersonality}

Produce ONE JSON object for a weekly progress check-in (same concept as a weekly recap, but call it a check-in in tone — not a formal "report"). All copy must match the coach voice.

Schema (exact keys):
{
  "reportTitle": "string, max 42 chars, exciting, personalized — motivates opening the check-in (avoid the word 'report'; prefer check-in / recap / week in review)",
  "heroMood": "explaining" | "applauding" | "celebrate",
  "heroTagline": "string, max 90 chars, spoken to USER_NAME — white text over hero photo. Match heroMood: explaining = warm analytic invite; applauding = proud recognition; celebrate = energetic praise.",
  "spotlightFacts": ["1-3 strings, each max 140 chars — BIG positive 'wow' facts for large type"],
  "headline": "string, max 72 chars, bridges into detail",
  "winsBullets": ["1-2 strings, deeper detail; do NOT repeat spotlightFacts verbatim"],
  "improvementBullets": ["1-2 kind constructive strings"],
  "closing": "warm sign-off, your voice, no markdown"
}

Data fields explained:
- weeks[n].workouts = gym/strength training sessions
- weeks[n].activities = logged activities (running, cycling, swimming, hiking, sports, etc.)
- weeks[n].totalTraining = workouts + activities combined
- highlights.activityCaloriesBurnedThisWeek / PriorWeek = sum of calories from logged activities
- highlights.activityDurationMinutesThisWeek / PriorWeek = sum of duration from logged activities
- highlights.volumeLiftedKgThisWeek = total weight × reps in kg from strength training
- highlights.estimatedWorkoutCaloriesThisWeek / PriorWeek = rough kcal estimate from strength training (volumeKg / 6)
- highlights.totalEstimatedCaloriesThisWeek / PriorWeek = activityCalories + estimatedWorkoutCalories (best total energy estimate)
- macrosThisWeek = summed macros logged across the assessed period: { calories, carbsGrams, proteinGrams, fatGrams, fiberGrams, carbsCalPct, proteinCalPct, fatCalPct }. May be null if no meals logged.
- weeklyMacroTargets = the user's daily nutrition targets multiplied by 7 (caloriesTarget, carbsTarget, proteinTarget, fatTarget, fiberTarget). May be null if no targets set.
- macroVsTargets = signed delta (logged minus target) and percent of target for calories, carbs, protein, fat. Use this for under/over framing rather than recomputing.
- mealDescriptionSamples = recent free-text meal descriptions logged by the user (newest first). Use to spot food patterns for hints; never quote verbatim if it looks like PII or contains a person's name.

Rules:
- Use ONLY numbers and trends supported by the metrics JSON (weeks + highlights + macros + macroVsTargets). Never invent statistics.
- CRITICAL: For "this week", reuse the EXACT integers from weeks[0] (consistency, workouts, activities, totalTraining, mealsCapped) in spotlightFacts and winsBullets. If values tie week −1, say "same as last week" — never "held or improved" unless strictly true.
- Activities (running, cycling, sports, etc.) count as real training. If the user has logged activities, highlight them proudly alongside workouts. Use totalTraining when summarizing overall training effort.
- spotlightFacts: Be CREATIVE and FUN with analogies! Ground them in math from the metrics.
  * Volume-lifted analogies MUST use HEAVY objects to feel impressive. Use household-or-larger anchors: washing machine (~70 kg), upright piano (~200 kg), grand piano (~500 kg), small car (~900 kg), mid-size car (~1500 kg), pickup truck (~3000 kg). Only emit one of these when volumeLiftedKgThisWeek ≥ 1500 kg. DO NOT use small objects (TV, microwave, laptop, toaster) for volume comparisons — they don't read as celebratory and are forbidden here.
  * Calorie-burn analogies can stay playful — vary the food/drink item each time. Reference kcals per unit: pizza slice ~285 kcal, croissant ~270 kcal, burger ~500 kcal, baklava piece ~180 kcal, beer (330 ml) ~150 kcal, gin & tonic ~120 kcal, Aperol Spritz ~125 kcal, tiramisu slice ~240 kcal, falafel wrap ~450 kcal, brownie ~240 kcal, glass of wine ~120 kcal. Pick whatever is most fun given the calorie total — don't default to pizza every time.
  * Distance / wattage analogies stay welcome when the underlying metric is non-trivial.
  These are starting points — invent your own creative comparisons. Make it playful, surprising, and uplifting. Always show the math is sound.
- Macro feedback: Comment on under AND over vs weekly targets across calories, carbs, protein, AND fat — not protein only. Use macroVsTargets percentages directly (e.g. "carbs landed at X% of your weekly target"). Keep it neutral and non-shaming.
- Food-pattern hint: If mealDescriptionSamples has 3+ entries, include exactly ONE gentle, specific food/habit hint as either a winsBullet or an improvementBullet. Example tones: "You often had white rice — brown rice has a lower glycemic index and still fuels your sessions, want to try it?", "I noticed lots of pasta logged — swapping in whole-grain a few times keeps the carbs but adds fiber.", "Recovery feels heavy? Magnesium can help — ask me which kind fits you." Never prescribe doses or make medical claims; invite the user to ask the coach for specifics.
- FORBIDDEN in any field: shaming, guilt, comparing the user unfavorably to others, mocking food choices, or animal-quantity food jokes (no "chickens", "cows", "pigs", etc.). Never celebrate or emphasize total weight gain on the scale as a win. If body-composition data shows higher fat % or lower muscle %, frame gently as neutral "next week focus" in improvementBullets only — not in spotlightFacts or heroTagline.
- If a highlight or macro field is missing or zero, skip facts that depend on it.
- heroMood + reportTitle + heroTagline must be consistent (celebrate only when the week genuinely warrants high energy per data). Prefer "check-in" framing over "report" in all user-facing strings.
- Use placeholder USER_NAME for the user's first name; the app replaces it.${weeklyReportLanguageBlock()}`,
        },
        {
          role: 'user',
          content: `User first name: ${input.userFirstName}\nMetrics JSON:\n${metricsJson}`,
        },
      ],
    });

    const raw = (response.choices[0]?.message?.content || '').trim();
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const reportTitleRaw = typeof parsed.reportTitle === 'string' ? parsed.reportTitle : fallback.reportTitle;
    const reportTitle = replaceName(reportTitleRaw, input.userFirstName).slice(0, 48);

    const heroMood = normalizeHeroMood(parsed.heroMood);

    const heroTaglineRaw = typeof parsed.heroTagline === 'string' ? parsed.heroTagline : fallback.heroTagline;
    const heroTagline = replaceName(heroTaglineRaw, input.userFirstName).slice(0, 100);

    const spotlightFacts = Array.isArray(parsed.spotlightFacts)
      ? (parsed.spotlightFacts as unknown[])
          .filter((x): x is string => typeof x === 'string')
          .map(s => replaceName(s, input.userFirstName))
          .slice(0, 3)
      : fallback.spotlightFacts;
    const headline =
      typeof parsed.headline === 'string'
        ? replaceName(parsed.headline, input.userFirstName)
        : fallback.headline;
    const winsBullets = Array.isArray(parsed.winsBullets)
      ? (parsed.winsBullets as unknown[]).filter((x): x is string => typeof x === 'string').map(s => replaceName(s, input.userFirstName)).slice(0, 3)
      : fallback.winsBullets;
    const improvementBullets = Array.isArray(parsed.improvementBullets)
      ? (parsed.improvementBullets as unknown[])
          .filter((x): x is string => typeof x === 'string')
          .map(s => replaceName(s, input.userFirstName))
          .slice(0, 3)
      : fallback.improvementBullets;
    const closing =
      typeof parsed.closing === 'string' ? replaceName(parsed.closing, input.userFirstName) : fallback.closing;

    if (spotlightFacts.length === 0 || winsBullets.length === 0 || improvementBullets.length === 0) {
      return fallback;
    }

    return attachFingerprint(
      {
        reportTitle,
        heroMood,
        heroTagline,
        spotlightFacts,
        headline,
        winsBullets,
        improvementBullets,
        closing,
      },
      input.metrics,
    );
  } catch (e) {
    glowLogger.warn('generateWeeklyReportNarrative LLM failed, using fallback', {
      error: e instanceof Error ? e.message : String(e),
    });
    return fallback;
  }
}
