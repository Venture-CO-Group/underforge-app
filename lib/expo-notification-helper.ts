import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { DeviceType } from '../types/user_profile';
import { glowLogger } from './glow-logger';

// Get the projectId from app.json/app.config.js
// Fallback to hardcoded value if Constants.expoConfig is unavailable (can happen in some build configs)
const EAS_PROJECT_ID = 'eaa39b25-2174-4741-b93f-c99873e73ee7';

const getProjectId = (): string => {
  const configProjectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!configProjectId) {
    glowLogger.info('Using fallback projectId (Constants.expoConfig not available)', {
      has_expoConfig: !!Constants.expoConfig,
      has_extra: !!Constants.expoConfig?.extra
    });
  }
  return configProjectId || EAS_PROJECT_ID;
};

export interface PushTokenResult {
  expoPushToken: string | null;
  permissionStatus: string;
  deviceType: DeviceType;
}

/**
 * Get push token without requiring a local user ID.
 * Used for auto-restore functionality when no local user exists.
 */
export async function getDevicePushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    glowLogger.info('Simulator/Emulator detected, no push token available for auto-restore', { 
      platform: Platform.OS
    });
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    
    // Only get token if permission is already granted - don't request during auto-restore
    if (existingStatus === 'granted') {
      try {
        const projectId = getProjectId();
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        glowLogger.info('Device push token obtained for auto-restore check', { 
          token_preview: token?.substring(0, 30) + '...',
          platform: Platform.OS
        });
        return token;
      } catch (tokenError) {
        const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError);
        glowLogger.info('Could not get push token for auto-restore', { 
          reason: errorMessage,
          platform: Platform.OS
        });
        return null;
      }
    } else {
      glowLogger.info('Push permission not granted, skipping auto-restore token check', { 
        status: existingStatus,
        platform: Platform.OS
      });
      return null;
    }
  } catch (error) {
    glowLogger.info('Error getting device push token for auto-restore', { 
      error: error instanceof Error ? error.message : String(error),
      platform: Platform.OS
    });
    return null;
  }
}

// Helper to add timeout to any promise
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
};

/**
 * Request push token early in the user flow (before user ID exists).
 * Called when user taps "New User" to ensure we get the token while app is in foreground.
 * The token is stored and attached to the profile later.
 * 
 * Uses listener-based approach to avoid getDevicePushTokenAsync hanging on iOS 18+
 */
export async function requestPushTokenEarly(): Promise<PushTokenResult> {
  const deviceType = Platform.OS === 'ios' ? DeviceType.IOS_DEVICE : DeviceType.ANDROID_DEVICE;
  
  if (!Device.isDevice) {
    const simulatorType = Platform.OS === 'ios' ? DeviceType.IOS_SIMULATOR : DeviceType.ANDROID_EMULATOR;
    glowLogger.info('Simulator/Emulator detected, skipping early push token request', { 
      platform: Platform.OS
    });
    return {
      expoPushToken: null,
      permissionStatus: 'not_applicable',
      deviceType: simulatorType
    };
  }

  try {
    glowLogger.info('Requesting push notification permission early (new user flow)', { 
      platform: Platform.OS,
      device_model: Device.modelName || 'unknown',
      os_version: Device.osVersion || 'unknown'
    });
    
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus === 'granted') {
      try {
        // Wrap in a timeout because `getExpoPushTokenAsync` can hang
        // indefinitely on iOS 18+ when APNs is slow/unavailable. Without the
        // timeout we end up storing `expo_push_token = NULL` for the user and
        // never retrying within this session.
        const token = (
          await withTimeout(
            Notifications.getExpoPushTokenAsync(),
            12000,
            'requestPushTokenEarly:getExpoPushTokenAsync'
          )
        ).data;

        glowLogger.info('Early push token obtained successfully', {
          token_preview: token?.substring(0, 40) + '...',
          platform: Platform.OS,
          device_type: deviceType
        });

        return {
          expoPushToken: token,
          permissionStatus: finalStatus,
          deviceType: deviceType
        };
      } catch (tokenError) {
        const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError);

        glowLogger.error('Failed to get early push token - background recovery will retry', {
          error: errorMessage,
          platform: Platform.OS,
          device_model: Device.modelName || 'unknown',
          device_type: deviceType,
        });

        return {
          expoPushToken: null,
          permissionStatus: finalStatus,
          deviceType: deviceType
        };
      }
    } else {
      glowLogger.info('Push notification permission not granted (early request)', { 
        status: finalStatus,
        platform: Platform.OS
      });
      
      return {
        expoPushToken: null,
        permissionStatus: finalStatus,
        deviceType: deviceType
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    glowLogger.warn('Error in early push token request', { 
      error: errorMessage,
      platform: Platform.OS
    });
    
    return {
      expoPushToken: null,
      permissionStatus: 'error',
      deviceType: deviceType
    };
  }
}

/**
 * Get Expo push token using listener-based approach.
 * This is more reliable than direct async calls on iOS 18+ where getDevicePushTokenAsync can hang.
 */
