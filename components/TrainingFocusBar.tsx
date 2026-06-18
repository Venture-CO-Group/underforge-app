import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TrainingFocus } from '../lib/training-focus';

const STRENGTH_COLOR = '#F47C3C'; // orange (brand accent)
const CARDIO_COLOR = '#2E9E8F';   // teal

interface TrainingFocusBarProps {
  focus: TrainingFocus;
  /** Optional title above the bar. */
  title?: string;
}

/**
 * Slim stacked horizontal bar showing the strength vs cardio focus of a training day /
 * workout. Renders nothing when there's no data. Used in plan details, the post-workout
 * summary, and the weekly check-in.
 */
export const TrainingFocusBar: React.FC<TrainingFocusBarProps> = ({ focus, title }) => {
  const { t } = useTranslation(['workout']);
  if (focus.empty) return null;

  const { strengthPct, cardioPct } = focus;

  return (
    <View style={styles.container}>
      {!!title && <Text style={styles.title}>{title}</Text>}

      <View style={styles.track}>
        {strengthPct > 0 && (
          <View style={[styles.segment, { flex: strengthPct, backgroundColor: STRENGTH_COLOR }]} />
        )}
        {cardioPct > 0 && (
          <View style={[styles.segment, { flex: cardioPct, backgroundColor: CARDIO_COLOR }]} />
        )}
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: STRENGTH_COLOR }]} />
          <Text style={styles.legendText}>
            {t('workout:focusStrength', { defaultValue: 'Strength' })} {strengthPct}%
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: CARDIO_COLOR }]} />
          <Text style={styles.legendText}>
            {t('workout:focusCardio', { defaultValue: 'Cardio' })} {cardioPct}%
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9AA3A6',
    marginBottom: 6,
  },
  track: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: '#1E2A2C',
  },
  segment: {
    height: '100%',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  legendText: {
    fontSize: 12,
    color: '#C5C9C7',
    fontWeight: '500',
  },
});
