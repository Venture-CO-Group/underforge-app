import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path as SvgPath } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BrandColors } from '../constants/Colors';
import { FontFamily } from '../constants/Typography';

// ─── AsyncStorage Keys ──────────────────────────────────────────────────
const TOUR_FIRST_SHOWN_KEY = '@feature_tour_first_shown';
const TOUR_LAST_SHOWN_KEY = '@feature_tour_last_shown';

// ─── Tour Steps (message keys in onboarding namespace) ─────────────────
const STEPS = [
  { messageKey: 'featureTourStep1' as const, target: 'ring_chart' as const },
  { messageKey: 'featureTourStep2' as const, target: 'plan_tab' as const },
  { messageKey: 'featureTourStep3' as const, target: 'log_tab' as const },
  { messageKey: 'featureTourStep4' as const, target: 'progress_tab' as const },
  { messageKey: 'featureTourStep5' as const, target: 'social_tab' as const },
];

// ─── Tab Center X Position ──────────────────────────────────────────────
// Layout: [Home flex:1][Plan flex:1][Log ~74px][Progress flex:1][Social flex:1]
const LOG_WRAPPER_W = 74;

const tabCenterX = (screenW: number, idx: number): number => {
  const tw = (screenW - LOG_WRAPPER_W) / 4;
  const positions = [
    tw / 2,
    tw * 1.5,
    tw * 2 + LOG_WRAPPER_W / 2,
    tw * 2 + LOG_WRAPPER_W + tw / 2,
    tw * 2 + LOG_WRAPPER_W + tw * 1.5,
  ];
  return positions[idx] ?? screenW / 2;
};

// ─── SVG Helpers ────────────────────────────────────────────────────────

/** Rounded rectangle as an SVG sub-path (clockwise winding). */
const rrect = (x: number, y: number, w: number, h: number, r: number): string => {
  const cr = Math.min(r, w / 2, h / 2);
  return [
    `M${x + cr},${y}`,
    `L${x + w - cr},${y}`,
    `Q${x + w},${y} ${x + w},${y + cr}`,
    `L${x + w},${y + h - cr}`,
    `Q${x + w},${y + h} ${x + w - cr},${y + h}`,
    `L${x + cr},${y + h}`,
    `Q${x},${y + h} ${x},${y + h - cr}`,
    `L${x},${y + cr}`,
    `Q${x},${y} ${x + cr},${y}`,
    'Z',
  ].join(' ');
};

/** Filled arrowhead triangle at (tipX,tipY) pointing in the direction from→tip. */
const arrowhead = (
  tipX: number, tipY: number,
  fromX: number, fromY: number,
  size: number = 10,
): string => {
  const angle = Math.atan2(tipY - fromY, tipX - fromX);
  const spread = Math.PI / 6;
  const x1 = tipX - size * Math.cos(angle - spread);
  const y1 = tipY - size * Math.sin(angle - spread);
  const x2 = tipX - size * Math.cos(angle + spread);
  const y2 = tipY - size * Math.sin(angle + spread);
  return `M${x1.toFixed(1)},${y1.toFixed(1)} L${tipX.toFixed(1)},${tipY.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)} Z`;
};

// ─── Cutout Region ──────────────────────────────────────────────────────
interface CutoutRegion {
  x: number; y: number; w: number; h: number; r: number;
}

// ─── Component ──────────────────────────────────────────────────────────
interface FeatureTourProps {
  visible: boolean;
  onDismiss: () => void;
}

