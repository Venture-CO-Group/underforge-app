import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n, { type InitOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';

const en = require('../assets/locales/en.json');
const es = require('../assets/locales/es.json');

const LANGUAGE_STORAGE_KEY = 'app_language';

const baseConfig: InitOptions = {
  compatibilityJSON: 'v4',
  resources: {
    en,
    es,
  },
  // Namespaces used across the app. It's safe to add more over time.
  ns: [
    'common',
    'language',
    'menu',
    'settings',
    'main',
    'onboarding',
    'progress',
    'auth',
    'intro',
    'specialCode',
    'sync',
    'account',
    'email',
    'chat',
    'workout',
    'report',
    'plan',
    'bodymap',
    'home',
    'social',
    'activity',
    'bodylog',
    'root',
  ],
  defaultNS: 'common',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
};

let initialized = false;

export const getStoredLanguage = async (): Promise<string | null> => {
  try {
    const value = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    return value;
  } catch {
    return null;
  }
};

export const detectDeviceLanguage = (): string => {
  const locales = Localization.getLocales();
  const primary = locales[0];
  if (!primary?.languageCode) {
    return 'en';
  }

  // Map common Spanish variants to generic 'es'
  if (primary.languageCode === 'es') {
    return 'es';
  }

  return 'en';
};

export const initI18n = async (): Promise<string> => {
  if (!initialized) {
    const stored = await getStoredLanguage();
    const initialLanguage = stored || detectDeviceLanguage();

    await i18n.use(initReactI18next).init({
      ...baseConfig,
      lng: initialLanguage,
    });

    initialized = true;
    return initialLanguage;
  }

  return i18n.language;
};

export const changeLanguage = async (language: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Non-fatal if persistence fails; still attempt in-memory switch
  }

  await i18n.changeLanguage(language);
};

export const getCurrentLanguage = (): string => {
  return i18n.language || 'en';
};

export const LANGUAGE_KEYS = {
  ENGLISH: 'en',
  SPANISH: 'es',
} as const;

export { i18n, LANGUAGE_STORAGE_KEY };

