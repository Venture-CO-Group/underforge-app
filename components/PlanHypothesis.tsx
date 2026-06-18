import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ActivityIndicator, Animated, Dimensions, Image, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { appIcons } from '../assets/icons';
import { coachExplainingImages } from '../assets/images/coaches';
import { glowLogger } from '../lib/glow-logger';
import { HypothesisResponse } from '../lib/llm-service';
import { OnboardingConfig } from '../types/onboarding_config';
import { Icon } from './Icon';

interface PlanHypothesisProps {
  config: OnboardingConfig;
  selectedCoach: string;
  userName?: string;
  hypothesis: HypothesisResponse;
  hasHypothesisGenerationError?: boolean;
  hypothesisGenerationError?: string;
  onNext: (userAssessment?: string) => void;
  onRetryHypothesis?: () => void;
  isOnboardingFlow?: boolean; // Flag to control button behavior
}

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);
const { height: screenHeight } = Dimensions.get('window');

const truncateErrorMessage = (message: string, maxWords: number = 250): string => {
  const words = message.split(' ');
  if (words.length <= maxWords) {
    return message;
  }
  return words.slice(0, maxWords).join(' ') + '...';
};

export const PlanHypothesis: React.FC<PlanHypothesisProps> = ({
  config,
  selectedCoach,
  userName,
  hypothesis,
  hasHypothesisGenerationError,
  hypothesisGenerationError,
  onNext,
  onRetryHypothesis,
  isOnboardingFlow = true
}) => {
  const { t } = useTranslation(['onboarding', 'common']);
  const insets = useSafeAreaInsets();
  const selectedCoachInfo = config.general_info.coach_selection[selectedCoach];
  const [isRetrying, setIsRetrying] = React.useState(false);
  const [userAssessment, setUserAssessment] = React.useState('');
  
  const coachExplainingImage =
    coachExplainingImages[selectedCoach] ?? coachExplainingImages[selectedCoachInfo.label_en];

  const handleNext = () => {
    if (!isOnboardingFlow) {
      require('react-native').Alert.alert(
        t('onboarding:hypothesisDevAlertTitle'),
        t('onboarding:hypothesisDevAlertBody'),
        [{ text: t('common:ok') }]
      );
      return;
    }
    
    glowLogger.info('Plan hypothesis approved by user', { 
      hypothesis, 
      userAssessment: userAssessment.trim() 
    });
    onNext(userAssessment.trim() || undefined);
  };

  const handleRetry = () => {
    setIsRetrying(true);
    // Show spinner briefly, then trigger retry
    setTimeout(() => {
      setIsRetrying(false);
      if (onRetryHypothesis) {
        onRetryHypothesis();
      } else {
        handleNext();
      }
    }, 800);
  };

  const ComponentCard = ({ component, index }: { component: any; index: number }) => {
    const scaleAnim = React.useRef(new Animated.Value(1)).current;

    const handlePressIn = () => {
      Animated.spring(scaleAnim, {
        toValue: 0.98,
        useNativeDriver: true,
        tension: 300,
        friction: 8,
      }).start();
    };

    const handlePressOut = () => {
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 300,
        friction: 8,
      }).start();
    };

    return (
      <AnimatedTouchableOpacity
        style={[
          styles.componentContainer,
          { transform: [{ scale: scaleAnim }] }
        ]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        <View style={styles.componentContent}>
          {/* Component Header */}
          <View style={styles.componentHeader}>
            <View style={styles.componentNumberContainer}>
              <Text style={styles.componentNumber}>{index + 1}</Text>
            </View>
            <View style={styles.componentTitleContainer}>
              <Text style={styles.componentTitle}>{component.summary}</Text>
            </View>
          </View>

          {/* Root Cause Hypothesis Components (bullet list - first two only) */}
          {component.root_cause_hypothesis_components?.length > 0 && (
            <View style={styles.hypothesisSection}>
              <Text style={styles.hypothesisSectionTitle}>
                {t('onboarding:hypothesisCoachThinks')}
              </Text>
              {component.root_cause_hypothesis_components.slice(0, 2).map((item: string, i: number) => (
                <Text key={i} style={styles.hypothesisSectionText}>
                  {'\u2022'} {item}
                </Text>
              ))}
            </View>
          )}

        </View>
      </AnimatedTouchableOpacity>
    );
  };

  // Debug logging
  glowLogger.info('PlanHypothesis rendered with hypothesis', { 
    hypothesis, 
    hypothesis_type: typeof hypothesis,
    hypothesis_components_count: hypothesis?.components?.length 
  });

  if (!selectedCoachInfo) {
    return null;
  }

  return (
    <View style={styles.container}>
      {coachExplainingImage ? (
        <View style={styles.heroImageWrapper}>
          <Image source={coachExplainingImage} style={styles.heroImage} resizeMode="cover" />
          <LinearGradient colors={['transparent', '#0E1A1A']} style={styles.heroGradient} />
          <Text style={[styles.heroCoachLabel, { top: insets.top + 12 }]}>
            {t('onboarding:coachLabel', { name: selectedCoachInfo.label_en })}
          </Text>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            coachExplainingImage ? styles.scrollContentWithHero : null,
            { paddingBottom: 40 + insets.bottom },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="never"
        >
        {hasHypothesisGenerationError || !hypothesis ? (
          // Error State
          <View style={styles.hypothesisContainer}>
            <Text style={styles.hypothesisTitle}>
              {t('onboarding:hypothesisErrorTitle')}
            </Text>
            <Text style={styles.hypothesisSubtitle}>
              {t('onboarding:hypothesisErrorSubtitle')}
            </Text>
            
            {hypothesisGenerationError && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{t('onboarding:hypothesisErrorPrefix')}{truncateErrorMessage(hypothesisGenerationError)}</Text>
                <TouchableOpacity 
                  style={[styles.retryButtonInline, isRetrying && styles.retryButtonInlineDisabled]}
                  onPress={handleRetry}
                  disabled={isRetrying}
                >
                  {isRetrying ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.retryButtonInlineText}>
                      {t('onboarding:hypothesisTryAgain')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          // Structured Hypothesis Display
          <View style={styles.hypothesisContainer}>
            {/* Primary Title */}
            <View style={styles.hypothesisTitleRow}>
              <Icon source={appIcons.lightbulb} width={24} height={24} fill="#F47C3C" />
              <Text style={styles.hypothesisTitle}>
                {t('onboarding:hypothesisTitle', {
                  name: userName?.trim() || t('onboarding:hypothesisTitleFallbackName'),
                })}
              </Text>
            </View>

            {/* Intro / Context Card */}
            <View style={styles.introCard}>
              <Text style={styles.introText}>
                {t('onboarding:hypothesisIntroText')}
              </Text>
            </View>

            {/* Separator */}
            <View style={styles.sectionSeparator} accessibilityElementsHidden />

            {/* Hypothesis Components */}
            <View style={styles.section} accessibilityLabel="Key focus areas list">
              {hypothesis.components?.map((component, index) => (
                <ComponentCard key={component.id} component={component} index={index} />
              ))}
            </View>

            <Text style={styles.approvalText}>
              {t('onboarding:hypothesisApprovalQuestion')}
            </Text>

            <TextInput
              style={styles.assessmentInput}
              placeholder={t('onboarding:hypothesisAssessmentPlaceholder')}
              placeholderTextColor="#999"
              multiline
              value={userAssessment}
              onChangeText={setUserAssessment}
              textAlignVertical="top"
              scrollEnabled={false}
            />

            <TouchableOpacity
              style={styles.approveButton}
              onPress={handleNext}
            >
              <Text style={styles.approveButtonText}>
                {t('onboarding:hypothesisCreatePlanButton')}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        </ScrollView>
      </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1A1A',
  },
  keyboardAvoid: {
    flex: 1,
  },
  heroImageWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: screenHeight * 0.52,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '60%',
  },
  heroCoachLabel: {
    position: 'absolute',
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  scrollContentWithHero: {
    paddingTop: screenHeight * 0.44,
  },
  hypothesisContainer: {
    paddingVertical: 20,
  },
  hypothesisTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
  },
  hypothesisTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#F2F2EE',
    textAlign: 'center',
    lineHeight: 30,
  },
  hypothesisSubtitle: {
    fontSize: 16,
    color: '#9AA3A6',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
    paddingHorizontal: 20,
  },
  overallHypothesisSection: {
    backgroundColor: '#0E1A1A',
    marginBottom: 20,
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#7B3FF2',
    ...Platform.select({
      ios: {
        shadowColor: '#7B3FF2',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 3,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  overallHypothesisTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#7B3FF2',
    marginBottom: 8,
  },
  overallHypothesisText: {
    fontSize: 15,
    color: '#3C3C43',
    lineHeight: 22,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 16,
  },
  componentContainer: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    ...Platform.select({
      ios: {
        shadowColor: '#7B3FF2',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  componentContent: {
    flex: 1,
  },
  componentHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  componentNumberContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2D6B5A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  componentNumber: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  componentTitleContainer: {
    flex: 1,
  },
  componentTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
    lineHeight: 22,
    marginBottom: 8,
  },
  hypothesisSection: {
    backgroundColor: '#0E1A1A',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#2D6B5A',
  },
  hypothesisSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D6B5A',
    marginBottom: 4,
  },
  hypothesisSectionText: {
    fontSize: 14,
    color: '#F2F2EE',
    lineHeight: 19,
  },
  approvalText: {
    fontSize: 18,
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '500',
  },
  optionalText: {
    fontSize: 14,
    color: '#9AA3A6',
    textAlign: 'center',
    marginBottom: 20,
    fontStyle: 'italic',
  },
  assessmentInput: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    fontSize: 16,
    color: '#F2F2EE',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  approveButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 24,
    alignItems: 'center',
    alignSelf: 'center',
    minWidth: 200,
    shadowColor: '#F47C3C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  approveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorContainer: {
    backgroundColor: '#1A1F21',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#C65B5B',
  },
  errorText: {
    color: '#F2F2EE',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 16,
  },
  retryButtonInline: {
    backgroundColor: '#FF9500',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  retryButtonInlineText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  retryButtonInlineDisabled: {
    backgroundColor: '#FFCC80',
  },
  // New intro card styles
  introCard: {
    backgroundColor: '#0E1A1A',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  introText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#F2F2EE',
    fontWeight: '500',
  },
  sectionSeparator: {
    height: 8,
    marginVertical: 4,
  },
});