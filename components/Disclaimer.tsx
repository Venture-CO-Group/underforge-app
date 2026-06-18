import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { FontFamily } from '../constants/Typography';
import { OnboardingConfig } from '../types/onboarding_config';
import { CoachInfoHeader } from './CoachInfoHeader';
import { ShaderBackground } from './ShaderBackground';

const PRIVACY_POLICY_URL = 'https://www.underforge.io/privacy-policy.html';

interface DisclaimerProps {
  config: OnboardingConfig;
  selectedCoach: string;
  disclaimerAccepted?: {
    conditionsUnderstood: boolean;
    ageConfirmed: boolean;
    privacyPolicyAccepted: boolean;
  };
  onDisclaimerUpdate: (disclaimerData: { conditionsUnderstood: boolean; ageConfirmed: boolean; privacyPolicyAccepted: boolean }) => void;
  onNext: () => void;
}

export const Disclaimer: React.FC<DisclaimerProps> = ({
  config,
  selectedCoach,
  disclaimerAccepted = { conditionsUnderstood: false, ageConfirmed: false, privacyPolicyAccepted: false },
  onDisclaimerUpdate,
  onNext
}) => {
  const { t } = useTranslation(['onboarding']);
  const [conditionsUnderstood, setConditionsUnderstood] = useState(disclaimerAccepted.conditionsUnderstood);
  const [ageConfirmed, setAgeConfirmed] = useState(disclaimerAccepted.ageConfirmed);
  const [privacyPolicyAccepted, setPrivacyPolicyAccepted] = useState(disclaimerAccepted.privacyPolicyAccepted);

  const selectedCoachInfo = config.general_info.coach_selection[selectedCoach];

  const termsAccepted = conditionsUnderstood && privacyPolicyAccepted;

  const handleCheckboxToggle = (type: 'age' | 'terms') => {
    if (type === 'age') {
      const newValue = !ageConfirmed;
      setAgeConfirmed(newValue);
      onDisclaimerUpdate({ conditionsUnderstood, ageConfirmed: newValue, privacyPolicyAccepted });
    } else {
      const newValue = !termsAccepted;
      setConditionsUnderstood(newValue);
      setPrivacyPolicyAccepted(newValue);
      onDisclaimerUpdate({ conditionsUnderstood: newValue, ageConfirmed, privacyPolicyAccepted: newValue });
    }
  };

  const handleNext = () => {
    if (!conditionsUnderstood || !ageConfirmed || !privacyPolicyAccepted) {
      Alert.alert(
        t('onboarding:disclaimerIncompleteTitle'),
        t('onboarding:disclaimerIncompleteBody'),
        [{ text: t('common:ok'), style: 'default' }]
      );
      return;
    }
    onNext();
  };

  if (!selectedCoachInfo) {
    return null;
  }

  return (
    <View style={{ flex: 1 }}>
      <ShaderBackground offsetY="70%" />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView 
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        {/* Coach Info Section */}
        <CoachInfoHeader 
          config={config} 
          selectedCoach={selectedCoach} 
          imageSize="small" 
        />

        {/* Content Section */}
        <ScrollView style={styles.contentContainer} showsVerticalScrollIndicator={false}>
          <Text style={styles.titleText}>
            {t('onboarding:disclaimerTitle')}
          </Text>

          {/* 1. Acknowledgment checkboxes */}
          <View style={styles.checkboxContainer}>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => handleCheckboxToggle('age')}
            >
              <View style={[styles.checkbox, ageConfirmed && styles.checkboxChecked]}>
                {ageConfirmed && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>
                {t('onboarding:disclaimerCheck2')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => handleCheckboxToggle('terms')}
            >
              <View style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}>
                {termsAccepted && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>
                {t('onboarding:disclaimerCheckCombinedStart')}
                <Text
                  style={styles.privacyLink}
                  onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
                >
                  {t('onboarding:disclaimerPrivacyLink')}
                </Text>
                {t('onboarding:disclaimerCheckCombinedEnd')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* 2. Third-party AI & data deletion summary */}
          <View style={styles.disclaimerSection}>
            <Text style={styles.disclaimerText}>
              {t('onboarding:disclaimerAI1')}
              <Text style={styles.disclaimerBold}>{t('onboarding:disclaimerAI1Bold')}</Text>
              {t('onboarding:disclaimerAI1End')}
            </Text>
          </View>

          {/* 3. Full disclaimer copy */}
          <View style={styles.disclaimerSection}>
            <Text style={styles.disclaimerText}>
              {t('onboarding:disclaimerP1')}
            </Text>

            <Text style={styles.disclaimerSubheading}>
              {t('onboarding:disclaimerSubheading1')}
            </Text>

            <Text style={styles.disclaimerText}>
              <Text style={styles.disclaimerBold}>{t('onboarding:disclaimerFitnessLabel')}</Text>
              {t('onboarding:disclaimerFitnessBody')}
            </Text>

            <Text style={styles.disclaimerText}>
              <Text style={styles.disclaimerBold}>{t('onboarding:disclaimerNutritionLabel')}</Text>
              {t('onboarding:disclaimerNutritionBody')}
            </Text>

            <Text style={styles.disclaimerSubheading}>
              {t('onboarding:disclaimerSubheading2')}
            </Text>

            <Text style={styles.disclaimerText}>
              <Text style={styles.disclaimerBold}>{t('onboarding:disclaimerAI2Label')}</Text>
              {t('onboarding:disclaimerAI2Body')}
              <Text style={styles.disclaimerBold}>{t('onboarding:disclaimerAI2AnthropicLabel')}</Text>
              {t('onboarding:disclaimerAI2AnthropicBody')}
              <Text style={styles.disclaimerBold}>{t('onboarding:disclaimerAI2DeepSeekLabel')}</Text>
              {t('onboarding:disclaimerAI2DeepSeekBody')}
            </Text>

            <Text style={styles.disclaimerText}>
              <Text style={styles.disclaimerBold}>{t('onboarding:disclaimerAI3Label')}</Text>
              {t('onboarding:disclaimerAI3Body')}
              <Text style={styles.disclaimerBold}>{t('onboarding:disclaimerAI3OpenAILabel')}</Text>
              {t('onboarding:disclaimerAI3OpenAIBody')}
              <Text style={styles.disclaimerBold}>{t('onboarding:disclaimerAI2AnthropicLabel')}</Text>
              {t('onboarding:disclaimerAI3AnthropicBody')}
            </Text>

            <Text style={styles.disclaimerText}>
              {t('onboarding:disclaimerPrivacyPreLink')}
              <Text style={styles.privacyLink} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>{t('onboarding:disclaimerPrivacyLink')}</Text>
              {t('onboarding:disclaimerPrivacyPostLink')}
            </Text>
          </View>
        </ScrollView>

        {/* Next Button */}
        <View style={styles.buttonSection}>
          <TouchableOpacity 
            style={[
              styles.nextButton, 
              (!conditionsUnderstood || !ageConfirmed || !privacyPolicyAccepted) && styles.nextButtonDisabled
            ]} 
            onPress={handleNext}
          >
            <Text style={[
              styles.nextButtonText,
              (!conditionsUnderstood || !ageConfirmed || !privacyPolicyAccepted) && styles.nextButtonTextDisabled
            ]}>
              {t('onboarding:disclaimerButton')}
            </Text>
          </TouchableOpacity>
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
  contentContainer: {
    flex: 1,
  },
  titleText: {
    fontFamily: FontFamily.displayBold,
    fontSize: 24,
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 32,
  },
  disclaimerSection: {
    marginBottom: 24,
  },
  disclaimerText: {
    fontSize: 14,
    color: '#F2F2EE',
    lineHeight: 20,
    marginBottom: 16,
  },
  disclaimerSubheading: {
    fontSize: 14,
    color: '#F2F2EE',
    fontWeight: '600',
    marginBottom: 12,
  },
  disclaimerBold: {
    fontSize: 14,
    color: '#F2F2EE',
    fontWeight: '600',
  },
  conditionsList: {
    fontSize: 13,
    color: '#9AA3A6',
    lineHeight: 18,
    marginBottom: 16,
    paddingLeft: 8,
  },
  checkboxContainer: {
    marginBottom: 28,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    borderRadius: 4,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    borderColor: '#F47C3C',
    backgroundColor: '#F47C3C',
  },
  checkmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    fontSize: 14,
    color: '#F2F2EE',
    lineHeight: 20,
    flex: 1,
  },
  privacyLink: {
    color: '#FFFFFF',
    textDecorationLine: 'underline',
  },
  buttonSection: {
    paddingBottom: 20,
  },
  nextButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: 'center',
  },
  nextButtonDisabled: {
    backgroundColor: '#E0E0E0',
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