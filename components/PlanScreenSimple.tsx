import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';
import { glowLogger } from '../lib/glow-logger';
import { onboardingEvents } from '../lib/supabase_db';
import { getRemoteUserProfileLoggedInUser, updateUserProfile } from '../lib/supabase_db_new';
import { ActionPlan, ActionStep, CoachType, Onboard } from '../types/onboard';
import { DeviceType, UserProfile } from '../types/user_profile';
import { EditPlanModal } from './EditPlanModal';
import { PlanDetailsScreen } from './PlanDetailsScreen';
import { PlanMainScreen } from './PlanMainScreen';
import { PlanRemoteSyncBanner, PlanRemoteSyncStatus } from './PlanRemoteSyncBanner';
import { ScheduleScreen } from './ScheduleScreen';
import { SurveyFlowModal } from './SurveyFlowModal';

interface PlanScreenSimpleProps {
  onboardingData: Onboard;
  onStartSurvey?: (surveyType: 'nutrition' | 'recovery') => void;
  /** When set (e.g. after accepting plan edits from chat), opens that pillar's details screen. */
  openStepDetailsIndex?: number | null;
  onOpenStepDetailsConsumed?: () => void;
  /**
   * True while the Plan tab is the active tab. When the parent keeps this
   * component mounted across tab switches, every transition to `true`
   * triggers a fresh background sync with Supabase so coach edits show up.
   */
  isPlanTabFocused?: boolean;
}

// Build a minimal UserProfile from local onboarding data so the plan UI can
// render immediately without waiting on Supabase. The real profile replaces
// this object once the background sync succeeds.
const buildProvisionalUserProfile = (onboard: Onboard): UserProfile => ({
  user_id: onboard.localUserId ?? '',
  device_type: DeviceType.IOS_SIMULATOR,
  active: true,
  onboardingProfile: onboard,
});

const { width: screenWidth } = Dimensions.get('window');

