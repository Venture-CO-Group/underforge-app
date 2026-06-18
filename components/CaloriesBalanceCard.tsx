/**
 * Two-card "calories in / calories actively out" section between the weekly
 * tracker and the rest of the dashboard. The consume card embeds the full
 * calorie + macros chart with an inline adjustment footnote when applicable.
 * The burn card excludes BMR (BMR is shown inside the breakdown modal).
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize } from '../constants/Typography';
import type { NutritionAdjustment } from '../lib/nutrition-adjustment';
import type { ActiveBurnHomeRow } from '../lib/calories-balance-math';
import {
  calculateMacrosFromCalories,
  type DailyNutritionTotals,
} from '../lib/nutrition-storage';
import type { TrainingDaySwapKind } from '../lib/training-day-status';
import { styles as dashboardStyles } from '../styles/CoachDashboard.styles';
import CaloriesBurnedBreakdownModal from './CaloriesBurnedBreakdownModal';
import DayTypeLabel from './DayTypeLabel';
import MacrosChart from './MacrosChart';

const DEFAULT_LOADING_TARGETS = calculateMacrosFromCalories(2000);

interface Props {
  nutritionData: DailyNutritionTotals | null;
  nutritionAdjustment: NutritionAdjustment | null;
  /** Per-category burn rows (sessions + daily movement). Preferred over legacy totals. */
  activeBurnRows?: ActiveBurnHomeRow[];
  /** @deprecated Use activeBurnRows; kept as fallback when rows are unavailable. */
  activeBurnedKcal?: number;
  activeBurnedTargetKcal?: number;
  dayType?: 'training' | 'rest';
  daySwapped?: boolean;
  swapKind?: TrainingDaySwapKind;
  plannedTraining?: boolean;
  onDayTypeOverrideChanged?: () => void | Promise<void>;
  modalInputs?: {
    userId: string;
    todayYmd: string;
    bmrKcal: number;
    weightKg: number;
    occupationNeatKcal: number;
    plannedTrainingToday: boolean;
    /** Plan step_1 estimated session kcal; used with plannedTrainingToday. */
    plannedSessionTargetKcal?: number;
  };
}

const BAR_HEIGHT = 14;
const MACROS_SCALE = 0.9;

function sumActiveBurnRows(rows: ActiveBurnHomeRow[]): {
  achievedKcal: number;
  targetKcal: number;
} {
  return {
    achievedKcal: rows.reduce((s, r) => s + r.achievedKcal, 0),
    targetKcal: rows.reduce((s, r) => s + r.targetKcal, 0),
  };
}

interface BarRowProps {
  label: string;
  achievedKcal: number;
  targetKcal: number;
  fillColor: string;
  ghostColor: string;
  labelSuffix?: string;
  dimmed?: boolean;
  showChevron?: boolean;
  /** Extra space between the label row and the bar track. */
  labelBarGap?: number;
}

