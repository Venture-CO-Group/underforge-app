import { ActionStep, Onboard } from '../types/onboard';
import { glowLogger } from './glow-logger';
import { getMealLogsForDateRange, getTodayNutrition } from './nutrition-storage';
import { getExerciseLogsForWorkout, getWorkoutLogsForDateRange } from './workout-storage';
import { getActivityLogsForDateRange } from './activity-storage';

// Snapshot content when the classifier decides the chat coach needs the user's
// logged data. Keep it simple and avoid duplicating information the system
// prompt already carries (which includes the full onboard profile and action
// plan via onboardToLLMString).
//
// Included:
//   - TODAY: date + day-of-week, today's planned action-plan steps (filtered by
//     daysOfWeek, with step details), today's nutrition consumed/target/remaining
//   - LAST 2 WEEKS (Mon of previous week → today, inclusive): meals, workouts,
//     activities with timestamps and details

const DAY_ABBREVS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_FULL_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

// Caps to keep the prompt compact. Two weeks of aggressive logging can exceed
// these; older/extra entries are dropped (newest retained).
const MAX_MEALS_IN_RANGE = 60;
const MAX_WORKOUTS_IN_RANGE = 20;
const MAX_ACTIVITIES_IN_RANGE = 20;

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTimeHM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Default lookback for the on-demand detail snapshot. A fixed-day window is
// used (rather than "Monday of last week", which could be anywhere from 7-13
// days) so callers get a stable amount of context regardless of weekday.
const DEFAULT_LOOKBACK_DAYS = 14;

function getRangeStart(today: Date, lookbackDays: number): Date {
  const start = new Date(today);
  start.setDate(today.getDate() - Math.max(0, lookbackDays - 1));
  start.setHours(0, 0, 0, 0);
  return start;
}

function stepDetailsToShortText(step: ActionStep): string | null {
  const details = step.step_details;
  if (!details) return null;
  if (typeof details === 'string') return details.trim() || null;
  if (Array.isArray(details)) {
    const lines = details
      .map(d => (typeof d?.text === 'string' ? d.text.trim() : ''))
      .filter(Boolean);
    return lines.length ? lines.join(' • ') : null;
  }
  if (typeof details === 'object' && 'text' in details && typeof details.text === 'string') {
    return details.text.trim() || null;
  }
  // Structured workout plan — surface day name + a few exercises
  if (typeof details === 'object' && 'dayName' in details) {
    const wp = details as { dayName?: string; exercises?: Array<{ name?: string; sets?: number; reps?: string }> };
    const exercises = (wp.exercises || [])
      .slice(0, 5)
      .map(e => {
        const setsReps = e.sets && e.reps ? ` (${e.sets}×${e.reps})` : '';
        return `${e.name ?? ''}${setsReps}`.trim();
      })
      .filter(Boolean);
    const exTail = (wp.exercises?.length || 0) > 5 ? '…' : '';
    const exStr = exercises.length ? ` — ${exercises.join(', ')}${exTail}` : '';
    return `${wp.dayName ?? 'Workout'}${exStr}`;
  }
  return null;
}

