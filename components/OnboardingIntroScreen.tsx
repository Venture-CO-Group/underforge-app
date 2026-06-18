import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Dimensions, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation, Trans } from 'react-i18next';
import { appIcons } from '../assets/icons';
import { styles as modalStyles } from '../styles/OnboardingModal.styles';

const COACH_EXPLAINING_IMAGES: Record<string, any> = {
  'Ruth': require('../assets/images/coaches/emotions/4_ruth_morais_explaining.jpeg'),
  'Dana': require('../assets/images/coaches/emotions/5_dana_thompson_explaining.jpeg'),
  'Alonso': require('../assets/images/coaches/emotions/3_alonso_prieto_explaining.jpeg'),
  'Dey': require('../assets/images/coaches/emotions/2_dey_schwarz_explaining.jpeg'),
  'Manu': require('../assets/images/coaches/emotions/1_manu_rodriguez_explaining.jpeg'),
  'Jesús': require('../assets/images/coaches/emotions/6_jesus_guerrero_explaining.jpeg'),
};

interface OnboardingIntroScreenProps {
  selectedCoach?: string;
  onNext?: () => void;
  onPrevious?: () => void;
}

const { height } = Dimensions.get('window');

const OnboardingIntroScreen: React.FC<OnboardingIntroScreenProps> = ({ selectedCoach, onNext, onPrevious }) => {
  const coachImage = selectedCoach ? COACH_EXPLAINING_IMAGES[selectedCoach] : null;
  const { t } = useTranslation(['onboarding', 'common', 'language']);

  return (
    <View style={styles.root}>
      {coachImage && (
        <View style={styles.imageWrapper}>
          <Image source={coachImage} style={styles.coachImage} resizeMode="cover" />
          <LinearGradient
            colors={['transparent', '#0E1A1A']}
            style={styles.gradient}
          />
          <Text style={styles.coachLabel}>{t('onboarding:coachLabel', { name: selectedCoach })}</Text>
        </View>
      )}

      <SafeAreaView style={styles.safeArea}>
        <ScrollView 
          style={{ flex: 1 }}
          contentContainerStyle={[styles.content, coachImage && styles.contentWithImage]}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Text style={modalStyles.title}>
            <Trans
              ns="onboarding"
              i18nKey="introTitle"
              components={{ forge: <Text style={styles.forge} /> }}
            />
          </Text>

          <View style={styles.warningContainer}>
            <Image source={appIcons.warning} style={styles.warningIcon} />
            <Text style={styles.warningText}>
              {t('onboarding:introWarning')}
            </Text>
          </View>

          <View style={styles.buttonRow}>
            {onPrevious ? (
              <TouchableOpacity style={styles.backButton} onPress={onPrevious} accessibilityRole="button">
                <Text style={styles.backText}>{t('common:back')}</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 56 }} />
            )}
            <TouchableOpacity style={styles.nextButton} onPress={onNext}>
              <Text style={styles.nextButtonText}>{t('language:continue')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1A1A',
  },
  safeArea: {
    flex: 1,
  },
  imageWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: height * 0.55,
  },
  coachImage: {
    width: '100%',
    height: '100%',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '60%',
  },
  coachLabel: {
    position: 'absolute',
    top: 66,
    left: 16,
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(242,242,238,0.85)',
    letterSpacing: 0.6,
    backgroundColor: 'rgba(0,0,0,0.28)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  contentWithImage: {
    justifyContent: 'flex-end',
  },
  forge: {
    color: '#F47C3C',
  },
  warningContainer: {
    backgroundColor: '#0B1114',
    borderRadius: 16,
    padding: 20,
    marginTop: 40,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: '#F47C3C',
    shadowColor: '#F47C3C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  warningIcon: {
    width: 20,
    height: 20,
    marginRight: 12,
    marginTop: 2,
  },
  warningText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#8B4513',
    flex: 1,
    lineHeight: 22,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '400',
  },
  nextButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 24,
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default OnboardingIntroScreen;
