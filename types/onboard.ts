import { coachToLLMString } from './onboarding_config';
import type { WorkoutPlan } from './workout';

export interface ClarifyingQuestion {
  id: string;
  question: string;
  context?: string;
  answer?: string;
}

export interface DetailedRationaleItem {
  text: string; // Main text of the rationale item
}

export interface NutritionTargets {
  caloriesTarget: number;
  carbsTarget: number;
  proteinTarget: number;
  fatTarget: number;
  fiberTarget: number;
}

export interface DietaryPlanOption {
  name: string;
  description?: string;
}

export interface DietaryPlan {
  breakfast: DietaryPlanOption[];
  lunch: DietaryPlanOption[];
  dinner: DietaryPlanOption[];
}

export interface BonusHack {
  text: string;
}

export interface ExpectedCheckin {
  step_id: string;
  step_title: string;
  dayOfWeek: string; // Single day (e.g., 'mon', 'tue', 'wed')
  timeOfDay?: string; // Time of day for this check-in (e.g., '23:00', '07:30')
  calculateTimestampForThisWeekCheckin(): string;
}

export enum CoachType {
  AI_ONLY = 'ai_only',
  AI_HUMAN_HYBRID = 'ai_human_hybrid'
}

export interface ActionStep {
  id: string;
  title: string;
  description: string;
  rationale: string; // Explanation of why this step is important and how it helps achieve the goal
  detailed_rationale?: DetailedRationaleItem[]; // Detailed explanation with bullet points and citations
  priority: 'high' | 'medium' | 'low';
  dateAdded: string; // ISO date string
  dateModified?: string; // ISO date string
  daysOfWeek?: string[]; // Days when this recurring plan should be executed (e.g., ['mon', 'wed', 'fri'])
  timeOfDay?: string; // Time of day for this step (e.g., '23:00', '07:30')
  step_details: string | {text: string}[] | {text: string} | WorkoutPlan;  // Additional details about the step. Can be a string, array of text objects, single text object, or structured workout plan.
  bonus_hacks?: BonusHack[];
  step_title_scroll?: string;  // Concise 2-3 word title for scrollable display
  nutrition_targets?: NutritionTargets; // Personalized nutrition targets (for nutrition step)
  dietary_plan?: DietaryPlan; // Personalized concrete meal options (for nutrition step) created from the post-onboarding survey
  phase_2_title?: string; // Title for the next progression phase (e.g., "Hypertrophy Focus")
  phase_3_title?: string; // Title for the mastery phase (e.g., "Peak Performance")
}

