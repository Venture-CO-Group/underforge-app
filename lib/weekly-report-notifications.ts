import * as Notifications from 'expo-notifications';
import { glowLogger } from './glow-logger';
import {
  getCachedWeeklyCheckinScheduleMode,
  promptTimeForMode,
  type WeeklyCheckinScheduleMode,
} from './weekly-checkin-schedule';
import { getWeeklyReportScheduledNotificationId, setWeeklyReportScheduledNotificationId } from './weekly-report-state';

export const WEEKLY_REPORT_NOTIFICATION_IDENTIFIER = 'weekly_progress_report_v1';

/**
 * Expo's WEEKLY trigger uses 1 = Sunday … 7 = Saturday (per Expo docs).
 * Date#getDay() uses 0 = Sunday … 6 = Saturday, hence the +1 conversion.
 */
function expoWeekdayFromJsDay(jsDay: number): number {
  return ((jsDay % 7) + 7) % 7 + 1;
}

export async function cancelWeeklyReportNotification(): Promise<void> {
  try {
    const stored = await getWeeklyReportScheduledNotificationId();
    if (stored) {
      await Notifications.cancelScheduledNotificationAsync(stored);
      await setWeeklyReportScheduledNotificationId(null);
    }
    await Notifications.cancelScheduledNotificationAsync(WEEKLY_REPORT_NOTIFICATION_IDENTIFIER).catch(() => {});
  } catch (e) {
    glowLogger.warn('cancelWeeklyReportNotification failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Schedules a repeating local notification at the prompt time of the active schedule mode
 * (device local time): Sunday 18:00 for the default mode, Monday 18:00 for the alternate.
 * Reschedules idempotently (cancels previous stored id first). Pass `mode` to override the
 * AsyncStorage-cached preference (used when the user toggles the setting).
 */
export async function ensureWeeklyReportNotificationScheduled(
  mode?: WeeklyCheckinScheduleMode,
): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      glowLogger.info('Weekly check-in notification not scheduled: permission not granted', {});
      return;
    }

    const activeMode = mode ?? (await getCachedWeeklyCheckinScheduleMode());
    const { weekday, hour, minute } = promptTimeForMode(activeMode);
    const expoWeekday = expoWeekdayFromJsDay(weekday);

    await cancelWeeklyReportNotification();

    const id = await Notifications.scheduleNotificationAsync({
      identifier: WEEKLY_REPORT_NOTIFICATION_IDENTIFIER,
      content: {
        title: 'Weekly check-in',
        body: 'Ready for your weekly check-in?',
        sound: 'default',
        data: {
          type: 'weekly_progress_report',
          render_screen: 'weekly_progress_report',
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: expoWeekday,
        hour,
        minute,
      },
    });

    await setWeeklyReportScheduledNotificationId(id);
    glowLogger.info('Weekly check-in notification scheduled', {
      notification_id: id,
      mode: activeMode,
      weekday_expo: expoWeekday,
      hour,
    });
  } catch (e) {
    glowLogger.error('ensureWeeklyReportNotificationScheduled failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

