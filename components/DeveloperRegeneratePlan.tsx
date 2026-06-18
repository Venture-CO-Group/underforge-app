import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { glowLogger } from '../lib/glow-logger';
import { appIcons } from '../assets/icons';
import { 
  regenerateActionPlan, 
  buildActionPlanPrompts,
  RegenerationCallbacks 
} from '../lib/regeneration-utils';
import { getRemoteUserProfileLoggedInUser } from '../lib/supabase_db_new';
import { Onboard, hypothesisToLLMString } from '../types/onboard';
import { chatEvents } from '../lib/conversation-storage';

interface DeveloperRegeneratePlanProps {
  onBack: () => void;
  onPlanRegenerated: (newOnboardingData: Onboard) => void;
}

export const DeveloperRegeneratePlan: React.FC<DeveloperRegeneratePlanProps> = ({
  onBack,
  onPlanRegenerated
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [currentOnboardingData, setCurrentOnboardingData] = useState<Onboard | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');

  const copyToClipboard = (text: string, label: string) => {
    Clipboard.setString(text);
    Alert.alert('Copied!', `${label} has been copied to clipboard.`);
  };

  useEffect(() => {
    loadCurrentOnboardingData();
  }, [loadCurrentOnboardingData]);

  useEffect(() => {
    // Listen for hypothesis regeneration events to refresh data
    const handleHypothesisRegenerated = (updatedOnboardingData: Onboard) => {
      // Add toLLMString method to hypothesis if present
      if (updatedOnboardingData.hypothesis) {
        updatedOnboardingData.hypothesis.toLLMString = () => hypothesisToLLMString(updatedOnboardingData.hypothesis);
      }
      
      setCurrentOnboardingData(updatedOnboardingData);
      // Regenerate prompts with fresh hypothesis data using shared utilities
      const { systemPrompt: systemPromptText, userPrompt: userPromptText } = buildActionPlanPrompts(updatedOnboardingData);
      setSystemPrompt(systemPromptText);
      setUserPrompt(userPromptText);
      
      glowLogger.info('Refreshed plan prompts with updated hypothesis', {
        user_name: updatedOnboardingData.name,
        has_hypothesis: !!updatedOnboardingData.hypothesis
      });
    };

    chatEvents.on('hypothesisRegenerated', handleHypothesisRegenerated);
    
    return () => {
      chatEvents.off('hypothesisRegenerated', handleHypothesisRegenerated);
    };
  }, []);

  const loadCurrentOnboardingData = useCallback(async () => {
    try {
      setLoadingMessage('Loading current profile...');
      setIsLoading(true);
      
      const userProfile = await getRemoteUserProfileLoggedInUser();
      if (!userProfile?.onboardingProfile) {
        Alert.alert(
          'No Onboarding Data',
          'No onboarding data found. Complete onboarding first.',
          [{ text: 'OK', onPress: onBack }]
        );
        return;
      }

      // Add toLLMString method to hypothesis if present
      const onboardingData = userProfile.onboardingProfile;
      if (onboardingData.hypothesis) {
        onboardingData.hypothesis.toLLMString = () => hypothesisToLLMString(onboardingData.hypothesis);
      }
      
      setCurrentOnboardingData(onboardingData);
      
      // Generate the prompts for display using shared utilities
      const { systemPrompt: systemPromptText, userPrompt: userPromptText } = buildActionPlanPrompts(onboardingData);
      setSystemPrompt(systemPromptText);
      setUserPrompt(userPromptText);
      
      setIsLoading(false);
      glowLogger.info('Loaded current onboarding data for regeneration', {
        user_name: userProfile.onboardingProfile.name,
        selected_goal: userProfile.onboardingProfile.selectedGoal
      });
    } catch (error) {
      setIsLoading(false);
      glowLogger.error('Failed to load current onboarding data', {
        error: error instanceof Error ? error.message : String(error)
      });
      Alert.alert(
        'Error',
        'Failed to load current onboarding data. Please try again.',
        [{ text: 'OK', onPress: onBack }]
      );
    }
  }, [onBack]);

  const handleRegeneratePlan = async () => {
    if (!currentOnboardingData) {
      Alert.alert('Error', 'No onboarding data available to regenerate plan.');
      return;
    }

    // Get the current user profile to pass to the shared regeneration function
    const userProfile = await getRemoteUserProfileLoggedInUser();
    if (!userProfile) {
      Alert.alert('Error', 'Failed to retrieve current user profile.');
      return;
    }

    const callbacks: RegenerationCallbacks = {
      onLoadingStart: (message: string) => {
        setIsLoading(true);
        setLoadingMessage(message);
      },
      onLoadingEnd: () => {
        setIsLoading(false);
        setLoadingMessage('');
      },
      onError: (title: string, message: string) => {
        Alert.alert(title, message);
      },
      onSuccess: (updatedOnboardingData: Onboard) => {
        // Show success message and go back to developer mode
        Alert.alert(
          'Plan Regenerated',
          'Your action plan has been successfully regenerated with the latest prompts!',
          [
            {
              text: 'OK',
              onPress: () => onBack()
            }
          ]
        );
      }
    };

    await regenerateActionPlan(
      userProfile,
      systemPrompt,
      userPrompt,
      callbacks
    );
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft} />
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Regenerating Plan</Text>
          </View>
          <View style={styles.headerRight} />
        </View>

        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F47C3C" style={styles.spinner} />
          <Text style={styles.loadingTitle}>Regenerating Your Plan</Text>
          <Text style={styles.loadingMessage}>{loadingMessage}</Text>
          <Text style={styles.loadingSubtext}>
            This may take a moment while we generate your personalized action plan with the latest improvements...
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitleCompact}>Regenerate Plan</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        <View style={styles.infoSectionCompact}>
          <Image source={appIcons.refresh} style={styles.infoIconCompactImage} />
          <Text style={styles.infoTitleCompact}>Regenerate Action Plan</Text>
        </View>

        <View style={styles.promptSection}>
          <View style={styles.promptContainer}>
            <View style={styles.promptHeader}>
              <Text style={styles.promptLabel}>System Prompt:</Text>
              <TouchableOpacity 
                style={styles.copyButton}
                onPress={() => copyToClipboard(systemPrompt, 'System Prompt')}
              >
                <Text style={styles.copyButtonText}>📋 Copy</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.promptTextAreaLarge}
              value={systemPrompt}
              onChangeText={setSystemPrompt}
              multiline
              scrollEnabled={false}
              placeholder="System prompt..."
            />
          </View>
          
          <View style={styles.promptContainer}>
            <View style={styles.promptHeader}>
              <Text style={styles.promptLabel}>User Prompt:</Text>
              <TouchableOpacity 
                style={styles.copyButton}
                onPress={() => copyToClipboard(userPrompt, 'User Prompt')}
              >
                <Text style={styles.copyButtonText}>📋 Copy</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.promptTextAreaLarge}
              value={userPrompt}
              onChangeText={setUserPrompt}
              multiline
              scrollEnabled={false}
              placeholder="User prompt..."
            />
          </View>
        </View>

        <View style={styles.buttonSection}>
          <TouchableOpacity
            style={styles.regenerateButton}
            onPress={handleRegeneratePlan}
            disabled={!currentOnboardingData}
          >
            <Text style={styles.regenerateButtonText}>🚀 Regenerate Plan</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onBack}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
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
  headerLeft: {
    width: 60,
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
  headerTitleCompact: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  headerRight: {
    width: 60,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  scrollContent: {
    paddingTop: 24,
    paddingBottom: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  spinner: {
    marginBottom: 24,
  },
  loadingTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 12,
    textAlign: 'center',
  },
  loadingMessage: {
    fontSize: 18,
    color: '#F47C3C',
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  loadingSubtext: {
    fontSize: 16,
    color: '#9AA3A6',
    textAlign: 'center',
    lineHeight: 22,
  },
  infoSection: {
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    padding: 24,
    marginBottom: 32,
    alignItems: 'center',
  },
  infoSectionCompact: {
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  infoIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  infoIconCompact: {
    fontSize: 32,
    marginBottom: 12,
  },
  infoIconCompactImage: {
    width: 32,
    height: 32,
    marginBottom: 12,
  },
  infoTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 16,
    textAlign: 'center',
  },
  infoTitleCompact: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    textAlign: 'center',
  },
  promptSection: {
    marginBottom: 24,
  },
  promptContainer: {
    marginBottom: 20,
  },
  promptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  promptLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  copyButton: {
    backgroundColor: '#F47C3C',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  promptTextArea: {
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#F2F2EE',
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    minHeight: 120,
    maxHeight: 200,
    borderWidth: 1,
    borderColor: '#E1E5E9',
    textAlignVertical: 'top',
  },
  promptTextAreaLarge: {
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#F2F2EE',
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    minHeight: 200,
    borderWidth: 1,
    borderColor: '#E1E5E9',
    textAlignVertical: 'top',
  },
  buttonSection: {
    gap: 16,
  },
  regenerateButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  regenerateButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  cancelButton: {
    backgroundColor: '#F2F2F7',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#C6C6C8',
  },
  cancelButtonText: {
    color: '#9AA3A6',
    fontSize: 16,
    fontWeight: '600',
  },
});