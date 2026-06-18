import { StyleSheet, Text, type TextProps } from 'react-native';

import { BrandColors } from '@/constants/Colors';
import { FontFamily, FontSize, LineHeight, TextStyles } from '@/constants/Typography';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link' | 'hero' | 'sectionHeadline' | 'meta';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  // Use brand colors - dark theme primary
  const color = BrandColors.textPrimary;

  return (
    <Text
      style={[
        { color },
        type === 'default' ? styles.default : undefined,
        type === 'title' ? styles.title : undefined,
        type === 'defaultSemiBold' ? styles.defaultSemiBold : undefined,
        type === 'subtitle' ? styles.subtitle : undefined,
        type === 'link' ? styles.link : undefined,
        type === 'hero' ? styles.hero : undefined,
        type === 'sectionHeadline' ? styles.sectionHeadline : undefined,
        type === 'meta' ? styles.meta : undefined,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    color: BrandColors.textPrimary,
  },
  defaultSemiBold: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    color: BrandColors.textPrimary,
  },
  title: {
    ...TextStyles.sectionHeadline,
    color: BrandColors.textPrimary,
  },
  subtitle: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.subheadline,
    color: BrandColors.textPrimary,
  },
  link: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.body,
    lineHeight: 30,
    color: BrandColors.accent,
  },
  hero: {
    ...TextStyles.heroHeadline,
    color: BrandColors.textPrimary,
  },
  sectionHeadline: {
    ...TextStyles.sectionHeadline,
    color: BrandColors.textPrimary,
  },
  meta: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.meta,
    lineHeight: LineHeight.meta,
    color: BrandColors.textSecondary,
  },
});
