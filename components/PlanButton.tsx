import React from 'react';
import { GestureResponderEvent, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { appIcons } from '../assets/icons';
import { Icon } from './Icon';

type IconKey = keyof typeof appIcons;

interface PlanButtonProps {
  onPress?: (e: GestureResponderEvent) => void;
  label?: string;
  iconKey?: IconKey;
  containerStyle?: ViewStyle;
  accessibilityLabel?: string;
}

export default function PlanButton({
  onPress,
  label,
  iconKey = 'clipboard',
  containerStyle,
  accessibilityLabel,
}: PlanButtonProps) {
  const { t } = useTranslation(['main', 'progress']);
  const resolvedLabel = label ?? t('main:tabPlan');
  const resolvedA11y = accessibilityLabel ?? t('progress:planButtonA11y');
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.touchable, containerStyle]}
      accessibilityRole="button"
      accessibilityLabel={resolvedA11y}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <View style={styles.inner}>
        <Icon source={appIcons[iconKey]} width={18} height={18} fill="#F47C3C" />
        <Text
          style={styles.text}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          allowFontScaling={true}
        >
          {resolvedLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchable: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  text: {
    fontSize: 10,
    color: '#F47C3C',
    fontWeight: '600',
    flexShrink: 1,
    maxWidth: 40,
  },
});
