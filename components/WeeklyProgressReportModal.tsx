import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    Dimensions,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import { macroCalorieSplitPercentsFromGrams } from '../lib/nutrition-storage';
import type { WeeklyReportMetrics } from '../lib/weekly-report-metrics';
import type { WeeklyReportHeroMood, WeeklyReportNarrative } from '../lib/weekly-report-state';
import { getSlugLabel } from '../lib/muscle-activation';
import { MuscleActivationMap } from './MuscleActivationMap';
import { TrainingFocusBar } from './TrainingFocusBar';
import WeeklyReportBarChart from './WeeklyReportBarChart';

/* ────────────────────────────────────────────────────────────
 * Grid-scan animated background (UnderForge-styled)
 * ──────────────────────────────────────────────────────────── */

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const GRID_SPACING = 40;
const SCAN_DURATION_MS = 4000;

function GridScanReportBg() {
  const scanY = useSharedValue(0);

  useEffect(() => {
    scanY.value = withRepeat(
      withTiming(SCREEN_H, { duration: SCAN_DURATION_MS, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [scanY]);

  const scanStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scanY.value }],
  }));

  const cols = Math.ceil(SCREEN_W / GRID_SPACING);
  const rows = Math.ceil(SCREEN_H / GRID_SPACING);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={SCREEN_W} height={SCREEN_H} style={StyleSheet.absoluteFill}>
        {Array.from({ length: cols + 1 }, (_, i) => (
          <Line
            key={`v${i}`}
            x1={i * GRID_SPACING}
            y1={0}
            x2={i * GRID_SPACING}
            y2={SCREEN_H}
            stroke="rgba(244,124,60,0.05)"
            strokeWidth={0.5}
          />
        ))}
        {Array.from({ length: rows + 1 }, (_, i) => (
          <Line
            key={`h${i}`}
            x1={0}
            y1={i * GRID_SPACING}
            x2={SCREEN_W}
            y2={i * GRID_SPACING}
            stroke="rgba(244,124,60,0.05)"
            strokeWidth={0.5}
          />
        ))}
      </Svg>

      <Animated.View style={[gridBgStyles.scanWrap, scanStyle]}>
        <LinearGradient
          colors={[
            'transparent',
            'rgba(244,124,60,0.03)',
            'rgba(244,124,60,0.10)',
            'rgba(244,124,60,0.18)',
            'rgba(244,124,60,0.10)',
            'rgba(244,124,60,0.03)',
            'transparent',
          ]}
          locations={[0, 0.15, 0.35, 0.5, 0.65, 0.85, 1]}
          style={gridBgStyles.scanGlow}
        />
        <View style={gridBgStyles.scanLine} />
      </Animated.View>
    </View>
  );
}

const gridBgStyles = StyleSheet.create({
  scanWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 120,
    top: -60,
  },
  scanGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 59,
    height: 1,
    backgroundColor: 'rgba(244,124,60,0.35)',
    shadowColor: '#F47C3C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
  },
});

function heroGradientColors(mood: WeeklyReportHeroMood): readonly [string, string, string] {
  switch (mood) {
    case 'celebrate':
      return ['rgba(11,17,20,0.12)', 'rgba(11,17,20,0.45)', 'rgba(8,48,36,0.92)'] as const;
    case 'applauding':
      return ['rgba(11,17,20,0.12)', 'rgba(11,17,20,0.4)', 'rgba(52,38,12,0.9)'] as const;
    default:
      return ['rgba(11,17,20,0.1)', 'rgba(11,17,20,0.42)', 'rgba(16,36,48,0.92)'] as const;
  }
}

