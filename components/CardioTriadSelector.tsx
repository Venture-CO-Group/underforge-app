import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize, LetterSpacing, LineHeight } from '../constants/Typography';

/**
 * Three-axis cardio habits selector.
 *
 * Each axis is its own semi-circle "angle slider" (top half of a circle).
 * As the user drags or taps along the arc, the filled portion grows from
 * the left endpoint to the thumb and the option label is rendered inside
 * the arc. Values are still stored as English option ids so downstream
 * LLM prompts and calorie estimation stay locale-agnostic.
 */
export type CardioLengthBucket = '<20' | '20-40' | '40-60' | '>60';
export type CardioIntensity = 'Easy' | 'Moderate' | 'Hard' | 'All-out';

export interface CardioTriadValue {
  days: number | null;
  length: CardioLengthBucket | null;
  intensity: CardioIntensity | null;
}

export const EMPTY_TRIAD: CardioTriadValue = {
  days: null,
  length: null,
  intensity: null,
};

export const DAY_OPTIONS: number[] = [0, 1, 2, 3, 4, 5, 6, 7];
export const LENGTH_OPTIONS: CardioLengthBucket[] = ['<20', '20-40', '40-60', '>60'];
export const INTENSITY_OPTIONS: CardioIntensity[] = ['Easy', 'Moderate', 'Hard', 'All-out'];

interface Props {
  value: CardioTriadValue;
  onChange: (next: CardioTriadValue) => void;
  /**
   * Called when the user starts/ends dragging any of the three sliders.
   * Parents should use this to temporarily disable the surrounding
   * ScrollView so scroll and slide gestures don't fight.
   */
  onInteractionChange?: (active: boolean) => void;
}

/**
 * Parse the JSON answer string written by this widget. Tolerant of partial
 * or malformed input — returns whatever fields it can recover.
 */
export function parseCardioTriadAnswer(answer: unknown): CardioTriadValue {
  if (!answer || typeof answer !== 'string') return { ...EMPTY_TRIAD };
  try {
    const parsed = JSON.parse(answer);
    return {
      days: typeof parsed.days === 'number' && parsed.days >= 0 && parsed.days <= 7 ? parsed.days : null,
      length: LENGTH_OPTIONS.includes(parsed.length) ? parsed.length : null,
      intensity: INTENSITY_OPTIONS.includes(parsed.intensity) ? parsed.intensity : null,
    };
  } catch {
    return { ...EMPTY_TRIAD };
  }
}

export function stringifyCardioTriad(value: CardioTriadValue): string {
  return JSON.stringify({
    days: value.days,
    length: value.length,
    intensity: value.intensity,
  });
}

export function isCardioTriadComplete(value: CardioTriadValue): boolean {
  return value.days !== null && value.length !== null && value.intensity !== null;
}

/**
 * Build the human-readable summary that flows into the LLM prompt
 * (clarifying answers map). Stable English so the model isn't asked
 * to parse JSON.
 */
export function cardioTriadToReadable(value: CardioTriadValue): string {
  if (!isCardioTriadComplete(value)) return '';
  const lengthCopy: Record<CardioLengthBucket, string> = {
    '<20': 'under 20 minutes',
    '20-40': '20–40 minutes',
    '40-60': '40–60 minutes',
    '>60': 'over 60 minutes',
  };
  const days = value.days === 0 ? 'no days' : value.days === 1 ? '1 day' : `${value.days} days`;
  return `${days} per week, typical session ${lengthCopy[value.length!]}, intensity ${value.intensity}.`;
}

// ---------------------------------------------------------------------------
// Semi-circle angle slider (Dice UI-style, native impl)
// ---------------------------------------------------------------------------

interface SemiCircleSliderProps<T> {
  options: readonly T[];
  selectedIndex: number | null;
  onSelectIndex: (index: number) => void;
  /** Big label rendered inside the arc when `selectedIndex` is set. */
  formatValue: (option: T, index: number) => string;
  /** Small uppercase caption rendered under the value. */
  caption: string;
  /** Shown inside the arc when nothing is picked yet. */
  placeholder: string;
  accessibilityLabel: string;
  /** Notify parent so it can disable a surrounding ScrollView while dragging. */
  onInteractionChange?: (active: boolean) => void;
}

