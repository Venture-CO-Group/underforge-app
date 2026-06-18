import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import { glowLogger } from './glow-logger';

const FIRST_OPEN_KEY = 'meta_events:first_open_logged';
const DAILY_SESSION_KEY_PREFIX = 'meta_events:daily_session_logged';

const META_EVENTS = {
  appOpen: 'underforge_app_open',
  firstAppOpen: 'underforge_first_app_open',
  dailySession: 'underforge_daily_session',
} as const;

type MetaEventParams = Record<string, string | number>;
type MetaSdkModule = {
  AppEventsLogger: {
    logEvent: (eventName: string, parameters?: MetaEventParams) => void;
    AppEvents?: {
      CompletedRegistration?: string;
    };
    AppEventParams?: {
      RegistrationMethod?: string;
    };
  };
  Settings: {
    initializeSDK: () => void;
    setAdvertiserTrackingEnabled: (enabled: boolean) => Promise<boolean>;
    setAdvertiserIDCollectionEnabled: (enabled: boolean) => void;
  };
};

let sdkInitialized = false;
let missingNativeBindingLogged = false;
let missingTrackingTransparencyLogged = false;
let metaSdkPreparePromise: Promise<boolean> | null = null;

const isMetaSupported = Platform.OS === 'ios' || Platform.OS === 'android';

const getLocalDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const hasMetaNativeBindings = () =>
  !!NativeModules?.FBSettings && !!NativeModules?.FBAppEventsLogger;

const hasExpoTrackingTransparencyNative = () =>
  !!NativeModules?.ExpoTrackingTransparency;

const requestTrackingPermission = async () => {
  // Pre-check the native binding before attempting the dynamic import. The
  // expo-tracking-transparency module evaluates `requireNativeModule(...)` at
  // top-level, so even though the dynamic `import()` is wrapped in try/catch,
  // React Native's dev redbox still surfaces the throw (which blocks the
  // simulator screen). Skipping the import entirely keeps the catch hot and
  // the screen clear when the dev / prebuild binary doesn't include ATT.
  if (!hasExpoTrackingTransparencyNative()) {
    if (!missingTrackingTransparencyLogged) {
      missingTrackingTransparencyLogged = true;
      glowLogger.warn('Tracking transparency native module unavailable; disabling Meta ATT', {
        platform: Platform.OS,
      });
    }
    return { granted: false };
  }

  try {
    const TrackingTransparency = await import('expo-tracking-transparency');
    return await TrackingTransparency.requestTrackingPermissionsAsync();
  } catch (error) {
    glowLogger.warn('Tracking transparency request failed; disabling Meta ATT', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { granted: false };
  }
};

const getMetaSdk = (): MetaSdkModule | null => {
  if (!hasMetaNativeBindings()) {
    if (!missingNativeBindingLogged) {
      missingNativeBindingLogged = true;
      glowLogger.warn('Meta SDK native module unavailable; skipping Meta events', {
        platform: Platform.OS,
      });
    }
    return null;
  }

  // Loading the SDK eagerly crashes in Expo Go / stale native builds because
  // the package creates NativeEventEmitter instances at import time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-fbsdk-next') as MetaSdkModule;
};

/**
 * Initializes the Meta SDK, requests ATT on iOS, then sets AdvertiserTrackingEnabled /
 * advertiser ID collection so Events Manager can report ATE (iOS 14.5+).
 */
async function prepareMetaSdkForEvents(): Promise<boolean> {
  if (!isMetaSupported) return false;
  if (sdkInitialized) return true;
  if (metaSdkPreparePromise) return metaSdkPreparePromise;

  metaSdkPreparePromise = (async () => {
    const sdk = getMetaSdk();
    if (!sdk) return false;

    try {
      sdk.Settings.initializeSDK();

      if (Platform.OS === 'ios') {
        const { granted } = await requestTrackingPermission();
        await sdk.Settings.setAdvertiserTrackingEnabled(granted);
      } else {
        sdk.Settings.setAdvertiserIDCollectionEnabled(true);
      }

      sdkInitialized = true;
      glowLogger.info('Meta SDK initialized', { platform: Platform.OS });
      return true;
    } catch (error) {
      glowLogger.warn('Meta SDK initialization skipped', {
        error: error instanceof Error ? error.message : String(error),
        platform: Platform.OS,
      });
      metaSdkPreparePromise = null;
      return false;
    }
  })();

  return metaSdkPreparePromise;
}

const logMetaEvent = async (eventName: string, parameters?: MetaEventParams) => {
  if (!(await prepareMetaSdkForEvents())) return false;
  const sdk = getMetaSdk();
  if (!sdk) return false;

  try {
    if (parameters) {
      sdk.AppEventsLogger.logEvent(eventName, parameters);
    } else {
      sdk.AppEventsLogger.logEvent(eventName);
    }
    glowLogger.info('Meta app event logged', { event_name: eventName });
    return true;
  } catch (error) {
    glowLogger.warn('Meta app event failed', {
      event_name: eventName,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

export const trackMetaAppOpen = async () => {
  await logMetaEvent(META_EVENTS.appOpen, { trigger: 'cold_start' });

  try {
    const alreadyLogged = await AsyncStorage.getItem(FIRST_OPEN_KEY);
    if (alreadyLogged) return;

    if (await logMetaEvent(META_EVENTS.firstAppOpen)) {
      await AsyncStorage.setItem(FIRST_OPEN_KEY, 'true');
    }
  } catch (error) {
    glowLogger.warn('Meta first-open tracking failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const trackMetaAccountCreated = async () => {
  const sdk = getMetaSdk();
  const eventName =
    sdk?.AppEventsLogger.AppEvents?.CompletedRegistration ||
    'fb_mobile_complete_registration';
  const registrationMethod =
    sdk?.AppEventsLogger.AppEventParams?.RegistrationMethod ||
    'fb_registration_method';

  await logMetaEvent(eventName, { [registrationMethod]: 'email' });
};

export const trackMetaDailySession = async () => {
  const today = getLocalDateKey();
  const storageKey = `${DAILY_SESSION_KEY_PREFIX}:${today}`;

  try {
    const alreadyLogged = await AsyncStorage.getItem(storageKey);
    if (alreadyLogged) return;

    if (await logMetaEvent(META_EVENTS.dailySession, { date: today })) {
      await AsyncStorage.setItem(storageKey, 'true');
    }
  } catch (error) {
    glowLogger.warn('Meta daily-session tracking failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
