import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import onboardingConfigV2 from '../assets/onboarding_config';
import { BrandColors } from '../constants/Colors';
import { FontFamily } from '../constants/Typography';
import { glowLogger } from '../lib/glow-logger';
import { i18n } from '../lib/i18n';
import { llmService } from '../lib/llm-service';
import { getRemoteUserProfileLoggedInUser, updateUserProfile } from '../lib/supabase_db_new';
import { Onboard } from '../types/onboard';
import { OnboardingConfig } from '../types/onboarding_config';
import { UserProfile } from '../types/user_profile';
import { AskClarifyingCoachQuestion } from './AskClarifyingCoachQuestion';
import { PlanDetailsScreen } from './PlanDetailsScreen';
import { ShaderBackground } from './ShaderBackground';

const { width: screenWidth } = Dimensions.get('window');

interface SurveyFlowModalProps {
  visible: boolean;
  surveyType: 'nutrition' | 'recovery';
  userProfile: UserProfile;
  onComplete: () => void;
  onClose: () => void;
}

type SurveyScreen = 'questions' | 'generating' | 'result';

export const SurveyFlowModal: React.FC<SurveyFlowModalProps> = ({
  visible,
  surveyType,
  userProfile,
  onComplete,
  onClose,
}) => {
  const config = onboardingConfigV2 as unknown as OnboardingConfig;
  const questionKeys = surveyType === 'nutrition' ? config.nutrition_survey : config.recovery_survey;

  const [screen, setScreen] = useState<SurveyScreen>('questions');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [generatedStep, setGeneratedStep] = useState<any>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (visible) {
      setScreen('questions');
      setCurrentQuestionIndex(0);
      setAnswers({});
      setGeneratedStep(null);
      setGenerationError(null);
    }
  }, [visible]);

  useEffect(() => {
    if (screen === 'generating') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [screen]);

  const currentQuestionKey = questionKeys[currentQuestionIndex];
  const currentQuestionConfig = currentQuestionKey ? config.question_bank[currentQuestionKey] : null;

  const handleAnswerChange = useCallback((answer: any) => {
    setAnswers(prev => ({ ...prev, [currentQuestionKey]: answer }));
  }, [currentQuestionKey]);

  const handleNext = useCallback(() => {
    if (currentQuestionIndex < questionKeys.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      generatePlan();
    }
  }, [currentQuestionIndex, questionKeys.length]);

  const handlePrevious = useCallback(() => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  }, [currentQuestionIndex]);

  const generatePlan = async () => {
    setScreen('generating');
    setGenerationError(null);

    try {
      const onboardData = userProfile.onboardingProfile;
      if (!onboardData) throw new Error('No onboarding profile found');

      const isSpanish = i18n.language?.startsWith('es');
      const surveyAnswers = questionKeys.map(key => ({
        question:
          (isSpanish && config.question_bank[key]?.label_es) ||
          config.question_bank[key]?.label_en ||
          key,
        answer: String(answers[key] || i18n.t('common:noAnswerProvided')),
      }));

      const stepIndex = surveyType === 'nutrition' ? 1 : 2;
      const existingStep = onboardData.actionPlan?.steps[stepIndex];

      const onboardDataForLLM: Onboard = {
        ...onboardData,
        toLLMString: () => 'Survey plan generation',
      };

      glowLogger.info(`[SurveyFlow] Generating ${surveyType} plan`, {
        survey_answers_count: surveyAnswers.length,
        existing_step_title: existingStep?.title,
      });

      const newStep = await llmService.generateDimensionPlan(
        surveyType,
        onboardDataForLLM,
        surveyAnswers,
        existingStep
      );

      glowLogger.info(`[SurveyFlow] ${surveyType} plan generated successfully`, {
        new_step_title: newStep.title,
        has_phase_2: !!newStep.phase_2_title,
        has_phase_3: !!newStep.phase_3_title,
      });

      // Persist: update only the relevant step in the action plan
      const freshProfile = await getRemoteUserProfileLoggedInUser();
      if (!freshProfile?.onboardingProfile?.actionPlan) {
        throw new Error('Could not load current action plan');
      }

      const updatedSteps = [...freshProfile.onboardingProfile.actionPlan.steps];
      updatedSteps[stepIndex] = {
        ...newStep,
        id: stepIndex === 1 ? 'step_2' : 'step_3',
        dateAdded: newStep.dateAdded || new Date().toISOString(),
      };

      const updatedOnboardingData = {
        ...freshProfile.onboardingProfile,
        actionPlan: {
          ...freshProfile.onboardingProfile.actionPlan,
          steps: updatedSteps,
          updatedAt: new Date().toISOString(),
        },
      };

      await updateUserProfile({
        user_id: freshProfile.onboardingProfile.localUserId!,
        onboardingProfile: updatedOnboardingData,
      });

      setGeneratedStep(updatedSteps[stepIndex]);
      setScreen('result');
    } catch (error) {
      glowLogger.error(`[SurveyFlow] ${surveyType} plan generation failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      setGenerationError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    setGenerationError(null);
    await generatePlan();
    setIsRetrying(false);
  };

  const handleDone = () => {
    onComplete();
    onClose();
  };

  const renderQuestions = () => (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <AskClarifyingCoachQuestion
        config={config}
        selectedCoach={userProfile.onboardingProfile?.selectedCoach || ''}
        questionKey={currentQuestionKey}
        questionConfig={currentQuestionConfig}
        userAnswer={answers[currentQuestionKey] ?? (currentQuestionConfig?.ui_widget === 'multi_select' || currentQuestionConfig?.ui_widget === 'body_map' || currentQuestionConfig?.ui_widget === 'body_map_focus' ? [] : '')}
        questionNumber={currentQuestionIndex + 1}
        totalQuestions={questionKeys.length}
        onAnswerChange={handleAnswerChange}
        onNext={handleNext}
        onPrevious={handlePrevious}
        canGoBack={currentQuestionIndex > 0}
        hideSectionNavigator
        userGender={userProfile.onboardingProfile?.gender || ''}
        headerSlot={(
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Cancel</Text>
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>
                {surveyType === 'nutrition' ? 'Nutrition Survey' : 'Recovery Survey'}
              </Text>
              <Text style={styles.headerSubtitle}>
                Question {currentQuestionIndex + 1} of {questionKeys.length}
              </Text>
            </View>
            <View style={styles.headerRight} />
          </View>
        )}
      />
    </SafeAreaView>
  );

  const renderGenerating = () => (
    <SafeAreaView style={styles.container}>
      <ShaderBackground />
      <View style={styles.generatingContainer}>
        <Animated.View style={[styles.generatingIconContainer, { opacity: pulseAnim }]}>
          <Text style={styles.generatingIcon}>
            {surveyType === 'nutrition' ? '🥑' : '😴'}
          </Text>
        </Animated.View>

        <Text style={styles.generatingTitle}>
          {generationError
            ? 'Generation Failed'
            : `Personalizing your ${surveyType} plan...`}
        </Text>

        {!generationError && (
          <Text style={styles.generatingSubtitle}>
            Analyzing your answers and creating a tailored plan
          </Text>
        )}

        {!generationError && (
          <ActivityIndicator size="large" color={BrandColors.accent} style={{ marginTop: 24 }} />
        )}

        {generationError && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>
              {generationError.length > 200 ? generationError.slice(0, 200) + '...' : generationError}
            </Text>
            <TouchableOpacity
              style={[styles.retryButton, isRetrying && styles.retryButtonDisabled]}
              onPress={handleRetry}
              disabled={isRetrying}
            >
              {isRetrying ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.retryButtonText}>Try Again</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );

  const renderResult = () => (
    <SafeAreaView style={styles.container}>
      <PlanDetailsScreen
        step={generatedStep}
        stepIndex={surveyType === 'nutrition' ? 1 : 2}
        onBack={handleDone}
        isEditable={false}
        userProfile={userProfile}
      />
      <View style={styles.doneButtonContainer}>
        <TouchableOpacity style={styles.doneButton} onPress={handleDone}>
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaProvider>
        {screen === 'questions' && renderQuestions()}
        {screen === 'generating' && renderGenerating()}
        {screen === 'result' && renderResult()}
      </SafeAreaProvider>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1A2426',
  },
  closeButton: {
    width: 64,
    paddingVertical: 8,
  },
  closeButtonText: {
    color: BrandColors.accent,
    fontSize: 16,
    fontFamily: FontFamily.bodyRegular,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
    fontFamily: FontFamily.bodySemiBold,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#9AA3A6',
    marginTop: 2,
  },
  headerRight: {
    width: 64,
  },
  generatingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  generatingIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(244, 124, 60, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  generatingIcon: {
    fontSize: 36,
  },
  generatingTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F2F2EE',
    textAlign: 'center',
    fontFamily: FontFamily.bodySemiBold,
  },
  generatingSubtitle: {
    fontFamily: FontFamily.displayRegular,
    fontSize: 18,
    color: '#F2F2EE',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 26,
  },
  errorContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#C65B5B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: BrandColors.accent,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  retryButtonDisabled: {
    opacity: 0.6,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  cancelButtonText: {
    color: '#9AA3A6',
    fontSize: 15,
  },
  doneButtonContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 8,
    backgroundColor: '#0B1114',
  },
  doneButton: {
    backgroundColor: BrandColors.accent,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: FontFamily.bodySemiBold,
  },
});
