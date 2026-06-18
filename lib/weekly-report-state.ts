import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE,
  isInWeeklyReportPromptWindow,
  type WeeklyCheckinScheduleMode,
} from './weekly-checkin-schedule';

const PREFIX = 'weekly_report:';
const SKIPPED_KEY = `${PREFIX}skipped_weeks`;
const COMPLETED_KEY = `${PREFIX}completed_weeks`;
const NARRATIVE_PREFIX = `${PREFIX}narrative_v3_checkin_`;
const SCHEDULED_NOTIF_ID_KEY = `${PREFIX}scheduled_notification_id`;

const MAX_STORED_WEEKS = 24;

async function loadWeekSet(key: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function saveWeekSet(key: string, set: Set<string>): Promise<void> {
  const arr = [...set].slice(-MAX_STORED_WEEKS);
  await AsyncStorage.setItem(key, JSON.stringify(arr));
}

export async function markWeeklyReportSkipped(weekKey: string): Promise<void> {
  const s = await loadWeekSet(SKIPPED_KEY);
  s.add(weekKey);
  await saveWeekSet(SKIPPED_KEY, s);
}

export async function markWeeklyReportCompleted(weekKey: string): Promise<void> {
  const s = await loadWeekSet(COMPLETED_KEY);
  s.add(weekKey);
  await saveWeekSet(COMPLETED_KEY, s);
}

export async function wasWeeklyReportSkipped(weekKey: string): Promise<boolean> {
  const s = await loadWeekSet(SKIPPED_KEY);
  return s.has(weekKey);
}

export async function wasWeeklyReportCompleted(weekKey: string): Promise<boolean> {
  const s = await loadWeekSet(COMPLETED_KEY);
  return s.has(weekKey);
}

/**
 * Show gate if user has not skipped or completed this report week, and we're in the prompt window
 * for the active schedule mode (default: Sun ≥ 18, Mon, Tue; alternate: Mon ≥ 18, Tue, Wed).
 */
export async function shouldPromptWeeklyReportGate(
  weekKey: string,
  now: Date = new Date(),
  mode: WeeklyCheckinScheduleMode = DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE,
): Promise<boolean> {
  if (await wasWeeklyReportSkipped(weekKey)) return false;
  if (await wasWeeklyReportCompleted(weekKey)) return false;
  return isInWeeklyReportPromptWindow(now, mode);
}

export type WeeklyReportHeroMood = 'explaining' | 'applauding' | 'celebrate';

export interface WeeklyReportNarrative {
  /** Matches `weeklyReportMetricsFingerprint` when generated; stale entries are ignored. */
  metricsFingerprint?: string;
  /** Sheet header + motivation to read (weekly check-in framing) */
  reportTitle: string;
  /** Drives hero gradient accent (same coach image; visual mode until per-mood assets exist). */
  heroMood: WeeklyReportHeroMood;
  /** Large white text over hero image */
  heroTagline: string;
  /** 1–3 punchy positive facts (larger type in UI); must match metrics JSON only */
  spotlightFacts: string[];
  headline: string;
  winsBullets: string[];
  improvementBullets: string[];
  closing: string;
}

export async function getCachedWeeklyReportNarrative(weekKey: string): Promise<WeeklyReportNarrative | null> {
  try {
    const raw = await AsyncStorage.getItem(NARRATIVE_PREFIX + weekKey);
    if (!raw) return null;
    const n = JSON.parse(raw) as WeeklyReportNarrative;
    if (
      typeof n.reportTitle !== 'string' ||
      !Array.isArray(n.spotlightFacts) ||
      typeof n.heroTagline !== 'string' ||
      typeof n.heroMood !== 'string'
    ) {
      return null;
    }
    return n;
  } catch {
    return null;
  }
}

export async function setCachedWeeklyReportNarrative(
  weekKey: string,
  narrative: WeeklyReportNarrative,
): Promise<void> {
  await AsyncStorage.setItem(NARRATIVE_PREFIX + weekKey, JSON.stringify(narrative));
}

export async function getWeeklyReportScheduledNotificationId(): Promise<string | null> {
  return AsyncStorage.getItem(SCHEDULED_NOTIF_ID_KEY);
}

export async function setWeeklyReportScheduledNotificationId(id: string | null): Promise<void> {
  if (id === null) {
    await AsyncStorage.removeItem(SCHEDULED_NOTIF_ID_KEY);
  } else {
    await AsyncStorage.setItem(SCHEDULED_NOTIF_ID_KEY, id);
  }
}
