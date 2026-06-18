/**
 * UnderForge Typography System
 * 
 * Design Philosophy: Premium, research-driven, calm confidence.
 * Mixing serif emotion (headlines) with sans-serif precision (body) is mandatory.
 * 
 * Fonts Required:
 * - Display Serif: Playfair Display (headlines, hero text)
 * - Body Sans: Inter (body copy, UI elements)
 * 
 * To install fonts, add to assets/fonts/:
 * - PlayfairDisplay-Regular.ttf
 * - PlayfairDisplay-Bold.ttf
 * - Inter-Regular.ttf
 * - Inter-Medium.ttf
 * - Inter-SemiBold.ttf
 * - Inter-Bold.ttf
 */

import { Platform } from 'react-native';

// =============================================================================
// FONT FAMILIES
// =============================================================================

export const FontFamily = {
  // Display Serif - for headlines and hero statements
  displayRegular: Platform.select({
    ios: 'PlayfairDisplay-Regular',
    android: 'PlayfairDisplay-Regular',
    default: 'Georgia',
  }),
  displayBold: Platform.select({
    ios: 'PlayfairDisplay-Bold',
    android: 'PlayfairDisplay-Bold',
    default: 'Georgia',
  }),
  
  // Body Sans - for body copy, navigation, labels, buttons
  bodyRegular: Platform.select({
    ios: 'Inter-Regular',
    android: 'Inter-Regular',
    default: 'System',
  }),
  bodyMedium: Platform.select({
    ios: 'Inter-Medium',
    android: 'Inter-Medium',
    default: 'System',
  }),
  bodySemiBold: Platform.select({
    ios: 'Inter-SemiBold',
    android: 'Inter-SemiBold',
    default: 'System',
  }),
  bodyBold: Platform.select({
    ios: 'Inter-Bold',
    android: 'Inter-Bold',
    default: 'System',
  }),
  
  // Monospace - for developer tools
  monospace: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  }),
};

// =============================================================================
// TYPE SCALE (Mobile) - Based on design guidelines
// =============================================================================

export const FontSize = {
  // Display/Hero sizes
  hero: 38,           // 34-40pt - Hero headlines
  sectionHeadline: 28, // 26-30pt - Section headlines
  subheadline: 19,    // 18-20pt - Subheadlines
  
  // Body sizes
  body: 16,           // 15-16pt - Body text
  bodySmall: 14,      // Smaller body text
  
  // Meta sizes
  meta: 13,           // 12-13pt - Meta/helper text
  metaSmall: 11,      // Small labels, badges
  
  // UI sizes
  button: 16,         // Button labels
  input: 16,          // Input text
  tabLabel: 12,       // Tab bar labels
};

// =============================================================================
// LINE HEIGHTS - Generous for readability
// =============================================================================

export const LineHeight = {
  hero: 46,
  sectionHeadline: 36,
  subheadline: 26,
  body: 24,
  bodySmall: 20,
  meta: 18,
};

// =============================================================================
// LETTER SPACING
// =============================================================================

export const LetterSpacing = {
  tight: -0.5,        // Headlines
  normal: 0,          // Body text
  wide: 0.5,          // Buttons, labels
  extraWide: 1.5,     // All-caps small text
};

// =============================================================================
// PRESET TEXT STYLES - Ready to spread into StyleSheet
// =============================================================================

export const TextStyles = {
  // Display Styles (Serif)
  heroHeadline: {
    fontFamily: FontFamily.displayBold,
    fontSize: FontSize.hero,
    lineHeight: LineHeight.hero,
    letterSpacing: LetterSpacing.tight,
  },
  sectionHeadline: {
    fontFamily: FontFamily.displayBold,
    fontSize: FontSize.sectionHeadline,
    lineHeight: LineHeight.sectionHeadline,
    letterSpacing: LetterSpacing.tight,
  },
  subheadline: {
    fontFamily: FontFamily.displayRegular,
    fontSize: FontSize.subheadline,
    lineHeight: LineHeight.subheadline,
  },
  
  // Body Styles (Sans-serif)
  bodyLarge: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
  },
  body: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    lineHeight: LineHeight.bodySmall,
  },
  bodyMedium: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.bodySmall,
    lineHeight: LineHeight.bodySmall,
  },
  bodySemiBold: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    lineHeight: LineHeight.bodySmall,
  },
  bodyBold: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.bodySmall,
    lineHeight: LineHeight.bodySmall,
  },
  
  // Meta Styles
  meta: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.meta,
    lineHeight: LineHeight.meta,
  },
  metaSemiBold: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.meta,
    lineHeight: LineHeight.meta,
  },
  
  // UI Styles
  button: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.button,
    letterSpacing: LetterSpacing.wide,
  },
  buttonSmall: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    letterSpacing: LetterSpacing.wide,
  },
  label: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.meta,
    letterSpacing: LetterSpacing.wide,
  },
  tabLabel: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.tabLabel,
  },
};

// =============================================================================
// LEGACY EXPORTS - For backwards compatibility
// =============================================================================

export const Typography = {
  fontFamily: {
    regular: FontFamily.bodyRegular,
    semiBold: FontFamily.bodySemiBold,
    bold: FontFamily.bodyBold,
    brand: FontFamily.displayBold, // For UnderForge branding
    monospace: FontFamily.monospace,
  },
  
  // Legacy style objects
  defaultText: {
    fontFamily: FontFamily.bodyRegular,
  },
  semiBoldText: {
    fontFamily: FontFamily.bodySemiBold,
  },
  boldText: {
    fontFamily: FontFamily.bodyBold,
  },
  brandText: {
    fontFamily: FontFamily.displayBold,
  },
};
