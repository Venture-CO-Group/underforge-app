import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Muted, premium macro colors
const COLORS = {
  carbs: '#8B6E6E',    // Dusty rose
  protein: '#5A9E97',  // Sage teal
  fat: '#B89878',      // Warm sand
  fiber: '#7E78A8',    // Muted lavender
};

interface MacrosChartProps {
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  carbsTarget: number;
  proteinTarget: number;
  fatTarget: number;
  fiberTarget: number;
  caloriesTarget: number;
  caloriesPercentOfTarget?: number;
  totalCalories?: number;
  showFooter?: boolean;
  showTargetInBars?: boolean;
  compact?: boolean;
  caloriesTargetFootnoteMarker?: string;
}

/**
 * A single progress bar row for a macro nutrient.
 */
function MacroProgressBar({
  label,
  grams,
  target,
  color,
  showTarget = true,
  compact = false,
}: {
  label: string;
  grams: number;
  target: number;
  color: string;
  showTarget?: boolean;
  compact?: boolean;
}) {
  const targetRounded = Math.round(target);
  const gramsRounded = Math.round(grams);
  const percent = targetRounded > 0 ? (grams / targetRounded) * 100 : 0;
  const clampedPercent = Math.min(percent, 120);
  const scaledBarWidth = (clampedPercent / 120) * 100;
  const isOver = percent > 100;

  return (
    <View style={[barStyles.row, compact && barStyles.rowCompact]}>
      <View style={[barStyles.labelRow, compact && barStyles.labelRowCompact]}>
        <View style={barStyles.labelLeft}>
          <View style={[barStyles.dot, { backgroundColor: color }]} />
          <Text style={barStyles.label}>{label}</Text>
        </View>
        <Text style={[barStyles.value, isOver && barStyles.valueOver]}>
          {showTarget ? `${gramsRounded}g / ${targetRounded}g` : `${gramsRounded}g`}
        </Text>
      </View>
      <View style={barStyles.trackOuter}>
        <View style={barStyles.track}>
          <View
            style={[
              barStyles.fill,
              {
                backgroundColor: color,
                width: `${scaledBarWidth}%` as any,
                opacity: isOver ? 1 : 0.9,
              },
            ]}
          />
          <View style={barStyles.threshold} />
        </View>
      </View>
    </View>
  );
}

/**
 * Semicircular arc gauge for calorie progress.
 * Sweeps 180 degrees from left to right. Distinct from donut and bar charts.
 */
function CalorieArcGauge({
  totalCalories,
  caloriesTarget,
  percent,
  showFooter = true,
  compact = false,
  overTargetText,
  remainingText,
  ofTargetText,
}: {
  totalCalories: number;
  caloriesTarget: number;
  percent: number;
  showFooter?: boolean;
  compact?: boolean;
  overTargetText: string;
  remainingText: string;
  ofTargetText: string;
}) {
  const width = 200;
  const height = 115;
  const cx = width / 2;
  const cy = 100;
  const radius = 80;
  const arcStroke = 10;

  // Build a semicircular arc path (180 degrees, left to right)
  const describeArc = (startAngle: number, endAngle: number) => {
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  // Full semicircle: 180° to 360° (bottom half, left to right)
  const trackPath = describeArc(180, 360);
  // Filled portion: clamp to 100%
  const fillAngle = 180 + Math.min(percent, 100) * 1.8; // 1.8 = 180/100
  const fillPath = describeArc(180, Math.max(fillAngle, 181));

  const isOver = percent > 100;

  return (
    <View style={[arcStyles.container, compact && arcStyles.containerCompact]}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Track */}
        <Path
          d={trackPath}
          stroke="#1E2A2C"
          strokeWidth={arcStroke}
          fill="none"
          strokeLinecap="round"
        />
        {/* Filled arc */}
        <Path
          d={fillPath}
          stroke={'#F47C3C'}
          strokeWidth={arcStroke}
          fill="none"
          strokeLinecap="round"
        />
      </Svg>
      <View style={arcStyles.centerText}>
        <Text style={arcStyles.calNumber}>{totalCalories}</Text>
        <Text style={arcStyles.calUnit}>kcal</Text>
      </View>
      {showFooter && (
        <View style={arcStyles.footer}>
          <Text style={arcStyles.footerText}>
            {isOver ? overTargetText : remainingText}
          </Text>
          <Text style={arcStyles.footerTarget}>{ofTargetText}</Text>
        </View>
      )}
    </View>
  );
}

