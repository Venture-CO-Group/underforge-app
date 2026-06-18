/**
 * Burned-today breakdown: one progress bar per category (sessions and daily
 * movement on top, BMR at the bottom because it is passive). Info (i) opens
 * the formula sheet.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize } from '../constants/Typography';
import {
  computeCaloriesBurnedBreakdown,
  type BreakdownRow,
  type CaloriesBurnedBreakdown,
} from '../lib/calories-balance';

interface Props {
  visible: boolean;
  onClose: () => void;
  userId: string;
  todayYmd: string;
  bmrKcal: number;
  weightKg: number;
  occupationNeatKcal: number;
  plannedTrainingToday: boolean;
  /** Plan estimated kcal for today's session (0 if unknown). */
  plannedSessionTargetKcal?: number;
  infoRequestKey?: number;
}

const ROW_LABELS_DEFAULT: Record<BreakdownRow['key'], string> = {
  bmr: 'Daily BMR',
  sessions: 'Workouts & activities',
  daily_movement: 'Daily movement',
};

const SEGMENT_COLORS: Record<BreakdownRow['key'], string> = {
  bmr: '#5A7A86',
  sessions: '#5A9E97',
  daily_movement: '#F47C3C',
};

const INFO_KEYS: BreakdownRow['key'][] = ['sessions', 'daily_movement', 'bmr'];

const BAR_HEIGHT = 12;

/** Order rows so active categories show first and BMR sits at the bottom. */
function sortRowsForDisplay(rows: BreakdownRow[]): BreakdownRow[] {
  const order: Record<BreakdownRow['key'], number> = {
    sessions: 0,
    daily_movement: 1,
    bmr: 2,
  };
  return [...rows].sort((a, b) => (order[a.key] ?? 99) - (order[b.key] ?? 99));
}

const INFO_DEFAULTS: Record<BreakdownRow['key'], { title: string; body: string }> = {
  bmr: {
    title: 'BMR (basal metabolic rate)',
    body:
      'Passive burn — your body uses this energy at rest by default, all day. From wearable resting calories (7-day average) when connected, otherwise from your onboarding profile (Mifflin-St Jeor).',
  },
  sessions: {
    title: 'Workouts & activities',
    body:
      'Strength sessions logged in the app plus cardio and other activities (including wearable imports). Linked wearable/workout pairs use your chosen calorie resolution or a blend.',
  },
  daily_movement: {
    title: 'Daily movement',
    body:
      'Non-exercise movement from walking and daily activity. Without a connected wearable we estimate it from your occupation (onboarding) and count it as complete for the day. If you connect Apple Health, Health Connect, or another supported source, this bar fills progressively from your real steps or active energy instead.',
  },
};

