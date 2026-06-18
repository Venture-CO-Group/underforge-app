import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  Path,
  Stop,
  LinearGradient as SvgLinearGradient,
  Text as SvgText,
} from 'react-native-svg';
import { FontFamily } from '../constants/Typography';

interface TrajectoryConfig {
  data: number[];
  label: string;
  shortDescription: string;
  color: string;
}

interface GoalChartConfig {
  chartTitle: string;
  yAxisLabel: string;
  maxY: number;
  trajectories: TrajectoryConfig[];
}

interface Props {
  questionKey: string;
  options: string[];
  displayOptions?: string[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

const GOAL_CHART_CONFIGS: Record<string, GoalChartConfig> = {
  quantitative_goal_burn_fat: {
    chartTitle: '4-Week Fat Loss Projection',
    yAxisLabel: 'kg',
    maxY: 4.5,
    trajectories: [
      {
        data: [0, 0.35, 0.8, 1.2, 1.5],
        label: 'Conservative cut',
        shortDescription: '~1-1.5 kg (leaner individuals or muscle retention focus)',
        color: '#4ECDC4',
      },
      {
        data: [0, 0.6, 1.4, 2.2, 3.0],
        label: 'Moderate cut',
        shortDescription: '~2-3 kg (sustainable fat-loss pace)',
        color: '#F47C3C',
      },
      {
        data: [0, 0.8, 1.8, 2.8, 4.0],
        label: 'Aggressive cut',
        shortDescription: '~3-4+ kg (higher body fat individuals)',
        color: '#E85D75',
      },
    ],
  },
  quantitative_goal_build_muscle: {
    chartTitle: '4-Week Lean Mass Projection',
    yAxisLabel: 'kg',
    maxY: 1.0,
    trajectories: [
      {
        data: [0, 0.25, 0.55, 0.8, 1.0],
        label: 'Beginner gains',
        shortDescription: '400-1000 g (~0.9-2.2 lb) lean mass',
        color: '#4ECDC4',
      },
      {
        data: [0, 0.12, 0.25, 0.38, 0.5],
        label: 'Intermediate gains',
        shortDescription: '200-500 g (~0.4-1.1 lb) lean mass',
        color: '#F47C3C',
      },
      {
        data: [0, 0.06, 0.14, 0.2, 0.25],
        label: 'Advanced gains',
        shortDescription: '100-250 g (~0.2-0.6 lb) lean mass',
        color: '#E85D75',
      },
    ],
  },
  quantitative_goal_increase_strength: {
    chartTitle: '4-Week Strength Projection',
    yAxisLabel: '%',
    maxY: 12,
    trajectories: [
      {
        data: [0, 4, 6.5, 8.5, 10],
        label: 'Beginner progression',
        shortDescription: '+5–10% on main lifts',
        color: '#4ECDC4',
      },
      {
        data: [0, 2, 3.5, 4.5, 5],
        label: 'Intermediate progression',
        shortDescription: '+3–5% on main lifts',
        color: '#F47C3C',
      },
      {
        data: [0, 1, 1.8, 2.5, 3],
        label: 'Advanced progression',
        shortDescription: '+1–3% on main lifts',
        color: '#E85D75',
      },
    ],
  },
  quantitative_goal_get_challenged: {
    chartTitle: '4-Week Challenge Progression',
    yAxisLabel: 'level',
    maxY: 10,
    trajectories: [
      {
        data: [0, 1.5, 3, 4.5, 6],
        label: 'Foundation',
        shortDescription: 'Consistent attendance',
        color: '#4ECDC4',
      },
      {
        data: [0, 2, 4, 6, 8],
        label: 'Performance',
        shortDescription: '3+ personal records',
        color: '#F47C3C',
      },
      {
        data: [0, 2.5, 5, 7.5, 10],
        label: 'Peak',
        shortDescription: 'Advanced periodized block',
        color: '#E85D75',
      },
    ],
  },
};

const GOAL_CHART_CONFIGS_ES: Record<string, { chartTitle: string; trajectories: { label: string; shortDescription: string }[] }> = {
  quantitative_goal_burn_fat: {
    chartTitle: 'Proyección de pérdida de grasa - 4 semanas',
    trajectories: [
      { label: 'Corte conservador', shortDescription: '~1-1.5 kg (más delgado / retención)' },
      { label: 'Corte moderado', shortDescription: '~2-3 kg (ritmo sostenible)' },
      { label: 'Corte agresivo', shortDescription: '~3-4+ kg (más grasa, coste en rendimiento)' },
    ],
  },
  quantitative_goal_build_muscle: {
    chartTitle: 'Proyección de masa magra - 4 semanas',
    trajectories: [
      { label: 'Ganancias de principiante', shortDescription: '400-1000 g (~0.9-2.2 lb) masa magra' },
      { label: 'Ganancias intermedias', shortDescription: '200-500 g (~0.4-1.1 lb) masa magra' },
      { label: 'Ganancias avanzadas', shortDescription: '100-250 g (~0.2-0.6 lb) masa magra' },
    ],
  },
  quantitative_goal_increase_strength: {
    chartTitle: 'Proyección de fuerza - 4 semanas',
    trajectories: [
      { label: 'Progresión de principiante', shortDescription: '+5–10% en levantamientos' },
      { label: 'Progresión intermedia', shortDescription: '+3–5% en levantamientos' },
      { label: 'Progresión avanzada', shortDescription: '+1–3% en levantamientos' },
    ],
  },
  quantitative_goal_get_challenged: {
    chartTitle: 'Progresión del reto - 4 semanas',
    trajectories: [
      { label: 'Fundamentos', shortDescription: 'Asistencia constante' },
      { label: 'Rendimiento', shortDescription: '3+ récords personales' },
      { label: 'Pico', shortDescription: 'Bloque periodizado avanzado' },
    ],
  },
};

const PAD = { top: 24, right: 16, bottom: 36, left: 42 };
const CONTENT_H = 150;
const WEEK_LABELS = ['Now', 'W1', 'W2', 'W3', 'W4'];

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
    const cpx2 = prev.x + (curr.x - prev.x) * 0.6;
    d += ` C ${cpx1},${prev.y} ${cpx2},${curr.y} ${curr.x},${curr.y}`;
  }
  return d;
}

