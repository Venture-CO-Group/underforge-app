import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import onboardingConfigV2 from '../assets/onboarding_config';
import { glowLogger } from '../lib/glow-logger';
import { CoachData, getCoaches } from '../lib/supabase_db_new';
import { CoachType, Onboard } from '../types/onboard';
import { OnboardingConfig } from '../types/onboarding_config';
import { ActionPlanReview } from './ActionPlanReview';
import { AskClarifyingCoachQuestion } from './AskClarifyingCoachQuestion';
import { AskUserName } from './AskUserName';
import { ChooseCoach } from './ChooseCoach';
import { ChooseGoal } from './ChooseGoal';
import { ChooseMotivation } from './ChooseMotivation';
import { ChoosePlanAndPricing } from './ChoosePlanAndPricing';
import { Disclaimer } from './Disclaimer';
import { GeneratingHypothesis } from './GeneratingHypothesis';
import { GeneratingPlan } from './GeneratingPlan';
import OnboardOverviewInfo from './OnboardOverviewInfo';
import OnboardingIntroScreen from './OnboardingIntroScreen';
import { DEBUG_TEST_NAME, DEBUG_TEST_NAME_FAKE_LLM, OnboardingSequenceState, OnboardingSequenceV2 } from './OnboardingSequenceV2';
import { PlanAccepted } from './PlanAccepted';
import { PlanHypothesis } from './PlanHypothesis';
import { RevisePlan } from './RevisePlan';

export type SpecialCodeFlow =
  | { type: 'coach'; coachId: number; coachDisplayName: string; code: string }
  | { type: 'event'; code: string }
  | { type: 'promo'; code: string };

interface OnboardingModalV2Props {
  visible: boolean;
  onComplete: (data: Onboard) => void;
  onBack?: () => void; // Optional back to intro video
  specialCodeFlow?: SpecialCodeFlow | null;
}

