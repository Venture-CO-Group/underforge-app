import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontFamily } from '../constants/Typography';
import { OnboardingConfig } from '../types/onboarding_config';
import { CoachInfoHeader } from './CoachInfoHeader';
import { SectionNavigator } from './SectionNavigator';
import { ShaderBackground } from './ShaderBackground';

interface ChooseMotivationProps {
  config: OnboardingConfig;
  selectedCoach: string;
  selectedPrimaryGoal?: string;
  userName?: string;
  motivationLevel?: number;
  motivationWhy?: string;
  onMotivationLevelChange: (level: number) => void;
  onMotivationWhyChange: (why: string) => void;
  onNext: () => void;
  onPrevious?: () => void;
}

export const ChooseMotivation: React.FC<ChooseMotivationProps> = ({
  config,
  selectedCoach,
  selectedPrimaryGoal,
  userName = '',
  motivationLevel = 5,
  motivationWhy = '',
  onMotivationLevelChange,
  onMotivationWhyChange,
  onNext,
  onPrevious,
}) => {
  const { i18n, t } = useTranslation(['onboarding', 'common']);
  const isSpanish = i18n.language?.startsWith('es');
  const insets = useSafeAreaInsets();

  const [localMotivationWhy, setLocalMotivationWhy] = useState(motivationWhy);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleTextChange = (text: string) => {
    setLocalMotivationWhy(text);
    onMotivationWhyChange(text);
  };

  const handleNext = () => {
    if (!localMotivationWhy.trim()) {
      Alert.alert(
        isSpanish ? 'Cuéntanos tu "por qué"' : 'Tell us your "why"',
        isSpanish
          ? 'Por favor comparte qué te motiva a embarcarte en este camino.'
          : 'Please share what motivates you to embark on this journey.',
        [{ text: t('common:ok'), style: 'default' }]
      );
      return;
    }
    onNext();
  };

  const placeholderText = useMemo(() => {
    if (!selectedPrimaryGoal) {
      return isSpanish ? 'ej., verme increíble en mi próxima vacación en la playa' : "e.g., looking great for my next beach vacation";
    }

    // Use Spanish motivation reasons when available
    const motivationReasonsEs = config.general_info.primary_goals_motivation_reasons_es?.[selectedPrimaryGoal];
    const motivationReasons = config.general_info.primary_goals_motivation_reasons?.[selectedPrimaryGoal];
    const reasons = (isSpanish && motivationReasonsEs && motivationReasonsEs.length > 0) ? motivationReasonsEs : motivationReasons;

    if (!reasons || reasons.length === 0) {
      return isSpanish ? 'ej., verme increíble en mi próxima vacación en la playa' : "e.g., looking great for my next beach vacation";
    }

    const randomIndex = Math.floor(Math.random() * reasons.length);
    return `${isSpanish ? 'ej.' : 'e.g.,'} ${reasons[randomIndex]}`;
  }, [selectedPrimaryGoal, config.general_info.primary_goals_motivation_reasons, config.general_info.primary_goals_motivation_reasons_es, isSpanish]);

  const getRandomMotivationPlaceholder = () => {
    return placeholderText;
  };

  return (
    <View style={{ flex: 1 }}>
      <ShaderBackground offsetY="70%" />
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView 
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Content Section — coach header and navigator scroll with content so they don't stay pinned while typing */}
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView style={styles.contentContainer} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="never">
          <CoachInfoHeader 
            config={config} 
            selectedCoach={selectedCoach} 
            imageSize="small" 
          />

          <SectionNavigator activeSection="you" />

          {/* Motivation Why Section */}
          <View style={styles.whySection}>
            <Text style={styles.whyLabel}>
              {(() => {
                const enGoals: string[] = config.general_info.primary_goals || [];
                const esGoals: string[] = config.general_info.primary_goals_es || [];
                const idx = enGoals.indexOf(selectedPrimaryGoal || '');
                const localizedGoal = isSpanish && idx >= 0 && esGoals[idx]
                  ? esGoals[idx]
                  : (selectedPrimaryGoal || (isSpanish ? 'bienestar' : 'wellness'));
                return t('onboarding:motivationWhyLabel', { goal: localizedGoal.toLowerCase() });
              })()}
            </Text>
            
            <View style={styles.textInputContainer}>
              <TextInput
                style={styles.textInput}
                value={localMotivationWhy}
                onChangeText={handleTextChange}
                placeholder={getRandomMotivationPlaceholder()}
                placeholderTextColor="#999"
                multiline={true}
                textAlignVertical="top"
                scrollEnabled={false}
              />
            </View>
          </View>
        </ScrollView>
        </TouchableWithoutFeedback>

        {/* Button Row — sits directly above the keyboard; only reserves home-indicator space when keyboard is hidden */}
        <View style={[styles.buttonSection, { paddingBottom: keyboardVisible ? 10 : Math.max(insets.bottom, 12) }]}>
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
    paddingTop: 16,
  },
  contentContainer: {
    flex: 1,
  },
  questionText: {
    fontFamily: FontFamily.displayBold,
    fontSize: 22,
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 32,
  },
  sliderSection: {
    marginBottom: 40,
  },
  sliderContainer: {
    paddingHorizontal: 20,
  },
  sliderLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 8,
    marginBottom: 8,
  },
  sliderLabelLeft: {
    fontSize: 18,
    fontWeight: 'bold',
    minWidth: 24,
    textAlign: 'left',
    flexShrink: 0,
  },
  sliderLabelRight: {
    fontSize: 18,
    fontWeight: 'bold',
    minWidth: 24,
    textAlign: 'right',
    flexShrink: 0,
  },
  sliderWrapper: {
    marginBottom: 20,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderThumb: {
    backgroundColor: '#F47C3C',
    width: 24,
    height: 24,
  },
  motivationLabelContainer: {
    alignItems: 'center',
    marginTop: 10,
  },
  motivationLabel: {
    fontSize: 16,
    color: '#9AA3A6',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  whySection: {
    marginBottom: 20,
  },
  whyLabel: {
    fontFamily: FontFamily.displayBold,
    fontSize: 22,
    color: '#F2F2EE',
    marginBottom: 16,
    lineHeight: 32,
  },
  textInputContainer: {
    borderWidth: 2,
    borderColor: '#E0E0E0',
    borderRadius: 15,
    padding: 16,
    minHeight: 120,
  },
  textInput: {
    fontSize: 16,
    color: '#F2F2EE',
    textAlign: 'left',
    minHeight: 80,
    lineHeight: 22,
  },
  buttonSection: {
    paddingTop: 12,
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