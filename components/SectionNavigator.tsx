import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

export type SectionKey = 'you' | 'training_familiarity' | 'health' | 'other';

export const SECTION_ORDER: { key: SectionKey; labelKey: string; iconLib: string; icon: string }[] = [
  { key: 'you', labelKey: 'onboarding:sectionYou', iconLib: 'Ionicons', icon: 'person-circle-outline' },
  { key: 'training_familiarity', labelKey: 'onboarding:sectionTraining', iconLib: 'MaterialCommunityIcons', icon: 'dumbbell' },
  { key: 'health', labelKey: 'onboarding:sectionHealth', iconLib: 'Ionicons', icon: 'heart-outline' },
];

interface SectionNavigatorProps {
  activeSection: SectionKey;
}

export const SectionNavigator: React.FC<SectionNavigatorProps> = ({ activeSection }) => {
  const { t } = useTranslation(['onboarding']);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.sectionNavigator}
      contentContainerStyle={styles.sectionNavigatorContent}
    >
      {SECTION_ORDER.map((section) => {
        const isActive = section.key === activeSection;
        const IconComponent = section.iconLib === 'MaterialCommunityIcons'
          ? MaterialCommunityIcons
          : Ionicons;
        return (
          <View key={section.key} style={styles.sectionItemContainer}>
            <View style={[styles.sectionItem, isActive && styles.sectionItemActive]}>
              <IconComponent
                name={section.icon as any}
                size={16}
                color={isActive ? '#F47C3C' : '#9AA3A6'}
              />
              <Text style={[styles.sectionLabel, isActive && styles.sectionLabelActive]}>
                {t(section.labelKey)}
              </Text>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  sectionNavigator: {
    maxHeight: 60,
    marginBottom: 12,
    width: '100%',
  },
  sectionNavigatorContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionItemContainer: {
    marginHorizontal: 3,
  },
  sectionItem: {
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: '#1E2A2C',
    borderWidth: 1.5,
    borderColor: '#2A3A3C',
    minWidth: 60,
  },
  sectionItemActive: {
    backgroundColor: '#2A1E1A',
    borderColor: '#F47C3C',
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#9AA3A6',
    textAlign: 'center',
    marginTop: 3,
  },
  sectionLabelActive: {
    color: '#F47C3C',
  },
});