/** Pick a recognizable icon for spotlight copy (heuristic). */
function iconNameForSpotlightFact(fact: string): keyof typeof MaterialCommunityIcons.glyphMap {
  const lower = fact.toLowerCase();
  if (/run|running|jog/i.test(lower)) return 'run';
  if (/cycl|bike|biking/i.test(lower)) return 'bike';
  if (/swim/i.test(lower)) return 'swim';
  if (/hik/i.test(lower)) return 'hiking';
  if (/watt|power|tv|electricity|energy/i.test(lower)) return 'lightning-bolt';
  if (/burn|calorie|pizza|flame|croissant|burger|baklava|beer|gin|aperol|tiramisu|falafel|brownie|wine/i.test(lower)) return 'fire';
  if (/activit|duration|movement|cardio/i.test(lower)) return 'heart-pulse';
  if (/protein|meal|nutrition|fiber/i.test(lower)) return 'food-apple';
  if (/session|lift|volume|training|workout|beetle|rep|dumbbell|tonnage|piano/i.test(lower)) return 'dumbbell';
  if (/body|muscle|fat|lean|composition|scan|check-in/i.test(lower)) return 'chart-line-variant';
  if (/consistency|compared|last week|edged/i.test(lower)) return 'trending-up';
  return 'star-four-points';
}

function SectionDivider() {
  return <View style={styles.sectionDivider} />;
}

/* ────────────────────────────────────────────────────────────
 * 1) CONSISTENCY  — bar chart + callout text
 * ──────────────────────────────────────────────────────────── */

function ConsistencySection({
  metrics,
  labels,
  consistencyVals,
}: {
  metrics: WeeklyReportMetrics;
  labels: string[];
  consistencyVals: number[];
}) {
  const { t } = useTranslation(['report']);
  const w0 = metrics.weeks[0];
  const score = w0?.consistency ?? 0;
  const mealsLogged = w0?.mealsCapped ?? 0;
  const trainingSessions = w0?.totalTrainingSessions ?? 0;
  const planned = metrics.plannedTrainingDaysPerWeek;

  const mealPct = Math.round((mealsLogged / 21) * 100);
  const trainingCallout =
    planned > 0
      ? t('report:trainingSessionsOf', { done: trainingSessions, planned })
      : t(trainingSessions !== 1 ? 'report:trainingSessionsLogged_other' : 'report:trainingSessionsLogged_one', { count: trainingSessions });

  return (
    <View style={styles.paddedSection}>
      <View style={styles.sectionHeader}>
        <MaterialCommunityIcons name="chart-arc" size={20} color="#F47C3C" />
        <Text style={styles.sectionTitle}>{t('report:sectionConsistency')}</Text>
      </View>

      <View style={styles.scoreBadgeRow}>
        <View style={styles.scoreBadge}>
          <Text style={styles.scoreBadgeValue}>{score}</Text>
          <Text style={styles.scoreBadgeLabel}>/100</Text>
        </View>
      </View>

      <View style={styles.calloutRow}>
        <MaterialCommunityIcons name="silverware-fork-knife" size={16} color="#6B9BD1" style={styles.calloutIcon} />
        <Text style={styles.calloutText}>
          {t('report:mealsLoggedStat', { count: mealsLogged, pct: mealPct })}
        </Text>
      </View>
      <View style={styles.calloutRow}>
        <MaterialCommunityIcons name="dumbbell" size={16} color="#4FAE8A" style={styles.calloutIcon} />
        <Text style={styles.calloutText}>{trainingCallout}</Text>
      </View>

      <View style={{ marginTop: 14 }}>
        <WeeklyReportBarChart
          title={t('report:chartFourWeekTrend')}
          labels={labels}
          values={consistencyVals}
          maxValue={100}
          unitSuffix=""
        />
      </View>
    </View>
  );
}

/* ────────────────────────────────────────────────────────────
 * 2) TRAINING  — sessions + volume / energy when available
 * ──────────────────────────────────────────────────────────── */

