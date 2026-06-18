import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScreen } from './KeyboardAwareScreen';
import { createCustomExercise } from '../lib/custom-exercise-storage';
import {
  BODY_REGION_OPTIONS,
  BodyRegion,
  CustomExercise,
  EXERCISE_CATEGORY_OPTIONS,
  ExerciseCategory,
  getBodyRegionDisplayName,
  getExerciseCategoryDisplayName,
  getMovementTypeDisplayName,
  getMuscleGroupDisplayName,
  MOVEMENT_TYPE_OPTIONS,
  MovementType,
  MUSCLE_GROUPS_BY_BODY_REGION,
  MuscleGroup,
} from '../types/workout';

interface CustomExerciseModalProps {
  visible: boolean;
  userId: string;
  onClose: () => void;
  onCreated: (exercise: CustomExercise) => void;
}

export function CustomExerciseModal({
  visible,
  userId,
  onClose,
  onCreated,
}: CustomExerciseModalProps) {
  const { t } = useTranslation(['workout', 'common']);
  const [name, setName] = useState('');
  const [bodyRegion, setBodyRegion] = useState<BodyRegion>('upper');
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>('chest');
  const [movementType, setMovementType] = useState<MovementType>('compound');
  const [category, setCategory] = useState<ExerciseCategory>('strength');
  const [isSaving, setIsSaving] = useState(false);

  const muscleGroupOptions = useMemo(
    () => MUSCLE_GROUPS_BY_BODY_REGION[bodyRegion],
    [bodyRegion],
  );

  useEffect(() => {
    if (!visible) {
      setName('');
      setBodyRegion('upper');
      setMuscleGroup('chest');
      setMovementType('compound');
      setCategory('strength');
      setIsSaving(false);
      return;
    }

    if (!muscleGroupOptions.includes(muscleGroup)) {
      setMuscleGroup(muscleGroupOptions[0]);
    }
  }, [visible, muscleGroup, muscleGroupOptions]);

  const handleSave = async () => {
    if (!name.trim()) return;

    setIsSaving(true);
    const exercise = await createCustomExercise(userId, {
      name,
      bodyRegion,
      muscleGroup,
      movementType,
      category,
    });
    setIsSaving(false);

    if (!exercise) return;
    onCreated(exercise);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <KeyboardAwareScreen>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>{t('common:cancel', { defaultValue: 'Cancel' })}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('workout:addMyOwnExercise')}</Text>
          <TouchableOpacity
            onPress={handleSave}
            style={[styles.headerButton, (!name.trim() || isSaving) && styles.headerButtonDisabled]}
            disabled={!name.trim() || isSaving}
          >
            <Text style={styles.headerButtonText}>{t('common:save', { defaultValue: 'Save' })}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.field}>
            <Text style={styles.label}>{t('workout:customExerciseNameLabel')}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('workout:customExerciseNamePlaceholder')}
              placeholderTextColor="#8E8E93"
              style={styles.input}
              maxLength={60}
              autoFocus
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('workout:exerciseBodyRegionLabel')}</Text>
            <View style={styles.chips}>
              {BODY_REGION_OPTIONS.map(option => (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, bodyRegion === option && styles.chipActive]}
                  onPress={() => setBodyRegion(option)}
                >
                  <Text style={[styles.chipText, bodyRegion === option && styles.chipTextActive]}>
                    {getBodyRegionDisplayName(option)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('workout:exerciseMuscleGroupLabel')}</Text>
            <View style={styles.chips}>
              {muscleGroupOptions.map(option => (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, muscleGroup === option && styles.chipActive]}
                  onPress={() => setMuscleGroup(option)}
                >
                  <Text style={[styles.chipText, muscleGroup === option && styles.chipTextActive]}>
                    {getMuscleGroupDisplayName(option)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('workout:exerciseMovementTypeLabel')}</Text>
            <View style={styles.chips}>
              {MOVEMENT_TYPE_OPTIONS.map(option => (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, movementType === option && styles.chipActive]}
                  onPress={() => setMovementType(option)}
                >
                  <Text style={[styles.chipText, movementType === option && styles.chipTextActive]}>
                    {getMovementTypeDisplayName(option)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('workout:exerciseCategoryLabel', { defaultValue: 'Type' })}</Text>
            <View style={styles.chips}>
              {EXERCISE_CATEGORY_OPTIONS.map(option => (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, category === option && styles.chipActive]}
                  onPress={() => setCategory(option)}
                >
                  <Text style={[styles.chipText, category === option && styles.chipTextActive]}>
                    {getExerciseCategoryDisplayName(option)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
        </KeyboardAwareScreen>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1A1A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1D2F2F',
  },
  headerButton: {
    minWidth: 56,
  },
  headerButtonDisabled: {
    opacity: 0.4,
  },
  headerButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F47C3C',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: '#F2F2F7',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 20,
  },
  field: {
    gap: 10,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F2F2F7',
  },
  input: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: '#1D2F2F',
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#F2F2F7',
    borderWidth: 1,
    borderColor: '#2A4242',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: '#1D2F2F',
    borderWidth: 1,
    borderColor: '#2A4242',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: '#F47C3C',
    borderColor: '#F47C3C',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C5C9C7',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
});
