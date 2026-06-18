import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize } from '../constants/Typography';
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_TYPES,
  ActivityCategory,
  ActivityIntensity,
  ActivityLog,
  ActivityType,
  getActivityTypeById,
  INTENSITY_OPTIONS,
} from '../types/workout';
import { LogDateSelector } from './LogDateSelector';

const COACH_APPLAUDING_IMAGES: Record<string, any> = {
  Manu: require('../assets/images/coaches/emotions/1_manu_rodriguez_applauding.jpeg'),
  Dey: require('../assets/images/coaches/emotions/2_dey_schwarz_applauding.jpeg'),
  Alonso: require('../assets/images/coaches/emotions/3_alonso_prieto_applauding.jpeg'),
  Ruth: require('../assets/images/coaches/emotions/4_ruth_morais_applauding.jpeg'),
  Dana: require('../assets/images/coaches/emotions/5_dana_thompson_applauding.jpeg'),
  Jesús: require('../assets/images/coaches/emotions/6_jesus_guerrero_applauding.jpeg'),
};
const DEFAULT_SUCCESS_IMAGE = require('../assets/images/workout_logged.png');

export type ActivityLogPrefill = {
  activityType?: string;
  activityName?: string;
  durationMinutes?: number;
  intensity?: string;
  distanceValue?: number;
  distanceUnit?: string;
  elevationGain?: number;
  notes?: string;
  activityDate?: string;
} | null;

interface ActivityLogModalProps {
  visible: boolean;
  userId: string;
  onClose: () => void;
  /**
   * Persist the activity. Should return the created row (with `id` and possibly
   * `supabaseId`) so the success overlay can offer a "Share in UnderForge
   * Social" CTA wired to the right ids. Older callsites that return void are
   * still supported — the share CTA simply renders disabled in that case.
   */
  onSave: (
    log: Omit<ActivityLog, 'id' | 'supabaseId' | 'synced' | 'createdAt' | 'updatedAt'>,
  ) => void | Promise<void> | Promise<ActivityLog | null>;
  prefill?: ActivityLogPrefill;
  /** Runs after the user dismisses the success overlay (Keep it up flow). */
  onAfterActivityLogged?: () => void;
  /**
   * Called when the user taps "Share in UnderForge Social" on the success
   * overlay. Receives the ids of the just-created activity plus the display
   * title (activity name) so the parent can switch to the Social tab and
   * open the share composer.
   */
  onShareActivity?: (payload: {
    localActivityLogId: number;
    supabaseActivityLogId: number | null;
    displayTitle: string;
  }) => void | Promise<void>;
  /** Coach name used to pick the celebratory image on the success overlay. */
  coachName?: string;
}

