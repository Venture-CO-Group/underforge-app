import React from 'react';
import { AccessibilityProps, Animated, StyleSheet, View } from 'react-native';

interface TaskCheckinProgressBarProps extends AccessibilityProps {
  progress: number;          // 0..1
  height?: number;           // bar height (default 14)
  fillColor?: string;        // optional override
  trackColor?: string;       // optional override
  borderColor?: string;      // optional override
}

export const TaskCheckinProgressBar: React.FC<TaskCheckinProgressBarProps> = ({
  progress,
  height = 14,
  fillColor = '#F47C3C',
  trackColor = '#141E1E',
  borderColor = '#1C1C1E',
  accessibilityLabel
}) => {
  const pct = Math.min(Math.max(progress, 0), 1);
  return (
    <View
      style={[
        styles.track,
        { height, backgroundColor: trackColor, borderColor }
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel || `Day progress ${Math.round(pct * 100)} percent`}
      accessibilityValue={{ now: Math.round(pct * 100), min: 0, max: 100 }}
    >
      <Animated.View
        style={[
          styles.fill,
            { width: `${Math.round(pct * 100)}%`, backgroundColor: fillColor }
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    width: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
  },
  fill: {
    height: '100%',
  },
});