export const FeatureTour: React.FC<FeatureTourProps> = ({ visible, onDismiss }) => {
  const [step, setStep] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { width: sw, height: sh } = Dimensions.get('window');
  const { t } = useTranslation(['onboarding', 'intro']);

  useEffect(() => {
    if (!visible) {
      fadeAnim.setValue(0);
      return;
    }
    setStep(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [visible]);

  const dismiss = () => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true })
      .start(() => onDismiss());
  };

  const next = () => {
    if (step >= STEPS.length - 1) {
      dismiss();
      return;
    }
    setStep(s => s + 1);
  };

  if (!visible) return null;

  const current = STEPS[step];
  const isRing = current.target === 'ring_chart';

  // ── Cutout region for each step ─────────────────────────────────────
  const tabW = (sw - LOG_WRAPPER_W) / 4;
  const tabBarBottom = sh - insets.bottom;

  const getCutout = (): CutoutRegion => {
    switch (current.target) {
      case 'ring_chart':
        return {
          x: (sw - 260) / 2,
          y: insets.top + 65,
          w: 260,
          h: 260,
          r: 24,
        };
      case 'plan_tab': {
        const cx = tabCenterX(sw, 1);
        return { x: cx - tabW / 2 - 6, y: tabBarBottom - 68, w: tabW + 12, h: 62, r: 14 };
      }
      case 'log_tab': {
        const cx = tabCenterX(sw, 2);
        return { x: cx - 40, y: tabBarBottom - 94, w: 80, h: 88, r: 18 };
      }
      case 'progress_tab': {
        const cx = tabCenterX(sw, 3);
        return { x: cx - tabW / 2 - 6, y: tabBarBottom - 68, w: tabW + 12, h: 62, r: 14 };
      }
      case 'social_tab': {
        const cx = tabCenterX(sw, 4);
        return { x: cx - tabW / 2 - 6, y: tabBarBottom - 68, w: tabW + 12, h: 62, r: 14 };
      }
      default:
        return { x: 0, y: 0, w: 0, h: 0, r: 0 };
    }
  };

  const cutout = getCutout();
  const cutoutCX = cutout.x + cutout.w / 2;

  // ── Tooltip position (derived from cutout) ──────────────────────────
  const ARROW_GAP = 45;
  const TW = Math.min(320, sw - 48);
  const tLeft = Math.max(24, Math.min(cutoutCX - TW / 2, sw - TW - 24));
  const tooltipCX = tLeft + TW / 2;

  const tooltipStyle = isRing
    ? { top: cutout.y + cutout.h + ARROW_GAP }
    : { bottom: sh - cutout.y + ARROW_GAP };

  // ── Arrow geometry (curved bezier + arrowhead) ──────────────────────
  const arrowStart = isRing
    ? { x: tooltipCX, y: cutout.y + cutout.h + ARROW_GAP - 3 }
    : { x: tooltipCX, y: cutout.y - ARROW_GAP + 3 };

  const arrowEnd = isRing
    ? { x: cutoutCX, y: cutout.y + cutout.h + 4 }
    : { x: cutoutCX, y: cutout.y - 4 };

  // Subtle curve offset (proportional to horizontal distance, capped)
  const curveDir = isRing ? 1 : -1;
  const hDist = Math.abs(arrowEnd.x - arrowStart.x);
  const curveOffset = hDist < 8 ? curveDir * 14 : curveDir * Math.min(14, hDist * 0.2);
  const ctrlX = (arrowStart.x + arrowEnd.x) / 2 + curveOffset;
  const ctrlY = (arrowStart.y + arrowEnd.y) / 2;

  const arrowLinePath = `M${arrowStart.x.toFixed(1)},${arrowStart.y.toFixed(1)} Q${ctrlX.toFixed(1)},${ctrlY.toFixed(1)} ${arrowEnd.x.toFixed(1)},${arrowEnd.y.toFixed(1)}`;
  const arrowHeadPath = arrowhead(arrowEnd.x, arrowEnd.y, ctrlX, ctrlY, 10);

  // ── SVG overlay: full-screen dark with cutout hole (evenodd) ────────
  const overlayPath = `M0,0 L${sw},0 L${sw},${sh} L0,${sh} Z ${rrect(cutout.x, cutout.y, cutout.w, cutout.h, cutout.r)}`;
  const borderPath = rrect(cutout.x, cutout.y, cutout.w, cutout.h, cutout.r);

  return (
    <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => {}}>
        {/* SVG: dark overlay with cutout + border + arrow */}
        <Svg
          width={sw}
          height={sh}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          {/* Dark overlay with transparent hole */}
          <SvgPath d={overlayPath} fill="rgba(11, 17, 20, 0.90)" fillRule="evenodd" />

          {/* Cutout accent border */}
          <SvgPath
            d={borderPath}
            stroke="rgba(244, 124, 60, 0.30)"
            strokeWidth={2}
            fill="none"
          />

          {/* Curved arrow line */}
          <SvgPath
            d={arrowLinePath}
            stroke={BrandColors.accent}
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
          />

          {/* Arrowhead */}
          <SvgPath d={arrowHeadPath} fill={BrandColors.accent} />
        </Svg>

        {/* Tooltip bubble */}
        <View style={[styles.tooltip, tooltipStyle, { left: tLeft, width: TW }]}>
          <View style={styles.bubble}>
            <Text style={styles.counter}>
              {step + 1}/{STEPS.length}
            </Text>
            <Text style={styles.msg}>{t(`onboarding:${STEPS[step].messageKey}`)}</Text>
            <View style={styles.nav}>
              <TouchableOpacity
                onPress={dismiss}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.skip}>{t('intro:skip')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.nextBtn} onPress={next} activeOpacity={0.75}>
                <Text style={styles.nextArrow}>›</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
};

