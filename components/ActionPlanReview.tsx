import React, { useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { coachImages } from '../assets/images/coaches';
import { appIcons } from '../assets/icons';
import { ActionPlan, ActionStep, Onboard } from '../types/onboard';
import { OnboardingConfig } from '../types/onboarding_config';
import { Icon } from './Icon';
import { PlanDetailsScreen } from './PlanDetailsScreen';
import { PlanOverviewAndSteps } from './PlanOverviewAndSteps';
import { ScheduleScreen } from './ScheduleScreen';
  
const { width: screenWidth } = Dimensions.get('window');

const truncateErrorMessage = (message: string, maxWords: number = 250): string => {
  const words = message.split(' ');
  if (words.length <= maxWords) {
    return message;
  }
  return words.slice(0, maxWords).join(' ') + '...';
};

interface ActionPlanReviewProps {
  config: OnboardingConfig;
  selectedCoach: string;
  actionPlan: ActionPlan;
  onRevisePlan: () => void;
  onAcceptPlan: () => void;
  onActionPlanUpdate?: (updatedActionPlan: ActionPlan) => void;
  userGender?: string;
  selectedGoal?: string;
  userLocalId?: string;
  onboardData?: Onboard;
  hasGenerationError?: boolean;
  planGenerationError?: string;
}

export const ActionPlanReview: React.FC<ActionPlanReviewProps> = ({
  config,
  selectedCoach,
  actionPlan,
  onRevisePlan,
  onAcceptPlan,
  onActionPlanUpdate,
  userGender,
  selectedGoal,
  userLocalId,
  onboardData,
  hasGenerationError = false,
  planGenerationError
}) => {
  const { t } = useTranslation(['plan', 'onboarding']);
  const [currentScreen, setCurrentScreen] = useState<'main' | 'details' | 'schedule'>('main');
  const [selectedStep, setSelectedStep] = useState<{ stepIndex: number; step: ActionStep } | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showStepDetails, setShowStepDetails] = useState(false);
  const [localActionPlan, setLocalActionPlan] = useState<ActionPlan>(actionPlan);
  const [isRetrying, setIsRetrying] = useState(false);

  const slideAnim = useRef(new Animated.Value(0)).current;

  const selectedCoachInfo = config.general_info.coach_selection[selectedCoach];

  const getCoachImage = (imageName: string) => {
    return coachImages[imageName as keyof typeof coachImages] || null;
  };

  const coachImage = getCoachImage(selectedCoachInfo.image);

  const handleStepPress = (stepIndex: number) => {
    if (isAnimating) return;

    const step = actionPlan.steps[stepIndex];
    setSelectedStep({ stepIndex, step });
    setIsAnimating(true);

    Animated.timing(slideAnim, {
      toValue: -screenWidth,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setCurrentScreen('details');
      setIsAnimating(false);
    });
  };

  const handleBackToMain = () => {
    if (isAnimating) return;

    setIsAnimating(true);

    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setCurrentScreen('main');
      setSelectedStep(null);
      setIsAnimating(false);
    });
  };

  const handleBackToDetails = () => {
    if (isAnimating) return;

    setIsAnimating(true);

    Animated.timing(slideAnim, {
      toValue: -screenWidth,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setCurrentScreen('details');
      setIsAnimating(false);
    });
  };

  const handleCloseStepDetails = () => {
    setShowStepDetails(false);
    setSelectedStep(null);
  };

  const handleScheduleChange = (stepId: string, newDaysOfWeek: string[], newTimeOfDay?: string) => {
    // Update the local action plan state
    const updatedSteps = localActionPlan.steps.map(step => {
      if (step.id === stepId) {
        const updatedStep = {
          ...step,
          daysOfWeek: newDaysOfWeek,
          dateModified: new Date().toISOString()
        };
        
        // Update time if provided
        if (newTimeOfDay !== undefined) {
          updatedStep.timeOfDay = newTimeOfDay;
        }
        
        return updatedStep;
      }
      return step;
    });

    const updatedActionPlan = {
      ...localActionPlan,
      steps: updatedSteps,
      updatedAt: new Date().toISOString()
    };

    setLocalActionPlan(updatedActionPlan);

    // Notify parent component of the update
    onActionPlanUpdate?.(updatedActionPlan);

    // Update the selected step if it's the one being modified
    if (selectedStep && selectedStep.step.id === stepId) {
      const updatedSelectedStep = {
        ...selectedStep.step,
        daysOfWeek: newDaysOfWeek,
        dateModified: new Date().toISOString()
      };
      
      if (newTimeOfDay !== undefined) {
        updatedSelectedStep.timeOfDay = newTimeOfDay;
      }
      
      setSelectedStep({
        ...selectedStep,
        step: updatedSelectedStep
      });
    }
  };

  const handleSchedulePress = () => {
    if (isAnimating) return;

    setIsAnimating(true);

    Animated.timing(slideAnim, {
      toValue: -screenWidth * 2,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setCurrentScreen('schedule');
      setIsAnimating(false);
    });
  };

  const handleScheduleSave = async (stepId: string, selectedDays: string[], selectedTime?: string): Promise<void> => {
    // Handle schedule save - update both local state and notify parent
    handleScheduleChange(stepId, selectedDays, selectedTime);
    return Promise.resolve();
  };

  const handleRetry = () => {
    setIsRetrying(true);
    // Show spinner briefly, then trigger retry
    setTimeout(() => {
      setIsRetrying(false);
      onAcceptPlan();
    }, 800);
  };

  if (!selectedCoachInfo || !actionPlan) {
    return null;
  }

  const renderMainScreen = () => (
    <View style={styles.container}>
      <View style={styles.fieldHeader}>
        {coachImage ? (
          <Image source={coachImage} style={styles.coachImageSmall} />
        ) : (
          <View style={styles.coachImagePlaceholderSmall}>
            <Text style={styles.coachImageTextSmall}>
              {selectedCoachInfo.label_en.charAt(0)}
            </Text>
          </View>
        )}
        <Text style={styles.fieldCoachName}>
          {t('onboarding:coachLabel', { name: selectedCoachInfo.label_en })}
        </Text>
      </View>

      <View style={styles.actionPlanContainer}>
        <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          <Text style={styles.actionPlanTitle}>
            {hasGenerationError ? t('plan:actionPlanErrorTitle') : t('plan:actionPlanTitle')}
          </Text>
          <Text style={styles.actionPlanSubtitle}>
            {hasGenerationError 
              ? t('plan:actionPlanErrorSubtitle')
              : t('plan:actionPlanSubtitle')
            }
          </Text>

          {hasGenerationError && planGenerationError && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{t('plan:actionPlanErrorPrefix')}{truncateErrorMessage(planGenerationError)}</Text>
              <TouchableOpacity 
                style={[styles.retryButtonInline, isRetrying && styles.retryButtonInlineDisabled]}
                onPress={handleRetry}
                disabled={isRetrying}
              >
                {isRetrying ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.retryButtonInlineText}>
                    {t('plan:actionPlanTryAgain')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {!hasGenerationError && (
            <>
              <View style={styles.infoRibbon}>
                <Icon source={appIcons.lightbulb} width={18} height={18} fill="#9AA3A6" style={{ marginRight: 10 }} />
                <Text style={styles.infoRibbonText}>
                  {t('plan:actionPlanInfoRibbon')}
                </Text>
              </View>
              <PlanOverviewAndSteps
                actionPlan={localActionPlan}
                onStepPress={handleStepPress}
                userGender={userGender}
              />
            </>
          )}
        </ScrollView>

        {!hasGenerationError && (
          <View style={styles.actionPlanButtons}>
            <TouchableOpacity style={styles.revisePlanButton} onPress={onRevisePlan}>
              <Text style={styles.revisePlanButtonText}>{t('plan:actionPlanMakeChanges')}</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.acceptPlanButton}
              onPress={onAcceptPlan}
            >
              <Text style={styles.acceptPlanButtonText}>
                {t('plan:actionPlanAccept')}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );

  const renderDetailsScreen = () => (
    <PlanDetailsScreen
      step={selectedStep?.step}
      stepIndex={selectedStep?.stepIndex}
      actionPlan={localActionPlan}
      onboardData={onboardData}
      onBack={handleBackToMain}
      onSchedulePress={handleSchedulePress}
      onScheduleChange={handleScheduleChange}
      isEditable={true}
      userGender={userGender}
      selectedGoal={selectedGoal}
      userLocalId={userLocalId}
    />
  );

  const renderScheduleScreen = () => (
    <ScheduleScreen
      step={selectedStep?.step}
      onBack={handleBackToDetails}
      onScheduleChange={handleScheduleChange}
      onScheduleSave={handleScheduleSave}
    />
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <Animated.View style={{ flex: 1, flexDirection: 'row' }}>
        {/* Main Screen */}
        <Animated.View
          style={{
            width: screenWidth,
            transform: [{ translateX: slideAnim }]
          }}
        >
          {renderMainScreen()}
        </Animated.View>

        {/* Details Screen */}
        <Animated.View
          style={{
            width: screenWidth,
            transform: [{ translateX: slideAnim }]
          }}
        >
          {renderDetailsScreen()}
        </Animated.View>

        {/* Schedule Screen */}
        <Animated.View
          style={{
            width: screenWidth,
            transform: [{ translateX: slideAnim }]
          }}
        >
          {renderScheduleScreen()}
        </Animated.View>
      </Animated.View>

      {/* Step Details Modal */}
      <Modal
        visible={showStepDetails}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleCloseStepDetails}
      >
        <PlanDetailsScreen
          step={selectedStep?.step}
          stepIndex={selectedStep?.stepIndex}
          actionPlan={localActionPlan}
          onboardData={onboardData}
          onBack={handleCloseStepDetails}
          onScheduleChange={handleScheduleChange}
          isEditable={true}
          userGender={userGender}
          selectedGoal={selectedGoal}
          userLocalId={userLocalId}
        />
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#0E1A1A',
  },
  infoRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(154, 163, 166, 0.08)',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(154, 163, 166, 0.2)',
  },
  infoRibbonText: {
    flex: 1,
    fontSize: 13,
    color: '#9AA3A6',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  fieldHeader: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  coachImageSmall: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginBottom: 12,
  },
  coachImagePlaceholderSmall: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F47C3C',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  coachImageTextSmall: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  fieldCoachName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  actionPlanContainer: {
    flex: 1,
    paddingBottom: 20,
  },
  actionPlanTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  actionPlanSubtitle: {
    fontSize: 16,
    color: '#9AA3A6',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
    paddingHorizontal: 20,
  },
  actionPlanButtons: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
  },
  revisePlanButton: {
    flex: 1,
    backgroundColor: '#F47C3C',
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: 'center',
  },
  revisePlanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  acceptPlanButton: {
    flex: 1,
    backgroundColor: '#F47C3C',
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: 'center',
  },
  acceptPlanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  scrollContainer: {
    flex: 1,
  },
  retryPlanButton: {
    backgroundColor: '#FF9500',
  },
  retryPlanButtonText: {
    color: '#fff',
  },
  retryPlanButtonFull: {
    flex: 0,
    width: '100%',
  },
  errorContainer: {
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9500',
  },
  errorText: {
    color: '#E65100',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 16,
  },
  retryButtonInline: {
    backgroundColor: '#FF9500',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  retryButtonInlineText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  retryButtonInlineDisabled: {
    backgroundColor: '#FFCC80',
  },
});