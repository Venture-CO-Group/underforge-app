import { Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import { glowLogger } from '../lib/glow-logger';
import { useCallback, useEffect, useRef, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import AccountDeactivatedScreen from '../components/AccountDeactivatedScreen';
import AuthScreen from '../components/AuthScreen';
import EmailConfirmationScreen from '../components/EmailConfirmationScreen';
import ForgingIntroScreen from '../components/ForgingIntroScreen';
import IntroVideoScreen from '../components/IntroVideoScreen';
import { LanguageSelectionScreen, type SupportedLanguage } from '../components/LanguageSelectionScreen';
import MainAppContainer from '../components/MainAppContainer';
import OnboardingModalV2, { type SpecialCodeFlow } from '../components/OnboardingModalV2';
import ResetPasswordScreen from '../components/ResetPasswordScreen';
import SpecialCodeEntryModal from '../components/SpecialCodeEntryModal';
import { useResetPasswordDeepLink } from '../hooks/useResetPasswordDeepLink';
import { FontFamily } from '../constants/Typography';
import { syncActivityLogsFromSupabase } from '../lib/activity-storage';
import { deleteAccount, getSession, signOut } from '../lib/auth';
import { clearConversationHistory } from '../lib/conversation-storage';
import { deleteLoggedInUser, getCurrentLoggedInUser, initializeDatabase, LocalUser, restoreUserProfile, saveLoggedInUser } from '../lib/db';
import { getPushTokenWithStatus, PushTokenResult, requestPushTokenEarly } from '../lib/expo-notification-helper';
import { getCanonicalCoachKey } from '../lib/coach-config';
import { changeLanguage, getStoredLanguage, i18n, initI18n } from '../lib/i18n';
import { trackMetaAccountCreated, trackMetaAppOpen } from '../lib/meta-events';
import { persistPlanNutritionTargets, syncMealLogsFromSupabase } from '../lib/nutrition-storage';
import {
  cancelBackgroundPushTokenRecovery,
  ensurePushTokenForUserWithRecovery,
  registerAppForegroundPushTokenRecovery,
  unregisterAppForegroundPushTokenRecovery,
} from '../lib/push-token-sync';
import { onboardingEvents } from '../lib/supabase_db';
import { assignUserToCoach, findProfileByAuthUserId, findProfileByEmail, getCoaches, getRemoteUserProfileLoggedInUser, hasRemoteUserProfileForLoggedInUser, initializeSupabase, linkProfileToAuth, reactivateUserProfile, saveUserProfile, ValidatedSpecialCode } from '../lib/supabase_db_new';
import { clearCachedAccountStatus, clearLocalOnboardingData, getCachedAccountStatus, getPendingProfile, needsProfileSync, resolveCachedOnboardingProfile, retryPendingBodyCompositions, retryProfileSync, setCachedAccountStatus, setNeedsProfileSync, shouldRefreshAccountStatus, storeLocalOnboardingData, storePendingProfile } from '../lib/sync-status';
import { cancelWeeklyReportNotification } from '../lib/weekly-report-notifications';
import { syncFromSupabaseToLocal as syncWorkoutsFromSupabase } from '../lib/workout-sync-utils';
import { Onboard } from '../types/onboard';
import { OnboardingConfig } from '../types/onboarding_config';
import { DeviceType } from '../types/user_profile';

/** Avoid losing init errors when Metro Fast Refresh invalidates the glowLogger binding. */
function logAppError(message: string, properties: Record<string, string | number | boolean | object | null | undefined> = {}) {
  try {
    glowLogger.error(message, properties);
  } catch {
    console.error(`[ERROR] ${message}`, properties);
  }
}

/**
 * Content-equality check for the global onboarding object. `onboardingData` is
 * the single source of truth passed down to the whole app tree, so handing it a
 * new reference re-renders everything. Remote refresh/event handlers frequently
 * re-fetch identical data; comparing content lets us keep the SAME reference in
 * that case and avoid a tree-wide re-render storm (which previously churned the
 * heap until Android OOM'd). Parsed-from-JSON profiles have stable key order, so
 * a stringify compare is reliable and cheap enough for these infrequent events.
 */
function isSameOnboarding(a: Onboard | null, b: Onboard | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function AppContent() {
  const [loggedInUser, setLoggedInUser] = useState<LocalUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [onboardingConfig, setOnboardingConfig] = useState<OnboardingConfig | null>(null);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [onboardingData, setOnboardingData] = useState<Onboard | null>(null);
  const [pendingNotificationMessage, setPendingNotificationMessage] = useState<{ body: string, sender?: 'ai_coach' | 'human_coach', render_screen?: string } | null>(null);
  const [shouldGenerateWelcome, setShouldGenerateWelcome] = useState(false);
  const [hasSeenIntroVideo, setHasSeenIntroVideo] = useState(false);
  const [hasSelectedLanguage, setHasSelectedLanguage] = useState(false);
  const [languageSelectionChecked, setLanguageSelectionChecked] = useState(false);
  
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  
  // New user flow state
  const [isNewUserFlow, setIsNewUserFlow] = useState(false);
  const [showForgingIntro, setShowForgingIntro] = useState(false);
  const [showEmailConfirmation, setShowEmailConfirmation] = useState(false);
  const [pendingSignupEmail, setPendingSignupEmail] = useState<string | null>(null);
  const [pendingSignupPassword, setPendingSignupPassword] = useState<string | null>(null);
  const [needsSignupAfterOnboarding, setNeedsSignupAfterOnboarding] = useState(false);
  const [earlyPushTokenResult, setEarlyPushTokenResult] = useState<PushTokenResult | null>(null);
  const [isReloadingProfile, setIsReloadingProfile] = useState(false);
  const [showSpecialCodeModal, setShowSpecialCodeModal] = useState(false);
  const [specialCodeFlow, setSpecialCodeFlow] = useState<SpecialCodeFlow | null>(null);
  const { t } = useTranslation(['root', 'common', 'specialCode']);

  /**
   * Local cache first (offline), then remote refresh.
   * When local cache exists, remote refresh runs in the background by default so
   * startup is not blocked on flaky networks. Pass `awaitRemote: true` to block
   * (e.g. recovery Retry).
   */
  const loadProfileForLoggedInUser = useCallback(async (
    user: LocalUser,
    options?: { awaitRemote?: boolean },
  ): Promise<boolean> => {
    let loadedFromLocal = false;

    const cached = await resolveCachedOnboardingProfile(user.id);
    if (cached) {
      const complete = { ...cached, localUserId: cached.localUserId || user.id };
      setOnboardingData(complete);
      setHasCompletedOnboarding(true);
      loadedFromLocal = true;
      if (complete.name) {
        glowLogger.setUserIdentifier(complete.name, user.id);
      }
      glowLogger.info('Onboarding profile loaded from local cache', {
        user_id: user.id,
        user_name: complete.name,
      });
    }

    const refreshFromRemote = async (): Promise<boolean> => {
      try {
        const onboardingExists = await hasRemoteUserProfileForLoggedInUser();
        if (!onboardingExists) return false;

        const userProfileData = await getRemoteUserProfileLoggedInUser();
        if (!userProfileData?.onboardingProfile) return false;

        const profile = userProfileData.onboardingProfile;
        setOnboardingData(profile);
        setHasCompletedOnboarding(true);

        storeLocalOnboardingData(profile).catch(err =>
          glowLogger.warn('Failed to cache onboarding data locally on profile load', {
            error: err instanceof Error ? err.message : String(err),
          }),
        );

        const remoteStatus = userProfileData.account_status || 'active';
        setAccountStatus(remoteStatus);
        await setCachedAccountStatus(remoteStatus);

        if (profile.name) {
          glowLogger.setUserIdentifier(profile.name, user.id);
        }

        await ensurePushTokenForUserWithRecovery(user.id, {
          source: 'app_start_existing_user',
        });
        registerAppForegroundPushTokenRecovery(user.id);

        glowLogger.info('Onboarding profile refreshed from remote', {
          user_id: user.id,
        });
        return true;
      } catch (remoteProfileError) {
        glowLogger.warn('Failed to load remote profile, using local cache if available', {
          user_id: user.id,
          error: remoteProfileError instanceof Error ? remoteProfileError.message : String(remoteProfileError),
        });
        return false;
      }
    };

    const shouldAwaitRemote = options?.awaitRemote ?? !loadedFromLocal;

    if (shouldAwaitRemote) {
      const loadedFromRemote = await refreshFromRemote();
      if (!loadedFromLocal && !loadedFromRemote) {
        glowLogger.setUserIdentifier(user.display_name, user.id);
        glowLogger.info('No onboarding profile in local cache or remote', {
          user_id: user.id,
          display_name: user.display_name,
        });
      }
      return loadedFromLocal || loadedFromRemote;
    }

    if (loadedFromLocal) {
      void refreshFromRemote();
      return true;
    }

    glowLogger.setUserIdentifier(user.display_name, user.id);
    glowLogger.info('No onboarding profile in local cache or remote', {
      user_id: user.id,
      display_name: user.display_name,
    });
    return false;
  }, []);

  // Account status state (admin-controlled access)
  const [accountStatus, setAccountStatus] = useState<'active' | 'deactivated'>('active');
  const accountStatusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Supabase password-recovery deep link handling. When the user taps the
  // reset-password link in their email, this hook parses the tokens,
  // establishes a short-lived session via setSession, and flips recoveryActive
  // to true so we render the ResetPasswordScreen. This is completely separate
  // from the signup email-confirmation flow (showEmailConfirmation).
  const { recoveryActive, recoveryError, clearRecovery } = useResetPasswordDeepLink();

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Log app startup
        glowLogger.info('App initialization started', {
          event: 'startup',
        });
        try {
          await trackMetaAppOpen();
        } catch (metaError) {
          glowLogger.warn('Meta app-open tracking failed at init', {
            error: metaError instanceof Error ? metaError.message : String(metaError),
          });
        }
        
        // Let notifications that request sound actually play it (e.g., rest timer completion).
        Notifications.setNotificationHandler({
          handleNotification: async (notification) => ({
            shouldShowAlert: true,
            shouldPlaySound: !!notification.request.content.sound,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });
        
        // Check if app was opened from a notification
        const lastNotificationResponse = await Notifications.getLastNotificationResponseAsync();
        if (lastNotificationResponse) {
          glowLogger.info('App opened from notification', {
            notification_body: lastNotificationResponse.notification.request.content.body,
            notification_title: lastNotificationResponse.notification.request.content.title,
            notification_data: lastNotificationResponse.notification.request.content.data,
            notification_sender: lastNotificationResponse.notification.request.content.data?.sender || 'unknown',
            render_screen: (lastNotificationResponse.notification.request.content.data as any)?.render_screen,
          });
          
          // Store the notification message to be handled once ChatScreen is ready
          const coldData = lastNotificationResponse.notification.request.content.data as any;
          const coldBody = lastNotificationResponse.notification.request.content.body;
          if (
            coldBody
            || coldData?.render_screen === 'weekly_progress_report'
            || coldData?.render_screen === 'forging_circle'
          ) {
            setPendingNotificationMessage({
              body: coldBody || '',
              sender: coldData?.sender as any,
              render_screen: coldData?.render_screen,
            });
          }
        }
        
        // Log app directories (Expo equivalent of NSHomeDirectory)
        glowLogger.info('=== APP DIRECTORIES ===', {});
        glowLogger.info('App dir (documentDirectory): ' + Paths.document.uri, {
          directory_type: 'documentDirectory'
        });
        glowLogger.info('Cache dir (cacheDirectory): ' + Paths.cache.uri, {
          directory_type: 'cacheDirectory'
        });
        glowLogger.info('Bundle dir (bundleDirectory): ' + Paths.bundle.uri, {
          directory_type: 'bundleDirectory'
        });
        glowLogger.info('========================', {});
        
        await initializeDatabase();
        await initializeSupabase();
        let user = await getCurrentLoggedInUser();
        
        // AUTH CHECK: Check for existing Supabase Auth session
        // Sessions are persisted in secure storage and survive app updates/reinstalls
        glowLogger.info('Checking for existing auth session', {});
        
        // Add timeout to prevent indefinite hang on network issues
        const SESSION_TIMEOUT_MS = 7000; // 7 seconds
        let session = null;
        // Distinguish a transient failure (timeout / network error) from a clean
        // "no session" result. A clean null means the user is genuinely logged
        // out; a failure means we simply could not reach the network and should
        // fall back to the locally-cached logged-in state instead of bouncing
        // the user back to the auth/intro screen.
        let sessionCheckFailed = false;
        try {
          session = await Promise.race([
            getSession(),
            new Promise<null>((_, reject) => 
              setTimeout(() => reject(new Error('Session check timed out')), SESSION_TIMEOUT_MS)
            )
          ]);
        } catch (sessionError) {
          sessionCheckFailed = true;
          glowLogger.warn('Session check failed or timed out, proceeding without session', {
            error: sessionError instanceof Error ? sessionError.message : String(sessionError)
          });
          // session remains null, will fall back to offline mode if a local user exists
        }
        
        if (session) {
          const emailVerifiedFromSession = !!session.user.email_confirmed_at;
          
          glowLogger.info('Found existing auth session', {
            auth_user_id: session.user.id,
            email: session.user.email,
            email_verified: emailVerifiedFromSession
          });
          
          setIsAuthenticated(true);
          setAuthUserId(session.user.id);
          setAuthEmail(session.user.email || null);
          setIsEmailVerified(emailVerifiedFromSession);
          
          // AUTO-RESTORE: If authenticated but no local user, restore via auth_user_id
          if (!user) {
            glowLogger.info('No local user but authenticated, attempting auto-restore via auth_user_id', {});
            
            try {
              const existingProfile = await findProfileByAuthUserId(session.user.id);
              
              if (existingProfile) {
                glowLogger.info('Found existing profile for authenticated user, auto-restoring', {
                  user_id: existingProfile.userId,
                  display_name: existingProfile.displayName
                });
                
                // Restore the profile to local database
                await restoreUserProfile(
                  existingProfile.userId,
                  existingProfile.displayName || 'Restored User'
                );
                
                
                // Refresh the user from local database
                user = await getCurrentLoggedInUser();
                
                if (user) {
                  glowLogger.info('Auto-restore via auth successful!', {
                    user_id: user.id,
                    display_name: user.display_name,
                    email_verified: emailVerifiedFromSession
                  });
                }
              } else {
                glowLogger.info('No existing profile found for auth_user_id - user needs onboarding', {});
              }
            } catch (autoRestoreError) {
              glowLogger.error('Auto-restore via auth failed', {
                error: autoRestoreError instanceof Error ? autoRestoreError.message : String(autoRestoreError)
              });
            }
          }
        } else if (sessionCheckFailed && user) {
          // OFFLINE MODE: We couldn't verify the session (timeout / no network),
          // but a logged-in user exists in the local database. Rather than
          // resetting to the intro/auth screen, treat the user as authenticated
          // using their persisted local state. A user only ends up in the local
          // database after a successful, email-verified sign-in/onboarding, and
          // logout clears it, so this is a safe signal. The session will be
          // re-validated automatically on the next launch with connectivity.
          glowLogger.warn('Session check failed but local user exists - entering offline mode', {
            user_id: user.id,
            display_name: user.display_name,
          });
          setIsAuthenticated(true);
          setIsEmailVerified(true);
          setHasSeenIntroVideo(true);
        } else {
          glowLogger.info('No auth session found - user needs to authenticate', {});
          setIsAuthenticated(false);
          
          // If no local user and no auth session, show intro video first
          if (!user) {
            glowLogger.info('No local user and no auth session - showing intro video', {});
            setHasSeenIntroVideo(false); // Ensure intro video is shown
            setIsLoading(false);
            
            // Load onboarding config for later use
            const config = require('../assets/onboarding_config');
            setOnboardingConfig(config);
            return; // Exit early - will show intro video
          }
        }
        
        setLoggedInUser(user);

        // Profile first: local cache is instant; remote refresh is background when cached.
        if (user) {
          await loadProfileForLoggedInUser(user);
        }

        // Check for pending profile sync and retry if needed
        if (user && await needsProfileSync()) {
          const pendingProfile = await getPendingProfile();
          if (pendingProfile) {
            // Retry profile sync in background (no setSyncStatus callback since state not available here)
            retryProfileSync(pendingProfile, undefined);
          }
        }

        // Retry any pending body composition syncs in background
        retryPendingBodyCompositions().then(result => {
          if (result.total > 0) {
            console.log(`Body composition sync: ${result.succeeded}/${result.total} succeeded`);
          }
        }).catch(error => {
          console.error('Error retrying body composition syncs:', error);
        });

        if (!user) {
          glowLogger.info('No logged in user found - skipping onboarding data load', {});
          // No logged in user, so we should show onboarding
          setHasCompletedOnboarding(false);
          // Keep GlowLogger as unknown_user since no user is logged in
        }

        // Load onboarding configuration
        const config = require('../assets/onboarding_config');
        setOnboardingConfig(config);
      } catch (error) {
        logAppError('Error initializing app', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsLoading(false);
      }
    };

    // Listen for notification responses (app opened from notification)
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      glowLogger.info('[App] App opened from notification', {
        notification_response: JSON.stringify(response),
        notification_body: response.notification.request.content.body,
        notification_title: response.notification.request.content.title,
        notification_data: JSON.stringify(response.notification.request.content.data),
        notification_sender: response.notification.request.content.data?.sender || 'unknown',
        render_screen: (response.notification.request.content.data as any)?.render_screen,
        timestamp: new Date().toISOString(),
        action_identifier: response.actionIdentifier
      });
      
      const data = response.notification.request.content.data as any;
      const body = response.notification.request.content.body;
      if (
        body
        || data?.render_screen === 'weekly_progress_report'
        || data?.render_screen === 'forging_circle'
      ) {
        setPendingNotificationMessage({
          body: body || '',
          sender: data?.sender as any,
          render_screen: data?.render_screen,
        });
      }
    });

    initializeApp();

    return () => {
      // Clean up notification listener
      subscription.remove();
      cancelBackgroundPushTokenRecovery();
      unregisterAppForegroundPushTokenRecovery();
      // Note: Don't close database here as logout operations may need it
      // Database connections will be cleaned up by the system when app exits
    };
  }, [loadProfileForLoggedInUser]);

  useEffect(() => {
    const checkLanguageSelection = async () => {
      try {
        const storedLanguage = await getStoredLanguage();
        setHasSelectedLanguage(!!storedLanguage);
      } catch {
        setHasSelectedLanguage(false);
      } finally {
        setLanguageSelectionChecked(true);
      }
    };

    checkLanguageSelection();
  }, []);

  // Subscribe to onboarding data changes globally
  useEffect(() => {
    const handler = async (event: any) => {
      glowLogger.info('[AppContent] onboardingDataChanged event received', { event });
      try {
        // Always reload from disk to ensure we have the latest data
        glowLogger.info('[AppContent] Reloading onboarding data from remote', {});
        const userProfileData = await getRemoteUserProfileLoggedInUser();
        if (userProfileData) {
          glowLogger.info('[AppContent] Updating global onboarding data after profile change', {});
          glowLogger.info('[AppContent] New profile data', {
            coach: userProfileData.onboardingProfile.selectedCoach,
            goal: userProfileData.onboardingProfile.selectedGoal,
            email: userProfileData.onboardingProfile.email
          });
          // Only swap the global object when the content actually changed —
          // otherwise we keep the same reference and skip a tree-wide re-render.
          setOnboardingData(prev =>
            isSameOnboarding(prev, userProfileData.onboardingProfile)
              ? prev
              : userProfileData.onboardingProfile,
          );

          // If this is a profile restoration, set all conditions to show main app
          if (event?.action === 'profile_restored') {
            glowLogger.info('[AppContent] Profile restored, setting all conditions for main app', {});
            setHasSeenIntroVideo(true);
            setHasCompletedOnboarding(true);
            setIsAuthenticated(true);
            setIsEmailVerified(true);
          }
        }
      } catch (error) {
        glowLogger.error('[AppContent] Error reloading onboarding data', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };
    
    onboardingEvents.on('onboardingDataChanged', handler);
    glowLogger.info('[AppContent] Subscribed to onboardingDataChanged events', {});

    return () => {
      onboardingEvents.off('onboardingDataChanged', handler);
      glowLogger.info('[AppContent] Unsubscribed from onboardingDataChanged events', {});
    };
  }, []);

  // Account status periodic refresh (every 24 hours)
  useEffect(() => {
    // Only set up the interval when user is authenticated
    if (!isAuthenticated || !loggedInUser) {
      return;
    }

    const checkAndRefreshAccountStatus = async () => {
      try {
        const shouldRefresh = await shouldRefreshAccountStatus();
        if (!shouldRefresh) {
          glowLogger.info('Account status refresh not needed yet', {});
          return;
        }

        glowLogger.info('Refreshing account status from server', {});
        const userProfileData = await getRemoteUserProfileLoggedInUser();
        if (userProfileData) {
          const newStatus = userProfileData.account_status || 'active';
          setAccountStatus(newStatus);
          await setCachedAccountStatus(newStatus);
          glowLogger.info('Account status refreshed', { 
            account_status: newStatus,
            user_id: loggedInUser.id 
          });
        }
      } catch (error) {
        // Silent fail - use cached status, don't block user
        glowLogger.warn('Failed to refresh account status, using cached value', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    // Load cached status on mount (for offline support)
    const loadCachedStatus = async () => {
      const cached = await getCachedAccountStatus();
      if (cached) {
        setAccountStatus(cached.status);
        glowLogger.info('Loaded cached account status', { 
          status: cached.status, 
          last_checked: new Date(cached.lastChecked).toISOString() 
        });
      }
    };

    loadCachedStatus();

    // Set up 24-hour refresh interval (check every hour, but only refresh if 24h passed)
    const ONE_HOUR_MS = 60 * 60 * 1000;
    accountStatusIntervalRef.current = setInterval(checkAndRefreshAccountStatus, ONE_HOUR_MS);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (accountStatusIntervalRef.current) {
        clearInterval(accountStatusIntervalRef.current);
        accountStatusIntervalRef.current = null;
      }
    };
  }, [isAuthenticated, loggedInUser]);

  const reloadOnboardingData = async () => {
    try {
      glowLogger.info('[AppContent] Reloading onboarding data...', {});
      const userProfileData = await getRemoteUserProfileLoggedInUser();
      if (userProfileData) {
        setOnboardingData(prev =>
          isSameOnboarding(prev, userProfileData.onboardingProfile)
            ? prev
            : userProfileData.onboardingProfile,
        );
        glowLogger.info('[AppContent] Onboarding data reloaded successfully', {});
      }
    } catch (error) {
      glowLogger.error('[AppContent] Error reloading onboarding data', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  // Handle onboarding completion
  const handleOnboardingComplete = async (data: Onboard) => {

    const userName = data.name ?? "unknown";
    glowLogger.info(`=== ONBOARDING COMPLETED for ${userName} ===`, {
      user_display_name: userName,
      onboarding_data: JSON.stringify(data, null, 2)
    });
    
    glowLogger.info('handleOnboardingComplete started', {
      user_name: userName,
      has_onboarding_data: !!data,
      is_new_user_flow: isNewUserFlow
    });

    // For new user flow, store data and show signup screen
    if (isNewUserFlow && !isAuthenticated) {
      glowLogger.info('New user flow: storing onboarding data, showing signup screen', {});
      setOnboardingData(data);
      setNeedsSignupAfterOnboarding(true);
      return;
    }
    
    try {
      // Save user to local database and get the generated UUID
      const localUserId = await saveLoggedInUser(data.name);
      glowLogger.info('User saved to local database', { 
        local_user_id: localUserId,
        user_name: data.name
      });
      
      // Add the localUserId to the onboarding data
      const completeOnboardingData: Onboard = {
        ...data,
        localUserId: localUserId
      };
      
      glowLogger.info('Added localUserId to onboarding data', { 
        local_user_id: localUserId
      });
      
      // Save user profile to Supabase using the UUID from local database.
      // Reuse the token we requested when the user tapped "New User" so we
      // don't run the (sometimes-hanging) Expo APNs request twice in a row.
      const pushTokenResult: PushTokenResult | null = earlyPushTokenResult;

      if (!pushTokenResult?.expoPushToken) {
        glowLogger.warn(
          'Onboarding completion: no early push token available - profile will be saved without one and recovered in background',
          {
            local_user_id: localUserId,
            permission_status: pushTokenResult?.permissionStatus,
            device_type: pushTokenResult?.deviceType,
          }
        );
      }

      const userProfileArgs: any = {
        user_id: localUserId,
        display_name: data.name,
        onboardingProfile: completeOnboardingData,
        expoPushToken: pushTokenResult?.expoPushToken || null,
        device_type: pushTokenResult?.deviceType || DeviceType.IOS_DEVICE,
        active: true
      };
      
      // Link profile to auth account if user is authenticated
      if (authUserId) {
        userProfileArgs.auth_user_id = authUserId;
        userProfileArgs.email = authEmail;
        glowLogger.info('Linking new profile to auth account', {
          local_user_id: localUserId,
          auth_user_id: authUserId,
          email: authEmail
        });
      }
      
      try {
        // Save user profile with all collected information
        await saveUserProfile(userProfileArgs, true); // Save AI-generated copy for onboarding completion
        
        glowLogger.info('User profile updated with push token and device type', { 
          local_user_id: localUserId,
          has_push_token: !!pushTokenResult?.expoPushToken,
          device_type: pushTokenResult?.deviceType,
          permission_status: pushTokenResult?.permissionStatus
        });

        // Assign user to coach in coach_user table
        // Coach ID is stored from database when user selects coach during onboarding
        const coachId = completeOnboardingData.coachId;
        glowLogger.info('=== COACH ASSIGNMENT START ===', {
          local_user_id: localUserId,
          selected_coach: completeOnboardingData.selectedCoach || 'none',
          coach_id: coachId || 'none'
        });
        
        if (coachId) {
          await assignUserToCoach(localUserId, coachId, completeOnboardingData.selectedCoach);
          glowLogger.info('=== COACH ASSIGNMENT COMPLETE ===', {
            local_user_id: localUserId,
            coach_id: coachId,
            selected_coach: completeOnboardingData.selectedCoach
          });
        } else {
          glowLogger.warn('No coach ID in onboarding data, skipping coach assignment', {
            local_user_id: localUserId,
            selected_coach: completeOnboardingData.selectedCoach || 'none'
          });
        }
      } catch (supabaseError) {
        glowLogger.error('Error saving user profile to Supabase', { 
          error: supabaseError instanceof Error ? supabaseError.message : String(supabaseError),
          local_user_id: localUserId 
        });
        
        // Store profile data for retry
        await storePendingProfile({
          user_id: localUserId,
          display_name: data.name,
          onboardingProfile: completeOnboardingData,
          expoPushToken: pushTokenResult?.expoPushToken || null,
          device_type: pushTokenResult?.deviceType || DeviceType.IOS_DEVICE,
          active: true
        });
        
        // Show error alert to user
        Alert.alert(
          t('root:connectionIssueTitle'),
          t('root:connectionIssueBody'),
          [{ text: t('common:ok') }]
        );
        
        // Continue even if Supabase save fails - user can still use app locally
        // MainAppContainer will check for pending sync and show banner
      }
      
      // Persist LLM-derived nutrition targets to user_nutrition_targets so the
      // dashboard, daily-nutrition, and adjustment layer all read from the
      // same source-of-truth row (instead of the plan JSON).
      try {
        if (completeOnboardingData.actionPlan) {
          await persistPlanNutritionTargets({
            userId: localUserId,
            actionPlan: completeOnboardingData.actionPlan,
            onboardData: completeOnboardingData,
          });
        }
      } catch (e) {
        glowLogger.warn('Failed to persist plan nutrition targets after onboarding', {
          error: e instanceof Error ? e.message : String(e),
        });
      }

      // Update app state
      setOnboardingData(completeOnboardingData);
      setHasCompletedOnboarding(true);
      setLoggedInUser({ id: localUserId, display_name: data.name, seen_intro_tutorial: false, active: true });
      
      // Update GlowLogger with both user name and local user ID - this is the fix for issue #1
      glowLogger.setUserIdentifier(data.name, localUserId);
      glowLogger.info('GlowLogger updated after onboarding completion', {
        user_display_name: data.name,
        local_user_id: localUserId
      });
      
      // Set flag to generate welcome messages when ChatScreen mounts
      // This ensures the typing indicator can be shown for a realistic experience
      glowLogger.info('Setting shouldGenerateWelcome flag for new user', {
        userId: localUserId,
        userName: data.name
      });
      setShouldGenerateWelcome(true);
      
      // Log completion to Glow
      glowLogger.info('ONBOARDING COMPLETED', {
        jsonData: JSON.stringify(completeOnboardingData, null, 2),
        timestamp: new Date().toISOString(),
      });

      ensurePushTokenForUserWithRecovery(localUserId, {
        source: 'onboarding_completed',
      }).catch(err =>
        glowLogger.warn('Post-onboarding push token sync threw', {
          error: err instanceof Error ? err.message : String(err),
          local_user_id: localUserId,
        })
      );
      registerAppForegroundPushTokenRecovery(localUserId);

      glowLogger.info('Onboarding completed successfully', {});
    } catch (error) {
      glowLogger.error('Error processing onboarding completion', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Still proceed to hide onboarding modal even if processing fails
      setHasCompletedOnboarding(false);
    }
  };

  const resetAppState = () => {
    setLoggedInUser(null);
    setHasCompletedOnboarding(false);
    setOnboardingData(null);
    setIsAuthenticated(false);
    setAuthUserId(null);
    setAuthEmail(null);
    setIsEmailVerified(false);
    setShowAuthScreen(false);
    setHasSeenIntroVideo(false);
    setIsNewUserFlow(false);
    setShowForgingIntro(false);
    setShowEmailConfirmation(false);
    setPendingSignupEmail(null);
    setPendingSignupPassword(null);
    setNeedsSignupAfterOnboarding(false);
    setEarlyPushTokenResult(null);
    setAccountStatus('active');

    if (accountStatusIntervalRef.current) {
      clearInterval(accountStatusIntervalRef.current);
      accountStatusIntervalRef.current = null;
    }

    cancelBackgroundPushTokenRecovery();
    unregisterAppForegroundPushTokenRecovery();

    glowLogger.setUserIdentifier('', '');
    void glowLogger.flush();
  };

  const handleLogout = async () => {
    try {
      const currentUser = await getCurrentLoggedInUser();
      
      glowLogger.info('Signing out from Supabase Auth', {});
      await signOut();

      await cancelWeeklyReportNotification();
      
      await clearConversationHistory();
      await clearLocalOnboardingData();
      await setNeedsProfileSync(false);
      await clearCachedAccountStatus();
      
      if (currentUser) {
        glowLogger.info('Deleting current user from local database', { 
          displayName: currentUser.display_name 
        });
        await deleteLoggedInUser(currentUser.id);
        glowLogger.info('User deleted from local database successfully', {});
      }
      
      resetAppState();
      glowLogger.info('Logout completed successfully', {});
    } catch (error) {
      glowLogger.error('Error during logout', {
        error: error instanceof Error ? error.message : String(error),
        error_stack: error instanceof Error ? error.stack : undefined
      });
      resetAppState();
    }
  };

  const handleDeleteAccount = async () => {
    try {
      const currentUser = await getCurrentLoggedInUser();
      if (!currentUser) {
        Alert.alert(t('auth:alertErrorTitle'), t('root:connectionIssueBody'));
        return;
      }

      glowLogger.info('Starting account deletion flow', { user_id: currentUser.id });

      const result = await deleteAccount(currentUser.id);

      if (!result.success) {
        glowLogger.error('Account deletion failed', { error: result.error });
        Alert.alert(t('root:deletionFailedTitle'), result.error || t('auth:errorGeneric'));
        return;
      }

      resetAppState();
      glowLogger.info('Account deletion completed successfully', {});
    } catch (error) {
      glowLogger.error('Account deletion exception', {
        error: error instanceof Error ? error.message : String(error),
      });
      Alert.alert(t('auth:alertErrorTitle'), t('auth:errorGeneric'));
    }
  };

  // Save profile for new users after signup
  // Uses local-first approach: save locally, then try Supabase in background
  const saveNewUserProfile = async (data: Onboard, newAuthUserId: string, email: string) => {
    let localUserId: string | undefined;
    
    try {
      // Check if profile already exists for this auth user (avoid duplicate key error)
      const existingProfile = await findProfileByAuthUserId(newAuthUserId);
      if (existingProfile) {
        glowLogger.info('Profile already exists for auth user, restoring session', { 
          auth_user_id: newAuthUserId, 
          user_id: existingProfile.userId 
        });
        
        // Restore existing profile instead of creating new one
        await restoreUserProfile(existingProfile.userId, existingProfile.displayName);
        setLoggedInUser({ id: existingProfile.userId, display_name: existingProfile.displayName, seen_intro_tutorial: true, active: true });
        
        // Fetch full profile data (after restoring, the user is active)
        const fullProfile = await getRemoteUserProfileLoggedInUser();
        if (fullProfile?.onboardingProfile) {
          setOnboardingData(fullProfile.onboardingProfile);
        }
        
        await ensurePushTokenForUserWithRecovery(existingProfile.userId, {
          source: 'save_new_user_profile_existing_branch',
        });
        registerAppForegroundPushTokenRecovery(existingProfile.userId);

        glowLogger.setUserIdentifier(existingProfile.displayName, existingProfile.userId);
        return;
      }

      // Step 1: Save to local SQLite database first
      const localUserId = await saveLoggedInUser(data.name);
      glowLogger.info('New user profile: saved to local database', { local_user_id: localUserId });

      // Step 2: Store complete onboarding data locally (AsyncStorage) for offline access
      const completeOnboardingData: Onboard = { ...data, localUserId };
      await storeLocalOnboardingData(completeOnboardingData);
      glowLogger.info('Onboarding data stored locally for offline access', { local_user_id: localUserId });

      // Step 3: Use early push token (obtained when user tapped "New User" while app was in foreground)
      // This avoids the timeout issue when app goes to background during email confirmation
      let pushTokenResult = earlyPushTokenResult;
      
      if (pushTokenResult) {
        glowLogger.info('Using early push token result', { 
          local_user_id: localUserId,
          has_token: !!pushTokenResult.expoPushToken,
          token_preview: pushTokenResult.expoPushToken?.substring(0, 30) || 'null',
          permission_status: pushTokenResult.permissionStatus,
          device_type: pushTokenResult.deviceType
        });
      } else {
        // Fallback: request now if early token wasn't obtained (shouldn't happen normally)
        glowLogger.warn('Early push token not available, requesting now (may timeout if app is backgrounded)', { 
          local_user_id: localUserId 
        });
        pushTokenResult = await getPushTokenWithStatus(localUserId) || null;
      }
      
      // Warn if push token is null on a real device - this means notifications won't work
      if (!pushTokenResult?.expoPushToken && 
          (pushTokenResult?.deviceType === DeviceType.IOS_DEVICE || pushTokenResult?.deviceType === DeviceType.ANDROID_DEVICE)) {
        glowLogger.warn('CRITICAL: No push token obtained for real device - user will NOT receive notifications', {
          local_user_id: localUserId,
          device_type: pushTokenResult.deviceType,
          permission_status: pushTokenResult.permissionStatus,
          suggestion: 'Push token will be retried after email confirmation'
        });
      }

      // Step 4: Build profile args for Supabase
      const userProfileArgs: any = {
        user_id: localUserId,
        display_name: data.name,
        onboardingProfile: completeOnboardingData,
        expoPushToken: pushTokenResult?.expoPushToken || null,
        device_type: pushTokenResult?.deviceType || DeviceType.IOS_DEVICE,
        active: true,
        auth_user_id: newAuthUserId,
        email: email,
        signup_code: specialCodeFlow?.code ?? null
      };

      // Step 5: Try to save to Supabase (but don't block on failure)
      glowLogger.info('Calling saveUserProfile to Supabase', { 
        local_user_id: localUserId, 
        auth_user_id: newAuthUserId,
        has_push_token: !!userProfileArgs.expoPushToken
      });
      try {
      await saveUserProfile(userProfileArgs, true);
        glowLogger.info('New user profile saved to Supabase successfully', { local_user_id: localUserId, auth_user_id: newAuthUserId });
        
        // Assign coach immediately after profile save succeeds (FK constraint requires profile to exist)
        const coachId = data.coachId;
        if (coachId) {
          await assignUserToCoach(localUserId, coachId, data.selectedCoach);
          glowLogger.info('Coach assigned to new user after profile save', { 
            local_user_id: localUserId, 
            coach_id: coachId,
            selected_coach: data.selectedCoach
          });
        } else {
          glowLogger.warn('No coachId in onboarding data during saveNewUserProfile', {
            local_user_id: localUserId,
            selected_coach: data.selectedCoach || 'none'
          });
        }
      } catch (supabaseError) {
        // Supabase save failed - store for retry but continue with local data
        glowLogger.error('Failed to save profile to Supabase, storing for retry', { 
          error: supabaseError instanceof Error ? supabaseError.message : String(supabaseError),
          local_user_id: localUserId 
        });
        
        // Store pending profile data for retry
        await storePendingProfile({
          user_id: localUserId,
          display_name: data.name,
          onboardingProfile: completeOnboardingData,
          expoPushToken: pushTokenResult?.expoPushToken || null,
          device_type: pushTokenResult?.deviceType || DeviceType.IOS_DEVICE,
          active: true,
          auth_user_id: newAuthUserId,
          email: email,
          signup_code: specialCodeFlow?.code ?? null
        });
        
        glowLogger.info('Profile stored for background retry sync', { local_user_id: localUserId });
        // Don't show alert here - the SyncStatusBanner will handle UI feedback
      }

      // Step 6: Set state for local usage (regardless of Supabase success)
      setLoggedInUser({ id: localUserId, display_name: data.name, seen_intro_tutorial: false, active: true });
      setOnboardingData(completeOnboardingData);
      glowLogger.setUserIdentifier(data.name, localUserId);
      setShouldGenerateWelcome(true);
      await trackMetaAccountCreated();

      // If the early request didn't return a token (or never resolved), the
      // profile got persisted with `expo_push_token = NULL`. Kick off the
      // background recovery chain so the user doesn't stay tokenless.
      if (!pushTokenResult?.expoPushToken) {
        ensurePushTokenForUserWithRecovery(localUserId, {
          source: 'save_new_user_profile_post_save',
        }).catch(err =>
          glowLogger.warn('Post-signup push token sync threw', {
            error: err instanceof Error ? err.message : String(err),
            local_user_id: localUserId,
          })
        );
      }
      registerAppForegroundPushTokenRecovery(localUserId);
    } catch (error) {
      // Critical failure (e.g., local SQLite save failed)
      glowLogger.error('Critical error saving new user profile', { error: error instanceof Error ? error.message : String(error) });
      Alert.alert(
        t('root:profileSaveFailedTitle'),
        t('root:profileSaveFailedBody'),
        [{ text: t('common:ok') }]
      );
    }
  };

  // Handle successful authentication (signup or signin)
  const handleAuthSuccess = async (newAuthUserId: string, email: string, isNewUser: boolean, emailVerified: boolean, signupPassword?: string) => {
    glowLogger.info('Auth success callback', {
      auth_user_id: newAuthUserId,
      email,
      is_new_user: isNewUser,
      email_verified: emailVerified,
      is_new_user_flow: isNewUserFlow
    });

    // Store auth info first (these are safe state updates)
    setAuthError(null);
    setAuthUserId(newAuthUserId);
    setAuthEmail(email);
    setNeedsSignupAfterOnboarding(false);

    // NOTE: Don't set showAuthScreen=false until we're sure we can show another screen
    // This prevents getting stuck in "UnderForge loading" if subsequent operations fail

    try {
      // If new user flow (signup after onboarding) and email not verified, show confirmation screen
      if (isNewUserFlow && !emailVerified && onboardingData) {
        glowLogger.info('New user needs to confirm email', { email });
        
        // Set email confirmation state FIRST to prevent re-render race condition
        // (saveNewUserProfile sets state internally which triggers re-render before we return)
        setPendingSignupEmail(email);
        setPendingSignupPassword(signupPassword || null);
        setShowEmailConfirmation(true);
        setShowAuthScreen(false);
        
        // Save profile in background (fire-and-forget) - don't block the email confirmation flow
        // The button is enabled immediately; if save fails, SyncStatusBanner handles retry
        saveNewUserProfile(onboardingData, newAuthUserId, email).catch(err => {
          glowLogger.error('Background profile save failed', { 
            error: err instanceof Error ? err.message : String(err),
            email 
          });
        });
        return;
      }

    // If new user flow and email verified, save profile and proceed
    if (isNewUserFlow && emailVerified && onboardingData) {
      glowLogger.info('New user email already verified, saving profile', { email });
      await saveNewUserProfile(onboardingData, newAuthUserId, email);
      setIsAuthenticated(true);
      setIsEmailVerified(true);
      setHasCompletedOnboarding(true);
        setShowAuthScreen(false); // Safe: main app will show
      return;
    }

    setIsAuthenticated(true);
    setIsEmailVerified(emailVerified);
    
    // Check if this auth user already has a profile (existing user signing in)
    let existingProfile = await findProfileByAuthUserId(newAuthUserId);
    
    // If not found by auth_user_id, check by email (legacy user migration)
    if (!existingProfile && email) {
      glowLogger.info('No profile found by auth_user_id, checking by email', { email });
      existingProfile = await findProfileByEmail(email);
      
      if (existingProfile) {
        glowLogger.info('Found existing profile by email, linking to auth account', {
          user_id: existingProfile.userId,
          display_name: existingProfile.displayName,
          email
        });

        const linkResult = await linkProfileToAuth(existingProfile.userId, newAuthUserId, email);
        if (!linkResult.success) {
          glowLogger.error('Failed to link profile to auth', { error: linkResult.error });
        }
      }
    }
    
    if (existingProfile) {
      // Existing user - restore their profile
      glowLogger.info('Existing user authenticated, restoring profile', {
        user_id: existingProfile.userId,
        display_name: existingProfile.displayName
      });
      
      await restoreUserProfile(existingProfile.userId, existingProfile.displayName);
      
      // Reactivate the remote profile (may have been deactivated by another user
      // signing up on the same device via setOtherUserProfilesInactive)
      await reactivateUserProfile(existingProfile.userId);
      
      const user = await getCurrentLoggedInUser();
      setLoggedInUser(user);
      
      // Load their onboarding data
      const userProfileData = await getRemoteUserProfileLoggedInUser();
      if (userProfileData?.onboardingProfile) {
        setOnboardingData(userProfileData.onboardingProfile);
        setHasCompletedOnboarding(true);
        setHasSeenIntroVideo(true);
        setShowAuthScreen(false); // Safe: main app will show

        // Cache the profile locally so subsequent offline launches can restore
        // the user's session without network access (offline home tab).
        storeLocalOnboardingData(userProfileData.onboardingProfile).catch(err =>
          glowLogger.warn('Failed to cache onboarding data locally on sign-in', {
            error: err instanceof Error ? err.message : String(err),
          })
        );

        // Pre-populate local DB with remote workout + meal + activity data so the dashboard isn't empty
        syncWorkoutsFromSupabase(existingProfile.userId).catch(err =>
          glowLogger.warn('Background workout sync failed on sign-in', { error: err instanceof Error ? err.message : String(err) })
        );
        syncMealLogsFromSupabase(existingProfile.userId).catch(err =>
          glowLogger.warn('Background meal sync failed on sign-in', { error: err instanceof Error ? err.message : String(err) })
        );
        syncActivityLogsFromSupabase(existingProfile.userId).catch(err =>
          glowLogger.warn('Background activity sync failed on sign-in', { error: err instanceof Error ? err.message : String(err) })
        );

        // Check and cache account status for existing user signing back in
        const remoteStatus = userProfileData.account_status || 'active';
        setAccountStatus(remoteStatus);
        await setCachedAccountStatus(remoteStatus);
        glowLogger.info('Account status checked on sign-in', { 
          account_status: remoteStatus,
          user_id: existingProfile.userId 
        });
        
        glowLogger.setUserIdentifier(
          userProfileData.onboardingProfile.name || existingProfile.displayName,
          existingProfile.userId
        );

        await ensurePushTokenForUserWithRecovery(existingProfile.userId, {
          source: 'auth_success_existing_user_signin',
        });
        registerAppForegroundPushTokenRecovery(existingProfile.userId);
        
        // Legacy user migration: existing profile found but email not verified
        if (isNewUser && !emailVerified && signupPassword) {
          glowLogger.info('Legacy user needs to verify email', { email });
          setPendingSignupEmail(email);
          setPendingSignupPassword(signupPassword);
          setShowEmailConfirmation(true);
          return;
        }
      } else {
        // Profile exists but no onboarding data - should go through onboarding
        setHasCompletedOnboarding(false);
          setShowAuthScreen(false); // Safe: onboarding will show (if isNewUserFlow) or loading
      }
    } else {
      // No profile found
      if (!isNewUserFlow && isNewUser) {
          // Signup in existing user flow - no profile found for this email
        glowLogger.warn('Signup attempted with email not in user base', { email });
        await signOut();
        setIsAuthenticated(false);
        setAuthUserId(null);
        setAuthEmail(null);
        setIsEmailVerified(false);
          setAuthError('Email not present in user base. For new users, please tap "New User" instead.');
          // Keep showAuthScreen=true to show error
        return;
      }
      
        if (!isNewUserFlow && !isNewUser) {
          // Sign-in in existing user flow but no profile found
          // This shouldn't normally happen - user signed in but has no profile
          glowLogger.warn('Existing user signed in but no profile found', { email });
          await signOut();
          setIsAuthenticated(false);
          setAuthUserId(null);
          setAuthEmail(null);
          setIsEmailVerified(false);
          setAuthError('No profile found for this account. Please tap "New User" to create a new profile.');
          // Keep showAuthScreen=true to show error
          return;
        }
        
        // New user flow - proceed to onboarding
      glowLogger.info('New user authenticated, proceeding to onboarding', { 
        auth_user_id: newAuthUserId,
        email
      });
      setHasCompletedOnboarding(false);
        setShowAuthScreen(false); // Safe: will show onboarding because isNewUserFlow=true here
    }

    // Load onboarding config
    const config = require('../assets/onboarding_config');
    setOnboardingConfig(config);
      
    } catch (error) {
      // If ANY operation fails, reset to auth screen with error message
      glowLogger.error('Error in handleAuthSuccess', {
        error: error instanceof Error ? error.message : String(error),
        auth_user_id: newAuthUserId,
        email
      });
      
      // Reset to a known safe state - show auth screen again
      setIsAuthenticated(false);
      setAuthUserId(null);
      setAuthEmail(null);
      setIsEmailVerified(false);
      setAuthError('Something went wrong. Please try signing in again.');
      setShowAuthScreen(true); // Keep/show auth screen so user isn't stuck
    }
  };

  const startNewUserOnboarding = () => {
    setHasSeenIntroVideo(true);
    setIsNewUserFlow(true);
    setShowForgingIntro(false);
    setShowAuthScreen(false);
    setHasCompletedOnboarding(false);
    setNeedsSignupAfterOnboarding(false);

    requestPushTokenEarly().then(result => {
      glowLogger.info('Early push token result stored', {
        has_token: !!result.expoPushToken,
        permission_status: result.permissionStatus,
        device_type: result.deviceType
      });
      setEarlyPushTokenResult(result);
    }).catch(err => {
      glowLogger.warn('Early push token request failed', {
        error: err instanceof Error ? err.message : String(err)
      });
    });

    const config = require('../assets/onboarding_config');
    setOnboardingConfig(config);
  };

  // Handle intro video buttons
  const handleNewUser = async () => {
    glowLogger.info('New user flow started', {});
    setSpecialCodeFlow(null);
    startNewUserOnboarding();
  };

  const handleExistingUser = () => {
    glowLogger.info('Existing user flow started', {});
    setSpecialCodeFlow(null);
    setHasSeenIntroVideo(true);
    setIsNewUserFlow(false);
    setShowAuthScreen(true);
    setAuthError(null); // Clear any previous errors
  };

  const getCoachDisplayName = (coachId: number, coaches: Awaited<ReturnType<typeof getCoaches>>): string | null => {
    const coach = coaches.find((c) => c.id === coachId);
    if (!coach?.full_name) return null;
    const firstName = coach.full_name.trim().split(/\s+/)[0] ?? '';
    return getCanonicalCoachKey(firstName);
  };

  const handleSpecialCodeValidated = async (result: ValidatedSpecialCode) => {
    setShowSpecialCodeModal(false);

    if (result.codeType === 'event') {
      Alert.alert(t('specialCode:eventPlaceholderTitle'), t('specialCode:eventPlaceholderBody'));
      return;
    }

    if (result.codeType === 'promo') {
      Alert.alert(t('specialCode:promoPlaceholderTitle'), t('specialCode:promoPlaceholderBody'));
      return;
    }

    if (result.codeType === 'coach' && result.coachId != null) {
      const coaches = await getCoaches();
      const displayName = getCoachDisplayName(result.coachId, coaches);
      if (!displayName) {
        Alert.alert(t('common:error'), t('specialCode:invalid'));
        return;
      }

      glowLogger.info('Coach special code validated', {
        coach_id: String(result.coachId),
        display_name: displayName,
      });

      setSpecialCodeFlow({
        type: 'coach',
        coachId: result.coachId,
        coachDisplayName: displayName,
        code: result.code,
      });
      startNewUserOnboarding();
    }
  };

  // Handle email confirmation success
  const handleEmailConfirmed = async () => {
    glowLogger.info('Email confirmed, completing flow', { email: pendingSignupEmail });
    
    // Get the actual current user from local database - don't rely on React state
    // which might be stale if saveNewUserProfile didn't complete
    const currentUser = await getCurrentLoggedInUser();
    
    // Update React state with the actual user if needed
    if (currentUser && (!loggedInUser || (loggedInUser as any)?.id !== currentUser.id)) {
      glowLogger.info('Updating loggedInUser state from local database', {
        old_user_id: (loggedInUser as any)?.id || 'none',
        new_user_id: currentUser.id
      });
      setLoggedInUser(currentUser);
    }
    
    const userId = currentUser?.id;
    
    // Assign user to coach now that email is confirmed
    if (onboardingData?.coachId && userId) {
        glowLogger.info('Assigning user to coach after email confirmation', { 
          user_id: userId, 
          coach_id: onboardingData.coachId 
        });
      try {
        await assignUserToCoach(userId, onboardingData.coachId, onboardingData.selectedCoach);
      } catch (coachError) {
        // Coach assignment may fail if profile wasn't saved to Supabase yet
        // This is OK - we'll retry via SyncStatusBanner
        glowLogger.warn('Coach assignment failed - profile may not be in Supabase yet', {
          error: coachError instanceof Error ? coachError.message : String(coachError),
          user_id: userId
        });
      }
    }
    
    // Immediately transition to next screen - don't block on push token
    setShowEmailConfirmation(false);
    setIsAuthenticated(true);
    setIsEmailVerified(true);
    setHasCompletedOnboarding(true);

    // Push token recovery after email confirmation. The user has just been
    // bouncing between this app and the email client, which can cause the
    // earlier APNs request to silently never resolve. Retry with our standard
    // backoff so we still end up with a valid token in Supabase.
    if (userId) {
      ensurePushTokenForUserWithRecovery(userId, {
        source: 'email_confirmed',
      }).catch(err =>
        glowLogger.warn('Post-email-confirmation push token sync threw', {
          error: err instanceof Error ? err.message : String(err),
          user_id: userId,
        })
      );
      registerAppForegroundPushTokenRecovery(userId);
    }
  };

  // Handle back from email confirmation
  const handleEmailConfirmationBack = () => {
    setShowEmailConfirmation(false);
    setNeedsSignupAfterOnboarding(true);
  };

  // Handle completion (or cancellation) of the password recovery flow.
  // In both cases we kill the short-lived recovery session, reset in-memory
  // app state, and route the user back to the sign-in screen so the regular
  // auth flow runs cleanly (no partial state).
  const handleResetPasswordExit = async () => {
    glowLogger.info('Exiting password recovery flow, signing out recovery session', {});
    try {
      await signOut();
    } catch (err) {
      glowLogger.warn('Recovery signOut failed, continuing anyway', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    resetAppState();
    clearRecovery();
    setHasSeenIntroVideo(true);
    setIsNewUserFlow(false);
    setShowAuthScreen(true);
  };

  // Show onboarding modal if new user and hasn't completed onboarding
  const shouldShowOnboarding = !isLoading && !hasCompletedOnboarding && onboardingConfig && hasSeenIntroVideo && isNewUserFlow && !showForgingIntro && !needsSignupAfterOnboarding && !showEmailConfirmation;

  // Show forging intro (intermediate animated screen between landing and onboarding)
  const shouldShowForgingIntro = !isLoading && hasSeenIntroVideo && isNewUserFlow && showForgingIntro;

  // Show intro video screen first (only if not loading and haven't seen it)
  const shouldShowIntroVideo = !isLoading && !hasSeenIntroVideo;

  // Show signup screen for new users after onboarding/plan acceptance
  const shouldShowSignupForNewUser = !isLoading && hasSeenIntroVideo && isNewUserFlow && needsSignupAfterOnboarding && !showEmailConfirmation;

  // Show signin screen for existing users
  const shouldShowSigninForExistingUser = !isLoading && hasSeenIntroVideo && !isNewUserFlow && showAuthScreen && !isAuthenticated;

  const handleLanguageSelected = async (language: SupportedLanguage) => {
    await changeLanguage(language);
    setHasSelectedLanguage(true);
  };

  const handleRetryProfileLoad = async () => {
    if (!loggedInUser || isReloadingProfile) return;
    setIsReloadingProfile(true);
    try {
      const loaded = await loadProfileForLoggedInUser(loggedInUser, { awaitRemote: true });
      if (!loaded) {
        Alert.alert(
          t('root:profileCacheMissingTitle'),
          t('root:connectionIssueBody'),
        );
      }
    } finally {
      setIsReloadingProfile(false);
    }
  };

  const shouldShowProfileRecovery =
    !isLoading &&
    isAuthenticated &&
    isEmailVerified &&
    !!loggedInUser &&
    !onboardingData;

  const shouldShowLanguageSelection =
    !isLoading &&
    languageSelectionChecked &&
    !hasSelectedLanguage &&
    !hasSeenIntroVideo &&
    !showEmailConfirmation &&
    !needsSignupAfterOnboarding;

  // Password recovery deep link takes priority over every other screen.
  // The user tapped a reset-password email link and we must let them set a new
  // password before routing them anywhere else (main app, language picker, etc.).
  if (recoveryActive) {
    return (
      <ResetPasswordScreen
        linkError={recoveryError}
        onDone={handleResetPasswordExit}
        onCancel={handleResetPasswordExit}
      />
    );
  }

  if (shouldShowLanguageSelection) {
    return <LanguageSelectionScreen onSelectLanguage={handleLanguageSelected} />;
  }

  // Account deactivated - show blocking screen (no logout option to prevent signing in again)
  if (accountStatus === 'deactivated' && isAuthenticated) {
    return <AccountDeactivatedScreen />;
  }

  // Main app - only show if authenticated AND email verified AND has completed onboarding
  if (hasCompletedOnboarding && onboardingData && isAuthenticated && isEmailVerified) {
    return (
      <MainAppContainer
        onboardingData={onboardingData}
        onLogout={handleLogout}
        onDeleteAccount={handleDeleteAccount}
        pendingNotificationMessage={pendingNotificationMessage}
        onNotificationMessageProcessed={() => setPendingNotificationMessage(null)}
        shouldGenerateWelcome={shouldGenerateWelcome}
        onWelcomeGenerated={() => setShouldGenerateWelcome(false)}
      />
    );
  }

  // Show email confirmation screen
  if (showEmailConfirmation && pendingSignupEmail && pendingSignupPassword) {
    return (
      <EmailConfirmationScreen
        email={pendingSignupEmail}
        password={pendingSignupPassword}
        onEmailConfirmed={handleEmailConfirmed}
        onBack={handleEmailConfirmationBack}
      />
    );
  }

  // Show signup screen for new users (after onboarding)
  if (shouldShowSignupForNewUser) {
    return (
      <AuthScreen
        onAuthSuccess={handleAuthSuccess}
        mode="signup"
        isNewUserFlow={true}
      />
    );
  }

  // Show signin screen for existing users
  if (shouldShowSigninForExistingUser) {
    return (
      <AuthScreen
        onAuthSuccess={handleAuthSuccess}
        mode="signin"
        onBack={() => {
          setShowAuthScreen(false);
          setHasSeenIntroVideo(false);
          setAuthError(null);
        }}
        onCreateAccount={handleNewUser}
        initialError={authError}
      />
    );
  }

  // Show intro video screen first
  if (shouldShowIntroVideo) {
    return (
      <>
        <IntroVideoScreen
          onNewUser={handleNewUser}
          onExistingUser={handleExistingUser}
          onHaveCode={() => setShowSpecialCodeModal(true)}
        />
        <SpecialCodeEntryModal
          visible={showSpecialCodeModal}
          onClose={() => setShowSpecialCodeModal(false)}
          onValidated={handleSpecialCodeValidated}
        />
      </>
    );
  }

  // Show forging intro (animated word-by-word reveal) before onboarding
  if (shouldShowForgingIntro) {
    return (
      <ForgingIntroScreen
        onComplete={() => setShowForgingIntro(false)}
      />
    );
  }

  // Show onboarding modal for new users
  if (shouldShowOnboarding) {
    return (
      <OnboardingModalV2
        visible={true}
        onComplete={handleOnboardingComplete}
        specialCodeFlow={specialCodeFlow}
        onBack={() => {
          setHasSeenIntroVideo(false);
          setIsNewUserFlow(false);
          setShowForgingIntro(false);
          setHasCompletedOnboarding(false);
          setSpecialCodeFlow(null);
        }}
      />
    );
  }

  if (shouldShowProfileRecovery) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>UnderForge</Text>
        <Text style={styles.profileRecoveryTitle}>{t('root:profileCacheMissingTitle')}</Text>
        <Text style={styles.profileRecoveryBody}>{t('root:profileCacheMissingBody')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={handleRetryProfileLoad}
          disabled={isReloadingProfile}
          style={({ pressed }) => [
            styles.profileRecoveryPrimaryButton,
            (pressed || isReloadingProfile) && styles.profileRecoveryButtonPressed,
          ]}
        >
          <Text style={styles.profileRecoveryPrimaryLabel}>
            {isReloadingProfile ? t('root:loadingApp') : t('root:profileCacheMissingRetry')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.profileRecoverySecondaryButton,
            pressed && styles.profileRecoveryButtonPressed,
          ]}
        >
          <Text style={styles.profileRecoverySecondaryLabel}>{t('root:profileCacheMissingSignOut')}</Text>
        </Pressable>
      </View>
    );
  }

  // Show loading state
  return (
    <View style={styles.container}>
      <Text style={styles.title}>UnderForge</Text>
      <Text style={styles.loadingText}>{t('root:loadingApp')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B1114',
    padding: 24,
  },
  title: {
    fontFamily: FontFamily.displayBold,
    fontSize: 52,
    marginBottom: 24,
    color: '#F47C3C',
  },
  loadingText: {
    fontSize: 16,
    color: '#9AA3A6',
  },
  profileRecoveryTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F5F5F5',
    textAlign: 'center',
    marginBottom: 12,
  },
  profileRecoveryBody: {
    fontSize: 16,
    color: '#9AA3A6',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  profileRecoveryPrimaryButton: {
    minHeight: 48,
    minWidth: 200,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F47C3C',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  profileRecoverySecondaryButton: {
    minHeight: 44,
    minWidth: 200,
    paddingHorizontal: 24,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileRecoveryButtonPressed: {
    opacity: 0.85,
  },
  profileRecoveryPrimaryLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#0B1114',
  },
  profileRecoverySecondaryLabel: {
    fontSize: 16,
    color: '#F47C3C',
  },
});

export default function AppRoot() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        await initI18n();
      } finally {
        setI18nReady(true);
      }
    };

    init();
  }, []);

  if (!i18nReady) {
    return null;
  }

  return (
    <I18nextProvider i18n={i18n}>
      <AppContent />
    </I18nextProvider>
  );
}