function CategoryProgressBar({
  row,
  label,
  labelSuffix,
  dimmed = false,
}: {
  row: BreakdownRow;
  label: string;
  /** Discrete inline note beside the row title, e.g. "(by end of day)". */
  labelSuffix?: string;
  /** Zero target today — keep row visible but muted (sessions on rest/training days). */
  dimmed?: boolean;
}) {
  const achieved = Math.max(0, Math.round(row.achieved));
  const target = Math.max(0, Math.round(row.target));
  const scaleMax = Math.max(achieved, target, 1);
  const toPct = (value: number) => Math.min(100, Math.round((value / scaleMax) * 100));
  const achievedPct = toPct(achieved);
  const targetPct = toPct(target);
  const color = SEGMENT_COLORS[row.key];
  const mutedColor = '#5C6B70';

  return (
    <View style={[styles.barRow, dimmed && styles.barRowDimmed]}>
      <View style={styles.barHeader}>
        <View style={styles.barLabelLeft}>
          <View
            style={[
              styles.barSwatch,
              { backgroundColor: dimmed ? mutedColor : color },
            ]}
          />
          <View style={styles.barLabelTextWrap}>
            <View style={styles.barLabelRow}>
              <Text
                style={[styles.barLabel, dimmed && styles.barLabelDimmed]}
                numberOfLines={2}
              >
                {label}
                {row.sourceLabel ? (
                  <Text style={styles.barLabelSource}>{` (${row.sourceLabel})`}</Text>
                ) : null}
              </Text>
              {labelSuffix ? (
                <Text style={styles.barLabelSuffix}>{labelSuffix}</Text>
              ) : null}
            </View>
          </View>
        </View>
        <Text style={[styles.barValue, dimmed && styles.barValueDimmed]}>
          {achieved.toLocaleString()}
          <Text style={styles.barValueSecondary}>
            {' / '}
            {target.toLocaleString()} kcal
          </Text>
        </Text>
      </View>
      <View style={styles.barTrack}>
        {dimmed ? (
          <View
            style={[
              styles.barPlaceholder,
              { backgroundColor: `${mutedColor}30` },
            ]}
          />
        ) : (
          <>
            <View
              style={[
                styles.barGhost,
                { width: `${targetPct}%`, backgroundColor: `${color}40` },
              ]}
            />
            <View
              style={[styles.barFill, { width: `${achievedPct}%`, backgroundColor: color }]}
            />
            {target > 0 ? (
              <View style={[styles.barTargetMarker, { left: `${targetPct}%` }]} />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

export const CaloriesBurnedBreakdownModal: React.FC<Props> = ({
  visible,
  onClose,
  userId,
  todayYmd,
  bmrKcal,
  weightKg,
  occupationNeatKcal,
  plannedTrainingToday,
  plannedSessionTargetKcal = 0,
  infoRequestKey = 0,
}) => {
  const { t } = useTranslation(['home']);
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<CaloriesBurnedBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const result = await computeCaloriesBurnedBreakdown({
          userId,
          todayYmd,
          bmrKcal,
          weightKg,
          occupationNeatKcal,
          plannedTrainingToday,
          plannedSessionTargetKcal,
        });
        if (!cancelled) setData(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, userId, todayYmd, bmrKcal, weightKg, occupationNeatKcal, plannedTrainingToday, plannedSessionTargetKcal]);

  useEffect(() => {
    if (visible && infoRequestKey > 0) {
      setInfoVisible(true);
    }
  }, [visible, infoRequestKey]);

  const sheetPadding = Math.max(16, insets.bottom + 12);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: sheetPadding }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>
              {t('home:burnedBreakdownTitle', { defaultValue: 'To Burn today' })}
            </Text>
            <TouchableOpacity
              onPress={() => setInfoVisible(true)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel={t('home:burnedInfoButton', { defaultValue: 'How is this calculated?' })}
            >
              <View style={styles.infoButton}>
                <Text style={styles.infoButtonText}>i</Text>
              </View>
            </TouchableOpacity>
          </View>

          {loading || !data ? (
            <Text style={styles.loadingText}>
              {t('home:burnedLoading', { defaultValue: 'Calculating…' })}
            </Text>
          ) : (
            <ScrollView style={styles.mainScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.barsList}>
                {(() => {
                  const sorted = sortRowsForDisplay(data.rows);
                  const byEndOfDay = t('home:calsBalanceByEndOfDay', {
                    defaultValue: '(by end of day)',
                  });

                  const renderRow = (row: BreakdownRow) => {
                    const label = t(`home:burnedRow_${row.key}`, {
                      defaultValue: ROW_LABELS_DEFAULT[row.key],
                    });
                    const labelSuffix =
                      row.key === 'bmr' ||
                      (row.key === 'daily_movement' &&
                        (!data.hasWearableMovement || row.estimatedFromOccupation))
                        ? byEndOfDay
                        : undefined;
                    const dimmed = row.key === 'sessions' && row.target <= 0;
                    return (
                      <CategoryProgressBar
                        key={row.key}
                        row={row}
                        label={label}
                        labelSuffix={labelSuffix}
                        dimmed={dimmed}
                      />
                    );
                  };

                  return (
                    <View style={styles.barsStack}>
                      {sorted.map(renderRow)}
                    </View>
                  );
                })()}
              </View>

              <View style={styles.divider} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  {t('home:burnedTotal', { defaultValue: 'Total' })}
                </Text>
                <Text style={styles.totalValue}>
                  {data.achievedTotal.toLocaleString()}
                  <Text style={styles.totalValueSecondary}>
                    {' / '}
                    {data.targetTotal.toLocaleString()} kcal
                  </Text>
                </Text>
              </View>
            </ScrollView>
          )}
        </Pressable>
      </TouchableOpacity>

      <BurnedInfoSheet
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        rowKeys={data?.rows.map((r) => r.key) ?? INFO_KEYS}
      />
    </Modal>
  );
};

const BurnedInfoSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  rowKeys: BreakdownRow['key'][];
}> = ({ visible, onClose, rowKeys }) => {
  const { t } = useTranslation(['home']);
  const insets = useSafeAreaInsets();
  const sheetPadding = Math.max(16, insets.bottom + 12);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: sheetPadding }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>
            {t('home:burnedInfoTitle', { defaultValue: 'How we calculate this' })}
          </Text>
          <ScrollView style={styles.infoScroll} showsVerticalScrollIndicator={false}>
            {rowKeys.map((k) => {
              const def = INFO_DEFAULTS[k];
              return (
                <View key={k} style={styles.infoBlock}>
                  <Text style={styles.infoTitle}>
                    {t(`home:burnedInfo_${k}_title`, { defaultValue: def.title })}
                  </Text>
                  <Text style={styles.infoBody}>
                    {t(`home:burnedInfo_${k}_body`, { defaultValue: def.body })}
                  </Text>
                </View>
              );
            })}
            <View style={styles.infoBlock}>
              <Text style={styles.infoTitle}>
                {t('home:burnedInfo_30dAvg_title', { defaultValue: '30-day average' })}
              </Text>
              <Text style={styles.infoBody}>
                {t('home:burnedInfo_30dAvg_body', {
                  defaultValue:
                    'Your typical daily movement over the last 30 days when a wearable is connected. On planned training days, the workout target reflects your plan’s estimated session burn (or your recent average if the plan has no estimate). On rest days, it is only what you have logged.',
                })}
              </Text>
            </View>
          </ScrollView>
        </Pressable>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 12,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: BrandColors.cardBorder,
    marginVertical: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.body,
    fontWeight: '600',
    color: BrandColors.textPrimary,
  },
  infoButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoButtonText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 13,
    fontWeight: '700',
    fontStyle: 'italic',
    color: BrandColors.textSecondary,
  },
  loadingText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textSecondary,
    paddingVertical: 24,
    textAlign: 'center',
  },
  mainScroll: {
    maxHeight: 460,
  },
  barsList: {
    marginTop: 4,
  },
  barsStack: {
    gap: 32,
  },
  barRow: {
    gap: 9,
  },
  barRowDimmed: {
    opacity: 0.72,
  },
  barLabelDimmed: {
    color: BrandColors.textTertiary,
  },
  barValueDimmed: {
    color: BrandColors.textTertiary,
  },
  barPlaceholder: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: BAR_HEIGHT / 2,
  },
  barHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  barLabelLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: 8,
  },
  barLabelTextWrap: {
    flex: 1,
  },
  barLabelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 6,
  },
  barSwatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
    marginTop: 5,
  },
  barLabel: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    fontWeight: '600',
    color: BrandColors.textPrimary,
  },
  barLabelSource: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    fontWeight: '400',
    color: BrandColors.textTertiary,
  },
  barLabelSuffix: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    fontWeight: '400',
    color: BrandColors.textTertiary,
    flexShrink: 0,
  },
  barValue: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    fontWeight: '600',
    color: BrandColors.textPrimary,
    textAlign: 'right',
  },
  barValueSecondary: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    fontWeight: '400',
    color: BrandColors.textTertiary,
  },
  barTrack: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    overflow: 'hidden',
    backgroundColor: '#0E1A1A',
    position: 'relative',
  },
  barGhost: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: BAR_HEIGHT / 2,
    opacity: 0.35,
  },
  barFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: BAR_HEIGHT / 2,
  },
  barTargetMarker: {
    position: 'absolute',
    top: -1,
    bottom: -1,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: 'rgba(242, 242, 238, 0.75)',
  },
  divider: {
    height: 1,
    backgroundColor: BrandColors.cardBorder,
    marginVertical: 10,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingBottom: 8,
  },
  totalLabel: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    fontWeight: '600',
    color: BrandColors.textPrimary,
  },
  totalValue: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.body,
    fontWeight: '700',
    color: BrandColors.textPrimary,
  },
  totalValueSecondary: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    fontWeight: '400',
    color: BrandColors.textTertiary,
  },
  infoScroll: {
    maxHeight: 460,
  },
  infoBlock: {
    paddingVertical: 10,
    gap: 4,
  },
  infoTitle: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    fontWeight: '600',
    color: BrandColors.textPrimary,
  },
  infoBody: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textSecondary,
    lineHeight: 18,
  },
});

export default CaloriesBurnedBreakdownModal;