async function getExpoPushTokenWithListener(projectId: string): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    let subscription: ReturnType<typeof Notifications.addPushTokenListener> | null = null;
    
    // Timeout after 12 seconds
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        glowLogger.warn('Push token listener timed out after 12s', { platform: Platform.OS });
        subscription?.remove();
        resolve(null);
      }
    }, 12000);
    
    // Set up listener for device token
    subscription = Notifications.addPushTokenListener(async (devicePushToken) => {
      if (resolved) return;
      
      glowLogger.info('Received device push token via listener', { 
        token_type: devicePushToken.type,
        token_preview: devicePushToken.data?.substring(0, 20) + '...'
      });
      
      try {
        // Now exchange for Expo token
        const expoPushToken = await Notifications.getExpoPushTokenAsync({
          projectId,
          devicePushToken
        });
        
        resolved = true;
        clearTimeout(timeout);
        subscription?.remove();
        resolve(expoPushToken.data);
      } catch (exchangeError) {
        const errorMessage = exchangeError instanceof Error ? exchangeError.message : String(exchangeError);
        glowLogger.error('Failed to exchange device token for Expo token', { error: errorMessage });
        resolved = true;
        clearTimeout(timeout);
        subscription?.remove();
        resolve(null);
      }
    });
    
    // Also try the direct method as fallback - sometimes it works
    glowLogger.info('Also trying direct getExpoPushTokenAsync as fallback', { projectId });
    Notifications.getExpoPushTokenAsync({ projectId })
      .then((result) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          subscription?.remove();
          glowLogger.info('Direct method succeeded', { token_preview: result.data?.substring(0, 40) + '...' });
          resolve(result.data);
        }
      })
      .catch((err) => {
        // Don't resolve on error - let the listener or timeout handle it
        glowLogger.info('Direct method failed, waiting for listener', { 
          error: err instanceof Error ? err.message : String(err)
        });
      });
  });
}

export async function getPushTokenWithStatus(localUserId: string): Promise<PushTokenResult | undefined> {
  if (!Device.isDevice) {
    const simulatorType = Platform.OS === 'ios' ? DeviceType.IOS_SIMULATOR : DeviceType.ANDROID_EMULATOR;
    glowLogger.info('Simulator/Emulator detected, skipping push token registration', { 
      localUserId: localUserId,
      platform: Platform.OS
    });
    return {
      expoPushToken: null,
      permissionStatus: 'not_applicable',
      deviceType: simulatorType
    };
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    const deviceType = Platform.OS === 'ios' ? DeviceType.IOS_DEVICE : DeviceType.ANDROID_DEVICE;
    
    if (finalStatus === 'granted') {
      try {
        // Use the same listener-based approach that works in requestPushTokenEarly
        const projectId = getProjectId();
        glowLogger.info('Requesting push token via listener approach', { 
          projectId: projectId || 'undefined',
          local_user_id: localUserId,
          platform: Platform.OS
        });
        
        const token = await getExpoPushTokenWithListener(projectId);

        if (token) {
          glowLogger.info('Expo push token obtained via listener', {
            token_preview: token.substring(0, 40) + '...',
            local_user_id: localUserId,
            platform: Platform.OS,
            device_type: deviceType
          });
          return {
            expoPushToken: token,
            permissionStatus: finalStatus,
            deviceType: deviceType
          };
        } else {
          // Real device + permission granted + no token === user has no push
          // capability. Log at error level so it's actionable in Logfire.
          glowLogger.error(
            'CRITICAL: getPushTokenWithStatus returned no token despite granted permission on real device',
            {
              local_user_id: localUserId,
              platform: Platform.OS,
              device_type: deviceType,
              permission_status: finalStatus,
              project_id: projectId || 'undefined',
            }
          );
          return {
            expoPushToken: null,
            permissionStatus: finalStatus,
            deviceType: deviceType
          };
        }
      } catch (tokenError) {
        const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError);
        
        if (errorMessage.includes('aps-environment') || errorMessage.includes('development')) {
          glowLogger.info('Push notifications not available in current build configuration', { 
            reason: 'Missing APS environment entitlement',
            local_user_id: localUserId,
            platform: Platform.OS,
            suggestion: 'This is normal for development builds'
          });
        } else {
          glowLogger.warn('Failed to get push token', { 
            error: errorMessage,
            local_user_id: localUserId,
            platform: Platform.OS
          });
        }
        
        return {
          expoPushToken: null,
          permissionStatus: finalStatus,
          deviceType: deviceType
        };
      }
    } else {
      glowLogger.info('Push notification permission not granted', { 
        status: finalStatus,
        local_user_id: localUserId,
        platform: Platform.OS
      });
      
      return {
        expoPushToken: null,
        permissionStatus: finalStatus,
        deviceType: deviceType
      };
    }
  } catch (pushTokenError) {
    const errorMessage = pushTokenError instanceof Error ? pushTokenError.message : String(pushTokenError);
    const deviceType = Platform.OS === 'ios' ? DeviceType.IOS_DEVICE : DeviceType.ANDROID_DEVICE;
    
    if (errorMessage.includes('aps-environment') || errorMessage.includes('development')) {
      glowLogger.info('Push notifications not available in current build configuration', { 
        reason: errorMessage,
        local_user_id: localUserId,
        platform: Platform.OS,
        suggestion: 'This is expected for development builds without proper entitlements'
      });
    } else {
      glowLogger.warn('Error with push notification setup', { 
        error: errorMessage,
        local_user_id: localUserId,
        platform: Platform.OS
      });
    }
    return {
      expoPushToken: null,
      permissionStatus: 'error',
      deviceType: deviceType
    };
  }
}