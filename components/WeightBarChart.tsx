import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, ClipPath, Defs, G, Image as SvgImage, Line, Rect, Text as SvgText } from 'react-native-svg';

import { BodyCompositionChartData, DateRange, WeightUnit, convertWeight } from '../lib/body-composition-storage';
import { buildBodyProgressWeekSlots, formatBodyProgressAxisMonth } from '../lib/body-progress-week-axis';

interface WeightBarChartProps {
  data: BodyCompositionChartData[];
  displayUnit: WeightUnit;
  dateRange: DateRange;
  width?: number;
  height?: number;
  /** Tapping a week's front-photo thumbnail opens the full-size viewer. */
  onPhotoPress?: (entry: BodyCompositionChartData) => void;
}

export default function WeightBarChart({
  data,
  displayUnit,
  dateRange,
  width = 340,
  height = 220,
  onPhotoPress,
}: WeightBarChartProps) {
  const { t, i18n } = useTranslation(['progress']);
  /** Hide only in-chart overlays (values on bars), not axis or subtitle. */
  const hideInsideValueLabels = dateRange === '6months';
  const paddingLeft = 50;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 60;
  
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  if (data.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{t('progress:chartWeightEmpty')}</Text>
        <Text style={styles.emptySubtext}>{t('progress:chartWeightEmptySub')}</Text>
      </View>
    );
  }

  const weekSlots = buildBodyProgressWeekSlots(data);
  const isMonthAxis = dateRange === '3months' || dateRange === '6months';
  // Pre-compute display weights and y-axis range from logged slots only.
  const loggedWeights = weekSlots
    .filter(s => s.data !== null)
    .map(s => convertWeight(s.data!.weightValue, s.data!.weightUnit, displayUnit));
  const minWeight = Math.floor(Math.min(...loggedWeights) - 2);
  const maxWeight = Math.ceil(Math.max(...loggedWeights) + 2);
  const range = maxWeight - minWeight;

  // Calculate bar dimensions based on all weeks (including empty)
  const barCount = weekSlots.length;
  const barGap = 8;
  const maxBarWidth = 40;
  const availableWidth = chartWidth - (barGap * (barCount - 1));
  const barWidth = Math.min(maxBarWidth, availableWidth / barCount);
  const totalBarsWidth = (barWidth * barCount) + (barGap * (barCount - 1));
  const startX = paddingLeft + (chartWidth - totalBarsWidth) / 2;

  // Y-axis scale
  const yScale = (value: number) => {
    return paddingTop + chartHeight - ((value - minWeight) / range) * chartHeight;
  };

  // Generate Y-axis ticks
  const yTicks = [];
  const tickCount = 5;
  for (let i = 0; i <= tickCount; i++) {
    const value = minWeight + (range / tickCount) * i;
    yTicks.push(Math.round(value * 10) / 10);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('progress:chartWeightTitle', { unit: displayUnit })}</Text>
      <Text style={styles.legend}>
        {t(isMonthAxis ? 'progress:chartWeightLegendMonths' : 'progress:chartWeightLegend')}
      </Text>
      <Svg width={width} height={height}>
        {/* Y-axis */}
        <Line
          x1={paddingLeft}
          y1={paddingTop}
          x2={paddingLeft}
          y2={paddingTop + chartHeight}
          stroke="#E5E5E5"
          strokeWidth={1}
        />

        {/* Y-axis ticks and labels */}
        {yTicks.map((tick, i) => (
          <G key={`y-tick-${i}`}>
            <Line
              x1={paddingLeft - 5}
              y1={yScale(tick)}
              x2={paddingLeft}
              y2={yScale(tick)}
              stroke="#E5E5E5"
              strokeWidth={1}
            />
            <SvgText
              x={paddingLeft - 10}
              y={yScale(tick) + 4}
              fontSize={10}
              fill="#666"
              textAnchor="end"
            >
              {tick}
            </SvgText>
            {/* Grid line */}
            <Line
              x1={paddingLeft}
              y1={yScale(tick)}
              x2={width - paddingRight}
              y2={yScale(tick)}
              stroke="#F0F0F0"
              strokeWidth={1}
              strokeDasharray="4,4"
            />
          </G>
        ))}

        {/* X-axis */}
        <Line
          x1={paddingLeft}
          y1={paddingTop + chartHeight}
          x2={width - paddingRight}
          y2={paddingTop + chartHeight}
          stroke="#E5E5E5"
          strokeWidth={1}
        />

        {/* Bars */}
        {weekSlots.map((slot, i) => {
          const x = startX + i * (barWidth + barGap);
          const hasData = slot.data !== null;
          const displayWeight = hasData
            ? convertWeight(slot.data!.weightValue, slot.data!.weightUnit, displayUnit)
            : 0;
          const barHeight = hasData ? ((displayWeight - minWeight) / range) * chartHeight : 0;
          const y = paddingTop + chartHeight - barHeight;
          // Tiny circular front-photo thumbnail floating above the bar, so each
          // bar visibly corresponds to that week's progress photo.
          const photoUrl = hasData ? slot.data!.photoFrontUrl : null;
          const photoSize = Math.min(22, Math.max(14, barWidth + 4));
          const photoR = photoSize / 2;
          const photoCx = x + barWidth / 2;
          const labelClearance = hideInsideValueLabels ? 4 : 16;
          const photoCy = Math.max(paddingTop + photoR + 1, y - labelClearance - photoR);
          const clipId = `wphoto-${slot.year}-${slot.week}`;
          const prevSlot = i > 0 ? weekSlots[i - 1] : null;
          const isFirstOfMonth = isMonthAxis && (
            prevSlot === null || prevSlot.weekMonday.getMonth() !== slot.weekMonday.getMonth()
              || prevSlot.weekMonday.getFullYear() !== slot.weekMonday.getFullYear()
          );

          return (
            <G key={`bar-${slot.year}-${slot.week}`}>
              {/* Bar (only if data exists) */}
              {hasData && (
                <Rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill="#F47C3C"
                  rx={4}
                  ry={4}
                />
              )}
              {/* Value on top of bar (only if data exists) */}
              {hasData && !hideInsideValueLabels && (
                <SvgText
                  x={x + barWidth / 2}
                  y={y - 5}
                  fontSize={9}
                  fill="#FFFFFF"
                  textAnchor="middle"
                  fontWeight="600"
                >
                  {displayWeight.toFixed(1)}
                </SvgText>
              )}
              {/* Front progress photo above the bar (only if logged that week).
                  Tappable (with an enlarged invisible hit circle) to open the
                  full-size photo viewer. */}
              {photoUrl && (
                <G onPress={onPhotoPress ? () => onPhotoPress(slot.data!) : undefined}>
                  <Defs>
                    <ClipPath id={clipId}>
                      <Circle cx={photoCx} cy={photoCy} r={photoR} />
                    </ClipPath>
                  </Defs>
                  <SvgImage
                    x={photoCx - photoR}
                    y={photoCy - photoR}
                    width={photoSize}
                    height={photoSize}
                    href={{ uri: photoUrl }}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#${clipId})`}
                  />
                  <Circle
                    cx={photoCx}
                    cy={photoCy}
                    r={photoR}
                    fill="none"
                    stroke="#F47C3C"
                    strokeWidth={1.5}
                  />
                  {/* Invisible 44pt-ish hit area for an easy tap target. */}
                  <Circle cx={photoCx} cy={photoCy} r={Math.max(photoR, 20)} fill="transparent" />
                </G>
              )}
              {isMonthAxis && isFirstOfMonth && (
                  <SvgText
                    x={x}
                    y={paddingTop + chartHeight + 14}
                    fontSize={10}
                    fill="#9AA3A6"
                    textAnchor="start"
                    fontWeight="600"
                  >
                    {formatBodyProgressAxisMonth(slot.weekMonday, i18n.language, dateRange)}
                  </SvgText>
              )}
              {!isMonthAxis && (
                <SvgText
                  x={x + barWidth / 2}
                  y={paddingTop + chartHeight + 12}
                  fontSize={10}
                  fill={hasData ? '#666' : '#444'}
                  textAnchor="middle"
                  fontWeight="600"
                >
                  {t('progress:weekAxisLabel', { week: slot.week })}
                </SvgText>
              )}
              {/* X-axis label - Date (only if data exists, week-mode only) */}
              {!isMonthAxis && hasData && (
                <SvgText
                  x={x + barWidth / 2}
                  y={paddingTop + chartHeight + 24}
                  fontSize={9}
                  fill="#666"
                  textAnchor="middle"
                >
                  {slot.data!.dateLabel}
                </SvgText>
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 4,
  },
  legend: {
    fontSize: 11,
    color: '#6F7A7E',
    marginBottom: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 32,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9AA3A6',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#6F7A7E',
    textAlign: 'center',
  },
});

