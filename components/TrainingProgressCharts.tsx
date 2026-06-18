import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    Image,
    InteractionManager,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { BUILTIN_EXERCISES } from '../lib/exercise-catalog';
import { getLocalizedExerciseName, normalizeExerciseNameKey, normalizeExerciseNameLooseKey } from '../lib/exercise-localization';
import { hydrateCustomExerciseFromId, listCustomExercises } from '../lib/custom-exercise-storage';
import { getCanonicalDailyMetricsRange } from '../lib/daily-metrics-storage';
import { resolveMobileOsBucket, stepsTrendNoDataFallback } from '../lib/health-platform-copy';
import { NEAT_STEP_BASELINE } from '../lib/nutrition-math';
import { getWorkoutLogsForDateRange } from '../lib/workout-storage';
import { formatDurationMinutesForChart } from '../lib/exercise-duration';
import { BodyRegion, Exercise, ExerciseCategory, MuscleGroup, WeightUnit, WorkoutLog } from '../types/workout';
import { appIcons } from '../assets/icons';
import { useActiveOverlay } from '@/hooks/useActiveOverlay';

interface TrainingProgressChartsProps {
  userId: string;
  /** When provided, skip a second SQLite/Supabase fetch (Progress tab already loaded these). */
  prefetchedWorkoutLogs?: WorkoutLog[];
  /** Optional ref attached to the filters row so the parent can scroll it to the top of its scroll view. */
  filtersRef?: React.MutableRefObject<View | null>;
}

type TimeFilter = 'month' | '3months';
type WeightMetric = 'total' | 'max' | 'reps';
type CategoryFilter = 'all' | ExerciseCategory;

interface ExerciseProgressData {
  exerciseId: string;
  exerciseName: string;
  bodyRegion: BodyRegion;
  muscleGroup: MuscleGroup;
  category: ExerciseCategory;
  weeklyData: {
    weekLabel: string;
    weekStart: Date;
    totalWeight: number;
    maxWeight: number;
    totalReps: number;
    maxDurationSec: number;
    totalSets: number;
  }[];
}

interface GroupedData {
  bodyRegion: BodyRegion;
  muscleGroups: {
    muscleGroup: MuscleGroup;
    exercises: ExerciseProgressData[];
  }[];
}

interface StepsTrendPoint {
  date: string;
  label: string;
  steps: number;
}

const BODY_REGION_COLORS: Record<BodyRegion, string> = {
  upper: '#4ECDC4',  // Turquoise
  lower: '#3498DB',  // Blue
  core: '#9B59B6',   // Purple
};

const screenWidth = Dimensions.get('window').width;
const CHART_WIDTH = screenWidth - 80;
const CHART_HEIGHT = 160;

/** Steps bar column: track height and proportional fill cap (reduced ~30% vs original 100/96). */
const STEPS_BAR_TRACK_HEIGHT = 70;
const STEPS_BAR_MAX_FILL = 67;
const STEPS_BAR_MIN_FILL = 7;