function TrainingSection({
  metrics,
  labels,
  trainingChartVals,
}: {
  metrics: WeeklyReportMetrics;
  labels: string[];
  trainingChartVals: number[];
}) {
  const { t } = useTranslation(['report']);
  const h = metrics.highlightsForLLM;
  const w0 = metrics.weeks[0];
  const sessions = w0?.totalTrainingSessions ?? 0;
  const workouts = w0?.workoutSessions ?? 0;
  const activities = w0?.activitySessions ?? 0;

  const hasVolume = h.volumeLiftedKgThisWeek > 0;
  const hasEnergy = h.totalEstimatedCaloriesThisWeek > 0;

  const maxTraining = Math.max(1, ...trainingChartVals);

  return (
    <View style={styles.paddedSection}>
      <View style={styles.sectionHeader}>
        <MaterialCommunityIcons name="arm-flex" size={20} color="#4FAE8A" />
        <Text style={styles.sectionTitle}>{t('report:sectionTraining')}</Text>
      </View>

      <View style={styles.statCardsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statCardValue}>{sessions}</Text>
          <Text style={styles.statCardLabel}>{t('report:statSessions')}</Text>
          {(workouts > 0 && activities > 0) && (
            <Text style={styles.statCardSub}>
              {workouts} {t(workouts !== 1 ? 'report:workoutsLabel_plural' : 'report:workoutsLabel')} + {activities} {t(activities !== 1 ? 'report:activitiesLabel_plural' : 'report:activitiesLabel')}
            </Text>
          )}
        </View>

        {hasVolume && (
          <View style={styles.statCard}>
            <Text style={styles.statCardValue}>{formatLargeNumber(h.volumeLiftedKgThisWeek)}</Text>
            <Text style={styles.statCardLabel}>{t('report:statKgVolume')}</Text>
            {h.volumeChangePercentVsPriorWeek !== null && (
              <Text style={[styles.statCardSub, { color: h.volumeChangePercentVsPriorWeek >= 0 ? '#4FAE8A' : '#E8B86D' }]}>
                {h.volumeChangePercentVsPriorWeek >= 0 ? '↑' : '↓'} {Math.abs(h.volumeChangePercentVsPriorWeek)}% {t('report:vsPriorWeek')}
              </Text>
            )}
          </View>
        )}

        {hasEnergy && (
          <View style={styles.statCard}>
            <Text style={styles.statCardValue}>{formatLargeNumber(h.totalEstimatedCaloriesThisWeek)}</Text>
            <Text style={styles.statCardLabel}>{t('report:statKcalBurned')}</Text>
          </View>
        )}
      </View>

      <View style={{ marginTop: 14 }}>
        <WeeklyReportBarChart
          title={t('report:chartTrainingSessions4Weeks')}
          labels={labels}
          values={trainingChartVals}
          maxValue={maxTraining}
          unitSuffix=""
          accentColor="#4FAE8A"
        />
      </View>
    </View>
  );
}

