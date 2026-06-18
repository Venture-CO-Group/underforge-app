import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize } from '../constants/Typography';
import { getManualRestDayOverride, setManualRestDayOverride } from '../lib/training-day-override';
import type { TrainingDaySwapKind } from '../lib/training-day-status';

interface Props {
  dayType: 'training' | 'rest';
  daySwapped?: boolean;
  swapKind?: TrainingDaySwapKind;
  plannedTraining?: boolean;
  userId?: string;
  ymd?: string;
  onOverrideChanged?: () => void | Promise<void>;
  style?: ViewStyle;
}

function swapMessageKey(kind: TrainingDaySwapKind): string {
  switch (kind) {
    case 'workout_on_rest':
      return 'home:calsBalanceDaySwappedWorkoutOnRest';
    case 'manual_activity_on_rest':
      return 'home:calsBalanceDaySwappedActivityOnRest';
    case 'imported_activity_on_rest':
      return 'home:calsBalanceDaySwappedImportedOnRest';
    case 'manual_rest_override':
      return 'home:calsBalanceDayManualRestOverride';
    case 'missed_planned_workout':
      return 'home:calsBalanceDaySwappedToRest';
    default:
      return 'home:calsBalanceDaySwappedToRest';
  }
}

function swapMessageDefault(kind: TrainingDaySwapKind): string {
  switch (kind) {
    case 'workout_on_rest':
      return 'Switched from a planned rest day because you completed a workout in the app.';
    case 'manual_activity_on_rest':
      return 'Switched from a planned rest day because you logged activity (10+ min) in the app.';
    case 'imported_activity_on_rest':
      return 'Switched from a planned rest day because activity was imported from your connected wearable.';
    case 'manual_rest_override':
      return "You're using rest-day targets today instead of your planned training day.";
    case 'missed_planned_workout':
      return 'Switched from a planned training day because no workout or qualifying activity was logged.';
    default:
      return '';
  }
}

export const DayTypeLabel: React.FC<Props> = ({
  dayType,
  daySwapped = false,
  swapKind,
  plannedTraining = false,
  userId,
  ymd,
  onOverrideChanged,
  style,
}) => {
  const { t } = useTranslation(['home', 'common']);
  const [modalVisible, setModalVisible] = useState(false);
  const [skipTrainingToday, setSkipTrainingToday] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);

  const label =
    dayType === 'training'
      ? t('home:calsBalanceDayTraining', { defaultValue: 'Training day' })
      : t('home:calsBalanceDayRest', { defaultValue: 'Rest day' });

  const unplannedInfo = t('home:calsBalanceDayTypeInfo', {
    defaultValue:
      'If you log unplanned workouts or activity, your calorie and macro targets may be adjusted.',
  });

  const skipTrainingPrompt = t('home:calsBalanceDaySkipTrainingPrompt', {
    defaultValue:
      "If you're not training today, turn on the switch below and we'll use your rest-day targets.",
  });

  const swapDetail =
    daySwapped && swapKind && swapKind !== 'manual_rest_override'
      ? t(swapMessageKey(swapKind), { defaultValue: swapMessageDefault(swapKind) })
      : '';

  const showSkipSwitch = plannedTraining && !!userId && !!ymd;

  const loadOverride = useCallback(async () => {
    if (!userId || !ymd) return;
    const on = await getManualRestDayOverride(userId, ymd);
    setSkipTrainingToday(on);
  }, [userId, ymd]);

  useEffect(() => {
    if (modalVisible) {
      loadOverride();
    }
  }, [modalVisible, loadOverride]);

  const openModal = () => setModalVisible(true);
  const closeModal = () => setModalVisible(false);

  const onToggleSkip = async (value: boolean) => {
    if (!userId || !ymd) return;
    setSkipTrainingToday(value);
    setSavingOverride(true);
    try {
      await setManualRestDayOverride(userId, ymd, value);
      await onOverrideChanged?.();
    } finally {
      setSavingOverride(false);
    }
  };

  const modalBody = swapDetail || (showSkipSwitch ? skipTrainingPrompt : unplannedInfo);

  return (
    <>
      <TouchableOpacity
        onPress={openModal}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={modalBody}
        style={[styles.row, style]}
      >
        <Text style={[styles.label, daySwapped && styles.labelEmphasis]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.infoIcon} accessibilityElementsHidden importantForAccessibility="no">
          ⓘ
        </Text>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        animationType="fade"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={closeModal}
      >
        <Pressable style={styles.backdrop} onPress={closeModal}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.cardTitle}>{label}</Text>
            <Text style={styles.cardBody}>{modalBody}</Text>

            {showSkipSwitch ? (
              <>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>
                    {t('home:calsBalanceDaySkipTrainingSwitch', {
                      defaultValue: 'Change to non-training today',
                    })}
                  </Text>
                  <Switch
                    value={skipTrainingToday}
                    onValueChange={onToggleSkip}
                    disabled={savingOverride}
                    trackColor={{ false: BrandColors.inputBorder, true: BrandColors.accent + '99' }}
                    thumbColor={skipTrainingToday ? BrandColors.accent : '#f4f3f4'}
                    accessibilityLabel={t('home:calsBalanceDaySkipTrainingSwitch', {
                      defaultValue: 'Change to non-training today',
                    })}
                  />
                </View>
                <Text style={styles.cardFootnote}>
                  {t('home:calsBalanceDaySkipTrainingFootnote', {
                    defaultValue:
                      'Remember: reschedule this session later in the week to keep your consistency score high.',
                  })}
                </Text>
              </>
            ) : null}

            <TouchableOpacity style={styles.okButton} onPress={closeModal} accessibilityRole="button">
              <Text style={styles.okButtonText}>{t('common:ok', { defaultValue: 'OK' })}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    maxWidth: '100%',
  },
  label: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall - 1,
    color: BrandColors.textTertiary,
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  labelEmphasis: {
    textDecorationLine: 'underline',
    textDecorationColor: BrandColors.textTertiary,
  },
  infoIcon: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    lineHeight: FontSize.metaSmall + 2,
    flexShrink: 0,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(11, 17, 20, 0.75)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    padding: 20,
    gap: 14,
  },
  cardTitle: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  cardBody: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.meta,
    color: BrandColors.textSecondary,
    lineHeight: FontSize.meta + 6,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchLabel: {
    flex: 1,
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.meta,
    color: BrandColors.textPrimary,
  },
  cardFootnote: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    lineHeight: FontSize.metaSmall + 5,
  },
  okButton: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  okButtonText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.meta,
    color: BrandColors.accent,
  },
});

export default DayTypeLabel;
