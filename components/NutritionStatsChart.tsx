import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { useActiveOverlay } from '@/hooks/useActiveOverlay';
import {
  calculateWeeklyNutritionStats,
  DailyNutritionData,
  NutritionPeriod,
  syncMealLogsFromSupabase,
  WeeklyNutritionStats,
} from '../lib/nutrition-storage';
import { retryPendingMealLogs } from '../lib/sync-status';

// Colors matching MacrosChart - softer, muted tones
const COLORS = {
  carbs: '#8B6E6E',    // Dusty rose
  protein: '#5A9E97',  // Sage teal
  fat: '#B89878',      // Warm sand
  fiber: '#7E78A8',    // Muted lavender
  calories: '#333333',
  target: '#4FAE8A',
  background: '#0B1114',
  cardBg: '#0E1A1A',
  textPrimary: '#F2F2EE',
  textSecondary: '#9AA3A6',
  border: '#1E2A2C',
  accent: '#F47C3C',
};

/**
 * Format large numbers in thousands for compact display
 * e.g., 2000 → "2k", 1500 → "1.5k", 500 → "500"
 */
const formatInThousands = (value: number): string => {
  if (value >= 1000) {
    const thousands = value / 1000;
    // Show one decimal place if there's a fractional part
    return thousands % 1 === 0 
      ? `${thousands}k` 
      : `${thousands.toFixed(1)}k`;
  }
  return Math.round(value).toString();
};

interface NutritionStatsChartProps {
  userId: string;
  userTimezone?: string | null;
}

