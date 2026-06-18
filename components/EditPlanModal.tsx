import { VideoView } from 'expo-video';
import React from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { appIcons } from '../assets/icons';
import { useStableGenderForgingPlayer } from '../hooks/useStableGenderForgingPlayer';
import { glowLogger } from '../lib/glow-logger';
import { llmService } from '../lib/llm-service';
import { persistPlanNutritionTargets } from '../lib/nutrition-storage';
import { updateUserOnboardingProfileJson } from '../lib/supabase_db_new';
import { ActionStep } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import { Icon } from './Icon';
import { StepDetailContent } from './StepDetailContent';

const { width: screenWidth } = Dimensions.get('window');

interface EditPlanModalProps {
  visible: boolean;
  userProfile: UserProfile;
  onClose: () => void;
  onSave: (selectedStepIndex: number, feedback: string) => void;
  initialStepIndex?: number;
  initialFeedback?: string;
}

type EditScreen = 'select' | 'edit' | 'preview';

const STEP_OPTIONS = [
  { key: 'training', titleKey: 'editPlanStepTrainingTitle', subtitleKey: 'editPlanStepTrainingSubtitle', iconKey: 'training' as keyof typeof appIcons, stepIndex: 0 },
  { key: 'nutrition', titleKey: 'editPlanStepNutritionTitle', subtitleKey: 'editPlanStepNutritionSubtitle', iconKey: 'nutrition' as keyof typeof appIcons, stepIndex: 1 },
  { key: 'sleep_recovery', titleKey: 'editPlanStepRecoveryTitle', subtitleKey: 'editPlanStepRecoverySubtitle', iconKey: 'sleep' as keyof typeof appIcons, stepIndex: 2 },
];

