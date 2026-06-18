import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Modal } from 'react-native';
import { glowLogger } from '../lib/glow-logger';
import { onboardingEvents } from '../lib/supabase_db';
import { getRemoteUserProfileLoggedInUser, updateUserProfile } from '../lib/supabase_db_new';
import { ActionPlan, ActionStep } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import { EditPlanModal } from './EditPlanModal';
import { PlanDetailsScreen } from './PlanDetailsScreen';
import { PlanMainScreen } from './PlanMainScreen';
import { ScheduleScreen } from './ScheduleScreen';
import { SurveyFlowModal } from './SurveyFlowModal';

export type PlanStackParamList = {
  PlanMain: undefined;
  PlanDetails: {
    stepIndex: number;
    step: ActionStep;
  };
  Schedule: {
    step: ActionStep;
  };
};

interface PlanViewProps {
  userProfile: UserProfile;
  visible: boolean;
  onClose: () => void;
  onStartSurvey?: (surveyType: 'nutrition' | 'recovery') => void;
}

const { width: screenWidth } = Dimensions.get('window');

export const PlanView: React.FC<PlanViewProps> = ({
  userProfile,
  visible,
  onClose,
  onStartSurvey,
}) => {
  const [localActionPlan, setLocalActionPlan] = useState<ActionPlan | undefined>(userProfile.onboardingProfile?.actionPlan);
  const [currentScreen, setCurrentScreen] = useState<'main' | 'details' | 'schedule'>('main');
  const [selectedStep, setSelectedStep] = useState<{ stepIndex: number; step: ActionStep } | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [surveyModalVisible, setSurveyModalVisible] = useState(false);
  const [activeSurveyType, setActiveSurveyType] = useState<'nutrition' | 'recovery'>('nutrition');
  const [nutritionSurveyDone, setNutritionSurveyDone] = useState(false);
  const [recoverySurveyDone, setRecoverySurveyDone] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editInitialStepIndex, setEditInitialStepIndex] = useState<number | undefined>(undefined);
  
  const slideAnim = useRef(new Animated.Value(0)).current;

  const handleStartSurvey = (surveyType: 'nutrition' | 'recovery') => {
    setActiveSurveyType(surveyType);
    setSurveyModalVisible(true);
  };

  const handleSurveyComplete = async () => {
    if (activeSurveyType === 'nutrition') setNutritionSurveyDone(true);
    else setRecoverySurveyDone(true);

    try {
      const profile = await getRemoteUserProfileLoggedInUser();
      if (profile?.onboardingProfile?.actionPlan) {
        setLocalActionPlan(profile.onboardingProfile.actionPlan);
      }
    } catch (err) {
      glowLogger.error('[PlanView] Error reloading profile after survey', { error: err });
    }
  };

  useEffect(() => {
    const handler = async (event: any) => {
      glowLogger.info('[PlanView] onboardingDataChanged event received', { event });
      try {
        const userProfileData = await getRemoteUserProfileLoggedInUser();
        if (userProfileData?.onboardingProfile?.actionPlan) {
          setLocalActionPlan(userProfileData.onboardingProfile.actionPlan);
          glowLogger.info('[PlanView] Action plan reloaded successfully', {});
        }
      } catch (error) {
        glowLogger.error('[PlanView] Error reloading action plan', { error });
      }
    };
    
    onboardingEvents.on('onboardingDataChanged', handler);
    glowLogger.info('[PlanView] Subscribed to onboardingDataChanged events', {});

    return () => {
      onboardingEvents.off('onboardingDataChanged', handler);
      glowLogger.info('[PlanView] Unsubscribed from onboardingDataChanged events', {});
    };
  }, []);

  useEffect(() => {
    setLocalActionPlan(userProfile.onboardingProfile?.actionPlan);
  }, [userProfile.onboardingProfile?.actionPlan]);

  const handleStepPress = (stepIndex: number) => {
    if (isAnimating || !localActionPlan) return;
    
    const step = localActionPlan.steps[stepIndex];
    setSelectedStep({ stepIndex, step });
    setCurrentScreen('details');
    setIsAnimating(true);
    
    Animated.timing(slideAnim, {
      toValue: -screenWidth,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setIsAnimating(false);
    });
  };

  const handleSchedulePress = () => {
    if (isAnimating || !selectedStep) return;
    
    setCurrentScreen('schedule');
    setIsAnimating(true);
    
    Animated.timing(slideAnim, {
      toValue: -screenWidth * 2,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setIsAnimating(false);
    });
  };

  const handleBackToMain = () => {
    if (isAnimating) return;
    
    setCurrentScreen('main');
    setIsAnimating(true);
    
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setSelectedStep(null);
      setIsAnimating(false);
    });
  };

  const handleBackToDetails = () => {
    if (isAnimating) return;
    
    setCurrentScreen('details');
    setIsAnimating(true);
    
    Animated.timing(slideAnim, {
      toValue: -screenWidth,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setIsAnimating(false);
    });
  };

  const handleModalClose = () => {
    if (isAnimating) return;
    
    slideAnim.setValue(0);
    setCurrentScreen('main');
    setSelectedStep(null);
    setIsAnimating(false);
    onClose();
  };

  const handleScheduleChange = (stepId: string, newDaysOfWeek: string[], newTimeOfDay?: string) => {
    glowLogger.info('Schedule changed for step', { stepId, newDays: newDaysOfWeek, newTime: newTimeOfDay });
  };

  const handleScheduleSave = async (stepId: string, selectedDays: string[], selectedTime?: string): Promise<void> => {
    try {
      glowLogger.info('handleScheduleSave', { stepId, newDays: selectedDays, newTime: selectedTime });

      const userProfileData = await getRemoteUserProfileLoggedInUser();
      if (!userProfileData || !userProfileData.onboardingProfile.actionPlan) {
        throw new Error('Could not load your action plan data');
      }

      const updatedSteps = userProfileData.onboardingProfile.actionPlan.steps.map(actionStep => {
        if (actionStep.id === stepId) {
          const updatedStep = {
            ...actionStep,
            daysOfWeek: selectedDays,
            dateModified: new Date().toISOString()
          };
          
          if (selectedTime !== undefined) {
            updatedStep.timeOfDay = selectedTime;
          }
          
          return updatedStep;
        }
        return actionStep;
      });

      const updatedOnboardingData = {
        ...userProfileData.onboardingProfile,
        actionPlan: {
          ...userProfileData.onboardingProfile.actionPlan,
          steps: updatedSteps,
          updatedAt: new Date().toISOString()
        }
      };

      glowLogger.info('handleScheduleSave new updatedOnboardingData', { stepId, updatedOnboardingData: updatedOnboardingData });

      await updateUserProfile({
        user_id: userProfileData.onboardingProfile.localUserId!,
        onboardingProfile: updatedOnboardingData
      });
    } catch (error) {
      glowLogger.error('Error saving schedule', { error });
      throw error;
    }
  };

  const handleEditStep = (stepIndex: number) => {
    setEditInitialStepIndex(stepIndex);
    setShowEditModal(true);
  };

  const handleEditModalClose = () => {
    setShowEditModal(false);
    setEditInitialStepIndex(undefined);
  };

  const handleEditModalSave = async (selectedStepIndex: number, feedback: string) => {
    glowLogger.info('[PlanView] Edit saved', { selectedStepIndex, feedback });
    setShowEditModal(false);
    setEditInitialStepIndex(undefined);
    try {
      const profile = await getRemoteUserProfileLoggedInUser();
      if (profile?.onboardingProfile?.actionPlan) {
        setLocalActionPlan(profile.onboardingProfile.actionPlan);
      }
    } catch (error) {
      glowLogger.error('[PlanView] Error reloading plan after edit', { error });
    }
    handleStepPress(selectedStepIndex);
  };

  const getCurrentStep = (): ActionStep | undefined => {
    if (!selectedStep || !localActionPlan) return undefined;
    return localActionPlan.steps[selectedStep.stepIndex];
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleModalClose}
    >
      <Animated.View style={{ flex: 1, flexDirection: 'row' }}>
        {/* Main Screen */}
        <Animated.View 
          style={{
            width: screenWidth,
            transform: [{ translateX: slideAnim }]
          }}
          pointerEvents={currentScreen === 'main' ? 'auto' : 'none'}
        >
          <PlanMainScreen
            userProfile={userProfile}
            onClose={handleModalClose}
            onStepPress={handleStepPress}
            nutritionSurveyCompleted={nutritionSurveyDone}
            recoverySurveyCompleted={recoverySurveyDone}
            onStartSurvey={handleStartSurvey}
          />
        </Animated.View>

        {/* Details Screen */}
        <Animated.View 
          style={{
            width: screenWidth,
            transform: [{ translateX: slideAnim }]
          }}
          pointerEvents={currentScreen === 'details' ? 'auto' : 'none'}
        >
          <PlanDetailsScreen 
            step={getCurrentStep()}
            stepIndex={selectedStep?.stepIndex}
            actionPlan={localActionPlan}
            onBack={handleBackToMain}
            onSchedulePress={handleSchedulePress}
            onScheduleChange={handleScheduleChange}
            onScheduleSave={handleScheduleSave}
            isEditable={true}
            userProfile={userProfile}
            onStartSurvey={handleStartSurvey}
            nutritionSurveyCompleted={nutritionSurveyDone}
            recoverySurveyCompleted={recoverySurveyDone}
            onEditStep={handleEditStep}
          />
        </Animated.View>

        {/* Schedule Screen */}
        <Animated.View 
          style={{
            width: screenWidth,
            transform: [{ translateX: slideAnim }]
          }}
          pointerEvents={currentScreen === 'schedule' ? 'auto' : 'none'}
        >
          <ScheduleScreen 
            step={getCurrentStep()}
            onBack={handleBackToDetails}
            onScheduleChange={handleScheduleChange}
            onScheduleSave={handleScheduleSave}
          />
        </Animated.View>
      </Animated.View>

      <SurveyFlowModal
        visible={surveyModalVisible}
        surveyType={activeSurveyType}
        userProfile={userProfile}
        onComplete={handleSurveyComplete}
        onClose={() => setSurveyModalVisible(false)}
      />

      <EditPlanModal
        visible={showEditModal}
        userProfile={userProfile}
        onClose={handleEditModalClose}
        onSave={handleEditModalSave}
        initialStepIndex={editInitialStepIndex}
      />
    </Modal>
  );
};