const CalorieBarRow: React.FC<BarRowProps> = ({
  label,
  achievedKcal,
  targetKcal,
  fillColor,
  ghostColor,
  labelSuffix,
  dimmed = false,
  showChevron,
  labelBarGap,
}) => {
  const achieved = Math.max(0, Math.round(achievedKcal));
  const targetRounded = Math.max(0, Math.round(targetKcal));
  const scaleMax = Math.max(achieved, targetRounded, 1);
  const toPct = (value: number) => Math.min(100, Math.round((value / scaleMax) * 100));
  const achievedPct = toPct(achieved);
  const targetPct = toPct(targetRounded);
  const mutedFill = '#5C6B70';
  const barFill = dimmed ? mutedFill : fillColor;
  const barGhost = dimmed ? 'rgba(92, 107, 112, 0.22)' : ghostColor;

  return (
    <View
      style={[
        styles.row,
        dimmed && styles.rowDimmed,
        labelBarGap != null ? { gap: labelBarGap } : null,
      ]}
    >
      <View style={styles.rowHeader}>
        <View style={styles.rowLabelWrap}>
          <Text style={[styles.rowLabel, dimmed && styles.rowLabelDimmed]} numberOfLines={2}>
            {label}
          </Text>
          {labelSuffix ? (
            <Text style={styles.rowLabelSuffix}>{labelSuffix}</Text>
          ) : null}
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.rowValue, dimmed && styles.rowValueDimmed]}>
            {achieved.toLocaleString()}
            <Text style={styles.rowValueSecondary}>
              {' / '}
              {targetRounded.toLocaleString()} kcal
            </Text>
          </Text>
          {showChevron ? <Text style={styles.chevron}>›</Text> : null}
        </View>
      </View>
      <View style={styles.track}>
        {dimmed ? (
          <View style={[styles.placeholderFill, { backgroundColor: barGhost }]} />
        ) : (
          <>
            <View style={[styles.ghost, { backgroundColor: barGhost, width: `${targetPct}%` }]} />
            <View style={[styles.fill, { backgroundColor: barFill, width: `${achievedPct}%` }]} />
            {targetRounded > 0 ? (
              <View style={[styles.targetMarker, { left: `${targetPct}%` }]} />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
};

export const CaloriesBalanceCard: React.FC<Props> = ({
  nutritionData,
  nutritionAdjustment,
  activeBurnRows,
  activeBurnedKcal = 0,
  activeBurnedTargetKcal = 0,
  dayType,
  daySwapped,
  swapKind,
  plannedTraining,
  onDayTypeOverrideChanged,
  modalInputs,
}) => {
  const { t } = useTranslation(['home']);
  const [breakdownVisible, setBreakdownVisible] = useState(false);
  const [macrosLayoutHeight, setMacrosLayoutHeight] = useState(0);

  const hasAdjustment =
    nutritionAdjustment != null &&
    nutritionAdjustment.adjustedCaloriesTarget !== nutritionAdjustment.baseCaloriesTarget;

  const dayTypeNode = dayType ? (
    <DayTypeLabel
      dayType={dayType}
      daySwapped={daySwapped}
      swapKind={swapKind}
      plannedTraining={plannedTraining}
      userId={modalInputs?.userId}
      ymd={modalInputs?.todayYmd}
      onOverrideChanged={onDayTypeOverrideChanged}
      style={styles.dayTypeInTitleRow}
    />
  ) : null;

  // Absorb the visual whitespace left by the scale transform so the card hugs
  // the chart. Layout height is the unscaled height; the rendered visual height
  // is `layoutHeight * MACROS_SCALE`, leaving `layoutHeight * (1 - MACROS_SCALE)`
  // of extra space below the chart that we collapse via a negative margin.
  const macrosScaleGap = macrosLayoutHeight > 0
    ? -Math.round(macrosLayoutHeight * (1 - MACROS_SCALE))
    : 0;

  const adjustmentFootnote =
    hasAdjustment && nutritionAdjustment
      ? (() => {
          const movementKcal =
            nutritionAdjustment.activityCaloriesBurned + nutritionAdjustment.stepsNeatCalories;
          const parts: string[] = [];
          if (nutritionAdjustment.activityCaloriesBurned > 0) {
            parts.push(
              t('home:adjustedTargetActivity', {
                kcal: nutritionAdjustment.activityCaloriesBurned,
                defaultValue: `${nutritionAdjustment.activityCaloriesBurned} kcal from today's activity`,
              }),
            );
          }
          if (nutritionAdjustment.stepsNeatCalories > 0) {
            parts.push(
              t('home:adjustedTargetSteps', {
                kcal: nutritionAdjustment.stepsNeatCalories,
                defaultValue: `${nutritionAdjustment.stepsNeatCalories} kcal from steps`,
              }),
            );
          }
          return t('home:adjustedTargetFootnote', {
            kcal: movementKcal,
            details: parts.join(' + '),
            defaultValue: `*Your base calories were adjusted to include +${movementKcal} kcal from today's movement.`,
          });
        })()
      : null;

  return (
    <>
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Text style={[dashboardStyles.sectionTitle, styles.titleInRow, styles.titleFlex]}>
            {t('home:calsToConsume', { defaultValue: 'Calories to consume' })}
          </Text>
          {dayTypeNode}
        </View>
        <View style={styles.macrosClip}>
          <View
            style={[styles.macrosScaleWrap, { marginBottom: macrosScaleGap }]}
            onLayout={(e) => {
              const h = Math.round(e.nativeEvent.layout.height);
              if (h !== macrosLayoutHeight) setMacrosLayoutHeight(h);
            }}
            pointerEvents="none"
          >
            <MacrosChart
              compact
              carbs={nutritionData?.totalCarbs ?? 0}
              protein={nutritionData?.totalProtein ?? 0}
              fat={nutritionData?.totalFat ?? 0}
              fiber={nutritionData?.totalFiber ?? 0}
              carbsTarget={nutritionData?.carbsTarget ?? DEFAULT_LOADING_TARGETS.carbsTarget}
              proteinTarget={
                nutritionData?.proteinTarget ?? DEFAULT_LOADING_TARGETS.proteinTarget
              }
              fatTarget={nutritionData?.fatTarget ?? DEFAULT_LOADING_TARGETS.fatTarget}
              fiberTarget={nutritionData?.fiberTarget ?? DEFAULT_LOADING_TARGETS.fiberTarget}
              caloriesTarget={
                nutritionData?.caloriesTarget ?? DEFAULT_LOADING_TARGETS.caloriesTarget
              }
              caloriesPercentOfTarget={nutritionData?.caloriesPercentOfTarget}
              totalCalories={nutritionData?.totalCalories}
              caloriesTargetFootnoteMarker={hasAdjustment ? '*' : ''}
            />
          </View>
        </View>
        {adjustmentFootnote ? (
          <Text style={styles.footnote}>{adjustmentFootnote}</Text>
        ) : null}
      </View>

      <TouchableOpacity
        style={styles.card}
        onPress={() => modalInputs && setBreakdownVisible(true)}
        activeOpacity={modalInputs ? 0.85 : 1}
        disabled={!modalInputs}
        accessibilityHint={t('home:calsToActivelyBurnHint', {
          defaultValue: 'Tap for burn breakdown',
        })}
      >
        <View style={styles.titleRow}>
          <Text style={[dashboardStyles.sectionTitle, styles.titleInRow, styles.titleFlex]}>
            {t('home:calsToActivelyBurn', { defaultValue: 'Calories to actively burn' })}
          </Text>
          {dayTypeNode}
        </View>
        {(() => {
          const burnRows = activeBurnRows ?? [];
          const burnTotals =
            burnRows.length > 0
              ? sumActiveBurnRows(burnRows)
              : { achievedKcal: activeBurnedKcal, targetKcal: activeBurnedTargetKcal };

          return (
            <CalorieBarRow
              label={t('home:calsBalanceBurned', { defaultValue: 'Burned' })}
              achievedKcal={burnTotals.achievedKcal}
              targetKcal={burnTotals.targetKcal}
              fillColor="#F47C3C"
              ghostColor="rgba(244, 124, 60, 0.25)"
              showChevron={!!modalInputs}
            />
          );
        })()}
      </TouchableOpacity>

      {modalInputs ? (
        <CaloriesBurnedBreakdownModal
          visible={breakdownVisible}
          onClose={() => setBreakdownVisible(false)}
          userId={modalInputs.userId}
          todayYmd={modalInputs.todayYmd}
          bmrKcal={modalInputs.bmrKcal}
          weightKg={modalInputs.weightKg}
          occupationNeatKcal={modalInputs.occupationNeatKcal}
          plannedTrainingToday={modalInputs.plannedTrainingToday}
          plannedSessionTargetKcal={modalInputs.plannedSessionTargetKcal ?? 0}
        />
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginHorizontal: 20,
    marginTop: 12,
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleInRow: {
    marginBottom: 0,
  },
  titleFlex: {
    flex: 1,
    flexShrink: 1,
  },
  dayTypeInTitleRow: {
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  macrosClip: {
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  macrosScaleWrap: {
    alignSelf: 'stretch',
    transform: [{ scale: MACROS_SCALE }],
    transformOrigin: 'top center',
  },
  row: {
    gap: 6,
  },
  rowDimmed: {
    opacity: 0.72,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 6,
  },
  rowLabelWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 6,
    paddingRight: 4,
  },
  rowLabelDimmed: {
    color: BrandColors.textTertiary,
  },
  rowLabelSuffix: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall - 1,
    fontWeight: '400',
    color: BrandColors.textTertiary,
    flexShrink: 0,
  },
  rowValueDimmed: {
    color: BrandColors.textTertiary,
  },
  placeholderFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: BAR_HEIGHT / 2,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    maxWidth: '72%',
    justifyContent: 'flex-end',
  },
  rowLabel: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textSecondary,
  },
  rowValue: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    fontWeight: '400',
    color: BrandColors.textTertiary,
    textAlign: 'right',
    flexShrink: 1,
  },
  rowValueSecondary: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    fontWeight: '400',
    color: BrandColors.textTertiary,
  },
  chevron: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 28,
    color: BrandColors.textPrimary,
    opacity: 0.9,
    lineHeight: 30,
    paddingLeft: 2,
    minWidth: 30,
    textAlign: 'center',
  },
  track: {
    height: BAR_HEIGHT,
    backgroundColor: '#0E1A1A',
    borderRadius: BAR_HEIGHT / 2,
    overflow: 'hidden',
    position: 'relative',
  },
  ghost: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: BAR_HEIGHT / 2,
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: BAR_HEIGHT / 2,
  },
  targetMarker: {
    position: 'absolute',
    top: -1,
    bottom: -1,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: 'rgba(242, 242, 238, 0.75)',
  },
  footnote: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    lineHeight: 16,
    marginTop: 2,
  },
});

export default CaloriesBalanceCard;
