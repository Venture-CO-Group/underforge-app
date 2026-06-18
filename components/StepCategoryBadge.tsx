import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { appIcons } from '../assets/icons';
import { getPlanSectionConfig } from '../constants/StepCategories';
import { Icon } from './Icon';

interface StepCategoryBadgeProps {
  stepIndex?: number; // 0=training, 1=nutrition, 2=sleep_recovery
  size?: 'small' | 'medium';
  showLabels?: boolean;
}

/**
 * Displays a plan section badge based on step index
 * Step 0: Training, Step 1: Nutrition, Step 2: Sleep & Recovery
 */
export const StepCategoryBadge: React.FC<StepCategoryBadgeProps> = ({
  stepIndex,
  size = 'small',
  showLabels = true,
}) => {
  const sectionConfig = getPlanSectionConfig(stepIndex);

  if (!sectionConfig) {
    return null;
  }

  const isSmall = size === 'small';
  const badgeStyle = isSmall ? styles.badgeSmall : styles.badgeMedium;
  const textStyle = isSmall ? styles.badgeTextSmall : styles.badgeTextMedium;
  const iconSize = isSmall ? 14 : 18;

  return (
    <View style={styles.container}>
      <View
        style={[
          badgeStyle,
          { backgroundColor: sectionConfig.backgroundColor }
        ]}
      >
        <Icon 
          source={appIcons[sectionConfig.iconKey]} 
          width={iconSize} 
          height={iconSize} 
          fill={sectionConfig.color} 
        />
        {showLabels && (
          <Text style={[textStyle, { color: sectionConfig.color }]}>
            {sectionConfig.label}
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badgeSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  badgeMedium: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  badgeTextSmall: {
    fontSize: 11,
    fontWeight: '600',
  },
  badgeTextMedium: {
    fontSize: 13,
    fontWeight: '600',
  },
});
