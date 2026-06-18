import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize, LineHeight } from '../constants/Typography';
import { WorkoutDayOption } from '../types/workout';

interface WorkoutSummaryCardProps {
  workout: WorkoutDayOption;
  onLogWorkout: (workout: WorkoutDayOption) => void;
  onSaveToPlan?: (workout: WorkoutDayOption) => void;
  isProposal?: boolean;
  /** When the workout already belongs to the user's plan, hide the "Save to plan" action. */
  alreadyInPlan?: boolean;
}

export const WorkoutSummaryCard: React.FC<WorkoutSummaryCardProps> = ({
  workout,
  onLogWorkout,
  onSaveToPlan,
  isProposal = false,
  alreadyInPlan = false,
}) => {
  const { t } = useTranslation(['workout']);
  const totalSets = workout.exercises.reduce((sum, ex) => sum + ex.sets, 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.icon}>🏋️</Text>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{workout.dayName}</Text>
          <Text style={styles.subtitle}>
            {t('workout:workoutSummaryExercisesSets', {
              count: workout.exercises.length,
              sets: totalSets,
            })}
          </Text>
        </View>
      </View>

      <View style={styles.exerciseList}>
        {workout.exercises.map((ex, i) => (
          <View key={`${ex.name}_${i}`}>
            <View style={styles.exerciseRow}>
              <Text style={styles.exerciseName} numberOfLines={1}>{ex.name}</Text>
              <Text style={styles.exerciseDetail}>
                {ex.sets} × {ex.reps}
              </Text>
            </View>
            {ex.alternatives && ex.alternatives.length > 0 && (
              <View style={styles.alternativeRow}>
                <Text style={styles.alternativeText} numberOfLines={1}>
                  {t('workout:workoutSummaryOrAlt', { name: ex.alternatives[0].name })}
                </Text>
              </View>
            )}
          </View>
        ))}
      </View>

      {(workout.warmup || workout.cooldown) && (
        <View style={styles.extras}>
          {workout.warmup && (
            <Text style={styles.extraText} numberOfLines={1}>{t('workout:workoutSummaryWarmupLine', { text: workout.warmup })}</Text>
          )}
          {workout.cooldown && (
            <Text style={styles.extraText} numberOfLines={1}>{t('workout:workoutSummaryCooldownLine', { text: workout.cooldown })}</Text>
          )}
        </View>
      )}

      <TouchableOpacity
        style={styles.logButton}
        onPress={() => onLogWorkout(workout)}
        activeOpacity={0.7}
      >
        <Text style={styles.logButtonText}>
          {isProposal ? t('workout:startLoggingWorkoutFromProposal') : t('workout:logWorkout')}
        </Text>
      </TouchableOpacity>

      {onSaveToPlan && !alreadyInPlan && (
        <TouchableOpacity
          style={styles.saveToPlanButton}
          onPress={() => onSaveToPlan(workout)}
          activeOpacity={0.7}
        >
          <Text style={styles.saveToPlanButtonText}>{t('workout:addWorkoutToPlan')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: BrandColors.backgroundTertiary,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  icon: {
    fontSize: 24,
    marginRight: 10,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    color: BrandColors.textPrimary,
  },
  subtitle: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.meta,
    lineHeight: LineHeight.meta,
    color: BrandColors.textTertiary,
    marginTop: 1,
  },
  exerciseList: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  exerciseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  exerciseName: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    lineHeight: LineHeight.bodySmall,
    color: BrandColors.textPrimary,
    flex: 1,
    marginRight: 12,
  },
  exerciseDetail: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.meta,
    lineHeight: LineHeight.meta,
    color: BrandColors.textSecondary,
  },
  alternativeRow: {
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  alternativeText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    fontStyle: 'italic',
  },
  extras: {
    marginTop: 10,
    paddingHorizontal: 4,
    gap: 2,
  },
  extraText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
  },
  logButton: {
    backgroundColor: BrandColors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  logButtonText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: '#FFFFFF',
  },
  saveToPlanButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BrandColors.accent,
  },
  saveToPlanButtonText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.accent,
  },
});
