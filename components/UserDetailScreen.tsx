import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Clipboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { restoreUserProfile } from '../lib/db';
import { getPushTokenWithStatus } from '../lib/expo-notification-helper';
import { glowLogger } from '../lib/glow-logger';
import {
  buildActionPlanPrompts,
  buildHypothesisPrompts,
  regenerateActionPlan,
  regenerateHypothesis,
  RegenerationCallbacks
} from '../lib/regeneration-utils';
import { onboardingEvents } from '../lib/supabase_db';
import { saveUserProfile, setOtherUserProfilesInactive, updateUserProfile, updateUserProfileExpoPushToken } from '../lib/supabase_db_new';
import { DeviceType, UserProfile } from '../types/user_profile';
import { ChatMessagesScreen } from './ChatMessagesScreen';
import { DeveloperCoachEditPlan } from './DeveloperCoachEditPlan';
import { SendMessageScreen } from './SendMessageScreen';

interface UserDetailScreenProps {
  userProfile: UserProfile;
  onBack: () => void;
}

export const UserDetailScreen: React.FC<UserDetailScreenProps> = ({
  userProfile,
  onBack
}) => {
  const [showSendMessage, setShowSendMessage] = useState(false);
  const [showOnboardData, setShowOnboardData] = useState(false);
  const [showEditPlan, setShowEditPlan] = useState(false);
  const [showChatMessages, setShowChatMessages] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile>(userProfile);
  const [isRegeneratingHypothesis, setIsRegeneratingHypothesis] = useState(false);
  const [isRegeneratingPlan, setIsRegeneratingPlan] = useState(false);
  const [isDuplicatingUser, setIsDuplicatingUser] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  useEffect(() => {
    setCurrentUserProfile(userProfile);
  }, [userProfile]);

  useEffect(() => {
    // Listen for onboarding data changes to refresh current user profile
    const handleOnboardingDataChanged = (data: any) => {
      if (data.userId === currentUserProfile.user_id) {
        // Refresh the current user profile with updated onboarding data
        setCurrentUserProfile(prevProfile => ({
          ...prevProfile,
          onboardingProfile: data.onboardingProfile
        }));
      }
    };

    onboardingEvents.on('onboardingDataChanged', handleOnboardingDataChanged);

    return () => {
      onboardingEvents.off('onboardingDataChanged', handleOnboardingDataChanged);
    };
  }, [currentUserProfile.user_id]);

  const handleSendMessage = () => {
    setShowSendMessage(true);
  };

  const handleShowOnboardData = () => {
    setShowOnboardData(true);
  };

  const handleEditOnboardData = () => {
    setShowEditPlan(true);
  };

  const handleShowChatMessages = () => {
    setShowChatMessages(true);
  };

  const handleOnboardingDataUpdated = (updatedData: any) => {
    // Update the current user profile with new onboarding data
    setCurrentUserProfile(prevProfile => ({
      ...prevProfile,
      onboardingProfile: updatedData
    }));
    console.log('Onboarding data updated:', updatedData);
  };

  const createRegenerationCallbacks = (
    setLoading: (loading: boolean) => void
  ): RegenerationCallbacks => ({
    onLoadingStart: (message: string) => {
      setLoading(true);
    },
    onLoadingEnd: () => {
      setLoading(false);
    },
    onError: (title: string, message: string) => {
      Alert.alert(title, message);
    },
    onSuccess: (result: any) => {
      // Update the current user profile with new data
      if (result.updatedOnboardingData) {
        setCurrentUserProfile(prevProfile => ({
          ...prevProfile,
          onboardingProfile: result.updatedOnboardingData
        }));
      }
    }
  });

  const handleRegenerateHypothesis = async () => {
    if (!currentUserProfile.onboardingProfile) {
      Alert.alert('Error', 'No onboarding data available to regenerate hypothesis.');
      return;
    }

    const { systemPrompt, userPrompt } = buildHypothesisPrompts(currentUserProfile.onboardingProfile);
    const callbacks = createRegenerationCallbacks(setIsRegeneratingHypothesis);
    
    const result = await regenerateHypothesis(
      currentUserProfile,
      systemPrompt,
      userPrompt,
      callbacks
    );

    if (result) {
      Alert.alert(
        'Hypothesis Regenerated',
        `The hypothesis for ${currentUserProfile.display_name} has been successfully regenerated!`,
        [{ text: 'OK' }]
      );
    }
  };

  const handleRegenerateActionPlan = async () => {
    if (!currentUserProfile.onboardingProfile) {
      Alert.alert('Error', 'No onboarding data available to regenerate action plan.');
      return;
    }

    const { systemPrompt, userPrompt } = buildActionPlanPrompts(currentUserProfile.onboardingProfile);
    const callbacks = createRegenerationCallbacks(setIsRegeneratingPlan);
    
    const result = await regenerateActionPlan(
      currentUserProfile,
      systemPrompt,
      userPrompt,
      callbacks
    );

    if (result) {
      Alert.alert(
        'Action Plan Regenerated',
        `The action plan for ${currentUserProfile.display_name} has been successfully regenerated!`,
        [{ text: 'OK' }]
      );
    }
  };

  const handleRestoreProfile = async () => {
    // Check device type compatibility
    const currentDeviceType = Device.isDevice 
      ? (Platform.OS === 'ios' ? DeviceType.IOS_DEVICE : DeviceType.ANDROID_DEVICE)
      : (Platform.OS === 'ios' ? DeviceType.IOS_SIMULATOR : DeviceType.ANDROID_EMULATOR);

    const profileDeviceType = userProfile.device_type;

    // Allow device profiles to be restored on simulators/emulators, but not simulator/emulator profiles on devices
    const isIncompatible = (
      (currentDeviceType === DeviceType.IOS_DEVICE && profileDeviceType === DeviceType.IOS_SIMULATOR) ||
      (currentDeviceType === DeviceType.ANDROID_DEVICE && profileDeviceType === DeviceType.ANDROID_EMULATOR)
    );
    
    if (isIncompatible) {
      Alert.alert(
        'Device Type Mismatch',
        `This profile was created on a simulator/emulator, but you're currently on a physical device. Simulator/emulator profiles cannot be restored on physical devices due to push token limitations.`,
        [{ text: 'OK' }]
      );
      return;
    }

    Alert.alert(
      'Restore Profile',
      `Are you sure you want to restore ${userProfile.display_name || 'this user'}'s profile? This will replace your current local user data.`,
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            try {
              glowLogger.info('Starting profile restoration', {
                target_user_id: userProfile.user_id,
                target_display_name: userProfile.display_name,
                target_device_type: userProfile.device_type,
                current_device_type: currentDeviceType
              });

              // Restore the user profile to local database
              await restoreUserProfile(userProfile.user_id, userProfile.display_name || 'Restored User');

              // Update the remote profile to be active and handle push token conflicts
              if (userProfile.expoPushToken) {
                // First deactivate other profiles with the same push token
                await setOtherUserProfilesInactive(userProfile.expoPushToken);
              }

              // Set this profile as active in Supabase
              await updateUserProfile({
                user_id: userProfile.user_id,
                active: true
              });
              
              // Update push token for the current device
              const pushTokenResult = await getPushTokenWithStatus(userProfile.user_id);
              if (pushTokenResult && 
                  (pushTokenResult.deviceType === DeviceType.IOS_DEVICE || pushTokenResult.deviceType === DeviceType.ANDROID_DEVICE) &&
                  pushTokenResult.expoPushToken) {
                try {
                  await updateUserProfileExpoPushToken(userProfile.user_id, pushTokenResult);
                  glowLogger.info('Updated push token for restored profile (Developer Dashboard)', {
                    user_id: userProfile.user_id,
                    new_token_preview: pushTokenResult.expoPushToken.substring(0, 30) + '...'
                  });
                } catch (tokenError) {
                  glowLogger.warn('Failed to update push token for restored profile', {
                    user_id: userProfile.user_id,
                    error: tokenError instanceof Error ? tokenError.message : String(tokenError)
                  });
                }
              }
              
              glowLogger.info('Profile restoration completed', {
                restored_user_id: userProfile.user_id,
                restored_display_name: userProfile.display_name
              });

              // Emit the onboardingDataChanged event to notify other components
              onboardingEvents.emit('onboardingDataChanged', {
                userId: userProfile.user_id,
                displayName: userProfile.display_name,
                onboardingProfile: userProfile.onboardingProfile,
                action: 'profile_restored'
              });

              // Show success alert with restart instruction
              Alert.alert(
                'Profile Restored',
                `${userProfile.display_name || 'User'}'s profile has been restored successfully. Please restart the app to complete the restoration process.`,
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      // Go back to previous screen
                      onBack();
                    }
                  }
                ]
              );
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              glowLogger.error('Failed to restore profile', {
                error: errorMessage,
                target_user_id: userProfile.user_id,
                target_display_name: userProfile.display_name
              });

              Alert.alert(
                'Restore Failed',
                `Failed to restore profile: ${errorMessage}`,
                [{ text: 'OK' }]
              );
            }
          }
        }
      ]
    );
  };

  const handleDuplicateUser = async () => {
    Alert.alert(
      'Duplicate User',
      `Are you sure you want to create a duplicate of ${currentUserProfile.display_name || 'this user'}?`,
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Duplicate',
          onPress: async () => {
            setIsDuplicatingUser(true);
            try {
              // Generate a new UUID for the duplicated user
              const newUserId = Crypto.randomUUID();
              const newDisplayName = `${currentUserProfile.display_name || 'User'} (copy)`;
              
              // Create new user profile with copied data but new ID and name
              const duplicatedProfile: UserProfile = {
                ...currentUserProfile,
                user_id: newUserId,
                display_name: newDisplayName,
                expoPushToken: undefined, // Don't copy push token
                device_type: DeviceType.IOS_SIMULATOR, // Set as simulator user
                active: false, // Don't make it active
                created_at: new Date().toISOString(),
                // Explicitly ensure AI-generated JSON is copied
                onboarding_profile_ai_gen_json: currentUserProfile.onboarding_profile_ai_gen_json
              };
              
              glowLogger.info('Duplicating user profile', {
                original_user_id: currentUserProfile.user_id,
                original_display_name: currentUserProfile.display_name,
                new_user_id: newUserId,
                new_display_name: newDisplayName
              });
              
              // Save the duplicated profile to Supabase with AI-generated copy
              await saveUserProfile(duplicatedProfile, true);
              
              glowLogger.info('User profile duplicated successfully', {
                new_user_id: newUserId,
                new_display_name: newDisplayName
              });
              
              // Show success alert
              Alert.alert(
                'User Duplicated',
                `New user created:\nName: ${newDisplayName}\nID: ${newUserId}`,
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      // Go back to the user list
                      onBack();
                    }
                  }
                ]
              );
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              glowLogger.error('Failed to duplicate user profile', {
                error: errorMessage,
                original_user_id: currentUserProfile.user_id
              });
              
              Alert.alert(
                'Duplication Failed',
                `Failed to duplicate user: ${errorMessage}`,
                [{ text: 'OK' }]
              );
            } finally {
              setIsDuplicatingUser(false);
            }
          }
        }
      ]
    );
  };

  const ellideMiddle = (val?: string) => {
    if (!val) return '';
    if (val.length <= 14) return val;
    return `${val.slice(0,4)}...${val.slice(-6)}`;
  };

  const handleCopy = (value?: string, label?: string) => {
    if (!value) return;
    Clipboard.setString(value);
    setCopiedLabel(label ? `${label} copied` : 'Copied');
    setTimeout(() => setCopiedLabel(null), 1600);
  };

  if (showSendMessage) {
    return (
      <SendMessageScreen
        userProfile={userProfile}
        onBack={() => setShowSendMessage(false)}
      />
    );
  }

  if (showChatMessages) {
    return (
      <ChatMessagesScreen
        userProfile={userProfile}
        onBack={() => setShowChatMessages(false)}
      />
    );
  }

  return (
    <>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>User: {currentUserProfile.display_name || 'No Name'}</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.userCard}>
          <Text style={styles.userNameLarge}>{currentUserProfile.display_name || 'No Name'}</Text>

          <TouchableOpacity onPress={() => handleCopy(currentUserProfile.user_id, 'User ID')}>
            <Text style={styles.userIdText}>ID: {ellideMiddle(currentUserProfile.user_id)}</Text>
          </TouchableOpacity>

          {currentUserProfile.expoPushToken && (
            <TouchableOpacity onPress={() => handleCopy(currentUserProfile.expoPushToken, 'Push Token')}>
              <Text style={styles.expoTokenText}>Push: {ellideMiddle(currentUserProfile.expoPushToken)}</Text>
            </TouchableOpacity>
          )}

          {copiedLabel && <Text style={styles.copiedFeedback}>{copiedLabel}</Text>}

          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: currentUserProfile.active ? '#4FAE8A' : '#8E8E93' }]} />
            <Text style={styles.statusText}>{currentUserProfile.active ? 'Active' : 'Inactive'}</Text>
          </View>
          <Text style={styles.deviceType}>{currentUserProfile.device_type}</Text>
          {currentUserProfile.created_at && (
            <Text style={styles.createdDate}>
              Created: {new Date(currentUserProfile.created_at).toLocaleDateString()}
            </Text>
          )}
        </View>

        <View style={styles.actionsSection}>
          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={handleSendMessage}
          >
            <Text style={styles.actionButtonText}>💬 Send a message</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={handleShowOnboardData}
          >
            <Text style={styles.actionButtonText}>📋 Show Onboard Data</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={handleEditOnboardData}
          >
            <Text style={styles.actionButtonText}>✏️ Edit Onboard Data</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={handleShowChatMessages}
          >
            <Text style={styles.actionButtonText}>💭 Show Chat Messages</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[
              styles.actionButton,
              (isRegeneratingHypothesis || !currentUserProfile.onboardingProfile) && styles.disabledButton
            ]}
            onPress={handleRegenerateHypothesis}
            disabled={isRegeneratingHypothesis || !currentUserProfile.onboardingProfile}
          >
            <Text style={[
              styles.actionButtonText,
              (isRegeneratingHypothesis || !currentUserProfile.onboardingProfile) && styles.disabledText
            ]}>
              🧠 {isRegeneratingHypothesis ? 'Regenerating Hypothesis...' : 'Regenerate Hypothesis'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[
              styles.actionButton,
              (isRegeneratingPlan || !currentUserProfile.onboardingProfile) && styles.disabledButton
            ]}
            onPress={handleRegenerateActionPlan}
            disabled={isRegeneratingPlan || !currentUserProfile.onboardingProfile}
          >
            <Text style={[
              styles.actionButtonText,
              (isRegeneratingPlan || !currentUserProfile.onboardingProfile) && styles.disabledText
            ]}>
              📋 {isRegeneratingPlan ? 'Regenerating Plan...' : 'Regenerate Action Plan'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={handleRestoreProfile}
          >
            <Text style={styles.actionButtonText}>🔄 Restore from profile</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[
              styles.actionButton,
              isDuplicatingUser && styles.disabledButton
            ]}
            onPress={handleDuplicateUser}
            disabled={isDuplicatingUser}
          >
            <Text style={[
              styles.actionButtonText,
              isDuplicatingUser && styles.disabledText
            ]}>
              👥 {isDuplicatingUser ? 'Duplicating User...' : 'Duplicate User'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <DeveloperCoachEditPlan
        visible={showOnboardData}
        onClose={() => setShowOnboardData(false)}
        userProfile={currentUserProfile}
        readOnly={true}
      />

      <DeveloperCoachEditPlan
        visible={showEditPlan}
        onClose={() => setShowEditPlan(false)}
        userProfile={currentUserProfile}
        onUpdate={handleOnboardingDataUpdated}
      />
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
  userCard: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  userNameLarge: {
    fontSize: 24,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  userIdText: {
    fontSize: 14,
    color: '#9AA3A6',
    marginBottom: 12,
  },
  expoTokenText: {
    fontSize: 13,
    color: '#9AA3A6',
    marginBottom: 6,
  },
  copiedFeedback: {
    fontSize: 12,
    color: '#4FAE8A',
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    color: '#F2F2EE',
    fontWeight: '500',
  },
  deviceType: {
    fontSize: 14,
    color: '#9AA3A6',
    marginBottom: 8,
  },
  createdDate: {
    fontSize: 13,
    color: '#9AA3A6',
  },
  actionsSection: {
    marginTop: 8,
  },
  actionButton: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionButtonText: {
    fontSize: 17,
    fontWeight: '400',
    color: '#F2F2EE',
  },
  chevron: {
    fontSize: 17,
    color: '#C6C6C8',
    fontWeight: '400',
  },
  disabledButton: {
    opacity: 0.6,
  },
  disabledText: {
    color: '#9AA3A6',
  },
});