function formatLargeNumber(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

/* ────────────────────────────────────────────────────────────
 * 3) NUTRITION  — macro % donut + target deviation bars
 * ──────────────────────────────────────────────────────────── */

const MACRO_COLORS = {
  carbs: '#8B6E6E',
  protein: '#5A9E97',
  fat: '#B89878',
};

function NutritionSection({ metrics }: { metrics: WeeklyReportMetrics }) {
  const { t } = useTranslation(['report']);
  const snap = metrics.macrosThisWeek;
  const targets = metrics.nutritionTargets;

  if (!snap) {
    return (
      <View style={styles.paddedSection}>
        <View style={styles.sectionHeader}>
          <MaterialCommunityIcons name="food-apple" size={20} color="#6B9BD1" />
          <Text style={styles.sectionTitle}>{t('report:sectionNutrition')}</Text>
        </View>
        <Text style={styles.emptyText}>{t('report:noMealsLogged')}</Text>
      </View>
    );
  }

  const carbsPct = snap.carbsCalPct;
  const proteinPct = snap.proteinCalPct;
  const fatPct = snap.fatCalPct;

  const targetSplit =
    targets &&
    macroCalorieSplitPercentsFromGrams(
      targets.carbsTarget,
      targets.proteinTarget,
      targets.fatTarget,
    );

  return (
    <View style={styles.paddedSection}>
      <View style={styles.sectionHeader}>
        <MaterialCommunityIcons name="food-apple" size={20} color="#6B9BD1" />
        <Text style={styles.sectionTitle}>{t('report:sectionNutrition')}</Text>
      </View>

      <Text style={styles.nutritionSubtitle}>
        {t('report:kcalLoggedThisWeek', { count: snap.calories.toLocaleString() })}
      </Text>

      {/* Macro % horizontal stacked bar */}
      <View style={styles.macroBarOuter}>
        {carbsPct > 0 && (
          <View style={[styles.macroBarSegment, { flex: carbsPct, backgroundColor: MACRO_COLORS.carbs }]} />
        )}
        {proteinPct > 0 && (
          <View style={[styles.macroBarSegment, { flex: proteinPct, backgroundColor: MACRO_COLORS.protein }]} />
        )}
        {fatPct > 0 && (
          <View style={[styles.macroBarSegment, { flex: fatPct, backgroundColor: MACRO_COLORS.fat }]} />
        )}
      </View>

      {/* Legend row */}
      <View style={styles.macroLegendRow}>
        <MacroLegendItem label={t('report:macroCarbs')} pct={carbsPct} color={MACRO_COLORS.carbs} targetPct={targetSplit?.carbsPct} />
        <MacroLegendItem label={t('report:macroProtein')} pct={proteinPct} color={MACRO_COLORS.protein} targetPct={targetSplit?.proteinPct} />
        <MacroLegendItem label={t('report:macroFat')} pct={fatPct} color={MACRO_COLORS.fat} targetPct={targetSplit?.fatPct} />
      </View>

      {/* Deviation bars vs target */}
      {targets && (
        <View style={styles.deviationSection}>
          <Text style={styles.deviationTitle}>{t('report:vsDailyTarget')}</Text>
          <MacroDeviationBar label={t('report:macroCarbs')} grams={snap.carbsGrams} targetGrams={targets.carbsTarget * 7} color={MACRO_COLORS.carbs} />
          <MacroDeviationBar label={t('report:macroProtein')} grams={snap.proteinGrams} targetGrams={targets.proteinTarget * 7} color={MACRO_COLORS.protein} />
          <MacroDeviationBar label={t('report:macroFat')} grams={snap.fatGrams} targetGrams={targets.fatTarget * 7} color={MACRO_COLORS.fat} />
        </View>
      )}
    </View>
  );
}

function MacroLegendItem({
  label,
  pct,
  color,
  targetPct,
}: {
  label: string;
  pct: number;
  color: string;
  targetPct?: number;
}) {
  const { t } = useTranslation(['report']);
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <View>
        <Text style={styles.legendLabel}>{label} {pct}%</Text>
        {targetPct !== undefined && (
          <Text style={styles.legendTarget}>{t('report:legendTarget', { pct: targetPct })}</Text>
        )}
      </View>
    </View>
  );
}

function MacroDeviationBar({
  label,
  grams,
  targetGrams,
  color,
}: {
  label: string;
  grams: number;
  targetGrams: number;
  color: string;
}) {
  const { t } = useTranslation(['report']);
  const dailyAvg = Math.round(grams / 7);
  const dailyTarget = Math.round(targetGrams / 7);
  const pct = targetGrams > 0 ? (grams / targetGrams) * 100 : 0;
  const clamped = Math.min(pct, 140);
  const barWidth = (clamped / 140) * 100;
  const isOver = pct > 110;
  const isUnder = pct < 90;

  return (
    <View style={styles.devBarRow}>
      <View style={styles.devBarLabelRow}>
        <Text style={styles.devBarLabel}>{label}</Text>
        <Text style={[styles.devBarValue, (isOver || isUnder) && styles.devBarValueWarn]}>
          {t('report:dailyAvgTarget', { dailyAvg, dailyTarget })}
        </Text>
      </View>
      <View style={styles.devBarTrack}>
        <View style={[styles.devBarFill, { width: `${barWidth}%` as any, backgroundColor: color }]} />
        <View style={styles.devBarThreshold} />
      </View>
    </View>
  );
}

