import * as Notifications from 'expo-notifications';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Clipboard,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { getActiveLoggedInUser, setUserSeenIntroTutorial } from '../lib/db';
import { getPushTokenWithStatus, PushTokenResult } from '../lib/expo-notification-helper';
import { glowLogger } from '../lib/glow-logger';
import { UserProfile } from '../types/user_profile';
import { CoachDashboardRecentActivity } from './CoachDashboardRecentActivity';
import { DeveloperRegenerateHypothesis } from './DeveloperRegenerateHypothesis';
import { DeveloperRegeneratePlan } from './DeveloperRegeneratePlan';
import { appIcons } from '../assets/icons';
import { UserListScreen } from './UserListScreen';

interface DeveloperCoachingDashboardProps {
  onBack: () => void;
  currentUserProfile?: UserProfile | null;
  skipAuth?: boolean;
  /** From main app: opens weekly check-in preview (simulated last-Sunday reference date). */
  onDebugCreateWeeklyReport?: () => void;
}

// New enum for target screen rendering
export enum RenderScreen {
  chat_screen = 'chat_screen',
  checkin_daily = 'checkin_daily',
  checkin_weekly = 'checkin_weekly',
  quick_log = 'quick_log',
}

export const DeveloperCoachingDashboard: React.FC<DeveloperCoachingDashboardProps> = ({
  onBack,
  currentUserProfile,
  skipAuth = false,
  onDebugCreateWeeklyReport,
}) => {
  const [showUserList, setShowUserList] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(skipAuth);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState('');
  const [showRecentActivity, setShowRecentActivity] = useState(false);
  const [showRegenerateHypothesis, setShowRegenerateHypothesis] = useState(false);
  const [showRegeneratePlan, setShowRegeneratePlan] = useState(false);
  const [pushTokenResult, setPushTokenResult] = useState<PushTokenResult | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState(false);

  useEffect(() => {
    // If already authenticated (e.g. parent already verified password), skip auth flow
    if (skipAuth || isAuthenticated) {
      setIsAuthenticated(true);
      setShowPasswordPrompt(false);
      loadPushTokenWithStatus();
      return;
    }

    // If no profile (not logged in / not onboarded), still allow password-based access
    if (!currentUserProfile) {
      glowLogger.info('[DeveloperCoachingDashboard] No currentUserProfile; enabling password-only access');
      if (!isAuthenticated) {
        setShowPasswordPrompt(true); // ensure prompt shows instead of blank screen
      }
      return;
    }

    glowLogger.info('[DeveloperCoachingDashboard] useEffect triggered', {
      is_coach: currentUserProfile?.is_coach,
      currentUserProfile: JSON.stringify(currentUserProfile)
    });

    if (currentUserProfile.is_coach) {
      glowLogger.info('[DeveloperCoachingDashboard] User is coach, bypassing password');
      setIsAuthenticated(true);
      setShowPasswordPrompt(false);
      loadPushTokenWithStatus();
    } else {
      glowLogger.info('[DeveloperCoachingDashboard] User not coach, requiring password');
      if (!isAuthenticated) setShowPasswordPrompt(true);
    }
  }, [currentUserProfile, isAuthenticated]);

  const handlePasswordSubmit = () => {
    if (password === '!joRema') {
      setIsAuthenticated(true);
      setShowPasswordPrompt(false);
      setPassword('');
      loadPushTokenWithStatus();
    } else {
      Alert.alert('Access Denied', 'Incorrect password. Please try again.');
      setPassword('');
    }
  };

  const handlePasswordCancel = () => {
    setPassword('');
    onBack();
  };

  const handleShowRegenerateHypothesis = () => {
    setShowRegenerateHypothesis(true);
  };

  const handleCloseRegenerateHypothesis = () => {
    setShowRegenerateHypothesis(false);
  };

  const handleShowRegeneratePlan = () => {
    setShowRegeneratePlan(true);
  };

  const handleCloseRegeneratePlan = () => {
    setShowRegeneratePlan(false);
  };

  const handleHypothesisRegenerated = () => {
    setShowRegenerateHypothesis(false);
  };

  const handlePlanRegenerated = () => {
    setShowRegeneratePlan(false);
  };

  const handleDebugCreateWeeklyReport = () => {
    if (!onDebugCreateWeeklyReport) {
      Alert.alert(
        'Weekly check-in',
        'Open Developer from the main app menu (not onboarding) to preview the weekly check-in.',
      );
      return;
    }
    onDebugCreateWeeklyReport();
  };

  const loadPushTokenWithStatus = async () => {
    setIsLoadingToken(true);
    try {
      const activeUser = await getActiveLoggedInUser();
      if (!activeUser) {
        glowLogger.info('No active user found for push token check', {});
        setPushTokenResult(null);
        return;
      }

      const result = await getPushTokenWithStatus(activeUser.id);
      setPushTokenResult(result || null);

      if (result?.expoPushToken) {
        glowLogger.info('Push token retrieved successfully', {
          token: result.expoPushToken.substring(0, 20) + '...',
          permissionStatus: result.permissionStatus,
          deviceType: result.deviceType
        });
      } else {
        glowLogger.info('No push token available', {
          permissionStatus: result?.permissionStatus,
          deviceType: result?.deviceType
        });
      }
    } catch (error) {
      glowLogger.error('Failed to load push token with status', {
        error: error instanceof Error ? error.message : String(error)
      });
      setPushTokenResult(null);
    } finally {
      setIsLoadingToken(false);
    }
  };

  const sendTestNotification = async (
    sender?: string,
    render_screen: RenderScreen = RenderScreen.checkin_daily,
    delaySeconds: number = 5
  ) => {
    try {
      glowLogger.info('Preparing test notification with delay', { sender, render_screen, delaySeconds });
      if (delaySeconds > 0) {
        await new Promise(res => setTimeout(res, delaySeconds * 1000));
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Test Coach Message',
          body: 'Hi, Joshua here, just checking in.  How are you feeling today?',
          sound: 'default',
          data: {
            ...(sender ? { sender } : {}),
            render_screen,
          },
        },
        // Use immediate trigger after manual delay to ensure reliability
        trigger: null,
      });
      glowLogger.info('Test notification scheduled (after delay)', { sender, render_screen, delaySeconds });
    } catch (error) {
      glowLogger.error('Failed to schedule test notification', {
        error: error instanceof Error ? error.message : String(error),
        render_screen,
        delaySeconds,
      });
    }
  };

  // Ask user which screen to render; default is daily
  const handleTestNotificationPress = (sender: string) => {
    Alert.alert(
      'Choose target screen',
      'Select which screen should open when the notification is tapped.',
      [
        {
          text: 'Daily Check-in (default)',
          onPress: () => sendTestNotification(sender, RenderScreen.checkin_daily),
        },
        {
          text: 'Chat Screen',
          onPress: () => sendTestNotification(sender, RenderScreen.chat_screen),
        },
        {
          text: 'Weekly Check-in',
          onPress: () => sendTestNotification(sender, RenderScreen.checkin_weekly),
        },
        {
          text: 'Quick Log (forge notif)',
          onPress: () => sendTestNotification(sender, RenderScreen.quick_log),
        },
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => sendTestNotification(sender, RenderScreen.checkin_daily), // fallback to default
        },
      ]
    );
  };

  if (showPasswordPrompt) {
    return (
      <View style={styles.passwordContainer}>
        <View style={styles.passwordModal}>
          <Text style={styles.passwordTitle}>Coach Access Required</Text>
          <Text style={styles.passwordSubtitle}>Enter password to access coaching dashboard</Text>
          
          <TextInput
            style={styles.passwordInput}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
            onSubmitEditing={handlePasswordSubmit}
          />
          
          <View style={styles.passwordButtons}>
            <TouchableOpacity 
              style={[styles.passwordButton, styles.cancelButton]} 
              onPress={handlePasswordCancel}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.passwordButton, styles.submitButton]} 
              onPress={handlePasswordSubmit}
            >
              <Text style={styles.submitButtonText}>Submit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (showUserList) {
    return <UserListScreen onBack={() => setShowUserList(false)} />;
  }

  if (showRecentActivity) {
    return <CoachDashboardRecentActivity onBack={() => setShowRecentActivity(false)} />;
  }

  if (showRegenerateHypothesis) {
    return <DeveloperRegenerateHypothesis
      onBack={handleCloseRegenerateHypothesis}
      onHypothesisRegenerated={handleHypothesisRegenerated}
    />;
  }

  if (showRegeneratePlan) {
    return <DeveloperRegeneratePlan
      onBack={handleCloseRegeneratePlan}
      onPlanRegenerated={handlePlanRegenerated}
    />;
  }

  return (
    <>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Coaching Dashboard</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        
        <TouchableOpacity 
          style={styles.showUsersButton} 
          onPress={() => setShowUserList(true)}
        >
          <Image source={appIcons.people} style={styles.buttonIconImage} />
          <Text style={styles.showUsersButtonText}>Show Users</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.showUsersButton}
          onPress={() => setShowRecentActivity(true)}
        >
          <Image source={appIcons.clock} style={styles.buttonIconImage} />
          <Text style={styles.showUsersButtonText}>Show Recent Activity</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.showUsersButton}
          onPress={handleShowRegenerateHypothesis}
        >
          <Image source={appIcons.lightbulb} style={styles.buttonIconImage} />
          <Text style={styles.showUsersButtonText}>Regenerate Hypothesis</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.showUsersButton}
          onPress={handleShowRegeneratePlan}
        >
          <Image source={appIcons.refresh} style={styles.buttonIconImage} />
          <Text style={styles.showUsersButtonText}>Regenerate Plan</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.showUsersButton}
          onPress={handleDebugCreateWeeklyReport}
        >
          <Image source={appIcons.bar_chart} style={styles.buttonIconImage} />
          <Text style={styles.showUsersButtonText}>Create check-in</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        {/* Push Notifications Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Push Notifications</Text>
          <Text style={styles.sectionDescription}>
            View your Expo push token and manage notifications.
          </Text>

          {isLoadingToken ? (
            <View style={styles.tokenContainer}>
              <Text style={styles.tokenLabel}>Loading push token...</Text>
            </View>
          ) : pushTokenResult?.expoPushToken ? (
            <View style={styles.tokenContainer}>
              <Text style={styles.tokenLabel}>Expo Push Token:</Text>
              <TouchableOpacity
                onPress={() => {
                  Clipboard.setString(pushTokenResult.expoPushToken!);
                  Alert.alert('Copied', 'Push token copied to clipboard!');
                }}
              >
                <Text style={styles.tokenText}>{pushTokenResult.expoPushToken}</Text>
              </TouchableOpacity>
              <View style={styles.tokenStatus}>
                <Text style={styles.tokenStatusLabel}>Permission: {pushTokenResult.permissionStatus}</Text>
                <Text style={styles.tokenStatusLabel}>Device: {pushTokenResult.deviceType}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.tokenErrorContainer}>
              <Text style={styles.tokenError}>No push token available</Text>
              {pushTokenResult && (
                <View style={styles.tokenStatus}>
                  <Text style={styles.tokenStatusLabel}>Permission: {pushTokenResult.permissionStatus}</Text>
                  <Text style={styles.tokenStatusLabel}>Device: {pushTokenResult.deviceType}</Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.reloadButton}
                onPress={loadPushTokenWithStatus}
              >
                <View style={styles.reloadButtonContainer}>
                  <Image source={appIcons.refresh} style={styles.reloadButtonIcon} />
                  <Text style={styles.reloadButtonText}>Reload</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            onPress={() => {
              Linking.openURL('https://expo.dev/notifications');
            }}
            style={styles.centeredLinkContainer}
          >
            <Text style={styles.linkText}>Go to Expo Notifications</Text>
          </TouchableOpacity>
        </View>

        {/* Test Push Notifications Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Test Push Notifications</Text>
          <Text style={styles.sectionDescription}>
            Send notification to this device (5s delay).
          </Text>

          <TouchableOpacity
            style={styles.testButton}
            onPress={() => handleTestNotificationPress('ai_coach')}
          >
            <View style={styles.testButtonContainer}>
              <Image source={appIcons.robot} style={styles.testButtonIcon} />
              <Text style={styles.testButtonText}>Send Test Notification (AI Coach)</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.testButton}
            onPress={() => handleTestNotificationPress('human_coach')}
          >
            <View style={styles.testButtonContainer}>
              <Image source={appIcons.doctor} style={styles.testButtonIcon} />
              <Text style={styles.testButtonText}>Send Test Notification (Human Coach)</Text>
            </View>
          </TouchableOpacity>

          {/* Optionally, to target other screens you could call, e.g.:
            sendTestNotification('ai_coach', RenderScreen.chat_screen)
            sendTestNotification('ai_coach', RenderScreen.checkin_weekly)
          */}
        </View>

        {/* Local Database Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Local Database</Text>
          <Text style={styles.sectionDescription}>
            Manage local database settings and user preferences.
          </Text>

          <TouchableOpacity
            style={styles.testButton}
            onPress={async () => {
              try {
                const activeUser = await getActiveLoggedInUser();
                if (activeUser) {
                  await setUserSeenIntroTutorial(activeUser.id, false);
                  Alert.alert('Success', 'Intro tutorial has been reset. Restart app and you will see it on chat screen.');
                } else {
                  Alert.alert('Error', 'No active user found');
                }
              } catch (error) {
                console.error('Failed to reset intro tutorial:', error);
                Alert.alert('Error', 'Failed to reset intro tutorial');
              }
            }}
          >
            <View style={styles.testButtonContainer}>
              <Image source={appIcons.refresh} style={styles.testButtonIcon} />
              <Text style={styles.testButtonText}>Reset Intro Tutorial</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#0E1A1A',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backButtonText: {
    fontSize: 17,
    color: '#F47C3C',
    fontWeight: '400',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  headerRight: {
    width: 60,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    backgroundColor: '#F2F2F7',
  },
  emptyState: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    marginTop: 32,
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 15,
    color: '#9AA3A6',
    textAlign: 'center',
    lineHeight: 20,
  },
  showUsersButton: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  showUsersButtonText: {
    fontSize: 17,
    fontWeight: '400',
    color: '#F2F2EE',
  },
  buttonIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  buttonIconImage: {
    width: 20,
    height: 20,
    marginRight: 12,
  },
  chevron: {
    fontSize: 17,
    color: '#C6C6C8',
    fontWeight: '400',
  },
  passwordContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  passwordModal: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 300,
  },
  passwordTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 8,
  },
  passwordSubtitle: {
    fontSize: 14,
    color: '#9AA3A6',
    textAlign: 'center',
    marginBottom: 20,
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: '#C6C6C8',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  passwordButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  passwordButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#F2F2F7',
  },
  submitButton: {
    backgroundColor: '#F47C3C',
  },
  cancelButtonText: {
    fontSize: 16,
    color: '#F2F2EE',
    fontWeight: '500',
  },
  submitButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
  },
  section: {
    backgroundColor: '#0E1A1A',
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 16,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 15,
    color: '#9AA3A6',
    marginBottom: 20,
    lineHeight: 20,
  },
  tokenContainer: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  tokenLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  tokenText: {
    fontSize: 14,
    color: '#F47C3C',
    fontFamily: 'monospace',
  },
  tokenError: {
    fontSize: 14,
    color: '#C65B5B',
  },
  tokenStatus: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5E7',
  },
  tokenStatusLabel: {
    fontSize: 12,
    color: '#9AA3A6',
    marginBottom: 4,
  },
  tokenErrorContainer: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  reloadButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  reloadButtonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reloadButtonIcon: {
    width: 16,
    height: 16,
    marginRight: 8,
  },
  reloadButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  centeredLinkContainer: {
    paddingVertical: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  linkText: {
    color: '#F47C3C',
    fontSize: 16,
    textDecorationLine: 'underline',
  },
  testButton: {
    backgroundColor: '#0E1A1A',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 12,
    alignItems: 'center',
  },
  testButtonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  testButtonIcon: {
    width: 16,
    height: 16,
    marginRight: 8,
  },
  testButtonText: {
    fontSize: 16,
    color: '#1976D2',
    fontWeight: '600',
  },
});