export default function OnboardingModalV2({ visible, onComplete, onBack, specialCodeFlow }: OnboardingModalV2Props) {
  const [sequenceState, setSequenceState] = useState<OnboardingSequenceState | null>(null);
  const [sequence, setSequence] = useState<OnboardingSequenceV2 | null>(null);
  const [dbCoaches, setDbCoaches] = useState<CoachData[]>([]);
  const appliedSpecialCoachRef = useRef(false);

  // Use the v2 config directly
  const config = onboardingConfigV2 as unknown as OnboardingConfig;

  // Load coaches from database when modal becomes visible
  useEffect(() => {
    if (visible) {
      const loadCoaches = async () => {
        glowLogger.info('Loading coaches from database for onboarding', {});
        const coaches = await getCoaches();
        setDbCoaches(coaches);
        glowLogger.info('Coaches loaded for onboarding', { 
          coach_count: coaches.length,
          coaches: coaches.map(c => ({ id: c.id, full_name: c.full_name }))
        });
      };
      loadCoaches();
    }
  }, [visible]);

  // Pre-assign coach when entering onboarding via coach special code
  useEffect(() => {
    if (
      !visible ||
      !sequence ||
      specialCodeFlow?.type !== 'coach' ||
      appliedSpecialCoachRef.current ||
      dbCoaches.length === 0
    ) {
      return;
    }

    const dbCoach = dbCoaches.find((c) => c.id === specialCodeFlow.coachId);
    if (!dbCoach) {
      glowLogger.warn('Special code coach not found in database', {
        coach_id: String(specialCodeFlow.coachId),
      });
      return;
    }

    sequence.updateData({
      coachId: specialCodeFlow.coachId,
      selectedCoach: specialCodeFlow.coachDisplayName,
      selectedCoachType: dbCoach.coach_type,
    });
    appliedSpecialCoachRef.current = true;
    glowLogger.info('Pre-assigned coach from special code', {
      coach_id: String(specialCodeFlow.coachId),
      display_name: specialCodeFlow.coachDisplayName,
    });
  }, [visible, sequence, specialCodeFlow, dbCoaches]);

  useEffect(() => {
    if (visible) {
      appliedSpecialCoachRef.current = false;
      const newSequence = new OnboardingSequenceV2(
        (state) => {
          glowLogger.info('State change callback triggered', { new_state: JSON.stringify(state) });
          setSequenceState({ ...state }); // Force a new object reference
        },
        () => {
          glowLogger.info('wizard finished', {});
          // TODO: Keep user on final screen for now, don't close modal yet
        }
      );
      setSequence(newSequence);
      setSequenceState(newSequence.getState());
    }
  }, [visible]);

  // Add useEffect to track sequenceState changes
  useEffect(() => {
    glowLogger.info('sequenceState useEffect triggered', { 
      sequenceState: JSON.stringify(sequenceState) 
    });
  }, [sequenceState]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const onHardwareBack = () => {
      if (!sequence) {
        return true;
      }
      if (sequence.canGoPrevious()) {
        sequence.goPrevious();
        return true;
      }
      if (onBack) {
        onBack();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [visible, sequence, onBack, sequenceState?.currentStepIndex]);

  const handleOverviewNext = () => {
    sequence?.goNext();
  };

  const handleCoachSelect = (coachId: number, displayName: string) => {
    glowLogger.info('handleCoachSelect called', { 
      coach_id: String(coachId),
      display_name: displayName,
      has_sequence: !!sequence
    });
    
    if (!sequence) {
      glowLogger.warn('handleCoachSelect: sequence is null, cannot update data', {
        coach_id: String(coachId),
        display_name: displayName
      });
      return;
    }
    
    // Coach ID is already known from the database - store it directly.
    // Also persist the coach's classification (ai_only vs ai_human_hybrid) so
    // the saved onboarding profile reflects the selected coach's capabilities.
    const dbCoach = dbCoaches.find(c => c.id === coachId);
    const coachType = dbCoach?.coach_type ?? CoachType.AI_ONLY;
    sequence.updateData({ selectedCoach: displayName, coachId: coachId, selectedCoachType: coachType });
    glowLogger.info('Coach selected and stored', {
      selected_coach: displayName,
      coach_id: String(coachId),
      coach_type: coachType
    });
  };

  const handleCoachNext = () => {
    glowLogger.info('handleCoachNext', { 
      current_sequence_state: JSON.stringify(sequenceState) 
    });
    sequence?.goNext();
  };

  const handleUserNamePrevious = () => {
    sequence?.goPrevious();
  };

  const handleUserNameChange = (name: string) => {
    sequence?.updateData({ userName: name });
    // Update GlowLogger immediately when user name changes during onboarding
    // Note: We don't have the final local user ID yet, so we pass a placeholder
    if (name && name.trim()) {
      glowLogger.setUserIdentifier(name.trim(), 'onboarding_in_progress');
      glowLogger.info('GlowLogger updated during onboarding', {
        user_display_name: name.trim(),
        local_user_id: 'onboarding_in_progress'
      });
    }
  };

  const handleUserNameNext = async () => {
    // Check for debug test names
    const currentName = sequenceState?.userName?.trim();
    if (currentName === DEBUG_TEST_NAME && sequence) {
      glowLogger.info('Debug test name detected, activating debug mode', { name: currentName });
      await sequence.activateDebugMode();
      return;
    }
    if (currentName === DEBUG_TEST_NAME_FAKE_LLM && sequence) {
      glowLogger.info('Debug test name (fake LLM) detected, activating debug mode with fake data', { name: currentName });
      await sequence.activateDebugMode(true); // preserveName=true to keep **/_Test_/** for fake LLM checks
      return;
    }
    sequence?.goNext();
  };

  const handleGenderAnswerChange = (answer: string) => {
    sequence?.setQuestionAnswer('gender_question', answer);
  };

  const handleGenderNext = () => {
    sequence?.goNext();
  };

  const handleGoalSelect = (goal: string, isCustom?: boolean) => {
    glowLogger.info('handleGoalSelect', { 
      selected_goal: goal, 
      is_custom: isCustom 
    });
    sequence?.updateData({ selectedGoal: goal });
  };

  const handleCustomGoalChange = (customGoal: string) => {
    sequence?.updateData({ selectedGoal: customGoal });
  };

  const handleImprovementGoalNext = () => {
    sequence?.goNext();
  };

  const handleSecondaryGoalSelect = (goal: string | string[], isCustom?: boolean) => {
    glowLogger.info('handleSecondaryGoalSelect', { 
      selected_secondary_goal: goal, 
      is_custom: isCustom 
    });
    sequence?.updateData({ selectedSecondaryGoal: goal });
  };

  const handleCustomSecondaryGoalChange = (customGoal: string) => {
    // For secondary goals, always store as array for consistency with multi-select
    sequence?.updateData({ selectedSecondaryGoal: [customGoal] });
  };

  const handleGoalPrevious = () => {
    sequence?.goPrevious();
  };

  const handleSecondaryGoalNext = () => {
    sequence?.goNext();
  };

  const handleMotivationPrevious = () => {
    sequence?.goPrevious();
  };

  const handleDisclaimerUpdate = (disclaimerData: { conditionsUnderstood: boolean; ageConfirmed: boolean; privacyPolicyAccepted: boolean }) => {
    sequence?.updateData({ disclaimerAccepted: disclaimerData });
  };

  const handleDisclaimerNext = () => {
    // Move to motivation step
    sequence?.goNext();
  };

  const handleMotivationLevelChange = (level: number) => {
    sequence?.updateData({ motivationLevel: level });
  };

  const handleMotivationWhyChange = (why: string) => {
    sequence?.updateData({ motivationWhy: why });
  };

  const handleMotivationNext = async () => {
    // Motivation is the last static step — start clarifying questions now
    await sequence?.startClarifyingQuestions();
    sequence?.goNext();
  };

  const handleCoachTypeSelect = (coachType: CoachType) => {
    glowLogger.info('handleCoachTypeSelect', { 
      selected_coach_type: coachType 
    });
    sequence?.updateData({ selectedCoachType: coachType });
  };

  const handleCoachTypeNext = () => {
    // Move to instructions screen after coach type selection
    sequence?.goNext();
  };

  const handleInstructionsNext = () => {
    // Intro screen now comes before questions — just advance
    sequence?.goNext();
  };

  const handleClarifyingAnswerChange = (answer: string) => {
    sequence?.updateClarifyingAnswer(answer);
  };

  const handleClarifyingQuestionNext = () => {
    sequence?.goNext();
  };

  const handleClarifyingQuestionPrevious = () => {
    sequence?.goPrevious();
  };

  const handleClarifyingQuestionEarlyTermination = () => {
    glowLogger.info('handleClarifyingQuestionEarlyTermination', {});
    sequence?.handleEarlyTermination();
  };

  const handleRevisePlan = () => {
    sequence?.goToRevisePlanMode();
  };

  const handleRevisionRequestChange = (text: string) => {
    sequence?.updateRevisionRequest(text);
  };

  const handleRevisionStepIndexChange = (stepIndex?: number) => {
    sequence?.updateRevisionStepIndex(stepIndex);
  };

  const handleRevisionSubmit = () => {
    sequence?.submitRevision();
  };

  const handleCancelRevision = () => {
    sequence?.goPrevious();
  };

  const handleAcceptPlan = () => {
    // Check if there's an error state - if so, retry plan generation
    if (sequenceState.hasGenerationError) {
      glowLogger.info('Retrying plan generation after error', {
        error: sequenceState.planGenerationError
      });
      
      // Directly retry without showing alert since error screen already shows error details
      sequence?.retryPlanGeneration();
      return;
    }
    
    // Normal flow - go to plan accepted screen
    glowLogger.info('Plan accepted, showing acceptance screen');
    sequence?.goToPlanAcceptedMode();
  };

  const handleHypothesisNext = (userAssessment?: string) => {
    if (userAssessment) {
      sequence?.updateHypothesisWithUserAssessment(userAssessment);
    }
    sequence?.startPlanGeneration();
  };

  const handleActionPlanUpdate = (updatedActionPlan: any) => {
    // Update the onboarding sequence state with the modified action plan
    glowLogger.info('Action plan updated during onboarding', {
      updated_action_plan: JSON.stringify(updatedActionPlan)
    });
    
    // Use the sequence method to update the generated plan
    sequence?.updateGeneratedPlan(updatedActionPlan);
  };

  const handleStartChatting = async () => {
    // Complete onboarding and pass data to parent
    glowLogger.info('Starting chat', {});
    
    try {
      // Extract user name with proper fallback
      const userName = sequenceState?.userName || 'User';
      glowLogger.info('Extracted user name', { user_name: userName });
      
      if (!userName || userName.trim() === '') {
        glowLogger.error('No valid user name found in sequence state', { sequence_state: sequenceState });
        throw new Error('User name is required but not found in onboarding data');
      }
      
      // Get the properly filtered clarifying questions from the sequence
      const filteredClarifyingQuestions = sequence?.getFilteredClarifyingQuestions() || [];

      // Gender is collected in the `ask_gender` step and lives in answeredQuestions,
      // NOT in the LLM-generated clarifyingQuestions. Without this, it never reaches
      // onboarding_profile_json and every consumer (muscle map, plan images, nutrition
      // targets) falls back to a default gender. Surface it into the persisted data.
      const genderAnswer = sequenceState?.answeredQuestions?.['gender_question'] || '';
      if (genderAnswer && !filteredClarifyingQuestions.some(q => q.question === 'gender_question')) {
        filteredClarifyingQuestions.unshift({
          id: 'gender_question',
          question: 'gender_question',
          answer: String(genderAnswer),
        });
      }

      glowLogger.info('Filtered clarifying questions for saving', {
        filtered_questions: JSON.stringify(filteredClarifyingQuestions),
        questions_count: filteredClarifyingQuestions.length
      });
      
      // Convert stored hypothesis to Hypothesis interface if available
      let hypothesis: import('../types/onboard').Hypothesis | undefined;
      if (sequenceState?.generatedHypothesis) {
        hypothesis = {
          ...sequenceState.generatedHypothesis,
          toLLMString: () => import('../types/onboard').hypothesisToLLMString(sequenceState.generatedHypothesis!)
        };
      }

      // Construct complete onboarding data without localUserId (will be added by callback)
      glowLogger.info('=== ONBOARDING COMPLETE DEBUG ===', {
        sequence_state_coach: sequenceState?.selectedCoach || 'none',
        sequence_state_coach_id: String(sequenceState?.coachId ?? 'undefined')
      });
      
      const completeOnboardingData: Onboard = {
        selectedCoach: sequenceState?.selectedCoach || '',
        coachId: sequenceState?.coachId, // Include database coach ID if available
        coach_type: sequenceState?.selectedCoachType || CoachType.AI_ONLY,
        name: userName.trim(),
        selectedModules: [sequenceState?.selectedGoal || ''],
        selectedGoal: sequenceState?.selectedGoal || '',
        selectedSecondaryGoal: Array.isArray(sequenceState?.selectedSecondaryGoal) 
          ? sequenceState.selectedSecondaryGoal.join(', ')
          : (sequenceState?.selectedSecondaryGoal || ''),
        motivationLevel: sequenceState?.motivationLevel || 5,
        motivationWhy: sequenceState?.motivationWhy || '',
        time_available: sequenceState?.answeredQuestions?.['current_time_available'] || '',
        expertise_level: sequence?.extractExpertiseLevelFromAnswers() || '',
        gender: genderAnswer ? String(genderAnswer) : undefined,
        clarifyingQuestions: filteredClarifyingQuestions,
        actionPlan: sequenceState?.generatedPlan?.actionPlan,
        hypothesis: hypothesis,
        chronic_illnesses: ['None'],
        medications: ['None'],
        supplements: ['None'],
        allergies: ['None'],
        moduleData: {},
        toLLMString: () => 'Completed onboarding data'
      };
      
      glowLogger.info('Complete onboarding data constructed', { 
        complete_onboarding_data: JSON.stringify(completeOnboardingData),
        clarifying_questions_count: completeOnboardingData.clarifyingQuestions.length
      });
      
      // Pass data to callback handler which will handle database operations
      onComplete(completeOnboardingData);
      
    } catch (error) {
      glowLogger.error('Error saving user to local database', { error });
      throw error;
    }
  };

  const renderCurrentStep = () => {
    glowLogger.info('renderCurrentStep', { 
      sequenceState: JSON.stringify(sequenceState),
      sequence: !!sequence 
    });
    
    if (!sequenceState || !sequence) {
      glowLogger.info('No sequenceState or sequence, returning loading view', {});
      return <View style={styles.container} />;
    }

    const currentStep = sequence.getCurrentStep();
    glowLogger.info('Current step from sequence', { current_step: currentStep?.component });
    
    if (!currentStep) {
      glowLogger.info('No current step, wizard complete', {});
      return (
        <View style={styles.container}>
          <Text style={styles.text}>Wizard Complete!</Text>
        </View>
      );
    }

    glowLogger.info('Rendering step component', { 
      component: currentStep.component,
      step_index: sequenceState.currentStepIndex 
    });
    
    switch (currentStep.component) {
      case 'overview':
        glowLogger.info('Rendering OnboardOverviewInfo', {});
        // Create minimal onboarding data for the overview screen
        const overviewOnboardingData: Onboard = {
          selectedCoach: sequenceState?.selectedCoach || '',
          coach_type: sequenceState?.selectedCoachType || 'AI_ONLY' as any,
          name: sequenceState?.userName || 'Guest User',
          selectedModules: [],
          selectedGoal: '',
          selectedSecondaryGoal: '',
          motivationLevel: 5,
          motivationWhy: '',
          time_available: '',
          expertise_level: '',
          clarifyingQuestions: [],
          actionPlan: undefined,
          chronic_illnesses: [],
          medications: [],
          supplements: [],
          allergies: [],
          moduleData: {},
          localUserId: 'onboarding-overview',
          toLLMString: () => 'Overview screen'
        };
        return (
          <OnboardOverviewInfo 
            onGetStarted={handleOverviewNext}
            onBack={onBack}
            onboardingData={overviewOnboardingData}
            currentUserProfile={null}
            assignedCoach={
              specialCodeFlow?.type === 'coach'
                ? { coachId: specialCodeFlow.coachId, displayName: specialCodeFlow.coachDisplayName }
                : undefined
            }
          />
        );
      case 'choose_coach':
        glowLogger.info('Rendering ChooseCoach', { 
          selected_coach: sequenceState.selectedCoach,
          selected_coach_id: sequenceState.coachId,
          db_coaches_count: dbCoaches.length
        });
        return (
          <ChooseCoach
            config={config}
            dbCoaches={dbCoaches}
            selectedCoachId={sequenceState.coachId}
            lockedCoachId={specialCodeFlow?.type === 'coach' ? specialCodeFlow.coachId : undefined}
            onCoachSelect={handleCoachSelect}
            onNext={handleCoachNext}
          />
        );
      case 'ask_user_name':
        glowLogger.info('Rendering AskUserName', { 
          selected_coach: sequenceState.selectedCoach, 
          user_name: sequenceState.userName 
        });
        return (
          <AskUserName
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            userName={sequenceState.userName}
            onUserNameChange={handleUserNameChange}
            onNext={handleUserNameNext}
            onPrevious={handleUserNamePrevious}
          />
        );
      case 'ask_gender':
        glowLogger.info('Rendering ask_gender step', {});
        const genderQuestionConfig = config.question_bank?.['gender_question'];
        if (!genderQuestionConfig) {
          glowLogger.warn('gender_question config not found, skipping', {});
          setTimeout(() => sequence?.goNext(), 0);
          return <View style={styles.container} />;
        }
        return (
          <AskClarifyingCoachQuestion
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            questionKey="gender_question"
            questionConfig={genderQuestionConfig}
            userAnswer={sequenceState.answeredQuestions?.['gender_question'] || ''}
            questionNumber={0}
            totalQuestions={0}
            hideSectionNavigator={false}
            onAnswerChange={handleGenderAnswerChange}
            onNext={handleGenderNext}
            onPrevious={() => sequence?.goPrevious()}
            canGoBack={true}
          />
        );
      case 'choose_improvement_goal':
        glowLogger.info('Rendering ChooseGoal (primary)', { 
          selected_coach: sequenceState.selectedCoach, 
          selected_goal: sequenceState.selectedGoal 
        });
        return (
          <ChooseGoal
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            selectedGoal={sequenceState.selectedGoal}
            customGoal={sequenceState.selectedGoal}
            customGoalPlaceholder="e.g., I want to be a bouldering God"
            userName={sequenceState.userName}
            userGender={sequenceState.answeredQuestions?.['gender_question']}
            goalType="primary"
            onGoalSelect={handleGoalSelect}
            onCustomGoalChange={handleCustomGoalChange}
            onNext={handleImprovementGoalNext}
            onPrevious={handleGoalPrevious}
          />
        );
      case 'choose_secondary_goal':
        glowLogger.info('Rendering ChooseGoal (secondary)', { 
          selected_coach: sequenceState.selectedCoach, 
          selected_secondary_goal: sequenceState.selectedSecondaryGoal 
        });
        return (
          <ChooseGoal
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            selectedGoal={sequenceState.selectedSecondaryGoal}
            customGoal={Array.isArray(sequenceState.selectedSecondaryGoal) 
              ? sequenceState.selectedSecondaryGoal.join(', ') 
              : (sequenceState.selectedSecondaryGoal || '')
            }
            customGoalPlaceholder="e.g., Better work-life balance"
            userName={sequenceState.userName}
            goalType="secondary"
            chosenPrimaryGoal={sequenceState.selectedGoal}
            onGoalSelect={handleSecondaryGoalSelect}
            onCustomGoalChange={handleCustomSecondaryGoalChange}
            onNext={handleSecondaryGoalNext}
            onPrevious={handleGoalPrevious}
          />
        );
      case 'disclaimer':
        glowLogger.info('Rendering Disclaimer', { 
          selected_coach: sequenceState.selectedCoach,
          disclaimer_accepted: sequenceState.disclaimerAccepted
        });
        return (
          <Disclaimer
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            disclaimerAccepted={sequenceState.disclaimerAccepted}
            onDisclaimerUpdate={handleDisclaimerUpdate}
            onNext={handleDisclaimerNext}
          />
        );
      case 'choose_motivation':
        glowLogger.info('Rendering ChooseMotivation', { 
          selected_coach: sequenceState.selectedCoach,
          selected_primary_goal: sequenceState.selectedGoal,
          motivation_level: sequenceState.motivationLevel,
          motivation_why: sequenceState.motivationWhy
        });
        return (
          <ChooseMotivation
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            selectedPrimaryGoal={sequenceState.selectedGoal}
            userName={sequenceState.userName}
            motivationLevel={sequenceState.motivationLevel}
            motivationWhy={sequenceState.motivationWhy}
            onMotivationLevelChange={handleMotivationLevelChange}
            onMotivationWhyChange={handleMotivationWhyChange}
            onNext={handleMotivationNext}
            onPrevious={handleMotivationPrevious}
          />
        );
      case 'choose_plan_and_pricing':
        glowLogger.info('Rendering ChoosePlanAndPricing', { 
          selected_coach: sequenceState.selectedCoach,
          selected_coach_type: sequenceState.selectedCoachType
        });
        return (
          <ChoosePlanAndPricing
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            userName={sequenceState.userName}
            selectedCoachType={sequenceState.selectedCoachType}
            onCoachTypeSelect={handleCoachTypeSelect}
            onNext={handleCoachTypeNext}
          />
        );
      case 'onboarding_instructions':
        // This step has been removed; fall through to intro if present
        glowLogger.info('onboarding_instructions step removed; skipping', {});
        // Start clarifying questions if sequence exists
        setTimeout(() => {
          handleInstructionsNext();
        }, 0);
        return <View style={styles.container} />;
      case 'onboarding_intro':
        glowLogger.info('Rendering OnboardingIntroScreen', {
          selectedCoach: sequenceState?.selectedCoach
        });
        return (
          <OnboardingIntroScreen
            selectedCoach={sequenceState?.selectedCoach}
            onNext={handleInstructionsNext}
            onPrevious={() => sequence?.goPrevious()}
          />
        );
      case 'generating_hypothesis':
        glowLogger.info('Rendering GeneratingHypothesis', {});
        return (
          <GeneratingHypothesis
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            selectedGoal={sequenceState.selectedGoal}
            userGender={sequenceState.answeredQuestions?.['gender_question']?.toLowerCase()}
          />
        );
      case 'ask_clarifying_coach_question':
        glowLogger.info('Rendering AskClarifyingCoachQuestion (predefined)', {
          current_clarifying_question_index: sequenceState.currentClarifyingQuestionIndex,
          clarifying_questions_array: JSON.stringify(sequenceState.clarifyingQuestions)
        });
        const questionKey = sequence?.getCurrentPredefinedQuestionKey() || '';
        // Uses the improved getCurrentPredefinedQuestionConfig() method which now leverages 
        // the generic resolveQuestionsFromKeys() method and cached config loading
        const questionConfig = sequence?.getCurrentPredefinedQuestionConfig();
        glowLogger.info('Current predefined question config', { 
          question_key: questionKey,
          question_config: JSON.stringify(questionConfig)
        });
        
        // If question config is missing, skip this question automatically
        if (!questionConfig) {
          glowLogger.info('Question config missing, auto-skipping question', {
            question_key: questionKey,
            question_index: sequenceState.currentClarifyingQuestionIndex
          });
          
          // Use setTimeout to avoid state change during render
          setTimeout(() => {
            if (sequence) {
              sequence.skipCurrentQuestion();
            }
          }, 0);
          
          // Show a loading state while skipping
          return (
            <View style={styles.container}>
              <Text style={styles.text}>Skipping question...</Text>
            </View>
          );
        }
        
        return (
          <AskClarifyingCoachQuestion
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            questionKey={questionKey}
            questionConfig={questionConfig}
            userAnswer={sequence?.getCurrentClarifyingAnswer() || (questionConfig?.ui_widget === 'multi_select' || questionConfig?.ui_widget === 'body_map' || questionConfig?.ui_widget === 'body_map_focus' ? [] : '')}
            questionNumber={(sequence?.getCurrentQuestionIndex() ?? sequenceState.currentClarifyingQuestionIndex) + 1}
            totalQuestions={sequenceState.clarifyingQuestions.length}
            onAnswerChange={handleClarifyingAnswerChange}
            onNext={handleClarifyingQuestionNext}
            onPrevious={handleClarifyingQuestionPrevious}
            canGoBack={sequence?.canGoToPreviousQuestion() || sequence?.canGoPrevious() || false}
            userGender={sequenceState.answeredQuestions?.['gender_question'] || ''}
          />
        );
      case 'generating_plan':
      case 'regenerating_plan':
        glowLogger.info('Rendering GeneratingPlan', {});
        return (
          <GeneratingPlan
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            selectedGoal={sequenceState.selectedGoal}
            isRegeneration={currentStep?.component === 'regenerating_plan'}
            userGender={sequenceState.answeredQuestions?.['gender_question']?.toLowerCase()}
          />
        );
      case 'action_plan_review': {
        glowLogger.info('Rendering ActionPlanReview', {});
        if (!sequenceState.generatedPlan && !sequenceState.hasGenerationError) {
          glowLogger.info('No generated plan available and no error state', {});
          return (
            <View style={styles.container}>
              <Text style={styles.text}>No plan available</Text>
            </View>
          );
        }
        
        // If there's an error but no plan, create a dummy plan for the UI
        const actionPlanToShow = sequenceState.generatedPlan?.actionPlan || {
          id: 'error_placeholder',
          title: 'Plan Generation Failed',
          overview: 'There was an error generating your plan. Please try again.',
          steps: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        const reviewOnboardData: Onboard = {
          selectedCoach: sequenceState?.selectedCoach || '',
          coach_type: sequenceState?.selectedCoachType || CoachType.AI_ONLY,
          name: sequenceState?.userName || '',
          selectedModules: [sequenceState?.selectedGoal || ''],
          selectedGoal: sequenceState?.selectedGoal || '',
          selectedSecondaryGoal: Array.isArray(sequenceState?.selectedSecondaryGoal)
            ? sequenceState.selectedSecondaryGoal.join(', ')
            : (sequenceState?.selectedSecondaryGoal || ''),
          motivationLevel: sequenceState?.motivationLevel || 5,
          motivationWhy: sequenceState?.motivationWhy || '',
          time_available: sequenceState?.answeredQuestions?.['current_time_available'] || '',
          expertise_level: sequence?.extractExpertiseLevelFromAnswers() || '',
          clarifyingQuestions: sequence?.getFilteredClarifyingQuestions() || [],
          chronic_illnesses: ['None'],
          medications: ['None'],
          supplements: ['None'],
          allergies: ['None'],
          moduleData: {},
          toLLMString: () => 'Onboarding data for plan review',
        };

        return (
          <ActionPlanReview
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            actionPlan={actionPlanToShow}
            onRevisePlan={handleRevisePlan}
            onAcceptPlan={handleAcceptPlan}
            onActionPlanUpdate={handleActionPlanUpdate}
            userGender={sequenceState.answeredQuestions?.['gender_question']}
            selectedGoal={sequenceState.selectedGoal}
            onboardData={reviewOnboardData}
            hasGenerationError={sequenceState.hasGenerationError}
            planGenerationError={sequenceState.planGenerationError}
          />
        );
      }
      case 'revise_plan':
        glowLogger.info('Rendering RevisePlan', {});
        return (
          <RevisePlan
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            revisionRequest={sequenceState.revisionRequest || ''}
            selectedStepIndex={sequenceState.selectedRevisionStepIndex}
            onRevisionRequestChange={handleRevisionRequestChange}
            onRevisionStepIndexChange={handleRevisionStepIndexChange}
            onRevisionSubmit={handleRevisionSubmit}
            onCancel={handleCancelRevision}
          />
        );
      case 'plan_hypothesis':
        glowLogger.info('Rendering PlanHypothesis', {});
        const onboardingData: Onboard = {
          selectedCoach: sequenceState?.selectedCoach || '',
          coach_type: sequenceState?.selectedCoachType || CoachType.AI_ONLY,
          name: sequenceState?.userName || '',
          selectedModules: [sequenceState?.selectedGoal || ''],
          selectedGoal: sequenceState?.selectedGoal || '',
          selectedSecondaryGoal: Array.isArray(sequenceState?.selectedSecondaryGoal) 
            ? sequenceState.selectedSecondaryGoal.join(', ')
            : (sequenceState?.selectedSecondaryGoal || ''),
          motivationLevel: sequenceState?.motivationLevel || 5,
          motivationWhy: sequenceState?.motivationWhy || '',
          motivation_level: sequenceState?.motivationLevel || 5,
          motivation_why: sequenceState?.motivationWhy || '',
          time_available: sequenceState?.answeredQuestions?.['current_time_available'] || '',
          expertise_level: sequence?.extractExpertiseLevelFromAnswers() || '',
          clarifyingQuestions: sequence?.getFilteredClarifyingQuestions() || [],
          chronic_illnesses: ['None'],
          medications: ['None'],
          supplements: ['None'],
          allergies: ['None'],
          moduleData: {},
          toLLMString: () => 'Onboarding data for hypothesis generation'
        };
        return (
          <PlanHypothesis
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            userName={sequenceState.userName}
            hypothesis={sequenceState.generatedHypothesis || ''}
            hasHypothesisGenerationError={sequenceState.hasHypothesisGenerationError}
            hypothesisGenerationError={sequenceState.hypothesisGenerationError}
            onNext={handleHypothesisNext}
            onRetryHypothesis={() => sequence?.retryHypothesisGeneration()}
          />
        );
      case 'plan_accepted':
        glowLogger.info('Rendering PlanAccepted', {});
        return (
          <PlanAccepted
            config={config}
            selectedCoach={sequenceState.selectedCoach || ''}
            onStartChatting={handleStartChatting}
          />
        );
      default:
        glowLogger.info('Unknown step component', { component: currentStep.component });
        return (
          <View style={styles.container}>
            <Text style={styles.text}>Unknown step</Text>
          </View>
        );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
    >
      <SafeAreaProvider>
        <View style={styles.modalContainer}>
          {renderCurrentStep()}
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#0E0400',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0E0400',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F2F2EE',
  },
});