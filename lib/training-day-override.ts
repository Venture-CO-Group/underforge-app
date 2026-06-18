import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'training_day_override:';

function storageKey(userId: string, ymd: string): string {
  return `${KEY_PREFIX}${userId}:${ymd}`;
}

/** User chose rest-day targets on a planned training day for `ymd`. */
export async function getManualRestDayOverride(
  userId: string,
  ymd: string,
): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(storageKey(userId, ymd));
    return v === 'rest';
  } catch {
    return false;
  }
}

export async function setManualRestDayOverride(
  userId: string,
  ymd: string,
  enabled: boolean,
): Promise<void> {
  const key = storageKey(userId, ymd);
  if (enabled) {
    await AsyncStorage.setItem(key, 'rest');
  } else {
    await AsyncStorage.removeItem(key);
  }
}
