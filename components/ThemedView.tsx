import { View, type ViewProps } from 'react-native';

import { BrandColors } from '@/constants/Colors';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'card';
};

export function ThemedView({ 
  style, 
  lightColor, 
  darkColor, 
  variant = 'primary',
  ...otherProps 
}: ThemedViewProps) {
  // Use brand colors based on variant - dark theme primary
  const backgroundColors = {
    primary: BrandColors.backgroundPrimary,
    secondary: BrandColors.backgroundSecondary,
    tertiary: BrandColors.backgroundTertiary,
    card: BrandColors.backgroundSecondary,
  };
  
  const backgroundColor = backgroundColors[variant];

  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
