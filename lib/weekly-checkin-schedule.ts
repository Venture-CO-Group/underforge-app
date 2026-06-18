import AsyncStorage from '@react-native-async-storage/async-storage';

import type { WeeklyCheckinScheduleMode } from '../types/user_profile';
import { DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE } from '../types/user_profile';

export type { WeeklyCheckinScheduleMode } from '../types/user_profile';
export { DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE } from '../types/user_profile';

const MODE_STORAGE_KEY = 'weekly_report:schedule_mode';

/** AsyncStorage mirror so the notification scheduler can run without a profile fetch. */
export async function getCachedWeeklyCheckinScheduleMode(): Promise<WeeklyCheckinScheduleMode> {
  try {
    const raw = await AsyncStorage.getItem(MODE_STORAGE_KEY);
    if (raw === 'sun_sat_sun1800' || raw === 'mon_sun_mon1800') return raw;
  } catch {
    /* noop */
  }
  return DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE;
}

export async function setCachedWeeklyCheckinScheduleMode(
  mode: WeeklyCheckinScheduleMode,
): Promise<void> {
  await AsyncStorage.setItem(MODE_STORAGE_KEY, mode);
}

/** PostgREST when `user_profile` column is not migrated yet on hosted Supabase. */
export function isWeeklyCheckinScheduleColumnMissingError(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  return (
    e?.code === 'PGRST204' &&
    typeof e.message === 'string' &&
    e.message.includes('weekly_checkin_schedule_mode')
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

export interface WeeklyCheckinPeriodBounds {
  /** Local YYYY-MM-DD of the first day of the assessed period (inclusive). */
  periodStartYmd: string;
  /** Local YYYY-MM-DD of the last day of the assessed period (inclusive). */
  periodEndYmd: string;
  /** Date object for the period start (local midnight). */
  periodStart: Date;
  /** Date object for the period end (local midnight). */
  periodEnd: Date;
  /** Stable key for AsyncStorage skip/complete sets + narrative cache. */
  weekKey: string;
  /** Schedule mode that produced these bounds. */
  mode: WeeklyCheckinScheduleMode;
}

/** Schedule-specific weekday + hour at which a new period becomes available. */
export interface WeeklyCheckinPromptTime {
  /** 0 = Sunday … 6 = Saturday (matches `Date#getDay()`). */
  weekday: number;
  /** Local hour at which the new period is offered. */
  hour: number;
  minute: number;
}

export function promptTimeForMode(mode: WeeklyCheckinScheduleMode): WeeklyCheckinPromptTime {
  if (mode === 'mon_sun_mon1800') {
    return { weekday: 1, hour: 18, minute: 0 };
  }
  return { weekday: 0, hour: 18, minute: 0 };
}

/**
 * Most recent "prompt anchor" at or before `now`, defined as the most recent occurrence of
 * the schedule's weekday at the schedule's hour (local). The active reporting period starts
 * the day after the *previous* anchor and ends on the anchor day's previous day.
 */
function lastPromptAnchorAtOrBefore(now: Date, mode: WeeklyCheckinScheduleMode): Date {
  const { weekday, hour, minute } = promptTimeForMode(mode);
  const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);
  const day = ref.getDay();

  let daysBack: number;
  if (day === weekday) {
    const atOrAfter = ref.getHours() > hour || (ref.getHours() === hour && ref.getMinutes() >= minute);
    daysBack = atOrAfter ? 0 : 7;
  } else {
    daysBack = (day - weekday + 7) % 7;
  }

  const anchor = addDays(
    new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()),
    -daysBack,
  );
  anchor.setHours(hour, minute, 0, 0);
  return anchor;
}

export function getReportingPeriodBounds(
  now: Date = new Date(),
  mode: WeeklyCheckinScheduleMode = DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE,
): WeeklyCheckinPeriodBounds {
  const anchor = lastPromptAnchorAtOrBefore(now, mode);
  const anchorDay = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const periodEnd = addDays(anchorDay, -1);
  const periodStart = addDays(periodEnd, -6);

  return {
    periodStart,
    periodEnd,
    periodStartYmd: toYMD(periodStart),
    periodEndYmd: toYMD(periodEnd),
    weekKey: toYMD(periodStart),
    mode,
  };
}

/**
 * Whether `now` falls within the user-facing window where we should surface the gate.
 * Default mode: Sun ≥ 18:00, Mon (all day), Tue (all day) — mirrors prior product.
 * Alternate mode: Mon ≥ 18:00, Tue (all day), Wed (all day).
 */
export function isInWeeklyReportPromptWindow(
  now: Date = new Date(),
  mode: WeeklyCheckinScheduleMode = DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE,
): boolean {
  const day = now.getDay();
  if (mode === 'mon_sun_mon1800') {
    if (day === 1) return now.getHours() >= 18;
    return day === 2 || day === 3;
  }
  if (day === 0) return now.getHours() >= 18;
  return day === 1 || day === 2;
}

/** Debug helper: pretend "now" is the most recent prompt anchor (e.g. Sunday 19:00 local for default). */
export function getMostRecentPromptReferenceDate(
  now: Date = new Date(),
  mode: WeeklyCheckinScheduleMode = DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE,
): Date {
  const anchor = lastPromptAnchorAtOrBefore(now, mode);
  anchor.setHours(promptTimeForMode(mode).hour + 1, 0, 0, 0);
  return anchor;
}
