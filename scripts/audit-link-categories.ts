/**
 * Dev-only audit helper for the wearable → strength activity-type mapping in
 * lib/activity-workout-links.ts.
 *
 * Run from a dev menu (or REPL) with a userId argument; prints a table of
 * `(source, activity_type, category, strength?)` over the last 90 days of
 * activity_logs so we can confirm coverage of `isStrengthStyleActivityType`
 * before iterating.
 *
 * NOT bundled into the production app. Intentionally lives in /scripts so a
 * release Metro build ignores it.
 */

import { getDatabase } from '../lib/db';
import { isStrengthStyleActivityType } from '../lib/activity-workout-links';
import { getActivityTypeById } from '../types/workout';

interface Row {
  source: string;
  activity_type: string;
  category: string;
  count: number;
  strength_like: boolean;
}

export async function auditLinkCategories(userId: string, daysBack = 90): Promise<Row[]> {
  const db = getDatabase();
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - daysBack);
  const startYmd = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  const endYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const rows = await db.getAllAsync<{ source: string; activity_type: string; count: number }>(
    `SELECT COALESCE(source, 'manual') AS source, activity_type, COUNT(*) AS count
       FROM activity_logs
      WHERE user_id = ?
        AND activity_date >= ? AND activity_date <= ?
        AND COALESCE(source, 'manual') != 'manual'
        AND status != 'deleted'
      GROUP BY source, activity_type
      ORDER BY count DESC`,
    [userId, startYmd, endYmd],
  );

  const out: Row[] = rows.map((r) => {
    const def = getActivityTypeById(r.activity_type);
    return {
      source: r.source,
      activity_type: r.activity_type,
      category: def?.category ?? 'unknown',
      count: r.count,
      strength_like: isStrengthStyleActivityType(r.activity_type),
    };
  });

  // eslint-disable-next-line no-console
  console.table(out);
  return out;
}