export interface MacroInlineStripProps {
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  carbsTarget: number;
  proteinTarget: number;
  fatTarget: number;
  fiberTarget: number;
}

function InlineMacroCell({
  label,
  grams,
  target,
  color,
}: {
  label: string;
  grams: number;
  target: number;
  color: string;
}) {
  const targetRounded = Math.max(0, Math.round(target));
  const gramsRounded = Math.max(0, Math.round(grams));
  const scaleMax = Math.max(targetRounded, gramsRounded, 1);
  const fillPct = Math.min(100, Math.round((gramsRounded / scaleMax) * 100));
  const targetPct = Math.min(100, Math.round((targetRounded / scaleMax) * 100));

  return (
    <View
      style={inlineStyles.cell}
      accessibilityLabel={`${label}: ${gramsRounded} of ${targetRounded} grams`}
    >
      <View style={inlineStyles.cellHeader}>
        <View style={inlineStyles.cellLabel}>
          <View style={[inlineStyles.dot, { backgroundColor: color }]} />
          <Text style={inlineStyles.macroLabel} numberOfLines={1}>
            {label}
          </Text>
        </View>
        <Text style={inlineStyles.cellValue}>
          {gramsRounded}
          <Text style={inlineStyles.cellValueDim}>/{targetRounded}g</Text>
        </Text>
      </View>
      <View style={inlineStyles.cellTrack}>
        <View
          style={[
            inlineStyles.cellGhost,
            { width: `${targetPct}%`, backgroundColor: `${color}33` },
          ]}
        />
        <View
          style={[inlineStyles.cellFill, { width: `${fillPct}%`, backgroundColor: color }]}
        />
      </View>
    </View>
  );
}

/** Compact 2×2 macro bars for embedding under the home "Calories to consume" card. */
export function MacroInlineStrip({
  carbs,
  protein,
  fat,
  fiber,
  carbsTarget,
  proteinTarget,
  fatTarget,
  fiberTarget,
}: MacroInlineStripProps) {
  const { t } = useTranslation('home');

  const items: Array<{
    id: string;
    label: string;
    grams: number;
    target: number;
    color: string;
  }> = [
    {
      id: 'protein',
      label: t('home:macroInlineProtein', { defaultValue: 'Protein' }),
      grams: protein,
      target: proteinTarget,
      color: COLORS.protein,
    },
    {
      id: 'carb',
      label: t('home:macroInlineCarb', { defaultValue: 'Carb' }),
      grams: carbs,
      target: carbsTarget,
      color: COLORS.carbs,
    },
    {
      id: 'fat',
      label: t('home:macroInlineFat', { defaultValue: 'Fat' }),
      grams: fat,
      target: fatTarget,
      color: COLORS.fat,
    },
    {
      id: 'fiber',
      label: t('home:macroInlineFiber', { defaultValue: 'Fiber' }),
      grams: fiber,
      target: fiberTarget,
      color: COLORS.fiber,
    },
  ];

  return (
    <View style={inlineStyles.grid}>
      {items.map((item) => (
        <InlineMacroCell
          key={item.id}
          label={item.label}
          grams={item.grams}
          target={item.target}
          color={item.color}
        />
      ))}
    </View>
  );
}