export const NutritionStatsChart: React.FC<NutritionStatsChartProps> = ({
  userId,
  userTimezone = null,
}) => {
  const { t } = useTranslation(['progress']);
  const [period, setPeriod] = useState<NutritionPeriod>('current');
  const [stats, setStats] = useState<WeeklyNutritionStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const {
    isOpen: showPeriodDropdown,
    closeSelf: closePeriodDropdown,
    toggle: togglePeriodDropdown,
  } = useActiveOverlay('nutritionStats.period');
  const [tooltipData, setTooltipData] = useState<DailyNutritionData | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Retry any pending meal log syncs
      retryPendingMealLogs().catch(console.error);
      
      // Sync from Supabase to ensure local cache is up to date
      await syncMealLogsFromSupabase(userId);
      
      // Calculate stats
      const weeklyStats = await calculateWeeklyNutritionStats(userId, userTimezone, period);
      setStats(weeklyStats);
    } catch (error) {
      console.error('Error loading nutrition stats:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, userTimezone, period]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handlePeriodChange = (newPeriod: NutritionPeriod) => {
    setPeriod(newPeriod);
    closePeriodDropdown();
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.accent} />
        <Text style={styles.loadingText}>{t('progress:nutritionStatsLoading')}</Text>
      </View>
    );
  }

  if (!stats) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{t('progress:nutritionStatsError')}</Text>
      </View>
    );
  }

  const { dailyData, weeklyTotals, daysElapsed, targets } = stats;
  const hasActualLogs = dailyData.some(day => day.calories > 0 || day.carbs > 0 || day.protein > 0 || day.fat > 0);

  // Calculate max values for scaling
  const maxMacroTotal = Math.max(...dailyData.map(d => d.carbs + d.protein + d.fat), 1);
  const maxCalories = Math.max(...dailyData.map(d => d.calories), targets.calories, 100);

  // Calculate percentages for weekly totals
  const safeDaysElapsed = daysElapsed || 1;
  const targetCaloriesWeek = targets.calories * safeDaysElapsed;
  const targetCarbsWeek = targets.carbs * safeDaysElapsed;
  const targetProteinWeek = targets.protein * safeDaysElapsed;
  const targetFatWeek = targets.fat * safeDaysElapsed;
  const targetFiberWeek = targets.fiber * safeDaysElapsed;

  const carbsPercentage = Math.round((weeklyTotals.carbs / targetCarbsWeek) * 100) || 0;
  const proteinPercentage = Math.round((weeklyTotals.protein / targetProteinWeek) * 100) || 0;
  const fatPercentage = Math.round((weeklyTotals.fat / targetFatWeek) * 100) || 0;
  const fiberPercentage = Math.round((weeklyTotals.fiber / targetFiberWeek) * 100) || 0;
  const caloriesPercentage = Math.round((weeklyTotals.calories / targetCaloriesWeek) * 100) || 0;

  const is2WeeksView = period === '2weeks';
  const totalMacros = weeklyTotals.carbs + weeklyTotals.protein + weeklyTotals.fat;

  return (
    <View style={styles.container}>
      {/* Header with Period Selector */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('progress:nutritionStatsTitle')}</Text>
        <View style={styles.periodSelectorContainer}>
          <TouchableOpacity
            style={styles.periodSelector}
            onPress={togglePeriodDropdown}
          >
            <Text style={styles.periodSelectorText}>
              {period === 'current' ? t('progress:nutritionPeriodCurrentWeek') : t('progress:nutritionPeriod2Weeks')}
            </Text>
            <Text style={styles.periodArrow}>{showPeriodDropdown ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {showPeriodDropdown && (
            <View style={styles.dropdown}>
              <TouchableOpacity
                style={[styles.dropdownItem, period === 'current' && styles.dropdownItemSelected]}
                onPress={() => handlePeriodChange('current')}
              >
                <Text style={[styles.dropdownItemText, period === 'current' && styles.dropdownItemTextSelected]}>
                  {t('progress:nutritionPeriodCurrentWeek')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dropdownItem, period === '2weeks' && styles.dropdownItemSelected]}
                onPress={() => handlePeriodChange('2weeks')}
              >
                <Text style={[styles.dropdownItemText, period === '2weeks' && styles.dropdownItemTextSelected]}>
                  {t('progress:nutritionPeriod2Weeks')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Close dropdown overlay */}
      {showPeriodDropdown && (
        <TouchableOpacity
          style={styles.dropdownOverlay}
          onPress={closePeriodDropdown}
          activeOpacity={1}
        />
      )}

      {!hasActualLogs && (
        <Text style={styles.noDataMessage}>{t('progress:nutritionNoLogs')}</Text>
      )}

      {/* Daily Calories Bar Chart */}
      <View style={styles.chartSection}>
        <Text style={[styles.chartTitle, styles.chartTitleCentered]}>
          {t('progress:nutritionChartCalories')} <Text style={styles.chartPeriodText}>({period === 'current' ? t('progress:nutritionPeriodCurrentWeek') : t('progress:nutritionPeriod2Weeks')})</Text>
        </Text>
        <View style={styles.chartSpacer} />
        <View style={styles.chartWrapper}>
          <View style={styles.chartAxis}>
            <Text style={styles.axisLabel}>{formatInThousands(maxCalories)}</Text>
            <Text style={styles.axisLabel}>{formatInThousands(maxCalories * 0.5)}</Text>
            <Text style={styles.axisLabel}>0</Text>
          </View>
          
          <View style={[styles.barsContainer, styles.calorieChartContainer, is2WeeksView && styles.barsContainerNarrow]}>
            {/* Target line */}
            <View 
              style={[
                styles.targetLine, 
                { bottom: `${(targets.calories / maxCalories) * 100}%` }
              ]}
            >
              <Text style={styles.targetLineLabel}>{t('progress:nutritionTargetLabel', { value: formatInThousands(targets.calories) })}</Text>
            </View>

            {dailyData.map((day, index) => {
              const calorieHeight = day.calories > 0 ? (day.calories / maxCalories) * 100 : 0;
              const isAboveTarget = day.calories > targets.calories;

              return (
                <View 
                  key={index} 
                  style={[
                    styles.barContainer, 
                    day.isFuture && styles.futureDay,
                    is2WeeksView && styles.barContainerNarrow
                  ]}
                >
                  <View style={styles.calorieBarWrapper}>
                    <View 
                      style={[
                        styles.calorieBar, 
                        { height: `${calorieHeight}%` },
                        isAboveTarget && styles.calorieBarAboveTarget
                      ]}
                    />
                    {day.calories > 0 && (
                      <Text style={styles.calorieValue}>{formatInThousands(day.calories)}</Text>
                    )}
                  </View>
                  <Text style={[styles.barLabel, is2WeeksView && styles.barLabelNarrow]}>
                    {day.dayName}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
        
        {/* Legend note for thousands formatting */}
        <Text style={styles.legendNote}>{t('progress:nutritionLegendNote')}</Text>
      </View>

      {/* Daily Distribution - % calorie breakdown by macro */}
      <View style={styles.chartSection}>
        <Text style={[styles.chartTitle, styles.chartTitleCentered]}>
          {t('progress:nutritionChartDistribution')} <Text style={styles.chartPeriodText}>({period === 'current' ? t('progress:nutritionPeriodCurrentWeek') : t('progress:nutritionPeriod2Weeks')})</Text>
        </Text>
        <View style={styles.chartSpacer} />
        <View style={styles.chartWrapper}>
          <View style={styles.chartAxis}>
            <Text style={styles.axisLabel}>100%</Text>
            <Text style={styles.axisLabel}>50%</Text>
            <Text style={styles.axisLabel}>0%</Text>
          </View>
          
          <View style={[styles.barsContainer, is2WeeksView && styles.barsContainerNarrow]}>
            {dailyData.map((day, index) => {
              // Calculate calories from each macro
              const carbsCal = day.carbs * 4;
              const proteinCal = day.protein * 4;
              const fatCal = day.fat * 9;
              const totalCal = carbsCal + proteinCal + fatCal;
              const carbsPct = totalCal > 0 ? (carbsCal / totalCal) * 100 : 0;
              const proteinPct = totalCal > 0 ? (proteinCal / totalCal) * 100 : 0;
              const fatPct = totalCal > 0 ? (fatCal / totalCal) * 100 : 0;

              return (
                <View
                  key={index}
                  style={[
                    styles.barContainer, 
                    day.isFuture && styles.futureDay,
                    is2WeeksView && styles.barContainerNarrow
                  ]}
                >
                  <View style={styles.stackedBar}>
                    {totalCal > 0 ? (
                      <>
                        {fatPct > 0 && (
                          <View style={[styles.barSegment, styles.distBarSegment, { height: `${fatPct}%`, backgroundColor: COLORS.fat }]}>
                            {!is2WeeksView && fatPct >= 10 && <Text style={styles.barValue}>{Math.round(fatPct)}%</Text>}
                          </View>
                        )}
                        {proteinPct > 0 && (
                          <View style={[styles.barSegment, styles.distBarSegment, { height: `${proteinPct}%`, backgroundColor: COLORS.protein }]}>
                            {!is2WeeksView && proteinPct >= 10 && <Text style={styles.barValue}>{Math.round(proteinPct)}%</Text>}
                          </View>
                        )}
                        {carbsPct > 0 && (
                          <View style={[styles.barSegment, styles.distBarSegment, { height: `${carbsPct}%`, backgroundColor: COLORS.carbs }]}>
                            {!is2WeeksView && carbsPct >= 10 && <Text style={styles.barValue}>{Math.round(carbsPct)}%</Text>}
                          </View>
                        )}
                      </>
                    ) : null}
                  </View>
                  <Text style={[styles.barLabel, is2WeeksView && styles.barLabelNarrow]}>
                    {day.dayOfMonth}.{day.monthNum}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.carbs }]} />
            <Text style={styles.legendText}>{t('progress:nutritionLegendCarbs')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.protein }]} />
            <Text style={styles.legendText}>{t('progress:nutritionLegendProtein')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.fat }]} />
            <Text style={styles.legendText}>{t('progress:nutritionLegendFat')}</Text>
          </View>
        </View>
      </View>

      {/* Stacked Macro Bar Chart */}
      <View style={styles.chartSection}>
        <Text style={[styles.chartTitle, styles.chartTitleCentered]}>
          {t('progress:nutritionChartMacros')} <Text style={styles.chartPeriodText}>({period === 'current' ? t('progress:nutritionPeriodCurrentWeek') : t('progress:nutritionPeriod2Weeks')})</Text>
        </Text>
        <View style={styles.chartSpacer} />
        <View style={styles.chartWrapper}>
          <View style={styles.chartAxis}>
            <Text style={styles.axisLabel}>{Math.round(maxMacroTotal)}g</Text>
            <Text style={styles.axisLabel}>{Math.round(maxMacroTotal * 0.5)}g</Text>
            <Text style={styles.axisLabel}>0g</Text>
          </View>
          
          <View style={[styles.barsContainer, is2WeeksView && styles.barsContainerNarrow]}>
            {dailyData.map((day, index) => {
              const totalMacros = day.carbs + day.protein + day.fat;
              const carbsHeight = totalMacros > 0 ? (day.carbs / maxMacroTotal) * 100 : 0;
              const proteinHeight = totalMacros > 0 ? (day.protein / maxMacroTotal) * 100 : 0;
              const fatHeight = totalMacros > 0 ? (day.fat / maxMacroTotal) * 100 : 0;

              return (
                <Pressable
                  key={index}
                  onPress={() => {
                    if (is2WeeksView && totalMacros > 0) {
                      setTooltipData(day);
                    }
                  }}
                  style={[
                    styles.barContainer, 
                    day.isFuture && styles.futureDay,
                    is2WeeksView && styles.barContainerNarrow
                  ]}
                >
                  <View style={styles.stackedBar}>
                    {day.fat > 0 && (
                      <View style={[styles.barSegment, { height: `${fatHeight}%`, backgroundColor: COLORS.fat }]}>
                        {!is2WeeksView && <Text style={styles.barValue}>{day.fat}g</Text>}
                      </View>
                    )}
                    {day.protein > 0 && (
                      <View style={[styles.barSegment, { height: `${proteinHeight}%`, backgroundColor: COLORS.protein }]}>
                        {!is2WeeksView && <Text style={styles.barValue}>{day.protein}g</Text>}
                      </View>
                    )}
                    {day.carbs > 0 && (
                      <View style={[styles.barSegment, { height: `${carbsHeight}%`, backgroundColor: COLORS.carbs }]}>
                        {!is2WeeksView && <Text style={styles.barValue}>{day.carbs}g</Text>}
                      </View>
                    )}
                  </View>
                  <Text style={[styles.barLabel, is2WeeksView && styles.barLabelNarrow]}>
                    {day.dayOfMonth}.{day.monthNum}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.carbs }]} />
            <Text style={styles.legendText}>{t('progress:nutritionLegendCarbs')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.protein }]} />
            <Text style={styles.legendText}>{t('progress:nutritionLegendProtein')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.fat }]} />
            <Text style={styles.legendText}>{t('progress:nutritionLegendFat')}</Text>
          </View>
        </View>
      </View>

      {/* Weekly Totals */}
      <View style={styles.totalsSection}>
        <Text style={[styles.totalsTitle, styles.totalsTitleCentered]}>
          {period === '2weeks' ? t('progress:nutritionTotals2Week') : t('progress:nutritionTotalsWeekly')} <Text style={styles.chartPeriodText}>({daysElapsed === 1 ? t('progress:nutritionTableDaySingular', { count: daysElapsed }) : t('progress:nutritionTableDayPlural', { count: daysElapsed })})</Text>
        </Text>
        <View style={styles.chartSpacer} />
        {/* Table Header */}
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.tableCol1]}>{t('progress:nutritionTableMacro')}</Text>
          <Text style={[styles.tableHeaderText, styles.tableCol2]}>{t('progress:nutritionTableQty')}</Text>
          <Text style={[styles.tableHeaderText, styles.tableCol3]}>{t('progress:nutritionTablePctTotal')}</Text>
          <Text style={[styles.tableHeaderText, styles.tableCol4]}>{t('progress:nutritionTablePctTarget')}</Text>
        </View>

        {/* Table Rows */}
        <View style={styles.tableBody}>
          {/* Carbohydrates */}
          <View style={styles.tableRow}>
            <View style={[styles.tableCol1, styles.tableCell]}>
              <View style={styles.tableCellContent}>
                <View style={[styles.macroDot, { backgroundColor: COLORS.carbs }]} />
                <Text style={styles.macroName}>{t('progress:nutritionTableCarbs')}</Text>
              </View>
            </View>
            <Text style={[styles.tableCol2, styles.tableCell, styles.tableCellText]}>{weeklyTotals.carbs}g</Text>
            <Text style={[styles.tableCol3, styles.tableCell, styles.tableCellText]}>
              {totalMacros > 0 ? Math.round((weeklyTotals.carbs / totalMacros) * 100) : 0}%
            </Text>
            <Text style={[styles.tableCol4, styles.tableCell, styles.tableCellText]}>{carbsPercentage}%</Text>
          </View>

          {/* Protein */}
          <View style={styles.tableRow}>
            <View style={[styles.tableCol1, styles.tableCell]}>
              <View style={styles.tableCellContent}>
                <View style={[styles.macroDot, { backgroundColor: COLORS.protein }]} />
                <Text style={styles.macroName}>{t('progress:nutritionTableProtein')}</Text>
              </View>
            </View>
            <Text style={[styles.tableCol2, styles.tableCell, styles.tableCellText]}>{weeklyTotals.protein}g</Text>
            <Text style={[styles.tableCol3, styles.tableCell, styles.tableCellText]}>
              {totalMacros > 0 ? Math.round((weeklyTotals.protein / totalMacros) * 100) : 0}%
            </Text>
            <Text style={[styles.tableCol4, styles.tableCell, styles.tableCellText]}>{proteinPercentage}%</Text>
          </View>

          {/* Fat */}
          <View style={styles.tableRow}>
            <View style={[styles.tableCol1, styles.tableCell]}>
              <View style={styles.tableCellContent}>
                <View style={[styles.macroDot, { backgroundColor: COLORS.fat }]} />
                <Text style={styles.macroName}>{t('progress:nutritionTableFat')}</Text>
              </View>
            </View>
            <Text style={[styles.tableCol2, styles.tableCell, styles.tableCellText]}>{weeklyTotals.fat}g</Text>
            <Text style={[styles.tableCol3, styles.tableCell, styles.tableCellText]}>
              {totalMacros > 0 ? Math.round((weeklyTotals.fat / totalMacros) * 100) : 0}%
            </Text>
            <Text style={[styles.tableCol4, styles.tableCell, styles.tableCellText]}>{fatPercentage}%</Text>
          </View>

          {/* Fiber */}
          <View style={styles.tableRow}>
            <View style={[styles.tableCol1, styles.tableCell]}>
              <View style={styles.tableCellContent}>
                <View style={[styles.macroDot, { backgroundColor: COLORS.fiber }]} />
                <Text style={styles.macroName}>{t('progress:nutritionTableFiber')}</Text>
              </View>
            </View>
            <Text style={[styles.tableCol2, styles.tableCell, styles.tableCellText]}>{weeklyTotals.fiber}g</Text>
            <Text style={[styles.tableCol3, styles.tableCell, styles.tableCellText]}>
              {totalMacros > 0 ? Math.round((weeklyTotals.fiber / totalMacros) * 100) : 0}%
            </Text>
            <Text style={[styles.tableCol4, styles.tableCell, styles.tableCellText]}>{fiberPercentage}%</Text>
          </View>

          {/* Calories */}
          <View style={styles.tableRow}>
            <View style={[styles.tableCol1, styles.tableCell]}>
              <View style={styles.tableCellContent}>
                <View style={[styles.macroDot, { backgroundColor: COLORS.calories }]} />
                <Text style={styles.macroName}>{t('progress:nutritionTableCalories')}</Text>
              </View>
            </View>
            <Text style={[styles.tableCol2, styles.tableCell, styles.tableCellText]}>{formatInThousands(weeklyTotals.calories)} cal</Text>
            <Text style={[styles.tableCol3, styles.tableCell, styles.tableCellText, styles.naText]}>{t('progress:nutritionTableNA')}</Text>
            <Text style={[styles.tableCol4, styles.tableCell, styles.tableCellText]}>{caloriesPercentage}%</Text>
          </View>
        </View>

        <Text style={styles.targetInfo}>
          {t('progress:nutritionDailyTargets', { carbs: targets.carbs, protein: targets.protein, fat: targets.fat, calories: formatInThousands(targets.calories) })}
        </Text>
      </View>

      {/* Tooltip Modal for 2-week view */}
      {tooltipData && (
        <Modal
          transparent
          visible={!!tooltipData}
          animationType="fade"
          onRequestClose={() => setTooltipData(null)}
        >
          <Pressable style={styles.tooltipOverlay} onPress={() => setTooltipData(null)}>
            <View style={styles.tooltip}>
              <Text style={styles.tooltipTitle}>
                {tooltipData.dayOfMonth}.{tooltipData.monthNum}
              </Text>
              {tooltipData.carbs > 0 && (
                <Text style={styles.tooltipText}>
                  <Text style={{ color: COLORS.carbs }}>{t('progress:nutritionTooltipCarbs')}</Text> {tooltipData.carbs}g
                </Text>
              )}
              {tooltipData.protein > 0 && (
                <Text style={styles.tooltipText}>
                  <Text style={{ color: COLORS.protein }}>{t('progress:nutritionTooltipProtein')}</Text> {tooltipData.protein}g
                </Text>
              )}
              {tooltipData.fat > 0 && (
                <Text style={styles.tooltipText}>
                  <Text style={{ color: COLORS.fat }}>{t('progress:nutritionTooltipFat')}</Text> {tooltipData.fat}g
                </Text>
              )}
            </View>
          </Pressable>
        </Modal>
      )}
    </View>
  );
};