export const PlanScreenSimple: React.FC<PlanScreenSimpleProps> = ({
  onboardingData,
  onStartSurvey,
  openStepDetailsIndex,
  onOpenStepDetailsConsumed,
  isPlanTabFocused = true,
}) => {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [localActionPlan, setLocalActionPlan] = useState<ActionPlan | undefined>(onboardingData.actionPlan);
  const [currentScreen, setCurrentScreen] = useState<'main' | 'details' | 'schedule'>('main');
  const [selectedStep, setSelectedStep] = useState<{ stepIndex: number; step: ActionStep } | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [surveyModalVisible, setSurveyModalVisible] = useState(false);
  const [activeSurveyType, setActiveSurveyType] = useState<'nutrition' | 'recovery'>('nutrition');
  const [nutritionSurveyDone, setNutritionSurveyDone] = useState(false);
  const [recoverySurveyDone, setRecoverySurveyDone] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editInitialStepIndex, setEditInitialStepIndex] = useState<number | undefined>(undefined);

  const [remoteSyncStatus, setRemoteSyncStatus] = useState<PlanRemoteSyncStatus>('idle');
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const isSyncingRef = useRef(false);

  const slideAnim = useRef(new Animated.Value(0)).current;

  // The plan UI always renders against a profile-shaped object so it never has
  // to wait for Supabase. Until the remote profile arrives we use a minimal
  // provisional copy built from the local onboarding data already in memory.
  const provisionalProfile = React.useMemo(
    () => buildProvisionalUserProfile(onboardingData),
    [onboardingData],
  );
  const displayProfile: UserProfile = userProfile ?? provisionalProfile;

  // Hybrid coaches can edit the user's plan from Supabase, so we surface a
  // small banner that announces the background check. AI-only users never see
  // it because nothing about their plan changes server-side between visits.
  const resolvedCoachType =
    userProfile?.onboardingProfile?.coach_type ?? onboardingData.coach_type;
  const isHybridCoach = resolvedCoachType === CoachType.AI_HUMAN_HYBRID;

  const handleStartSurvey = (surveyType: 'nutrition' | 'recovery') => {
    setActiveSurveyType(surveyType);
    setSurveyModalVisible(true);
  };

  const handleSurveyComplete = async () => {
    if (activeSurveyType === 'nutrition') setNutritionSurveyDone(true);
    else setRecoverySurveyDone(true);

    // Reload profile to pick up updated plan
    try {
      const profile = await getRemoteUserProfileLoggedInUser();
      if (profile) {
        setUserProfile(profile);
        setLocalActionPlan(profile.onboardingProfile?.actionPlan);
      }
    } catch (err) {
      glowLogger.error('[PlanScreenSimple] Error reloading profile after survey', { error: err });
    }
  };

  const syncRemotePlan = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    // The banner only matters for hybrid coaches; AI-only users sync silently.
    const showBanner = isHybridCoach;
    setBannerDismissed(false);
    if (showBanner) {
      setRemoteSyncStatus('checking');
    }

    try {
      const profile = await getRemoteUserProfileLoggedInUser();
      if (profile) {
        setUserProfile(profile);
        if (profile.onboardingProfile?.actionPlan) {
          setLocalActionPlan(profile.onboardingProfile.actionPlan);
        }
        setRemoteSyncStatus(showBanner ? 'success' : 'idle');
      } else {
        glowLogger.warn('[PlanScreenSimple] No remote profile returned during sync', {});
        setRemoteSyncStatus(showBanner ? 'failed' : 'idle');
      }
    } catch (err) {
      glowLogger.error('[PlanScreenSimple] Background plan sync failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      setRemoteSyncStatus(showBanner ? 'failed' : 'idle');
    } finally {
      isSyncingRef.current = false;
    }
  }, [isHybridCoach]);

  // Trigger a background sync whenever the Plan tab becomes focused. This
  // covers both the initial mount (default `isPlanTabFocused = true`) and
  // every time the user switches back into the tab when the parent keeps the
  // component mounted.
  useEffect(() => {
    if (!isPlanTabFocused) return;
    syncRemotePlan();
  }, [isPlanTabFocused, syncRemotePlan]);

  // Subscribe to onboarding data changes
  useEffect(() => {
    const handler = async (event: any) => {
      glowLogger.info('[PlanScreenSimple] onboardingDataChanged event received', { event });
      try {
        const userProfileData = await getRemoteUserProfileLoggedInUser();
        if (userProfileData?.onboardingProfile?.actionPlan) {
          setLocalActionPlan(userProfileData.onboardingProfile.actionPlan);
          setUserProfile(userProfileData);
          glowLogger.info('[PlanScreenSimple] Action plan reloaded successfully', {});
        }
      } catch (error) {
        glowLogger.error('[PlanScreenSimple] Error reloading action plan', { 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };
    
    onboardingEvents.on('onboardingDataChanged', handler);
    glowLogger.info('[PlanScreenSimple] Subscribed to onboardingDataChanged events', {});

    return () => {
      onboardingEvents.off('onboardingDataChanged', handler);
      glowLogger.info('[PlanScreenSimple] Unsubscribed from onboardingDataChanged events', {});
    };
  }, []);

  const openStepDetails = (stepIndex: number) => {
    if (!localActionPlan?.steps[stepIndex]) return;

    const step = localActionPlan.steps[stepIndex];
    setSelectedStep({ stepIndex, step });

    if (currentScreen === 'main') {
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
    } else {
      setCurrentScreen('details');
      slideAnim.setValue(-screenWidth);
    }
  };

  const handleStepPress = (stepIndex: number) => {
    if (isAnimating) return;
    openStepDetails(stepIndex);
  };

  useEffect(() => {
    if (openStepDetailsIndex == null || !localActionPlan) return;
    if (localActionPlan.steps[openStepDetailsIndex]) {
      openStepDetails(openStepDetailsIndex);
    }
    onOpenStepDetailsConsumed?.();
  }, [openStepDetailsIndex, localActionPlan]);

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

  const handleScheduleChange = (stepId: string, newDaysOfWeek: string[], newTimeOfDay?: string) => {
    glowLogger.info('Schedule changed for step', { 
      stepId, 
      newDays: newDaysOfWeek, 
      newTime: newTimeOfDay || 'none'
    });
  };

  const handleScheduleSave = async (stepId: string, selectedDays: string[], selectedTime?: string): Promise<void> => {
    try {
      glowLogger.info('handleScheduleSave', { 
        stepId, 
        newDays: selectedDays, 
        newTime: selectedTime || 'none'
      });

      const userProfileData = await getRemoteUserProfileLoggedInUser();
      if (!userProfileData?.onboardingProfile?.actionPlan) {
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

      glowLogger.info('handleScheduleSave new updatedOnboardingData', { 
        stepId, 
        updatedOnboardingData: JSON.stringify(updatedOnboardingData)
      });

      await updateUserProfile({
        user_id: userProfileData.onboardingProfile!.localUserId!,
        onboardingProfile: updatedOnboardingData
      });
    } catch (error) {
      glowLogger.error('Error saving schedule', { 
        error: error instanceof Error ? error.message : String(error)
      });
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
    glowLogger.info('[PlanScreenSimple] Edit saved', { selectedStepIndex, feedback });
    setShowEditModal(false);
    setEditInitialStepIndex(undefined);
    try {
      const profile = await getRemoteUserProfileLoggedInUser();
      if (profile) {
        setUserProfile(profile);
        const plan = profile.onboardingProfile?.actionPlan;
        if (plan) {
          setLocalActionPlan(plan);
          if (plan.steps[selectedStepIndex]) {
            setSelectedStep({ stepIndex: selectedStepIndex, step: plan.steps[selectedStepIndex] });
            setCurrentScreen('details');
            slideAnim.setValue(-screenWidth);
            return;
          }
        }
      }
    } catch (error) {
      glowLogger.error('[PlanScreenSimple] Error reloading plan after edit', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    openStepDetails(selectedStepIndex);
  };

  const getCurrentStep = (): ActionStep | undefined => {
    if (!selectedStep || !localActionPlan) return undefined;
    return localActionPlan.steps[selectedStep.stepIndex];
  };

  const showCoachCheckBanner =
    isHybridCoach && !bannerDismissed && remoteSyncStatus !== 'idle';

  return (
    <View style={styles.container}>
      {showCoachCheckBanner && (
        <PlanRemoteSyncBanner
          status={remoteSyncStatus as Exclude<PlanRemoteSyncStatus, 'idle'>}
          onRetry={syncRemotePlan}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

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
            userProfile={displayProfile}
            onClose={() => {}}
            onStepPress={handleStepPress}
            nutritionSurveyCompleted={nutritionSurveyDone}
            recoverySurveyCompleted={recoverySurveyDone}
            onStartSurvey={handleStartSurvey}
            embedded
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
            actionPlan={displayProfile.onboardingProfile?.actionPlan}
            onBack={handleBackToMain}
            onSchedulePress={handleSchedulePress}
            onScheduleChange={handleScheduleChange}
            isEditable={true}
            userProfile={displayProfile}
            onStartSurvey={handleStartSurvey}
            nutritionSurveyCompleted={nutritionSurveyDone}
            recoverySurveyCompleted={recoverySurveyDone}
            onEditStep={handleEditStep}
            embedded
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
            embedded
          />
        </Animated.View>
      </Animated.View>

      <SurveyFlowModal
        visible={surveyModalVisible}
        surveyType={activeSurveyType}
        userProfile={displayProfile}
        onComplete={handleSurveyComplete}
        onClose={() => setSurveyModalVisible(false)}
      />

      <EditPlanModal
        visible={showEditModal}
        userProfile={displayProfile}
        onClose={handleEditModalClose}
        onSave={handleEditModalSave}
        initialStepIndex={editInitialStepIndex}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
});

