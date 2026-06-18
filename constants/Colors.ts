/**
 * UnderForge Brand Color System
 * 
 * Design Philosophy: Premium, research-driven, calm confidence.
 * Dark theme primary - the interface should feel expensive, deliberate, and restrained.
 */

// =============================================================================
// BRAND PALETTE - Core brand colors used throughout the app
// =============================================================================

export const BrandColors = {
  // Primary Backgrounds (near-black)
  backgroundPrimary: '#0B1114',      // Charcoal Blue-Black - main background
  backgroundSecondary: '#0E1A1A',    // Deep Teal-Black - secondary surfaces
  backgroundTertiary: '#141E1E',     // Slightly lighter - cards, elevated surfaces
  
  // Primary Text
  textPrimary: '#F2F2EE',            // Soft Ivory - headlines, important text
  textSecondary: '#9AA3A6',          // Muted Cool Gray - body text
  textTertiary: '#6F7A7E',           // Low-emphasis Gray - meta text, hints
  
  // Primary Accent (warm)
  accent: '#F47C3C',                 // Burnt Orange - primary CTA, active states
  accentPressed: '#D8662F',          // Darkened Accent - pressed/active states
  accentSoft: '#F9A06A',             // Soft Accent Tint - subtle highlights
  
  // Functional Colors
  success: '#4FAE8A',                // Muted Green - success states
  warning: '#E0A458',                // Amber - warning states
  error: '#C65B5B',                  // Desaturated Red - error states
  
  // UI Elements
  divider: '#1A2426',                // Subtle divider lines
  cardBorder: '#1E2A2C',             // Card borders
  inputBorder: '#2A3638',            // Input field borders
  inputBackground: '#0E1A1A',        // Input field background
  
  // Overlay
  overlayDark: 'rgba(11, 17, 20, 0.9)',   // Dark overlay for modals
  overlayMedium: 'rgba(11, 17, 20, 0.7)', // Medium overlay
  overlayLight: 'rgba(11, 17, 20, 0.5)',  // Light overlay
};

// =============================================================================
// WELLNESS DIMENSION COLORS - Specific to coaching categories
// =============================================================================

export const WellnessColors = {
  nutrition: {
    primary: '#4FAE8A',
    background: 'rgba(79, 174, 138, 0.15)',
  },
  training: {
    primary: '#5B9BD5',
    background: 'rgba(91, 155, 213, 0.15)',
  },
  movement: {
    primary: '#62B6CB',
    background: 'rgba(98, 182, 203, 0.15)',
  },
  stress_management: {
    primary: '#9B7BB8',
    background: 'rgba(155, 123, 184, 0.15)',
  },
  sleep: {
    primary: '#7B8FD4',
    background: 'rgba(123, 143, 212, 0.15)',
  },
  structure: {
    primary: '#E0A458',
    background: 'rgba(224, 164, 88, 0.15)',
  },
  recovery: {
    primary: '#5AAFA9',
    background: 'rgba(90, 175, 169, 0.15)',
  },
};

// =============================================================================
// TASK TYPE COLORS - For different activity types
// =============================================================================

export const TaskColors = {
  meal: {
    primary: '#F47C3C',
    background: 'rgba(244, 124, 60, 0.15)',
  },
  workout: {
    primary: '#C65B5B',
    background: 'rgba(198, 91, 91, 0.15)',
  },
  activity: {
    primary: '#5B9BD5',
    background: 'rgba(91, 155, 213, 0.15)',
  },
  meditation: {
    primary: '#9B7BB8',
    background: 'rgba(155, 123, 184, 0.15)',
  },
  sleep_routine: {
    primary: '#7B8FD4',
    background: 'rgba(123, 143, 212, 0.15)',
  },
  protocol: {
    primary: '#4FAE8A',
    background: 'rgba(79, 174, 138, 0.15)',
  },
};

// =============================================================================
// LEGACY COLORS EXPORT - For backwards compatibility with existing components
// =============================================================================

export const Colors = {
  light: {
    text: BrandColors.textPrimary,
    background: BrandColors.backgroundPrimary,
    tint: BrandColors.accent,
    icon: BrandColors.textTertiary,
    tabIconDefault: BrandColors.textTertiary,
    tabIconSelected: BrandColors.accent,
  },
  dark: {
    text: BrandColors.textPrimary,
    background: BrandColors.backgroundPrimary,
    tint: BrandColors.accent,
    icon: BrandColors.textTertiary,
    tabIconDefault: BrandColors.textTertiary,
    tabIconSelected: BrandColors.accent,
  },
};
