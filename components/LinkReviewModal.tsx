import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BrandColors } from '../constants/Colors';
import { FontFamily } from '../constants/Typography';
import { humanizeActivityName, providerSourceUserFacingLabel } from '../lib/health-platform-copy';
import type { PendingLinkRow } from '../lib/activity-workout-links';

interface Props {
  visible: boolean;
  row: PendingLinkRow | null;
  busyId: number | null;
  modalQueueTotal?: number;
  modalCurrentIndex?: number;
  showRemindLater?: boolean;
  onClose: () => void;
  onRemindLater?: () => Promise<void>;
  onResolve: (state: 'linked' | 'separated') => Promise<void>;
  onSetResolution: (resolution: 'wearable' | 'uf' | 'average') => Promise<void>;
}

const formatDate = (date: string): string => {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const formatTimeShort = (iso: string | null): string | null => {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const LinkReviewModal: React.FC<Props> = ({
  visible,
  row,
  busyId,
  modalQueueTotal = 0,
  modalCurrentIndex = 1,
  showRemindLater = false,
  onClose,
  onRemindLater,
  onResolve,
  onSetResolution,
}) => {
  const { t } = useTranslation(['home']);
  const [confirmedSameSession, setConfirmedSameSession] = useState(false);

  useEffect(() => {
    if (visible) {
      setConfirmedSameSession(false);
    }
  }, [visible, row?.id]);

  const handleClose = useCallback(() => {
    setConfirmedSameSession(false);
    onClose();
  }, [onClose]);

  if (!row) return null;

  const durationMin = Math.max(0, Math.round(row.activityDurationMinutes));
  const timeShort = formatTimeShort(row.activityStartedAt);
  const wearableDetailParts = [`${durationMin} min`, ...(timeShort ? [timeShort] : [])];
  const wearableDetailLine = wearableDetailParts.join(' · ');
  const sessionDate = formatDate(row.activityDate);
  const providerName = providerSourceUserFacingLabel(row.activitySource);
  const activityNameDisplay = humanizeActivityName(row.activityName);
  const showDeviation =
    row.caloriesResolution === 'pending_review' && row.activityKcal > 0 && row.workoutKcal > 0;
  const showDeviationStep = showDeviation && confirmedSameSession;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.modalOverlay} onPress={handleClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalTitleRow}>
            <Text style={styles.modalTitle} numberOfLines={2}>
              {t('home:linkActivityModalTitle', { defaultValue: 'Review matched activity' })}
            </Text>
            {modalQueueTotal > 0 ? (
              <Text
                style={styles.modalFraction}
                accessibilityLabel={t('home:linkActivityModalFractionA11y', {
                  current: modalCurrentIndex,
                  total: modalQueueTotal,
                  defaultValue: `Item ${modalCurrentIndex} of ${modalQueueTotal}`,
                })}
              >
                {modalCurrentIndex}/{modalQueueTotal}
              </Text>
            ) : null}
          </View>
          <Text style={styles.modalDate}>{sessionDate}</Text>

          <View style={styles.compareRow}>
            <View style={styles.compareBox}>
              <Text style={styles.compareBoxLabel}>{providerName}</Text>
              <Text style={styles.compareBoxTitle} numberOfLines={4}>
                {activityNameDisplay}
              </Text>
              {wearableDetailLine.length > 0 ? (
                <Text style={styles.compareBoxMeta} numberOfLines={2}>
                  {wearableDetailLine}
                </Text>
              ) : null}
              {row.activityKcal > 0 ? (
                <Text style={styles.compareBoxMeta}>{row.activityKcal} kcal</Text>
              ) : null}
            </View>
            <View style={styles.compareBox}>
              <Text style={styles.compareBoxLabel}>
                {t('home:linkActivityBoxApp', { defaultValue: 'Underforge' })}
              </Text>
              <Text style={styles.compareBoxTitle} numberOfLines={4}>
                {row.workoutDayName}
              </Text>
              {row.workoutKcal > 0 ? (
                <Text style={styles.compareBoxMeta}>{row.workoutKcal} kcal</Text>
              ) : null}
            </View>
          </View>

          {showDeviationStep ? (
            <View style={styles.deviationBlock}>
              <Text style={styles.deviationTitle}>
                {t('home:linkActivityDeviationTitle', {
                  defaultValue: 'These estimates differ by more than 20%. Which should we use?',
                })}
              </Text>
              <View style={styles.deviationButtons}>
                <TouchableOpacity
                  style={[styles.deviationButton, busyId === row.id && styles.btnDisabled]}
                  disabled={busyId !== null}
                  onPress={() => void onSetResolution('wearable')}
                >
                  <Text style={styles.deviationButtonText}>
                    {t('home:linkActivityUseWearable', {
                      defaultValue: 'Use {{source}}',
                      source: providerName,
                    })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.deviationButton, busyId === row.id && styles.btnDisabled]}
                  disabled={busyId !== null}
                  onPress={() => void onSetResolution('uf')}
                >
                  <Text style={styles.deviationButtonText}>
                    {t('home:linkActivityUseUf', { defaultValue: 'Use Underforge' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.deviationButton, busyId === row.id && styles.btnDisabled]}
                  disabled={busyId !== null}
                  onPress={() => void onSetResolution('average')}
                >
                  <Text style={styles.deviationButtonText}>
                    {t('home:linkActivityUseAverage', { defaultValue: 'Average them' })}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {!showDeviationStep ? (
            <TouchableOpacity
              style={[styles.modalPrimaryButton, busyId === row.id && styles.btnDisabled]}
              onPress={() => {
                if (showDeviation) {
                  setConfirmedSameSession(true);
                  return;
                }
                void onResolve('linked');
              }}
              disabled={busyId !== null}
            >
              <Text style={styles.modalPrimaryButtonText}>
                {t('home:linkActivityConfirm', { defaultValue: 'Yes, same session' })}
              </Text>
            </TouchableOpacity>
          ) : null}

          {!showDeviationStep ? (
            <TouchableOpacity
              style={[styles.modalSecondaryButton, busyId === row.id && styles.btnDisabled]}
              onPress={() => void onResolve('separated')}
              disabled={busyId !== null}
            >
              <Text style={styles.modalSecondaryButtonText}>
                {t('home:linkActivityDifferent', { defaultValue: 'No, different activities' })}
              </Text>
            </TouchableOpacity>
          ) : null}

          {showRemindLater && onRemindLater ? (
            <TouchableOpacity
              style={[styles.modalGhostButton, busyId === row.id && styles.btnDisabled]}
              onPress={async () => {
                await onRemindLater();
                handleClose();
              }}
              disabled={busyId !== null}
            >
              <Text style={styles.modalGhostButtonText}>
                {t('home:linkActivityRemindLater', { defaultValue: 'Remind me next week' })}
              </Text>
            </TouchableOpacity>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  btnDisabled: {
    opacity: 0.5,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalCard: {
    backgroundColor: '#0E1A1A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E2A2C',
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 20,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
  },
  modalTitle: {
    flex: 1,
    fontFamily: FontFamily.bodyRegular,
    fontSize: 20,
    fontWeight: '600',
    color: '#F2F2EE',
    textAlign: 'left',
    letterSpacing: -0.3,
    paddingRight: 4,
  },
  modalFraction: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 15,
    fontWeight: '600',
    color: '#8C979B',
    marginTop: 2,
    flexShrink: 0,
  },
  modalDate: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 13,
    color: '#8C979B',
    textAlign: 'center',
    marginBottom: 18,
  },
  compareRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  compareBox: {
    flex: 1,
    backgroundColor: '#141E1E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#243032',
    paddingVertical: 16,
    paddingHorizontal: 14,
    minHeight: 112,
    justifyContent: 'flex-start',
  },
  compareBoxLabel: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 12,
    fontWeight: '600',
    color: BrandColors.textTertiary,
    letterSpacing: 0.2,
    marginBottom: 10,
  },
  compareBoxTitle: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
    lineHeight: 22,
  },
  compareBoxMeta: {
    marginTop: 8,
    fontFamily: FontFamily.bodyRegular,
    fontSize: 12,
    color: '#8C979B',
    lineHeight: 16,
  },
  deviationBlock: {
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BrandColors.inputBorder,
    backgroundColor: BrandColors.backgroundTertiary,
    gap: 10,
  },
  deviationTitle: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: 13,
    color: BrandColors.textPrimary,
    lineHeight: 18,
  },
  deviationButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  deviationButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BrandColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviationButtonText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: 12,
    color: BrandColors.textPrimary,
    textAlign: 'center',
  },
  modalPrimaryButton: {
    marginTop: 20,
    backgroundColor: BrandColors.accentSoft,
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryButtonText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 14,
    fontWeight: '700',
    color: BrandColors.backgroundPrimary,
  },
  modalSecondaryButton: {
    marginTop: 8,
    backgroundColor: 'rgba(244, 124, 60, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(244, 124, 60, 0.35)',
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSecondaryButtonText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 14,
    fontWeight: '600',
    color: BrandColors.accentSoft,
  },
  modalGhostButton: {
    marginTop: 2,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalGhostButtonText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 13,
    color: BrandColors.textTertiary,
  },
});

export default LinkReviewModal;
