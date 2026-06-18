import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { appIcons } from '../assets/icons';
import { Icon } from './Icon';
import { ThemedText } from './ThemedText';

interface BottomTabNavigationProps {
  activeTab: 'home' | 'plan' | 'progress' | 'games';
  onTabPress: (tab: 'home' | 'plan' | 'progress' | 'games') => void;
  onLogPress?: () => void;
}

export const BottomTabNavigation: React.FC<BottomTabNavigationProps> = ({
  activeTab,
  onTabPress,
  onLogPress,
}) => {
  const { t } = useTranslation(['main']);

  const leftTabs = [
    { id: 'home', label: t('main:tabHome'), icon: appIcons.home_actual },
    { id: 'plan', label: t('main:tabPlan'), icon: appIcons.lists },
  ];

  const rightTabs = [
    { id: 'progress', label: t('main:tabProgress'), icon: appIcons.bar_chart },
    { id: 'games', label: t('main:tabSocial'), icon: appIcons.communities },
  ];

  const renderTab = (tab: { id: string; label: string; icon: any }) => (
    <TouchableOpacity
      key={tab.id}
      style={[
        styles.tab,
        activeTab === tab.id && styles.activeTab
      ]}
      onPress={() => onTabPress(tab.id as any)}
      activeOpacity={0.7}
    >
      <Icon
        source={tab.icon}
        width={20}
        height={20}
        fill={activeTab === tab.id ? '#F47C3C' : '#6F7A7E'}
        style={styles.iconImage}
      />
      <ThemedText type="defaultSemiBold" style={[
        styles.label,
        activeTab === tab.id && styles.activeLabel
      ]}>
        {tab.label}
      </ThemedText>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {leftTabs.map(renderTab)}

      {/* Center Log Button — raised above the tab bar */}
      <View style={styles.logButtonWrapper}>
        <TouchableOpacity
          style={styles.logButton}
          onPress={onLogPress}
          activeOpacity={0.75}
        >
          {/* Outer glow ring */}
          <View style={styles.logButtonGlow} />
          {/* Main button surface */}
          <View style={styles.logButtonSurface}>
            <Text style={styles.logButtonPlus}>+</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.logButtonLabel}>{t('main:tabLog')}</Text>
      </View>

      {rightTabs.map(renderTab)}
    </View>
  );
};

const LOG_BUTTON_SIZE = 54;
const LOG_GLOW_SIZE = LOG_BUTTON_SIZE + 8;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#0E1A1A',
    borderTopWidth: 1,
    borderTopColor: '#1A2426',
    paddingBottom: 10,
    paddingTop: 10,
    justifyContent: 'space-around',
    alignItems: 'flex-end',
  },
  tab: {
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    flex: 1,
  },
  activeTab: {
    backgroundColor: '#141E1E',
    borderRadius: 10,
  },
  icon: {
    fontSize: 20,
    marginBottom: 4,
  },
  iconImage: {
    marginBottom: 4,
  },
  label: {
    fontSize: 10,
    color: '#6F7A7E',
  },
  activeLabel: {
    color: '#F47C3C',
  },

  // ── Center Log Button ──────────────────────────────────────────────
  logButtonWrapper: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    // Raise the button so it overlaps the tab bar border
    marginTop: -32,
    width: LOG_GLOW_SIZE + 12,
  },
  logButton: {
    width: LOG_GLOW_SIZE,
    height: LOG_GLOW_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logButtonGlow: {
    position: 'absolute',
    width: LOG_GLOW_SIZE,
    height: LOG_GLOW_SIZE,
    borderRadius: LOG_GLOW_SIZE / 2,
    backgroundColor: 'rgba(244, 124, 60, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(244, 124, 60, 0.2)',
  },
  logButtonSurface: {
    width: LOG_BUTTON_SIZE,
    height: LOG_BUTTON_SIZE,
    borderRadius: LOG_BUTTON_SIZE / 2,
    backgroundColor: '#F47C3C',
    alignItems: 'center',
    justifyContent: 'center',
    // Premium depth: layered shadows
    shadowColor: '#F47C3C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 10,
  },
  logButtonPlus: {
    fontSize: 28,
    fontFamily: 'Inter-Bold',
    color: '#0B1114',
    lineHeight: 30,
    // Optical center adjustment
    marginTop: -1,
  },
  logButtonLabel: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#F47C3C',
    marginTop: 4,
    letterSpacing: 0.3,
  },
});
