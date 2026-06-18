import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Typography } from '../constants/Typography';
import { CoachType } from '../types/onboard';
import { OnboardingConfig } from '../types/onboarding_config';
import { CoachInfoHeader } from './CoachInfoHeader';

interface ChoosePlanAndPricingProps {
  config: OnboardingConfig;
  selectedCoach: string;
  userName?: string;
  selectedCoachType?: CoachType;
  onCoachTypeSelect: (coachType: CoachType) => void;
  onNext: () => void;
}

// Plan features data structure
interface PlanFeature {
  nameKey: string;
  monthlyCheckIn: boolean | string;
  weeklyCheckIn: boolean | string;
  monthlyCall: boolean | string;
}

const planFeatureConfigs: PlanFeature[] = [
  { nameKey: 'plan:choosePlanFeature1', monthlyCheckIn: true, weeklyCheckIn: true, monthlyCall: true },
  { nameKey: 'plan:choosePlanFeature2', monthlyCheckIn: true, weeklyCheckIn: true, monthlyCall: true },
  { nameKey: 'plan:choosePlanFeature3', monthlyCheckIn: true, weeklyCheckIn: true, monthlyCall: true },
  { nameKey: 'plan:choosePlanFeature4', monthlyCheckIn: true, weeklyCheckIn: true, monthlyCall: true },
  { nameKey: 'plan:choosePlanFeature5', monthlyCheckIn: true, weeklyCheckIn: true, monthlyCall: true },
  { nameKey: 'plan:choosePlanFeature6', monthlyCheckIn: false, weeklyCheckIn: true, monthlyCall: true },
  { nameKey: 'plan:choosePlanFeature7', monthlyCheckIn: false, weeklyCheckIn: false, monthlyCall: true },
];

interface PlanOption {
  id: string;
  titleKey: string;
  price: string;
  betaPriceKey: string;
  subtitle: string;
}

const planConfigs: PlanOption[] = [
  { id: 'MONTHLY_CHECK_IN', titleKey: 'plan:choosePlanTitleMonthly', price: '\u20ac14,90', betaPriceKey: 'plan:choosePlanBetaFree', subtitle: '' },
  { id: 'WEEKLY_CHECK_IN', titleKey: 'plan:choosePlanTitleWeekly', price: '\u20ac29,90', betaPriceKey: 'plan:choosePlanBetaFree', subtitle: '' },
  { id: 'MONTHLY_CALL', titleKey: 'plan:choosePlanTitleVideocall', price: '\u20ac99,90', betaPriceKey: 'plan:choosePlanBetaVideocall', subtitle: '' },
];

// Map plan ids to CoachType
const planIdToCoachType: Record<string, CoachType> = {
  MONTHLY_CHECK_IN: CoachType.AI_HUMAN_HYBRID,
  WEEKLY_CHECK_IN: CoachType.AI_HUMAN_HYBRID,
  MONTHLY_CALL: CoachType.AI_HUMAN_HYBRID,
};