export const EditPlanModal: React.FC<EditPlanModalProps> = ({
  visible,
  userProfile,
  onClose,
  onSave,
  initialStepIndex,
  initialFeedback,
}) => {
  const { t } = useTranslation(['plan', 'common']);
  const actionPlan = userProfile.onboardingProfile?.actionPlan;

  const [currentScreen, setCurrentScreen] = React.useState<EditScreen>('select');
  const [selectedStepIndex, setSelectedStepIndex] = React.useState<number>(-1);
  const [feedback, setFeedback] = React.useState('');
  const [changeHistory, setChangeHistory] = React.useState<string[]>([]);
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [updatedActionPlan, setUpdatedActionPlan] = React.useState<any>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const slideAnim = React.useRef(new Animated.Value(0)).current;
  const textInputRef = React.useRef<TextInput>(null);

  const genderQuestion = userProfile.onboardingProfile?.clarifyingQuestions?.find(
    (q: any) => q.question === 'gender_question'
  );
  const userGender = (genderQuestion?.answer || '').toString().toLowerCase();

  const forgingPlayer = useStableGenderForgingPlayer(userGender, 'manual');

  React.useEffect(() => {
    if (isUpdating) {
      forgingPlayer.play();
    } else {
      forgingPlayer.pause();
    }
  }, [isUpdating, forgingPlayer, userGender]);

  const getDisplayStep = (): ActionStep | undefined => {
    const plan = updatedActionPlan || actionPlan;
    if (!plan?.steps || selectedStepIndex < 0) return undefined;
    return plan.steps[selectedStepIndex];
  };

  const getPreviewStep = (): ActionStep | undefined => {
    if (!updatedActionPlan?.steps || selectedStepIndex < 0) return undefined;
    return updatedActionPlan.steps[selectedStepIndex];
  };

  React.useEffect(() => {
    if (visible) {
      if (initialStepIndex !== undefined && initialStepIndex >= 0) {
        setSelectedStepIndex(initialStepIndex);
        setFeedback(initialFeedback || '');
        setCurrentScreen('edit');
        slideAnim.setValue(-screenWidth);
      } else {
        setCurrentScreen('select');
        slideAnim.setValue(0);
      }
    }
  }, [visible, initialStepIndex]);

  const animateTo = (screen: EditScreen) => {
    const targets: Record<EditScreen, number> = {
      select: 0,
      edit: -screenWidth,
      preview: -screenWidth * 2,
    };
    setCurrentScreen(screen);
    Animated.timing(slideAnim, {
      toValue: targets[screen],
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const handleStepSelect = (stepIndex: number) => {
    setSelectedStepIndex(stepIndex);
    setFeedback('');
    setChangeHistory([]);
    setUpdatedActionPlan(null);
    animateTo('edit');
  };

  const handleConfirmChanges = async () => {
    if (feedback.trim() === '' || selectedStepIndex < 0) return;

    const currentFeedback = feedback.trim();

    try {
      setIsUpdating(true);
      if (!userProfile.onboardingProfile) {
        throw new Error('No onboarding profile found');
      }

      const newHistory = [...changeHistory, currentFeedback];

      const combinedFeedback = newHistory.length > 1
        ? `Previous change requests:\n${newHistory.slice(0, -1).map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\nNew change request:\n${newHistory[newHistory.length - 1]}`
        : currentFeedback;

      const onboardDataForLLM = updatedActionPlan
        ? { ...userProfile.onboardingProfile, actionPlan: updatedActionPlan }
        : userProfile.onboardingProfile;

      const updatedActionPlanResponse = await llmService.generateUserEditedActionPlanStep(
        onboardDataForLLM,
        selectedStepIndex,
        combinedFeedback
      );

      glowLogger.info('LLM successfully updated action plan step', {
        original_step_index: selectedStepIndex
      });

      setChangeHistory(newHistory);
      setUpdatedActionPlan(updatedActionPlanResponse.actionPlan);
      setFeedback('');
      setIsUpdating(false);
      animateTo('preview');

    } catch (error) {
      glowLogger.error('Failed to update action plan step via LLM', {
        error: error instanceof Error ? error.message : String(error),
        step_index: selectedStepIndex,
      });
      setIsUpdating(false);
      Alert.alert(
        t('plan:editPlanUpdateFailedTitle'),
        t('plan:editPlanUpdateFailedBody'),
        [{ text: t('common:ok') }]
      );
    }
  };

  const handleAcceptChanges = async () => {
    if (!updatedActionPlan || isSaving) return;

    try {
      setIsSaving(true);

      if (!userProfile.onboardingProfile) {
        Alert.alert(t('plan:editPlanSaveFailedTitle'), t('plan:editPlanSaveFailedShort'), [{ text: t('common:ok') }]);
        return;
      }

      const updatedOnboardData = {
        ...userProfile.onboardingProfile,
        actionPlan: updatedActionPlan
      };

      await updateUserOnboardingProfileJson(userProfile.user_id, updatedOnboardData);

      glowLogger.info('Successfully saved updated onboarding profile', {
        user_id: userProfile.user_id
      });

      // Refresh persisted nutrition targets when the edited plan changes step_2.
      try {
        await persistPlanNutritionTargets({
          userId: userProfile.user_id,
          actionPlan: updatedActionPlan,
          onboardData: updatedOnboardData,
        });
      } catch (e) {
        glowLogger.warn('Failed to persist plan nutrition targets after plan edit', {
          error: e instanceof Error ? e.message : String(e),
          user_id: userProfile.user_id,
        });
      }

      onSave(selectedStepIndex, changeHistory.join('; '));
      resetAndClose();
    } catch (error) {
      glowLogger.error('Failed to save updated onboarding profile', {
        error: error instanceof Error ? error.message : String(error),
        user_id: userProfile.user_id,
      });
      Alert.alert(
        t('plan:editPlanSaveFailedTitle'),
        t('plan:editPlanSaveFailedNetwork'),
        [{ text: t('common:ok') }]
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestFurtherChanges = () => {
    setFeedback('');
    animateTo('edit');
  };

  const handleBackFromEdit = () => {
    if (initialStepIndex !== undefined && initialStepIndex >= 0) {
      resetAndClose();
    } else {
      setFeedback('');
      animateTo('select');
    }
  };

  const resetAndClose = () => {
    setCurrentScreen('select');
    setSelectedStepIndex(-1);
    setFeedback('');
    setChangeHistory([]);
    setUpdatedActionPlan(null);
    setIsUpdating(false);
    setIsSaving(false);
    slideAnim.setValue(0);
    onClose();
  };

  const selectedStepOption = STEP_OPTIONS.find(s => s.stepIndex === selectedStepIndex);
  const stepLabel = selectedStepOption ? t(`plan:${selectedStepOption.titleKey}`) : t('plan:editPlanStepFallback');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={resetAndClose}
    >
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
          <Animated.View style={[styles.slidingRow, { transform: [{ translateX: slideAnim }] }]}>

            {/* Screen 1: Step Selection */}
            <View style={styles.screen}>
              <View style={styles.header}>
                <TouchableOpacity onPress={resetAndClose} style={styles.headerButton}>
                  <Text style={styles.cancelText}>{t('common:cancel')}</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('plan:editPlanTitle')}</Text>
                <View style={styles.headerButton} />
              </View>

              <ScrollView style={styles.selectContent} contentContainerStyle={styles.selectContentInner}>
                <Text style={styles.selectPrompt}>{t('plan:editPlanPrompt')}</Text>

                {STEP_OPTIONS.map((option) => {
                  const step = actionPlan?.steps?.[option.stepIndex];
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={styles.stepCard}
                      onPress={() => handleStepSelect(option.stepIndex)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.stepCardIcon}>
                        <Icon source={appIcons[option.iconKey]} width={28} height={28} fill="#F47C3C" />
                      </View>
                      <View style={styles.stepCardContent}>
                        <Text style={styles.stepCardTitle}>{t(`plan:${option.titleKey}`)}</Text>
                        <Text style={styles.stepCardSubtitle}>{step?.title || t(`plan:${option.subtitleKey}`)}</Text>
                      </View>
                      <Text style={styles.stepCardChevron}>›</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Screen 2: 75/25 Edit */}
            <View style={styles.screen}>
              <View style={styles.header}>
                <TouchableOpacity onPress={handleBackFromEdit} style={styles.headerButton} disabled={isUpdating}>
                  <Text style={[styles.cancelText, isUpdating && { opacity: 0.3 }]}>‹ {t('common:back')}</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('plan:editPlanEditStepTitle', { step: stepLabel })}</Text>
                <View style={styles.headerButton} />
              </View>

              <KeyboardAvoidingView
                style={styles.editBody}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={60}
              >
                <ScrollView
                  style={styles.editDetailPane}
                  contentContainerStyle={styles.editDetailPaneInner}
                  showsVerticalScrollIndicator={true}
                  keyboardShouldPersistTaps="never"
                >
                  <StepDetailContent
                    step={getDisplayStep()}
                    stepIndex={selectedStepIndex}
                    userProfile={userProfile}
                    showImage={false}
                  />
                </ScrollView>

                <View style={styles.editInputPane}>
                  <View style={styles.inputDivider} />
                  {changeHistory.length > 0 && !isUpdating && (
                    <Text style={styles.iterationHint}>
                      {t('plan:editPlanIterationHint', { count: changeHistory.length + 1 })}
                    </Text>
                  )}
                  <TextInput
                    ref={textInputRef}
                    style={styles.feedbackInput}
                    placeholder={t('plan:editPlanFeedbackPlaceholder')}
                    placeholderTextColor="#6F7A7E"
                    multiline
                    value={feedback}
                    onChangeText={setFeedback}
                    textAlignVertical="top"
                    editable={!isUpdating}
                  />
                  <View style={styles.editActions}>
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={handleBackFromEdit}
                      disabled={isUpdating}
                    >
                      <Text style={styles.backButtonText}>{t('common:cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.confirmButton,
                        (feedback.trim() === '' || isUpdating) && styles.buttonDisabled
                      ]}
                      disabled={feedback.trim() === '' || isUpdating}
                      onPress={handleConfirmChanges}
                    >
                      <Text style={styles.confirmButtonText}>{t('plan:editPlanConfirmChanges')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </KeyboardAvoidingView>

              {/* Forging overlay while LLM is updating */}
              {isUpdating && (
                <View style={styles.forgingOverlay}>
                  <VideoView
                    player={forgingPlayer}
                    style={styles.forgingVideo}
                    contentFit="cover"
                    nativeControls={false}
                    {...(Platform.OS === 'android' ? { surfaceType: 'textureView' as const } : {})}
                  />
                  <View style={styles.forgingDarkOverlay} />
                  <View style={styles.forgingContent}>
                    <ActivityIndicator size="large" color="#F47C3C" style={{ marginBottom: 24 }} />
                    <Text style={styles.forgingTitle}>{t('plan:editPlanForgingTitle')}</Text>
                    <Text style={styles.forgingSubtitle}>
                      {t('plan:editPlanForgingSubtitle', { step: stepLabel.toLowerCase() })}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* Screen 3: Preview */}
            <View style={styles.screen}>
              <View style={styles.header}>
                <TouchableOpacity onPress={resetAndClose} style={styles.headerButton} disabled={isSaving}>
                  <Text style={[styles.cancelText, isSaving && { opacity: 0.3 }]}>{t('common:cancel')}</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('plan:editPlanReviewChanges')}</Text>
                <View style={styles.headerButton} />
              </View>

              <ScrollView
                style={styles.previewContent}
                contentContainerStyle={styles.previewContentInner}
                showsVerticalScrollIndicator={true}
              >
                <StepDetailContent
                  step={getPreviewStep()}
                  stepIndex={selectedStepIndex}
                  userProfile={userProfile}
                  showImage={false}
                />
              </ScrollView>

              <View style={styles.previewActions}>
                <TouchableOpacity
                  style={[styles.acceptButton, isSaving && styles.buttonDisabled]}
                  disabled={isSaving}
                  onPress={handleAcceptChanges}
                >
                  {isSaving ? (
                    <View style={styles.buttonRow}>
                      <ActivityIndicator size="small" color="#fff" style={styles.spinner} />
                      <Text style={styles.acceptButtonText}>{t('plan:editPlanSaving')}</Text>
                    </View>
                  ) : (
                    <Text style={styles.acceptButtonText}>{t('plan:editPlanAcceptChanges')}</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.furtherChangesButton}
                  onPress={handleRequestFurtherChanges}
                  disabled={isSaving}
                >
                  <Text style={styles.furtherChangesText}>{t('plan:editPlanRequestFurtherChanges')}</Text>
                </TouchableOpacity>
              </View>
            </View>

          </Animated.View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
    overflow: 'hidden',
  },
  slidingRow: {
    flex: 1,
    flexDirection: 'row',
    width: screenWidth * 3,
  },
  screen: {
    width: screenWidth,
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#0E1A1A',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A3638',
  },
  headerButton: {
    width: 70,
    paddingVertical: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
    textAlign: 'center',
  },
  cancelText: {
    fontSize: 17,
    color: '#F47C3C',
    fontWeight: '400',
  },

  // Screen 1: Select
  selectContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  selectContentInner: {
    paddingTop: 32,
    paddingBottom: 40,
  },
  selectPrompt: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 28,
    lineHeight: 28,
  },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  stepCardIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(244, 124, 60, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  stepCardContent: {
    flex: 1,
  },
  stepCardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 4,
  },
  stepCardSubtitle: {
    fontSize: 14,
    color: '#9AA3A6',
    lineHeight: 20,
  },
  stepCardChevron: {
    fontSize: 24,
    color: '#F47C3C',
    fontWeight: '600',
    marginLeft: 8,
  },

  // Screen 2: Edit (75/25 split)
  editBody: {
    flex: 1,
  },
  editDetailPane: {
    flex: 2,
    paddingHorizontal: 20,
  },
  editDetailPaneInner: {
    paddingTop: 16,
    paddingBottom: 20,
  },
  editInputPane: {
    flex: 1,
    minHeight: 140,
    maxHeight: 220,
    backgroundColor: '#0E1A1A',
  },
  inputDivider: {
    height: 1,
    backgroundColor: '#2A3638',
  },
  iterationHint: {
    fontSize: 12,
    color: '#F47C3C',
    paddingHorizontal: 20,
    paddingTop: 10,
    fontWeight: '500',
  },
  feedbackInput: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    fontSize: 16,
    color: '#F2F2EE',
    minHeight: 60,
  },
  editActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: 8,
  },
  backButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#1E2E2E',
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  backButtonText: {
    color: '#9AA3A6',
    fontSize: 17,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 2,
    backgroundColor: '#4FAE8A',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    marginRight: 8,
  },

  // Forging overlay
  forgingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  forgingVideo: {
    ...StyleSheet.absoluteFillObject,
  },
  forgingDarkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(30, 14, 6, 0.65)',
  },
  forgingContent: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    zIndex: 10,
  },
  forgingTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 12,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  forgingSubtitle: {
    fontSize: 16,
    color: '#C8CDD0',
    textAlign: 'center',
    lineHeight: 24,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Screen 3: Preview
  previewContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  previewContentInner: {
    paddingTop: 16,
    paddingBottom: 40,
  },
  previewActions: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: '#0E1A1A',
    borderTopWidth: 1,
    borderTopColor: '#2A3638',
    gap: 10,
  },
  acceptButton: {
    backgroundColor: '#4FAE8A',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  furtherChangesButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F47C3C',
  },
  furtherChangesText: {
    color: '#F47C3C',
    fontSize: 17,
    fontWeight: '600',
  },
});