export default function MacrosChart({
  carbs,
  protein,
  fat,
  fiber,
  carbsTarget,
  proteinTarget,
  fatTarget,
  fiberTarget,
  caloriesTarget,
  caloriesPercentOfTarget,
  totalCalories: passedCalories,
  showFooter = true,
  showTargetInBars = true,
  compact = false,
  caloriesTargetFootnoteMarker = '',
}: MacrosChartProps) {
  const { t } = useTranslation('home');
  const calculatedCalories = Math.ceil(carbs * 4 + protein * 4 + fat * 9);
  const totalCalories = passedCalories ?? calculatedCalories;
  const calculatedCaloriesPercent = caloriesTarget > 0 ? Math.round((totalCalories / caloriesTarget) * 100) : 0;
  const displayCaloriesPercent = Math.round(caloriesPercentOfTarget ?? calculatedCaloriesPercent);

  const remainingCal = Math.max(caloriesTarget - totalCalories, 0);
  const overBy = totalCalories - caloriesTarget;

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {/* Calorie arc gauge */}
      <CalorieArcGauge
        totalCalories={totalCalories}
        caloriesTarget={caloriesTarget}
        percent={displayCaloriesPercent}
        showFooter={showFooter}
        compact={compact}
        overTargetText={t('home:caloriesOverTarget', { n: overBy })}
        remainingText={t('home:caloriesRemaining', { n: remainingCal })}
        ofTargetText={`${t('home:caloriesOfTargetLine', { target: caloriesTarget })}${caloriesTargetFootnoteMarker}`}
      />

      {/* Progress bars */}
      <View style={styles.barsContainer}>
        <MacroProgressBar label={t('home:macroCarbs')} grams={carbs} target={carbsTarget} color={COLORS.carbs} showTarget={showTargetInBars} compact={compact} />
        <MacroProgressBar label={t('home:macroProtein')} grams={protein} target={proteinTarget} color={COLORS.protein} showTarget={showTargetInBars} compact={compact} />
        <MacroProgressBar label={t('home:macroFat')} grams={fat} target={fatTarget} color={COLORS.fat} showTarget={showTargetInBars} compact={compact} />
        <MacroProgressBar label={t('home:macroFiber')} grams={fiber} target={fiberTarget} color={COLORS.fiber} showTarget={showTargetInBars} compact={compact} />
      </View>

      {/* Targets summary */}
      {!compact && (
        <View style={styles.targetsContainer}>
          <Text style={styles.targetText}>
            {t('home:nutritionTargetsSummary', {
              cal: Math.round(caloriesTarget),
              c: Math.round(carbsTarget),
              p: Math.round(proteinTarget),
              f: Math.round(fatTarget),
              fib: Math.round(fiberTarget),
            })}
          </Text>
        </View>
      )}
    </View>
  );
}

const arcStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginBottom: 20,
    paddingTop: 4,
  },
  containerCompact: {
    marginBottom: 8,
    paddingTop: 0,
  },
  centerText: {
    position: 'absolute',
    top: 48,
    alignItems: 'center',
  },
  calNumber: {
    fontSize: 32,
    fontWeight: '700',
    color: '#F47C3C',
    lineHeight: 36,
  },
  calUnit: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9AA3A6',
    letterSpacing: 0.5,
    marginTop: 0,
  },
  footer: {
    alignItems: 'center',
    marginTop: -4,
  },
  footerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  footerTarget: {
    fontSize: 11,
    fontWeight: '500',
    color: '#6F7A7E',
    marginTop: 2,
  },
});

const barStyles = StyleSheet.create({
  row: {
    marginBottom: 12,
  },
  rowCompact: {
    marginBottom: 8,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  labelRowCompact: {
    marginBottom: 3,
  },
  labelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#F2F2EE',
  },
  value: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9AA3A6',
  },
  valueOver: {
    color: '#D4845A',
  },
  trackOuter: {
    width: '100%',
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    minWidth: 2,
  },
  threshold: {
    position: 'absolute',
    left: '83.33%',
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 1,
  },
});

const inlineStyles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 8,
    marginTop: 2,
  },
  cell: {
    width: '48%',
    flexGrow: 1,
    flexBasis: '46%',
    gap: 4,
  },
  cellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  cellLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  macroLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9AA3A6',
    letterSpacing: 0.1,
    flexShrink: 1,
  },
  cellValue: {
    fontSize: 11,
    fontWeight: '600',
    color: '#C8CECF',
  },
  cellValueDim: {
    fontSize: 10,
    fontWeight: '500',
    color: '#6F7A7E',
  },
  cellTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#0E1A1A',
    overflow: 'hidden',
    position: 'relative',
  },
  cellGhost: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 2,
  },
  cellFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 2,
    opacity: 0.92,
  },
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  containerCompact: {
    paddingVertical: 6,
  },
  barsContainer: {
    width: '100%',
  },
  targetsContainer: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    width: '100%',
  },
  targetText: {
    fontSize: 11,
    color: '#6F7A7E',
    textAlign: 'center',
  },
});
