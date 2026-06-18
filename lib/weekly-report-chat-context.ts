import type { WeeklyReportMetrics } from './weekly-report-metrics';
import type { WeeklyReportNarrative } from './weekly-report-state';

function periodLabelForMode(mode: WeeklyReportMetrics['scheduleMode']): string {
  return mode === 'mon_sun_mon1800' ? 'Mon–Sun' : 'Sun–Sat';
}

/**
 * Text block appended to the coach chat system prompt (via dataSnapshot) so the model
 * knows what the user just saw in the weekly check-in UI.
 */
export function buildWeeklyReportChatContext(
  metrics: WeeklyReportMetrics | null,
  narrative: WeeklyReportNarrative | null,
): string {
  const lines: string[] = [
    '### Weekly check-in (user opened this from the in-app weekly check-in)',
    'The user may edit their message before sending; treat their question as primary.',
  ];

  if (metrics) {
    lines.push(
      `Check-in window (${periodLabelForMode(metrics.scheduleMode)}): ${metrics.reportingPeriodStart} → ${metrics.reportingPeriodEnd}`,
      'Four 7-day slices (label → consistency %, workouts, activities, total training, meal credits capped 3/day):',
    );
    for (const w of metrics.weeks) {
      lines.push(
        `- ${w.labelShort}: consistency ${w.consistency}/100, workouts ${w.workoutSessions}, activities ${w.activitySessions}, total training ${w.totalTrainingSessions}, meals (capped) ${w.mealsCapped}/21`,
      );
    }
    const h = metrics.highlightsForLLM;
    lines.push(
      `Training volume (kg × reps, this week vs prior): ${h.volumeLiftedKgThisWeek} vs ${h.volumeLiftedKgPriorWeek}`,
      `Activity calories burned (this week vs prior): ${h.activityCaloriesBurnedThisWeek} vs ${h.activityCaloriesBurnedPriorWeek}`,
      `Activity duration min (this week vs prior): ${h.activityDurationMinutesThisWeek} vs ${h.activityDurationMinutesPriorWeek}`,
      `Total estimated calories (workouts + activities, this week vs prior): ${h.totalEstimatedCaloriesThisWeek} vs ${h.totalEstimatedCaloriesPriorWeek}`,
      `Protein logged (g, this week vs prior): ${h.proteinGramsThisWeek} vs ${h.proteinGramsPriorWeek}`,
    );
    if (h.proteinChangePercentVsPriorWeek != null) {
      lines.push(`Protein vs prior week: ${h.proteinChangePercentVsPriorWeek}%`);
    }
    if (h.bodyComposition) {
      const b = h.bodyComposition;
      lines.push(
        `Body composition (logs ${b.priorLogDate} → ${b.latestLogDate}): muscle % Δ ${b.musclePercentDelta}, fat % Δ ${b.fatPercentDelta}, estimated lean mass Δ ${b.estimatedLeanMassKgDelta} kg`,
      );
    }
    if (metrics.macrosThisWeek) {
      const m = metrics.macrosThisWeek;
      lines.push(
        `Weekly macros logged: ${m.calories} kcal, ${m.carbsGrams}g carbs (${m.carbsCalPct}%), ${m.proteinGrams}g protein (${m.proteinCalPct}%), ${m.fatGrams}g fat (${m.fatCalPct}%)`,
      );
    }
    if (metrics.weeklyMacroTargets) {
      const t = metrics.weeklyMacroTargets;
      lines.push(
        `Weekly nutrition targets: ${t.caloriesTarget} kcal, ${t.carbsTarget}g C, ${t.proteinTarget}g P, ${t.fatTarget}g F`,
      );
    }
    if (metrics.macroVsTargets) {
      const v = metrics.macroVsTargets;
      lines.push(
        `Macro vs target this week: calories ${v.caloriesPctOfTarget}% (Δ ${v.caloriesDelta} kcal), carbs ${v.carbsPctOfTarget}% (Δ ${v.carbsDelta}g), protein ${v.proteinPctOfTarget}% (Δ ${v.proteinDelta}g), fat ${v.fatPctOfTarget}% (Δ ${v.fatDelta}g)`,
      );
    }
    if (metrics.mealDescriptionSamples.length > 0) {
      lines.push(
        `Recent meal descriptions (newest first, capped): ${metrics.mealDescriptionSamples.slice(0, 20).join(' | ')}`,
      );
    }
  }

  if (narrative) {
    lines.push(
      `Coach-facing check-in title: ${narrative.reportTitle}`,
      `Hero tone: ${narrative.heroMood}`,
      `Spotlight lines: ${narrative.spotlightFacts.join(' | ')}`,
      `Headline: ${narrative.headline}`,
      `Wins: ${narrative.winsBullets.join(' ')}`,
      `Focus next: ${narrative.improvementBullets.join(' ')}`,
    );
  }

  return lines.join('\n');
}
