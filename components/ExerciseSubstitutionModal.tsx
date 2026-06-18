import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Body, { ExtendedBodyPart } from 'react-native-body-highlighter';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BUILTIN_EXERCISES, findBuiltinExerciseById } from '../lib/exercise-catalog';
import {
  exerciseMatchesPickerCategory,
  exerciseMatchesSearchQuery,
  type ExercisePickerCategory,
} from '../lib/exercise-search';
import {
  getLocalizedExerciseName,
  getLocalizedExerciseVideoUrl,
} from '../lib/exercise-localization';
import { activationForExercise, MUSCLE_GROUP_TO_SLUGS } from '../lib/muscle-activation';
import { appIcons } from '../assets/icons';
import { listExercisesForUser } from '../lib/custom-exercise-storage';
import {
  Exercise,
  getMovementTypeDisplayName,
  getMuscleGroupDisplayName,
  MUSCLE_GROUPS_BY_BODY_REGION,
  MuscleGroup,
} from '../types/workout';
import { CustomExerciseModal } from './CustomExerciseModal';
import { Icon } from './Icon';
import { KeyboardAwareScreen } from './KeyboardAwareScreen';

const screenWidth = Dimensions.get('window').width;
// Tiny body in each filter chip; ~80px tall (library figure is ~400px tall at scale 1).
const MUSCLE_CHIP_SCALE = Math.min((screenWidth * 0.2) / 220, 0.22);

/** Muscle-group filter chips, ordered upper → core → lower. */
const MUSCLE_CHIP_GROUPS: MuscleGroup[] = [
  ...MUSCLE_GROUPS_BY_BODY_REGION.upper,
  ...MUSCLE_GROUPS_BY_BODY_REGION.core,
  ...MUSCLE_GROUPS_BY_BODY_REGION.lower,
];

/** Body side that best displays each group on the mini-map chip. */
const MUSCLE_CHIP_SIDE: Record<MuscleGroup, 'front' | 'back'> = {
  chest: 'front', shoulders: 'front', arms: 'front', abs: 'front', obliques: 'front',
  legs: 'front', quads: 'front', adductors: 'front',
  back: 'back', hamstrings: 'back', glutes: 'back', calves: 'back',
};

/**
 * True when an exercise belongs to / meaningfully works a muscle group. Broad groups (`legs`)
 * match many exercises (their slugs cover most of the leg); isolated groups (`calves`) match few.
 */
function exerciseWorksMuscleGroup(exercise: Exercise, group: MuscleGroup): boolean {
  if (exercise.muscleGroup === group) return true;
  const slugs = MUSCLE_GROUP_TO_SLUGS[group] ?? [];
  return activationForExercise(exercise).some((a) => a.level >= 2 && slugs.includes(a.slug));
}

interface ExerciseSubstitutionModalProps {
  visible: boolean;
  userId: string;
  currentExercise: {
    id: string;
    name: string;
  } | null; // null when adding a new exercise
  onSelect: (exercise: Exercise) => void;
  onClose: () => void;
  gender?: 'male' | 'female';
}

