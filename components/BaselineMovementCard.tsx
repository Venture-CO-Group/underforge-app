import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { appIcons } from '../assets/icons';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize, LetterSpacing, LineHeight } from '../constants/Typography';
import { computeBaselineMovement, type BaselineMovement } from '../lib/baseline-movement';
import { getPersistedBaselineMovement, plannedTrainingKcalPerDay } from '../lib/nutrition-storage';
import { ActionPlan, Onboard } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import { Icon } from './Icon';

/** Daily baseline-movement target — training plan details only. */
export const BaselineMovementCard: React.FC<{
  userProfile?: UserProfile;
  /** Used during onboarding review before a full profile exists. */
  onboardData?: Onboard;
  actionPlan?: ActionPlan;
}> = ({ userProfile, onboardData, actionPlan }) => {
  const { t } = useTranslation(['plan']);
  const [movement, setMovement] = useState<BaselineMovement | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const userId = userProfile?.user_id;
      if (userId) {
        const persisted = await getPersistedBaselineMovement(userId);
        if (cancelled) return;
        if (persisted) {
          setMovement({
            kcalPerDay: persisted.kcalPerDay,
            minutesPerDay: persisted.minutesPerDay,
            stepsPerDayApprox: persisted.stepsPerDayApprox,
            pace: 'brisk',
          });
          return;
        }
      }
      const onboard = userProfile?.onboardingProfile ?? onboardData;
      if (!onboard) {
        if (!cancelled) setMovement(null);
        return;
      }
      const occupationActivity =
        (onboard as any).occupation_activity ||
        onboard.clarifyingQuestions?.find((q) => q.question === 'occupation_activity')?.answer ||
        '';
      const weightStr = onboard.weight ?? '';
      const wMatch = weightStr.match(/\((\d+)\s*kg\)/);
      const weightKg = wMatch ? parseInt(wMatch[1], 10) : 70;
      const trainingStep = actionPlan?.steps?.[0];
      const planKcalPerDay = plannedTrainingKcalPerDay(trainingStep);
      const recommendation = computeBaselineMovement({
        occupationActivity,
        weightKg,
        cardioKcalPerDay: 0,
        planTrainingKcalPerDay: planKcalPerDay,
      });
      if (!cancelled) setMovement(recommendation);
    })();
    return () => {
      cancelled = true;
    };
  }, [userProfile?.user_id, userProfile?.onboardingProfile, onboardData, actionPlan]);

  if (!movement) return null;

  const sourcesText =
    Platform.OS === 'ios'
      ? t('plan:baselineMovementSourcesIos')
      : t('plan:baselineMovementSourcesAndroid');

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.headerRow}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t('plan:baselineMovementTitle')}
      >
        <View style={styles.headerLeft}>
          <Icon source={appIcons.training} width={18} height={18} fill={BrandColors.accent} />
          <Text style={styles.title}>{t('plan:baselineMovementTitle')}</Text>
        </View>
        <View style={styles.chevronHit}>
          <Text style={styles.chevron}>{expanded ? '▼' : '▶'}</Text>
        </View>
      </TouchableOpacity>

      <Text style={styles.headline}>
        {t('plan:baselineMovementHeadline', { minutes: movement.minutesPerDay })}
      </Text>

      <Text style={styles.equivalents}>
        {t('plan:baselineMovementEquivalents', {
          steps: movement.stepsPerDayApprox.toLocaleString(),
          kcal: movement.kcalPerDay,
        })}
      </Text>

      {expanded && (
        <View style={styles.expandedBody}>
          <Text style={styles.body}>{t('plan:baselineMovementHowCalculated')}</Text>
          <Text style={styles.body}>{t('plan:baselineMovementBodyTargets')}</Text>
          <Text style={styles.body}>{t('plan:baselineMovementBodyTracking')}</Text>
          <Text style={styles.sources}>{sourcesText}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    marginTop: 24,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  chevronHit: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -8,
  },
  chevron: {
    fontSize: 14,
    color: BrandColors.accent,
    fontWeight: '600',
  },
  title: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.accent,
    letterSpacing: LetterSpacing.extraWide,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  headline: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 18,
    lineHeight: 24,
    color: BrandColors.textPrimary,
    marginBottom: 4,
  },
  equivalents: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
    color: BrandColors.textTertiary,
    marginBottom: 0,
  },
  expandedBody: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BrandColors.cardBorder,
  },
  body: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 14,
    lineHeight: LineHeight.body,
    color: BrandColors.textSecondary,
    marginBottom: 8,
  },
  sources: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 12,
    lineHeight: 16,
    color: BrandColors.textTertiary,
    marginTop: 4,
    fontStyle: 'italic',
  },
});
