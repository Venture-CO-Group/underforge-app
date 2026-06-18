import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import { getWeekNumber } from './body-composition-storage';
import { getDatabase } from './db';
import { glowLogger } from './glow-logger';

/** ~6 months of weekly logs. */
const WEEKS_TO_SEED = 26;

/**
 * DEV-ONLY helper to populate the body-composition history with one back-dated
 * weekly log for every week in the last ~6 months, so the progress charts /
 * photo viewer can be exercised without logging week after week. Writes to
 * LOCAL SQLite only — the picked URIs are device-local file paths that wouldn't
 * resolve on other devices, so we deliberately skip the Supabase sync.
 *
 * Each week gets a fabricated weight/muscle/fat with a gentle "getting leaner"
 * trend (oldest = heaviest/fattest, newest = lightest/most muscular) and a photo
 * cycled from the picked images (so a handful of images cover every week).
 */
const seedBodyCompositionTestData = async (
  userId: string,
  uris: string[],
): Promise<number> => {
  const db = getDatabase();
  const denom = Math.max(1, WEEKS_TO_SEED - 1);

  for (let w = 0; w < WEEKS_TO_SEED; w++) {
    // w = 0 is the oldest week; w = WEEKS_TO_SEED-1 maps to the current week.
    const weeksAgo = WEEKS_TO_SEED - 1 - w;
    const date = new Date();
    date.setDate(date.getDate() - weeksAgo * 7);

    const weekNumber = getWeekNumber(date);
    const year = date.getFullYear();
    const logDate = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    // Linear trends across the whole window, then rounded to one decimal.
    const progress = w / denom; // 0 (oldest) → 1 (newest)
    const weight = Math.round((86 - progress * 7) * 10) / 10; // 86 → 79 kg
    const muscle = Math.round((35 + progress * 8) * 10) / 10; // 35 → 43 %
    const fat = Math.round((30 - progress * 9) * 10) / 10;    // 30 → 21 %
    const photoUrl = uris[w % uris.length];

    await db.runAsync(
      `
      INSERT INTO body_composition_log (user_id, log_date, week_number, year, weight_value, weight_unit, muscle_percent, fat_percent, photo_front_url, photo_side_url, photo_back_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      ON CONFLICT(user_id, week_number, year) DO UPDATE SET
        log_date = excluded.log_date,
        weight_value = excluded.weight_value,
        weight_unit = excluded.weight_unit,
        muscle_percent = excluded.muscle_percent,
        fat_percent = excluded.fat_percent,
        photo_front_url = excluded.photo_front_url,
        created_at = CURRENT_TIMESTAMP
    `,
      [userId, logDate, weekNumber, year, weight, 'kg', muscle, fat, photoUrl],
    );
  }

  glowLogger.info('Seeded body composition test data', { user_id: userId, weeks: WEEKS_TO_SEED, images: uris.length });
  return WEEKS_TO_SEED;
};

/**
 * Opens a multi-select photo picker, then seeds one back-dated weekly log per
 * picked image. Returns the number of weeks seeded (0 if cancelled). DEV only.
 */
export const pickAndSeedBodyTestData = async (userId: string): Promise<number> => {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Allow photo access to seed test data.');
    return 0;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 0, // 0 = unlimited (iOS 14+); images are cycled across weeks
    quality: 0.8,
  });

  if (result.canceled || result.assets.length === 0) return 0;

  const uris = result.assets.map((a) => a.uri);
  try {
    return await seedBodyCompositionTestData(userId, uris);
  } catch (error) {
    glowLogger.error('Failed to seed body composition test data', {
      error: error instanceof Error ? error.message : String(error),
    });
    Alert.alert('Seed failed', error instanceof Error ? error.message : String(error));
    return 0;
  }
};
