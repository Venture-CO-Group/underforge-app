import { glowLogger } from './glow-logger';
import type { WeeklyReportMetrics } from './weekly-report-metrics';
import type { WeeklyReportNarrative } from './weekly-report-state';

function buildSummaryText(narrative: WeeklyReportNarrative): string {
  const lines: string[] = [];
  lines.push(narrative.reportTitle);
  lines.push('');
  if (narrative.spotlightFacts.length > 0) {
    for (const fact of narrative.spotlightFacts) {
      lines.push(`• ${fact}`);
    }
    lines.push('');
  }
  lines.push(narrative.headline);
  for (const win of narrative.winsBullets) {
    lines.push(`  ✓ ${win}`);
  }
  for (const imp of narrative.improvementBullets) {
    lines.push(`  → ${imp}`);
  }
  lines.push('');
  lines.push(narrative.closing);
  return lines.join('\n');
}

export async function upsertWeeklyCheckinReport(
  userId: string,
  metrics: WeeklyReportMetrics,
  narrative: WeeklyReportNarrative | null,
  status: 'viewed' | 'skipped' = 'viewed',
): Promise<void> {
  try {
    const { supabase } = await import('./supabase_db_new');
    if (!supabase) {
      glowLogger.info('Supabase not initialized, skipping weekly check-in upload', {});
      return;
    }

    const w0 = metrics.weeks[0];
    const h = metrics.highlightsForLLM;
    const bc = h.bodyComposition;

    const row: Record<string, unknown> = {
      user_id: userId,
      week_start: metrics.reportingPeriodStart,
      week_end: metrics.reportingPeriodEnd,
      consistency_score: w0?.consistency ?? 0,
      workout_sessions: w0?.workoutSessions ?? 0,
      activity_sessions: w0?.activitySessions ?? 0,
      total_training_sessions: w0?.totalTrainingSessions ?? 0,
      meals_logged: w0?.mealsCapped ?? 0,
      volume_lifted_kg: h.volumeLiftedKgThisWeek,
      protein_grams: h.proteinGramsThisWeek,
      total_estimated_calories: h.totalEstimatedCaloriesThisWeek,
      weight_kg: bc?.weightKgLatest ?? null,
      muscle_percent: bc?.musclePercentLatest ?? null,
      fat_percent: bc?.fatPercentLatest ?? null,
      lean_mass_kg: bc?.estimatedLeanMassKgLatest ?? null,
      weight_kg_prior: bc?.weightKgPrior ?? null,
      muscle_percent_delta: bc?.musclePercentDelta ?? null,
      fat_percent_delta: bc?.fatPercentDelta ?? null,
      lean_mass_kg_delta: bc?.estimatedLeanMassKgDelta ?? null,
      narrative_json: narrative ?? null,
      summary_text: narrative ? buildSummaryText(narrative) : null,
      status,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('weekly_checkin_reports')
      .upsert(row, { onConflict: 'user_id,week_start' });

    if (error) {
      glowLogger.error('Error upserting weekly check-in report to Supabase', {
        error: error.message,
        user_id: userId,
        week_start: metrics.reportingPeriodStart,
      });
      return;
    }

    glowLogger.info('Weekly check-in report synced to Supabase', {
      user_id: userId,
      week_start: metrics.reportingPeriodStart,
      status,
    });
  } catch (error) {
    glowLogger.error('Error saving weekly check-in report to Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
  }
}
