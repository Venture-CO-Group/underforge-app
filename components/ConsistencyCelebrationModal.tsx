import React, { useEffect, useMemo, useState } from 'react';
import { Image, ImageSourcePropType, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

// Coach Images - Celebrate (Consistency Milestone)
const COACH_CELEBRATE_IMAGES: Record<string, any> = {
  Manu: require('../assets/images/coaches/emotions/1_manu_rodriguez_celebrate.jpeg'),
  Dey: require('../assets/images/coaches/emotions/2_dey_schwarz_celebrate.jpeg'),
  Alonso: require('../assets/images/coaches/emotions/3_alonso_prieto_celebrate.jpeg'),
  Ruth: require('../assets/images/coaches/emotions/4_ruth_morais_celebrate.jpeg'),
  Dana: require('../assets/images/coaches/emotions/5_dana_thompson_celebrate.jpeg'),
  Jesús: require('../assets/images/coaches/emotions/6_jesus_guerrero_celebrate.jpeg'),
};

const DEFAULT_CELEBRATE_IMAGE = require('../assets/images/workout_logged.png');

interface ConsistencyCelebrationModalProps {
  visible: boolean;
  score: number;
  coachName?: string;
  onClose: () => void;
  onShowStreak?: () => void;
}

export const ConsistencyCelebrationModal: React.FC<ConsistencyCelebrationModalProps> = ({
  visible,
  score,
  coachName,
  onClose,
  onShowStreak,
}) => {
  const { t } = useTranslation(['main']);
  const preferredImage = useMemo<ImageSourcePropType>(() => (
    coachName && COACH_CELEBRATE_IMAGES[coachName]
      ? COACH_CELEBRATE_IMAGES[coachName]
      : DEFAULT_CELEBRATE_IMAGE
  ), [coachName]);
  const [imageSource, setImageSource] = useState<ImageSourcePropType>(preferredImage);

  useEffect(() => {
    setImageSource(preferredImage);
  }, [preferredImage, visible]);

  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      <View style={styles.modal}>
        <Image
          source={imageSource}
          style={styles.image}
          resizeMode="cover"
          onError={() => {
            if (imageSource !== DEFAULT_CELEBRATE_IMAGE) {
              setImageSource(DEFAULT_CELEBRATE_IMAGE);
            }
          }}
        />
        <View style={styles.content}>
          <Text style={styles.title}>{t('main:consistencyCelebrationTitle')}</Text>
          <Text style={styles.message}>
            {t('main:consistencyCelebrationBody')}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={onShowStreak ?? onClose}
          >
            <Text style={styles.buttonText}>{t('main:consistencyCelebrationCta')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: '#0E1A1A',
    borderRadius: 24,
    width: '100%',
    maxWidth: 360,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2A3638',
    shadowColor: '#F47C3C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  image: {
    width: '100%',
    height: 220,
  },
  content: {
    padding: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F2F2EE',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  message: {
    fontSize: 16,
    color: '#9AA3A6',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
  },
  highlight: {
    color: '#F47C3C',
    fontWeight: '700',
  },
  button: {
    backgroundColor: '#F47C3C',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 14,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});
