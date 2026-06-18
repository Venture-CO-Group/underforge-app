import React from 'react';
import type { TextStyle } from 'react-native';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FontSize } from '../constants/Typography';
import { CheckinProgress, TrackingStatus } from '../lib/checkin_helper';
import { glowLogger } from '../lib/glow-logger'; // NEW

interface CheckinProgressBarProps {
  planProgress: number; // 0-1 progress ratio
  checkinProgress: CheckinProgress | null;
  onProgressTap?: () => void;
  onChevronTap?: () => void;
  showChevron?: boolean;
  // NEW: merged ProgressBarText props
  showProgressText?: boolean;
  progressTextStyle?: TextStyle;
  debugSource?: string; // NEW
  barHeight?: number; // NEW: custom bar height
  title?: string; // NEW: optional title above progress bar
}

export const CheckinProgressBar: React.FC<CheckinProgressBarProps> = ({
  planProgress,
  checkinProgress,
  onProgressTap,
  onChevronTap,
  showChevron = true,
  showProgressText = false,
  progressTextStyle,
  debugSource,
  barHeight, // NEW
  title, // NEW
}) => {
  const completedTasks = checkinProgress?.num_checkins_this_week ?? 0;
  const totalTasks = checkinProgress?.expected_checkins_this_week.length ?? 0;
  const tasksLeft = totalTasks - completedTasks;

  // NEW: determine tracking status (safe call)
  let trackingStatus: TrackingStatus | undefined;
  try {
    trackingStatus = checkinProgress?.isUserOnTrack
      ? checkinProgress.isUserOnTrack()
      : undefined;
  } catch {
    trackingStatus = undefined;
  }

  // NEW: choose colors based on status
  let barFillColor = '#F47C3C'; // burnt orange matching brand
  let progressTextColor = '#F47C3C'; // burnt orange for text
  if (trackingStatus === 'falling_behind') {
    barFillColor = '#E0A458';            // amber for warning
    progressTextColor = '#E0A458';       // amber for text
  } else if (trackingStatus === 'on_schedule' || trackingStatus === 'ahead_of_schedule') {
    barFillColor = '#F47C3C';            // burnt orange
    progressTextColor = '#F47C3C';       // burnt orange for text
  }

  const aheadPrefix = trackingStatus === 'ahead_of_schedule' ? '🙌 ' : '';

  const statusPhrase =
    trackingStatus === 'falling_behind'
      ? 'You are gently behind schedule.'
      : trackingStatus === 'ahead_of_schedule'
      ? 'You are ahead of schedule.'
      : trackingStatus === 'on_schedule'
      ? 'You are on schedule.'
      : '';

  // NEW: log render diagnostics
  try {
    glowLogger.info('CheckinProgressBar render', {
      source: debugSource || 'unknown',
      planProgress,
      has_checkin_progress: !!checkinProgress,
      num_checkins_this_week: checkinProgress?.num_checkins_this_week ?? 0,
      expected_len: checkinProgress?.expected_checkins_this_week.length ?? 0,
      completedTasks,
      totalTasks,
      tasksLeft,
      trackingStatus: trackingStatus ?? 'unknown',
      aheadPrefix,
      barFillColor,
      progressTextColor,
      has_isUserOnTrack: !!checkinProgress?.isUserOnTrack,
    });
  } catch {
    // fail-safe: swallow logging failures
  }

  return (
    <View>
      {title && (
        <Text style={styles.title}>{title}</Text>
      )}
      <TouchableOpacity
        style={styles.progressRow}
        onPress={onProgressTap}
        activeOpacity={onProgressTap ? 0.75 : 1}
        accessibilityRole="button"
        accessibilityLabel={
          checkinProgress
            ? `${completedTasks} of ${totalTasks} check-ins completed this week. ${statusPhrase} Tap to view details.`
            : `Plan progress ${Math.round(planProgress * 100)} percent. Tap to view details.`
        }
        disabled={!onProgressTap}
      >
        <View
          style={[
            styles.progressBarTrack,
            barHeight ? { height: barHeight, borderRadius: barHeight / 2 } : null, // NEW
          ]}
        >
          <Animated.View
            style={[
              styles.progressBarFill,
              {
                width: `${Math.round(planProgress * 100)}%`,
                backgroundColor: barFillColor,
              },
            ]}
          />
        </View>
        {showChevron && (
          <TouchableOpacity
            onPress={onChevronTap}
            style={styles.progressChevronButton}
            accessibilityRole="button"
            accessibilityLabel="Open checkin day"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.progressChevronText}>›</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
      {showProgressText && checkinProgress && (
        <Text
          style={[
            styles.progressText,
            { color: progressTextColor }, // NEW: dynamic text color
            progressTextStyle
          ]}
        >
          {aheadPrefix}{completedTasks} / {totalTasks} tasks completed | {tasksLeft} left this week
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  title: {
    fontSize: FontSize.subheadline,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 2,
  },
  progressBarTrack: {
    flex: 1,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#1E2A2C',
    backgroundColor: '#141E1E',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    // backgroundColor now overridden dynamically
  },
  progressChevronButton: {
    marginLeft: 8,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressChevronText: {
    fontSize: 26,
    lineHeight: 26,
    color: '#F2F2EE',
    fontWeight: '500',
  },
  // NEW: merged text style
  progressText: {
    fontSize: 14,
    color: '#9AA3A6',
    textAlign: 'center',
    fontWeight: '400',
    fontFamily: 'Nunito-Regular',
  },
});