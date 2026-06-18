import React from 'react';
import { View, ViewStyle } from 'react-native';
import { SvgProps } from 'react-native-svg';

interface IconProps {
  source: React.FC<SvgProps>;
  width?: number;
  height?: number;
  fill?: string;
  style?: ViewStyle;
}

export const Icon: React.FC<IconProps> = ({
  source: IconComponent,
  width = 24,
  height = 24,
  fill = '#FFFFFF',
  style
}) => {
  return (
    <View style={[{ width, height }, style]}>
      <IconComponent width={width} height={height} fill={fill} />
    </View>
  );
};
