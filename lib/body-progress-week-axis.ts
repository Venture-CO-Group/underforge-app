import type { BodyCompositionChartData, DateRange } from './body-composition-storage';

/**
 * One slot on the shared body-progress timeline. Slots are one ISO week wide
 * and run contiguously from the first logged week to the last. `data` is null
 * for weeks the user did not log.
 */
export interface BodyProgressWeekSlot {
  year: number;
  week: number;
  /** Monday (00:00 local) of the ISO week. Useful for month-name x-axis labels. */
  weekMonday: Date;
  data: BodyCompositionChartData | null;
}

/**
 * ISO week number (1..53) for a date, matching the value stored in
 * `body_composition_log.week_number`.
 */
const getIsoWeek = (date: Date): { year: number; week: number } => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
};

/** Number of ISO weeks (52 or 53) in a given ISO week-year. */
const isoWeeksInYear = (year: number): number => {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay() || 7;
  const dec31 = new Date(Date.UTC(year, 11, 31)).getUTCDay() || 7;
  return jan1 === 4 || dec31 === 4 ? 53 : 52;
};

/** Local-time Monday for a given ISO (year, week). */
const isoWeekMonday = (year: number, week: number): Date => {
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - (jan4Day - 1));
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
};

/**
 * Build a contiguous list of ISO week slots covering all `data` entries.
 * Returns an empty array when `data` is empty.
 */
export const buildBodyProgressWeekSlots = (
  data: BodyCompositionChartData[],
): BodyProgressWeekSlot[] => {
  if (data.length === 0) return [];

  const sorted = [...data].sort(
    (a, b) => new Date(a.logDate).getTime() - new Date(b.logDate).getTime(),
  );

  const byKey = new Map<string, BodyCompositionChartData>();
  for (const d of sorted) {
    const { year, week } = getIsoWeek(new Date(d.logDate));
    byKey.set(`${year}-${week}`, d);
  }

  const first = getIsoWeek(new Date(sorted[0].logDate));
  const last = getIsoWeek(new Date(sorted[sorted.length - 1].logDate));

  const slots: BodyProgressWeekSlot[] = [];
  let { year, week } = first;
  while (year < last.year || (year === last.year && week <= last.week)) {
    slots.push({
      year,
      week,
      weekMonday: isoWeekMonday(year, week),
      data: byKey.get(`${year}-${week}`) ?? null,
    });
    week += 1;
    if (week > isoWeeksInYear(year)) {
      week = 1;
      year += 1;
    }
  }
  return slots;
};

/** Three-letter month ticks for 6-month body charts (EN + ES). */
const SIX_MONTH_AXIS_LABELS: Record<string, readonly string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
};

/**
 * X-axis month label: full localized month name for 3-month view; fixed
 * three-letter abbreviations for 6-month view in EN/ES; other locales fall
 * back to the first three letters of `Intl` short month.
 */
export function formatBodyProgressAxisMonth(
  weekMonday: Date,
  locale: string,
  dateRange: DateRange,
): string {
  const loc = locale || 'en';
  if (dateRange === '6months') {
    const tag = loc.split('-')[0].toLowerCase();
    const fixed = SIX_MONTH_AXIS_LABELS[tag];
    if (fixed) return fixed[weekMonday.getMonth()] ?? '';
    const raw = new Intl.DateTimeFormat(loc, { month: 'short' }).format(weekMonday);
    const compact = raw.replace(/[\s.·]/g, '');
    return Array.from(compact.normalize('NFC')).slice(0, 3).join('');
  }
  return new Intl.DateTimeFormat(loc, { month: 'long' }).format(weekMonday);
}
