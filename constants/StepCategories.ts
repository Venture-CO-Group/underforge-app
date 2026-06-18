import { ImageSourcePropType } from 'react-native';
import { appIcons } from '../assets/icons';
import { getWellnessDimensionImage } from '../assets/images/categories';
import { WellnessColors } from './Colors';

// Icon key type for type safety
export type IconKey = keyof typeof appIcons;

// Plan section types - the 3 fixed plan components
export type PlanSectionType = 'training' | 'nutrition' | 'sleep_recovery';

// Plan section configuration with display info
export interface PlanSectionConfig {
  label: string;
  iconKey: IconKey;
  color: string;
  backgroundColor: string;
  image: ImageSourcePropType | null;
}

// Three fixed plan sections mapped by step index
export const PLAN_SECTION_CONFIGS: Record<PlanSectionType, PlanSectionConfig> = {
  training: {
    label: 'Training',
    iconKey: 'training',
    color: WellnessColors.training.primary,
    backgroundColor: WellnessColors.training.background,
    image: getWellnessDimensionImage('training'),
  },
  nutrition: {
    label: 'Nutrition',
    iconKey: 'nutrition',
    color: WellnessColors.nutrition.primary,
    backgroundColor: WellnessColors.nutrition.background,
    image: getWellnessDimensionImage('nutrition'),
  },
  sleep_recovery: {
    label: 'Sleep & Recovery',
    iconKey: 'sleep',
    color: WellnessColors.sleep.primary,
    backgroundColor: WellnessColors.sleep.background,
    image: getWellnessDimensionImage('sleep'),
  },
};

// Get plan section type by step index (0=training, 1=nutrition, 2=sleep_recovery)
export function getPlanSectionTypeByIndex(stepIndex: number): PlanSectionType | null {
  switch (stepIndex) {
    case 0: return 'training';
    case 1: return 'nutrition';
    case 2: return 'sleep_recovery';
    default: return null;
  }
}

// Get plan section config by step index
export function getPlanSectionConfig(stepIndex?: number): PlanSectionConfig | null {
  if (stepIndex === undefined) return null;
  const sectionType = getPlanSectionTypeByIndex(stepIndex);
  if (!sectionType) return null;
  return PLAN_SECTION_CONFIGS[sectionType] || null;
}

// Helper function to get the icon component for a given icon key
export function getIconForKey(iconKey: IconKey) {
  return appIcons[iconKey];
}