function SemiCircleSlider<T>({
  options,
  selectedIndex,
  onSelectIndex,
  formatValue,
  caption,
  placeholder,
  accessibilityLabel,
  onInteractionChange,
}: SemiCircleSliderProps<T>) {
  const [width, setWidth] = useState(0);
  const containerRef = useRef<View>(null);
  // Cached origin of the slider in window coordinates. Refreshed on grant
  // so we can convert PanResponder's `pageX/Y` into local coordinates that
  // survive scrolling parents.
  const originRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const stops = options.length;
  // Geometry: an *ellipse* with a shorter vertical radius keeps the wide
  // dial feel while halving the vertical real estate the question takes up.
  const horizontalPad = 18;
  const verticalBottomPad = 10;
  const topInset = 14;
  const rx = width > 0 ? Math.max(0, width / 2 - horizontalPad) : 0;
  const ry = rx * 0.55;
  const cx = width / 2;
  const cy = ry + topInset; // baseline of the semi-ellipse
  const svgHeight = cy + verticalBottomPad;

  // Distribute the discrete stops along the arc by *arc length*, not by
  // the underlying ellipse parameter. With an elliptical (flattened)
  // dome, evenly-spaced parameter values cluster near the top and stretch
  // out near the endpoints; the visual fix is to integrate the arc length
  // numerically and find each tick's parameter angle by inversion.
  const tickPoints = useMemo(() => {
    if (rx <= 0 || ry <= 0 || stops <= 0) {
      return [] as { x: number; y: number; theta: number }[];
    }
    // Ellipse parametrized by u ∈ [0, π], where u=π is the left endpoint
    // and u=0 is the right endpoint (going over the top). Point at u:
    //   (cx + rx·cos u, cy − ry·sin u)
    const M = 200;
    const du = Math.PI / M;
    const cum: number[] = [0];
    for (let k = 1; k <= M; k++) {
      const u = (k - 0.5) * du;
      const ds = Math.sqrt(rx * rx * Math.sin(u) ** 2 + ry * ry * Math.cos(u) ** 2);
      cum.push(cum[k - 1] + ds * du);
    }
    const total = cum[M];
    const out: { x: number; y: number; theta: number }[] = [];
    for (let i = 0; i < stops; i++) {
      // Arc length traversed from the *left* endpoint when reaching tick i.
      const traversed = stops > 1 ? (i / (stops - 1)) * total : 0;
      // We integrated cum[k] = ∫₀^{k·du} which goes from the *right*
      // endpoint inward, so the matching cum value for tick i is
      // total − traversed (distance still to traverse to reach the right).
      const target = total - traversed;
      let lo = 0;
      let hi = M;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      const k = lo;
      let u: number;
      if (k === 0) u = 0;
      else {
        const s0 = cum[k - 1];
        const s1 = cum[k];
        const frac = s1 > s0 ? (target - s0) / (s1 - s0) : 0;
        u = (k - 1 + frac) * du;
      }
      out.push({
        x: cx + rx * Math.cos(u),
        y: cy - ry * Math.sin(u),
        theta: u,
      });
    }
    return out;
  }, [rx, ry, cx, cy, stops]);

  const snapFromLocal = useCallback(
    (localX: number, localY: number) => {
      if (rx <= 0 || ry <= 0 || tickPoints.length === 0) return;
      // Snap by nearest tick in screen space. Cheap (≤8 stops) and the
      // visual feedback matches the user's expectation: the tick the finger
      // is closest to wins, regardless of how the arc is parametrized.
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < tickPoints.length; i++) {
        const t = tickPoints[i];
        const d = (t.x - localX) ** 2 + (t.y - localY) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx !== selectedIndex) onSelectIndex(bestIdx);
    },
    [rx, ry, tickPoints, selectedIndex, onSelectIndex],
  );

  const measureOrigin = useCallback(() => {
    containerRef.current?.measureInWindow((x, y) => {
      originRef.current = { x, y };
    });
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (evt: GestureResponderEvent) => {
          measureOrigin();
          onInteractionChange?.(true);
          snapFromLocal(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
        },
        onPanResponderMove: (evt: GestureResponderEvent) => {
          // During drag we use pageX/Y minus the cached origin: locationX/Y
          // is unreliable on Android once the responder is locked.
          const { pageX, pageY } = evt.nativeEvent;
          snapFromLocal(pageX - originRef.current.x, pageY - originRef.current.y);
        },
        onPanResponderRelease: () => onInteractionChange?.(false),
        onPanResponderTerminate: () => onInteractionChange?.(false),
      }),
    [measureOrigin, snapFromLocal, onInteractionChange],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
    measureOrigin();
  };

  // SVG paths. sweep-flag = 1 traces the top half of the ellipse in SVG
  // screen coordinates (y points down, so "clockwise" goes over the top
  // from the left endpoint to the right endpoint).
  const left = tickPoints[0];
  const right = tickPoints[tickPoints.length - 1];
  const trackPath =
    width > 0 && left && right
      ? `M ${left.x} ${left.y} A ${rx} ${ry} 0 0 1 ${right.x} ${right.y}`
      : '';

  const hasValue = selectedIndex !== null;
  const cur = hasValue && tickPoints[selectedIndex!] ? tickPoints[selectedIndex!] : left;
  // The fill is rendered as an elliptical arc from the left endpoint to the
  // current tick. The angle subtended is theta_left − theta_cur (theta_left
  // = π); large-arc-flag = 1 only when that exceeds π, which can't happen
  // on a half-dome but we compute it defensively in case the parametrization
  // ever changes.
  const arcRadians = cur ? Math.PI - cur.theta : 0;
  const largeArc = arcRadians > Math.PI ? 1 : 0;
  const filledPath =
    width > 0 && hasValue && left && cur && cur !== left
      ? `M ${left.x} ${left.y} A ${rx} ${ry} 0 ${largeArc} 1 ${cur.x} ${cur.y}`
      : '';

  const valueLabel = hasValue ? formatValue(options[selectedIndex!], selectedIndex!) : placeholder;

  return (
    <View
      ref={containerRef}
      style={styles.sliderWrapper}
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={hasValue ? { text: valueLabel } : { text: placeholder }}
    >
      {width > 0 ? (
        <View {...panResponder.panHandlers} style={{ width, height: svgHeight }}>
          <Svg width={width} height={svgHeight}>
            <Path
              d={trackPath}
              stroke={BrandColors.inputBorder}
              strokeWidth={6}
              fill="none"
              strokeLinecap="round"
            />
            {filledPath ? (
              <Path
                d={filledPath}
                stroke={BrandColors.accent}
                strokeWidth={6}
                fill="none"
                strokeLinecap="round"
              />
            ) : null}
            {tickPoints.map(({ x, y }, i) => {
              const isActive = hasValue && i <= selectedIndex!;
              return (
                <Circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={3.5}
                  fill={isActive ? BrandColors.accent : BrandColors.cardBorder}
                />
              );
            })}
            {cur ? (
              <Circle
                cx={cur.x}
                cy={cur.y}
                r={12}
                fill={BrandColors.backgroundPrimary}
                stroke={hasValue ? BrandColors.accent : BrandColors.inputBorder}
                strokeWidth={2.5}
                opacity={hasValue ? 1 : 0.7}
              />
            ) : null}
          </Svg>
          <View pointerEvents="none" style={[styles.centerOverlay, { width, height: cy + 4 }]}>
            <Text
              style={[styles.valueText, !hasValue && styles.valuePlaceholder]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {valueLabel}
            </Text>
            <Text style={styles.captionText}>{caption}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main triad component
// ---------------------------------------------------------------------------

export const CardioTriadSelector: React.FC<Props> = ({ value, onChange, onInteractionChange }) => {
  const { t } = useTranslation(['onboarding']);

  const lengthLabels: Record<CardioLengthBucket, string> = {
    '<20': t('onboarding:cardioTriad.lengthLt20'),
    '20-40': t('onboarding:cardioTriad.length2040'),
    '40-60': t('onboarding:cardioTriad.length4060'),
    '>60': t('onboarding:cardioTriad.lengthGt60'),
  };

  const intensityLabels: Record<CardioIntensity, string> = {
    Easy: t('onboarding:cardioTriad.intensityEasy'),
    Moderate: t('onboarding:cardioTriad.intensityModerate'),
    Hard: t('onboarding:cardioTriad.intensityHard'),
    'All-out': t('onboarding:cardioTriad.intensityAllOut'),
  };

  const daysIndex = value.days === null ? null : DAY_OPTIONS.indexOf(value.days);
  const lengthIndex = value.length === null ? null : LENGTH_OPTIONS.indexOf(value.length);
  const intensityIndex = value.intensity === null ? null : INTENSITY_OPTIONS.indexOf(value.intensity);

  const placeholder = t('onboarding:cardioTriad.placeholder', { defaultValue: 'Drag to choose' });
  const formatDays = (d: number) =>
    d === 1
      ? t('onboarding:cardioTriad.dayValueOne', { defaultValue: '1 day' })
      : t('onboarding:cardioTriad.dayValueOther', { count: d, defaultValue: `${d} days` });

  return (
    <View style={styles.container}>
      <Text style={styles.examples}>
        {t('onboarding:cardioTriad.examples', {
          defaultValue: 'e.g. walking, running, cycling, swimming, rowing',
        })}
      </Text>

      <View style={styles.dimension}>
        <Text style={styles.dimensionLabel}>{t('onboarding:cardioTriad.daysLabel')}</Text>
        <Text style={styles.dimensionPrompt}>{t('onboarding:cardioTriad.daysPrompt')}</Text>
        <SemiCircleSlider<number>
          options={DAY_OPTIONS}
          selectedIndex={daysIndex !== null && daysIndex >= 0 ? daysIndex : null}
          onSelectIndex={(i) => onChange({ ...value, days: DAY_OPTIONS[i] })}
          formatValue={(d) => formatDays(d)}
          caption={t('onboarding:cardioTriad.daysAxis')}
          placeholder={placeholder}
          accessibilityLabel={t('onboarding:cardioTriad.daysPrompt')}
          onInteractionChange={onInteractionChange}
        />
      </View>

      <View style={styles.dimension}>
        <Text style={styles.dimensionLabel}>{t('onboarding:cardioTriad.lengthLabel')}</Text>
        <Text style={styles.dimensionPrompt}>{t('onboarding:cardioTriad.lengthPrompt')}</Text>
        <SemiCircleSlider<CardioLengthBucket>
          options={LENGTH_OPTIONS}
          selectedIndex={lengthIndex !== null && lengthIndex >= 0 ? lengthIndex : null}
          onSelectIndex={(i) => onChange({ ...value, length: LENGTH_OPTIONS[i] })}
          formatValue={(l) => lengthLabels[l]}
          caption={t('onboarding:cardioTriad.lengthAxis')}
          placeholder={placeholder}
          accessibilityLabel={t('onboarding:cardioTriad.lengthPrompt')}
          onInteractionChange={onInteractionChange}
        />
      </View>

      <View style={styles.dimension}>
        <Text style={styles.dimensionLabel}>{t('onboarding:cardioTriad.intensityLabel')}</Text>
        <Text style={styles.dimensionPrompt}>{t('onboarding:cardioTriad.intensityPrompt')}</Text>
        <SemiCircleSlider<CardioIntensity>
          options={INTENSITY_OPTIONS}
          selectedIndex={intensityIndex !== null && intensityIndex >= 0 ? intensityIndex : null}
          onSelectIndex={(i) => onChange({ ...value, intensity: INTENSITY_OPTIONS[i] })}
          formatValue={(i) => intensityLabels[i]}
          caption={t('onboarding:cardioTriad.intensityAxis')}
          placeholder={placeholder}
          accessibilityLabel={t('onboarding:cardioTriad.intensityPrompt')}
          onInteractionChange={onInteractionChange}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 28,
  },
  examples: {
    textAlign: 'center',
    color: BrandColors.textTertiary,
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.meta,
    fontStyle: 'italic',
    letterSpacing: LetterSpacing.wide,
  },
  dimension: {
    gap: 6,
  },
  dimensionLabel: {
    color: BrandColors.textSecondary,
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.metaSmall,
    letterSpacing: LetterSpacing.extraWide,
    textTransform: 'uppercase',
  },
  dimensionPrompt: {
    color: BrandColors.textPrimary,
    fontFamily: FontFamily.displayRegular,
    fontSize: FontSize.subheadline,
    lineHeight: LineHeight.subheadline,
    marginBottom: 2,
  },
  sliderWrapper: {
    width: '100%',
    alignSelf: 'center',
    marginTop: 2,
  },
  centerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 6,
    paddingHorizontal: 24,
  },
  valueText: {
    color: BrandColors.textPrimary,
    fontFamily: FontFamily.displayRegular,
    fontSize: 22,
    lineHeight: 26,
    textAlign: 'center',
  },
  valuePlaceholder: {
    color: BrandColors.textTertiary,
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.bodySmall,
    lineHeight: 20,
    fontStyle: 'normal',
  },
  captionText: {
    marginTop: 2,
    color: BrandColors.textTertiary,
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.metaSmall,
    letterSpacing: LetterSpacing.extraWide,
    textTransform: 'uppercase',
  },
});

export default CardioTriadSelector;