// Helper function to stringify ActionStep for LLM context
export function actionStepToLLMString(step: ActionStep): string {
  const lines = [
    `Title: ${step.title}`,
    `Description: ${step.description}`,
    `Rationale: ${step.rationale}`,
    `Priority: ${step.priority}`,
    `Date Added: ${step.dateAdded}`,
    step.dateModified ? `Date Modified: ${step.dateModified}` : '',
    `Days of Week: ${step.daysOfWeek?.join(', ') || 'N/A'}`,
    step.timeOfDay ? `Time of Day: ${step.timeOfDay}` : ''
  ];

  // Add detailed rationale if present
  if (step.detailed_rationale && step.detailed_rationale.length > 0) {
    lines.push('Detailed Rationale:');
    step.detailed_rationale.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.text}`);
    });
  }

  // Add step details if present
  if (step.step_details) {
    lines.push('Step Details:');
    if (typeof step.step_details === 'string') {
      lines.push(`  ${step.step_details}`);
    } else if (Array.isArray(step.step_details) && step.step_details.length > 0) {
      step.step_details.forEach((detail, index) => {
        lines.push(`  ${index + 1}. ${detail.text}`);
      });
    }
  }

  return lines.filter(Boolean).join('\n');

}

export interface ActionPlan { // TODO: DRY this with zod schema
  id: string;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  rationale: string; // Overall explanation of the plan's approach and why these steps work together
  steps: ActionStep[];
  
  actionPlanToLLMString(): string;
  getStepIds(): string[];
}

// Any changes here need to be synchronized with the Zod schema in lib/llm-service.ts
export interface HypothesisComponent {
  id: string;
  root_cause_hypothesis: string;  // Legacy
  root_cause_hypothesis_components: string[];  // For each hypothesis component, further break it down into 3 bullet points
  summary: string;
  toLLMString(): string;
}

// Any changes here need to be synchronized with the Zod schema in lib/llm-service.ts
export interface Hypothesis { 
  id: string;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  overall_hypothesis: string;  // Legacy, deprecated, use components instead
  overall_hypothesis_components: string[];  // The hypothesis broken down into components
  user_assessment_hypothesis?: string; // Optional user assessment of the hypothesis
  components: HypothesisComponent[];  
  
  toLLMString(): string;
}


export interface Onboard {
  // Required fields
  name: string;
  selectedCoach: string;
  coachId?: number; // Database coach ID from coaches table
  coach_type: CoachType; // Required field to record the coach type
  selectedModules: string[]; // Keep as array for future expansion, but will contain only one item
  selectedGoal: string; // Primary goal
  selectedSecondaryGoal?: string | string[]; // Secondary goal (can be array for multi-select or string for backward compatibility)
  chronic_illnesses: string[]; // Required multi-select field
  medications: string[]; // Required multi-select field
  supplements: string[]; // Required multi-select field
  allergies: string[]; // Required multi-select field
  motivationLevel: number; // Motivation level from 1 to 10
  motivationWhy: string; // Reason for their motivation
  time_available: string; // Time available to work on goals
  expertise_level: string; // Expertise level gained so far working on goals
  
  // Optional fields
  height?: string; // Optional field from config
  weight?: string; // Optional field from config
  localUserId?: string; // Local database user ID (optional, as it's added by callback handler)
  
  // System fields
  moduleData: Record<string, Record<string, any>>;   // No longer used
  clarifyingQuestions?: ClarifyingQuestion[];
  actionPlan?: ActionPlan;
  hypothesis?: Hypothesis;
  
  // Add conversation history for context
  recentConversations?: {
    userMessage: string;
    coachResponse: string;
    timestamp: string;
  }[];
  
  // Allow additional dynamic fields for future expansion
  [key: string]: any;

  toLLMString(): string;
}

export function copyOnboardWithoutActionPlan(onboard: Onboard): Onboard {
  const { actionPlan, ...onboardWithoutActionPlan } = onboard;
  return onboardWithoutActionPlan;
}

export function onboardToLLMString(onboard: Onboard): string {
  const lines: string[] = [];

  // Add user's goal
  if (onboard.selectedGoal) {
    lines.push(`User's goal: ${onboard.selectedGoal}`);
  }
  
  // Add user's secondary goal
  if (onboard.selectedSecondaryGoal) {
    const secondaryGoalText = Array.isArray(onboard.selectedSecondaryGoal) 
      ? onboard.selectedSecondaryGoal.join(', ')
      : onboard.selectedSecondaryGoal;
    lines.push(`User's secondary goal: ${secondaryGoalText}`);
  }
  
  // Add motivation data
  if (onboard.motivationLevel) {
    lines.push(`User's motivation level: ${onboard.motivationLevel}/10`);
  }
  
  if (onboard.motivationWhy) {
    lines.push(`User's motivation why: ${onboard.motivationWhy}`);
  }
  
  // Add time available and expertise level
  if (onboard.time_available) {
    lines.push(`Time available to work on goals: ${onboard.time_available}`);
  }
  
  if (onboard.expertise_level) {
    lines.push(`Expertise level gained so far working on goals: ${onboard.expertise_level}`);
  }
  
  // Coach information - lookup from config
  try {
    const config = require('../assets/onboarding_config');
    const coachInfo = config.general_info?.coach_selection?.[onboard.selectedCoach];
    if (coachInfo) {
      lines.push('');
      lines.push('Coach Information:');
      lines.push(coachToLLMString(coachInfo).split('\n').map(line => `  ${line}`).join('\n'));
    } else {
      lines.push(`Coach: ${onboard.selectedCoach} (no additional info found)`);
    }
  } catch (error) {
    console.error('Error loading coach config:', error);
    lines.push(`Coach: ${onboard.selectedCoach} (config unavailable)`);
  }

  // Action plan
  if (onboard.actionPlan?.steps?.length) {
    lines.push('Action Plan:');
    onboard.actionPlan.steps.forEach(step => {
      lines.push(`  Step to check in: "${step.title}" - ${step.description}`);
      lines.push(`    Step rationale: ${step.rationale}`);
      lines.push(`    Step priority: ${step.priority}`);
      lines.push(`    Step days: ${step.daysOfWeek?.join(', ') || 'N/A'}`);
      if (step.timeOfDay) {
        lines.push(`    Step time: ${step.timeOfDay}`);
      }
    });
  }

  // Module data (simplified)
  if (Object.keys(onboard.moduleData).length) {
    lines.push('Module Data:');
    Object.entries(onboard.moduleData).forEach(([module, data]) => {
      lines.push(`  ${module}: ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    });
  }
  
  // Recent conversations for context.
  //
  // PII policy: stored coach replies may contain the user's real first name
  // because chat output has `USER_NAME` substituted with the real name before
  // being saved (see `substituteUserName` in lib/llm-service.ts). When we feed
  // that history back into the LLM we MUST not leak the user's name to the
  // model — replace any occurrence of the user's display name with the
  // `USER_NAME` placeholder.
  if (onboard.recentConversations?.length) {
    const redactName = (text: string | undefined): string => {
      if (!text) return '';
      const name = (onboard.name || '').trim();
      if (name.length < 2) return text;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return text.replace(new RegExp(escaped, 'gi'), 'USER_NAME');
    };
    lines.push('Recent Conversations:');
    // Sort chronologically (oldest -> newest) so a numbered list reads in the
    // direction the user actually had the conversation. Some callers feed in
    // newest-first arrays, which would otherwise be rendered backwards.
    const sortedConversations = [...onboard.recentConversations].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });
    sortedConversations.slice(-20).forEach((conv, index) => {
      lines.push(`  Conversation ${index + 1}:`);
      lines.push(`    User: ${redactName(conv.userMessage)}`);
      lines.push(`    Coach: ${redactName(conv.coachResponse)}`);
      lines.push(`    Time: ${conv.timestamp}`);
    });
  }

  return lines.join('\n');
}

// Add helper functions for the toLLMString methods
export function hypothesisComponentToLLMString(component: HypothesisComponent): string {
  const lines = [
    `Root Cause Hypothesis: ${component.root_cause_hypothesis}`,
  ];
  if (component.root_cause_hypothesis_components && component.root_cause_hypothesis_components.length > 0) {
    lines.push('Root Cause Hypothesis Components:');
    component.root_cause_hypothesis_components.forEach((item, idx) => {
      lines.push(`  ${idx + 1}. ${item}`);
    });
  }
  lines.push(`Summary: ${component.summary}`);
  return lines.join('\n');
}

export function hypothesisToLLMString(hypothesis: Hypothesis): string {
  const lines = [
    `Overall Hypothesis: ${hypothesis.overall_hypothesis}`
  ];

  // Added: dump overall_hypothesis_components
  if (hypothesis.overall_hypothesis_components && hypothesis.overall_hypothesis_components.length > 0) {
    lines.push('Overall Hypothesis Components:');
    hypothesis.overall_hypothesis_components.forEach((item, idx) => {
      lines.push(`  ${idx + 1}. ${item}`);
    });
  }
  
  if (hypothesis.user_assessment_hypothesis) {
    lines.push(`The user assessment and additions to hypothesis: ${hypothesis.user_assessment_hypothesis}`);
  }
  
  if (hypothesis.components && hypothesis.components.length > 0) {
    lines.push('Components:');
    hypothesis.components.forEach((component, index) => {
      lines.push(`  Component ${index + 1}:`);
      const componentString = hypothesisComponentToLLMString(component);
      lines.push(componentString.split('\n').map(line => `    ${line}`).join('\n'));
    });
  }
  
  return lines.join('\n');
}

// Implementation function for ActionPlan
export function actionPlanToLLMString(actionPlan: ActionPlan): string {
  let result = '';
  if (actionPlan.steps) {
    actionPlan.steps.forEach((step: ActionStep, index: number) => {
      result += `\n${index + 1}. ${step.title} (${step.priority} priority)`;
      result += `\n   Step ID: ${step.id}`;
      result += `\n   Description: ${step.description}`;
    });
  }
  return result;
}

export function getStepIds(actionPlan: ActionPlan): string[] {
  return actionPlan.steps.map(step => step.id);
}
export const createHypothesisComponentMethods = () => ({
  toLLMString(this: HypothesisComponent): string {
    return hypothesisComponentToLLMString(this);
  }
});

export const createHypothesisMethods = () => ({
  toLLMString(this: Hypothesis): string {
    return hypothesisToLLMString(this);
  }
});

// Generate expected weekly checkins from an Onboard object's action plan
export function expectedWeeklyCheckins(onboard: Onboard): ExpectedCheckin[] {
  const expectedCheckins: ExpectedCheckin[] = [];
  
  // Check if action plan and steps exist
  if (!onboard.actionPlan?.steps || onboard.actionPlan.steps.length === 0) {
    return expectedCheckins;
  }
  
  // Loop through each action step
  onboard.actionPlan.steps.forEach(step => {
    // Check if the step has days of week defined
    if (step.daysOfWeek && step.daysOfWeek.length > 0) {
      // For each day of week, create an expected checkin
      step.daysOfWeek.forEach(dayOfWeek => {
        const expectedCheckin: ExpectedCheckin = {
          step_id: step.id,
          step_title: step.title,
          dayOfWeek: dayOfWeek,
          timeOfDay: step.timeOfDay,
          calculateTimestampForThisWeekCheckin(): string {
            return calculateTimestampForThisWeekCheckin(this);
          }
        };
        expectedCheckins.push(expectedCheckin);
      });
    }
  });
  
  return expectedCheckins;
}

// Helper function to implement the calculateTimestampForThisWeekCheckin method
export function calculateTimestampForThisWeekCheckin(expectedCheckin: ExpectedCheckin): string {
  const now = new Date();
  const today = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Map dayOfWeek strings to numeric day values
  const dayMap: Record<string, number> = {
    'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6
  };
  
  const targetDay = dayMap[expectedCheckin.dayOfWeek.toLowerCase()];
  if (targetDay === undefined) {
    throw new Error(`Invalid dayOfWeek: ${expectedCheckin.dayOfWeek}`);
  }
  
  // Calculate days difference (handle negative values for earlier in the week)
  let daysDiff = targetDay - today;
  if (daysDiff > 0) {
    // If target day is later this week, move to last week's occurrence
    daysDiff -= 7;
  }
  
  // Create the target date
  const targetDate = new Date(now);
  targetDate.setDate(now.getDate() + daysDiff);
  
  // Set time if provided, otherwise use current time
  if (expectedCheckin.timeOfDay) {
    const [hours, minutes] = expectedCheckin.timeOfDay.split(':').map(Number);
    if (hours !== undefined && minutes !== undefined) {
      targetDate.setHours(hours, minutes, 0, 0);
    }
  }
  
  return targetDate.toISOString();
}

export function expectedWeeklyCheckinsForDayOfWeek(onboard: Onboard, dayOfWeek: string): ExpectedCheckin[] {
  const expectedCheckins: ExpectedCheckin[] = [];
  
  // Check if action plan and steps exist
  if (!onboard.actionPlan?.steps || onboard.actionPlan.steps.length === 0) {
    return expectedCheckins;
  }
  
  // Loop through each action step
  onboard.actionPlan.steps.forEach(step => {
    // Check if the step has days of week defined and includes the requested day
    if (step.daysOfWeek && step.daysOfWeek.includes(dayOfWeek)) {
      const expectedCheckin: ExpectedCheckin = {
        step_id: step.id,
        step_title: step.title,
        dayOfWeek: dayOfWeek,
        timeOfDay: step.timeOfDay,
        calculateTimestampForThisWeekCheckin(): string {
          return calculateTimestampForThisWeekCheckin(this);
        }
      };
      expectedCheckins.push(expectedCheckin);
    }
  });
  
  return expectedCheckins;
}