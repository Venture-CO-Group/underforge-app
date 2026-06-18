import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize } from '../constants/Typography';
import {
  getPendingLinksForUser,
  resolveLink,
  setLinkCaloriesResolution,
  type PendingLinkRow,
} from '../lib/activity-workout-links';
import { humanizeActivityName, providerSourceUserFacingLabel } from '../lib/health-platform-copy';
import { LinkReviewModal } from './LinkReviewModal';

interface Props {
  userId: string;
  mode?: 'home' | 'progress';
  /** Bumps when the parent reloads data (e.g. after sync); triggers a refetch. */
  dataVersion?: number;
  /** Fired after the user confirms or dismisses, so the parent can refresh counts. */
  onResolved?: () => void;
}

export const LinkActivityPill: React.FC<Props> = ({
  userId,
  mode = 'home',
  dataVersion,
  onResolved,
}) => {
  const { t } = useTranslation(['home']);
  const [pending, setPending] = useState<PendingLinkRow[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [modalQueueTotal, setModalQueueTotal] = useState(0);
  const [modalCurrentIndex, setModalCurrentIndex] = useState(1);
  const [snoozedUntilLinkCreatedAt, setSnoozedUntilLinkCreatedAt] = useState<string | null>(null);

  const reminderStorageKey = useMemo(
    () => `wearables:pending-links-snooze:${userId}`,
    [userId],
  );

  const reload = useCallback(async (): Promise<PendingLinkRow[]> => {
    if (!userId) {
      setPending([]);
      return [];
    }
    const rows = await getPendingLinksForUser(userId, 14);
    setPending(rows);
    if (rows.length === 0) {
      setSnoozedUntilLinkCreatedAt(null);
      try {
        await AsyncStorage.removeItem(reminderStorageKey);
      } catch {
        // no-op
      }
      return [];
    }
    if (mode === 'home') {
      try {
        const stored = await AsyncStorage.getItem(reminderStorageKey);
        setSnoozedUntilLinkCreatedAt(stored);
      } catch {
        setSnoozedUntilLinkCreatedAt(null);
      }
    } else {
      setSnoozedUntilLinkCreatedAt(null);
    }
    return rows;
  }, [mode, reminderStorageKey, userId]);

  const remindLater = useCallback(async () => {
    if (mode !== 'home' || pending.length === 0) return;
    const newest = pending.reduce(
      (max, row) => (row.createdAt > max ? row.createdAt : max),
      pending[0].createdAt,
    );
    try {
      await AsyncStorage.setItem(reminderStorageKey, newest);
    } catch {
      // no-op
    }
    setSnoozedUntilLinkCreatedAt(newest);
  }, [mode, pending, reminderStorageKey]);

  const closeReviewModal = useCallback(() => {
    setReviewVisible(false);
    setModalQueueTotal(0);
    setModalCurrentIndex(1);
  }, []);

  const resolveCurrentAndFetchRemaining = useCallback(
    async (state: 'linked' | 'separated'): Promise<number> => {
      if (busyId) return -1;
      const current = pending[0];
      if (!current) return -1;
      setBusyId(current.id);
      try {
        await resolveLink(current.id, state);
        const rows = await reload();
        onResolved?.();
        return rows.length;
      } finally {
        setBusyId(null);
      }
    },
    [busyId, onResolved, pending, reload],
  );

  const setResolutionAndFetchRemaining = useCallback(
    async (resolution: 'wearable' | 'uf' | 'average'): Promise<number> => {
      if (busyId) return -1;
      const current = pending[0];
      if (!current) return -1;
      setBusyId(current.id);
      try {
        await setLinkCaloriesResolution(current.id, resolution);
        const rows = await reload();
        onResolved?.();
        return rows.length;
      } finally {
        setBusyId(null);
      }
    },
    [busyId, onResolved, pending, reload],
  );

  useEffect(() => {
    void reload();
  }, [reload, dataVersion]);

  if (pending.length === 0) return null;

  const hasNewerPendingThanSnooze =
    snoozedUntilLinkCreatedAt == null
    || pending.some((row) => row.createdAt > snoozedUntilLinkCreatedAt);
  if (mode === 'home' && !hasNewerPendingThanSnooze) return null;

  const row = pending[0];
  const durationMin = Math.max(0, Math.round(row.activityDurationMinutes));
  const activityNameDisplay = humanizeActivityName(row.activityName);

  const advanceOrClose = (remaining: number) => {
    if (remaining === 0) {
      closeReviewModal();
    } else if (remaining > 0) {
      setModalCurrentIndex((i) => i + 1);
    }
  };

  return (
    <>
      <View style={[styles.container, mode === 'home' ? styles.containerHome : styles.containerProgress]}>
        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={2}>
            {t('home:linkActivityPrompt', {
              source: providerSourceUserFacingLabel(row.activitySource),
              activity: activityNameDisplay,
              minutes: durationMin,
              workout: row.workoutDayName,
              defaultValue: `{{source}} · {{activity}} · {{minutes}} min \u2014 matched to your \"{{workout}}\" log. Looks right?`,
            })}
          </Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.confirmBtn, busyId !== null && styles.btnDisabled]}
            onPress={() => {
              setModalQueueTotal(pending.length);
              setModalCurrentIndex(1);
              setReviewVisible(true);
            }}
            disabled={busyId !== null}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.confirmText}>
              {t('home:linkActivityReview', { defaultValue: 'Review' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <LinkReviewModal
        visible={reviewVisible}
        row={row}
        busyId={busyId}
        modalQueueTotal={modalQueueTotal}
        modalCurrentIndex={modalCurrentIndex}
        showRemindLater={mode === 'home'}
        onClose={closeReviewModal}
        onRemindLater={remindLater}
        onResolve={async (state) => {
          advanceOrClose(await resolveCurrentAndFetchRemaining(state));
        }}
        onSetResolution={async (resolution) => {
          advanceOrClose(await setResolutionAndFetchRemaining(resolution));
        }}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(244, 124, 60, 0.08)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 10,
  },
  containerHome: {
    marginTop: 4,
    marginBottom: 14,
  },
  containerProgress: {
    marginTop: 10,
    marginBottom: 0,
  },
  textCol: {
    flex: 1,
  },
  title: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.accentSoft,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmBtn: {
    backgroundColor: BrandColors.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  confirmText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 12,
    fontWeight: '600',
    color: BrandColors.backgroundPrimary,
  },
});

export default LinkActivityPill;
