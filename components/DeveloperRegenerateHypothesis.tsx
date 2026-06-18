import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { glowLogger } from '../lib/glow-logger';
import { HypothesisResponse } from '../lib/llm-service';
import { 
  regenerateHypothesis, 
  buildHypothesisPrompts,
  RegenerationCallbacks 
} from '../lib/regeneration-utils';
import { getRemoteUserProfileLoggedInUser } from '../lib/supabase_db_new';
import { hypothesisToLLMString, Onboard } from '../types/onboard';

interface DeveloperRegenerateHypothesisProps {
  onBack: () => void;
  onHypothesisRegenerated: (newOnboardingData: Onboard) => void;
}

export const DeveloperRegenerateHypothesis: React.FC<DeveloperRegenerateHypothesisProps> = ({
  onBack,
  onHypothesisRegenerated
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [currentOnboardingData, setCurrentOnboardingData] = useState<Onboard | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [generatedHypothesis, setGeneratedHypothesis] = useState<HypothesisResponse | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    Clipboard.setString(text);
    Alert.alert('Copied!', `${label} has been copied to clipboard.`);
  };

  useEffect(() => {
    loadCurrentOnboardingData();
  }, [loadCurrentOnboardingData]);

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

      setCurrentOnboardingData(userProfile.onboardingProfile);
      
      // Generate the prompts for display using shared utilities
      const { systemPrompt: systemPromptText, userPrompt: userPromptText } = buildHypothesisPrompts(userProfile.onboardingProfile);
      setSystemPrompt(systemPromptText);
      setUserPrompt(userPromptText);
      
      setIsLoading(false);
      glowLogger.info('Loaded current onboarding data for hypothesis regeneration', {
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

  const handleRegenerateHypothesis = async () => {
    if (!currentOnboardingData) {
      Alert.alert('Error', 'No onboarding data available to regenerate hypothesis.');
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
      onSuccess: (result: any) => {
        if (result.newHypothesis && result.updatedOnboardingData) {
          // Show success message and go back to developer mode
          Alert.alert(
            'Hypothesis Regenerated',
            'Your hypothesis has been successfully regenerated with the latest prompts!',
            [
              {
                text: 'OK',
                onPress: () => onBack()
              }
            ]
          );
        }
      }
    };

    await regenerateHypothesis(
      userProfile,
      systemPrompt,
      userPrompt,
      callbacks
    );
  };


  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Regenerate Hypothesis</Text>
      </View>

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#F47C3C" />
          <Text style={styles.loadingText}>{loadingMessage}</Text>
        </View>
      )}

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {generatedHypothesis ? (
          // Show only the generated hypothesis after regeneration
          <View style={styles.resultSection}>
            <View style={styles.resultHeader}>
              <Text style={styles.resultTitle}>Generated Hypothesis</Text>
              <TouchableOpacity 
                onPress={() => copyToClipboard(hypothesisToLLMString(generatedHypothesis), 'Generated Hypothesis')}
                style={styles.copyButton}
              >
                <Text style={styles.copyButtonText}>Copy</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.resultTextContainer}>
              <Text style={styles.resultText}>{hypothesisToLLMString(generatedHypothesis)}</Text>
            </View>
            
            <TouchableOpacity
              style={styles.regenerateAgainButton}
              onPress={() => setGeneratedHypothesis(null)}
            >
              <Text style={styles.regenerateAgainButtonText}>Regenerate Again</Text>
            </TouchableOpacity>
          </View>
        ) : currentOnboardingData && (
          <>
            <View style={styles.infoSection}>
              <Text style={styles.infoTitle}>Current User</Text>
              <Text style={styles.infoText}>
                Name: {currentOnboardingData.name}
              </Text>
              <Text style={styles.infoText}>
                Goal: {currentOnboardingData.selectedGoal}
              </Text>
              <Text style={styles.infoText}>
                Coach: {currentOnboardingData.selectedCoach}
              </Text>
            </View>

            <View style={styles.promptSection}>
              <View style={styles.promptHeader}>
                <Text style={styles.promptTitle}>System Prompt</Text>
                <TouchableOpacity 
                  onPress={() => copyToClipboard(systemPrompt, 'System Prompt')}
                  style={styles.copyButton}
                >
                  <Text style={styles.copyButtonText}>Copy</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.promptInput}
                value={systemPrompt}
                onChangeText={setSystemPrompt}
                multiline
                placeholder="System prompt for hypothesis generation..."
                textAlignVertical="top"
              />
            </View>

            <View style={styles.promptSection}>
              <View style={styles.promptHeader}>
                <Text style={styles.promptTitle}>User Prompt</Text>
                <TouchableOpacity 
                  onPress={() => copyToClipboard(userPrompt, 'User Prompt')}
                  style={styles.copyButton}
                >
                  <Text style={styles.copyButtonText}>Copy</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.promptInput}
                value={userPrompt}
                onChangeText={setUserPrompt}
                multiline
                placeholder="User prompt for hypothesis generation..."
                textAlignVertical="top"
              />
            </View>

            <TouchableOpacity
              style={[styles.regenerateButton, isLoading && styles.disabledButton]}
              onPress={handleRegenerateHypothesis}
              disabled={isLoading}
            >
              <Text style={styles.regenerateButtonText}>
                {isLoading ? 'Generating...' : 'Regenerate Hypothesis'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#0E1A1A',
    borderBottomWidth: 1,
    borderBottomColor: '#1A2426',
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#F47C3C',
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    marginLeft: 16,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#F2F2EE',
    fontWeight: '500',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  infoSection: {
    backgroundColor: '#0E1A1A',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: '#9AA3A6',
    marginBottom: 4,
  },
  promptSection: {
    marginBottom: 24,
  },
  promptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  promptTitle: {
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
    fontWeight: '500',
  },
  promptInput: {
    backgroundColor: '#0E1A1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2A2C',
    padding: 12,
    fontSize: 14,
    minHeight: 200,
    textAlignVertical: 'top',
  },
  regenerateButton: {
    backgroundColor: '#7B3FF2',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  regenerateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  resultSection: {
    marginTop: 24,
    backgroundColor: '#0E1A1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  resultTextContainer: {
    padding: 16,
  },
  resultText: {
    fontSize: 14,
    color: '#F2F2EE',
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    lineHeight: 20,
  },
  regenerateAgainButton: {
    backgroundColor: '#f5f5f5',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    margin: 16,
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  regenerateAgainButtonText: {
    color: '#9AA3A6',
    fontSize: 16,
    fontWeight: '500',
  },
});