const CHART_HEIGHT = 150;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    zIndex: 100,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  periodSelectorContainer: {
    position: 'relative',
    zIndex: 101,
  },
  periodSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  periodSelectorText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  periodArrow: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    backgroundColor: COLORS.cardBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    minWidth: 140,
    zIndex: 102,
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownItemSelected: {
    backgroundColor: '#141E1E',
  },
  dropdownItemText: {
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  dropdownItemTextSelected: {
    color: COLORS.accent,
    fontWeight: '600',
  },
  dropdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99,
  },
  noDataMessage: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    paddingVertical: 20,
  },
  chartSection: {
    marginBottom: 32,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  chartTitleCentered: {
    textAlign: 'center',
  },
  chartPeriodText: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.textSecondary,
  },
  chartSpacer: {
    height: 12,
  },
  chartWrapper: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  chartAxis: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    minWidth: 40,
    height: CHART_HEIGHT,
    paddingBottom: 30,
  },
  axisLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: 'right',
  },
  barsContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: CHART_HEIGHT,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 30,
  },
  barsContainerNarrow: {
    gap: 2,
  },
  calorieChartContainer: {
    position: 'relative',
  },
  barContainer: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
  },
  barContainerNarrow: {
    flex: 0.35,
    minWidth: 12,
  },
  futureDay: {
    opacity: 0.3,
  },
  stackedBar: {
    width: '100%',
    height: '100%',
    justifyContent: 'flex-end',
    gap: 2,
  },
  barSegment: {
    width: '100%',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
    minHeight: 2,
  },
  distBarSegment: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    justifyContent: 'center',
    paddingTop: 0,
  },
  barValue: {
    fontSize: 8,
    fontWeight: '600',
    color: '#2A2A2A',
    textShadowColor: 'transparent',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
  barLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 8,
    height: 22,
  },
  barLabelNarrow: {
    fontSize: 8,
  },
  calorieBarWrapper: {
    width: '100%',
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  calorieBar: {
    width: '100%',
    backgroundColor: 'rgba(244, 124, 60, 0.65)',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  calorieBarAboveTarget: {
    backgroundColor: 'rgba(198, 91, 91, 0.65)',
  },
  calorieValue: {
    position: 'absolute',
    top: -15,
    fontSize: 8,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  targetLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: COLORS.target,
    zIndex: 1,
  },
  targetLineLabel: {
    position: 'absolute',
    right: 0,
    top: -10,
    fontSize: 10,
    color: COLORS.target,
    fontWeight: '500',
    backgroundColor: COLORS.cardBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  totalsSection: {
    marginTop: 8,
  },
  totalsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  totalsTitleCentered: {
    textAlign: 'center',
  },
  totalsSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  totalsSubtitleCentered: {
    textAlign: 'center',
  },
  // Table Styles
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: COLORS.border,
    paddingBottom: 8,
    marginBottom: 8,
  },
  tableHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  tableBody: {
    gap: 8,
    marginBottom: 16,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  tableCell: {
    paddingHorizontal: 4,
  },
  tableCellText: {
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  tableCellContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tableCol1: {
    flex: 1.5,
  },
  tableCol2: {
    flex: 1.2,
    textAlign: 'right',
  },
  tableCol3: {
    flex: 1.2,
    textAlign: 'right',
  },
  tableCol4: {
    flex: 1.2,
    textAlign: 'right',
  },
  naText: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  macroDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  macroName: {
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  // Tooltip Styles
  tooltipOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tooltip: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 8,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
    minWidth: 120,
    alignSelf: 'center',
  },
  tooltipTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  tooltipText: {
    fontSize: 12,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  targetInfo: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  legendNote: {
    fontSize: 10,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    fontStyle: 'italic',
  },
});

export default NutritionStatsChart;