export default function TrainingProgressCharts({ userId, prefetchedWorkoutLogs, filtersRef }: TrainingProgressChartsProps) {
  const { t, i18n } = useTranslation(['progress']);

  const BODY_REGION_LABELS: Record<BodyRegion, string> = {
    upper: t('progress:bodyRegionUpper'),
    lower: t('progress:bodyRegionLower'),
    core: t('progress:bodyRegionCore'),
  };

  const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
    chest: t('progress:muscleChest'),
    back: t('progress:muscleBack'),
    shoulders: t('progress:muscleShoulders'),
    arms: t('progress:muscleArms'),
    legs: t('progress:muscleLegs'),
    quads: t('progress:muscleQuads'),
    hamstrings: t('progress:muscleHamstrings'),
    glutes: t('progress:muscleGlutes'),
    adductors: t('progress:muscleAdductors'),
    calves: t('progress:muscleCalves'),
    abs: t('progress:muscleAbs'),
    obliques: t('progress:muscleObliques'),
  };

  const [timeFilter, setTimeFilter] = useState<TimeFilter>('month');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [weightMetric, setWeightMetric] = useState<WeightMetric>('total');
  const [groupedData, setGroupedData] = useState<GroupedData[]>([]);
  const [stepsTrendData, setStepsTrendData] = useState<StepsTrendPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [chartsReady, setChartsReady] = useState(Platform.OS !== 'android');
  const {
    isOpen: showMetricDropdown,
    openSelf: openMetricDropdown,
    closeSelf: closeMetricDropdown,
  } = useActiveOverlay('trainingProgress.metric');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0, width: 0 });
  const dropdownButtonRef = useRef<any>(null);

  const isEnduranceView = categoryFilter === 'endurance';

  useEffect(() => {
    if (isEnduranceView && weightMetric === 'total') {
      setWeightMetric('reps');
    }
  }, [isEnduranceView, weightMetric]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    if (Platform.OS === 'android') {
      setChartsReady(false);
    }
    try {
      const endDate = new Date();
      const startDate = new Date();
      if (timeFilter === 'month') {
        startDate.setMonth(startDate.getMonth() - 1);
      } else {
        startDate.setMonth(startDate.getMonth() - 3);
      }

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      // Steps chart is always the last 14 local calendar days (not tied to month/3mo filter).
      const toLocalYmd = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const stepsEndDate = new Date();
      const stepsStartDate = new Date(stepsEndDate);
      stepsStartDate.setDate(stepsStartDate.getDate() - 13);
      const stepsStartStr = toLocalYmd(stepsStartDate);
      const stepsEndStr = toLocalYmd(stepsEndDate);

      const [logs, customExercises, stepsRows] = await Promise.all([
        prefetchedWorkoutLogs != null
          ? Promise.resolve(
              prefetchedWorkoutLogs.filter(
                (log) => log.workoutDate >= startStr && log.workoutDate <= endStr,
              ),
            )
          : getWorkoutLogsForDateRange(userId, startStr, endStr),
        listCustomExercises(userId),
        getCanonicalDailyMetricsRange(userId, 'steps', stepsStartStr, stepsEndStr),
      ]);
      const customExerciseMap = new Map(customExercises.map(exercise => [exercise.id, exercise]));
      setStepsTrendData(
        stepsRows.map((row) => {
          const d = new Date(row.metricDate + 'T00:00:00');
          return {
            date: row.metricDate,
            label: `${d.getMonth() + 1}/${d.getDate()}`,
            steps: Math.round(row.value),
          };
        }),
      );
      
      console.log('[TrainingCharts] Loaded logs:', logs.length);
      console.log('[TrainingCharts] Logs:', logs.map(l => ({
        id: l.id,
        date: l.workoutDate,
        name: l.workoutDayName,
        status: l.status,
        exerciseCount: l.exercises?.length || 0,
      })));
      
      // Process logs into exercise progress data
      const exerciseMap = new Map<string, ExerciseProgressData>();
      
      let completedCount = 0;
      let exercisesProcessed = 0;
      
      for (const log of logs) {
        if (log.status !== 'completed' || !log.exercises) {
          console.log('[TrainingCharts] Skipping log:', log.id, 'status:', log.status, 'exercises:', log.exercises?.length);
          continue;
        }
        completedCount++;
        
        const workoutDate = new Date(log.workoutDate);
        const weekStart = getWeekStart(workoutDate);
        const weekLabel = formatWeekLabel(weekStart);
        
        for (const exercise of log.exercises) {
          // Only require reps - weight is optional for bodyweight exercises
          if (!exercise.reps) {
            console.log('[TrainingCharts] Skipping exercise without reps:', exercise.exerciseName, 'reps:', exercise.reps);
            continue;
          }
          exercisesProcessed++;
          
          const rawKey = exercise.exerciseId || exercise.exerciseName.toLowerCase().replace(/\s+/g, '-');
          const logNorm = normalizeExerciseNameKey(exercise.exerciseName);
          const exerciseInfo: Exercise | null | undefined =
            customExerciseMap.get(rawKey) ||
            BUILTIN_EXERCISES.find(
              (e) =>
                e.id === rawKey ||
                normalizeExerciseNameKey(e.name) === logNorm ||
                (!!e.nameEs && normalizeExerciseNameKey(e.nameEs) === logNorm),
            ) ||
            hydrateCustomExerciseFromId(rawKey, exercise.exerciseName, userId);

          // Canonical merge key: collapse a catalog id, its custom fallback, and
          // case/plural variants of the same movement into one chart (homologation).
          const key = exerciseInfo?.id || normalizeExerciseNameLooseKey(exercise.exerciseName) || rawKey;

          if (!exerciseMap.has(key)) {
            exerciseMap.set(key, {
              exerciseId: key,
              exerciseName: getLocalizedExerciseName(
                exerciseInfo ?? undefined,
                exercise.exerciseName,
                i18n.language,
              ),
              bodyRegion: exerciseInfo?.bodyRegion || 'upper',
              muscleGroup: exerciseInfo?.muscleGroup || 'chest',
              category: exerciseInfo?.category || 'strength',
              weeklyData: [],
            });
          }

          const exerciseData = exerciseMap.get(key)!;
          let weekData = exerciseData.weeklyData.find(w => w.weekLabel === weekLabel);
          
          if (!weekData) {
            weekData = {
              weekLabel,
              weekStart,
              totalWeight: 0,
              maxWeight: 0,
              totalReps: 0,
              maxDurationSec: 0,
              totalSets: 0,
            };
            exerciseData.weeklyData.push(weekData);
          }
          
          const weight = exercise.weightValue || 0; // Default to 0 for bodyweight exercises
          const reps = exercise.reps;
          
          weekData.totalWeight += weight * reps;
          weekData.maxWeight = Math.max(weekData.maxWeight, weight);
          weekData.totalReps += reps;
          weekData.maxDurationSec = Math.max(weekData.maxDurationSec, reps);
          weekData.totalSets += 1;
        }
      }
      
      // Sort weekly data by date for each exercise
      exerciseMap.forEach(exercise => {
        exercise.weeklyData.sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
      });
      
      console.log('[TrainingCharts] Summary: completed logs:', completedCount, 'exercises with data:', exercisesProcessed, 'unique exercises:', exerciseMap.size);
      
      // Group by body region and muscle group, applying the strength/endurance filter.
      const allExercises = Array.from(exerciseMap.values());
      const filteredExercises =
        categoryFilter === 'all'
          ? allExercises
          : allExercises.filter((e) => e.category === categoryFilter);
      const grouped = groupExerciseData(filteredExercises);
      const applyResults = () => {
        setGroupedData(grouped);
        setChartsReady(Platform.OS !== 'android');
      };
      if (Platform.OS === 'android') {
        InteractionManager.runAfterInteractions(() => {
          applyResults();
          setChartsReady(true);
        });
      } else {
        applyResults();
      }
    } catch (error) {
      console.error('Error loading training progress:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, timeFilter, categoryFilter, i18n.language, prefetchedWorkoutLogs]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getWeekStart = (date: Date): Date => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const formatWeekLabel = (date: Date): string => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}`;
  };

  // Determine which x-axis labels to show (every 2 weeks for 3-month view)
  const shouldShowLabel = (index: number, total: number): boolean => {
    if (timeFilter === 'month') return true;
    // For 3 months, show every 2nd label (or first and last)
    if (total <= 6) return true;
    if (index === 0 || index === total - 1) return true;
    return index % 2 === 0;
  };

  const groupExerciseData = (exercises: ExerciseProgressData[]): GroupedData[] => {
    const regionMap = new Map<BodyRegion, Map<MuscleGroup, ExerciseProgressData[]>>();
    
    for (const exercise of exercises) {
      if (!regionMap.has(exercise.bodyRegion)) {
        regionMap.set(exercise.bodyRegion, new Map());
      }
      const muscleMap = regionMap.get(exercise.bodyRegion)!;
      if (!muscleMap.has(exercise.muscleGroup)) {
        muscleMap.set(exercise.muscleGroup, []);
      }
      muscleMap.get(exercise.muscleGroup)!.push(exercise);
    }
    
    const result: GroupedData[] = [];
    const regionOrder: BodyRegion[] = ['upper', 'lower', 'core'];
    
    for (const region of regionOrder) {
      if (!regionMap.has(region)) continue;
      const muscleMap = regionMap.get(region)!;
      const muscleGroups: { muscleGroup: MuscleGroup; exercises: ExerciseProgressData[] }[] = [];
      
      muscleMap.forEach((exercises, muscleGroup) => {
        muscleGroups.push({ muscleGroup, exercises });
      });
      
      result.push({ bodyRegion: region, muscleGroups });
    }
    
    return result;
  };

  const exerciseUsesTimeChart = (exercise: ExerciseProgressData) =>
    isEnduranceView || exercise.category === 'endurance';

  const getChartRawValue = (d: ExerciseProgressData['weeklyData'][0], metric: WeightMetric, useTime: boolean) => {
    if (useTime) {
      if (metric === 'max') return d.maxDurationSec;
      return d.totalReps;
    }
    if (metric === 'total') return d.totalWeight;
    if (metric === 'max') return d.maxWeight;
    return d.totalReps;
  };

  const toChartDisplayValue = (raw: number, useTime: boolean) => (useTime ? raw / 60 : raw);

  const renderLineChart = (exercise: ExerciseProgressData) => {
    const data = exercise.weeklyData;
    if (data.length === 0) return null;

    const useTime = exerciseUsesTimeChart(exercise);
    const values = data.map((d) =>
      toChartDisplayValue(getChartRawValue(d, weightMetric, useTime), useTime),
    );
    const maxValue = Math.max(...values, 1);
    const minValue = Math.min(...values, 0);
    const range = maxValue - minValue || 1;

    const paddingLeft = 50;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 40;
    const chartInnerWidth = CHART_WIDTH - paddingLeft - paddingRight;
    const chartInnerHeight = CHART_HEIGHT - paddingTop - paddingBottom;

    const getX = (index: number) => {
      if (data.length === 1) return paddingLeft + chartInnerWidth / 2;
      return paddingLeft + (index / (data.length - 1)) * chartInnerWidth;
    };

    const getY = (value: number) => {
      return paddingTop + chartInnerHeight - ((value - minValue) / range) * chartInnerHeight;
    };

    // Build line path
    let linePath = `M ${getX(0)} ${getY(values[0])}`;
    for (let i = 1; i < data.length; i++) {
      linePath += ` L ${getX(i)} ${getY(values[i])}`;
    }

    // Use body region color for consistent coloring
    const lineColor = BODY_REGION_COLORS[exercise.bodyRegion];

    return (
      <View key={exercise.exerciseId} style={styles.chartCard}>
        <Text style={styles.exerciseName}>{exercise.exerciseName}</Text>
        <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
            const y = paddingTop + chartInnerHeight * (1 - ratio);
            const value = minValue + range * ratio;
            return (
              <React.Fragment key={i}>
                <Line
                  x1={paddingLeft}
                  y1={y}
                  x2={CHART_WIDTH - paddingRight}
                  y2={y}
                  stroke="#E5E5EA"
                  strokeWidth={1}
                  strokeDasharray={i === 0 ? undefined : "4,4"}
                />
                <SvgText
                  x={paddingLeft - 8}
                  y={y + 4}
                  fontSize={10}
                  fill="#FFFFFF"
                  textAnchor="end"
                >
                  {formatValue(value, weightMetric, useTime)}
                </SvgText>
              </React.Fragment>
            );
          })}

          {/* X-axis labels - show every 2 weeks for 3-month view */}
          {data.map((d, i) => 
            shouldShowLabel(i, data.length) ? (
              <SvgText
                key={i}
                x={getX(i)}
                y={CHART_HEIGHT - 10}
                fontSize={9}
                fill="#FFFFFF"
                textAnchor="middle"
              >
                {d.weekLabel}
              </SvgText>
            ) : null
          )}

          {/* Line */}
          <Path
            d={linePath}
            stroke={lineColor}
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data points */}
          {data.map((d, i) => (
            <Circle
              key={i}
              cx={getX(i)}
              cy={getY(values[i])}
              r={4}
              fill="#fff"
              stroke={lineColor}
              strokeWidth={2}
            />
          ))}
        </Svg>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>{t('progress:trainingSets')}</Text>
            <Text style={styles.statValue}>
              {data.reduce((sum, d) => sum + d.totalSets, 0)}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>
              {useTime
                ? t('progress:trainingMetricTimeTotal')
                : weightMetric === 'reps'
                  ? t('progress:trainingMetricReps')
                  : t('progress:trainingMetricTotal')}
            </Text>
            <Text style={styles.statValue}>
              {formatValue(
                toChartDisplayValue(
                  useTime
                    ? data.reduce((sum, d) => sum + d.totalReps, 0)
                    : weightMetric === 'reps'
                      ? data.reduce((sum, d) => sum + d.totalReps, 0)
                      : data.reduce((sum, d) => sum + d.totalWeight, 0),
                  weightMetric,
                  useTime,
                ),
                weightMetric,
                useTime,
              )}{' '}
              {getMetricLabel(weightMetric, useTime)}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>{t('progress:trainingMax')}</Text>
            <Text style={styles.statValue}>
              {formatValue(
                toChartDisplayValue(
                  useTime
                    ? Math.max(...data.map((d) => d.maxDurationSec), 0)
                    : weightMetric === 'reps'
                      ? Math.max(...data.map((d) => d.totalReps), 0)
                      : Math.max(...data.map((d) => d.maxWeight), 0),
                  weightMetric,
                  useTime,
                ),
                weightMetric,
                useTime,
              )}{' '}
              {getMetricLabel(weightMetric, useTime)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const convertWeight = (weightKg: number, targetUnit: WeightUnit): number => {
    if (targetUnit === 'lbs') {
      return weightKg * 2.20462; // Convert kg to lbs
    }
    return weightKg;
  };

  const formatValue = (value: number, metric: WeightMetric, useTime = false): string => {
    if (useTime || metric === 'reps') {
      if (useTime) return formatDurationMinutesForChart(value);
      return Math.round(value).toLocaleString();
    }
    // For weight metrics, convert to selected unit first
    const convertedValue = convertWeight(value, weightUnit);
    if (convertedValue >= 1000) {
      return `${(convertedValue / 1000).toFixed(1)}k`;
    }
    return Math.round(convertedValue).toLocaleString();
  };

  const getMetricLabel = (metric: WeightMetric, useTime = false): string => {
    if (useTime) return t('progress:trainingMinutesUnit');
    if (metric === 'reps') return 'reps';
    return weightUnit;
  };

  const renderStepsChart = () => {
    const maxSteps = Math.max(NEAT_STEP_BASELINE, ...stepsTrendData.map((d) => d.steps), 1);
    const recent = stepsTrendData.slice(-14);
    const avgSteps =
      recent.length > 0
        ? Math.round(recent.reduce((sum, d) => sum + d.steps, 0) / recent.length)
        : 0;

    return (
      <View style={styles.stepsCard}>
        <View style={styles.stepsHeader}>
          <View>
            <Text style={styles.stepsTitle}>
              {t('progress:stepsTrendTitle', { defaultValue: 'Steps per day' })}
            </Text>
            <Text style={styles.stepsSubtitle}>
              {t('progress:stepsTrendSubtitle', {
                avg: avgSteps.toLocaleString(),
                defaultValue: `14-day avg ${avgSteps.toLocaleString()}`,
              })}
            </Text>
          </View>
          <Text style={styles.stepsBaseline}>
            {stepsTrendData.length > 0
              ? t('progress:stepsTrendBaseline', {
                  steps: NEAT_STEP_BASELINE.toLocaleString(),
                  defaultValue: `${NEAT_STEP_BASELINE.toLocaleString()} baseline`,
                })
              : t('progress:stepsTrendNoDataBadge', { defaultValue: 'No step data' })}
          </Text>
        </View>

        {recent.length === 0 ? (
          <Text style={styles.stepsEmptyText}>
            {(() => {
              const bucket = resolveMobileOsBucket();
              const key =
                bucket === 'ios'
                  ? 'progress:stepsTrendNoDataIos'
                  : bucket === 'android'
                    ? 'progress:stepsTrendNoDataAndroid'
                    : 'progress:stepsTrendNoDataWeb';
              const fallback = stepsTrendNoDataFallback();
              let text = t(key, { defaultValue: fallback });
              if (bucket === 'android' && /apple health/i.test(text)) {
                text = fallback;
              }
              return text;
            })()}
          </Text>
        ) : (
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.stepsBarsRow}
          >
            {recent.map((point) => {
              const barHeight = Math.max(
                STEPS_BAR_MIN_FILL,
                Math.round((point.steps / maxSteps) * STEPS_BAR_MAX_FILL),
              );
              const hitBaseline = point.steps >= NEAT_STEP_BASELINE;
              return (
                <View key={point.date} style={styles.stepsBarItem}>
                  <View style={styles.stepsBarTrack}>
                    <View
                      style={[
                        styles.stepsBarFill,
                        {
                          height: barHeight,
                          backgroundColor: hitBaseline ? '#F47C3C' : '#3B4A4E',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.stepsBarValue}>
                    {point.steps >= 1000 ? `${Math.round(point.steps / 1000)}k` : point.steps}
                  </Text>
                  <Text style={styles.stepsBarLabel}>{point.label}</Text>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  };

  const hasData = groupedData.some(g => g.muscleGroups.some(m => m.exercises.length > 0));

  if (isLoading || (hasData && !chartsReady)) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>{t('progress:trainingLoading')}</Text>
      </View>
    );
  }

  // Extracted: filters live below the steps card (per design) and use absolute
  // page coordinates for the dropdown anchor, so position is correct anywhere
  // in the scroll view.
  const CATEGORY_FILTERS: { key: CategoryFilter; label: string }[] = [
    { key: 'all', label: t('progress:trainingCategoryAll') },
    { key: 'strength', label: t('progress:trainingCategoryStrength') },
    { key: 'power', label: t('progress:trainingCategoryPower') },
    { key: 'endurance', label: t('progress:trainingCategoryEndurance') },
    { key: 'conditioning', label: t('progress:trainingCategoryConditioning') },
    { key: 'mobility', label: t('progress:trainingCategoryMobility') },
  ];

  const renderFilters = () => (
    <View>
    <View
      ref={(node) => { if (filtersRef) filtersRef.current = node; }}
      style={styles.filtersContainer}
    >
      <View style={styles.filterGroup}>
        <TouchableOpacity
          style={[
            styles.filterButton,
            timeFilter === 'month' && styles.filterButtonActive,
          ]}
          onPress={() => setTimeFilter('month')}
        >
          <Text style={[
            styles.filterButtonText,
            timeFilter === 'month' && styles.filterButtonTextActive,
          ]}>
            {t('progress:trainingFilterMonth')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.filterButton,
            timeFilter === '3months' && styles.filterButtonActive,
          ]}
          onPress={() => setTimeFilter('3months')}
        >
          <Text style={[
            styles.filterButtonText,
            timeFilter === '3months' && styles.filterButtonTextActive,
          ]}>
            {t('progress:trainingFilter3Months')}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterGroup}>
        <TouchableOpacity
          ref={dropdownButtonRef}
          style={styles.metricDropdown}
          onPress={() => {
            if (!showMetricDropdown) {
              dropdownButtonRef.current?.measure((_x: number, _y: number, width: number, height: number, pageX: number, pageY: number) => {
                setDropdownPosition({ x: pageX, y: pageY + height, width });
                openMetricDropdown();
              });
            } else {
              closeMetricDropdown();
            }
          }}
        >
          <Text style={styles.metricDropdownText}>
            {isEnduranceView
              ? (weightMetric === 'max'
                  ? t('progress:trainingMetricTimeMax')
                  : t('progress:trainingMetricTimeTotal'))
              : weightMetric === 'total'
                ? t('progress:trainingMetricTotal')
                : weightMetric === 'max'
                  ? t('progress:trainingMetricMax')
                  : t('progress:trainingMetricReps')}
          </Text>
          <Text style={styles.metricDropdownArrow}>▼</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.unitToggle}
        onPress={() => setWeightUnit(weightUnit === 'kg' ? 'lbs' : 'kg')}
      >
        <Text style={styles.unitToggleText}>{weightUnit.toUpperCase()}</Text>
      </TouchableOpacity>
    </View>

      {/* Training type filter (strength / power / endurance / conditioning / mobility),
          directly under the time-range switch. Horizontally scrollable to fit all types. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoryFilterRow}
        contentContainerStyle={styles.categoryFilterContent}
      >
        <View style={[styles.filterGroup, styles.categoryFilterGroup]}>
          {CATEGORY_FILTERS.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              style={[
                styles.filterButton,
                styles.categoryFilterButton,
                categoryFilter === key && styles.filterButtonActive,
              ]}
              onPress={() => setCategoryFilter(key)}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.filterButtonText,
                  styles.categoryFilterButtonText,
                  categoryFilter === key && styles.filterButtonTextActive,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );

  // No exercises at all (the user has never logged a workout): show the bare
  // empty state. But if a category filter is active and only *that* category is
  // empty, keep the steps card + filters visible so the user can switch back to
  // another category instead of being stranded on a blank screen.
  if (!hasData && categoryFilter === 'all') {
    return (
      <View style={styles.container}>
        {renderStepsChart()}
        <View style={styles.emptyContainer}>
          <Image source={appIcons.bar_chart} style={styles.emptyIconImage} />
          <Text style={styles.emptyTitle}>{t('progress:trainingEmpty')}</Text>
          <Text style={styles.emptySubtitle}>
            {t('progress:trainingEmptySub')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Steps first, then filters, then strength breakdown. The parent scrolls past the steps card to the filters row when arriving post-workout. */}
      {renderStepsChart()}
      {renderFilters()}

      {!hasData && (
        <View style={styles.emptyContainer}>
          <Image source={appIcons.bar_chart} style={styles.emptyIconImage} />
          <Text style={styles.emptyTitle}>{t('progress:trainingEmpty')}</Text>
          <Text style={styles.emptySubtitle}>
            {t('progress:trainingEmptySub')}
          </Text>
        </View>
      )}

      {groupedData.map((regionGroup) => (
        <View key={regionGroup.bodyRegion} style={styles.regionSection}>
          <Text style={[
            styles.regionHeaderText,
            { color: BODY_REGION_COLORS[regionGroup.bodyRegion] }
          ]}>
            {BODY_REGION_LABELS[regionGroup.bodyRegion]}
          </Text>
          
          {regionGroup.muscleGroups.map((muscleGroup) => (
            <View key={muscleGroup.muscleGroup} style={styles.muscleGroupSection}>
              <Text style={[
                styles.muscleGroupTitle,
                { color: BODY_REGION_COLORS[regionGroup.bodyRegion] },
              ]}>
                {MUSCLE_GROUP_LABELS[muscleGroup.muscleGroup]}
              </Text>
              
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chartsRow}
              >
                {muscleGroup.exercises.map((exercise) => 
                  renderLineChart(exercise)
                )}
              </ScrollView>
            </View>
          ))}
        </View>
      ))}

      {/* Dropdown Modal */}
      <Modal
        visible={showMetricDropdown}
        transparent
        animationType="none"
        onRequestClose={closeMetricDropdown}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closeMetricDropdown}
        >
          <View
            style={[
              styles.metricDropdownMenuModal,
              {
                left: dropdownPosition.x,
                top: dropdownPosition.y + 4,
                width: dropdownPosition.width,
              },
            ]}
          >
            {isEnduranceView ? (
              <>
                <TouchableOpacity
                  style={styles.metricDropdownItem}
                  onPress={() => {
                    setWeightMetric('reps');
                    closeMetricDropdown();
                  }}
                >
                  <Text style={styles.metricDropdownItemText}>
                    {t('progress:trainingMetricTimeTotal')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.metricDropdownItem}
                  onPress={() => {
                    setWeightMetric('max');
                    closeMetricDropdown();
                  }}
                >
                  <Text style={styles.metricDropdownItemText}>
                    {t('progress:trainingMetricTimeMax')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.metricDropdownItem}
                  onPress={() => {
                    setWeightMetric('total');
                    closeMetricDropdown();
                  }}
                >
                  <Text style={styles.metricDropdownItemText}>{t('progress:trainingMetricTotal')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.metricDropdownItem}
                  onPress={() => {
                    setWeightMetric('max');
                    closeMetricDropdown();
                  }}
                >
                  <Text style={styles.metricDropdownItemText}>{t('progress:trainingMetricMax')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.metricDropdownItem}
                  onPress={() => {
                    setWeightMetric('reps');
                    closeMetricDropdown();
                  }}
                >
                  <Text style={styles.metricDropdownItemText}>{t('progress:trainingMetricReps')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: '#9AA3A6',
  },
  stepsCard: {
    backgroundColor: '#0E1A1A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2A2C',
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    padding: 12,
  },
  stepsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  stepsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F2F2EE',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  stepsSubtitle: {
    fontSize: 11,
    color: '#9AA3A6',
    marginTop: 2,
  },
  stepsBaseline: {
    fontSize: 11,
    color: '#6F7A7E',
    textAlign: 'right',
  },
  stepsBarsRow: {
    alignItems: 'flex-end',
    gap: 9,
    paddingRight: 4,
  },
  stepsBarItem: {
    width: 30,
    alignItems: 'center',
    gap: 4,
  },
  stepsBarTrack: {
    height: STEPS_BAR_TRACK_HEIGHT,
    width: 14,
    borderRadius: 7,
    backgroundColor: '#0B1114',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  stepsBarFill: {
    width: 14,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
  },
  stepsBarValue: {
    fontSize: 10,
    color: '#F2F2EE',
    fontWeight: '600',
  },
  stepsBarLabel: {
    fontSize: 9,
    color: '#6F7A7E',
  },
  stepsEmptyText: {
    fontSize: 12,
    color: '#9AA3A6',
    lineHeight: 18,
    paddingVertical: 12,
    textAlign: 'center',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyIconImage: {
    width: 48,
    height: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9AA3A6',
    textAlign: 'center',
    lineHeight: 20,
  },
  filtersContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    zIndex: 1000,
    elevation: 1000,
  },
  categoryFilterRow: {
    marginTop: -2,
    marginBottom: 12,
  },
  categoryFilterContent: {
    paddingHorizontal: 16,
  },
  categoryFilterGroup: {
    alignSelf: 'flex-start',
  },
  categoryFilterButton: {
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  categoryFilterButtonText: {
    textAlign: 'center',
  },
  filterGroup: {
    position: 'relative',
    flexDirection: 'row',
    backgroundColor: '#0E1A1A',
    borderRadius: 10,
    padding: 2,
    zIndex: 100,
  },
  filterButton: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  filterButtonActive: {
    backgroundColor: '#0E1A1A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  filterButtonText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#6F7A7E',
  },
  filterButtonTextActive: {
    color: '#F2F2EE',
  },
  metricDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0E1A1A',
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 90,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  metricDropdownText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#F2F2EE',
  },
  metricDropdownArrow: {
    fontSize: 9,
    color: '#9AA3A6',
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  metricDropdownMenuModal: {
    position: 'absolute',
    backgroundColor: '#0E1A1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A3638',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 1000,
  },
  metricDropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  metricDropdownItemText: {
    fontSize: 11,
    color: '#F2F2EE',
  },
  unitToggle: {
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: '#0E1A1A',
    borderRadius: 6,
    minWidth: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A3638',
  },
  unitToggleText: {
    fontSize: 10,
    color: '#F47C3C',
    fontWeight: '600',
  },
  regionSection: {
    marginBottom: 24,
  },
  regionSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 4,
    borderLeftWidth: 4,
    borderLeftColor: '#4ECDC4',
    backgroundColor: '#FAFAFA',
    marginHorizontal: 16,
    borderRadius: 8,
    gap: 10,
  },
  regionHeaderDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  regionHeaderText: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    marginTop: 8,
    paddingHorizontal: 20,
  },
  muscleGroupSection: {
    marginBottom: 20,
    marginTop: 8,
  },
  muscleGroupTitle: {
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 20,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chartsRow: {
    paddingHorizontal: 16,
    gap: 12,
  },
  chartCard: {
    backgroundColor: '#0E1A1A',
    borderRadius: 16,
    padding: 16,
    width: CHART_WIDTH + 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    color: '#9AA3A6',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F2F2EE',
  },
});

