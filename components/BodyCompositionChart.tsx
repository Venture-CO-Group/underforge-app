import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { BodyCompositionChartData, DateRange } from '../lib/body-composition-storage';
import { BodyProgressWeekSlot, buildBodyProgressWeekSlots, formatBodyProgressAxisMonth } from '../lib/body-progress-week-axis';

interface BodyCompositionChartProps {
  data: BodyCompositionChartData[];
  dateRange: DateRange;
  width?: number;
  height?: number;
}

export default function BodyCompositionChart({
  data,
  dateRange,
  width = 340,
  height = 240,
}: BodyCompositionChartProps) {
  const { t, i18n } = useTranslation(['progress']);
  /** Hide only in-chart numeric callouts (under markers), not axes or legend. */
  const hideInlineNumericLabels = dateRange === '6months';
  const [hoveredMarker, setHoveredMarker] = useState<{ index: number; type: 'muscle' | 'fat' } | null>(null);

  /** Extra room so Y-axis “%” is not clipped at textAnchor end. */
  const paddingLeft = 52;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 70;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Colors for the stacked areas
  const colors = {
    muscle: '#4ECDC4',  // Teal/green
    fat: '#F47C3C',     // Burnt orange
    other: '#E5E5E5',   // Light gray
  };

  if (data.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{t('progress:chartBodyCompEmpty')}</Text>
        <Text style={styles.emptySubtext}>{t('progress:chartBodyCompEmptySub')}</Text>
      </View>
    );
  }

  const slots = buildBodyProgressWeekSlots(data);
  const isMonthAxis = dateRange === '3months' || dateRange === '6months';
  // Y-axis is always 0-100%
  const yMax = 100;

  // Calculate x position for slot index (matches weekSlots layout: evenly spaced).
  const getX = (index: number) => {
    if (slots.length === 1) return paddingLeft + chartWidth / 2;
    return paddingLeft + (index / (slots.length - 1)) * chartWidth;
  };

  const getY = (percent: number) => paddingTop + chartHeight - (percent / yMax) * chartHeight;

  /** Linearly interpolate muscle/fat across empty weeks; markers stay on real logs only. */
  const interpolatedMuscle: number[] = [];
  const interpolatedFat: number[] = [];
  const n = slots.length;
  for (let i = 0; i < n; i++) {
    if (slots[i].data) {
      interpolatedMuscle[i] = slots[i].data!.musclePercent;
      interpolatedFat[i] = slots[i].data!.fatPercent;
    } else {
      let p = i - 1;
      while (p >= 0 && !slots[p].data) p -= 1;
      let q = i + 1;
      while (q < n && !slots[q].data) q += 1;
      const left = p >= 0 ? slots[p].data : null;
      const right = q < n ? slots[q].data : null;
      if (left && right && q > p) {
        const t = (i - p) / (q - p);
        interpolatedMuscle[i] = left.musclePercent + t * (right.musclePercent - left.musclePercent);
        interpolatedFat[i] = left.fatPercent + t * (right.fatPercent - left.fatPercent);
      } else if (left) {
        interpolatedMuscle[i] = left.musclePercent;
        interpolatedFat[i] = left.fatPercent;
      } else if (right) {
        interpolatedMuscle[i] = right.musclePercent;
        interpolatedFat[i] = right.fatPercent;
      } else {
        interpolatedMuscle[i] = 0;
        interpolatedFat[i] = 0;
      }
    }
  }

  // Full-timeline stacked areas using interpolated boundaries (continuous fill across gaps).
  const buildAreaPath = (getTop: (i: number) => number, getBottom: (i: number) => number): string => {
    if (slots.length < 2) return '';
    let path = `M ${getX(0)} ${getY(getTop(0))}`;
    for (let i = 1; i < slots.length; i++) {
      path += ` L ${getX(i)} ${getY(getTop(i))}`;
    }
    for (let i = slots.length - 1; i >= 0; i--) {
      path += ` L ${getX(i)} ${getY(getBottom(i))}`;
    }
    path += ' Z';
    return path;
  };

  const musclePath = buildAreaPath(i => interpolatedMuscle[i], () => 0);
  const fatPath = buildAreaPath(
    i => interpolatedMuscle[i] + interpolatedFat[i],
    i => interpolatedMuscle[i],
  );
  const otherPath = buildAreaPath(
    () => 100,
    i => interpolatedMuscle[i] + interpolatedFat[i],
  );

  // Y-axis ticks
  const yTicks = [0, 25, 50, 75, 100];

  const lastSlotWithData = [...slots].reverse().find(s => s.data !== null)?.data ?? null;

  const loggedSlotIndices = slots
    .map((slot, index) => (slot.data ? index : -1))
    .filter(index => index >= 0);
  const firstLoggedIndex = loggedSlotIndices[0] ?? 0;
  const lastLoggedIndex = loggedSlotIndices[loggedSlotIndices.length - 1] ?? 0;

  /** Horizontal placement for in-chart value labels (avoids Y-axis / right-edge clash on 3-month). */
  const getInlineLabelPlacement = (
    slotIndex: number,
  ): { x: number; anchor: 'start' | 'middle' | 'end' } => {
    const x = getX(slotIndex);
    const plotLeft = paddingLeft;
    const plotRight = width - paddingRight;

    if (dateRange === '3months') {
      const edgePad = 4;
      if (slotIndex === firstLoggedIndex) {
        return { x: Math.max(x, plotLeft + edgePad), anchor: 'start' };
      }
      if (slotIndex === lastLoggedIndex) {
        return { x: Math.min(x, plotRight - edgePad), anchor: 'end' };
      }
      return { x, anchor: 'middle' };
    }

    const minX = plotLeft + 6;
    const maxX = plotRight - 6;
    const clampedX = Math.min(Math.max(x, minX), maxX);
    const anchor: 'start' | 'middle' | 'end' =
      clampedX === x ? 'middle' : clampedX <= minX ? 'start' : 'end';
    return { x: clampedX, anchor };
  };

  /** Inline + bottom legend: one decimal for 30-day; integers for 3- & 6-month. */
  const formatCompositionInline = (v: number) =>
    dateRange === '30days' ? v.toFixed(1) : String(Math.round(v));

  /** Tooltips always show one decimal (full precision for 3-month inline integers). */
  const formatCompositionTooltip = (v: number) => v.toFixed(1);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('progress:chartBodyCompTitle')}</Text>
      <Text style={styles.legend}>
        {t(isMonthAxis ? 'progress:chartBodyCompLegendMonths' : 'progress:chartBodyCompLegend')}
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
              y1={getY(tick)}
              x2={paddingLeft}
              y2={getY(tick)}
              stroke="#E5E5E5"
              strokeWidth={1}
            />
            <SvgText
              x={paddingLeft - 6}
              y={getY(tick) + 4}
              fontSize={11}
              fill="#B8C4C8"
              textAnchor="end"
              letterSpacing={0.3}
            >
              {`${tick} %`}
            </SvgText>
            {/* Grid line */}
            <Line
              x1={paddingLeft}
              y1={getY(tick)}
              x2={width - paddingRight}
              y2={getY(tick)}
              stroke="#F5F5F5"
              strokeWidth={1}
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

        {/* Stacked areas: interpolated through empty weeks; markers only on logged weeks */}
        {slots.length >= 2 && (
          <>
            <Path d={otherPath} fill={colors.other} opacity={0.7} />
            <Path d={fatPath} fill={colors.fat} opacity={0.85} />
            <Path d={musclePath} fill={colors.muscle} opacity={0.9} />
          </>
        )}

        {/* Data point markers (circles at each boundary) */}
        {slots.map((slot, i) => {
          if (!slot.data) return null;
          const d = slot.data;
          const x = getX(i);
          const isMuscleHovered = hoveredMarker?.index === i && hoveredMarker?.type === 'muscle';
          const isFatHovered = hoveredMarker?.index === i && hoveredMarker?.type === 'fat';

          return (
            <G key={`markers-${i}`}>
              {/* Marker at muscle top (muscle/fat boundary) */}
              <Circle
                cx={x}
                cy={getY(d.musclePercent)}
                r={isMuscleHovered ? 5 : 3}
                fill={colors.muscle}
                stroke="#fff"
                strokeWidth={1.5}
                onPressIn={() => setHoveredMarker({ index: i, type: 'muscle' })}
                onPressOut={() => setHoveredMarker(null)}
              />
              {/* Marker at fat top (fat/other boundary) */}
              <Circle
                cx={x}
                cy={getY(d.musclePercent + d.fatPercent)}
                r={isFatHovered ? 5 : 3}
                fill={colors.fat}
                stroke="#fff"
                strokeWidth={1.5}
                onPressIn={() => setHoveredMarker({ index: i, type: 'fat' })}
                onPressOut={() => setHoveredMarker(null)}
              />

              {/* Tooltips: decimals always (3-month inline uses integers). */}
              {isMuscleHovered && (
                <G>
                  <Rect
                    x={x - 25}
                    y={getY(d.musclePercent) - 30}
                    width={50}
                    height={18}
                    fill="#333"
                    rx={4}
                    ry={4}
                  />
                  <SvgText
                    x={x}
                    y={getY(d.musclePercent) - 18}
                    fontSize={11}
                    fill="#FFF"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    {formatCompositionTooltip(d.musclePercent)}
                  </SvgText>
                </G>
              )}
              {isFatHovered && (
                <G>
                  <Rect
                    x={x - 25}
                    y={getY(d.musclePercent + d.fatPercent) - 30}
                    width={50}
                    height={18}
                    fill="#333"
                    rx={4}
                    ry={4}
                  />
                  <SvgText
                    x={x}
                    y={getY(d.musclePercent + d.fatPercent) - 18}
                    fontSize={11}
                    fill="#FFF"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    {formatCompositionTooltip(d.musclePercent + d.fatPercent)}
                  </SvgText>
                </G>
              )}
            </G>
          );
        })}

        {/* In-chart numeric labels under markers (hidden in 6-month view). */}
        {!hideInlineNumericLabels && slots.map((slot, i) => {
          if (!slot.data) return null;
          const d = slot.data;
          const { x: labelX, anchor: labelAnchor } = getInlineLabelPlacement(i);
          const muscleY = getY(d.musclePercent) + 14;
          const fatY = getY(d.musclePercent + d.fatPercent) + 24;

          return (
            <G key={`pct-labels-${i}`}>
              <SvgText
                x={labelX}
                y={muscleY}
                fontSize={10}
                fill="#111"
                textAnchor={labelAnchor}
                fontWeight="600"
              >
                {formatCompositionInline(d.musclePercent)}
              </SvgText>
              <SvgText
                x={labelX}
                y={fatY}
                fontSize={10}
                fill="#111"
                textAnchor={labelAnchor}
                fontWeight="600"
              >
                {formatCompositionInline(d.fatPercent)}
              </SvgText>
            </G>
          );
        })}

        {/* X-axis: abbreviated months (6-month), full months (3-month), or week + date (30-day). */}
        {slots.map((slot, i) => {
          const x = getX(i);
          if (isMonthAxis) {
            const prev: BodyProgressWeekSlot | null = i > 0 ? slots[i - 1] : null;
            const isFirstOfMonth = prev === null
              || prev.weekMonday.getMonth() !== slot.weekMonday.getMonth()
              || prev.weekMonday.getFullYear() !== slot.weekMonday.getFullYear();
            if (!isFirstOfMonth) return null;
            return (
              <SvgText
                key={`month-${i}`}
                x={x}
                y={paddingTop + chartHeight + 14}
                fontSize={10}
                fill="#9AA3A6"
                textAnchor="start"
                fontWeight="600"
              >
                {formatBodyProgressAxisMonth(slot.weekMonday, i18n.language, dateRange)}
              </SvgText>
            );
          }
          return (
            <G key={`xlabel-${i}`}>
              <SvgText
                x={x}
                y={paddingTop + chartHeight + 12}
                fontSize={10}
                fill={slot.data ? '#666' : '#444'}
                textAnchor="middle"
                fontWeight="600"
              >
                {t('progress:weekAxisLabel', { week: slot.week })}
              </SvgText>
              {slot.data && (
                <SvgText
                  x={x}
                  y={paddingTop + chartHeight + 24}
                  fontSize={9}
                  fill="#666"
                  textAnchor="middle"
                >
                  {slot.data.dateLabel}
                </SvgText>
              )}
            </G>
          );
        })}
      </Svg>

      {/* Legend (latest logged slice) */}
      <View style={styles.legendSection}>
        <Text style={styles.legendValuesTitle}>{t('progress:chartLegendLastValues')}</Text>
        <View style={styles.legendContainer}>
          <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.muscle }]} />
          <Text style={styles.legendText}>{t('progress:chartLegendMuscle')}</Text>
          {lastSlotWithData && (
            <Text style={styles.legendValue}>{formatCompositionInline(lastSlotWithData.musclePercent)}</Text>
          )}
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.fat }]} />
          <Text style={styles.legendText}>{t('progress:chartLegendFat')}</Text>
          {lastSlotWithData && (
            <Text style={styles.legendValue}>{formatCompositionInline(lastSlotWithData.fatPercent)}</Text>
          )}
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.other }]} />
          <Text style={styles.legendText}>{t('progress:chartLegendOther')}</Text>
          {lastSlotWithData && (
            <Text style={styles.legendValue}>{formatCompositionInline(lastSlotWithData.otherPercent)}</Text>
          )}
        </View>
        </View>
      </View>
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
  legendSection: {
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 4,
  },
  legendValuesTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6F7A7E',
    marginBottom: 6,
    textAlign: 'center',
  },
  legendContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: '#9AA3A6',
  },
  legendValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F2F2EE',
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