function MuscleBalanceSection({
  metrics,
  gender,
  goal,
}: {
  metrics: WeeklyReportMetrics;
  gender: 'male' | 'female';
  goal?: string;
}) {
  const { t } = useTranslation(['report', 'bodymap']);
  const mb = metrics.muscleBalance;
  if (!mb || mb.data.length === 0) return null;

  const focusLabels = mb.topTrained.map((s) => getSlugLabel(s, t)).join(', ');
  const underLabels = mb.underTrained.map((s) => getSlugLabel(s, t)).join(', ');

  let opportunity: string;
  if (mb.underTrained.length === 0) {
    opportunity = t('report:muscleBalanceBalanced', {
      defaultValue: 'Your training looks well balanced this week — nice work.',
    });
  } else if (goal) {
    opportunity = t('report:muscleOpportunity', {
      focus: focusLabels,
      goal,
      under: underLabels,
      defaultValue: `We've been focusing on ${focusLabels} for your goal of ${goal} — after this phase we could explore targeting ${underLabels}.`,
    });
  } else {
    opportunity = t('report:muscleOpportunityNoGoal', {
      focus: focusLabels,
      under: underLabels,
      defaultValue: `We've been focusing on ${focusLabels} this week — to stay balanced, we could explore targeting ${underLabels}.`,
    });
  }

  return (
    <View style={styles.paddedSection}>
      <View style={styles.sectionHeader}>
        <MaterialCommunityIcons name="arm-flex" size={20} color="#F4A23C" />
        <Text style={styles.sectionTitle}>
          {t('report:sectionMuscleBalance', { defaultValue: 'Muscle balance' })}
        </Text>
      </View>
      {!mb.focus.empty && (
        <View style={styles.muscleFocusBar}>
          <TrainingFocusBar focus={mb.focus} />
        </View>
      )}
      <MuscleActivationMap data={mb.data} gender={gender} />
      <Text style={styles.muscleOpportunity}>{opportunity}</Text>
    </View>
  );
}

/* ─────────────────────────────────────────────────────── */

interface WeeklyProgressReportModalProps {
  visible: boolean;
  coachImage: any;
  coachName: string;
  userFirstName: string;
  metrics: WeeklyReportMetrics | null;
  narrative: WeeklyReportNarrative | null;
  loadingNarrative: boolean;
  onClose: () => void;
  onTalkToCoach: () => void;
  /** Free-text gender from the onboarding profile; picks the body model (defaults to female). */
  userGender?: string;
  /** User's primary goal, woven into the muscle-balance opportunity copy. */
  userGoal?: string;
}