// ─── Storage Helpers ────────────────────────────────────────────────────

/** Check if the feature tour should be shown (weekly for first 2 weeks). */
export const shouldShowFeatureTour = async (): Promise<boolean> => {
  try {
    const firstShown = await AsyncStorage.getItem(TOUR_FIRST_SHOWN_KEY);
    const now = Date.now();

    if (!firstShown) return true;

    const daysSinceFirst = (now - new Date(firstShown).getTime()) / 86_400_000;
    if (daysSinceFirst > 14) return false;

    const lastShown = await AsyncStorage.getItem(TOUR_LAST_SHOWN_KEY);
    if (!lastShown) return true;

    const daysSinceLast = (now - new Date(lastShown).getTime()) / 86_400_000;
    return daysSinceLast >= 7;
  } catch {
    return false;
  }
};

/** Mark the feature tour as shown (stores first-shown and last-shown timestamps). */
export const markFeatureTourShown = async (): Promise<void> => {
  try {
    const now = new Date().toISOString();
    const first = await AsyncStorage.getItem(TOUR_FIRST_SHOWN_KEY);
    if (!first) await AsyncStorage.setItem(TOUR_FIRST_SHOWN_KEY, now);
    await AsyncStorage.setItem(TOUR_LAST_SHOWN_KEY, now);
  } catch {
    // silent
  }
};

/** Reset tour storage so it shows again on next check (call on fresh onboarding). */
export const resetFeatureTour = async (): Promise<void> => {
  try {
    await AsyncStorage.multiRemove([TOUR_FIRST_SHOWN_KEY, TOUR_LAST_SHOWN_KEY]);
  } catch {
    // silent
  }
};

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  tooltip: {
    position: 'absolute',
  },
  bubble: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: 'rgba(244, 124, 60, 0.15)',
    shadowColor: '#F47C3C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 10,
  },
  counter: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 12,
    color: BrandColors.accent,
    letterSpacing: 1,
    marginBottom: 10,
  },
  msg: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 16,
    lineHeight: 24,
    color: BrandColors.textPrimary,
    marginBottom: 20,
  },
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skip: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: 14,
    color: BrandColors.textTertiary,
  },
  nextBtn: {
    backgroundColor: BrandColors.accent,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextArrow: {
    fontFamily: FontFamily.bodyBold,
    fontSize: 26,
    color: BrandColors.backgroundPrimary,
    marginTop: -2,
  },
});
