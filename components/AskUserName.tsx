import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontFamily } from '../constants/Typography';
import { OnboardingConfig } from '../types/onboarding_config';
import { CoachInfoHeader } from './CoachInfoHeader';
import { SectionNavigator } from './SectionNavigator';
import { ShaderBackground } from './ShaderBackground';

interface AskUserNameProps {
  config: OnboardingConfig;
  selectedCoach: string;
  userName?: string;
  onUserNameChange: (name: string) => void;
  onNext: () => void;
  onPrevious?: () => void;
}

export const AskUserName: React.FC<AskUserNameProps> = ({
  config,
  selectedCoach,
  userName = '',
  onUserNameChange,
  onNext,
  onPrevious,
}) => {
  const { t } = useTranslation(['onboarding']);
  const insets = useSafeAreaInsets();
  const [inputValue, setInputValue] = useState(userName);
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
  
  const selectedCoachInfo = config.general_info.coach_selection[selectedCoach];

  const handleNext = () => {
    if (inputValue.trim()) {
      onUserNameChange(inputValue.trim());
      onNext();
    }
  };

  const handleInputChange = (text: string) => {
    setInputValue(text);
    onUserNameChange(text);
  };

  if (!selectedCoachInfo) {
    return null;
  }

  return (
    <View style={styles.root}>
      <ShaderBackground offsetY="70%" />
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView 
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={{ flex: 1 }}>
              <ScrollView 
                style={{ flex: 1 }} 
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="never"
              >
                {/* Coach Info Section */}
                <CoachInfoHeader 
                  config={config} 
                  selectedCoach={selectedCoach} 
                  imageSize="large" 
                />

                <SectionNavigator activeSection="you" />

                {/* Question Section */}
                <View style={styles.questionSection}>
                  <Text style={styles.questionText}>{t('onboarding:askNameQuestion')}</Text>
                  
                  <TextInput
                    style={styles.nameInput}
                    value={inputValue}
                    onChangeText={handleInputChange}
                    placeholder={t('onboarding:askNamePlaceholder')}
                    placeholderTextColor="#6F7A7E"
                    autoFocus={true}
                    autoCapitalize="words"
                    autoComplete="name"
                    returnKeyType="done"
                    onSubmitEditing={handleNext}
                  />
                </View>
              </ScrollView>

              {/* Button Row — sits directly above the keyboard; only reserves home-indicator space when keyboard is hidden */}
              <View style={[styles.buttonSection, { paddingBottom: keyboardVisible ? 4 : Math.max(insets.bottom, 12) }]}>
                <View style={styles.buttonRow}>
                  {onPrevious && (
                    <TouchableOpacity style={styles.backButton} onPress={onPrevious}>
                      <Text style={styles.backButtonText}>{t('onboarding:questionBack')}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity 
                    style={[styles.nextButton, !inputValue.trim() && styles.nextButtonDisabled, onPrevious && styles.nextButtonWithBack]} 
                    onPress={handleNext}
                    disabled={!inputValue.trim()}
                  >
                    <Text style={[styles.nextButtonText, !inputValue.trim() && styles.nextButtonTextDisabled]}>
                      {t('onboarding:questionNext')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E0400',
  },
  safeArea: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 12,
  },
  questionSection: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 20,
    width: '100%',
  },
  questionText: {
    fontFamily: FontFamily.displayBold,
    fontSize: 22,
    color: '#F2F2EE',
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: 40,
  },
  nameInput: {
    width: '100%',
    height: 60,
    borderWidth: 2,
    borderColor: 'rgba(244, 124, 60, 0.4)',
    borderRadius: 15,
    paddingHorizontal: 20,
    fontSize: 18,
    backgroundColor: 'rgba(14, 4, 0, 0.6)',
    color: '#F2F2EE',
    textAlign: 'center',
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
  nextButtonDisabled: {
    backgroundColor: 'rgba(224, 224, 224, 0.3)',
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  nextButtonTextDisabled: {
    color: '#6F7A7E',
  },
});