export const WeeklyProgressReportModal: React.FC<WeeklyProgressReportModalProps> = ({
  visible,
  coachImage,
  coachName,
  userFirstName,
  metrics,
  narrative,
  loadingNarrative,
  onClose,
  onTalkToCoach,
  userGender,
  userGoal,
}) => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['report', 'common']);
  const mapGender: 'male' | 'female' = (userGender || '').toLowerCase().startsWith('m') ? 'male' : 'female';
  // Charts: oldest week on the left, reporting week on the right (metrics.weeks stays newest-first for w0 = this week).
  const chartWeeks = metrics?.weeks.length ? [...metrics.weeks].reverse() : [];
  const chartLabels = chartWeeks.map(w => w.labelShort);
  const chartConsistencyVals = chartWeeks.map(w => w.consistency);
  const chartTrainingVals = chartWeeks.map(w => w.totalTrainingSessions);

  const headerTitle = narrative?.reportTitle ?? t('report:weeklyCheckInTitle');
  const heroMood: WeeklyReportHeroMood = narrative?.heroMood ?? 'explaining';
  const fallbackAnalyze = t('report:analyzeFallback', { name: userFirstName });

  const spotlightFacts = narrative?.spotlightFacts ?? [];
  const firstSpotlight = spotlightFacts[0];
  const extraSpotlights = spotlightFacts.slice(1);

  const heroPrimaryLine = firstSpotlight ?? (loadingNarrative ? t('report:personalizingSummary') : fallbackAnalyze);
  const heroIconName = iconNameForSpotlightFact(heroPrimaryLine);

  const hasSummary = Boolean(narrative);
  const hasCharts = Boolean(metrics);
  const showDividerAfterHero =
    loadingNarrative || extraSpotlights.length > 0 || hasSummary || hasCharts;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        {/* Grid-scan animated background */}
        <GridScanReportBg />

        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={t('report:a11yCloseReport')}>
            <Text style={styles.closeText}>{t('common:done')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={2}>
            {headerTitle}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        <View style={styles.body}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollInner} showsVerticalScrollIndicator>
          <View style={styles.heroBleed}>
            {coachImage ? (
              <View style={styles.heroCard}>
                <Image
                  source={coachImage}
                  style={styles.heroImage}
                  contentFit="cover"
                  contentPosition={{ top: '18%', left: '50%' }}
                />
                <LinearGradient
                  colors={[...heroGradientColors(heroMood)]}
                  locations={[0, 0.45, 1]}
                  style={StyleSheet.absoluteFillObject}
                />
                <View style={styles.heroTextBlock}>
                  <Text style={styles.heroCoachName}>{coachName}</Text>
                  <View style={styles.heroMessageRow}>
                    <MaterialCommunityIcons
                      name={heroIconName}
                      size={28}
                      color="#FFFFFF"
                      style={styles.heroIcon}
                    />
                    <Text style={styles.heroTagline} numberOfLines={5}>
                      {heroPrimaryLine}
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}
          </View>

          {showDividerAfterHero && <SectionDivider />}

          {loadingNarrative && (
            <View style={styles.paddedSection}>
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#F47C3C" />
                <Text style={styles.loadingText}>{t('report:personalizingSummary')}</Text>
              </View>
            </View>
          )}

          {extraSpotlights.length > 0 && (
            <View style={styles.paddedSection} accessibilityRole="summary">
              {extraSpotlights.map((line, i) => (
                <View key={`spot-${i}`} style={styles.spotlightRow}>
                  <MaterialCommunityIcons
                    name={iconNameForSpotlightFact(line)}
                    size={22}
                    color="#F47C3C"
                    style={styles.spotlightIcon}
                  />
                  <Text style={styles.spotlightLine}>{line}</Text>
                </View>
              ))}
            </View>
          )}

          {hasSummary && (
            <>
              {(loadingNarrative || extraSpotlights.length > 0) && <SectionDivider />}
              <View style={styles.paddedSection}>
                <Text style={styles.headline}>{narrative!.headline}</Text>
                {narrative!.winsBullets.map((line, i) => (
                  <View key={`w${i}`} style={styles.bulletRow}>
                    <Text style={styles.bulletMark}>•</Text>
                    <Text style={styles.bulletText}>{line}</Text>
                  </View>
                ))}
                {narrative!.improvementBullets.map((line, i) => (
                  <View key={`i${i}`} style={styles.bulletRow}>
                    <Text style={styles.improveBulletMark}>•</Text>
                    <Text style={styles.improveBulletText}>{line}</Text>
                  </View>
                ))}
                <Text style={styles.closing}>{narrative!.closing}</Text>
              </View>
            </>
          )}

          {hasCharts && (
            <>
              {(loadingNarrative || extraSpotlights.length > 0 || hasSummary) && <SectionDivider />}

              {/* ── 1) CONSISTENCY ── */}
              <ConsistencySection
                metrics={metrics!}
                labels={chartLabels}
                consistencyVals={chartConsistencyVals}
              />

              <SectionDivider />

              {/* ── 2) TRAINING ── */}
              <TrainingSection
                metrics={metrics!}
                labels={chartLabels}
                trainingChartVals={chartTrainingVals}
              />

              <SectionDivider />

              {/* ── 3) NUTRITION ── */}
              <NutritionSection metrics={metrics!} />

              {metrics!.muscleBalance && metrics!.muscleBalance.data.length > 0 && (
                <>
                  <SectionDivider />
                  {/* ── 4) MUSCLE BALANCE ── */}
                  <MuscleBalanceSection metrics={metrics!} gender={mapGender} goal={userGoal} />
                </>
              )}
            </>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <TouchableOpacity
            style={styles.talkCoachBtn}
            onPress={onTalkToCoach}
            accessibilityRole="button"
            accessibilityLabel={t('report:a11yTalkToCoach')}
          >
            <MaterialCommunityIcons name="message-text-outline" size={22} color="#0B1114" />
            <Text style={styles.talkCoachBtnText}>{t('report:talkToCoach')}</Text>
          </TouchableOpacity>
        </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  body: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(244,124,60,0.15)',
  },
  headerBtn: {
    width: 72,
    minHeight: 44,
    justifyContent: 'center',
  },
  closeText: {
    color: '#F47C3C',
    fontSize: 17,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: '#F2F2EE',
  },
  scroll: {
    flex: 1,
  },
  scrollInner: {
    paddingBottom: 24,
  },
  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(244,124,60,0.18)',
    marginVertical: 0,
  },
  paddedSection: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 18,
  },
  heroBleed: {
    width: '100%',
    marginTop: 0,
    marginBottom: 22,
  },
  heroCard: {
    width: '100%',
    height: 280,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1A2428',
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  heroTextBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 36,
  },
  heroCoachName: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 10,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  heroMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroIcon: {
    marginTop: 2,
  },
  heroTagline: {
    flex: 1,
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 30,
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#9AA3A6',
    fontSize: 15,
  },
  spotlightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  spotlightIcon: {
    marginTop: 3,
  },
  spotlightLine: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    color: '#E8EDEF',
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  headline: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 14,
    lineHeight: 26,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    paddingRight: 4,
  },
  bulletMark: {
    width: 28,
    marginRight: 10,
    fontSize: 15,
    fontWeight: '600',
    color: '#C8CDD0',
    lineHeight: 22,
    textAlign: 'center',
  },
  bulletText: {
    flex: 1,
    flexShrink: 1,
    fontSize: 15,
    color: '#C8CDD0',
    lineHeight: 22,
  },
  improveBulletMark: {
    width: 28,
    marginRight: 10,
    fontSize: 15,
    fontWeight: '600',
    color: '#E8B86D',
    lineHeight: 22,
    textAlign: 'center',
  },
  improveBulletText: {
    flex: 1,
    flexShrink: 1,
    fontSize: 15,
    color: '#E8B86D',
    lineHeight: 22,
  },
  closing: {
    marginTop: 12,
    fontSize: 15,
    color: '#9AA3A6',
    fontStyle: 'italic',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F2F2EE',
  },
  /* ── Consistency ── */
  scoreBadgeRow: {
    alignItems: 'center',
    marginBottom: 14,
  },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  scoreBadgeValue: {
    fontSize: 42,
    fontWeight: '800',
    color: '#F47C3C',
    lineHeight: 48,
  },
  scoreBadgeLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6F7A7E',
    marginLeft: 2,
  },
  calloutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  calloutIcon: {
    marginRight: 10,
    width: 20,
    textAlign: 'center' as const,
  },
  calloutText: {
    fontSize: 14,
    color: '#C8CDD0',
    lineHeight: 20,
  },
  /* ── Training ── */
  statCardsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,124,60,0.08)',
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  statCardValue: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F2F2EE',
    lineHeight: 30,
  },
  statCardLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9AA3A6',
    marginTop: 2,
  },
  statCardSub: {
    fontSize: 11,
    color: '#6F7A7E',
    marginTop: 4,
    textAlign: 'center',
  },
  /* ── Nutrition ── */
  emptyText: {
    fontSize: 14,
    color: '#6F7A7E',
    fontStyle: 'italic',
  },
  nutritionSubtitle: {
    fontSize: 14,
    color: '#9AA3A6',
    marginBottom: 14,
  },
  muscleFocusBar: {
    width: '100%',
    marginBottom: 16,
  },
  muscleOpportunity: {
    fontSize: 14,
    color: '#C5C9C7',
    lineHeight: 20,
    marginTop: 14,
  },
  macroBarOuter: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 14,
  },
  macroBarSegment: {
    height: '100%',
  },
  macroLegendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 3,
  },
  legendLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  legendTarget: {
    fontSize: 11,
    color: '#6F7A7E',
    marginTop: 1,
  },
  deviationSection: {
    marginTop: 4,
  },
  deviationTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6F7A7E',
    marginBottom: 12,
  },
  devBarRow: {
    marginBottom: 12,
  },
  devBarLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  devBarLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#F2F2EE',
  },
  devBarValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9AA3A6',
  },
  devBarValueWarn: {
    color: '#E8B86D',
  },
  devBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    position: 'relative',
  },
  devBarFill: {
    height: '100%',
    borderRadius: 3,
    minWidth: 2,
    opacity: 0.9,
  },
  devBarThreshold: {
    position: 'absolute',
    left: `${(100 / 140) * 100}%` as any,
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 1,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(244,124,60,0.15)',
    paddingHorizontal: 20,
    paddingTop: 14,
    backgroundColor: '#0B1114',
  },
  talkCoachBtn: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#F47C3C',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  talkCoachBtnText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#0B1114',
  },
});
