import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

export interface WeeklyReportBarChartProps {
  title: string;
  labels: string[];
  values: number[];
  maxValue?: number;
  unitSuffix?: string;
  width?: number;
  height?: number;
  accentColor?: string;
}

export default function WeeklyReportBarChart({
  title,
  labels,
  values,
  maxValue: maxValueProp,
  unitSuffix = '',
  width = 320,
  height = 140,
  accentColor = '#F47C3C',
}: WeeklyReportBarChartProps) {
  const paddingLeft = 8;
  const paddingRight = 8;
  const paddingTop = 28;
  const paddingBottom = 22;
  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;
  const maxVal = maxValueProp ?? Math.max(1, ...values, 1);
  const n = values.length;
  const gap = 6;
  const barW = n > 0 ? (chartW - gap * (n - 1)) / n : 0;

  return (
    <View style={styles.wrap}>
      {/* Render title with parenthetical portions non-bold */}
      <Text style={styles.title}>
        {(() => {
          const openIdx = title.indexOf('(');
          if (openIdx === -1) return title;
          const before = title.substring(0, openIdx);
          const paren = title.substring(openIdx);
          return (
            <>
              {before}
              <Text style={styles.titleParen}>{paren}</Text>
            </>
          );
        })()}
      </Text>
      <Svg width={width} height={height}>
        {values.map((v, i) => {
          const h = maxVal > 0 ? (v / maxVal) * chartH : 0;
          const x = paddingLeft + i * (barW + gap);
          const y = paddingTop + chartH - h;
          const isReportingWeek = n > 0 && i === n - 1;
          return (
            <React.Fragment key={i}>
              <Rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 2)}
                rx={4}
                fill={isReportingWeek ? accentColor : `${accentColor}99`}
              />
              <SvgText
                x={x + barW / 2}
                y={paddingTop + chartH + 14}
                fill="#9AA3A6"
                fontSize={10}
                textAnchor="middle"
              >
                {labels[i] ?? ''}
              </SvgText>
              <SvgText
                x={x + barW / 2}
                y={y - 4}
                fill="#F2F2EE"
                fontSize={10}
                textAnchor="middle"
              >
                {`${Math.round(v)}${unitSuffix}`}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 4,
  },
  titleParen: {
    fontWeight: '400',
    color: '#F2F2EE',
  },
});
