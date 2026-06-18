import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { onboardingEvents } from '../lib/supabase_db';
import { getRemoteUserProfileLoggedInUser } from '../lib/supabase_db_new';
import { ActionPlan } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import { PlanOverviewAndSteps } from './PlanOverviewAndSteps';

interface PlanMainScreenProps {
  userProfile: UserProfile;
  onClose: () => void;
  onStepPress: (stepIndex: number) => void;
  nutritionSurveyCompleted?: boolean;
  recoverySurveyCompleted?: boolean;
  onStartSurvey?: (surveyType: 'nutrition' | 'recovery') => void;
  embedded?: boolean;
}

export const PlanMainScreen: React.FC<PlanMainScreenProps> = ({
  userProfile,
  onClose,
  onStepPress,
  nutritionSurveyCompleted = false,
  recoverySurveyCompleted = false,
  onStartSurvey,
  embedded = false,
}) => {

  const { t } = useTranslation(['plan']);
  const [localActionPlan, setLocalActionPlan] = useState<ActionPlan | undefined>(userProfile.onboardingProfile?.actionPlan);
  const [localCoachName, setLocalCoachName] = useState<string>(userProfile.onboardingProfile?.selectedCoach || '');
  const [openEditModalFunction, setOpenEditModalFunction] = useState<(() => void) | null>(null);

  const handleEditPress = React.useCallback(() => {
    console.log('[PlanMainScreen] handleEditPress called, openEditModalFunction:', !!openEditModalFunction);
    if (openEditModalFunction) {
      openEditModalFunction();
    }
  }, [openEditModalFunction]);

  const handleSetOpenEditModalFunction = React.useCallback((fn: () => void) => {
    console.log('[PlanMainScreen] handleSetOpenEditModalFunction called');
    setOpenEditModalFunction(() => fn);
  }, []);

  // Subscribe to onboarding data changes
  useEffect(() => {
    const handler = async (event: any) => {
      console.log('[PlanMainScreen] onboardingDataChanged event received:', event);
      try {
        const data = await getRemoteUserProfileLoggedInUser();
        if (data && data.onboardingProfile) {
          console.log('[PlanMainScreen] Reloading plan data');
          if (data.onboardingProfile.actionPlan) {
            setLocalActionPlan(data.onboardingProfile.actionPlan);
          }
          if (data.onboardingProfile.selectedCoach) {
            setLocalCoachName(data.onboardingProfile.selectedCoach);
          }
        }
      } catch (error) {
        console.error('[PlanMainScreen] Error reloading plan data:', error);
      }
    };
    
    onboardingEvents.on('onboardingDataChanged', handler);
    console.log('[PlanMainScreen] Subscribed to onboardingDataChanged events');

    return () => {
      onboardingEvents.off('onboardingDataChanged', handler);
      console.log('[PlanMainScreen] Unsubscribed from onboardingDataChanged events');
    };
  }, []);

  // Update when props change
  useEffect(() => {
    setLocalActionPlan(userProfile.onboardingProfile?.actionPlan);
  }, [userProfile.onboardingProfile?.actionPlan]);

  useEffect(() => {
    setLocalCoachName(userProfile.onboardingProfile?.selectedCoach || '');
  }, [userProfile.onboardingProfile?.selectedCoach]);

  const Wrapper = embedded ? View : SafeAreaView;

  return (
    <Wrapper style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft} />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('plan:headerTitle')}</Text>
          <Text style={styles.headerSubtitle}>{t('plan:headerByCoach', { coachName: localCoachName })}</Text>
        </View>
        <TouchableOpacity 
          style={styles.editButton}
          onPress={handleEditPress}
        >
          <Text style={styles.editButtonText} numberOfLines={1}>{t('plan:editButton')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {localActionPlan && (
          <PlanOverviewAndSteps
            actionPlan={localActionPlan}
            userProfile={userProfile}
            onStepPress={onStepPress}
            showFrequency={true}
            onEditPress={handleSetOpenEditModalFunction}
            nutritionSurveyCompleted={nutritionSurveyCompleted}
            recoverySurveyCompleted={recoverySurveyCompleted}
            onStartSurvey={onStartSurvey}
          />
        )}
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
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: '#0E1A1A',
    borderBottomWidth: 1,
    borderBottomColor: '#1A2426',
  },
  headerLeft: {
    width: 76,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F2F2EE',
    fontFamily: 'PlayfairDisplay-Bold',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9AA3A6',
  },
  editButton: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    width: 76,
    alignItems: 'flex-end',
  },
  editButtonText: {
    color: '#F47C3C',
    fontSize: 16,
    fontWeight: '600',
  },
  headerRight: {
    width: 64,
  },
  coachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 18,
    backgroundColor: '#0E1A1A',
    marginBottom: 24,
  },
  coachImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginRight: 14,
  },
  coachImagePlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F47C3C',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  coachImageText: {
    color: '#0B1114',
    fontSize: 22,
    fontWeight: '600',
  },
  coachInfo: {
    flex: 1,
  },
  coachName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 3,
  },
  planDate: {
    fontSize: 14,
    color: '#9AA3A6',
  },
  scrollContainer: {
    flex: 1,
  },
});