import React, { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { appIcons } from '../assets/icons';
import { coachImages } from '../assets/images/coaches';
import { OnboardingConfig } from '../types/onboarding_config';
import { Icon } from './Icon';

interface PlanAcceptedProps {
  config: OnboardingConfig;
  selectedCoach: string;
  onStartChatting: () => void;
}

export const PlanAccepted: React.FC<PlanAcceptedProps> = ({
  config,
  selectedCoach,
  onStartChatting
}) => {
  const { t } = useTranslation(['onboarding']);
  const [isLoading, setIsLoading] = useState(false);
  const insets = useSafeAreaInsets();
  const selectedCoachInfo = config.general_info.coach_selection[selectedCoach];
  
  const getCoachImage = (imageName: string) => {
    return coachImages[imageName as keyof typeof coachImages] || null;
  };

  const coachImage = getCoachImage(selectedCoachInfo.image);

  const handleStartChatting = async () => {
    setIsLoading(true);
    try {
      await onStartChatting();
    } catch (error) {
      console.error('Error starting chat:', error);
      setIsLoading(false);
    }
  };

  if (!selectedCoachInfo) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={[styles.fieldHeader, { paddingTop: insets.top + 8 }]}>
        {coachImage ? (
          <View style={styles.coachImageClip}>
            <Image
              source={coachImage}
              style={[
                styles.coachImageInner,
                selectedCoach === 'Alonso' && { marginTop: -40 * 0.17 },
              ]}
              resizeMode="cover"
            />
          </View>
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
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) + 24 }]}
        showsVerticalScrollIndicator={false}
        bounces={true}
      >
        <View style={styles.headingWithIcon}>
          <Text style={styles.headingPrimary}>{t('onboarding:planAcceptedWelcome')}</Text>
          <Icon source={appIcons.celebration} width={28} height={28} fill="#F47C3C" />
        </View>
        <Text style={styles.headingSecondary}>{t('onboarding:planAcceptedNextSteps')}</Text>
        
        <View style={styles.expectationsList}>
          <View style={styles.expectationItem}>
            <Icon source={appIcons.target} width={24} height={24} fill="#FFFFFF" style={styles.iconImage} />
            <Text style={styles.expectationText}>
              {t('onboarding:planAcceptedStep1')}
            </Text>
          </View>

          <View style={styles.expectationItem}>
            <Icon source={appIcons.chat} width={24} height={24} fill="#FFFFFF" style={styles.iconImage} />
            <Text style={styles.expectationText}>
              {t('onboarding:planAcceptedStep2')}
            </Text>
          </View>

          <View style={styles.expectationItem}>
            <Icon source={appIcons.plant} width={24} height={24} fill="#FFFFFF" style={styles.iconImage} />
            <Text style={styles.expectationText}>
              {t('onboarding:planAcceptedStep3')}
            </Text>
          </View>

          <View style={styles.expectationItem}>
            <Icon source={appIcons.trophy} width={24} height={24} fill="#FFFFFF" style={styles.iconImage} />
            <Text style={styles.expectationText}>
              {t('onboarding:planAcceptedStep4')}
            </Text>
          </View>
          
        </View>

        <TouchableOpacity
          style={[
            styles.startChattingButton,
            isLoading && styles.startChattingButtonDisabled
          ]}
          onPress={handleStartChatting}
          disabled={isLoading}
        >
          {isLoading ? (
            <View style={styles.spinnerRow}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.startChattingButtonText}>{t('onboarding:planAcceptedCta')}</Text>
            </View>
          ) : (
            <Text style={styles.startChattingButtonText}>
              {t('onboarding:planAcceptedCta')}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1A1A',
  },
  fieldHeader: {
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  coachImageClip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 8,
  },
  coachImageInner: {
    width: 40,
    height: 54,
  },
  coachImagePlaceholderSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F47C3C',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  coachImageTextSmall: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  fieldCoachName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 36,
    paddingTop: 24,
    paddingBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 32,
  },
  headingPrimary: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F47C3C',
    textAlign: 'center',
    marginBottom: 40,
  },
  headingWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  headingIcon: {
    width: 28,
    height: 28,
    marginLeft: 8,
  },
  headingSecondary: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 36,
  },
  expectationsList: {
    marginBottom: 32,
  },
  expectationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 24,
    paddingRight: 4,
  },
  numberBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5C842',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 20,
    marginTop: 2,
  },
  numberText: {
    color: '#F2F2EE',
    fontSize: 16,
    fontWeight: 'bold',
  },
  emojiIcon: {
    fontSize: 24,
    marginRight: 20,
    marginTop: 2,
  },
  iconImage: {
    width: 24,
    height: 24,
    marginRight: 20,
    marginTop: 2,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 20,
    marginTop: 2,
  },
  coachIconSmall: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  coachIconPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F47C3C',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  coachIconText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  robotEmoji: {
    fontSize: 24,
  },
  expectationText: {
    fontSize: 16,
    color: '#F2F2EE',
    lineHeight: 22,
    flex: 1,
    paddingRight: 8,
  },
  startChattingButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 18,
    borderRadius: 25,
    alignItems: 'center',
  },
  startChattingButtonDisabled: {
    opacity: 0.7,
  },
  startChattingButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  spinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
});
