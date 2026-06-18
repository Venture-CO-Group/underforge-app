import { Alert } from 'react-native';
import { glowLogger } from './glow-logger';
import { HypothesisResponse, llmService, LLMService } from './llm-service';
import { persistPlanNutritionTargets } from './nutrition-storage';
import { updateUserProfile } from './supabase_db_new';
import { 
  hypothesisToLLMString, 
  Onboard, 
  createHypothesisComponentMethods,
  createHypothesisMethods 
} from '../types/onboard';
import { UserProfile } from '../types/user_profile';

export interface RegenerationCallbacks {
  onLoadingStart: (message: string) => void;
  onLoadingEnd: () => void;
  onError: (title: string, message: string) => void;
  onSuccess?: (result: any) => void;
}

/**
 * Regenerates the hypothesis for a given user profile
 */
export const regenerateHypothesis = async (
  userProfile: UserProfile,
  systemPrompt: string,
  userPrompt: string,
  callbacks: RegenerationCallbacks
): Promise<{ updatedOnboardingData: Onboard; newHypothesis: HypothesisResponse } | null> => {
  const onboardingData = userProfile.onboardingProfile;
  
  if (!onboardingData) {
    callbacks.onError('No Onboarding Data', 'No onboarding data found. Complete onboarding first.');
    return null;
  }

  try {
    callbacks.onLoadingStart('Generating new hypothesis...');
    
    glowLogger.info('Starting hypothesis regeneration', {
      user_id: userProfile.user_id,
      user_name: onboardingData.name,
      selected_goal: onboardingData.selectedGoal,
      existing_hypothesis: !!onboardingData.hypothesis
    });

    // Generate new hypothesis
    const newHypothesis = await llmService.generateHypothesis(onboardingData, systemPrompt, userPrompt);
    
    callbacks.onLoadingStart('Saving new hypothesis to Supabase...');

    // Update the onboarding data with new hypothesis, ensuring proper method assignments
    const hypothesisWithMethods = {
      ...newHypothesis,
      components: newHypothesis.components.map(component => ({
        ...component,
        ...createHypothesisComponentMethods()
      })),
      ...createHypothesisMethods()
    };

    const updatedOnboardingData = {
      ...onboardingData,
      hypothesis: hypothesisWithMethods
    };

    // Save to Supabase for the target user
    await updateUserProfile({
      user_id: userProfile.user_id,
      onboardingProfile: updatedOnboardingData
    }, true);
    
    glowLogger.info('Successfully saved regenerated hypothesis to Supabase', {
      user_id: userProfile.user_id,
      user_name: updatedOnboardingData.name,
      hypothesis_id: newHypothesis.id
    });

    callbacks.onLoadingEnd();
    callbacks.onSuccess?.({ updatedOnboardingData, newHypothesis });
    
    return { updatedOnboardingData, newHypothesis };
  } catch (error) {
    callbacks.onLoadingEnd();
    
    glowLogger.error('Failed to regenerate hypothesis', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userProfile.user_id,
      user_name: onboardingData?.name
    });
    
    callbacks.onError(
      'Regeneration Failed',
      'Failed to regenerate the hypothesis. Please check your internet connection and try again.'
    );
    
    return null;
  }
};

/**
 * Regenerates the action plan for a given user profile
 */
export const regenerateActionPlan = async (
  userProfile: UserProfile,
  systemPrompt: string,
  userPrompt: string,
  callbacks: RegenerationCallbacks
): Promise<Onboard | null> => {
  const onboardingData = userProfile.onboardingProfile;
  
  if (!onboardingData) {
    callbacks.onError('No Onboarding Data', 'No onboarding data found. Complete onboarding first.');
    return null;
  }

  try {
    callbacks.onLoadingStart('Generating new action plan...');
    
    glowLogger.info('Starting plan regeneration', {
      user_id: userProfile.user_id,
      user_name: onboardingData.name,
      selected_goal: onboardingData.selectedGoal,
      existing_plan_steps: onboardingData.actionPlan?.steps?.length || 0
    });

    // Generate new action plan
    const newActionPlan = await llmService.generateActionPlan(onboardingData, systemPrompt, userPrompt);
    
    callbacks.onLoadingStart('Saving new plan to Supabase...');
    
    // Update the onboarding data with the new action plan
    const updatedOnboardingData: Onboard = {
      ...onboardingData,
      actionPlan: newActionPlan.actionPlan
    };

    // Save to Supabase for the target user
    await updateUserProfile({
      user_id: userProfile.user_id,
      onboardingProfile: updatedOnboardingData
    }, true);

    // Refresh persisted nutrition targets so all readers pick up the new plan.
    try {
      if (newActionPlan?.actionPlan) {
        await persistPlanNutritionTargets({
          userId: userProfile.user_id,
          actionPlan: newActionPlan.actionPlan,
          onboardData: updatedOnboardingData,
        });
      }
    } catch (e) {
      glowLogger.warn('Failed to persist plan nutrition targets after regeneration', {
        error: e instanceof Error ? e.message : String(e),
        user_id: userProfile.user_id,
      });
    }

    glowLogger.info('Successfully regenerated and saved action plan', {
      user_id: userProfile.user_id,
      user_name: updatedOnboardingData.name,
      new_plan_steps: newActionPlan.actionPlan?.steps?.length || 0
    });

    callbacks.onLoadingEnd();
    callbacks.onSuccess?.(updatedOnboardingData);
    
    return updatedOnboardingData;
  } catch (error) {
    callbacks.onLoadingEnd();
    
    glowLogger.error('Failed to regenerate action plan', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userProfile.user_id,
      user_name: onboardingData?.name
    });
    
    callbacks.onError(
      'Regeneration Failed',
      'Failed to regenerate the action plan. Please check your internet connection and try again.'
    );
    
    return null;
  }
};

/**
 * Build prompts for hypothesis regeneration
 */
export const buildHypothesisPrompts = (onboardingData: Onboard) => {
  return {
    systemPrompt: LLMService.buildHypothesisSystemPrompt(),
    userPrompt: LLMService.buildHypothesisUserPrompt(onboardingData)
  };
};

/**
 * Build prompts for action plan regeneration
 */
export const buildActionPlanPrompts = (onboardingData: Onboard) => {
  return {
    systemPrompt: LLMService.buildActionPlanSystemPrompt(),
    userPrompt: LLMService.buildActionPlanUserPrompt(onboardingData)
  };
};