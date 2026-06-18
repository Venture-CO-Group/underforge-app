import React from 'react';
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
import { appIcons } from '../assets/icons';
import { ensureWorkoutExercisePrescription } from '../lib/exercise-harmonization';
import { ActionStep } from '../types/onboard';
import { PlannedExercise, WorkoutDayOption } from '../types/workout';
import { Icon } from './Icon';

interface WorkoutDaySelectorProps {
  visible: boolean;
  workoutOptions: WorkoutDayOption[];
  onSelect: (option: WorkoutDayOption) => void;
  onCustomWorkout?: () => void;
  onClose: () => void;
}

export const WorkoutDaySelector: React.FC<WorkoutDaySelectorProps> = ({
  visible,
  workoutOptions,
  onSelect,
  onCustomWorkout,
  onClose,
}) => {
  const { t } = useTranslation(['workout']);
  // Debug logging
  React.useEffect(() => {
    if (visible) {
      console.log('[WorkoutDaySelector] Modal opened with', workoutOptions.length, 'options');
      console.log('[WorkoutDaySelector] Full workoutOptions:', JSON.stringify(workoutOptions));
      workoutOptions.forEach((opt, i) => {
        console.log(`[WorkoutDaySelector] Option ${i}:`, {
          stepId: opt.stepId,
          dayName: opt.dayName,
          dayType: opt.dayType,
          exercisesCount: opt.exercises.length,
          daysOfWeek: opt.daysOfWeek,
        });
      });
    }
  }, [visible, workoutOptions]);

  const getWorkoutIcon = (dayName: string): string => {
    const lowerName = dayName.toLowerCase();
    if (lowerName.includes('leg') || lowerName.includes('lower')) return '🦵';
    if (lowerName.includes('upper') || lowerName.includes('push')) return '💪';
    if (lowerName.includes('back') || lowerName.includes('pull')) return '🔙';
    if (lowerName.includes('core') || lowerName.includes('abs')) return '🎯';
    if (lowerName.includes('cardio')) return '🏃';
    if (lowerName.includes('full')) return '🏋️';
    if (lowerName.includes('rest') || lowerName.includes('recovery')) return '😴';
    return '💪';
  };

  const getExerciseCount = (exercises: PlannedExercise[]): string => {
    const count = exercises?.length || 0;
    return count === 1
      ? t('workout:selectDayExerciseSingular', { count })
      : t('workout:selectDayExercisePlural', { count });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.container} onPress={e => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.handle} />
            <Text style={styles.title}>{t('workout:selectDayTitle')}</Text>
            <Text style={styles.subtitle}>
              {workoutOptions.length === 1
                ? t('workout:selectDaySubtitleOne')
                : t('workout:selectDaySubtitleMany', { count: workoutOptions.length })}
            </Text>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={workoutOptions.length > 3}
          >
            {onCustomWorkout && (
              <TouchableOpacity
                style={styles.differentTrainingCard}
                onPress={onCustomWorkout}
                activeOpacity={0.7}
              >
                <View style={styles.differentTrainingIcon}>
                  <Icon source={appIcons.chat} width={22} height={22} fill="#8B9FD4" />
                </View>
                <View style={styles.workoutCardContent}>
                  <Text style={styles.workoutCardTitle}>{t('workout:differentTrainingTitle')}</Text>
                  <Text style={styles.workoutCardSubtitle} numberOfLines={2}>
                    {t('workout:differentTrainingHint')}
                  </Text>
                </View>
                <View style={styles.workoutCardArrow}>
                  <Text style={styles.workoutCardArrowText}>›</Text>
                </View>
              </TouchableOpacity>
            )}

            {workoutOptions.length > 0 && onCustomWorkout && (
              <Text style={styles.planDaysLabel}>{t('workout:planWorkoutDaysLabel')}</Text>
            )}

            {workoutOptions.map((option, index) => (
              <TouchableOpacity
                key={`${option.stepId}-${index}`}
                style={styles.workoutCard}
                onPress={() => onSelect(option)}
                activeOpacity={0.7}
              >
                <View style={styles.workoutCardIcon}>
                  <Text style={styles.workoutCardEmoji}>{getWorkoutIcon(option.dayName)}</Text>
                </View>
                <View style={styles.workoutCardContent}>
                  <Text style={styles.workoutCardTitle}>{option.dayName}</Text>
                  <Text style={styles.workoutCardSubtitle}>
                    {option.exercises.length === 1
                      ? t('workout:selectDayExerciseSingular', { count: option.exercises.length })
                      : t('workout:selectDayExercisePlural', { count: option.exercises.length })}
                    {option.dayType && ` • ${option.dayType}`}
                  </Text>
                  {option.exercises.length > 0 && (
                    <Text style={styles.workoutCardExercises} numberOfLines={1}>
                      {option.exercises.slice(0, 3).map(e => e.name).join(', ')}
                      {option.exercises.length > 3 && '...'}
                    </Text>
                  )}
                </View>
                <View style={styles.workoutCardArrow}>
                  <Text style={styles.workoutCardArrowText}>›</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>{t('workout:selectDayCancel')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

/**
 * Extract workout options from user's action plan steps
 * Supports both new structured workouts and legacy workout steps
 */
function normalizeExercises(exercises: any[]): PlannedExercise[] {
  return exercises.map((ex) => ensureWorkoutExercisePrescription(ex));
}

export const extractWorkoutOptionsFromPlan = (steps: ActionStep[]): WorkoutDayOption[] => {
  const workoutOptions: WorkoutDayOption[] = [];

  for (const step of steps) {
    if (step.id !== 'step_1' && steps.indexOf(step) !== 0) continue;

    if (!step.step_details) continue;

    if (Array.isArray(step.step_details)) {
      step.step_details.forEach((details: any, index: number) => {
        if (details.dayName && details.dayType) {
          const exercises = details.exercises && Array.isArray(details.exercises) ? normalizeExercises(details.exercises) : [];
          workoutOptions.push({
            stepId: `${step.id}_${index}`,
            dayName: details.dayName,
            dayType: details.dayType,
            exercises,
            daysOfWeek: step.daysOfWeek,
            warmup: details.warmup || undefined,
            cooldown: details.cooldown || undefined,
          });
        }
      });
    }
    else if (typeof step.step_details === 'object') {
      const details = step.step_details as any;
      
      if (details.dayName && details.dayType) {
        const exercises = details.exercises && Array.isArray(details.exercises) ? normalizeExercises(details.exercises) : [];
        
        workoutOptions.push({
          stepId: step.id,
          dayName: details.dayName,
          dayType: details.dayType,
          exercises,
          daysOfWeek: step.daysOfWeek,
          warmup: details.warmup || undefined,
          cooldown: details.cooldown || undefined,
        });
      }
    }
  }

  return workoutOptions;
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
    paddingBottom: 34,
  },
  header: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#D1D1D6',
    borderRadius: 2,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#9AA3A6',
  },
  scrollView: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 12,
  },
  differentTrainingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(139, 159, 212, 0.4)',
  },
  differentTrainingIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(139, 159, 212, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  planDaysLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#F47C3C',
    letterSpacing: 1.2,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  workoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#2A3638',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  workoutCardIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#141E1E',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  workoutCardEmoji: {
    fontSize: 28,
  },
  workoutCardContent: {
    flex: 1,
    marginRight: 8,
  },
  workoutCardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 4,
  },
  workoutCardSubtitle: {
    fontSize: 14,
    color: '#9AA3A6',
    marginBottom: 4,
  },
  workoutCardExercises: {
    fontSize: 13,
    color: '#B0B0B0',
    fontStyle: 'italic',
  },
  workoutCardArrow: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  workoutCardArrowText: {
    fontSize: 28,
    color: '#F47C3C',
    fontWeight: '300',
    lineHeight: 32,
  },
  cancelButton: {
    marginHorizontal: 20,
    marginTop: 8,
    paddingVertical: 16,
    backgroundColor: '#141E1E',
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9AA3A6',
  },
});

export default WorkoutDaySelector;

