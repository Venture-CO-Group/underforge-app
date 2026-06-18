import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getGoalImage } from '../assets/images/goals';
import { FontFamily } from '../constants/Typography';
import { OnboardingConfig } from '../types/onboarding_config';
import { CircularGallery, GalleryItem } from './CircularGallery';
import { CoachInfoHeader } from './CoachInfoHeader';
import { SectionNavigator } from './SectionNavigator';
import { ShaderBackground } from './ShaderBackground';

interface ChooseGoalProps {
  config: OnboardingConfig;
  selectedCoach: string;
  selectedGoal?: string | string[];
  customGoal?: string;
  customGoalPlaceholder?: string;
  userName?: string;
  userGender?: string;
  goalType: 'primary' | 'secondary';
  chosenPrimaryGoal?: string;
  onGoalSelect: (goal: string | string[], isCustom?: boolean) => void;
  onCustomGoalChange: (customGoal: string) => void;
  onNext: () => void;
  onPrevious?: () => void;
}

export const ChooseGoal: React.FC<ChooseGoalProps> = ({
  config,
  selectedCoach,
  selectedGoal = '',
  customGoal = '',
  customGoalPlaceholder = '',
  userName = '',
  userGender,
  goalType,
  chosenPrimaryGoal,
  onGoalSelect,
  onCustomGoalChange,
  onNext,
  onPrevious,
}) => {
  const { i18n, t } = useTranslation(['onboarding', 'common']);
  const isSpanish = i18n.language?.startsWith('es');

  const [selectedGoals, setSelectedGoals] = useState<string[]>(
    Array.isArray(selectedGoal) ? selectedGoal : (selectedGoal ? [selectedGoal] : (goalType === 'secondary' ? ['None'] : []))
  );

  const selectedCoachInfo = config.general_info.coach_selection[selectedCoach];

  // English options are used as internal values (passed to LLM). Display labels may be translated.
  const goalOptions: string[] = goalType === 'primary'
    ? config.general_info.primary_goals || []
    : config.general_info.secondary_goals || [];

  const goalDisplayOptions: string[] = goalType === 'primary'
    ? (isSpanish && config.general_info.primary_goals_es) ? config.general_info.primary_goals_es : goalOptions
    : (isSpanish && config.general_info.secondary_goals_es) ? config.general_info.secondary_goals_es : goalOptions;

  const getDisplayLabel = (englishOption: string): string => {
    const idx = goalOptions.indexOf(englishOption);
    return idx >= 0 ? (goalDisplayOptions[idx] ?? englishOption) : englishOption;
  };

  const isMultiSelect = goalType === 'secondary';

  const galleryItems: GalleryItem[] = useMemo(() => {
    if (goalType !== 'primary') return [];
    return goalOptions.map((goal: string, idx: number) => ({
      id: goal,
      image: getGoalImage(goal, userGender, selectedCoach),
      label: goalDisplayOptions[idx] ?? goal,
    }));
  }, [goalType, goalOptions, goalDisplayOptions, userGender, selectedCoach]);

  const getTitle = () => {
    if (isSpanish) {
      return goalType === 'primary'
        ? `¿Cuál es tu meta principal${userName ? `, ${userName}` : ''}?`
        : `¿Tienes metas secundarias${userName ? `, ${userName}` : ''}?`;
    }
    if (goalType === 'primary') {
      return `What is your main goal${userName ? `, ${userName}` : ''}?`;
    }
    return `Do you have secondary goals${userName ? `, ${userName}` : ''}?`;
  };

  const getSubtitle = () => {
    if (goalType === 'secondary') {
      return isSpanish ? 'Elige una o "Ninguna" para omitir' : 'Choose up to two or "None" to skip';
    }
    return undefined;
  };

  const getAlertTitle = () => {
    if (isSpanish) {
      return goalType === 'primary' ? 'Selecciona tu meta' : 'Selecciona tus metas secundarias';
    }
    return goalType === 'primary' ? 'Select Your Goal' : 'Select Your Secondary Goals';
  };

  const getAlertMessage = () => {
    if (isSpanish) {
      return goalType === 'primary'
        ? 'Por favor elige una meta principal para continuar.'
        : 'Por favor elige una meta secundaria para continuar.';
    }
    const goalTypeLabel = goalType === 'primary' ? 'improvement goal' : 'secondary goal';
    return `Please choose ${goalType === 'primary' ? 'a' : 'a'} ${goalTypeLabel} or describe your own to continue.`;
  };

  const handleOptionSelect = (option: string) => {
    if (isMultiSelect) {
      const newSelectedGoals = [option];
      setSelectedGoals(newSelectedGoals);
      onGoalSelect(newSelectedGoals, false);
    } else {
      onGoalSelect(option, false);
    }
  };

  const handleGallerySelect = (goalId: string) => {
    onGoalSelect(goalId, false);
  };

  const handleNext = () => {
    if (isMultiSelect) {
      onGoalSelect(selectedGoals, false);
    } else {
      const hasSelectedOption = selectedGoal;
      if (!hasSelectedOption) {
        Alert.alert(
          getAlertTitle(),
          getAlertMessage(),
          [{ text: 'OK', style: 'default' }]
        );
        return;
      }
      onGoalSelect(selectedGoal, false);
    }
    onNext();
  };

  const isOptionSelected = (option: string) => {
    if (isMultiSelect) {
      return selectedGoals.includes(option);
    } else {
      return selectedGoal === option;
    }
  };

  if (!selectedCoachInfo) {
    return null;
  }

  const isPrimary = goalType === 'primary';

  return (
    <View style={{ flex: 1 }}>
      <ShaderBackground offsetY="70%" />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView 
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
        >
          <CoachInfoHeader 
            config={config} 
            selectedCoach={selectedCoach} 
            imageSize="small" 
          />

          <SectionNavigator activeSection="you" />

          {isPrimary ? (
            <View style={styles.gallerySection}>
              <Text style={styles.questionText}>{getTitle()}</Text>
              <View style={styles.galleryWrapper}>
                <CircularGallery
                  items={galleryItems}
                  onItemSelect={handleGallerySelect}
                  selectedItemId={selectedGoal as string}
                />
              </View>
            </View>
          ) : (
            <ScrollView style={styles.contentContainer} showsVerticalScrollIndicator={false}>
              <Text style={styles.questionText}>{getTitle()}</Text>

              {getSubtitle() && (
                <Text style={styles.subtitleText}>{getSubtitle()}</Text>
              )}

              <View style={styles.optionsContainer}>
                {isMultiSelect && (
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      isOptionSelected('None') && styles.optionButtonSelected,
                    ]}
                    onPress={() => handleOptionSelect('None')}
                  >
                    <Text style={[
                      styles.optionText,
                      isOptionSelected('None') && styles.optionTextSelected,
                    ]}>
                      {isSpanish ? 'Ninguna - Omitir metas secundarias' : 'None - Skip secondary goals'}
                    </Text>
                    {isOptionSelected('None') && (
                      <View style={styles.checkmarkContainer}>
                        <Text style={styles.checkmark}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
                
                {goalOptions.map((option: string, index: number) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.optionButton,
                      isOptionSelected(option) && styles.optionButtonSelected,
                    ]}
                    onPress={() => handleOptionSelect(option)}
                  >
                    <Text style={[
                      styles.optionText,
                      isOptionSelected(option) && styles.optionTextSelected,
                    ]}>
                      {getDisplayLabel(option)}
                    </Text>
                    {isMultiSelect && isOptionSelected(option) && (
                      <View style={styles.checkmarkContainer}>
                        <Text style={styles.checkmark}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )}

          <View style={styles.buttonSection}>
            <View style={styles.buttonRow}>
              {onPrevious && (
                <TouchableOpacity style={styles.backButton} onPress={onPrevious}>
                  <Text style={styles.backButtonText}>{t('onboarding:questionBack')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.nextButton, onPrevious && styles.nextButtonWithBack]} onPress={handleNext}>
                <Text style={styles.nextButtonText}>{t('onboarding:questionNext')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
  },
  gallerySection: {
    flex: 1,
  },
  galleryWrapper: {
    flex: 1,
    marginHorizontal: -24,
  },
  contentContainer: {
    flex: 1,
  },
  questionText: {
    fontFamily: FontFamily.displayBold,
    fontSize: 22,
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 32,
  },
  subtitleText: {
    fontSize: 16,
    color: '#9AA3A6',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  selectionCounter: {
    alignItems: 'center',
    marginBottom: 20,
  },
  selectionCounterText: {
    fontSize: 14,
    color: '#F47C3C',
    fontWeight: '500',
    backgroundColor: '#fff9f7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
  optionsContainer: {
    marginBottom: 30,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: '#E0E0E0',
    borderRadius: 25,
    paddingVertical: 16,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  optionButtonSelected: {
    borderColor: '#F47C3C',
    backgroundColor: '#fff9f7',
  },
  optionButtonDisabled: {
    opacity: 0.5,
  },
  checkmark: {
    color: '#F47C3C',
    fontSize: 16,
    fontWeight: 'bold',
  },
  checkmarkContainer: {
    marginLeft: 8,
  },
  optionText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#F2F2EE',
    flex: 1,
    textAlign: 'left',
  },
  optionTextSelected: {
    color: '#F47C3C',
    fontWeight: '600',
  },
  optionTextDisabled: {
    color: '#6F7A7E',
  },
  buttonSection: {
    paddingBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    backgroundColor: '#E0E0E0',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 20,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#9AA3A6',
    fontSize: 14,
    fontWeight: '600',
  },
  nextButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: 'center',
    flex: 1,
  },
  nextButtonWithBack: {
    flex: 1,
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
