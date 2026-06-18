import { ClarifyingQuestion } from '../types/onboard';
import { FormField } from '../types/onboarding_config';

export type OnboardingStep = 'coach' | 'overview' | 'module_selection' | 'module_intro' | 'generating_questions' | 'clarifying_questions' | 'generating_plan' | 'action_plan_review' | 'plan_revision_input' | string;


// NOTE: this is distinct from the persisted onboarding state in types/onboard.ts: export interface Onboard {..}

export interface OnboardingState {
  currentStep: OnboardingStep;
  selectedCoach: string;
  formData: Record<string, any>;
  formFields: [string, FormField][];
  currentFieldIndex: number;
  selectedModules: string[];
  moduleData: Record<string, Record<string, any>>;
  currentModuleIndex: number;
  currentModuleFieldIndex: number;
  clarifyingQuestions: ClarifyingQuestion[];
  currentClarifyingQuestionIndex: number;
  isGeneratingQuestions: boolean;
  isGeneratingPlan: boolean;
  generatedActionPlan: any;
  revisionRequest: string;
  isRevising: boolean;
  validationErrors: Record<string, string>;
  otherValues: Record<string, string>;
  moduleOtherValues: Record<string, Record<string, string>>;
}

export interface StepProps {
  state: OnboardingState;
  config: any;
  updateState: (updates: Partial<OnboardingState>) => void;
  onNext?: () => void;
  onBack?: () => void;
}
