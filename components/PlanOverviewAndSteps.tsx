import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, ImageSourcePropType, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { appIcons } from '../assets/icons';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize, LetterSpacing, LineHeight } from '../constants/Typography';
import { glowLogger } from '../lib/glow-logger';
import { getOverviewStepDescription } from '../lib/plan-description-utils';
import { ActionPlan, ActionStep } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import { EditPlanModal } from './EditPlanModal';
import { Icon } from './Icon';
import { MarkdownText } from './MarkdownText';
import { MuscleActivationMap } from './MuscleActivationMap';
import {
  getWorkoutPlansFromStep,
  isTrainingStepWithWorkouts,
  wholePlanMap,
} from './StepDetailContent';

// Types for plan section configuration
type IconKey = keyof typeof appIcons;

interface PlanSectionConfig {
  key: string;
  title: string;
  iconKey: IconKey;
  stepIndex: number; // Fixed step index: 0=training, 1=nutrition, 2=recovery&sleep
}

// Three fixed plan sections - always displayed in this order, mapped by step index
const PLAN_SECTIONS: PlanSectionConfig[] = [
  {
    key: 'training',
    title: 'plan:sectionTraining',
    iconKey: 'training',
    stepIndex: 0,
  },
  {
    key: 'nutrition',
    title: 'plan:sectionNutrition',
    iconKey: 'nutrition',
    stepIndex: 1,
  },
  {
    key: 'sleep_recovery',
    title: 'plan:sectionRecovery',
    iconKey: 'sleep',
    stepIndex: 2,
  },
];

// Get the appropriate photo for a plan section based on dimension + gender
import { planImages } from '../assets/images/plan';

const getPlanSectionImage = (sectionKey: string, gender: string): ImageSourcePropType => {
  // Treat anything that isn't explicitly 'male' as female, matching the muscle map's
  // fallback (mapGender below) so both stay consistent when gender is unknown.
  const isFemale = gender !== 'male';
  switch (sectionKey) {
    case 'training':
      return isFemale ? planImages['fem training'] : planImages['male training'];
    case 'nutrition':
      return isFemale ? planImages['fem nutrition'] : planImages['male nutrition'];
    case 'sleep_recovery':
      return isFemale ? planImages['fem recovery'] : planImages['male recovery'];
    default:
      return isFemale ? planImages['fem training'] : planImages['male training'];
  }
};

interface PlanOverviewAndStepsProps {
  actionPlan: ActionPlan;
  onStepPress?: (stepIndex: number) => void;
  showFrequency?: boolean;
  onEditPress?: (openModalFunction: () => void) => void;
  userProfile?: UserProfile;
  userGender?: string;
  nutritionSurveyCompleted?: boolean;
  recoverySurveyCompleted?: boolean;
  onStartSurvey?: (surveyType: 'nutrition' | 'recovery') => void;
}

