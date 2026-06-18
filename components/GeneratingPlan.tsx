import { VideoView } from 'expo-video';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { appIcons } from '../assets/icons';
import { coachImages } from '../assets/images/coaches';
import { FontFamily } from '../constants/Typography';
import { useStableGenderForgingPlayer } from '../hooks/useStableGenderForgingPlayer';
import { getCurrentLanguage } from '../lib/i18n';
import { OnboardingConfig } from '../types/onboarding_config';
import { Icon } from './Icon';

// ── Orange accent palette ────────────────────────────────────────────
const ORANGE_ACCENT = '#F47C3C';
const ORANGE_GLOW = 'rgba(244, 124, 60, 0.35)';
const ORANGE_WARNING_BG = 'rgba(244, 124, 60, 0.25)';
const ORANGE_FUNFACT_BG = 'rgba(26, 16, 10, 0.85)';

interface GeneratingPlanProps {
  config: OnboardingConfig;
  selectedCoach: string;
  selectedGoal?: string;
  isRegeneration?: boolean;
  userGender?: 'female' | 'male' | string;
}

export const GeneratingPlan: React.FC<GeneratingPlanProps> = ({
  config,
  selectedCoach,
  selectedGoal,
  isRegeneration = false
  , userGender
}) => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['onboarding']);
  const isSpanish = getCurrentLanguage() === 'es';
  const screenOpacity = useSharedValue(0);

  const player = useStableGenderForgingPlayer(userGender, 'autoplay');

  const selectedCoachInfo = config.general_info.coach_selection[selectedCoach];
  
  const getCoachImage = (imageName: string) => {
    return coachImages[imageName as keyof typeof coachImages] || null;
  };

  // Fade in on mount
  useEffect(() => {
    screenOpacity.value = withTiming(1, {
      duration: 800,
      easing: Easing.out(Easing.ease),
    });
  }, []);

  // Get all available facts for the selected goal (Spanish or English)
  const availableFacts = useMemo(() => {
    const defaultFact = isSpanish
      ? "\u00bfSab\u00edas que? Los peque\u00f1os cambios constantes llevan a transformaciones incre\u00edbles! \uD83C\uDF1F"
      : "Did you know? Small consistent changes lead to amazing transformations! \uD83C\uDF1F";

    if (!selectedGoal) return [defaultFact];

    const factsMap = isSpanish
      ? config.general_info.primary_goals_interesting_facts_es
      : config.general_info.primary_goals_interesting_facts;

    if (!factsMap) return [defaultFact];

    const facts = factsMap[selectedGoal];
    return facts && facts.length > 0 ? facts : [defaultFact];
  }, [selectedGoal, isSpanish, config.general_info]);

  // State for current fact and used facts tracking
  const [currentFactIndex, setCurrentFactIndex] = useState(0);
  const [shuffledFacts, setShuffledFacts] = useState<string[]>([]);

  // Initialize shuffled facts on mount
  useEffect(() => {
    const shuffled = [...availableFacts].sort(() => Math.random() - 0.5);
    setShuffledFacts(shuffled);
    setCurrentFactIndex(0);
  }, [availableFacts]);

  // Rotate facts every 7 seconds
  useEffect(() => {
    if (shuffledFacts.length === 0) return;

    const interval = setInterval(() => {
      setCurrentFactIndex(prevIndex => {
        const nextIndex = (prevIndex + 1) % shuffledFacts.length;
        
        if (nextIndex === 0 && prevIndex === shuffledFacts.length - 1) {
          const reshuffled = [...availableFacts].sort(() => Math.random() - 0.5);
          setShuffledFacts(reshuffled);
        }
        
        return nextIndex;
      });
    }, 7000);

    return () => clearInterval(interval);
  }, [shuffledFacts, availableFacts]);

  const currentFunFact = shuffledFacts.length > 0 ? shuffledFacts[currentFactIndex] : availableFacts[0];

  const coachImage = getCoachImage(selectedCoachInfo.image);
  const screenStyle = useAnimatedStyle(() => ({ opacity: screenOpacity.value }));

  if (!selectedCoachInfo) {
    return null;
  }

  return (
    <Animated.View style={[styles.container, screenStyle]}>
      <View style={styles.videoLayer} pointerEvents="none">
        <VideoView
          player={player}
          style={styles.video}
          contentFit="cover"
          nativeControls={false}
          {...(Platform.OS === 'android' ? { surfaceType: 'textureView' as const } : {})}
        />
      </View>

      {/* Orange-tinted dark overlay */}
      <View style={styles.overlay} pointerEvents="none" />

      {/* Content layer */}
      <View style={styles.content}>
        <View style={[styles.fieldHeader, { paddingTop: insets.top + 8 }]}>
          {coachImage ? (
            <Image source={coachImage} style={styles.coachImageSmall} />
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

        <View style={styles.fieldContent}>
          <View style={styles.fieldQuestionRow}>
            <Icon source={appIcons.lightbulb} width={24} height={24} fill={ORANGE_ACCENT} />
            <Text style={styles.fieldQuestion}>
              {isRegeneration ? t('onboarding:regeneratingPlanTitle') : t('onboarding:generatingPlanTitle')}
            </Text>
          </View>
          
          {/* Warning for all plan generation */}
          <View style={styles.warningContainer}>
            <View style={styles.warningRow}>
              <Icon source={appIcons.warning} width={18} height={18} fill="#FBBF24" />
              <Text style={styles.warningText}>
                {t('onboarding:generatingPlanWarning')}
              </Text>
            </View>
          </View>
          
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={ORANGE_ACCENT} />
            
            {/* Fun Fact Box */}
            <View style={styles.funFactBox}>
              <View style={styles.funFactHeader}>
                <Icon source={appIcons.lightbulb} width={18} height={18} fill={ORANGE_ACCENT} />
                <Text style={styles.funFactTitle}>
                  {t('onboarding:generatingFunFact')}
                </Text>
              </View>
              <Text style={styles.funFactText}>
                {currentFunFact}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  videoLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(30, 14, 6, 0.65)',
    zIndex: 1,
  },
  content: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  fieldHeader: {
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  coachImageSmall: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: ORANGE_ACCENT,
  },
  coachImagePlaceholderSmall: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: ORANGE_ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  coachImageTextSmall: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  fieldCoachName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  fieldContent: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fieldQuestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
  },
  fieldQuestion: {
    fontFamily: FontFamily.displayBold,
    fontSize: 24,
    fontWeight: '600',
    color: '#F2F2EE',
    textAlign: 'center',
    lineHeight: 32,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    width: '100%',
  },
  warningContainer: {
    backgroundColor: ORANGE_WARNING_BG,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: ORANGE_ACCENT,
    shadowColor: ORANGE_ACCENT,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 2,
    width: '100%',
    alignSelf: 'stretch',
  },
  warningText: {
    flex: 1,
    flexShrink: 1,
    fontSize: 14,
    color: '#F2F2EE',
    textAlign: 'left',
    fontWeight: '600',
    lineHeight: 20,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  funFactBox: {
    backgroundColor: ORANGE_FUNFACT_BG,
    borderRadius: 20,
    padding: 20,
    marginTop: 20,
    borderWidth: 1.5,
    borderColor: ORANGE_ACCENT,
    shadowColor: ORANGE_ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 5,
    width: '100%',
    maxWidth: 350,
    minHeight: 120,
  },
  funFactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    justifyContent: 'center',
  },
  funFactTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: ORANGE_ACCENT,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  funFactText: {
    fontSize: 16,
    color: '#F2F2EE',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '500',
    minHeight: 48,
  },
});
