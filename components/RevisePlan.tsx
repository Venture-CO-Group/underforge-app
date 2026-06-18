import React from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { coachImages } from '../assets/images/coaches';
import { OnboardingConfig } from '../types/onboarding_config';

interface RevisePlanProps {
  config: OnboardingConfig;
  selectedCoach: string;
  revisionRequest: string;
  selectedStepIndex?: number;
  onRevisionRequestChange: (text: string) => void;
  onRevisionStepIndexChange: (stepIndex?: number) => void;
  onRevisionSubmit: () => void;
  onCancel?: () => void;
}

const STEP_OPTIONS = [
  { key: 'training', title: 'Training', subtitle: 'Workout routines and exercises', stepIndex: 0 },
  { key: 'nutrition', title: 'Nutrition', subtitle: 'Diet, meals, and macros', stepIndex: 1 },
  { key: 'recovery', title: 'Sleep & Recovery', subtitle: 'Rest, sleep, and recovery habits', stepIndex: 2 },
];

export const RevisePlan: React.FC<RevisePlanProps> = ({
  config,
  selectedCoach,
  revisionRequest,
  selectedStepIndex,
  onRevisionRequestChange,
  onRevisionStepIndexChange,
  onRevisionSubmit,
  onCancel
}) => {
  const { t } = useTranslation(['plan', 'onboarding']);
  const selectedCoachInfo = config.general_info.coach_selection[selectedCoach];
  
  const getCoachImage = (imageName: string) => {
    return coachImages[imageName as keyof typeof coachImages] || null;
  };

  const dismissKeyboard = () => {
    // Keyboard.dismiss() would be called here if needed
  };

  const coachImage = getCoachImage(selectedCoachInfo.image);
  const canSubmit = revisionRequest.trim().length > 0 && selectedStepIndex !== undefined;

  if (!selectedCoachInfo) {
    return null;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView 
        style={styles.container}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <TouchableWithoutFeedback onPress={dismissKeyboard}>
          <View style={styles.fieldScreenContent}>
            <View style={styles.fieldHeader}>
              {coachImage ? (
                <Image source={coachImage} style={styles.coachImageSmall} />
              ) : (
                <View style={styles.coachImagePlaceholderSmall}>
                  <Text style={styles.coachImageTextSmall}>
                    {selectedCoachInfo.label_en.charAt(0)}
                  </Text>
                </View>
              )}
              <Text style={styles.fieldCoachName}>
                {t('onboarding:coachLabel', { name: selectedCoachInfo.label_en })}
              </Text>
            </View>

            <ScrollView 
              style={styles.fieldScrollView}
              contentContainerStyle={styles.fieldContent}
              keyboardShouldPersistTaps="never"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.fieldQuestion}>
                {t('plan:revisePlanQuestion')}
              </Text>

              <Text style={styles.selectionLabel}>
                {t('plan:revisePlanStepLabel')}
              </Text>

              <View style={styles.stepOptionsContainer}>
                {STEP_OPTIONS.map((option) => {
                  const isSelected = selectedStepIndex === option.stepIndex;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.stepCard, isSelected && styles.stepCardSelected]}
                      onPress={() => onRevisionStepIndexChange(option.stepIndex)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.stepCardTitle, isSelected && styles.stepCardTitleSelected]}>
                        {option.title}
                      </Text>
                      <Text style={[styles.stepCardSubtitle, isSelected && styles.stepCardSubtitleSelected]}>
                        {option.subtitle}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              
              <View style={styles.fieldInputContainer}>
                <TextInput
                  style={[styles.input, styles.revisionInput]}
                  value={revisionRequest}
                  onChangeText={onRevisionRequestChange}
                  placeholder={t('plan:revisePlanPlaceholder')}
                  multiline={true}
                  textAlignVertical="top"
                  scrollEnabled={false}
                  autoFocus={true}
                  blurOnSubmit={false}
                  returnKeyType="done"
                  placeholderTextColor="#666"
                />
              </View>

              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  style={[styles.fieldNextButton, !canSubmit && styles.fieldNextButtonDisabled]}
                  onPress={onRevisionSubmit}
                  disabled={!canSubmit}
                >
                  <Text style={styles.fieldNextButtonText}>{t('plan:revisePlanButton')}</Text>
                </TouchableOpacity>
                
                {onCancel && (
                  <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
                    <Text style={styles.cancelButtonText}>{t('plan:revisePlanCancel')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0E1A1A',
  },
  container: {
    flex: 1,
  },
  fieldScreenContent: {
    flex: 1,
  },
  fieldHeader: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  coachImageSmall: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginBottom: 12,
  },
  coachImagePlaceholderSmall: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F47C3C',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  coachImageTextSmall: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  fieldCoachName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  fieldScrollView: {
    flex: 1,
  },
  fieldContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  fieldQuestion: {
    fontSize: 24,
    fontWeight: '600',
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 30,
    lineHeight: 32,
  },
  selectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C8CDD0',
    marginBottom: 12,
  },
  stepOptionsContainer: {
    gap: 12,
    marginBottom: 24,
  },
  stepCard: {
    borderWidth: 1,
    borderColor: '#314244',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#132021',
    minHeight: 60,
    justifyContent: 'center',
  },
  stepCardSelected: {
    borderColor: '#F47C3C',
    backgroundColor: 'rgba(244, 124, 60, 0.12)',
  },
  stepCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 4,
  },
  stepCardTitleSelected: {
    color: '#FFD0B8',
  },
  stepCardSubtitle: {
    fontSize: 13,
    color: '#9AA3A6',
    lineHeight: 18,
  },
  stepCardSubtitleSelected: {
    color: '#F2F2EE',
  },
  fieldInputContainer: {
    marginBottom: 30,
  },
  input: {
    borderWidth: 2,
    borderColor: '#E0E0E0',
    borderRadius: 15,
    padding: 16,
    fontSize: 16,
    backgroundColor: '#0E1A1A',
    color: '#F2F2EE',
  },
  revisionInput: {
    minHeight: 150,
    textAlignVertical: 'top',
  },
  buttonContainer: {
    gap: 12,
  },
  fieldNextButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: 'center',
  },
  fieldNextButtonDisabled: {
    opacity: 0.45,
  },
  fieldNextButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  cancelButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#9AA3A6',
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#9AA3A6',
    fontSize: 18,
    fontWeight: '600',
  },
});