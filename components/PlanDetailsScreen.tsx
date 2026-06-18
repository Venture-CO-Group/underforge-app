import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { glowLogger } from '../lib/glow-logger';
import { getRemoteUserProfileLoggedInUser, updateUserProfile } from '../lib/supabase_db_new';
import { ActionPlan, ActionStep, Onboard } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import { StepDetailContent } from './StepDetailContent';

interface PlanDetailsScreenProps {
  step?: ActionStep;
  stepIndex?: number; // 0=training, 1=nutrition, 2=recovery&sleep
  actionPlan?: ActionPlan;
  onboardData?: Onboard;
  onBack: () => void;
  onSchedulePress?: () => void;
  onScheduleChange?: (stepId: string, newDaysOfWeek: string[], newTimeOfDay?: string) => void;
  isEditable?: boolean;
  onLogWorkout?: (step: ActionStep) => void;
  userProfile?: UserProfile;
  userGender?: string;
  selectedGoal?: string;
  userLocalId?: string;
  onStartSurvey?: (surveyType: 'nutrition' | 'recovery') => void;
  nutritionSurveyCompleted?: boolean;
  recoverySurveyCompleted?: boolean;
  onEditStep?: (stepIndex: number) => void;
  embedded?: boolean;
}

export const PlanDetailsScreen: React.FC<PlanDetailsScreenProps> = ({
  step,
  stepIndex,
  actionPlan,
  onboardData,
  onBack,
  onSchedulePress,
  onScheduleChange,
  isEditable = false,
  onLogWorkout,
  userProfile,
  userGender,
  selectedGoal,
  userLocalId,
  onStartSurvey,
  nutritionSurveyCompleted = false,
  recoverySurveyCompleted = false,
  onEditStep,
  embedded = false,
}) => {
  const { t } = useTranslation(['plan', 'common']);
  const [localStep, setLocalStep] = useState<ActionStep | undefined>(step);

  useEffect(() => {
    setLocalStep(step);
  }, [step]);

  const handleScheduleSave = async (stepId: string, selectedDays: string[], selectedTime?: string): Promise<void> => {
    try {
      if (onScheduleChange) {
        onScheduleChange(stepId, selectedDays, selectedTime);
        Alert.alert(
          t('plan:scheduleUpdatedTitle'),
          t('plan:scheduleUpdatedBody'),
          [{ text: t('common:ok') }]
        );
        return;
      }

      const userProfileData = await getRemoteUserProfileLoggedInUser();
      if (!userProfileData || !userProfileData.onboardingProfile.actionPlan) {
        Alert.alert(t('common:error'), t('plan:scheduleLoadError'));
        return;
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

      await updateUserProfile({
        user_id: userProfileData.onboardingProfile.localUserId!,
        onboardingProfile: updatedOnboardingData
      });

      Alert.alert(
        t('plan:scheduleUpdatedTitle'),
        t('plan:scheduleSavedBody'),
        [{ text: t('common:ok') }]
      );
    } catch (error) {
      glowLogger.error('Error saving schedule', { error });
      Alert.alert(t('common:error'), t('plan:scheduleSaveError'));
      throw error;
    }
  };

  const Wrapper = embedded ? View : SafeAreaView;

  return (
    <Wrapper style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>{t('plan:backButton')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('plan:stepDetailsTitle')}</Text>
        </View>
        {onEditStep && stepIndex !== undefined ? (
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => onEditStep(stepIndex)}
          >
            <Text style={styles.editButtonText}>{t('plan:editButton')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerRight} />
        )}
      </View>
      
      <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <StepDetailContent
            step={localStep}
            stepIndex={stepIndex}
            actionPlan={actionPlan}
            onboardData={onboardData}
            userProfile={userProfile}
            userGender={userGender}
            selectedGoal={selectedGoal}
            userLocalId={userLocalId}
            showImage={true}
            onLogWorkout={onLogWorkout}
            onStartSurvey={onStartSurvey}
            nutritionSurveyCompleted={nutritionSurveyCompleted}
            recoverySurveyCompleted={recoverySurveyCompleted}
            onSchedulePress={onSchedulePress}
            scheduleEditable={isEditable}
          />
        </View>
      </ScrollView>
    </Wrapper>
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
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#0B1114',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F47C3C',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 60,
  },
  backButtonText: {
    fontSize: 17,
    color: '#F47C3C',
    fontWeight: '400',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  headerRight: {
    width: 60,
  },
  editButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 60,
    alignItems: 'flex-end',
  },
  editButtonText: {
    fontSize: 17,
    color: '#F47C3C',
    fontWeight: '600',
  },
  scrollContainer: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
});
