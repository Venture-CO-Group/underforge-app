import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { appIcons } from '../assets/icons';
import { Icon } from './Icon';

interface AiCoachIconProps {
  size?: number;               // diameter in px
  backgroundColor?: string;
  borderColor?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export const AiCoachIcon: React.FC<AiCoachIconProps> = ({
  size = 38,
  backgroundColor = '#E9EDFF',
  borderColor = '#D6DFF7',
  style,
  accessibilityLabel = 'AI Coach'
}) => {
  const radius = size / 2;
  const iconSize = Math.round(size * 0.55);
  
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor,
          borderColor
        },
        style
      ]}
    >
      <Icon source={appIcons.lightbulb} width={iconSize} height={iconSize} fill="#5B6B8A" />
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
});

export default AiCoachIcon;
