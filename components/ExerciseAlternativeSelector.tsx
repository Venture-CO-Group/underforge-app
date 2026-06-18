import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { findBuiltinExerciseById } from '../lib/exercise-catalog';
import { getLocalizedExerciseName } from '../lib/exercise-localization';
import { PlannedExercise, WorkoutDayOption } from '../types/workout';

interface ExerciseAlternativeSelectorProps {
  visible: boolean;
  workoutOption: WorkoutDayOption;
  onConfirm: (resolvedOption: WorkoutDayOption) => void;
  onClose: () => void;
  confirmLabel?: string;
}

export const ExerciseAlternativeSelector: React.FC<ExerciseAlternativeSelectorProps> = ({
  visible,
  workoutOption,
  onConfirm,
  onClose,
  confirmLabel,
}) => {
  const { t, i18n } = useTranslation(['workout', 'common']);
  const insets = useSafeAreaInsets();
  const exercisesWithAlternatives = workoutOption.exercises.filter(
    ex => ex.alternatives && ex.alternatives.length > 0
  );

  const [selections, setSelections] = useState<Record<string, 'primary' | number>>(() => {
    const initial: Record<string, 'primary' | number> = {};
    for (const ex of exercisesWithAlternatives) {
      initial[ex.exerciseId] = 'primary';
    }
    return initial;
  });

  const handleConfirm = () => {
    const resolvedExercises: PlannedExercise[] = workoutOption.exercises.map(ex => {
      if (!ex.alternatives || ex.alternatives.length === 0) return ex;

      const selection = selections[ex.exerciseId];
      if (selection === 'primary' || selection === undefined) {
        const { alternatives, ...rest } = ex;
        const catalog = findBuiltinExerciseById(ex.exerciseId);
        return {
          ...rest,
          name: getLocalizedExerciseName(catalog, ex.name, i18n.language),
        };
      }

      const alt = ex.alternatives[selection];
      if (!alt) {
        const { alternatives, ...rest } = ex;
        const catalog = findBuiltinExerciseById(ex.exerciseId);
        return {
          ...rest,
          name: getLocalizedExerciseName(catalog, ex.name, i18n.language),
        };
      }

      const altCatalog = findBuiltinExerciseById(alt.exerciseId);
      return {
        ...ex,
        exerciseId: alt.exerciseId,
        name: getLocalizedExerciseName(altCatalog, alt.name, i18n.language),
        alternatives: undefined,
      };
    });

    onConfirm({
      ...workoutOption,
      exercises: resolvedExercises,
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.container, { paddingBottom: Math.max(insets.bottom, 16) }]}
          onPress={e => e.stopPropagation()}
        >
          <View style={styles.header}>
            <View style={styles.handle} />
            <Text style={styles.title}>{t('workout:exerciseAltModalTitle')}</Text>
            <Text style={styles.subtitle}>
              {t('workout:exerciseAltModalSubtitle')}
            </Text>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {exercisesWithAlternatives.map(ex => {
              const selected = selections[ex.exerciseId];
              return (
                <View key={ex.exerciseId} style={styles.exerciseGroup}>
                  <TouchableOpacity
                    style={[styles.optionCard, selected === 'primary' && styles.optionCardSelected]}
                    onPress={() => setSelections(prev => ({ ...prev, [ex.exerciseId]: 'primary' }))}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.radio, selected === 'primary' && styles.radioSelected]}>
                      {selected === 'primary' && <View style={styles.radioInner} />}
                    </View>
                    <View style={styles.optionContent}>
                      <Text style={styles.optionName}>
                        {getLocalizedExerciseName(findBuiltinExerciseById(ex.exerciseId), ex.name, i18n.language)}
                      </Text>
                      <Text style={styles.optionDetail}>{ex.sets} × {ex.reps}</Text>
                    </View>
                  </TouchableOpacity>

                  <Text style={styles.orText}>{t('workout:exerciseAltOr')}</Text>

                  {ex.alternatives!.map((alt, altIndex) => (
                    <TouchableOpacity
                      key={alt.exerciseId}
                      style={[styles.optionCard, selected === altIndex && styles.optionCardSelected]}
                      onPress={() => setSelections(prev => ({ ...prev, [ex.exerciseId]: altIndex }))}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.radio, selected === altIndex && styles.radioSelected]}>
                        {selected === altIndex && <View style={styles.radioInner} />}
                      </View>
                      <View style={styles.optionContent}>
                        <Text style={styles.optionName}>
                          {getLocalizedExerciseName(findBuiltinExerciseById(alt.exerciseId), alt.name, i18n.language)}
                        </Text>
                        <Text style={styles.optionDetail}>{ex.sets} × {ex.reps}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm} activeOpacity={0.7}>
              <Text style={styles.confirmButtonText}>{confirmLabel ?? t('workout:exerciseAltStartWorkout')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>{t('common:cancel')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#0E1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  header: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A3638',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#4A5558',
    borderRadius: 2,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#9AA3A6',
    textAlign: 'center',
  },
  scrollView: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 24,
  },
  exerciseGroup: {
    gap: 8,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141E1E',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#2A3638',
  },
  optionCardSelected: {
    borderColor: '#F47C3C',
    backgroundColor: '#1A2424',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#4A5558',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  radioSelected: {
    borderColor: '#F47C3C',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F47C3C',
  },
  optionContent: {
    flex: 1,
  },
  optionName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 2,
  },
  optionDetail: {
    fontSize: 13,
    color: '#9AA3A6',
  },
  orText: {
    fontSize: 13,
    color: '#6B7578',
    textAlign: 'center',
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 8,
  },
  confirmButton: {
    backgroundColor: '#F47C3C',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 48,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9AA3A6',
  },
});

export default ExerciseAlternativeSelector;