function filledAreaPath(
  points: { x: number; y: number }[],
  bottomY: number
): string {
  if (points.length < 2) return '';
  const line = smoothPath(points);
  return `${line} L ${points[points.length - 1].x},${bottomY} L ${points[0].x},${bottomY} Z`;
}

function formatEndValue(val: number, unit: string): string {
  if (unit === 'level') return '';
  const numStr = Number.isInteger(val) ? String(val) : val.toFixed(1);
  return unit === '%' ? `${numStr}%` : `${numStr} ${unit}`;
}

export const QuantitativeGoalChart: React.FC<Props> = ({
  questionKey,
  options,
  displayOptions,
  selectedIndex,
  onSelect,
}) => {
  const { i18n } = useTranslation();
  const isSpanish = i18n.language?.startsWith('es');
  const config = GOAL_CHART_CONFIGS[questionKey];
  if (!config) return null;

  const esConfig = GOAL_CHART_CONFIGS_ES[questionKey];
  const chartTitle = (isSpanish && esConfig?.chartTitle) ? esConfig.chartTitle : config.chartTitle;

  const [chartWidth, setChartWidth] = React.useState(280);
  const cw = chartWidth - PAD.left - PAD.right;
  const ch = CONTENT_H;
  const svgH = PAD.top + ch + PAD.bottom;
  const bottomY = PAD.top + ch;

  const toPoints = (data: number[]) =>
    data.map((v, i) => ({
      x: PAD.left + (i / (data.length - 1)) * cw,
      y: PAD.top + ch - (v / config.maxY) * ch,
    }));

  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => ({
    value: Math.round((config.maxY / yTickCount) * i * 10) / 10,
    y: PAD.top + ch - (i / yTickCount) * ch,
  }));

  return (
    <View style={styles.wrapper}>
      <Text style={styles.chartSubtitle}>{chartTitle}</Text>

      <View
        style={styles.chartCard}
        onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
      >
        <Svg width={chartWidth} height={svgH}>
          <Defs>
            {config.trajectories.map((t, i) => (
              <SvgLinearGradient
                key={`g${i}`}
                id={`area-${questionKey}-${i}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <Stop offset="0" stopColor={t.color} stopOpacity={0.35} />
                <Stop offset="0.7" stopColor={t.color} stopOpacity={0.08} />
                <Stop offset="1" stopColor={t.color} stopOpacity={0} />
              </SvgLinearGradient>
            ))}
          </Defs>

          {/* Horizontal grid */}
          {yTicks.map((tick, i) => (
            <Line
              key={`hg-${i}`}
              x1={PAD.left}
              y1={tick.y}
              x2={PAD.left + cw}
              y2={tick.y}
              stroke="#1C2E2E"
              strokeWidth={0.8}
              strokeDasharray={i > 0 ? '3,5' : undefined}
            />
          ))}

          {/* Vertical grid */}
          {WEEK_LABELS.map((_, i) => {
            const x = PAD.left + (i / (WEEK_LABELS.length - 1)) * cw;
            return (
              <Line
                key={`vg-${i}`}
                x1={x}
                y1={PAD.top}
                x2={x}
                y2={bottomY}
                stroke="#1C2E2E"
                strokeWidth={0.8}
                strokeDasharray="3,5"
              />
            );
          })}

          {/* Y-axis labels */}
          {yTicks.map((tick, i) => (
            <SvgText
              key={`yl-${i}`}
              x={PAD.left - 8}
              y={tick.y + 4}
              textAnchor="end"
              fontSize={10}
              fill="#4A6060"
            >
              {tick.value}
            </SvgText>
          ))}

          {/* Y-axis unit */}
          {config.yAxisLabel !== 'level' && (
            <SvgText
              x={PAD.left - 6}
              y={PAD.top - 8}
              textAnchor="end"
              fontSize={9}
              fill="#3A5555"
            >
              {config.yAxisLabel}
            </SvgText>
          )}

          {/* X-axis labels */}
          {WEEK_LABELS.map((label, i) => (
            <SvgText
              key={`xl-${i}`}
              x={PAD.left + (i / (WEEK_LABELS.length - 1)) * cw}
              y={bottomY + 18}
              textAnchor="middle"
              fontSize={10}
              fill="#4A6060"
            >
              {label}
            </SvgText>
          ))}

          {/* Unselected trajectories */}
          {config.trajectories.map((t, i) => {
            if (i === selectedIndex) return null;
            const pts = toPoints(t.data);
            return (
              <G key={`un-${i}`} opacity={selectedIndex === null ? 0.35 : 0.15}>
                <Path
                  d={smoothPath(pts)}
                  stroke={t.color}
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="4,6"
                />
                <Circle
                  cx={pts[pts.length - 1].x}
                  cy={pts[pts.length - 1].y}
                  r={3}
                  fill={t.color}
                />
              </G>
            );
          })}

          {/* Selected trajectory */}
          {selectedIndex !== null &&
            (() => {
              const t = config.trajectories[selectedIndex];
              const pts = toPoints(t.data);
              const last = pts[pts.length - 1];
              const lastVal = t.data[t.data.length - 1];
              const endLabel = formatEndValue(lastVal, config.yAxisLabel);

              return (
                <G>
                  <Path
                    d={filledAreaPath(pts, bottomY)}
                    fill={`url(#area-${questionKey}-${selectedIndex})`}
                  />
                  <Path
                    d={smoothPath(pts)}
                    stroke={t.color}
                    strokeWidth={2.5}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {pts.map((p, pi) => (
                    <G key={`dp-${pi}`}>
                      <Circle
                        cx={p.x}
                        cy={p.y}
                        r={pi === pts.length - 1 ? 9 : 5}
                        fill={t.color}
                        fillOpacity={0.12}
                      />
                      <Circle
                        cx={p.x}
                        cy={p.y}
                        r={pi === pts.length - 1 ? 4.5 : 3}
                        fill={t.color}
                      />
                      <Circle
                        cx={p.x}
                        cy={p.y}
                        r={1.5}
                        fill="#FFFFFF"
                        fillOpacity={0.7}
                      />
                    </G>
                  ))}
                  {endLabel !== '' && (
                    <SvgText
                      x={last.x}
                      y={last.y - 16}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight="600"
                      fill={t.color}
                    >
                      {endLabel}
                    </SvgText>
                  )}
                </G>
              );
            })()}
        </Svg>
      </View>

      {/* Selection cards */}
      <View style={styles.optionsContainer}>
        {config.trajectories.map((t, i) => {
          const isSelected = i === selectedIndex;
          return (
            <TouchableOpacity
              key={i}
              activeOpacity={0.7}
              onPress={() => onSelect(i)}
              style={[
                styles.optionCard,
                isSelected && {
                  borderColor: t.color,
                  backgroundColor: `${t.color}14`,
                },
              ]}
            >
              <View
                style={[
                  styles.colorDot,
                  {
                    backgroundColor: t.color,
                    opacity: isSelected ? 1 : 0.3,
                    transform: [{ scale: isSelected ? 1.3 : 1 }],
                  },
                ]}
              />
              <View style={styles.optionTextWrap}>
                <Text
                  style={[
                    styles.optionLabel,
                    isSelected && { color: '#F2F2EE' },
                  ]}
                >
                  {(isSpanish && esConfig?.trajectories[i]?.label) ? esConfig.trajectories[i].label : t.label}
                </Text>
                <Text
                  style={[
                    styles.optionDesc,
                    isSelected && { color: t.color },
                  ]}
                >
                  {(isSpanish && esConfig?.trajectories[i]?.shortDescription) ? esConfig.trajectories[i].shortDescription : t.shortDescription}
                </Text>
              </View>
              <View
                style={[
                  styles.radio,
                  isSelected && { borderColor: t.color },
                ]}
              >
                {isSelected && (
                  <View
                    style={[styles.radioFill, { backgroundColor: t.color }]}
                  />
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      {/* Extra spacer so the parent ScrollView can scroll a bit past the last option */}
      <View style={styles.bottomSpacer} />
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    gap: 14,
  },
  chartSubtitle: {
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#5A7070',
    fontFamily: FontFamily.bodySemiBold,
    textAlign: 'center',
  },
  chartCard: {
    backgroundColor: '#091212',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#162828',
    overflow: 'hidden',
  },
  optionsContainer: {
    gap: 10,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#1A2828',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    gap: 12,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  optionTextWrap: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 15,
    fontFamily: FontFamily.bodySemiBold,
    color: '#5A7070',
  },
  optionDesc: {
    fontSize: 12,
    fontFamily: FontFamily.bodyRegular,
    color: '#3A5050',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#2A3838',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioFill: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  bottomSpacer: {
    height: 64,
  },
});
