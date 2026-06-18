import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from 'react-i18next';
import {
    BodyPhotoUrls,
    WeightUnit,
    getWeekNumber,
    saveBodyCompositionLog,
} from '../lib/body-composition-storage';
import { uploadBodyPhoto, type BodyPhotoAngle } from '../lib/storage-upload';
import { normalizeDecimalInput } from '../lib/validation';
import { BodyPhotoCapture, type BodyPhotoValue } from './BodyPhotoCapture';
import { BrandDialog } from './BrandDialog';

interface WeeklyLogModalProps {
  visible: boolean;
  userId: string;
  initialWeightUnit: WeightUnit;
  onClose: () => void;
  onSave: () => void;
}

export const WeeklyLogModal: React.FC<WeeklyLogModalProps> = ({
  visible,
  userId,
  initialWeightUnit,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation(['bodylog', 'common']);
  const insets = useSafeAreaInsets();
  const [weight, setWeight] = useState('');
  const [musclePercent, setMusclePercent] = useState('');
  const [fatPercent, setFatPercent] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(initialWeightUnit);
  const [photos, setPhotos] = useState<BodyPhotoValue>({ front: null, side: null, back: null });
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<{ weight?: string; muscle?: string; fat?: string; photo?: string }>({});
  const [infoModal, setInfoModal] = useState<{ title: string; body: string } | null>(null);
  const [savedWeek, setSavedWeek] = useState<number | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (visible) {
      setWeight('');
      setMusclePercent('');
      setFatPercent('');
      setWeightUnit(initialWeightUnit);
      setPhotos({ front: null, side: null, back: null });
      setErrors({});
    }
  }, [visible, initialWeightUnit]);

  const validateInputs = (): boolean => {
    const newErrors: { weight?: string; muscle?: string; fat?: string; photo?: string } = {};

    const weightNum = parseFloat(weight);
    const muscleNum = parseFloat(musclePercent);
    const fatNum = parseFloat(fatPercent);

    // Weight validation
    if (!weight.trim()) {
      newErrors.weight = t('bodylog:errorWeightRequired');
    } else if (isNaN(weightNum) || weightNum <= 0) {
      newErrors.weight = t('bodylog:errorWeightInvalid');
    } else if (weightUnit === 'kg' && (weightNum < 20 || weightNum > 300)) {
      newErrors.weight = t('bodylog:errorWeightRangeKg');
    } else if (weightUnit === 'lbs' && (weightNum < 44 || weightNum > 660)) {
      newErrors.weight = t('bodylog:errorWeightRangeLbs');
    }

    // Muscle percent validation
    if (!musclePercent.trim()) {
      newErrors.muscle = t('bodylog:errorMuscleRequired');
    } else if (isNaN(muscleNum) || muscleNum < 0 || muscleNum > 100) {
      newErrors.muscle = t('bodylog:errorPercentRange');
    }

    // Fat percent validation
    if (!fatPercent.trim()) {
      newErrors.fat = t('bodylog:errorFatRequired');
    } else if (isNaN(fatNum) || fatNum < 0 || fatNum > 100) {
      newErrors.fat = t('bodylog:errorPercentRange');
    }

    // Combined validation
    if (!isNaN(muscleNum) && !isNaN(fatNum) && muscleNum + fatNum > 100) {
      newErrors.muscle = t('bodylog:errorCombined');
      newErrors.fat = t('bodylog:errorCombined');
    }

    // Photos are optional, but a front photo is required when any photo is added
    // (front is the angle the progress chart shows above each bar).
    if ((photos.side || photos.back) && !photos.front) {
      newErrors.photo = t('bodylog:errorFrontRequired');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateInputs()) {
      return;
    }

    try {
      setIsSaving(true);

      // Upload any picked photos first, keyed to this ISO week so each set maps
      // 1:1 to a chart bar. A failed upload doesn't block the numeric log.
      let photoUrls: BodyPhotoUrls | undefined;
      const picked = (['front', 'side', 'back'] as BodyPhotoAngle[]).filter((a) => !!photos[a]);
      if (picked.length > 0) {
        const now = new Date();
        const week = getWeekNumber(now);
        const year = now.getFullYear();
        const uploaded = await Promise.all(
          picked.map(async (angle) => {
            const url = await uploadBodyPhoto(userId, year, week, angle, photos[angle] as string);
            return [angle, url] as const;
          })
        );
        photoUrls = uploaded.reduce<BodyPhotoUrls>((acc, [angle, url]) => {
          if (url) acc[angle] = url;
          return acc;
        }, {});

        const failed = uploaded.filter(([, url]) => !url).map(([angle]) => angle);
        if (failed.length > 0) {
          Alert.alert(t('bodylog:photoUploadFailedTitle'), t('bodylog:photoUploadFailedBody'));
        }
      }

      const success = await saveBodyCompositionLog(
        userId,
        parseFloat(weight),
        weightUnit,
        parseFloat(musclePercent),
        parseFloat(fatPercent),
        photoUrls
      );

      if (success) {
        setSavedWeek(getWeekNumber(new Date()));
      } else {
        Alert.alert(
          t('bodylog:alertErrorTitle'),
          t('bodylog:alertErrorBody'),
          [{ text: t('common:ok') }]
        );
      }
    } catch (error) {
      Alert.alert(
        t('bodylog:alertErrorTitle'),
        t('bodylog:alertUnexpectedBody'),
        [{ text: t('common:ok') }]
      );
    } finally {
      setIsSaving(false);
    }
  };

  const toggleWeightUnit = () => {
    setWeightUnit(prev => prev === 'kg' ? 'lbs' : 'kg');
  };

  const showInfo = (titleKey: string, bodyKey: string) => {
    setInfoModal({ title: t(titleKey), body: t(bodyKey) });
  };

  const dismissSaved = () => {
    setSavedWeek(null);
    onSave();
    onClose();
  };

  const now = new Date();
  const weekNumber = getWeekNumber(now);
  const formattedDate = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalContainer} edges={['top', 'left', 'right']}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>{t('bodylog:cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{t('bodylog:title')}</Text>
          <TouchableOpacity
            onPress={handleSave}
            style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#F47C3C" />
            ) : (
              <Text style={styles.saveButtonText}>{t('bodylog:save')}</Text>
            )}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.keyboardAvoidingView}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={100}
        >
          <ScrollView
            style={styles.modalContent}
            contentContainerStyle={[styles.scrollContentContainer, Platform.OS === 'android' && { paddingBottom: Math.max(insets.bottom, 12) + 28 }]}
            keyboardShouldPersistTaps="never"
          >
            <View style={styles.weekBadge}>
              <Text style={styles.weekBadgeText}>{t('bodylog:weekBadge', { week: weekNumber, date: formattedDate })}</Text>
            </View>

            <Text style={styles.instructionText}>
              {t('bodylog:instruction')}
            </Text>

            {/* Weight Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('bodylog:fieldBodyWeight')}</Text>
              <View style={styles.weightInputRow}>
                <TextInput
                  style={[styles.input, styles.weightInput, errors.weight && styles.inputError]}
                  placeholder={weightUnit === 'kg' ? '75.0' : '165.0'}
                  placeholderTextColor="#C7C7CC"
                  keyboardType="decimal-pad"
                  value={weight}
                  onChangeText={(text) => {
                    setWeight(normalizeDecimalInput(text));
                    if (errors.weight) setErrors(prev => ({ ...prev, weight: undefined }));
                  }}
                />
                <TouchableOpacity
                  style={styles.unitToggle}
                  onPress={toggleWeightUnit}
                >
                  <Text style={[
                    styles.unitOption,
                    weightUnit === 'kg' && styles.unitOptionActive
                  ]}>kg</Text>
                  <Text style={styles.unitDivider}>|</Text>
                  <Text style={[
                    styles.unitOption,
                    weightUnit === 'lbs' && styles.unitOptionActive
                  ]}>lbs</Text>
                </TouchableOpacity>
              </View>
              {errors.weight && <Text style={styles.errorText}>{errors.weight}</Text>}
            </View>

            {/* Muscle Percent Input */}
            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.inputLabel}>{t('bodylog:fieldMuscle')}</Text>
                <TouchableOpacity
                  style={styles.infoButton}
                  onPress={() => showInfo('bodylog:muscleInfoTitle', 'bodylog:muscleInfoBody')}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('bodylog:muscleInfoTitle')}
                >
                  <Text style={styles.infoButtonText}>ⓘ</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.percentInputRow}>
                <TextInput
                  style={[styles.input, styles.percentInput, errors.muscle && styles.inputError]}
                  placeholder="35.0"
                  placeholderTextColor="#C7C7CC"
                  keyboardType="decimal-pad"
                  value={musclePercent}
                  onChangeText={(text) => {
                    setMusclePercent(normalizeDecimalInput(text));
                    if (errors.muscle) setErrors(prev => ({ ...prev, muscle: undefined }));
                  }}
                />
                <Text style={styles.percentSymbol}>%</Text>
              </View>
              {errors.muscle && <Text style={styles.errorText}>{errors.muscle}</Text>}
            </View>

            {/* Fat Percent Input */}
            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.inputLabel}>{t('bodylog:fieldFat')}</Text>
                <TouchableOpacity
                  style={styles.infoButton}
                  onPress={() => showInfo('bodylog:fatInfoTitle', 'bodylog:fatInfoBody')}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('bodylog:fatInfoTitle')}
                >
                  <Text style={styles.infoButtonText}>ⓘ</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.percentInputRow}>
                <TextInput
                  style={[styles.input, styles.percentInput, errors.fat && styles.inputError]}
                  placeholder="20.0"
                  placeholderTextColor="#C7C7CC"
                  keyboardType="decimal-pad"
                  value={fatPercent}
                  onChangeText={(text) => {
                    setFatPercent(normalizeDecimalInput(text));
                    if (errors.fat) setErrors(prev => ({ ...prev, fat: undefined }));
                  }}
                />
                <Text style={styles.percentSymbol}>%</Text>
              </View>
              {errors.fat && <Text style={styles.errorText}>{errors.fat}</Text>}
            </View>

            {/* Other Percent Preview */}
            {musclePercent && fatPercent && !errors.muscle && !errors.fat && (
              <View style={styles.previewContainer}>
                <Text style={styles.previewLabel}>{t('bodylog:fieldOther')}</Text>
                <Text style={styles.previewValue}>
                  {(100 - parseFloat(musclePercent || '0') - parseFloat(fatPercent || '0')).toFixed(1)}%
                </Text>
              </View>
            )}

            {/* Progress photos (optional, front recommended) */}
            <View style={styles.photoDivider} />
            <BodyPhotoCapture
              value={photos}
              onChange={(next) => {
                setPhotos(next);
                if (errors.photo) setErrors(prev => ({ ...prev, photo: undefined }));
              }}
              disabled={isSaving}
            />
            {errors.photo && <Text style={styles.errorText}>{errors.photo}</Text>}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Indicator info popup — brand-styled, paragraph-spaced for readability. */}
        <BrandDialog
          visible={infoModal !== null}
          title={infoModal?.title}
          message={infoModal?.body}
          buttons={[{ text: t('common:ok'), variant: 'primary', onPress: () => setInfoModal(null) }]}
          onRequestClose={() => setInfoModal(null)}
        />

        {/* Save success — brand-styled; advances to the progress charts on dismiss. */}
        <BrandDialog
          visible={savedWeek !== null}
          title={t('bodylog:alertSavedTitle')}
          message={t('bodylog:alertSavedBody', { week: savedWeek ?? 0 })}
          buttons={[{ text: t('bodylog:alertSavedButton'), variant: 'primary', onPress: dismissSaved }]}
          onRequestClose={dismissSaved}
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#0E1A1A',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  cancelButtonText: {
    fontSize: 17,
    color: '#9AA3A6',
    fontWeight: '400',
  },
  modalTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
    textAlign: 'center',
  },
  saveButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  saveButtonText: {
    fontSize: 17,
    color: '#F47C3C',
    fontWeight: '600',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  scrollContentContainer: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  weekBadge: {
    alignSelf: 'center',
    backgroundColor: '#F47C3C',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 10,
  },
  weekBadgeText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  instructionText: {
    fontSize: 13,
    color: '#9AA3A6',
    lineHeight: 18,
    marginBottom: 14,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoButton: {
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  infoButtonText: {
    fontSize: 14,
    color: 'rgba(242, 242, 238, 0.55)',
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 12,
    fontSize: 18,
    color: '#F2F2EE',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
  },
  inputError: {
    borderColor: '#C65B5B',
    borderWidth: 1,
  },
  weightInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  weightInput: {
    flex: 1,
  },
  unitToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1A1A',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
  },
  unitOption: {
    fontSize: 16,
    color: '#C7C7CC',
    fontWeight: '500',
  },
  unitOptionActive: {
    color: '#F47C3C',
    fontWeight: '700',
  },
  unitDivider: {
    color: '#E5E5EA',
    marginHorizontal: 8,
    fontSize: 16,
  },
  percentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  percentInput: {
    flex: 1,
  },
  percentSymbol: {
    fontSize: 18,
    color: '#9AA3A6',
    marginLeft: 12,
    fontWeight: '500',
  },
  errorText: {
    color: '#C65B5B',
    fontSize: 13,
    marginTop: 6,
  },
  photoDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#1E2A2C',
    marginBottom: 14,
  },
  previewContainer: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  previewLabel: {
    fontSize: 15,
    color: '#9AA3A6',
    fontWeight: '500',
  },
  previewValue: {
    fontSize: 18,
    color: '#F2F2EE',
    fontWeight: '700',
  },
});

