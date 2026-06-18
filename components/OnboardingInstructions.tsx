import React from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { CoachType } from '../types/onboard';
import { OnboardingConfig } from '../types/onboarding_config';
import { CoachInfoHeader } from './CoachInfoHeader';
import { appIcons } from '../assets/icons';

interface OnboardingInstructionsProps {
  config: OnboardingConfig;
  selectedCoach: string;
  selectedCoachType: CoachType;
  userName?: string;
  onNext: () => void;
}

export const OnboardingInstructions: React.FC<OnboardingInstructionsProps> = ({
  config,
  selectedCoach,
  selectedCoachType,
  userName = '',
  onNext
}) => {
  const { t } = useTranslation(['onboarding']);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Coach Info Section */}
        <CoachInfoHeader 
          config={config} 
          selectedCoach={selectedCoach} 
          imageSize="tiny" 
        />

        {/* Content Section */}
        <ScrollView style={styles.contentContainer} showsVerticalScrollIndicator={false}>
          {/* Main onboarding instructions */}
          <View style={{ alignItems: 'center', marginBottom: 32 }}>
            <View style={styles.iconRow}>
              <MaterialCommunityIcons name="arm-flex" size={28} color="#F47C3C" />
            </View>
            <Text style={styles.mainInstruction}>
              {t('onboarding:instructionsTitle')}
            </Text>
          </View>
        {/* Warning section removed (moved to intro) */}
          
          {/* Speed up tip section - HIDDEN */}
          {/* <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <Text style={styles.proTip}>
              🎙️ Speed up onboarding{'\n'}
              using the built-in iOS dictation feature{'\n'}
              in the keyboard
            </Text>
          </View> */}
          {/* Dictation keyboard image - HIDDEN */}
          {/* <View style={styles.screenshotContainer}>
            <Image
              source={require('../assets/images/dictate_keyboard.png')}
              style={styles.keyboardScreenshot}
              resizeMode="contain"
            />
          </View> */}
        </ScrollView>

        {/* Next Button */}
        <View style={styles.buttonSection}>
          <TouchableOpacity style={styles.nextButton} onPress={onNext}>
            <Text style={styles.nextButtonText}>{t('onboarding:questionNext')}</Text>
          </TouchableOpacity>
        </View>
      </View>
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
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
  },
  contentContainer: {
    flex: 1,
  },
  mainInstruction: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 26,
  },
  iconRow: {
    marginBottom: 8,
  },
  warningContainer: {
    // removed - migrated to intro screen
  },
  warningIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  warningIconImage: {
    // removed - migrated to intro screen
  },
  warningText: {
    // removed - migrated to intro screen
  },
  proTip: {
    fontSize: 16,
    fontWeight: '500',
    color: '#F2F2EE',
    textAlign: 'center',
    lineHeight: 22,
  },
  tipSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  tipIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  tipTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 28,
  },
  screenshotContainer: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
  },
  keyboardScreenshot: {
    width: '90%',
    height: 200,
    borderRadius: 8,
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
  nextButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
