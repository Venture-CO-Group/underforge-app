/**
 * Small pill that surfaces where an activity or metric came from, and how
 * confident we are in its calorie value. Keeps the provenance visible per
 * the wearables plan: users should always know whether a kcal number was
 * reported by a wearable, estimated from MET, or entered by them.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { providerSourceUserFacingLabel } from '../lib/health-platform-copy';
import type { ActivityLog } from '../types/workout';

type Source = NonNullable<ActivityLog['source']>;
type Confidence = NonNullable<ActivityLog['caloriesConfidence']>;

const SOURCE_COLOR: Record<Source, { bg: string; fg: string }> = {
  manual: { bg: '#1E2A2C', fg: '#C7D0D4' },
  healthkit: { bg: '#1B2A26', fg: '#8FD3B7' },
  whoop: { bg: '#2A1B22', fg: '#E3A2B4' },
  garmin: { bg: '#20262E', fg: '#9AB5D1' },
  healthconnect: { bg: '#2A251B', fg: '#D7B98F' },
};

const CONFIDENCE_DOT: Record<Confidence, string> = {
  high: '#4ADE80',
  medium: '#F59E0B',
  low: '#F87171',
};

interface Props {
  source?: Source;
  caloriesSource?: ActivityLog['caloriesSource'];
  caloriesConfidence?: Confidence;
  compact?: boolean;
}

export const SourceBadge: React.FC<Props> = ({
  source,
  caloriesSource,
  caloriesConfidence,
  compact,
}) => {
  const effective: Source = source ?? 'manual';
  const palette = SOURCE_COLOR[effective];
  const showDot = caloriesSource && caloriesSource !== 'manual';

  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }, compact && styles.pillCompact]}>
      <Text style={[styles.text, { color: palette.fg }, compact && styles.textCompact]}>
        {providerSourceUserFacingLabel(effective)}
      </Text>
      {showDot ? (
        <View
          style={[
            styles.dot,
            { backgroundColor: CONFIDENCE_DOT[caloriesConfidence ?? 'medium'] },
          ]}
          accessibilityLabel={`calorie confidence ${caloriesConfidence ?? 'medium'}`}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  pillCompact: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  textCompact: {
    fontSize: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