function formatYMD(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toTitleCase(str: string): string {
  return str.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

export const ActivityLogModal: React.FC<ActivityLogModalProps> = ({
  visible,
  userId,
  onClose,
  onSave,
  prefill,
  onAfterActivityLogged,
  onShareActivity,
  coachName,
}) => {
  const { t } = useTranslation(['activity', 'social', 'workout']);
  const insets = useSafeAreaInsets();

  const getActivityLabel = (id: string) => {
    const key = `type${toTitleCase(id)}` as const;
    return t(`activity:${key}`, { defaultValue: id });
  };

  const getCategoryLabel = (id: string) => {
    const key = `cat${toTitleCase(id)}` as const;
    return t(`activity:${key}`, { defaultValue: id });
  };

  const getIntensityLabel = (value: string) => {
    const key = `intensity${toTitleCase(value)}` as const;
    return t(`activity:${key}`, { defaultValue: value });
  };
  const [selectedActivity, setSelectedActivity] = useState<ActivityType | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<ActivityCategory>>(new Set());
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('30');
  const [intensity, setIntensity] = useState<ActivityIntensity>('moderate');
  const [distance, setDistance] = useState('');
  const [distanceUnit, setDistanceUnit] = useState<'km' | 'mi'>('km');
  const [elevation, setElevation] = useState('');
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [activityDate, setActivityDate] = useState(formatYMD(new Date()));
  const [customActivityName, setCustomActivityName] = useState('');
  const savingRef = useRef(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [createdActivity, setCreatedActivity] = useState<ActivityLog | null>(null);

  const successImage = useMemo(() => {
    if (!coachName) return DEFAULT_SUCCESS_IMAGE;
    return COACH_APPLAUDING_IMAGES[coachName] || DEFAULT_SUCCESS_IMAGE;
  }, [coachName]);

  useEffect(() => {
    if (!visible) {
      savingRef.current = false;
      setShowSuccessOverlay(false);
      setCreatedActivity(null);
      resetForm();
      return;
    }
    if (!prefill) {
      resetForm();
      return;
    }

    const actType = prefill.activityType ? getActivityTypeById(prefill.activityType) : null;
    if (actType) {
      setSelectedActivity(actType);
      setDistanceUnit(actType.defaultUnit);
      setExpandedCategories(new Set([actType.category]));
    }
    if (prefill.durationMinutes != null && prefill.durationMinutes > 0) {
      setHours(Math.floor(prefill.durationMinutes / 60).toString());
      setMinutes((prefill.durationMinutes % 60).toString());
    }
    if (prefill.intensity && ['easy', 'moderate', 'hard', 'max'].includes(prefill.intensity)) {
      setIntensity(prefill.intensity as ActivityIntensity);
    }
    if (prefill.distanceValue != null) {
      setDistance(prefill.distanceValue.toString());
    }
    if (prefill.distanceUnit === 'km' || prefill.distanceUnit === 'mi') {
      setDistanceUnit(prefill.distanceUnit);
    }
    if (prefill.activityType === 'custom' && prefill.activityName) {
      setCustomActivityName(prefill.activityName);
    }
    if (prefill.elevationGain != null && !Number.isNaN(Number(prefill.elevationGain))) {
      setElevation(String(prefill.elevationGain));
    }
    if (prefill.notes) {
      setNotes(prefill.notes);
      setShowNotes(true);
    }
    if (prefill.activityDate) {
      setActivityDate(prefill.activityDate);
    }
  }, [visible, prefill]);

  const resetForm = () => {
    setSelectedActivity(null);
    setSearchQuery('');
    setExpandedCategories(new Set());
    setHours('0');
    setMinutes('30');
    setIntensity('moderate');
    setDistance('');
    setDistanceUnit('km');
    setElevation('');
    setNotes('');
    setShowNotes(false);
    setActivityDate(formatYMD(new Date()));
    setCustomActivityName('');
  };

  const filteredActivities = useMemo(() => {
    if (!searchQuery.trim()) return ACTIVITY_TYPES;
    const q = searchQuery.toLowerCase();
    return ACTIVITY_TYPES.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.category.replace(/_/g, ' ').includes(q)
    );
  }, [searchQuery]);

  const groupedActivities = useMemo(() => {
    const groups: Record<ActivityCategory, ActivityType[]> = {} as any;
    for (const cat of ACTIVITY_CATEGORIES) {
      const items = filteredActivities.filter(a => a.category === cat.id);
      if (items.length > 0) groups[cat.id] = items;
    }
    return groups;
  }, [filteredActivities]);

  const toggleCategory = useCallback((cat: ActivityCategory) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const handleSelectActivity = useCallback((activity: ActivityType) => {
    setSelectedActivity(activity);
    setDistanceUnit(activity.defaultUnit);
    Keyboard.dismiss();
  }, []);

  const totalMinutes = (parseInt(hours) || 0) * 60 + (parseInt(minutes) || 0);

  const handleLog = async () => {
    if (savingRef.current) return;
    if (!selectedActivity) {
      Alert.alert(t('activity:alertSelectTitle'), t('activity:alertSelectBody'));
      return;
    }
    if (totalMinutes === 0) {
      Alert.alert(t('activity:alertDurationTitle'), t('activity:alertDurationBody'));
      return;
    }
    if (selectedActivity.id === 'custom' && !customActivityName.trim()) {
      Alert.alert(t('activity:alertNameTitle'), t('activity:alertNameBody'));
      return;
    }

    savingRef.current = true;

    const log: Omit<ActivityLog, 'id' | 'supabaseId' | 'synced' | 'createdAt' | 'updatedAt'> = {
      userId,
      activityDate,
      activityType: selectedActivity.id,
      activityName: selectedActivity.id === 'custom' ? customActivityName.trim() : selectedActivity.name,
      durationMinutes: totalMinutes,
      intensity,
    };

    if (selectedActivity.hasDistance && distance) {
      log.distanceValue = parseFloat(distance);
      log.distanceUnit = distanceUnit;
    }
    if (selectedActivity.hasElevation && elevation) {
      log.elevationGain = parseFloat(elevation);
    }
    if (notes.trim()) log.notes = notes.trim();

    try {
      const result = await Promise.resolve(onSave(log));
      // onSave may return the created ActivityLog, void, or null; only the
      // first lets us drive a Share CTA. The success overlay still shows in
      // every case so the user gets positive feedback.
      const created = result && typeof result === 'object' && 'id' in result
        ? (result as ActivityLog)
        : null;
      setCreatedActivity(created);
      setShowSuccessOverlay(true);
    } catch {
      // Parent onSave may surface its own error UI
    } finally {
      savingRef.current = false;
    }
  };

  const handleSuccessKeepGoing = () => {
    setShowSuccessOverlay(false);
    setCreatedActivity(null);
    onAfterActivityLogged?.();
    onClose();
  };

  const handleSuccessShare = () => {
    if (!createdActivity?.id) {
      handleSuccessKeepGoing();
      return;
    }
    const payload = {
      localActivityLogId: createdActivity.id,
      supabaseActivityLogId: createdActivity.supabaseId ?? null,
      displayTitle: createdActivity.activityName,
    };
    setShowSuccessOverlay(false);
    setCreatedActivity(null);
    onClose();
    onShareActivity?.(payload);
  };

  const adjustDuration = (field: 'hours' | 'minutes', delta: number) => {
    if (field === 'hours') {
      const v = Math.max(0, Math.min(23, (parseInt(hours) || 0) + delta));
      setHours(v.toString());
    } else {
      let v = (parseInt(minutes) || 0) + delta;
      if (v < 0) v = 55;
      if (v >= 60) v = 0;
      setMinutes(v.toString());
    }
  };

  const renderInlineLogForm = () => {
    if (!selectedActivity) return null;

    return (
      <View style={styles.inlineForm}>
        {selectedActivity.id === 'custom' && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t('activity:fieldActivityName')}</Text>
            <TextInput
              style={styles.textFieldInput}
              placeholder={t('activity:activityNamePlaceholder')}
              placeholderTextColor={BrandColors.textTertiary}
              value={customActivityName}
              onChangeText={setCustomActivityName}
            />
          </View>
        )}

        <LogDateSelector
          selectedDate={activityDate}
          onDateChange={setActivityDate}
        />

        {/* Duration */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{t('activity:fieldDuration')}</Text>
          <View style={styles.durationRow}>
            <View style={styles.durationGroup}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => adjustDuration('hours', -1)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.stepperText}>−</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.durationInput}
                value={hours}
                onChangeText={setHours}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
              />
              <Text style={styles.durationUnit}>{t('activity:durationHour')}</Text>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => adjustDuration('hours', 1)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.stepperText}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.durationSep}>:</Text>

            <View style={styles.durationGroup}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => adjustDuration('minutes', -5)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.stepperText}>−</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.durationInput}
                value={minutes}
                onChangeText={setMinutes}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
              />
              <Text style={styles.durationUnit}>{t('activity:durationMin')}</Text>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => adjustDuration('minutes', 5)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.stepperText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Intensity */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{t('activity:fieldIntensity')}</Text>
          <View style={styles.intensityRow}>
            {INTENSITY_OPTIONS.map(opt => {
              const isActive = intensity === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.intensitySegment,
                    isActive && { backgroundColor: opt.color },
                  ]}
                  onPress={() => setIntensity(opt.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.intensityText, isActive && styles.intensityTextActive]}>
                    {getIntensityLabel(opt.value)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Distance (conditional) */}
        {selectedActivity.hasDistance && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t('activity:fieldDistance')}</Text>
            <View style={styles.distanceRow}>
              <TextInput
                style={styles.distanceInput}
                placeholder="0.0"
                placeholderTextColor={BrandColors.textTertiary}
                value={distance}
                onChangeText={setDistance}
                keyboardType="decimal-pad"
              />
              <View style={styles.unitToggle}>
                <TouchableOpacity
                  style={[styles.unitBtn, distanceUnit === 'km' && styles.unitBtnActive]}
                  onPress={() => setDistanceUnit('km')}
                >
                  <Text style={[styles.unitText, distanceUnit === 'km' && styles.unitTextActive]}>km</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unitBtn, distanceUnit === 'mi' && styles.unitBtnActive]}
                  onPress={() => setDistanceUnit('mi')}
                >
                  <Text style={[styles.unitText, distanceUnit === 'mi' && styles.unitTextActive]}>mi</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Elevation (conditional) */}
        {selectedActivity.hasElevation && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t('activity:fieldElevation')}</Text>
            <View style={styles.distanceRow}>
              <TextInput
                style={styles.distanceInput}
                placeholder="0"
                placeholderTextColor={BrandColors.textTertiary}
                value={elevation}
                onChangeText={setElevation}
                keyboardType="number-pad"
              />
              <Text style={styles.unitLabel}>m</Text>
            </View>
          </View>
        )}

        {/* Notes */}
        {!showNotes ? (
          <TouchableOpacity style={styles.addNotesBtn} onPress={() => setShowNotes(true)}>
            <Text style={styles.addNotesText}>{t('activity:addNotes')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t('activity:fieldNotes')}</Text>
            <TextInput
              style={styles.notesInput}
              placeholder={t('activity:notesPlaceholder')}
              placeholderTextColor={BrandColors.textTertiary}
              value={notes}
              onChangeText={setNotes}
              multiline={false}
              returnKeyType="done"
            />
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.overlayTouch} onPress={onClose} />
        <View style={styles.container}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.headerBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.headerBtnText}>{t('activity:cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{t('activity:title')}</Text>
            <View style={styles.headerBtn} />
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="never"
          >
            <View style={styles.section}>
              {!selectedActivity && (
                <View style={styles.searchContainer}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder={t('activity:searchPlaceholder')}
                    placeholderTextColor={BrandColors.textTertiary}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    returnKeyType="search"
                    autoCorrect={false}
                  />
                </View>
              )}

              {ACTIVITY_CATEGORIES.map(cat => {
                const items = groupedActivities[cat.id];
                if (!items) return null;

                const categoryHasSelected = selectedActivity && items.some(a => a.id === selectedActivity.id);
                // When an activity is selected, hide categories that don't contain it
                if (selectedActivity && !categoryHasSelected) return null;

                const isExpanded = categoryHasSelected || expandedCategories.has(cat.id) || searchQuery.trim().length > 0;

                return (
                  <View key={cat.id} style={styles.categorySection}>
                    <TouchableOpacity
                      style={[styles.categoryHeader, categoryHasSelected && styles.categoryHeaderActive]}
                      onPress={() => {
                        if (categoryHasSelected) {
                          setSelectedActivity(null);
                        } else {
                          toggleCategory(cat.id);
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.categoryIcon}>{cat.icon}</Text>
                      <Text style={[styles.categoryLabel, categoryHasSelected && styles.categoryLabelActive]}>
                        {getCategoryLabel(cat.id)}
                      </Text>
                      {!selectedActivity && (
                        <>
                          <Text style={styles.categoryCount}>{items.length}</Text>
                          <Text style={styles.chevron}>{isExpanded ? '▾' : '▸'}</Text>
                        </>
                      )}
                      {categoryHasSelected && (
                        <Text style={styles.changeBadgeText}>{t('activity:change')}</Text>
                      )}
                    </TouchableOpacity>

                    {isExpanded && (
                      <View style={styles.chipGrid}>
                        {items.map(activity => {
                          const isSelected = selectedActivity?.id === activity.id;
                          return (
                            <TouchableOpacity
                              key={activity.id}
                              style={[styles.chip, isSelected && styles.chipSelected]}
                              onPress={() => handleSelectActivity(activity)}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.chipIcon}>{activity.icon}</Text>
                              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]} numberOfLines={1}>
                                {getActivityLabel(activity.id)}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}

                    {categoryHasSelected && renderInlineLogForm()}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {selectedActivity && (
            <View style={[styles.footer, Platform.OS === 'android' && { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
              <TouchableOpacity
                style={[styles.logButton, totalMinutes === 0 && styles.logButtonDisabled]}
                onPress={handleLog}
                activeOpacity={0.7}
              >
                <Text style={styles.logButtonText}>{t('activity:logButton')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {showSuccessOverlay && (
            <View style={[StyleSheet.absoluteFill, styles.successOverlay]}>
              <View style={styles.successModal}>
                <Image
                  source={successImage}
                  style={styles.successImage}
                  resizeMode="cover"
                />
                <View style={styles.successContent}>
                  <Text style={styles.successTitle}>{t('activity:successTitle')}</Text>
                  <Text style={styles.successMessage}>{t('activity:successMessage')}</Text>
                  <TouchableOpacity
                    style={[
                      styles.successButton,
                      !createdActivity?.id && styles.successButtonDisabled,
                    ]}
                    onPress={handleSuccessShare}
                    disabled={!createdActivity?.id}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.successButtonText}>{t('social:shareInUnderForge')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.successSecondaryButton}
                    onPress={handleSuccessKeepGoing}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.successSecondaryButtonText}>{t('workout:keepItUp')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlayTouch: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  container: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '85%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#2A4242',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BrandColors.divider,
  },
  headerBtn: {
    minWidth: 60,
  },
  headerBtnText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.body,
    color: BrandColors.accent,
  },
  headerTitle: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.subheadline,
    color: BrandColors.textPrimary,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingBottom: 24,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  searchContainer: {
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: BrandColors.backgroundTertiary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
    borderWidth: 1,
    borderColor: BrandColors.inputBorder,
    minHeight: 44,
  },
  categorySection: {
    marginBottom: 6,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  categoryHeaderActive: {
    backgroundColor: 'rgba(244, 124, 60, 0.08)',
  },
  categoryIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  categoryLabel: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textPrimary,
    flex: 1,
  },
  categoryLabelActive: {
    color: BrandColors.accent,
  },
  categoryCount: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    marginRight: 6,
  },
  chevron: {
    fontSize: 12,
    color: BrandColors.textTertiary,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 4,
    gap: 8,
    marginBottom: 8,
    marginTop: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BrandColors.backgroundTertiary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    minHeight: 44,
  },
  chipSelected: {
    backgroundColor: BrandColors.accent,
    borderColor: BrandColors.accent,
  },
  chipIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  chipText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.meta,
    color: BrandColors.textPrimary,
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },

  // Inline log form (appears below selected activity chip)
  inlineForm: {
    paddingTop: 16,
    gap: 16,
  },
  changeBadgeText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.meta,
    color: BrandColors.accent,
  },
  fieldRow: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.meta,
    color: BrandColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textFieldInput: {
    backgroundColor: BrandColors.backgroundTertiary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
    borderWidth: 1,
    borderColor: BrandColors.inputBorder,
    minHeight: 44,
  },

  // Duration
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  durationGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BrandColors.backgroundTertiary,
    borderRadius: 12,
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 2,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: BrandColors.backgroundSecondary,
  },
  stepperText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 20,
    color: BrandColors.accent,
  },
  durationInput: {
    width: 44,
    textAlign: 'center',
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.subheadline,
    color: BrandColors.textPrimary,
    minHeight: 44,
  },
  durationUnit: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.meta,
    color: BrandColors.textTertiary,
    marginRight: 2,
  },
  durationSep: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.subheadline,
    color: BrandColors.textTertiary,
    marginHorizontal: 4,
  },

  // Intensity
  intensityRow: {
    flexDirection: 'row',
    backgroundColor: BrandColors.backgroundTertiary,
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  intensitySegment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    minHeight: 44,
  },
  intensityText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.meta,
    color: BrandColors.textSecondary,
  },
  intensityTextActive: {
    color: '#FFFFFF',
    fontFamily: FontFamily.bodySemiBold,
  },

  // Distance
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  distanceInput: {
    flex: 1,
    backgroundColor: BrandColors.backgroundTertiary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
    borderWidth: 1,
    borderColor: BrandColors.inputBorder,
    minHeight: 44,
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: BrandColors.backgroundTertiary,
    borderRadius: 10,
    padding: 3,
  },
  unitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  unitBtnActive: {
    backgroundColor: BrandColors.accent,
  },
  unitText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.meta,
    color: BrandColors.textSecondary,
  },
  unitTextActive: {
    color: '#FFFFFF',
  },
  unitLabel: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.body,
    color: BrandColors.textSecondary,
  },

  // Notes
  addNotesBtn: {
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  addNotesText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    color: BrandColors.accent,
  },
  notesInput: {
    backgroundColor: BrandColors.backgroundTertiary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
    borderWidth: 1,
    borderColor: BrandColors.inputBorder,
    minHeight: 44,
  },

  // Footer
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 34,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BrandColors.divider,
  },
  logButton: {
    backgroundColor: BrandColors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 54,
    justifyContent: 'center',
  },
  logButtonDisabled: {
    opacity: 0.5,
  },
  logButtonText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: '#FFFFFF',
  },

  // Success Overlay (mirrors WorkoutLogModal's success modal)
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  successModal: {
    backgroundColor: '#0E1A1A',
    borderRadius: 24,
    width: '100%',
    maxWidth: 360,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2A3638',
    shadowColor: '#F47C3C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  successImage: {
    width: '100%',
    height: 220,
  },
  successContent: {
    padding: 24,
    alignItems: 'center',
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F2F2EE',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  successMessage: {
    fontSize: 16,
    color: '#9AA3A6',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
  },
  successButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 14,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  successButtonDisabled: {
    opacity: 0.4,
  },
  successButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  successSecondaryButton: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  successSecondaryButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6F7A7E',
    letterSpacing: 0.2,
  },
});