// ─── Survey Banner with Electric Waves ─────────────────────────────────────
const SurveyBanner: React.FC<{
  surveyType: 'nutrition' | 'recovery';
  onPress: () => void;
}> = ({ surveyType, onPress }) => {
  const { t } = useTranslation(['plan']);
  const shimmerAnim = useRef(new Animated.Value(-1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: -1, duration: 0, useNativeDriver: true }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0, duration: 1200, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const borderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(244,124,60,0.25)', 'rgba(244,124,60,0.75)'],
  });

  const text = surveyType === 'nutrition'
    ? t('plan:surveyNutritionBanner')
    : t('plan:surveyRecoveryBanner');

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={overviewSurveyStyles.wrapper}>
      <Animated.View style={[overviewSurveyStyles.banner, { borderColor }]}>
        {/* Left accent stripe */}
        <View style={overviewSurveyStyles.stripe} />

        {/* Sweeping shimmer overlay */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Animated.View
            style={{
              ...StyleSheet.absoluteFillObject,
              transform: [{
                translateX: shimmerAnim.interpolate({
                  inputRange: [-1, 1],
                  outputRange: [-220, 220],
                }),
              }],
            }}
          >
            <LinearGradient
              colors={['transparent', 'rgba(244,124,60,0.08)', 'rgba(244,124,60,0.14)', 'rgba(244,124,60,0.08)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1, width: 120 }}
            />
          </Animated.View>
        </View>

        <View style={overviewSurveyStyles.content}>
          {/*
            Use a matching SVG icon from appIcons:
            - nutrition -> avocado
            - recovery -> sleep
          */}
          <Icon source={surveyType === 'nutrition' ? appIcons.avocado : appIcons.sleep} width={18} height={18} fill={'#F47C3C'} style={{ marginRight: 10 }} />
          <View style={overviewSurveyStyles.textContainer}>
            <Text style={overviewSurveyStyles.text}>{text}</Text>
          </View>
          <Text style={overviewSurveyStyles.arrow}>›</Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
};

const overviewSurveyStyles = StyleSheet.create({
  wrapper: {
    marginLeft: 16,
    marginBottom: 8,
  },
  banner: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  stripe: {
    width: 4,
    backgroundColor: '#F47C3C',
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  icon: {
    fontSize: 16,
    marginRight: 10,
  },
  textContainer: {
    flex: 1,
    paddingRight: 8,
  },
  text: {
    fontSize: 13,
    color: '#C8CDD0',
    lineHeight: 19,
    fontStyle: 'italic',
  },
  arrow: {
    fontSize: 22,
    color: '#F47C3C',
    fontWeight: '600',
  },
});

export const PlanOverviewAndSteps: React.FC<PlanOverviewAndStepsProps> = ({
  actionPlan,
  onStepPress,
  showFrequency = true,
  onEditPress,
  userProfile,
  userGender: userGenderProp,
  nutritionSurveyCompleted = false,
  recoverySurveyCompleted = false,
  onStartSurvey,
}) => {
  const { t } = useTranslation(['plan']);
  const [showEditModal, setShowEditModal] = React.useState(false);

  // Extract gender from user profile
  const genderQuestion = userProfile?.onboardingProfile?.clarifyingQuestions?.find(
    (q: any) => q.question === 'gender_question'
  );
  const userGender = (userGenderProp || genderQuestion?.answer || '').toString().toLowerCase();

  // Get step for a section by its fixed index (0=training, 1=nutrition, 2=recovery&sleep)
  const getStepsForSection = (section: PlanSectionConfig): { steps: ActionStep[]; indices: number[] } => {
    const step = actionPlan.steps[section.stepIndex];
    if (step) {
      return { steps: [step], indices: [section.stepIndex] };
    }
    return { steps: [], indices: [] };
  };

  // Debug log when modal state changes
  React.useEffect(() => {
    console.log('[PlanOverviewAndSteps] showEditModal changed to:', showEditModal);
  }, [showEditModal]);

  const openEditModal = React.useCallback(() => {
    console.log('[PlanOverviewAndSteps] openEditModal called');
    setShowEditModal(true);
  }, []);

  // Expose the modal control to parent only once
  React.useEffect(() => {
    console.log('[PlanOverviewAndSteps] useEffect running, onEditPress:', !!onEditPress);
    if (onEditPress) {
      onEditPress(openEditModal);
    }
  }, [onEditPress, openEditModal]);

  const handleEditModalClose = () => {
    setShowEditModal(false);
  };

  const handleEditModalSave = (selectedStepIndex: number, feedback: string) => {
    glowLogger.info('[PlanOverviewAndSteps] Edit saved', { selectedStepIndex, feedback });
    setShowEditModal(false);
    onStepPress?.(selectedStepIndex);
  };

  // Plan Section Card component
  const PlanSectionCard = ({ section }: { section: PlanSectionConfig }) => {
    const { steps, indices } = getStepsForSection(section);
    const primaryStep = steps[0];
    const primaryIndex = indices[0];
    const sectionImage = getPlanSectionImage(section.key, userGender);
    const scaleAnim = React.useRef(new Animated.Value(1)).current;

    // Whole-program muscle map (aggregated across every training day), overlaid on the
    // training section image so the user sees what the plan targets at a glance.
    const wholePlanData =
      section.key === 'training' && primaryStep && isTrainingStepWithWorkouts(primaryStep)
        ? wholePlanMap(getWorkoutPlansFromStep(primaryStep))
        : [];
    const mapGender: 'male' | 'female' = userGender === 'male' ? 'male' : 'female';
    // The female training photo frames the subject slightly right-of-center, so the
    // muscle-map overlay brushes against her body. Nudge just this image left (scale a
    // touch to keep the frame filled) so a gap opens between her and the map.
    const isFemaleTraining = section.key === 'training' && mapGender === 'female';

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

    const sectionDescription =
      steps.length > 0
        ? steps
            .map((s) => getOverviewStepDescription(s.description, section.key))
            .filter(Boolean)
            .join('\n\n') || t('plan:noStepsAvailable')
        : t('plan:noStepsAvailable');

    // Phase titles from step data
    const phase1Title = primaryStep ? primaryStep.title : t('plan:phaseDefault1');
    const phase2Title = primaryStep?.phase_2_title || t('plan:phaseDefault2');
    const phase3Title = primaryStep?.phase_3_title || t('plan:phaseDefault3');

    // For nutrition (stepIndex 1) and recovery (stepIndex 2), phases 2 & 3 require
    // the corresponding survey to be completed first.
    const isNutritionSection = section.stepIndex === 1;
    const isRecoverySection = section.stepIndex === 2;
    const surveyRequired = isNutritionSection || isRecoverySection;
    const surveyDone = isNutritionSection ? nutritionSurveyCompleted : recoverySurveyCompleted;
    const surveyType: 'nutrition' | 'recovery' = isNutritionSection ? 'nutrition' : 'recovery';
    const showPhaseProgression = !surveyRequired || surveyDone;

    return (
      <View style={styles.sectionCard}>
        {/* Section Title with Icon */}
        <View style={styles.sectionTitleRow}>
          <Icon
            source={appIcons[section.iconKey]}
            width={20}
            height={20}
            fill={BrandColors.accent}
          />
          <Text style={styles.sectionTitleText}>{t(section.title)}</Text>
        </View>

        {/* Phase 1 - Current (Clickable) */}
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <TouchableOpacity
            onPress={() => onStepPress && primaryIndex !== undefined && onStepPress(primaryIndex)}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            activeOpacity={1}
            disabled={!onStepPress || primaryIndex === undefined}
          >
            <View style={styles.phaseContainer}>
              <View style={styles.sectionImageContainer}>
                <Image
                  source={sectionImage}
                  style={[styles.sectionImage, isFemaleTraining && styles.sectionImageShiftLeft]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={120}
                />
                {wholePlanData.length > 0 && (
                  <View style={styles.sectionMapOverlay} pointerEvents="none">
                    <MuscleActivationMap
                      data={wholePlanData}
                      gender={mapGender}
                      overlay
                      hideLegend
                      sizeFactor={0.42}
                    />
                  </View>
                )}
                <View style={styles.sectionImageOverlay}>
                  <Text style={styles.phaseLabel}>{t('plan:phase1Label', { title: phase1Title })}</Text>
                </View>
              </View>

              {/* Description Text */}
              <MarkdownText
                text={sectionDescription}
                style={styles.sectionDescriptionText}
                linkColor="#F47C3C"
              />

              {onStepPress && primaryIndex !== undefined && (
                <View style={styles.seeDetailsRow}>
                  <Text style={styles.seeDetailsText}>{t('plan:seeDetails')}</Text>
                  <Text style={styles.seeDetailsArrow}>→</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* Survey required banner — shown instead of phases 2 & 3 when survey not done */}
        {surveyRequired && !surveyDone && onStartSurvey && (
          <SurveyBanner surveyType={surveyType} onPress={() => onStartSurvey(surveyType)} />
        )}

        {/* Phases 2 & 3 — only shown for training, or when the survey is done */}
        {showPhaseProgression && (
          <>
            {/* Phase 2 - To be unlocked */}
            <TouchableOpacity
              style={styles.lockedPhaseContainer}
              onPress={() => {
                Alert.alert(
                  t('plan:phase2LockedTitle'),
                  t('plan:phase2LockedMessage'),
                  [{ text: t('plan:phaseLockButton'), style: 'default' }]
                );
              }}
              activeOpacity={0.7}
            >
              <View style={styles.lockedPhaseContent}>
                <Text style={styles.lockedPhaseText}>{t('plan:phase2Label', { title: phase2Title })}</Text>
                <Icon
                  source={appIcons.lock}
                  width={20}
                  height={20}
                  fill={BrandColors.textTertiary}
                />
              </View>
            </TouchableOpacity>

            {/* Phase 3 - To be unlocked */}
            <TouchableOpacity
              style={styles.lockedPhaseContainer}
              onPress={() => {
                Alert.alert(
                  t('plan:phase3LockedTitle'),
                  t('plan:phase3LockedMessage'),
                  [{ text: t('plan:phaseLockButton'), style: 'default' }]
                );
              }}
              activeOpacity={0.7}
            >
              <View style={styles.lockedPhaseContent}>
                <Text style={styles.lockedPhaseText}>{t('plan:phase3Label', { title: phase3Title })}</Text>
                <Icon
                  source={appIcons.lock}
                  width={20}
                  height={20}
                  fill={BrandColors.textTertiary}
                />
              </View>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Plan Overview */}
      {actionPlan.rationale && (
        <View style={styles.overviewSection}>
          <Text style={styles.overviewTitle}>{t('plan:planOverviewTitle')}</Text>
          <MarkdownText
            text={actionPlan.rationale}
            style={styles.overviewText}
            linkColor="#F47C3C"
          />
        </View>
      )}

      {/* Three Fixed Plan Sections */}
      {PLAN_SECTIONS.map((section) => (
        <PlanSectionCard key={section.key} section={section} />
      ))}

      {/* Edit Plan Modal */}
      {userProfile && (
        <EditPlanModal
          visible={showEditModal}
          userProfile={userProfile}
          onClose={handleEditModalClose}
          onSave={handleEditModalSave}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  // Plan Overview
  overviewSection: {
    backgroundColor: BrandColors.backgroundSecondary,
    marginBottom: 40,
    marginTop: 32,
    padding: 16,
    borderRadius: 12,
  },
  overviewTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: BrandColors.textPrimary,
    marginBottom: 8,
    fontFamily: FontFamily.bodySemiBold,
  },
  overviewText: {
    fontSize: 15,
    color: BrandColors.textSecondary,
    lineHeight: 22,
    fontFamily: FontFamily.bodyRegular,
  },

  // Section Card
  sectionCard: {
    marginBottom: 40,
    position: 'relative',
  },

  // Section Title Row (icon + title)
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitleText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.accent,
    letterSpacing: LetterSpacing.extraWide,
    textTransform: 'uppercase',
  },

  // Phase Container (for Phase 1 clickable card)
  phaseContainer: {
    position: 'relative',
    marginBottom: 16,
  },

  // Section Image (60% taller than original 120px → 192px)
  sectionImageContainer: {
    height: 192,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
    position: 'relative',
  },
  sectionImage: {
    width: '100%',
    height: '100%',
  },
  // Scale up a touch (adds horizontal room so no empty edge appears) then slide left,
  // moving the subject away from the muscle-map overlay on the right.
  sectionImageShiftLeft: {
    transform: [{ scale: 1.12 }, { translateX: -16 }],
  },
  sectionMapOverlay: {
    position: 'absolute',
    right: 6,
    top: 4,
    bottom: 54,
    width: '54%',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  sectionImageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  phaseLabel: {
    color: BrandColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    fontFamily: FontFamily.bodySemiBold,
  },

  // Description Text
  sectionDescriptionText: {
    fontSize: 15,
    color: BrandColors.textSecondary,
    lineHeight: LineHeight.body,
    fontFamily: FontFamily.bodyRegular,
  },

  // Locked Phase Container
  lockedPhaseContainer: {
    backgroundColor: BrandColors.backgroundTertiary,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    opacity: 0.6,
  },
  lockedPhaseContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lockedPhaseText: {
    fontSize: 14,
    fontWeight: '500',
    color: BrandColors.textSecondary,
    fontFamily: FontFamily.bodySemiBold,
    flex: 1,
    lineHeight: 20,
  },

  // "See details" row for pressable cards
  seeDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 10,
    gap: 4,
  },
  seeDetailsText: {
    fontSize: 13,
    color: BrandColors.accent,
    fontFamily: FontFamily.bodySemiBold,
    letterSpacing: 0.2,
  },
  seeDetailsArrow: {
    fontSize: 14,
    color: BrandColors.accent,
    fontWeight: '600',
  },
});