export const ExerciseSubstitutionModal: React.FC<ExerciseSubstitutionModalProps> = ({
  visible,
  userId,
  currentExercise,
  onSelect,
  onClose,
  gender = 'female',
}) => {
  const { t, i18n } = useTranslation(['workout', 'common', 'bodymap', 'progress']);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryPicker, setCategoryPicker] = useState<ExercisePickerCategory>('all');
  // Visual muscle filter: a horizontal strip of mini muscle-maps, one per muscle group.
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroup | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCustomExerciseModal, setShowCustomExerciseModal] = useState(false);

  React.useEffect(() => {
    if (!visible) return;
    setCategoryPicker('all');

    let cancelled = false;
    const loadExercises = async () => {
      setIsLoading(true);
      const combinedExercises = await listExercisesForUser(userId, BUILTIN_EXERCISES);
      if (!cancelled) {
        setExercises(combinedExercises);
        setIsLoading(false);
      }
    };

    loadExercises();
    return () => {
      cancelled = true;
    };
  }, [visible, userId]);

  // Filter exercises based on search and body region
  const filteredExercises = useMemo(() => {
    let filtered = [...exercises];

    filtered = filtered.filter((e) => exerciseMatchesPickerCategory(e, categoryPicker));

    if (selectedMuscleGroup) {
      filtered = filtered.filter(e => exerciseWorksMuscleGroup(e, selectedMuscleGroup));
    }

    if (searchQuery.trim()) {
      filtered = filtered.filter((e) =>
        exerciseMatchesSearchQuery(e, searchQuery, i18n.language),
      );
    }

    // Sort exercises: recommended substitutions first, then others
    if (currentExercise) {
      const currentExDetails = exercises.find(e => e.id === currentExercise.id);
      const recommended = currentExDetails?.substitutionsRecommended || [];
      
      filtered = filtered.sort((a, b) => {
        const aIsRecommended = recommended.includes(a.id);
        const bIsRecommended = recommended.includes(b.id);
        
        if (aIsRecommended && !bIsRecommended) return -1;
        if (!aIsRecommended && bIsRecommended) return 1;

        return getLocalizedExerciseName(a, a.name, i18n.language).localeCompare(
          getLocalizedExerciseName(b, b.name, i18n.language),
          undefined,
          { sensitivity: 'base' },
        );
      });
    }

    return filtered;
  }, [searchQuery, selectedMuscleGroup, categoryPicker, exercises, currentExercise, i18n.language]);

  // Group exercises by muscle group, with recommended section at top
  const groupedExercises = useMemo(() => {
    if (!currentExercise) {
      // No current exercise - just group by muscle normally
      const groups: { [key: string]: Exercise[] } = {};
      filteredExercises.forEach(exercise => {
        const group = exercise.muscleGroup;
        if (!groups[group]) {
          groups[group] = [];
        }
        groups[group].push(exercise);
      });
      return groups;
    }

    // Current exercise exists - create "Recommended" group first
    const currentExDetails = exercises.find(e => e.id === currentExercise.id);
    const recommended = currentExDetails?.substitutionsRecommended || [];
    
    const groups: { [key: string]: Exercise[] } = {};
    const recommendedExercises: Exercise[] = [];
    
    filteredExercises.forEach(exercise => {
      if (recommended.includes(exercise.id)) {
        recommendedExercises.push(exercise);
      } else {
        const group = exercise.muscleGroup;
        if (!groups[group]) {
          groups[group] = [];
        }
        groups[group].push(exercise);
      }
    });
    
    // Add recommended group at the beginning if there are any
    if (recommendedExercises.length > 0) {
      return { 'recommended': recommendedExercises, ...groups };
    }
    
    return groups;
  }, [filteredExercises, currentExercise, exercises]);

  const handleSelect = (exercise: Exercise) => {
    onSelect(exercise);
    setSearchQuery('');
    setSelectedMuscleGroup(null);
    setCategoryPicker('all');
  };

  const handleCustomExerciseCreated = (exercise: Exercise) => {
    setExercises(prev => {
      const existing = prev.find(item => item.id === exercise.id);
      if (existing) return prev;
      return [...prev, exercise].sort((a, b) => a.name.localeCompare(b.name));
    });
    setShowCustomExerciseModal(false);
    handleSelect(exercise);
  };

  const handleClose = () => {
    setSearchQuery('');
    setSelectedMuscleGroup(null);
    setCategoryPicker('all');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
          <KeyboardAwareScreen style={styles.screen}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.dragHandle} />
              <View style={styles.headerRow}>
                <View style={styles.headerTitles}>
                  <Text style={styles.title}>
                    {currentExercise ? t('workout:substituteExerciseTitle') : t('workout:addExerciseTitle')}
                  </Text>
                  {currentExercise && (
                    <Text style={styles.subtitle} numberOfLines={2}>
                      {t('workout:currentlyExercise', {
                        name: getLocalizedExerciseName(
                          findBuiltinExerciseById(currentExercise.id),
                          currentExercise.name,
                          i18n.language,
                        ),
                      })}
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={handleClose}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('common:cancel', { defaultValue: 'Cancel' })}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Search Bar */}
            <View style={styles.searchContainer}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder={t('workout:searchExercisesPlaceholder')}
                placeholderTextColor="#8E8E93"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Text style={styles.clearButton}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* All / Strength / Endurance segmented control */}
            <View style={styles.categorySwitchRow}>
              <View style={styles.categorySwitch}>
                <TouchableOpacity
                  style={[
                    styles.categorySegment,
                    categoryPicker === 'all' && styles.categorySegmentActive,
                  ]}
                  onPress={() => setCategoryPicker('all')}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.categorySegmentText,
                      categoryPicker === 'all' && styles.categorySegmentTextActive,
                    ]}
                  >
                    {t('progress:trainingCategoryAll')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.categorySegment,
                    categoryPicker === 'strength' && styles.categorySegmentActive,
                  ]}
                  onPress={() => setCategoryPicker('strength')}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.categorySegmentText,
                      categoryPicker === 'strength' && styles.categorySegmentTextActive,
                    ]}
                  >
                    {t('progress:trainingCategoryStrength')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.categorySegment,
                    categoryPicker === 'endurance' && styles.categorySegmentActive,
                  ]}
                  onPress={() => setCategoryPicker('endurance')}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.categorySegmentText,
                      categoryPicker === 'endurance' && styles.categorySegmentTextActive,
                    ]}
                  >
                    {t('progress:trainingCategoryEndurance')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Muscle filter: a horizontal strip of mini muscle-maps. Each chip highlights its
                group in orange (broad for legs, narrow for calves); tap to filter the list. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.muscleStrip}
              contentContainerStyle={styles.muscleStripContent}
            >
              <TouchableOpacity
                style={[styles.muscleChip, !selectedMuscleGroup && styles.muscleChipActive]}
                onPress={() => setSelectedMuscleGroup(null)}
                activeOpacity={0.7}
              >
                <View style={styles.muscleChipBody} pointerEvents="none">
                  <Body
                    data={[]}
                    gender={gender}
                    side="front"
                    scale={MUSCLE_CHIP_SCALE}
                    border="#3A4D52"
                    colors={['#F47C3C']}
                    defaultFill="#22312F"
                  />
                </View>
                <Text
                  style={[styles.muscleChipLabel, !selectedMuscleGroup && styles.muscleChipLabelActive]}
                  numberOfLines={2}
                >
                  {t('common:all', { defaultValue: 'All' })}
                </Text>
              </TouchableOpacity>

              {MUSCLE_CHIP_GROUPS.map(group => {
                const active = selectedMuscleGroup === group;
                const data = (MUSCLE_GROUP_TO_SLUGS[group] ?? []).map(
                  slug => ({ slug, intensity: 2 } as ExtendedBodyPart),
                );
                return (
                  <TouchableOpacity
                    key={group}
                    style={[styles.muscleChip, active && styles.muscleChipActive]}
                    onPress={() => setSelectedMuscleGroup(active ? null : group)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.muscleChipBody} pointerEvents="none">
                      <Body
                        data={data}
                        gender={gender}
                        side={MUSCLE_CHIP_SIDE[group]}
                        scale={MUSCLE_CHIP_SCALE}
                        border="#3A4D52"
                        colors={['#F47C3C', '#F47C3C', '#F47C3C']}
                        defaultFill="#22312F"
                      />
                    </View>
                    <Text
                      style={[styles.muscleChipLabel, active && styles.muscleChipLabelActive]}
                      numberOfLines={2}
                    >
                      {getMuscleGroupDisplayName(group)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Exercise List */}
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={true}
              keyboardDismissMode="on-drag"
              onScrollBeginDrag={() => Keyboard.dismiss()}
            >
              <TouchableOpacity
                style={styles.customExerciseButton}
                onPress={() => setShowCustomExerciseModal(true)}
                activeOpacity={0.8}
              >
                <View style={styles.customExerciseContent}>
                  <Text style={styles.customExerciseTitle}>{t('workout:addMyOwnExercise')}</Text>
                </View>
                <Text style={styles.arrowText}>›</Text>
              </TouchableOpacity>

              {isLoading ? (
                <View style={styles.loadingState}>
                  <ActivityIndicator size="small" color="#F47C3C" />
                </View>
              ) : filteredExercises.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>🏋️</Text>
                  <Text style={styles.emptyTitle}>{t('workout:noExercisesFoundTitle')}</Text>
                  <Text style={styles.emptyText}>
                    {t('workout:noExercisesFoundBody')}
                  </Text>
                </View>
              ) : (
                Object.entries(groupedExercises).map(([muscleGroup, exercises]) => (
                  <View key={muscleGroup} style={styles.exerciseGroup}>
                    <Text style={[
                      styles.groupTitle,
                      muscleGroup === 'recommended' && styles.groupTitleRecommended
                    ]}>
                      {muscleGroup === 'recommended' ? t('workout:recommendedExercises') : getMuscleGroupDisplayName(muscleGroup as any)}
                    </Text>
                    {exercises.map(exercise => {
                      const videoUrl = getLocalizedExerciseVideoUrl(exercise, i18n.language);
                      return (
                        <TouchableOpacity
                          key={exercise.id}
                          style={[
                            styles.exerciseCard,
                            currentExercise && exercise.id === currentExercise.id && styles.exerciseCardCurrent
                          ]}
                          onPress={() => handleSelect(exercise)}
                          activeOpacity={0.7}
                          disabled={currentExercise ? exercise.id === currentExercise.id : false}
                        >
                          <View style={styles.exerciseCardInner}>
                            <Text style={styles.exerciseName}>
                              {getLocalizedExerciseName(exercise, exercise.name, i18n.language)}
                              {currentExercise && exercise.id === currentExercise.id && (
                                <Text style={styles.exerciseCurrentLabel}>{` · ${t('workout:currentExerciseLabel')}`}</Text>
                              )}
                            </Text>
                            <View style={styles.exerciseMeta}>
                              <View style={styles.metaBadge}>
                                <Text style={styles.metaBadgeText}>
                                  {getMovementTypeDisplayName(exercise.movementType)}
                                </Text>
                              </View>
                              {videoUrl && (
                                <TouchableOpacity
                                  style={styles.videoBadge}
                                  onPress={(e) => {
                                    e.stopPropagation();
                                    Linking.openURL(videoUrl);
                                  }}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  activeOpacity={0.7}
                                >
                                  <Icon source={appIcons.video_library} width={12} height={12} fill="#FFFFFF" />
                                  <Text style={styles.videoBadgeText}>{t('workout:videoLabel')}</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>
                          <Text style={styles.arrowText}>›</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))
              )}
            </ScrollView>

          </KeyboardAwareScreen>
        </SafeAreaView>
      </View>

      <CustomExerciseModal
        visible={showCustomExerciseModal}
        userId={userId}
        onClose={() => setShowCustomExerciseModal(false)}
        onCreated={handleCustomExerciseCreated}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  safeArea: {
    backgroundColor: '#0E1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    // Concrete height is required: the inner KeyboardAwareScreen/ScrollView are
    // flex:1, and a flex child inside a parent sized only by `maxHeight` collapses
    // to 0 height — which rendered the sheet as an empty dark overlay.
    height: '92%',
  },
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1D2F2F',
    alignItems: 'stretch',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2A4242',
    alignSelf: 'center',
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerTitles: {
    flex: 1,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1D2F2F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 18,
    color: '#9AA3A6',
    fontWeight: '500',
    lineHeight: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F2F2F7',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#9AA3A6',
  },
  categorySwitchRow: {
    marginHorizontal: 16,
    marginBottom: 10,
  },
  categorySwitch: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    padding: 3,
    borderRadius: 10,
    backgroundColor: '#152525',
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  categorySegment: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
  },
  categorySegmentActive: {
    backgroundColor: '#F47C3C',
  },
  categorySegmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9AA3A6',
  },
  categorySegmentTextActive: {
    color: '#FFFFFF',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1D2F2F',
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#F2F2F7',
  },
  clearButton: {
    fontSize: 18,
    color: '#9AA3A6',
    padding: 4,
  },
  muscleStrip: {
    maxHeight: 124,
    marginTop: 2,
    marginBottom: 6,
  },
  muscleStripContent: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'flex-start',
  },
  muscleChip: {
    width: 72,
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: 2,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: '#152525',
  },
  muscleChipActive: {
    borderColor: '#F47C3C',
    backgroundColor: '#1A2424',
  },
  muscleChipBody: {
    width: 58,
    height: 78,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  muscleChipLabel: {
    fontSize: 10,
    lineHeight: 12,
    color: '#9AA3A6',
    textAlign: 'center',
    marginTop: 2,
  },
  muscleChipLabelActive: {
    color: '#F47C3C',
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 8,
  },
  loadingState: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  customExerciseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A4242',
    borderStyle: 'dashed',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    gap: 6,
  },
  customExerciseContent: {
    flex: 1,
  },
  customExerciseTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9AA3A6',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2F7',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#9AA3A6',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  exerciseGroup: {
    marginBottom: 24,
  },
  groupTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F2F2F7',
    marginBottom: 12,
    marginLeft: 4,
  },
  groupTitleRecommended: {
    color: '#F47C3C',
    fontSize: 17,
  },
  exerciseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A2B2B',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#243535',
  },
  exerciseCardCurrent: {
    backgroundColor: '#223030',
    borderColor: '#3A4A4A',
  },
  exerciseCardInner: {
    flex: 1,
    gap: 6,
    marginRight: 8,
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F2F2F7',
    lineHeight: 20,
  },
  exerciseCurrentLabel: {
    fontSize: 13,
    fontWeight: '400',
    color: '#9AA3A6',
  },
  exerciseMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  metaBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: '#253838',
    borderWidth: 1,
    borderColor: '#2F4545',
  },
  metaBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8AA3A3',
  },
  videoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: '#1A5276',
    borderWidth: 1,
    borderColor: '#2E86C1',
  },
  videoBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  arrowText: {
    fontSize: 18,
    color: '#4A6060',
    fontWeight: '300',
  },
});