export const ChoosePlanAndPricing: React.FC<ChoosePlanAndPricingProps> = ({
  config,
  selectedCoach,
  userName = '',
  selectedCoachType,
  onCoachTypeSelect,
  onNext
}) => {
  const { t } = useTranslation(['plan', 'common']);
  const [selectedPlanId, setSelectedPlanId] = useState<string | undefined>(
    selectedCoachType ? String(selectedCoachType) : undefined
  );

  const handleSelectPlan = (planId: string) => {
    setSelectedPlanId(planId);
  };

  const handleConfirm = () => {
    if (!selectedPlanId) {
      Alert.alert(
        t('plan:choosePlanAlertTitle'),
        t('plan:choosePlanAlertBody'),
        [{ text: t('common:ok'), style: 'default' }]
      );
      return;
    }
    const mapped = planIdToCoachType[selectedPlanId] ?? CoachType.AI_HUMAN_HYBRID;
    onCoachTypeSelect(mapped);
    onNext();
  };

  const renderCheckmark = (value: boolean | string, isSelected: boolean = false) => {
    if (value === true) {
      return <Text style={isSelected ? styles.checkmarkSelected : styles.checkmark}>✓</Text>;
    } else if (value === false) {
      return <Text style={isSelected ? styles.dashSelected : styles.dash}>-</Text>;
    }
    return <Text style={isSelected ? styles.cellTextSelected : styles.cellText}>{value}</Text>;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Coach Info Section */}
        <CoachInfoHeader
          config={config}
          selectedCoach={selectedCoach}
          imageSize="small"
        />

        <ScrollView
          style={styles.contentContainer}
          showsVerticalScrollIndicator={false}
          horizontal={false}
        >
          <Text style={styles.questionText}>
            {t('plan:choosePlanQuestion')}
          </Text>

          {/* Pricing Table */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScrollView}>
            <View style={styles.table}>
              {/* Header Row */}
              <View style={styles.headerRow}>
                <View style={[styles.headerCell, styles.featureColumn]}>
                  <Text style={styles.headerText}></Text>
                </View>
                {planConfigs.map((plan) => (
                  <TouchableOpacity
                    key={plan.id}
                    style={[
                      styles.headerCell,
                      styles.planColumn,
                      selectedPlanId === plan.id && styles.selectedColumn
                    ]}
                    onPress={() => handleSelectPlan(plan.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[selectedPlanId === plan.id ? styles.headerTextSelected : styles.headerText, styles.planTitle]}>{t(plan.titleKey)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Feature Rows */}
              {planFeatureConfigs.map((feature, index) => (
                <View key={index} style={[styles.row, index % 2 === 0 && styles.rowEven]}>
                  <View style={[styles.cell, styles.featureColumn]}>
                    <Text style={styles.featureText}>{t(feature.nameKey)}</Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.cell,
                      styles.planColumn,
                      selectedPlanId === 'MONTHLY_CHECK_IN' && styles.selectedColumn
                    ]}
                    onPress={() => handleSelectPlan('MONTHLY_CHECK_IN')}
                    activeOpacity={0.8}
                  >
                    {renderCheckmark(feature.monthlyCheckIn, selectedPlanId === 'MONTHLY_CHECK_IN')}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.cell,
                      styles.planColumn,
                      selectedPlanId === 'WEEKLY_CHECK_IN' && styles.selectedColumn
                    ]}
                    onPress={() => handleSelectPlan('WEEKLY_CHECK_IN')}
                    activeOpacity={0.8}
                  >
                    {renderCheckmark(feature.weeklyCheckIn, selectedPlanId === 'WEEKLY_CHECK_IN')}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.cell,
                      styles.planColumn,
                      selectedPlanId === 'MONTHLY_CALL' && styles.selectedColumn
                    ]}
                    onPress={() => handleSelectPlan('MONTHLY_CALL')}
                    activeOpacity={0.8}
                  >
                    {renderCheckmark(feature.monthlyCall, selectedPlanId === 'MONTHLY_CALL')}
                  </TouchableOpacity>
                </View>
              ))}

              {/* Price Row */}
              <View style={[styles.row, styles.priceRow]}>
                <View style={[styles.cell, styles.featureColumn]}>
                  <Text style={styles.priceLabel}>{t('plan:choosePlanMonthlySubscription')}</Text>
                </View>
                {planConfigs.map((plan) => (
                  <TouchableOpacity
                    key={plan.id}
                    style={[
                      styles.cell,
                      styles.planColumn,
                      selectedPlanId === plan.id && styles.selectedColumn
                    ]}
                    onPress={() => handleSelectPlan(plan.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={selectedPlanId === plan.id ? styles.originalPriceSelected : styles.originalPrice}>{plan.price}</Text>
                    <Text style={selectedPlanId === plan.id ? styles.betaPriceSelected : styles.betaPrice}>{t(plan.betaPriceKey)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>

          {/* Kick-off call info */}
          <View style={styles.kickoffSection}>
            <Text style={styles.kickoffTitle}>{t('plan:choosePlanKickoffTitle')}</Text>
            <Text style={styles.kickoffPrice}>{t('plan:choosePlanKickoffPrice')}</Text>
            <Text style={styles.kickoffSubtext}>{t('plan:choosePlanKickoffSubtext')}</Text>
          </View>

          {/* Footnote */}
          <Text style={styles.footnote}>
            {t('plan:choosePlanFootnote')}
          </Text>
        </ScrollView>

        <View style={styles.buttonSection}>
          <TouchableOpacity
            style={[styles.nextButton, !selectedPlanId && styles.nextButtonDisabled]}
            onPress={handleConfirm}
            disabled={!selectedPlanId}
          >
            <Text style={styles.nextButtonText}>{t('plan:choosePlanConfirmButton')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0E1A1A'
  },
  container: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 24,
    paddingBottom: 16
  },
  contentContainer: {
    flex: 1
  },
  questionText: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: Typography.fontFamily.semiBold,
    color: '#F2F2EE',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 24,
  },

  // Table styles
  tableScrollView: {
    marginBottom: 12,
  },
  table: {
    borderWidth: 1,
    borderColor: '#1E2A2C',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0E1A1A',
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#141E1E',
    borderBottomWidth: 2,
    borderBottomColor: '#1A2426',
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1A2426',
  },
  rowEven: {
    backgroundColor: '#141E1E',
  },
  priceRow: {
    backgroundColor: '#141E1E',
    borderBottomWidth: 0,
  },
  headerCell: {
    padding: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#e0e0e0',
  },
  cell: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#e0e0e0',
    minHeight: 40,
  },
  featureColumn: {
    width: 180,
    alignItems: 'flex-start',
    paddingLeft: 12,
  },
  planColumn: {
    width: 120,
  },
  selectedColumn: {
    backgroundColor: '#F47C3C',
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderLeftColor: '#F47C3C',
    borderRightColor: '#F47C3C',
  },
  headerText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Typography.fontFamily.bold,
    color: '#F2F2EE',
    textAlign: 'center',
  },
  headerTextSelected: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Typography.fontFamily.bold,
    color: '#fff',
    textAlign: 'center',
  },
  planTitle: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    lineHeight: 16,
  },
  featureText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: '#F2F2EE',
    lineHeight: 16,
  },
  featureTextSelected: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: '#fff',
    lineHeight: 16,
  },
  checkmark: {
    fontSize: 16,
    color: '#4FAE8A',
    fontWeight: 'bold',
  },
  checkmarkSelected: {
    fontSize: 16,
    color: '#fff',
    fontWeight: 'bold',
  },
  dash: {
    fontSize: 16,
    color: '#6F7A7E',
  },
  dashSelected: {
    fontSize: 16,
    color: '#fff',
  },
  cellText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: '#F2F2EE',
    textAlign: 'center',
  },
  cellTextSelected: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: '#fff',
    textAlign: 'center',
  },
  priceLabel: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Typography.fontFamily.semiBold,
    color: '#F2F2EE',
  },
  priceLabelSelected: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Typography.fontFamily.semiBold,
    color: '#fff',
  },
  originalPrice: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: '#6F7A7E',
    textDecorationLine: 'line-through',
    marginBottom: 2,
  },
  originalPriceSelected: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: '#fff',
    textDecorationLine: 'line-through',
    marginBottom: 2,
  },
  betaPrice: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Typography.fontFamily.bold,
    color: '#F47C3C',
  },
  betaPriceSelected: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Typography.fontFamily.bold,
    color: '#fff',
  },

  // Kick-off section
  kickoffSection: {
    backgroundColor: '#141E1E',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  kickoffTitle: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Typography.fontFamily.semiBold,
    color: '#F2F2EE',
    marginBottom: 3,
  },
  kickoffPrice: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Typography.fontFamily.bold,
    color: '#F47C3C',
    marginBottom: 6,
  },
  kickoffSubtext: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: '#9AA3A6',
    lineHeight: 15,
  },

  // Footnote
  footnote: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: '#9AA3A6',
    fontStyle: 'italic',
    lineHeight: 14,
    marginTop: 6,
    marginBottom: 12,
  },

  // Button
  buttonSection: {
    paddingBottom: 16,
    paddingTop: 8
  },
  nextButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 14,
    borderRadius: 25,
    alignItems: 'center',
  },
  nextButtonDisabled: {
    backgroundColor: '#ccc',
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: Typography.fontFamily.bold,
  },
});
