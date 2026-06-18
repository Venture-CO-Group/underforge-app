import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import {
  Dimensions,
  Modal,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Svg, { Line } from 'react-native-svg';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const GRID_SPACING = 38;
const SCAN_DURATION_MS = 3200;

function GridScanBackground() {
  const scanY = useSharedValue(0);

  useEffect(() => {
    scanY.value = withRepeat(
      withTiming(SCREEN_H, { duration: SCAN_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
  }, [scanY]);

  const scanLineStyle = useAnimatedStyle(() => ({
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
            stroke="#1A2428"
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
            stroke="#1A2428"
            strokeWidth={0.5}
          />
        ))}
      </Svg>

      <Animated.View style={[gridStyles.scanWrap, scanLineStyle]}>
        <LinearGradient
          colors={['transparent', 'rgba(244,124,60,0.08)', 'rgba(244,124,60,0.25)', 'rgba(244,124,60,0.08)', 'transparent']}
          locations={[0, 0.2, 0.5, 0.8, 1]}
          style={gridStyles.scanGlow}
        />
        <View style={gridStyles.scanLine} />
      </Animated.View>
    </View>
  );
}

const gridStyles = StyleSheet.create({
  scanWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 80,
    top: -40,
  },
  scanGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 39,
    height: 1.5,
    backgroundColor: '#F47C3C',
    shadowColor: '#F47C3C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
});

interface WeeklyProgressReportGateModalProps {
  visible: boolean;
  onSkip: () => void;
  onLetsGo: () => void;
}

export const WeeklyProgressReportGateModal: React.FC<WeeklyProgressReportGateModalProps> = ({
  visible,
  onSkip,
  onLetsGo,
}) => {
  const { t } = useTranslation(['report']);
  return (
  <Modal visible={visible} animationType="fade" transparent presentationStyle="overFullScreen">
    <View style={styles.backdrop}>
      <GridScanBackground />
      <SafeAreaView style={styles.safe}>
        <View style={styles.card}>
          <View style={styles.iconRow}>
            <MaterialCommunityIcons name="chart-timeline-variant-shimmer" size={36} color="#F47C3C" />
          </View>
          <Text style={styles.headline}>{t('report:weeklyGateHeadline')}</Text>
          <Text style={styles.sub}>
            {t('report:weeklyGateSub')}
          </Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={onLetsGo}
              accessibilityRole="button"
              accessibilityLabel={t('report:weeklyGateA11yLetsGo')}
            >
              <Text style={styles.primaryText}>{t('report:weeklyGateLetsGo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={onSkip}
              accessibilityRole="button"
              accessibilityLabel={t('report:weeklyGateA11ySkip')}
            >
              <Text style={styles.skipText}>{t('report:weeklyGateSkip')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(11,17,20,0.88)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  safe: {
    justifyContent: 'center',
  },
  card: {
    backgroundColor: 'rgba(14,26,26,0.92)',
    borderRadius: 20,
    padding: 28,
    borderWidth: 1,
    borderColor: 'rgba(244,124,60,0.18)',
  },
  iconRow: {
    alignItems: 'center',
    marginBottom: 18,
  },
  headline: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 10,
    lineHeight: 28,
    textAlign: 'center',
  },
  sub: {
    fontSize: 15,
    color: '#9AA3A6',
    lineHeight: 22,
    marginBottom: 28,
    textAlign: 'center',
  },
  actions: {
    gap: 12,
  },
  primaryBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#F47C3C',
    minHeight: 48,
    justifyContent: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  skipBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A3638',
    minHeight: 48,
    justifyContent: 'center',
  },
  skipText: {
    color: '#9AA3A6',
    fontSize: 17,
    fontWeight: '600',
  },
});