async function buildTodaySection(
  userId: string,
  onboardData: Onboard,
  now: Date,
  todayStr: string,
): Promise<string[]> {
  const dayIndex = now.getDay();
  const dayAbbrev = DAY_ABBREVS[dayIndex];
  const dayLabel = DAY_FULL_NAMES[dayIndex];

  const lines: string[] = [];
  lines.push(`--- TODAY (${dayLabel}, ${todayStr}) ---`);

  // Planned action plan steps that apply today (filtered by daysOfWeek; steps
  // without daysOfWeek — e.g. daily nutrition/recovery — apply every day).
  const steps = onboardData.actionPlan?.steps ?? [];
  const todaySteps = steps.filter(s => {
    const days = s.daysOfWeek;
    if (!days || days.length === 0) return true;
    return days.map(d => d.toLowerCase()).includes(dayAbbrev);
  });
  if (todaySteps.length > 0) {
    lines.push('Planned today:');
    for (const step of todaySteps) {
      const time = step.timeOfDay ? ` @ ${step.timeOfDay}` : '';
      const detail = stepDetailsToShortText(step);
      const detailSuffix = detail ? ` — ${detail}` : '';
      lines.push(`  • ${step.title}${time}${detailSuffix}`);
    }
  }

  // Nutrition today: consumed / target → remaining
  try {
    const n = await getTodayNutrition(userId);
    if (n.caloriesTarget > 0) {
      lines.push(
        'Nutrition today (consumed / target → remaining):',
        `  Calories: ${n.totalCalories} / ${n.caloriesTarget} kcal → ${n.caloriesTarget - n.totalCalories} kcal left`,
        `  Protein:  ${n.totalProtein}g / ${n.proteinTarget}g → ${n.proteinTarget - n.totalProtein}g left`,
        `  Carbs:    ${n.totalCarbs}g / ${n.carbsTarget}g → ${n.carbsTarget - n.totalCarbs}g left`,
        `  Fat:      ${n.totalFat}g / ${n.fatTarget}g → ${n.fatTarget - n.totalFat}g left`,
      );
      if (n.fiberTarget > 0) {
        lines.push(`  Fiber:    ${n.totalFiber}g / ${n.fiberTarget}g → ${n.fiberTarget - n.totalFiber}g left`);
      }
    }
  } catch (err) {
    glowLogger.warn('Failed to fetch today nutrition for snapshot', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return lines;
}

async function buildRecentLogsSection(
  userId: string,
  startStr: string,
  endStr: string,
): Promise<string[]> {
  const lines: string[] = [];
  lines.push(`--- RECENT LOGS (${startStr} to ${endStr}) ---`);

  const [meals, workouts, activities] = await Promise.all([
    getMealLogsForDateRange(userId, startStr, endStr),
    getWorkoutLogsForDateRange(userId, startStr, endStr),
    getActivityLogsForDateRange(userId, startStr, endStr),
  ]);

  // Meals
  if (meals.length === 0) {
    lines.push('Meals: none logged');
  } else {
    const keep = meals.slice(-MAX_MEALS_IN_RANGE);
    const dropped = meals.length - keep.length;
    lines.push(`Meals (${meals.length}${dropped ? `, newest ${keep.length} shown` : ''}):`);
    for (const m of keep) {
      const t = m.loggedAt instanceof Date ? ` ${formatTimeHM(m.loggedAt)}` : '';
      lines.push(
        `  ${m.logDate}${t} — ${m.mealDescription} (${Math.round(m.calories)}kcal, P:${Math.round(m.protein)}g C:${Math.round(m.carbs)}g F:${Math.round(m.fat)}g)`
      );
    }
  }

  // Workouts
  if (workouts.length === 0) {
    lines.push('Workouts: none logged');
  } else {
    const keep = workouts.slice(0, MAX_WORKOUTS_IN_RANGE);
    lines.push(`Workouts (${workouts.length}${workouts.length > keep.length ? `, newest ${keep.length} shown` : ''}):`);
    for (const wl of keep) {
      lines.push(`  ${wl.workoutDate} — ${wl.workoutDayName} (${wl.status})`);
      const exercises = wl.exercises?.length ? wl.exercises : await getExerciseLogsForWorkout(wl.id!);
      const grouped = new Map<string, { sets: string[]; notes: Set<string> }>();
      for (const ex of exercises) {
        const setParts: (string | null)[] = [
          ex.reps != null ? `${ex.reps} reps` : null,
          ex.weightValue != null ? `${ex.weightValue}${ex.weightUnit || 'kg'}` : null,
        ];
        if (ex.rir != null) setParts.push(`RIR ${ex.rir}`);
        const setInfo = setParts.filter(Boolean).join(' @ ');
        if (!grouped.has(ex.exerciseName)) {
          grouped.set(ex.exerciseName, { sets: [], notes: new Set() });
        }
        const entry = grouped.get(ex.exerciseName)!;
        entry.sets.push(setInfo || 'bodyweight');
        const comment = (ex.comments || '').trim();
        if (comment) entry.notes.add(comment);
      }
      for (const [name, entry] of grouped) {
        const notesSuffix = entry.notes.size > 0
          ? ` [notes: ${Array.from(entry.notes).join(' | ')}]`
          : '';
        lines.push(`    ${name}: ${entry.sets.join(', ')}${notesSuffix}`);
      }
    }
  }

  // Activities
  if (activities.length === 0) {
    lines.push('Activities: none logged');
  } else {
    const keep = activities.slice(0, MAX_ACTIVITIES_IN_RANGE);
    lines.push(`Activities (${activities.length}${activities.length > keep.length ? `, newest ${keep.length} shown` : ''}):`);
    for (const a of keep) {
      const dist = a.distanceValue ? `, ${a.distanceValue}${a.distanceUnit || 'km'}` : '';
      const elev = a.elevationGain ? `, +${a.elevationGain}m` : '';
      const notes = a.notes ? ` — ${a.notes}` : '';
      lines.push(
        `  ${a.activityDate} — ${a.activityName} (${a.durationMinutes}min, ${a.intensity}${dist}${elev})${notes}`
      );
    }
  }

  return lines;
}

export interface FetchUserDataSnapshotOptions {
  /**
   * How many days of recent meal/workout/activity history to include.
   * Defaults to a fixed 14-day window; callers can widen this for broader
   * "last few weeks" questions. Independent of the all-time per-exercise
   * history block, which is attached separately by the chat layer.
   */
  lookbackDays?: number;
}

export async function fetchUserDataSnapshot(
  userId: string,
  onboardData: Onboard,
  options?: FetchUserDataSnapshotOptions,
): Promise<string> {
  try {
    const now = new Date();
    const todayStr = formatDate(now);
    const lookbackDays = options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const startStr = formatDate(getRangeStart(now, lookbackDays));

    const [todayLines, rangeLines] = await Promise.all([
      buildTodaySection(userId, onboardData, now, todayStr),
      buildRecentLogsSection(userId, startStr, todayStr),
    ]);

    const snapshot = [...todayLines, '', ...rangeLines].join('\n');
    glowLogger.info('Built user data snapshot', {
      snapshot_length: snapshot.length,
    });
    return snapshot;
  } catch (error) {
    glowLogger.error('Failed to build user data snapshot', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
