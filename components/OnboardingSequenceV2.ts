import { glowLogger } from '../lib/glow-logger';
import { ActionPlanResponse, llmService } from '../lib/llm-service';
import { CoachType, Hypothesis, hypothesisToLLMString, Onboard } from '../types/onboard';
import { FormField, validateOnboardingConfig } from '../types/onboarding_config';
import { bodyPartIdsToLabels } from './BodyMapSelector';
import { cardioTriadToReadable, isCardioTriadComplete, parseCardioTriadAnswer } from './CardioTriadSelector';

// Load onboarding config once at module initialization
let onboardingConfig: any = null;
try {
  onboardingConfig = require('../assets/onboarding_config');
  try {
    glowLogger.info('Onboarding config loaded at module init', {
      question_bank_keys: Object.keys(onboardingConfig?.question_bank || {}).length,
    });
  } catch {
    console.log('[OnboardingSequenceV2] Onboarding config loaded at module init');
  }

  const validationResult = validateOnboardingConfig(onboardingConfig);
  if (!validationResult.isValid) {
    try {
      glowLogger.error('Onboarding config validation failed', {
        errors: validationResult.errors,
        missing_questions: validationResult.missingQuestions,
      });
    } catch {
      console.error('[OnboardingSequenceV2] Onboarding config validation failed', validationResult.errors);
    }
  } else {
    try {
      glowLogger.info('Onboarding config validation passed successfully');
    } catch {
      console.log('[OnboardingSequenceV2] Onboarding config validation passed successfully');
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    glowLogger.error('Failed to load onboarding config at module init', { error: message });
  } catch {
    console.error('[OnboardingSequenceV2] Failed to load onboarding config at module init', message);
  }
}

// Constants
export const DEBUG_TEST_NAME = '*/_Test_/*';
export const DEBUG_TEST_NAME_FAKE_LLM = '**/_Test_/**'; // Same as DEBUG_TEST_NAME but also uses fake LLM data

// Map primary goals to config keys
const primaryGoalMap: { [key: string]: string } = {
  'Burn body fat': 'burn_body_fat',
  'Build muscle mass': 'build_muscle_mass',
  'Increase strength': 'increase_strength',
  'Get challenged by my coach': 'get_challenged',
};

export interface OnboardingStep {
  id: string;
  component: 'overview' | 'choose_coach' | 'ask_user_name' | 'ask_gender' | 'choose_improvement_goal' | 'choose_secondary_goal' | 'disclaimer' | 'choose_motivation' | 'choose_plan_and_pricing' | 'onboarding_intro' | 'onboarding_instructions' | 'ask_clarifying_coach_question' | 'generating_hypothesis' | 'plan_hypothesis' | 'generating_plan' | 'regenerating_plan' | 'action_plan_review' | 'revise_plan' | 'plan_accepted';
  
  title?: string;
}

export interface OnboardingSequenceState {
  currentStepIndex: number;
  steps: OnboardingStep[];
  selectedCoach?: string;
  coachId?: number; // Database coach ID from coaches table
  userName?: string;
  selectedGoal?: string;
  selectedSecondaryGoal?: string;
  disclaimerAccepted?: {
    conditionsUnderstood: boolean;
    ageConfirmed: boolean;
    privacyPolicyAccepted: boolean;
  };
  motivationLevel?: number;
  motivationWhy?: string;
  selectedCoachType?: CoachType;
  // Legacy system - kept for compatibility during transition
  clarifyingQuestions: string[];
  clarifyingAnswers: string[];
  clarifyingPlaceholders: string[];
  currentClarifyingQuestionIndex: number;
  // New robust question tracking system
  answeredQuestions: Record<string, any>; // Maps question key -> answer value
  questionSequence: string[]; // Ordered list of question keys to present
  currentQuestionKey?: string; // Current question being answered
  isGeneratingPlan?: boolean; // Track when plan is being generated
  isGeneratingHypothesis?: boolean; // Track when hypothesis is being generated
  generatedHypothesis?: import('../lib/llm-service').HypothesisResponse; // Store the generated hypothesis
  generatedPlan?: ActionPlanResponse; // Store the generated plan
  revisionRequest?: string; // Store the revision request
  selectedRevisionStepIndex?: number; // Explicitly chosen plan step to revise
  planGenerationError?: string; // Store plan generation error message
  hypothesisGenerationError?: string; // Store hypothesis generation error message
  hasGenerationError?: boolean; // Flag to indicate if plan generation failed
  hasHypothesisGenerationError?: boolean; // Flag to indicate if hypothesis generation failed
  isComplete: boolean;
  isEarlyTermination?: boolean;
  terminatedAtQuestionIndex?: number;
}

export const defaultOnboardingSteps: OnboardingStep[] = [
  {
    id: 'overview',
    component: 'overview',
    title: 'Overview'
  },
  {
    id: 'choose_coach',
    component: 'choose_coach',
    title: 'Choose Your Coach'
  },
  // Intro shown before the first question so users know what's coming
  {
    id: 'onboarding_intro',
    component: 'onboarding_intro',
    title: 'Introduction'
  },
  {
    id: 'ask_user_name',
    component: 'ask_user_name',
    title: 'What\'s Your Name?'
  },
  {
    id: 'ask_gender',
    component: 'ask_gender',
    title: 'About You'
  },
  {
    id: 'choose_improvement_goal',
    component: 'choose_improvement_goal',
    title: 'Choose Your Goal'
  },
  // Note: choose_plan_and_pricing moved to after plan acceptance (added dynamically in goToPlanAcceptedMode)
  // Note: disclaimer is inserted dynamically before generating_hypothesis in addQuestionStepsToFlow()
  // Note: startClarifyingQuestions() is triggered when leaving choose_motivation (last static step)
  // Note: choose_secondary_goal is injected dynamically after the first clarifying question (quantitative goal)
  {
    id: 'choose_motivation',
    component: 'choose_motivation',
    title: 'Your Motivation'
  },
];

export class OnboardingSequenceV2 {
  private state: OnboardingSequenceState;
  private onStateChange: (state: OnboardingSequenceState) => void;
  private onComplete: () => void;

  constructor(
    onStateChange: (state: OnboardingSequenceState) => void,
    onComplete: () => void,
    customSteps?: OnboardingStep[]
  ) {
    this.state = {
      currentStepIndex: 0,
      steps: customSteps || defaultOnboardingSteps,
      clarifyingQuestions: [],
      clarifyingAnswers: [],
      clarifyingPlaceholders: [],
      currentClarifyingQuestionIndex: 0,
      // Initialize new question tracking system
      answeredQuestions: {},
      questionSequence: [],
      currentQuestionKey: undefined,
      isComplete: false,
      // Initialize hypothesis generation state
      isGeneratingHypothesis: false,
      generatedHypothesis: undefined,
      selectedRevisionStepIndex: undefined
    };
    this.onStateChange = onStateChange;
    this.onComplete = onComplete;
  }

  getCurrentStep(): OnboardingStep | null {
    if (this.state.currentStepIndex >= this.state.steps.length) {
      return null;
    }
    return this.state.steps[this.state.currentStepIndex];
  }

  getState(): OnboardingSequenceState {
    return { ...this.state };
  }

  private canGoNext(): boolean {
    const currentStep = this.getCurrentStep();
    glowLogger.info('=== canGoNext DEBUG ===', {});
    glowLogger.info('currentStep: ' + JSON.stringify(currentStep), {});
    glowLogger.info('state: ' + JSON.stringify(this.state), {});
    
    if (!currentStep) {
      glowLogger.info('No current step, returning false', {});
      return false;
    }

    // Add validation logic for each step
    switch (currentStep.component) {
      case 'overview':
        return true;
      case 'choose_coach':
        const hasCoach = !!this.state.selectedCoach;
        glowLogger.info('Choose coach step', {
          selected_coach: this.state.selectedCoach || 'none',
          coach_id: String(this.state.coachId ?? 'none'),
          has_coach: hasCoach
        });
        return hasCoach;
      case 'ask_user_name':
        const hasUserName = !!this.state.userName && this.state.userName.trim().length > 0;
        glowLogger.info('Ask user name step', { has_user_name: hasUserName });
        return hasUserName;
      case 'ask_gender':
        const hasGender = !!this.state.answeredQuestions?.['gender_question'];
        glowLogger.info('Ask gender step - hasGender: ' + hasGender, {});
        return hasGender;
      case 'choose_improvement_goal':
        const hasGoal = !!this.state.selectedGoal && this.state.selectedGoal.trim().length > 0;
        glowLogger.info('Choose improvement goal step - selectedGoal: ' + this.state.selectedGoal + ', hasGoal: ' + hasGoal, {});
        return hasGoal;
      case 'choose_secondary_goal':
        const hasSecondaryGoal = this.state.selectedSecondaryGoal;
        if (Array.isArray(hasSecondaryGoal)) {
          return hasSecondaryGoal.length > 0;
        } else if (typeof hasSecondaryGoal === 'string') {
          return hasSecondaryGoal.trim().length > 0;
        }
        return false;
      case 'disclaimer':
        const disclaimerAccepted = this.state.disclaimerAccepted;
        const hasDisclaimer = disclaimerAccepted?.conditionsUnderstood && disclaimerAccepted?.ageConfirmed && disclaimerAccepted?.privacyPolicyAccepted;
        glowLogger.info('Disclaimer step - disclaimerAccepted: ' + JSON.stringify(disclaimerAccepted) + ', hasDisclaimer: ' + hasDisclaimer, {});
        return !!hasDisclaimer;
      case 'choose_motivation':
        const hasMotivationWhy = !!this.state.motivationWhy && this.state.motivationWhy.trim().length > 0;
        glowLogger.info('Choose motivation step - motivationWhy: ' + this.state.motivationWhy + ', hasMotivationWhy: ' + hasMotivationWhy, {});
        return hasMotivationWhy;
      case 'choose_plan_and_pricing':
        const hasCoachType = !!this.state.selectedCoachType;
        glowLogger.info('Choose coach type step - selectedCoachType: ' + this.state.selectedCoachType + ', hasCoachType: ' + hasCoachType, {});
        return hasCoachType;
      case 'ask_clarifying_coach_question':
        const coachCurrentAnswer = this.getQuestionAnswer(this.state.currentQuestionKey!);
        const currentQuestionConfig = this.getCurrentPredefinedQuestionConfig();
        let hasCoachAnswer = false;
        
        // If question is optional, user can always proceed (skip)
        if (currentQuestionConfig?.optional) {
          glowLogger.info('Ask clarifying coach question step - question is optional, allowing proceed', {});
          return true;
        }
        
        if (coachCurrentAnswer !== undefined && coachCurrentAnswer !== null) {
          if (currentQuestionConfig?.ui_widget === 'cardio_triad') {
            hasCoachAnswer = isCardioTriadComplete(parseCardioTriadAnswer(coachCurrentAnswer));
          } else if (typeof coachCurrentAnswer === 'string') {
            hasCoachAnswer = coachCurrentAnswer.trim().length > 0;
          } else if (typeof coachCurrentAnswer === 'number') {
            hasCoachAnswer = true; // Numbers are always valid (sliders)
          } else if (Array.isArray(coachCurrentAnswer)) {
            if (currentQuestionConfig?.ui_widget === 'body_map') {
              hasCoachAnswer = true; // Empty array means "No pain" which is valid
            } else if (currentQuestionConfig?.ui_widget === 'body_map_focus') {
              hasCoachAnswer = coachCurrentAnswer.length > 0;
            } else {
              hasCoachAnswer = coachCurrentAnswer.length > 0; // Multi-select arrays
            }
          } else {
            hasCoachAnswer = !!coachCurrentAnswer; // Boolean or other truthy values
          }
        }
        
        // body_map: user hasn't interacted yet (answer is undefined), still allow proceeding
        // because the default state (no selection) means "no pain"
        if (!hasCoachAnswer && currentQuestionConfig?.ui_widget === 'body_map') {
          hasCoachAnswer = true;
        }
        
        glowLogger.info('Ask clarifying coach question step - hasAnswer: ' + hasCoachAnswer + ', answerType: ' + typeof coachCurrentAnswer, {});
        return hasCoachAnswer;
      default:
        glowLogger.info('Default case - returning true', {});
        return true;
    }
  }

  canGoPrevious(): boolean {
    return this.state.currentStepIndex > 0;
  }

  goNext(): void {
    glowLogger.info('=== goNext DEBUG ===', {});
    glowLogger.info('Current state before goNext: ' + JSON.stringify(this.state), {});
    
    if (!this.canGoNext()) {
      glowLogger.info('canGoNext returned false, aborting goNext', {});
      return;
    }

    const currentStep = this.getCurrentStep();
    
    // If moving from clarifying question, check for commands first
    if (currentStep?.component === 'ask_clarifying_coach_question') {
      const currentAnswer = this.getQuestionAnswer(this.state.currentQuestionKey!);
      
      // Check for /stop command for early termination
      if (typeof currentAnswer === 'string' && currentAnswer.trim().toLowerCase() === '/stop') {
        glowLogger.info('Early termination triggered by /stop command on next', {});
        this.handleEarlyTermination();
        return;
      }

      // After question 0 (quantitative goal), navigate to the secondary goal screen
      // if it is the very next step in the steps array.
      if (this.getCurrentQuestionIndex() === 0) {
        const nextStepCandidate = this.state.steps[this.state.currentStepIndex + 1];
        if (nextStepCandidate?.component === 'choose_secondary_goal') {
          this.state = { ...this.state, currentStepIndex: this.state.currentStepIndex + 1 };
          this.onStateChange(this.state);
          return;
        }
      }
      
      const hasNext = this.goToNextQuestion();
      if (hasNext) {
        // Update both indices for compatibility and correct step navigation
        const newQuestionIndex = this.getCurrentQuestionIndex();
        const newStepIndex = this.getStepIndexForQuestion(newQuestionIndex);
        this.state = {
          ...this.state,
          currentClarifyingQuestionIndex: newQuestionIndex,
          currentStepIndex: newStepIndex
        };
        this.onStateChange(this.state);
        return;
      }
      
      // No more questions - go to disclaimer first, then generating_hypothesis
      glowLogger.info('No more questions, jumping to disclaimer', {});
      const disclaimerIdx = this.state.steps.findIndex(step => step.component === 'disclaimer');
      if (disclaimerIdx !== -1) {
        this.state = { ...this.state, currentStepIndex: disclaimerIdx };
        this.onStateChange(this.state);
        return;
      }
      glowLogger.error('Could not find disclaimer step after questions', {});
    }

    // When leaving the secondary goal screen, advance currentQuestionKey to question 1
    // so the next clarifying question step renders the correct question.
    if (currentStep?.component === 'choose_secondary_goal') {
      const nextQuestionKey = this.state.questionSequence[1];
      if (nextQuestionKey) {
        const nextStepIndex = this.state.currentStepIndex + 1;
        this.state = {
          ...this.state,
          currentQuestionKey: nextQuestionKey,
          currentClarifyingQuestionIndex: 1,
          currentStepIndex: nextStepIndex
        };
        this.onStateChange(this.state);
        return;
      }
    }

    const nextIndex = this.state.currentStepIndex + 1;
    glowLogger.info('nextIndex: ' + nextIndex + ', total steps: ' + this.state.steps.length, {});
    
    if (nextIndex >= this.state.steps.length) {
      // Wizard is complete
      glowLogger.info('Wizard complete - reached end of steps', {});
      this.state = { ...this.state, isComplete: true };
      this.onStateChange(this.state);
      this.onComplete();
      return;
    }

    glowLogger.info('Moving to next step: ' + nextIndex, {});
    this.state = { ...this.state, currentStepIndex: nextIndex };
    
    // Check if the next step requires automatic generation
    const nextStep = this.state.steps[nextIndex];
    if (nextStep?.component === 'generating_hypothesis') {
      glowLogger.info('Reached generating_hypothesis step, triggering hypothesis generation', {});
      this.generateHypothesis();
    } else if (nextStep?.component === 'generating_plan') {
      glowLogger.info('Reached generating_plan step, triggering plan generation', {});
      this.generateActionPlan();
    } else if (nextStep?.component === 'regenerating_plan') {
      glowLogger.info('Reached regenerating_plan step, plan revision already handled in submitRevision', {});
      // The revision logic is already handled in submitRevision(), no need to call anything here
    }
    
    glowLogger.info('New state after goNext: ' + JSON.stringify(this.state), {});
    this.onStateChange(this.state);
  }

  goPrevious(): void {
    if (!this.canGoPrevious()) {
      return;
    }

    const currentStep = this.getCurrentStep();
    
    // If moving back from clarifying question, use new navigation system
    if (currentStep?.component === 'ask_clarifying_coach_question') {
      const hasPrevious = this.goToPreviousQuestion();
      if (hasPrevious) {
        // Update both indices for compatibility and correct step navigation
        const newQuestionIndex = this.getCurrentQuestionIndex();
        const newStepIndex = this.getStepIndexForQuestion(newQuestionIndex);
        this.state = {
          ...this.state,
          currentClarifyingQuestionIndex: newQuestionIndex,
          currentStepIndex: newStepIndex
        };
        this.onStateChange(this.state);
        return;
      }
    }

    this.state = { ...this.state, currentStepIndex: this.state.currentStepIndex - 1 };
    this.onStateChange(this.state);
  }

  goToStep(stepId: string): void {
    const stepIndex = this.state.steps.findIndex(step => step.id === stepId);
    if (stepIndex !== -1) {
      this.state = { ...this.state, currentStepIndex: stepIndex };
      this.onStateChange(this.state);
    }
  }

  updateData(updates: Partial<Pick<OnboardingSequenceState, 'selectedCoach' | 'coachId' | 'userName' | 'selectedGoal' | 'selectedSecondaryGoal' | 'disclaimerAccepted' | 'motivationLevel' | 'motivationWhy' | 'selectedCoachType'>>): void {
    glowLogger.info('=== updateData DEBUG ===', {});
    glowLogger.info('Updates received: ' + JSON.stringify(updates), {});
    glowLogger.info('State before update: ' + JSON.stringify(this.state), {});
    this.state = { ...this.state, ...updates };
    glowLogger.info('State after update: ' + JSON.stringify(this.state), {});
    this.onStateChange(this.state);
  }

  updateHypothesisWithUserAssessment(userAssessment: string): void {
    glowLogger.info('Updating hypothesis with user assessment', { userAssessment });
    
    if (this.state.generatedHypothesis) {
      const updatedHypothesis = {
        ...this.state.generatedHypothesis,
        user_assessment_hypothesis: userAssessment
      };
      
      this.state = {
        ...this.state,
        generatedHypothesis: updatedHypothesis
      };
      
      this.onStateChange(this.state);
    }
  }


  // Robust question tracking methods
  
  /**
   * Initialize the question sequence from question keys
   */
  initializeQuestionSequence(questionKeys: string[]): void {
    glowLogger.info('Initializing question sequence', {
      questionKeys,
      questionCount: questionKeys.length
    });

    const preserved: Record<string, any> = {};
    const keysToKeep = ['gender_question'];
    for (const k of keysToKeep) {
      if (this.state.answeredQuestions[k] !== undefined) {
        preserved[k] = this.state.answeredQuestions[k];
      }
    }
    
    this.state = {
      ...this.state,
      questionSequence: [...questionKeys],
      currentQuestionKey: questionKeys.length > 0 ? questionKeys[0] : undefined,
      answeredQuestions: { ...preserved }
    };
    
    this.onStateChange(this.state);
  }

  /**
   * Set answer for a specific question key
   */
  setQuestionAnswer(questionKey: string, answer: any): void {
    if (!questionKey) {
      glowLogger.warn('Attempted to set answer for empty question key', { answer });
      return;
    }

    const newAnsweredQuestions = {
      ...this.state.answeredQuestions,
      [questionKey]: answer
    };

    glowLogger.info('Setting question answer', {
      questionKey,
      answer,
      totalAnswered: Object.keys(newAnsweredQuestions).length,
      totalQuestions: this.state.questionSequence.length
    });

    this.state = {
      ...this.state,
      answeredQuestions: newAnsweredQuestions
    };

    this.onStateChange(this.state);
  }

  /**
   * Get answer for a specific question key
   */
  getQuestionAnswer(questionKey: string): any {
    return this.state.answeredQuestions[questionKey];
  }

  /**
   * Classify training level from the two new experience questions.
   * Returns a canonical level string used throughout the app for plan generation.
   *
   * Matrix:
   *   < 6 months          → Beginner
   *   6–12 months + inconsistent → Beginner
   *   6–12 months + steady/optimized → Novice
   *   1–2 years + inconsistent → Novice
   *   1–2 years + steady/optimized → Intermediate
   *   3–5 years + inconsistent/steady → Intermediate
   *   3–5 years + optimized → Advanced
   *   5+ years + inconsistent/steady → Advanced
   *   5+ years + optimized → Advanced
   */
  classifyTrainingLevel(years: string, consistency: string): string {
    const yearsRank: Record<string, number> = {
      'Less than 6 months': 0,
      '6–12 months': 1,
      '1–2 years': 2,
      '3–5 years': 3,
      '5+ years': 4,
    };
    const consistencyRank: Record<string, number> = {
      'Inconsistent: Frequent breaks, basic form': 0,
      'Steady: 3+ sessions/week, good form': 1,
      'Optimized: Consistent + progressive overload': 2,
    };
    const y = yearsRank[years] ?? 0;
    const c = consistencyRank[consistency] ?? 0;

    if (y === 0) return 'Beginner';
    if (y === 1 && c === 0) return 'Beginner';
    if (y === 1 && c >= 1) return 'Novice';
    if (y === 2 && c === 0) return 'Novice';
    if (y === 2 && c >= 1) return 'Intermediate';
    if (y === 3 && c <= 1) return 'Intermediate';
    if (y === 3 && c === 2) return 'Advanced';
    return 'Advanced'; // 5+ years
  }

  /**
   * Extract expertise level from answers based on selected primary goal.
   * Uses the two new training questions (training_experience_years + training_consistency)
   * and derives a classification. Falls back to goal-level quantitative hints.
   */
  extractExpertiseLevelFromAnswers(): string {
    const years = this.getQuestionAnswer('training_experience_years');
    const consistency = this.getQuestionAnswer('training_consistency');

    if (years && consistency) {
      return this.classifyTrainingLevel(years, consistency);
    }

    // Backward-compat: legacy single-question answer
    const legacyExperience = this.getQuestionAnswer('training_experience');
    if (legacyExperience) {
      return legacyExperience;
    }

    // Fallback to goal-specific expertise indicators
    const goalToLevelMap: Record<string, string> = {
      'Burn body fat': 'quantitative_goal_burn_fat',
      'Build muscle mass': 'quantitative_goal_build_muscle',
      'Increase strength': 'quantitative_goal_increase_strength',
      'Get challenged by my coach': 'quantitative_goal_get_challenged',
    };

    const selectedGoal = this.state.selectedGoal;
    if (!selectedGoal) return '';
    const expertiseQuestionKey = goalToLevelMap[selectedGoal];
    if (!expertiseQuestionKey) return '';
    return this.getQuestionAnswer(expertiseQuestionKey) || '';
  }

  /**
   * Check if a question has been answered
   */
  isQuestionAnswered(questionKey: string): boolean {
    const answer = this.state.answeredQuestions[questionKey];
    
    // Consider empty string as not answered for text inputs
    if (typeof answer === 'string') {
      return answer.trim().length > 0;
    }
    
    // Consider empty array as not answered for multi-select
    if (Array.isArray(answer)) {
      return answer.length > 0;
    }
    
    // Numbers and non-null objects are considered answered
    return answer != null && answer !== undefined;
  }

  /**
   * Get number of answered questions
   */
  getAnsweredQuestionCount(): number {
    return Object.keys(this.state.answeredQuestions).filter(key => 
      this.isQuestionAnswered(key)
    ).length;
  }

  /**
   * Get number of remaining questions
   */
  getRemainingQuestionCount(): number {
    const totalQuestions = this.state.questionSequence.length;
    const answeredCount = this.getAnsweredQuestionCount();
    return Math.max(0, totalQuestions - answeredCount);
  }

  /**
   * Check if a question should be displayed based on its depends_on condition
   */
  private shouldShowQuestion(questionKey: string): boolean {
    if (!onboardingConfig?.question_bank) {
      return true; // Show by default if config not available
    }

    const questionConfig = onboardingConfig.question_bank[questionKey];
    if (!questionConfig || !questionConfig.depends_on) {
      return true; // Show if no depends_on condition
    }

    const { question: dependsOnQuestion, value, not_value } = questionConfig.depends_on;
    const includes_value = questionConfig.depends_on.includes_value;
    const dependsOnAnswer = this.getQuestionAnswer(dependsOnQuestion);

    // If the dependent question hasn't been answered yet, skip this question
    if (dependsOnAnswer === undefined || dependsOnAnswer === null || dependsOnAnswer === '') {
      glowLogger.info('Skipping question - dependent question not answered yet', {
        question: questionKey,
        depends_on_question: dependsOnQuestion
      });
      return false;
    }

    // Check if the dependency condition is met
    if (value !== undefined) {
      // Show only if the answer matches the specified value
      const shouldShow = dependsOnAnswer === value;
      glowLogger.info('Checking depends_on condition (value match)', {
        question: questionKey,
        depends_on_question: dependsOnQuestion,
        required_value: value,
        actual_answer: dependsOnAnswer,
        should_show: shouldShow
      });
      return shouldShow;
    }

    if (not_value !== undefined) {
      // Show only if the answer does NOT match the specified value
      const shouldShow = dependsOnAnswer !== not_value;
      glowLogger.info('Checking depends_on condition (not_value)', {
        question: questionKey,
        depends_on_question: dependsOnQuestion,
        not_value: not_value,
        actual_answer: dependsOnAnswer,
        should_show: shouldShow
      });
      return shouldShow;
    }

    if (includes_value !== undefined) {
      // For multi-select answers: show if the array includes the specified value
      const shouldShow = Array.isArray(dependsOnAnswer)
        ? dependsOnAnswer.includes(includes_value)
        : dependsOnAnswer === includes_value;
      glowLogger.info('Checking depends_on condition (includes_value)', {
        question: questionKey,
        depends_on_question: dependsOnQuestion,
        includes_value: includes_value,
        actual_answer: dependsOnAnswer,
        should_show: shouldShow
      });
      return shouldShow;
    }

    return true; // Show by default if condition is malformed
  }

  /**
   * Move to next question in sequence, skipping questions that don't meet depends_on conditions
   */
  goToNextQuestion(): boolean {
    let currentIndex = this.getCurrentQuestionIndex();
    if (currentIndex < 0 || currentIndex >= this.state.questionSequence.length - 1) {
      // At last question or invalid position - don't clear currentQuestionKey yet
      // Just return false to indicate no more questions
      return false;
    }

    // Find the next question that should be shown
    let nextIndex = currentIndex + 1;
    while (nextIndex < this.state.questionSequence.length) {
      const nextQuestionKey = this.state.questionSequence[nextIndex];
      
      if (this.shouldShowQuestion(nextQuestionKey)) {
        // Found a question that should be shown
        this.state = {
          ...this.state,
          currentQuestionKey: nextQuestionKey
        };
        this.onStateChange(this.state);
        return true;
      }
      
      // Skip this question and try the next one
      glowLogger.info('Skipping question due to depends_on condition', {
        skipped_question: nextQuestionKey,
        current_index: nextIndex
      });
      nextIndex++;
    }

    // No more questions to show
    return false;
  }

  /**
   * Move to previous question in sequence, skipping questions that don't meet depends_on conditions
   */
  goToPreviousQuestion(): boolean {
    let currentIndex = this.getCurrentQuestionIndex();
    if (currentIndex <= 0) {
      // At first question or invalid position
      return false;
    }

    // Find the previous question that should be shown
    let prevIndex = currentIndex - 1;
    while (prevIndex >= 0) {
      const prevQuestionKey = this.state.questionSequence[prevIndex];
      
      if (this.shouldShowQuestion(prevQuestionKey)) {
        // Found a question that should be shown
        this.state = {
          ...this.state,
          currentQuestionKey: prevQuestionKey
        };
        this.onStateChange(this.state);
        return true;
      }
      
      // Skip this question and try the previous one
      glowLogger.info('Skipping question (backward) due to depends_on condition', {
        skipped_question: prevQuestionKey,
        current_index: prevIndex
      });
      prevIndex--;
    }

    // No more questions to show
    return false;
  }

  /**
   * Get current question index in sequence
   */
  getCurrentQuestionIndex(): number {
    if (!this.state.currentQuestionKey) {
      return -1;
    }
    return this.state.questionSequence.indexOf(this.state.currentQuestionKey);
  }

  /**
   * Get the step index for a given question index.
   * Uses step-ID lookup so non-question steps injected mid-sequence
   * (e.g. choose_secondary_goal) don't offset the mapping.
   */
  getStepIndexForQuestion(questionIndex: number): number {
    // Predefined question steps are named predefined_question_1, predefined_question_2, …
    const predefinedId = `predefined_question_${questionIndex + 1}`;
    const predefinedIdx = this.state.steps.findIndex(step => step.id === predefinedId);
    if (predefinedIdx >= 0) return predefinedIdx;

    // Fallback: find the first clarifying question step
    const firstClarifyingStepIndex = this.state.steps.findIndex(step =>
      step.component === 'ask_clarifying_coach_question'
    );
    if (firstClarifyingStepIndex < 0) return this.state.currentStepIndex;
    return firstClarifyingStepIndex + questionIndex;
  }

  /**
   * Check if we've completed all questions
   */
  areAllQuestionsCompleted(): boolean {
    return this.getAnsweredQuestionCount() >= this.state.questionSequence.length;
  }

  /**
   * Check if we can go back to previous question
   */
  canGoToPreviousQuestion(): boolean {
    const currentIndex = this.getCurrentQuestionIndex();
    return currentIndex > 0;
  }

  // Start clarifying questions flow after goal selection
  async startClarifyingQuestions(): Promise<void> {
    if (!this.state.selectedGoal) {
      glowLogger.info('No goal selected, cannot start clarifying questions', {});
      return;
    }

    glowLogger.info('=== startClarifyingQuestions DEBUG ===', {});
    glowLogger.info('Starting clarifying questions for goal: ' + this.state.selectedGoal, {});
    glowLogger.info('Coach type: ' + this.state.selectedCoachType, {});
    
    // Always use predefined questions (coach type is selected AFTER plan acceptance)
    // This ensures consistent onboarding experience
    await this.startPredefinedQuestions();
  }

  // Start predefined questions for AI hybrid coach
  private async startPredefinedQuestions(): Promise<void> {
    // Perform question resolution and deduplication synchronously
    const predefinedQuestions = this.getPredefinedQuestionsForPrimaryGoal(this.state.selectedGoal || '');
    
    // Add secondary goal questions if they exist
    if (this.state.selectedSecondaryGoal) {
      let secondaryGoals: string[] = [];
      
      // Handle both string and array formats for selectedSecondaryGoal
      if (Array.isArray(this.state.selectedSecondaryGoal)) {
        secondaryGoals = this.state.selectedSecondaryGoal;
      } else if (typeof this.state.selectedSecondaryGoal === 'string' && this.state.selectedSecondaryGoal.trim().length > 0) {
        secondaryGoals = [this.state.selectedSecondaryGoal];
      }
      
      if (secondaryGoals.length > 0) {
        const secondaryQuestions = this.getPredefinedQuestionsForSecondaryGoals(secondaryGoals);
        predefinedQuestions.push(...secondaryQuestions);
        
        glowLogger.info('Added secondary goal questions', {
          secondary_goals: secondaryGoals,
          secondary_questions_count: secondaryQuestions.length
        });
      }
    }

    // Add back matter questions if they exist
    const backMatterQuestions = this.getBackMatterQuestions();
    if (backMatterQuestions.length > 0) {
      predefinedQuestions.push(...backMatterQuestions);
    }
    
    glowLogger.info('Added back matter questions', {
      back_matter_questions_count: backMatterQuestions.length,
      back_matter_questions: backMatterQuestions,
      predefinedQuestions: predefinedQuestions
    });

    // Simple key-based deduplication only
    const uniqueQuestionKeys = [...new Set(predefinedQuestions)];
    const keyDeduplicationCount = predefinedQuestions.length - uniqueQuestionKeys.length;
    
    if (keyDeduplicationCount > 0) {
      glowLogger.info('Key-based deduplication completed', {
        original_count: predefinedQuestions.length,
        after_key_dedup_count: uniqueQuestionKeys.length,
        duplicates_removed: keyDeduplicationCount
      });
      
      // Update the array with deduplicated keys
      predefinedQuestions.length = 0; // Clear array
      predefinedQuestions.push(...uniqueQuestionKeys);
    } else {
      glowLogger.info('No duplicate keys found, proceeding with original list', {
        question_count: predefinedQuestions.length
      });
    }

    // Directly add question steps to flow (no LLM deduplication)
    this.addQuestionStepsToFlow(predefinedQuestions);
  }

  // Helper method to add question steps to the flow
  private addQuestionStepsToFlow(predefinedQuestions: string[]): void {

    glowLogger.info('Using predefined questions for AI hybrid coach', {
      question_count: predefinedQuestions.length,
      questions: predefinedQuestions
    });

    // Add predefined clarifying question steps to the flow
    const clarifyingSteps: OnboardingStep[] = predefinedQuestions.map((questionKey, index) => ({
      id: `predefined_question_${index + 1}`,
      component: 'ask_clarifying_coach_question',
      title: `Question ${index + 1}`
    }));

    const secondaryGoalStep: OnboardingStep = { id: 'choose_secondary_goal', component: 'choose_secondary_goal', title: 'Choose Secondary Goal' };
    const disclaimerStep: OnboardingStep = { id: 'disclaimer', component: 'disclaimer', title: 'Disclaimer' };
    const generatingHypothesisStep: OnboardingStep = { id: 'generating_hypothesis', component: 'generating_hypothesis', title: 'Generating Hypothesis' };
    const planHypothesisStep: OnboardingStep = { id: 'plan_hypothesis', component: 'plan_hypothesis', title: 'Plan Hypothesis' };
    const generatingPlanStep: OnboardingStep = { id: 'generating_plan', component: 'generating_plan', title: 'Generating Your Plan' };
    const actionPlanReviewStep: OnboardingStep = { id: 'action_plan_review', component: 'action_plan_review', title: 'Review Your Plan' };

    // Keep the motivation step and everything before it; discard any previously
    // inserted dynamic steps so a second call (after a goal change) replaces them.
    const newSteps = this.state.steps.slice(0, this.state.currentStepIndex + 1);
    // Inject choose_secondary_goal between the first question (quantitative goal) and the rest
    const [firstQuestion, ...remainingQuestions] = clarifyingSteps;
    // Disclaimer appears right before hypothesis generation so the user consents before AI processing begins
    newSteps.push(firstQuestion, secondaryGoalStep, ...remainingQuestions, disclaimerStep, generatingHypothesisStep, planHypothesisStep, generatingPlanStep, actionPlanReviewStep);

    // currentStepIndex still points to the motivation step; goNext() from motivation
    // will advance to currentStepIndex+1, which is the first clarifying question.
    this.state = {
      ...this.state,
      steps: newSteps,
      clarifyingQuestions: predefinedQuestions,
      clarifyingAnswers: new Array(predefinedQuestions.length).fill(''),
      clarifyingPlaceholders: new Array(predefinedQuestions.length).fill(''),
      currentClarifyingQuestionIndex: 0,
    };

    // Initialize new question tracking system
    this.initializeQuestionSequence(predefinedQuestions);

    glowLogger.info('Updated state with predefined questions', { 
      question_count: predefinedQuestions.length 
    });
  }

  // Get predefined questions for a primary goal
  private getPredefinedQuestionsForPrimaryGoal(goal: string): string[] {
    try {
      const config = require('../assets/onboarding_config');
      
      const configKey = primaryGoalMap[goal];
      if (!configKey) {
        glowLogger.info('No predefined questions mapping found for goal', { goal });
        return [];
      }

      const questionKeys = config[configKey];
      if (!Array.isArray(questionKeys)) {
        glowLogger.info('No question array found for config key', { configKey });
        return [];
      }

      glowLogger.info('Found predefined questions for goal', { 
        goal, 
        configKey, 
        questionCount: questionKeys.length,
        questionKeys 
      });

      return questionKeys;
    } catch (error) {
      glowLogger.error('Error loading predefined questions', { 
        error: error instanceof Error ? error.message : String(error),
        goal 
      });
      return [];
    }
  }

  // Get predefined questions for secondary goals
  // Note: The new secondary goals (Improve sleep, Decrease stress, Improve my nutrition,
  // Supplement advice, Learn best practices) do not have their own question sequences.
  // Their topics are already covered by the common sections (nutrition, sleep, stress).
  // The secondary goal selection is captured and passed to the LLM for plan generation.
  private getPredefinedQuestionsForSecondaryGoals(secondaryGoals: string[]): string[] {
    glowLogger.info('Secondary goals recorded (no additional questions for new secondary goals)', { 
      secondaryGoals 
    });
    
    // New secondary goals don't have separate question sequences.
    // Return empty array — their relevant topics are covered in the common sections.
    return [];
  }

  // Get back matter questions
  private getBackMatterQuestions(): string[] {
    try {
      const config = require('../assets/onboarding_config');
      
      const backMatterQuestions = config.back_matter_questions;
      if (!Array.isArray(backMatterQuestions)) {
        glowLogger.info('No back matter questions found in config');
        return [];
      }

      glowLogger.info('Found back matter questions', { 
        questionCount: backMatterQuestions.length,
        questionKeys: backMatterQuestions 
      });

      return backMatterQuestions;
    } catch (error) {
      glowLogger.error('Error loading back matter questions', { 
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  // Generic method to resolve question keys to FormField structures
  resolveQuestionsFromKeys(question_keys: string[]): FormField[] {
    if (!onboardingConfig?.question_bank) {
      glowLogger.error('Onboarding config or question_bank not available', {
        config_loaded: !!onboardingConfig,
        question_bank_available: !!onboardingConfig?.question_bank
      });
      return [];
    }

    const resolvedQuestions: FormField[] = [];
    
    for (const questionKey of question_keys) {
      const questionConfig = onboardingConfig.question_bank[questionKey];
      if (questionConfig) {
        // Ensure the question config matches FormField interface
        const labelEn = questionConfig.label_en || '';
        const formField: FormField = {
          label_en: labelEn,
          label_es: questionConfig.label_es || labelEn,
          ui_widget: questionConfig.ui_widget || 'text',
          ui_widget_options: questionConfig.ui_widget_options,
          ui_widget_options_es: questionConfig.ui_widget_options_es,
          ui_widget_options_labels: questionConfig.ui_widget_options_labels,
          ui_widget_options_labels_es: questionConfig.ui_widget_options_labels_es,
          depends_on: questionConfig.depends_on,
          required: questionConfig.required,
          optional: questionConfig.optional,
          other_specify: questionConfig.other_specify,
        };
        resolvedQuestions.push(formField);
      } else {
        glowLogger.warn('Question key not found in config.  Skipping question.', { 
          questionKey,
          available_keys: Object.keys(onboardingConfig.question_bank)
        });
      }
    }

    glowLogger.info('Resolved questions from keys', {
      input_keys: question_keys,
      resolved_count: resolvedQuestions.length,
      resolved_questions: resolvedQuestions.map(q => ({ key: q.label_en, widget: q.ui_widget }))
    });

    return resolvedQuestions;
  }

  // Get current predefined question config
  getCurrentPredefinedQuestionConfig(): FormField | null {
    if (this.state.currentClarifyingQuestionIndex >= this.state.clarifyingQuestions.length) {
      return null;
    }

    const questionKey = this.state.clarifyingQuestions[this.state.currentClarifyingQuestionIndex];
    
    // Use the generic method to resolve the single question
    const resolvedQuestions = this.resolveQuestionsFromKeys([questionKey]);
    
    if (resolvedQuestions.length === 0) {
      // Log error but don't skip here to avoid state changes during render
      glowLogger.warn('Question configuration not found', {
        question_key: questionKey,
        question_index: this.state.currentClarifyingQuestionIndex,
        total_questions: this.state.clarifyingQuestions.length
      });
      return null;
    }
    
    return resolvedQuestions[0];
  }

  // Get current predefined question key
  getCurrentPredefinedQuestionKey(): string {
    if (this.state.currentClarifyingQuestionIndex >= this.state.clarifyingQuestions.length) {
      return '';
    }
    return this.state.clarifyingQuestions[this.state.currentClarifyingQuestionIndex];
  }

  // Skip current question when configuration is missing
  public skipCurrentQuestion(): void {
    glowLogger.info('Skipping current question due to missing configuration', {
      current_index: this.state.currentClarifyingQuestionIndex,
      question_key: this.state.clarifyingQuestions[this.state.currentClarifyingQuestionIndex]
    });

    // Mark current answer as empty (skipped)
    const newAnswers = [...this.state.clarifyingAnswers];
    newAnswers[this.state.currentClarifyingQuestionIndex] = '';

    // Check if this is the last question
    if (this.state.currentClarifyingQuestionIndex >= this.state.clarifyingQuestions.length - 1) {
      // Last question, proceed to plan generation
      glowLogger.info('Skipped question was the last one, proceeding to plan generation', {});
      this.state = {
        ...this.state,
        clarifyingAnswers: newAnswers
      };
      this.onStateChange(this.state);
      this.skipToGeneratingPlan();
    } else {
      // Not the last question, move to next question index
      this.state = {
        ...this.state,
        clarifyingAnswers: newAnswers,
        currentClarifyingQuestionIndex: this.state.currentClarifyingQuestionIndex + 1
      };
      this.onStateChange(this.state);
    }
  }

  // Update clarifying answer
  updateClarifyingAnswer(answer: string): void {
    glowLogger.info('=== updateClarifyingAnswer DEBUG ===', {});
    glowLogger.info('Current question key: ' + this.state.currentQuestionKey, {});
    glowLogger.info('Answer: ' + answer, {});

    // Commands (/stop) will be processed when user hits next button

    // Update the robust data structure
    this.setQuestionAnswer(this.state.currentQuestionKey!, answer);

    // Also update old array for compatibility during transition
    const newAnswers = [...this.state.clarifyingAnswers];
    newAnswers[this.state.currentClarifyingQuestionIndex] = answer;
    this.state = {
      ...this.state,
      clarifyingAnswers: newAnswers
    };

    glowLogger.info('Updated question answer for key: ' + this.state.currentQuestionKey, {});
    this.onStateChange(this.state);
  }

  // Get current clarifying answer
  getCurrentClarifyingAnswer(): any {
    return this.getQuestionAnswer(this.state.currentQuestionKey!) || '';
  }

  // Get current clarifying placeholder
  getCurrentClarifyingPlaceholder(): string {
    if (this.state.currentClarifyingQuestionIndex >= this.state.clarifyingPlaceholders.length) {
      return '';
    }
    return this.state.clarifyingPlaceholders[this.state.currentClarifyingQuestionIndex];
  }

  reset(): void {
    this.state = {
      currentStepIndex: 0,
      steps: this.state.steps,
      clarifyingQuestions: [],
      clarifyingAnswers: [],
      clarifyingPlaceholders: [],
      currentClarifyingQuestionIndex: 0,
      // Reset new question tracking system
      answeredQuestions: {},
      questionSequence: [],
      currentQuestionKey: undefined,
      isComplete: false,
      selectedRevisionStepIndex: undefined
    };
    this.onStateChange(this.state);
  }

  // Utility methods for step management
  addStep(step: OnboardingStep, index?: number): void {
    if (index !== undefined) {
      this.state.steps.splice(index, 0, step);
    } else {
      this.state.steps.push(step);
    }
    this.onStateChange(this.state);
  }

  removeStep(stepId: string): void {
    const stepIndex = this.state.steps.findIndex(step => step.id === stepId);
    if (stepIndex !== -1) {
      this.state.steps.splice(stepIndex, 1);
      
      // Adjust current step index if needed
      if (this.state.currentStepIndex >= stepIndex && this.state.currentStepIndex > 0) {
        this.state.currentStepIndex--;
      }
      
      this.onStateChange(this.state);
    }
  }

  // Generate hypothesis based on user data and clarifying questions
  async generateHypothesis(): Promise<void> {
    try {
      glowLogger.info('Starting hypothesis generation...', {});
      
      // Set loading state
      this.state = {
        ...this.state,
        isGeneratingHypothesis: true
      };
      this.onStateChange(this.state);

      // Use filtered clarifying questions (handles early termination)
      const filteredQuestions = this.getFilteredClarifyingQuestions();
      
      // Create onboard data object for LLM service
      const onboardData: Onboard = {
        selectedCoach: this.state.selectedCoach || '',
        coach_type: this.state.selectedCoachType || CoachType.AI_ONLY,
        name: this.state.userName || '',
        selectedModules: [this.state.selectedGoal || ''], // Use goal as module for now
        selectedGoal: this.state.selectedGoal || '',
        selectedSecondaryGoal: this.state.selectedSecondaryGoal || '',
        motivationLevel: this.state.motivationLevel || 5,
        motivationWhy: this.state.motivationWhy || '',
        motivation_level: this.state.motivationLevel || 5,
        motivation_why: this.state.motivationWhy || '',
        time_available: this.state.answeredQuestions['current_time_available'] || '',
        expertise_level: this.extractExpertiseLevelFromAnswers(),
        clarifyingQuestions: filteredQuestions,
        // Physical stats for BMR/TDEE calorie calculation
        gender: this.state.answeredQuestions['gender_question'] || '',
        age: this.state.answeredQuestions['current_age_question'] || '',
        height: this.state.answeredQuestions['current_height_question'] || '',
        weight: this.state.answeredQuestions['current_weight_question'] || '',
        occupation_activity: this.state.answeredQuestions['occupation_activity'] || '',
        exercise_frequency: this.state.answeredQuestions['exercise_frequency'] || this.state.answeredQuestions['training_experience_years'] || this.state.answeredQuestions['training_experience'] || '',
        training_experience: this.extractExpertiseLevelFromAnswers() || this.state.answeredQuestions['training_experience'] || '',
        chronic_illnesses: ['None'],
        medications: ['None'],
        supplements: ['None'],
        allergies: ['None'],
        moduleData: {},
        toLLMString: () => 'Onboard data for hypothesis generation'
      };

      glowLogger.info('Onboard data for hypothesis generation: ' + JSON.stringify(onboardData), {});
      glowLogger.info('Filtered clarifying questions count: ' + filteredQuestions.length, {});

      // Check if user entered "testing" as motivation OR name is "**/_Test_/**" to use fake data
      const shouldUseFakeData = this.state.motivationWhy?.toLowerCase() === 'testing' || 
                                this.state.userName === '**/_Test_/**';

      // Call LLM service to generate hypothesis
      const hypothesisResponse = await llmService.generateHypothesis(
        onboardData, 
        undefined, 
        undefined, 
        shouldUseFakeData
      );
      
      glowLogger.info('=== GENERATED HYPOTHESIS ===', {'hypothesis': hypothesisResponse});
      glowLogger.info('============================', {});

      // Convert HypothesisResponse to Hypothesis interface
      const hypothesis: Hypothesis = {
        ...hypothesisResponse,
        toLLMString: () => hypothesisToLLMString(hypothesisResponse)
      };

      // Update state with generated hypothesis
      this.state = {
        ...this.state,
        isGeneratingHypothesis: false,
        generatedHypothesis: hypothesisResponse
      };
      
      
      this.onStateChange(this.state);

      // Automatically move to the next step (plan hypothesis review)
      setTimeout(() => {
        this.goNext();
      }, 500); // Small delay to show the completed state briefly
    } catch (error) {
      glowLogger.error('=== generateHypothesis ERROR ===', {});
      glowLogger.error('Failed to generate hypothesis: ' + String(error), {});
      glowLogger.error('===============================', {});
      
      // Set error state and navigate back to hypothesis review
      this.state = {
        ...this.state,
        isGeneratingHypothesis: false,
        hypothesisGenerationError: error instanceof Error ? error.message : String(error),
        hasHypothesisGenerationError: true
      };
      this.onStateChange(this.state);
      
      // Still move to hypothesis review screen to show error
      setTimeout(() => {
        this.goNext();
      }, 500);
    }
  }

  // Start plan generation after hypothesis approval - go directly to plan generation
  startPlanGeneration(): void {
    glowLogger.info('Starting plan generation after hypothesis approval', {});
    
    // Find the generating plan step
    const generatingPlanStepIndex = this.state.steps.findIndex(step => 
      step.component === 'generating_plan'
    );
    
    if (generatingPlanStepIndex === -1) {
      glowLogger.error('Could not find generating_plan step', {});
      return;
    }
    
    // Jump directly to generating plan step
    this.state = {
      ...this.state,
      currentStepIndex: generatingPlanStepIndex
    };
    
    glowLogger.info('Jumped to generating plan step at index: ' + generatingPlanStepIndex, {});
    this.onStateChange(this.state);
    
    // Trigger plan generation
    this.generateActionPlan();
  }

  // Generate action plan based on user data and clarifying questions
  async generateActionPlan(): Promise<void> {
    try {
      glowLogger.info('Starting action plan generation...', {});
      glowLogger.info('Is early termination: ' + this.state.isEarlyTermination, {});
      
      // Set loading state
      this.state = {
        ...this.state,
        isGeneratingPlan: true
      };
      this.onStateChange(this.state);

      // Use filtered clarifying questions (handles early termination)
      const filteredQuestions = this.getFilteredClarifyingQuestions();
      
      // Convert stored hypothesis to Hypothesis interface if available
      let hypothesis: Hypothesis | undefined;
      if (this.state.generatedHypothesis) {
        hypothesis = {
          ...this.state.generatedHypothesis,
          toLLMString: () => hypothesisToLLMString(this.state.generatedHypothesis!)
        };
      }

      // Create onboard data object for LLM service
      const onboardData: Onboard = {
        selectedCoach: this.state.selectedCoach || '',
        coach_type: this.state.selectedCoachType || CoachType.AI_ONLY,
        name: this.state.userName || '',
        selectedModules: [this.state.selectedGoal || ''], // Use goal as module for now
        selectedGoal: this.state.selectedGoal || '',
        selectedSecondaryGoal: this.state.selectedSecondaryGoal || '',
        motivationLevel: this.state.motivationLevel || 5,
        motivationWhy: this.state.motivationWhy || '',
        motivation_level: this.state.motivationLevel || 5,
        motivation_why: this.state.motivationWhy || '',
        time_available: this.state.answeredQuestions['current_time_available'] || '',
        expertise_level: this.extractExpertiseLevelFromAnswers(),
        clarifyingQuestions: filteredQuestions,
        // Physical stats for BMR/TDEE calorie calculation
        gender: this.state.answeredQuestions['gender_question'] || '',
        age: this.state.answeredQuestions['current_age_question'] || '',
        height: this.state.answeredQuestions['current_height_question'] || '',
        weight: this.state.answeredQuestions['current_weight_question'] || '',
        occupation_activity: this.state.answeredQuestions['occupation_activity'] || '',
        exercise_frequency: this.state.answeredQuestions['exercise_frequency'] || this.state.answeredQuestions['training_experience_years'] || this.state.answeredQuestions['training_experience'] || '',
        training_experience: this.extractExpertiseLevelFromAnswers() || this.state.answeredQuestions['training_experience'] || '',
        chronic_illnesses: ['None'],
        medications: ['None'],
        supplements: ['None'],
        allergies: ['None'],
        moduleData: {},
        hypothesis: hypothesis,
        toLLMString: () => 'Onboard data for plan generation'
      };

      glowLogger.info('Onboard data for plan generation: ' + JSON.stringify(onboardData), {});
      glowLogger.info('Filtered clarifying questions count: ' + filteredQuestions.length, {});

      // Check if user entered "testing" as motivation OR name is "**/_Test_/**" to use fake data
      const shouldUseFakeData = this.state.motivationWhy?.toLowerCase() === 'testing' || 
                                this.state.userName === '**/_Test_/**';

      // Call LLM service to generate action plan with hypothesis from onboard data
      const actionPlan = await llmService.generateActionPlan(
        onboardData, 
        undefined, 
        undefined, 
        shouldUseFakeData
      );
      
      glowLogger.info('=== GENERATED ACTION PLAN ===', {'action_plan': JSON.stringify(actionPlan, null, 2)});
      glowLogger.info('==============================', {});

      // Update state with generated plan
      this.state = {
        ...this.state,
        isGeneratingPlan: false,
        generatedPlan: actionPlan
      };
      
      this.onStateChange(this.state);

      // Automatically move to the next step (action plan review)
      setTimeout(() => {
        this.goNext();
      }, 500); // Small delay to show the completed state briefly
    } catch (error) {
      glowLogger.error('=== generateActionPlan ERROR ===', {});
      glowLogger.error('Failed to generate action plan: ' + String(error), {});
      glowLogger.error('================================', {});
      
      // Set error state and navigate back to action plan review
      this.state = {
        ...this.state,
        isGeneratingPlan: false,
        planGenerationError: error instanceof Error ? error.message : String(error),
        hasGenerationError: true
      };
      this.onStateChange(this.state);
      
      // Navigate back to action plan review screen
      const actionPlanReviewStepIndex = this.state.steps.findIndex(step => step.component === 'action_plan_review');
      if (actionPlanReviewStepIndex !== -1) {
        this.state = {
          ...this.state,
          currentStepIndex: actionPlanReviewStepIndex
        };
        this.onStateChange(this.state);
        
      }
    }
  }

  // Go to plan revision mode
  goToRevisePlanMode(): void {
    glowLogger.info('=== goToRevisePlanMode DEBUG ===', {});
    
    // Add a revise plan step after the current action plan review
    const revisePlanStep: OnboardingStep = {
      id: 'revise_plan',
      component: 'revise_plan',
      title: 'Revise Your Plan'
    };

    // Insert the revise plan step after the current step
    const newSteps = [...this.state.steps];
    newSteps.splice(this.state.currentStepIndex + 1, 0, revisePlanStep);

    this.state = {
      ...this.state,
      steps: newSteps,
      revisionRequest: '', // Clear any previous revision request
      selectedRevisionStepIndex: undefined
    };

    this.onStateChange(this.state);
    
    // Move to the revise plan step
    this.goNext();
  }

  // Update revision request
  updateRevisionRequest(revisionRequest: string): void {
    glowLogger.info('=== updateRevisionRequest DEBUG ===', {});
    glowLogger.info('Revision request: ' + revisionRequest, {});
    
    this.state = {
      ...this.state,
      revisionRequest
    };
    
    this.onStateChange(this.state);
  }

  updateRevisionStepIndex(stepIndex?: number): void {
    glowLogger.info('=== updateRevisionStepIndex DEBUG ===', {});
    glowLogger.info('Revision step index: ' + String(stepIndex), {});

    this.state = {
      ...this.state,
      selectedRevisionStepIndex: stepIndex
    };

    this.onStateChange(this.state);
  }

  // Submit revision and regenerate plan
  async submitRevision(): Promise<void> {
    glowLogger.info('=== submitRevision DEBUG ===', {});
    
    if (!this.state.revisionRequest || !this.state.generatedPlan?.actionPlan) {
      glowLogger.error('No revision request or generated plan available', {});
      return;
    }

    const selectedRevisionStepIndex = this.state.selectedRevisionStepIndex;
    if (
      selectedRevisionStepIndex === undefined ||
      selectedRevisionStepIndex < 0 ||
      selectedRevisionStepIndex >= this.state.generatedPlan.actionPlan.steps.length
    ) {
      glowLogger.error('No valid revision step selected', {
        selected_revision_step_index: selectedRevisionStepIndex,
        step_count: this.state.generatedPlan.actionPlan.steps.length
      });
      return;
    }

    try {
      // Add a new regenerating plan step after the current revise plan step
      const generatingPlanStep: OnboardingStep = {
        id: 'regenerating_plan',
        component: 'regenerating_plan',
        title: 'Regenerating Your Plan'
      };

      // Add action plan review step after the generating plan step (no thank you for revisions)
      const actionPlanReviewStep: OnboardingStep = {
        id: 'revised_action_plan_review',
        component: 'action_plan_review',
        title: 'Review Your Revised Plan'
      };

      // Insert these steps after the current revise plan step
      const newSteps = [...this.state.steps];
      newSteps.splice(this.state.currentStepIndex + 1, 0, generatingPlanStep, actionPlanReviewStep);

      this.state = {
        ...this.state,
        steps: newSteps,
        isGeneratingPlan: true
      };

      this.onStateChange(this.state);

      // Move to the generating plan step
      this.goNext();

      // Create onboard data object for LLM service
      const onboardData: Onboard = {
        selectedCoach: this.state.selectedCoach || '',
        coach_type: this.state.selectedCoachType || CoachType.AI_ONLY,
        name: this.state.userName || '',
        selectedModules: [this.state.selectedGoal || ''],
        selectedGoal: this.state.selectedGoal || '',
        selectedSecondaryGoal: this.state.selectedSecondaryGoal || '',
        motivationLevel: this.state.motivationLevel || 5,
        motivationWhy: this.state.motivationWhy || '',
        motivation_level: this.state.motivationLevel || 5,
        motivation_why: this.state.motivationWhy || '',
        time_available: this.state.answeredQuestions['current_time_available'] || '',
        expertise_level: this.extractExpertiseLevelFromAnswers(),
        clarifyingQuestions: this.state.clarifyingQuestions.map((question, index) => {
          // Runtime type may be string | number | string[] despite TS typing
          const rawAnswer: any = this.state.clarifyingAnswers[index] || '';
          let answerString = '';
          if (typeof rawAnswer === 'string') {
            answerString = rawAnswer;
          } else if (typeof rawAnswer === 'number') {
            answerString = rawAnswer.toString();
          } else if (Array.isArray(rawAnswer)) {
            if (question === 'existing_pain') {
              answerString = rawAnswer.length > 0
                ? `Pain in: ${bodyPartIdsToLabels(rawAnswer).join(', ')}`
                : 'No pain';
            } else if (question === 'struggle_upper_lower') {
              if (rawAnswer.includes('full_body')) {
                answerString = 'Full body equally';
              } else {
                answerString = rawAnswer.length > 0
                  ? `Focus on: ${bodyPartIdsToLabels(rawAnswer).join(', ')}`
                  : '';
              }
            } else {
              answerString = rawAnswer.join(', ');
            }
          } else if (rawAnswer !== null && rawAnswer !== undefined) {
            answerString = String(rawAnswer);
          }
          return { id: `q${index + 1}`, question, answer: answerString };
        })
        .filter(qa => {
          if (!qa || typeof qa.answer !== 'string') return false;
          if (qa.question === 'existing_pain') return true;
          return qa.question !== 'not_generated_yet' && qa.answer.trim() !== '';
        }),
        // Physical stats for BMR/TDEE calorie calculation
        gender: this.state.answeredQuestions['gender_question'] || '',
        age: this.state.answeredQuestions['current_age_question'] || '',
        height: this.state.answeredQuestions['current_height_question'] || '',
        weight: this.state.answeredQuestions['current_weight_question'] || '',
        occupation_activity: this.state.answeredQuestions['occupation_activity'] || '',
        exercise_frequency: this.state.answeredQuestions['exercise_frequency'] || this.state.answeredQuestions['training_experience_years'] || this.state.answeredQuestions['training_experience'] || '',
        training_experience: this.extractExpertiseLevelFromAnswers() || this.state.answeredQuestions['training_experience'] || '',
        chronic_illnesses: ['None'],
        medications: ['None'],
        supplements: ['None'],
        allergies: ['None'],
        actionPlan: this.state.generatedPlan.actionPlan,
        moduleData: {},
        toLLMString: () => 'Onboard data for plan revision'
      };

      // Use the same single-step edit flow as chat and the in-app plan editor.
      const revisedActionPlan = await llmService.generateUserEditedActionPlanStep(
        onboardData,
        selectedRevisionStepIndex,
        this.state.revisionRequest || ''
      );

      glowLogger.info('=== GENERATED ACTION PLAN REVISION ===', {'revised_action_plan': JSON.stringify(revisedActionPlan, null, 2)});
      glowLogger.info('====================================');

      // Update state with revised plan
      this.state = {
        ...this.state,
        isGeneratingPlan: false,
        generatedPlan: revisedActionPlan,
        revisionRequest: '', // Clear the revision request
        selectedRevisionStepIndex: undefined
      };

      this.onStateChange(this.state);

      // Automatically move to the revised action plan review
      setTimeout(() => {
        this.goNext();
      }, 500);
    } catch (error) {
      glowLogger.error('=== submitRevision ERROR ===');
      glowLogger.error('Failed to generate revised action plan: ' + String(error));
      glowLogger.error('============================');

      // Set error state and navigate back to action plan review
      this.state = {
        ...this.state,
        isGeneratingPlan: false,
        planGenerationError: error instanceof Error ? error.message : String(error),
        hasGenerationError: true
      };
      this.onStateChange(this.state);
      
      // Navigate back to action plan review screen
      const actionPlanReviewStepIndex = this.state.steps.findIndex(step => step.component === 'action_plan_review');
      if (actionPlanReviewStepIndex !== -1) {
        this.state = {
          ...this.state,
          currentStepIndex: actionPlanReviewStepIndex
        };
        this.onStateChange(this.state);
        
      }
    }
  }

  // Go to plan accepted mode
  goToPlanAcceptedMode(): void {
    glowLogger.info('=== goToPlanAcceptedMode DEBUG ===', {});

    // Pricing screen commented out during onboarding
    // const choosePlanAndPricingStep: OnboardingStep = {
    //   id: 'choose_plan_and_pricing',
    //   component: 'choose_plan_and_pricing',
    //   title: 'Choose Your Plan'
    // };

    const planAcceptedStep: OnboardingStep = {
      id: 'plan_accepted',
      component: 'plan_accepted',
      title: 'What to Expect'
    };

    // Insert plan_accepted after the current step (disclaimer was already shown before hypothesis generation)
    const newSteps = [...this.state.steps];
    newSteps.splice(this.state.currentStepIndex + 1, 0, planAcceptedStep);

    this.state = {
      ...this.state,
      steps: newSteps
    };

    this.onStateChange(this.state);

    // Move to the plan accepted step (pricing tier commented out)
    this.goNext();
  }

  // Handle early termination of clarifying questions
  handleEarlyTermination(): void {
    glowLogger.info('=== handleEarlyTermination DEBUG ===', {});
    glowLogger.info('Current question index: ' + this.state.currentClarifyingQuestionIndex, {});
    glowLogger.info('Current answers: ' + JSON.stringify(this.state.clarifyingAnswers.slice(0, this.state.currentClarifyingQuestionIndex)), {});
    
    // Mark as early termination
    this.state = {
      ...this.state,
      isEarlyTermination: true,
      terminatedAtQuestionIndex: this.state.currentClarifyingQuestionIndex
    };
    
    glowLogger.info('Early termination marked, proceeding to plan generation', {});
    this.onStateChange(this.state);
    
    // Skip remaining clarifying questions and go to plan generation
    this.skipToGeneratingPlan();
  }

  // Skip remaining clarifying questions and proceed to disclaimer before hypothesis generation
  private skipToGeneratingPlan(): void {
    glowLogger.info('skipToGeneratingPlan (redirect to disclaimer) invoked', {});
    const disclaimerIdx = this.state.steps.findIndex(step => step.component === 'disclaimer');
    if (disclaimerIdx !== -1) {
      this.state = { ...this.state, currentStepIndex: disclaimerIdx };
      this.onStateChange(this.state);
      return;
    }
    // Fallback to generating_hypothesis if disclaimer step missing
    glowLogger.error('Could not find disclaimer step, falling back to generating_hypothesis', {});
    const genHypIdx = this.state.steps.findIndex(step => step.component === 'generating_hypothesis');
    if (genHypIdx !== -1) {
      this.state = { ...this.state, currentStepIndex: genHypIdx };
      this.onStateChange(this.state);
      this.generateHypothesis();
      return;
    }
    // Last fallback directly to generating_plan
    const generatingPlanStepIndex = this.state.steps.findIndex(step => step.component === 'generating_plan');
    if (generatingPlanStepIndex === -1) {
      glowLogger.error('Could not find generating_plan step', {});
      return;
    }
    this.state = { ...this.state, currentStepIndex: generatingPlanStepIndex };
    this.onStateChange(this.state);
    this.generateActionPlan();
  }

  // Get filtered clarifying questions for plan generation (only answered ones) - make public
  public getFilteredClarifyingQuestions(): {id: string, question: string, answer: string}[] {
    const maxIndex = this.state.isEarlyTermination 
      ? (this.state.terminatedAtQuestionIndex || 0)
      : this.state.clarifyingQuestions.length;
    
    return this.state.clarifyingQuestions
      .slice(0, maxIndex)
      .map((question, index) => {
        // Runtime type may be string | number | string[] despite TS typing
        const rawAnswer: any = this.state.clarifyingAnswers[index] || '';
        
        // Convert different answer types to strings
        let answerString = '';
        if (question === 'usual_cardio') {
          // Persisted as JSON, surface a natural-language line to the LLM.
          answerString = cardioTriadToReadable(parseCardioTriadAnswer(rawAnswer));
        } else if (typeof rawAnswer === 'string') {
          answerString = rawAnswer;
        } else if (typeof rawAnswer === 'number') {
          answerString = rawAnswer.toString();
        } else if (Array.isArray(rawAnswer)) {
          if (question === 'existing_pain') {
            answerString = rawAnswer.length > 0
              ? `Pain in: ${bodyPartIdsToLabels(rawAnswer).join(', ')}`
              : 'No pain';
          } else if (question === 'struggle_upper_lower') {
            if (rawAnswer.includes('full_body')) {
              answerString = 'Full body equally';
            } else {
              answerString = rawAnswer.length > 0
                ? `Focus on: ${bodyPartIdsToLabels(rawAnswer).join(', ')}`
                : '';
            }
          } else {
            answerString = rawAnswer.join(', ');
          }
        } else if (rawAnswer !== null && rawAnswer !== undefined) {
          answerString = String(rawAnswer);
        }
        
        return {
          id: `q${index + 1}`,
          question,
          answer: answerString
        };
      })
      .filter(qa => {
        if (!qa || typeof qa.answer !== 'string') return false;
        // Keep body_map answers even when empty (means "no pain")
        if (qa.question === 'existing_pain') return true;
        return qa.question !== 'not_generated_yet' && qa.answer.trim() !== '';
      });
  }

  // Update the generated plan (for schedule changes during onboarding)
  updateGeneratedPlan(updatedActionPlan: any): void {
    if (this.state.generatedPlan) {
      this.state = {
        ...this.state,
        generatedPlan: {
          ...this.state.generatedPlan,
          actionPlan: updatedActionPlan
        }
      };
      this.onStateChange(this.state);
      glowLogger.info('Generated plan updated in sequence', {
        updated_steps_count: updatedActionPlan.steps?.length || 0
      });
    }
  }

  getProgress(): { current: number; total: number; percentage: number } {
    const baseSteps = defaultOnboardingSteps.length;
    const clarifyingCount = this.state.clarifyingQuestions.length;
    // +2 for generating_plan and action_plan_review steps
    const totalStepsWithClarifyingAndPlan = baseSteps + clarifyingCount + 2;

    let current = this.state.currentStepIndex + 1;
    
    // If we're in a clarifying question, adjust current based on question progress
    const currentStep = this.getCurrentStep();
    if (currentStep?.component === 'ask_clarifying_coach_question') {
      const questionIndex = this.getCurrentQuestionIndex();
      if (questionIndex >= 0) {
        // Add the question progress to the base step count
        current = baseSteps + questionIndex + 1;
      }
    }

    const total = totalStepsWithClarifyingAndPlan;
    const percentage = (current / total) * 100;

    return { current, total, percentage };
  }

  // Retry plan generation after an error
  retryPlanGeneration(): void {
    glowLogger.info('Retrying plan generation after error', {});
    
    // Clear error state
    this.state = {
      ...this.state,
      planGenerationError: undefined,
      hasGenerationError: false
    };
    this.onStateChange(this.state);
    
    // Check if this is a revision retry or initial generation retry
    if (this.state.revisionRequest) {
      glowLogger.info('Retrying plan revision', { revision_request: this.state.revisionRequest });
      // Navigate back to regenerating plan screen
      const regeneratingPlanStepIndex = this.state.steps.findIndex(step => step.component === 'regenerating_plan');
      if (regeneratingPlanStepIndex !== -1) {
        this.state = {
          ...this.state,
          currentStepIndex: regeneratingPlanStepIndex
        };
        this.onStateChange(this.state);
        
        // Restart the revision process
        this.submitRevision();
      }
    } else {
      glowLogger.info('Retrying initial plan generation');
      // Navigate back to generating plan screen
      const generatingPlanStepIndex = this.state.steps.findIndex(step => step.component === 'generating_plan');
      if (generatingPlanStepIndex !== -1) {
        this.state = {
          ...this.state,
          currentStepIndex: generatingPlanStepIndex
        };
        this.onStateChange(this.state);
        
        // Start plan generation
        this.generateActionPlan();
      }
    }
  }

  // Retry hypothesis generation after an error
  retryHypothesisGeneration(): void {
    glowLogger.info('Retrying hypothesis generation after error', {});
    
    // Clear error state
    this.state = {
      ...this.state,
      hypothesisGenerationError: undefined,
      hasHypothesisGenerationError: false
    };
    this.onStateChange(this.state);
    
    // Navigate back to generating hypothesis screen
    const generatingHypothesisStepIndex = this.state.steps.findIndex(step => step.component === 'generating_hypothesis');
    if (generatingHypothesisStepIndex !== -1) {
      this.state = {
        ...this.state,
        currentStepIndex: generatingHypothesisStepIndex
      };
      this.onStateChange(this.state);
      
      // Start hypothesis generation
      this.generateHypothesis();
    }
  }

  /**
   * Debug mode: Pre-fill onboarding with test data and skip to hypothesis generation.
   * Triggered when user enters DEBUG_TEST_NAME or DEBUG_TEST_NAME_FAKE_LLM as their name.
   * - Sets goal to "Build muscle mass" (muscle building test scenario)
   * - Sets secondary goal to "None"
   * - Pre-fills all questions with realistic muscle building answers
   * - Skips directly to hypothesis generation
   * @param preserveName - If true, keeps the original userName (for fake LLM mode)
   */
  async activateDebugMode(preserveName: boolean = false): Promise<void> {
    glowLogger.info('=== DEBUG MODE ACTIVATED ===', { preserveName });
    glowLogger.info('Pre-filling onboarding with Build Muscle test data...', {});

    // Pre-fill with realistic muscle building test data
    const debugData = {
      userName: preserveName ? this.state.userName : 'TestNew',
      selectedGoal: 'Build muscle mass',
      selectedSecondaryGoal: 'None',
      motivationLevel: 9,
      motivationWhy: 'I want to get super ripped',
      // Debug helper: pre-select Manu as the coach for the test user
      selectedCoach: 'Manu',
      selectedCoachType: CoachType.AI_ONLY
    };

    this.state = {
      ...this.state,
      ...debugData
    };
    this.onStateChange(this.state);

    glowLogger.info('Debug mode: Basic data set', { debug_data: JSON.stringify(debugData) });

    // Get predefined questions for "Build muscle mass" goal
    const predefinedQuestions = this.getPredefinedQuestionsForPrimaryGoal('Build muscle mass');
    
    // Add back matter questions
    const backMatterQuestions = this.getBackMatterQuestions();
    predefinedQuestions.push(...backMatterQuestions);

    // Deduplicate
    const uniqueQuestionKeys = [...new Set(predefinedQuestions)];

    glowLogger.info('Debug mode: Questions to auto-fill', { 
      question_count: uniqueQuestionKeys.length,
      questions: uniqueQuestionKeys 
    });

    // Pre-defined realistic answers for Build Muscle Mass scenario
    const buildMuscleAnswers: Record<string, any> = {
      'gender_question': 'Female',
      'current_age_question': '36',
      'current_height_question': '6\'0" (183 cm)',
      'current_weight_question': '190 lbs (86 kg)',
      'occupation_activity': 'Some standing and walking',
      'quantitative_goal_build_muscle': 'Gain 200-500 g (~0.4-1.1 lb) of lean mass in 4 weeks (intermediate gains)',
      'what_held_back_build_muscle': 'Inconsistent training schedule and not enough protein',
      'training_experience_years': '3–5 years',
      'training_consistency': 'Steady: 3+ sessions/week, good form',
      'preferred_training_setting': ['Gym'],
      'struggle_upper_lower': ['upper-back', 'chest'],
      'track_training_progress': 'Sometimes',
      'track_calories_consumed': 'Sometimes',
      'hours_sleep_per_night': '7–8',
      'current_stress_level': 4,
      'existing_pain': [],
      'family_cardiovascular_history': 'No',
      'anything_else_for_coach': ''
    };

    // Auto-fill answers for all questions
    const autoFilledAnswers: Record<string, any> = {};
    
    for (const questionKey of uniqueQuestionKeys) {
      // Use predefined answer if available, otherwise use default
      const answer = buildMuscleAnswers[questionKey] ?? this.getDebugAnswerForQuestion(questionKey);
      autoFilledAnswers[questionKey] = answer;
      glowLogger.info(`Debug mode: Auto-filled question "${questionKey}" with answer`, { answer: String(answer) });
    }

    // Build the steps for the flow (we need to set up the question steps even though we're skipping them)
    const clarifyingSteps: OnboardingStep[] = uniqueQuestionKeys.map((questionKey, index) => ({
      id: `predefined_question_${index + 1}`,
      component: 'ask_clarifying_coach_question' as const,
      title: `Question ${index + 1}`
    }));

    const disclaimerStep: OnboardingStep = { id: 'disclaimer', component: 'disclaimer', title: 'Disclaimer' };
    const generatingHypothesisStep: OnboardingStep = { id: 'generating_hypothesis', component: 'generating_hypothesis', title: 'Generating Hypothesis' };
    const planHypothesisStep: OnboardingStep = { id: 'plan_hypothesis', component: 'plan_hypothesis', title: 'Plan Hypothesis' };
    const generatingPlanStep: OnboardingStep = { id: 'generating_plan', component: 'generating_plan', title: 'Generating Your Plan' };
    const actionPlanReviewStep: OnboardingStep = { id: 'action_plan_review', component: 'action_plan_review', title: 'Review Your Plan' };

    // Find the current step index (should be at ask_user_name or shortly after)
    const instructionsStepIndex = this.state.steps.findIndex(step => step.component === 'onboarding_instructions');
    const insertIndex = instructionsStepIndex !== -1 ? instructionsStepIndex + 1 : this.state.currentStepIndex + 1;

    // Build new steps array
    const newSteps = [...this.state.steps.slice(0, insertIndex)];
    newSteps.push(...clarifyingSteps, disclaimerStep, generatingHypothesisStep, planHypothesisStep, generatingPlanStep, actionPlanReviewStep);

    // Find the disclaimer step index to navigate to
    const disclaimerIdx = newSteps.findIndex(step => step.component === 'disclaimer');

    // Update state with all the pre-filled data and advance to the disclaimer screen
    this.state = {
      ...this.state,
      steps: newSteps,
      clarifyingQuestions: uniqueQuestionKeys,
      clarifyingAnswers: uniqueQuestionKeys.map(key => {
        const answer = autoFilledAnswers[key];
        return typeof answer === 'string' ? answer : JSON.stringify(answer);
      }),
      clarifyingPlaceholders: new Array(uniqueQuestionKeys.length).fill(''),
      currentClarifyingQuestionIndex: uniqueQuestionKeys.length, // Mark all as answered
      answeredQuestions: autoFilledAnswers,
      questionSequence: uniqueQuestionKeys,
      currentStepIndex: disclaimerIdx,
      isEarlyTermination: false
    };

    this.onStateChange(this.state);

    glowLogger.info('Debug mode: Advancing to disclaimer screen', { 
      step_index: disclaimerIdx,
      total_questions_answered: uniqueQuestionKeys.length 
    });
  }

  /**
   * Get a debug answer for a question based on its configuration.
   * - For select/multi-select: returns first option
   * - For text: returns "Test"
   * - For slider: returns middle value
   */
  private getDebugAnswerForQuestion(questionKey: string): any {
    try {
      const config = require('../assets/onboarding_config');
      const questionConfig = config.question_bank?.[questionKey];

      if (!questionConfig) {
        glowLogger.warn(`Debug mode: No config found for question "${questionKey}", using "Test"`, {});
        return 'Test';
      }

      const uiWidget = questionConfig.ui_widget;

      switch (uiWidget) {
        case 'select':
        case 'multi_select':
          // Return first option
          const options = questionConfig.options_en || [];
          if (options.length > 0) {
            return uiWidget === 'multi_select' ? [options[0]] : options[0];
          }
          return 'Test';

        case 'slider':
          // Return middle value (default to 5 if no min/max specified)
          const min = questionConfig.min ?? 1;
          const max = questionConfig.max ?? 10;
          return Math.floor((min + max) / 2);

        case 'text':
        case 'textarea':
        default:
          return 'Test';
      }
    } catch (error) {
      glowLogger.error(`Debug mode: Error getting answer for question "${questionKey}"`, {
        error: error instanceof Error ? error.message : String(error)
      });
      return 'Test';
    }
  }

  /**
   * Check if the given name is the debug test name
   */
  static isDebugTestName(name: string): boolean {
    return name.trim() === DEBUG_TEST_NAME;
  }
}