import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { coachImages } from '../assets/images/coaches';
import { resolveCoachConfig } from '../lib/coach-config';
import { OnboardingConfig } from '../types/onboarding_config';

interface CoachInfoHeaderProps {
  config: OnboardingConfig;
  selectedCoach: string;
  imageSize?: 'tiny' | 'small' | 'large';
}

export const CoachInfoHeader: React.FC<CoachInfoHeaderProps> = ({
  config,
  selectedCoach,
  imageSize = 'large'
}) => {
  const selectedCoachInfo = resolveCoachConfig(config.general_info.coach_selection, selectedCoach);
  const { t, i18n } = useTranslation(['onboarding']);

  const getCoachImage = (imageName: string) => {
    return coachImages[imageName as keyof typeof coachImages] || null;
  };

  if (!selectedCoachInfo) {
    return null;
  }

  const coachImage = getCoachImage(selectedCoachInfo.image);
  const isTiny = imageSize === 'tiny';
  const isLarge = imageSize === 'large';
  const sz = isLarge ? 80 : (isTiny ? 40 : 60);
  const shouldShift = selectedCoach !== 'Ruth';
  const alonsoOffset = selectedCoach === 'Alonso' ? -sz * 0.17 : 0;

  const coachNameLocalized =
    i18n.language?.startsWith('es') && (selectedCoachInfo as any).label_es
      ? (selectedCoachInfo as any).label_es
      : selectedCoachInfo.label_en;

  return (
    <View style={styles.coachSection}>
      <View style={styles.coachImageContainer}>
        {coachImage ? (
          shouldShift ? (
            <View style={{ width: sz, height: sz, borderRadius: sz / 2, overflow: 'hidden' }}>
              <Image 
                source={coachImage} 
                style={{ width: sz, height: sz * 1.33, marginTop: alonsoOffset }}
                resizeMode="cover"
              />
            </View>
          ) : (
            <Image 
              source={coachImage} 
              style={[styles.coachImage, isLarge ? styles.coachImageLarge : (isTiny ? styles.coachImageTiny : styles.coachImageSmall)]} 
            />
          )
        ) : (
          <View style={[
            styles.coachImagePlaceholder, 
            isLarge ? styles.coachImageLarge : (isTiny ? styles.coachImageTiny : styles.coachImageSmall)
          ]}>
            <Text style={[
              styles.coachImageText,
              isLarge ? styles.coachImageTextLarge : (isTiny ? styles.coachImageTextTiny : styles.coachImageTextSmall)
            ]}>
              {coachNameLocalized.charAt(0)}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.coachName, isLarge ? styles.coachNameLarge : (isTiny ? styles.coachNameTiny : styles.coachNameSmall)]}>
        {t('onboarding:coachLabel', { name: coachNameLocalized })}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  coachSection: {
    alignItems: 'center',
    marginBottom: 30,
  },
  coachImageContainer: {
    marginBottom: 12,
  },
  coachImage: {
    borderRadius: 40,
  },
  coachImageLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  coachImageSmall: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  coachImageTiny: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  coachImagePlaceholder: {
    backgroundColor: '#F47C3C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coachImageText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  coachImageTextLarge: {
    fontSize: 32,
  },
  coachImageTextSmall: {
    fontSize: 24,
  },
  coachImageTextTiny: {
    fontSize: 18,
  },
  coachName: {
    fontWeight: '600',
    color: '#F2F2EE',
  },
  coachNameLarge: {
    fontSize: 18,
  },
  coachNameSmall: {
    fontSize: 16,
  },
  coachNameTiny: {
    fontSize: 14,
  },
});