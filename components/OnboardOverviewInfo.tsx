import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { appIcons } from '../assets/icons';
import { coachImagesByID } from '../assets/images/coaches';
import { Typography } from '../constants/Typography';
import { Onboard } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import { DeveloperMode } from './DeveloperMode';
import { HamburgerMenu } from './HamburgerMenu';
import { Icon } from './Icon';

const VIDEO_BG = require('../assets/images/forging_video_woman.mp4');

interface OnboardOverviewInfoProps {
  onGetStarted: () => void;
  onBack?: () => void; // Optional back button
  onboardingData?: Onboard;
  currentUserProfile?: UserProfile | null;
  assignedCoach?: { displayName: string; coachId: number };
}

export default function OnboardOverviewInfo({
  onGetStarted,
  onBack,
  onboardingData,
  currentUserProfile,
  assignedCoach,
}: OnboardOverviewInfoProps) {
  const { t } = useTranslation(['onboarding']);
  const isAssignedCoach = !!assignedCoach;
  const assignedCoachImage = assignedCoach ? coachImagesByID[assignedCoach.coachId] : null;
  const [showHamburgerMenu, setShowHamburgerMenu] = useState(false);
  const [showDeveloperMode, setShowDeveloperMode] = useState(false);
  const insets = useSafeAreaInsets();

  const player = useVideoPlayer(VIDEO_BG, (p) => {
    p.loop = true;
    p.muted = true;
    p.playbackRate = 0.6;
    p.play();
  });

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const buttonScaleAnim = useRef(new Animated.Value(1)).current;
  const videoOpacity = useRef(new Animated.Value(0)).current;
  const isFadingOut = useRef(false);
  const hasFadedIn = useRef(false);

  const FADE_DURATION = 1500;
  const FADE_OUT_THRESHOLD = 2000;

  // Animation effect on mount
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const position = player.currentTime;
        const duration = player.duration;
        if (duration <= 0) return;

        const timeRemaining = duration - position;

        if (!hasFadedIn.current && position < FADE_DURATION / 1000) {
          hasFadedIn.current = true;
          Animated.timing(videoOpacity, {
            toValue: 1,
            duration: FADE_DURATION,
            useNativeDriver: true,
          }).start();
        }

        if (!isFadingOut.current && timeRemaining <= FADE_OUT_THRESHOLD / 1000) {
          isFadingOut.current = true;
          Animated.timing(videoOpacity, {
            toValue: 0,
            duration: FADE_OUT_THRESHOLD,
            useNativeDriver: true,
          }).start(() => {
            isFadingOut.current = false;
            hasFadedIn.current = false;
          });
        }
      } catch {}
    }, 200);
    return () => clearInterval(interval);
  }, [player, videoOpacity]);

  // Create default onboarding data if not provided
  const defaultOnboardingData: Onboard = {
    selectedCoach: '',
    coach_type: 'AI_ONLY' as any,
    name: 'Guest User',
    selectedModules: [],
    selectedGoal: '',
    selectedSecondaryGoal: '',
    motivationLevel: 5,
    motivationWhy: '',
    time_available: '',
    expertise_level: '',
    clarifyingQuestions: [],
    actionPlan: undefined,
    chronic_illnesses: [],
    medications: [],
    supplements: [],
    allergies: [],
    moduleData: {},
    localUserId: 'onboarding-guest',
    toLLMString: () => 'Onboarding in progress'
  };

  const handleRocketLongPress = () => {
    setShowHamburgerMenu(true);
  };

  const handleMenuClose = () => {
    setShowHamburgerMenu(false);
  };

  const handleMenuAction = () => {
    // Close menu for any action since we're in onboarding
    setShowHamburgerMenu(false);
  };

  const handleShowDeveloper = () => {
    // Close menu first
    setShowHamburgerMenu(false);
    // Show developer mode
    setShowDeveloperMode(true);
  };

  const handleShowPlan = () => {
    setShowHamburgerMenu(false);
    Alert.alert(t('onboarding:overviewPlanNotAvailableTitle'), t('onboarding:overviewPlanNotAvailableBody'));
  };

  // Button press animation
  const handleButtonPress = () => {
    Animated.sequence([
      Animated.timing(buttonScaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(buttonScaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onGetStarted();
    });
  };

  return (
    <View style={styles.container}>
      {/* Background video with loop crossfade */}
      <View style={styles.videoLayer} pointerEvents="none">
        <Animated.View style={[styles.videoWrapper, { opacity: videoOpacity }]}>
          <VideoView
            player={player}
            style={styles.video}
            contentFit="cover"
            nativeControls={false}
          />
        </Animated.View>
      </View>
      <View style={styles.overlay} pointerEvents="none" />

      {/* Back button */}
      {onBack && (
        <TouchableOpacity style={[styles.backButton, { top: insets.top + 6 }]} onPress={onBack}>
          <Text style={styles.backButtonText}>{t('onboarding:overviewBack')}</Text>
        </TouchableOpacity>
      )}
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 12 }]}
        showsVerticalScrollIndicator={false}
        bounces={true}
      >
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <TouchableOpacity
              onLongPress={handleRocketLongPress}
              delayLongPress={800}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <Text style={styles.appName}>UnderForge</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.headerTitle}>{t('onboarding:overviewTagline')}</Text>
        </View>
        <Animated.View style={[styles.stepsList, { opacity: fadeAnim }]}>
          <View style={[styles.verticalLine, isAssignedCoach && styles.verticalLineAssigned]} />

          <View style={styles.step}>
            {isAssignedCoach && assignedCoachImage ? (
              <View style={styles.coachIconCircle}>
                <Image source={assignedCoachImage} style={styles.coachIconImage} resizeMode="cover" />
              </View>
            ) : (
              <View style={styles.iconCircle}>
                <Icon source={appIcons.coach} width={20} height={20} fill="#FFFFFF" />
              </View>
            )}
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>
                {isAssignedCoach
                  ? t('onboarding:overviewStep1TitleAssigned', { name: assignedCoach!.displayName })
                  : t('onboarding:overviewStep1Title')}
              </Text>
              <Text style={styles.stepDescription}>
                {isAssignedCoach
                  ? t('onboarding:overviewStep1DescAssigned')
                  : t('onboarding:overviewStep1Desc')}
              </Text>
            </View>
          </View>

          <View style={styles.separator} />

          <View style={styles.step}>
            <View style={styles.iconCircle}>
              <Icon source={appIcons.survey} width={20} height={20} fill="#FFFFFF" />
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>
                {isAssignedCoach
                  ? t('onboarding:overviewStep2TitleAssigned')
                  : t('onboarding:overviewStep2Title')}
              </Text>
              <Text style={styles.stepDescription}>
                {isAssignedCoach
                  ? t('onboarding:overviewStep2DescAssigned')
                  : t('onboarding:overviewStep2Desc')}
              </Text>
            </View>
          </View>

          <View style={styles.separator} />

          <View style={styles.step}>
            <View style={styles.iconCircle}>
              <Icon source={appIcons.plan} width={20} height={20} fill="#FFFFFF" />
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>
                {isAssignedCoach
                  ? t('onboarding:overviewStep3TitleAssigned')
                  : t('onboarding:overviewStep3Title')}
              </Text>
              <Text style={styles.stepDescription}>
                {isAssignedCoach
                  ? t('onboarding:overviewStep3DescAssigned')
                  : t('onboarding:overviewStep3Desc')}
              </Text>
            </View>
          </View>

          <View style={styles.separator} />

          <View style={styles.step}>
            <View style={styles.iconCircle}>
              <Icon source={appIcons.bolt} width={20} height={20} fill="#FFFFFF" />
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>
                {isAssignedCoach
                  ? t('onboarding:overviewStep4TitleAssigned')
                  : t('onboarding:overviewStep4Title')}
              </Text>
              <Text style={styles.stepDescription}>
                {isAssignedCoach
                  ? t('onboarding:overviewStep4DescAssigned')
                  : t('onboarding:overviewStep4Desc')}
              </Text>
            </View>
          </View>
        </Animated.View>
      </ScrollView>

      {/* Fixed footer with button - always visible at bottom */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Animated.View style={{ transform: [{ scale: buttonScaleAnim }], width: '100%' }}>
          <TouchableOpacity style={styles.getStartedButton} onPress={handleButtonPress}>
            <Text style={styles.getStartedButtonText}>{t('onboarding:overviewLetsGo')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Hamburger Menu */}
      <HamburgerMenu
        visible={showHamburgerMenu}
        onClose={handleMenuClose}
        onboardingData={onboardingData || defaultOnboardingData}
        currentUserProfile={currentUserProfile}
        onResetAndLogout={handleMenuAction}
        onShowPlan={handleShowPlan}
        onShowDeveloper={handleShowDeveloper}
      />

      {/* Developer Mode */}
      <DeveloperMode
        visible={showDeveloperMode}
        onClose={() => setShowDeveloperMode(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  videoLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  videoWrapper: {
    ...StyleSheet.absoluteFillObject,
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 17, 20, 0.55)',
    zIndex: 1,
  },
  backButton: {
    position: 'absolute',
    left: 20,
    zIndex: 10,
    padding: 8,
  },
  backButtonText: {
    color: '#777',
    fontSize: 15,
    ...Typography.defaultText,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 25,
    paddingTop: 10,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  appName: {
    fontSize: 31,
    fontFamily: Typography.fontFamily.brand,
    color: '#F47C3C',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 25,
    fontFamily: 'PlayfairDisplay-Bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 15,
    fontWeight: '400',
    color: '#F2F2EE',
    textAlign: 'center',
    lineHeight: 22,
    opacity: 0.9,
    maxWidth: 280,
  },
  stepsList: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    paddingBottom: 16,
    position: 'relative',
  },
  verticalLine: {
    position: 'absolute',
    left: 47,
    top: 34,
    bottom: 34,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  verticalLineAssigned: {
    left: 60,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(11, 17, 20, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 20,
    zIndex: 1,
  },
  coachIconCircle: {
    width: 73,
    height: 73,
    borderRadius: 36.5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(11, 17, 20, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
    overflow: 'hidden',
    zIndex: 1,
  },
  coachIconImage: {
    width: 73,
    height: 73,
  },
  stepContent: {
    flex: 1,
    paddingRight: 8,
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 3,
    lineHeight: 23,
  },
  stepDescription: {
    fontSize: 14,
    color: '#B8C5D1',
    lineHeight: 19,
    opacity: 0.65,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginLeft: 64,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 16,
    paddingHorizontal: 36,
  },
  getStartedButton: {
    backgroundColor: '#F47C3C',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 24,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#F47C3C',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  getStartedButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
