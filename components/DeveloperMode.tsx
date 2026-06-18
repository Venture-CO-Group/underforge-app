import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { glowLogger } from '../lib/glow-logger';
import { getRemoteUserProfileLoggedInUser } from '../lib/supabase_db_new';
import { UserProfile } from '../types/user_profile';
import { DeveloperCoachingDashboard } from './DeveloperCoachingDashboard';


interface DeveloperModeProps {
  visible: boolean;
  onClose: () => void;
  /** Opens weekly progress check-in preview (metrics as if today were the most recent Sunday). */
  onDebugCreateWeeklyReport?: () => void;
}


export const DeveloperMode: React.FC<DeveloperModeProps> = ({
  visible,
  onClose,
  onDebugCreateWeeklyReport,
}) => {
  const [isPasswordVerified, setIsPasswordVerified] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [showCoachingDashboard, setShowCoachingDashboard] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  
  useEffect(() => {
    if (visible) {
      loadCurrentUserProfile();
    } else {
      // Reset password verification when modal closes
      setIsPasswordVerified(false);
      setPasswordInput('');
    }
  }, [visible]);



  const loadCurrentUserProfile = async () => {
    try {
      const userProfile = await getRemoteUserProfileLoggedInUser();
      setCurrentUserProfile(userProfile); // <-- Save full profile object
      glowLogger.info('Loaded current user profile for developer dashboard', {
        is_coach: userProfile?.is_coach || false,
        user_id: userProfile?.user_id || 'unknown'
      });
    } catch (error) {
      glowLogger.error('Failed to load current user profile', {
        error: error instanceof Error ? error.message : String(error)
      });
      setCurrentUserProfile(null);
    }
  };


  const handlePasswordSubmit = () => {
    // Simple password check - in production, this should be more secure
    if (passwordInput.trim() === '!joRema') {
      setIsPasswordVerified(true);
      setPasswordInput('');
      // Open coaching dashboard immediately without showing intermediate screen
      setShowCoachingDashboard(true);
    } else {
      Alert.alert('Incorrect Password', 'Please try again.');
      setPasswordInput('');
    }
  };

  const handleShowCoachingDashboard = () => {
    setShowCoachingDashboard(true);
  };

  const handleCloseCoachingDashboard = () => {
    setShowCoachingDashboard(false);
  };


  const handleClose = () => {
    console.log('[DeveloperMode] Main close handler called');
    setIsPasswordVerified(false);
    setPasswordInput('');
    onClose();
  };


  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.container}>
        {!isPasswordVerified ? (
          /* Password Screen */
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.header}>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>Cancel</Text>
              </TouchableOpacity>
              <View style={styles.headerCenter}>
                <Text style={styles.headerTitle}>Developer Mode</Text>
              </View>
              <View style={styles.headerRight} />
            </View>

            <View style={styles.passwordContainer}>
              <Text style={styles.passwordTitle}>Enter Password</Text>
              <Text style={styles.passwordSubtitle}>Developer access required</Text>
              <TextInput
                style={styles.passwordInput}
                value={passwordInput}
                onChangeText={setPasswordInput}
                placeholder="Enter password"
                placeholderTextColor="#6F7A7E"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                onSubmitEditing={handlePasswordSubmit}
                returnKeyType="done"
              />
              <TouchableOpacity style={styles.passwordButton} onPress={handlePasswordSubmit}>
                <Text style={styles.passwordButtonText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        ) : showCoachingDashboard ? (
          <DeveloperCoachingDashboard 
            onBack={handleCloseCoachingDashboard} 
            currentUserProfile={currentUserProfile}
            skipAuth={true}
            onDebugCreateWeeklyReport={onDebugCreateWeeklyReport}
          />
        ) : (
          <>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>Done</Text>
              </TouchableOpacity>
              <View style={styles.headerCenter}>
                <Text style={styles.headerTitle}>Developer Mode</Text>
              </View>
              <View style={styles.headerRight} />
            </View>

            {/* Content */}
            <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
              <View style={styles.content}>

                {/* Coaching Section */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Coaching</Text>
                  <Text style={styles.sectionDescription}>
                    View and manage coaching dashboard and interactions
                  </Text>
                  
                  <TouchableOpacity 
                    style={styles.actionButton}
                    onPress={handleShowCoachingDashboard}
                  >
                    <Text style={styles.folderIcon}>👨‍💼</Text>
                    <View style={styles.actionButtonContent}>
                      <Text style={styles.actionButtonText}>Show Coaching Dashboard</Text>
                      <Text style={styles.actionButtonSubtext}>View coaching interactions and data</Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                </View>


              </View>
            </ScrollView>
          </>
        )}

      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#0E1A1A',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  closeButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  closeButtonText: {
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
  scrollContainer: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 40,
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
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1A1A',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 12,
  },
  actionButtonSecondary: {
    backgroundColor: '#141E1E',
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  actionButtonTertiary: {
    backgroundColor: '#141E1E',
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  actionButtonGroup: {
    gap: 12,
  },
  folderIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  testIcon: {
    fontSize: 20,
    marginRight: 16,
  },
  actionButtonContent: {
    flex: 1,
  },
  actionButtonText: {
    fontSize: 16,
    color: '#F47C3C',
    fontWeight: '600',
    marginBottom: 2,
  },
  actionButtonSubtext: {
    fontSize: 13,
    color: '#9AA3A6',
    lineHeight: 16,
  },
  chevron: {
    fontSize: 20,
    color: '#C7C7CC',
    fontWeight: '600',
    marginLeft: 8,
  },
  refreshButton: {
    backgroundColor: '#141E1E',
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  refreshIcon: {
    fontSize: 20,
    marginRight: 16,
  },
  emptyState: {
    backgroundColor: '#0E1A1A',
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  emptyStateText: {
    fontSize: 15,
    color: '#9AA3A6',
    fontStyle: 'italic',
  },
  userList: {
    marginTop: 12,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1A1A',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    marginBottom: 8,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 2,
  },
  userId: {
    fontSize: 12,
    color: '#9AA3A6',
    fontFamily: 'monospace',
  },
  activeIndicator: {
    fontSize: 20,
    color: '#4FAE8A',
    fontWeight: 'bold',
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
  linkButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  linkButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
  reloadButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  linkContainer: {
    paddingVertical: 12,
    marginBottom: 16,
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
  testButtonText: {
    fontSize: 16,
    color: '#F47C3C',
    fontWeight: '600',
  },
  passwordContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  passwordTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  passwordSubtitle: {
    fontSize: 16,
    color: '#9AA3A6',
    marginBottom: 32,
  },
  passwordInput: {
    width: '100%',
    backgroundColor: '#141E1E',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    fontSize: 16,
    color: '#F2F2EE',
    borderWidth: 1,
    borderColor: '#1E2A2C',
    marginBottom: 20,
  },
  passwordButton: {
    width: '100%',
    backgroundColor: '#F47C3C',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  passwordButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#0B1114',
  },
});