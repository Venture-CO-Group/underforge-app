import React, { useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View, Pressable } from 'react-native';
import Body, { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useTranslation } from 'react-i18next';
import { BrandColors } from '../constants/Colors';
import { FontFamily } from '../constants/Typography';

export type BodyMapVariant = 'pain' | 'focus';

// English labels kept for LLM communication (bodyPartIdsToLabels export)
const BODY_PART_LABELS: Record<string, string> = {
  'full_body': 'Full Body Equally',
  'neck': 'Neck',
  'deltoids': 'Shoulders',
  'shoulders': 'Shoulders',
  'chest': 'Chest',
  'biceps': 'Arms (front)',
  'triceps': 'Arms (back)',
  'forearm': 'Forearms',
  'elbows': 'Elbows',
  'hands': 'Hands',
  'wrists': 'Wrists',
  'abs': 'Core / Abs',
  'obliques': 'Obliques',
  'quadriceps': 'Quads',
  'knees': 'Knees',
  'tibialis': 'Shins',
  'ankles': 'Ankles',
  'feet': 'Feet',
  'upper-back': 'Upper Back',
  'lower-back': 'Lower Back',
  'trapezius': 'Trapezius',
  'hamstring': 'Hamstrings',
  'gluteal': 'Glutes',
  'hips': 'Hips',
  'calves': 'Calves',
  'adductors': 'Inner Thighs',
};

// Mapping from slug to i18n translation key (for display only)
const SLUG_TO_I18N_KEY: Record<string, string> = {
  'full_body': 'bodymap:partFullBody',
  'neck': 'bodymap:partNeck',
  'deltoids': 'bodymap:partShoulders',
  'shoulders': 'bodymap:partShoulders',
  'chest': 'bodymap:partChest',
  'biceps': 'bodymap:partBiceps',
  'triceps': 'bodymap:partTriceps',
  'forearm': 'bodymap:partForearm',
  'elbows': 'bodymap:partElbows',
  'hands': 'bodymap:partHands',
  'wrists': 'bodymap:partWrists',
  'abs': 'bodymap:partAbs',
  'obliques': 'bodymap:partObliques',
  'quadriceps': 'bodymap:partQuadriceps',
  'knees': 'bodymap:partKnees',
  'tibialis': 'bodymap:partTibialis',
  'ankles': 'bodymap:partAnkles',
  'feet': 'bodymap:partFeet',
  'upper-back': 'bodymap:partUpperBack',
  'lower-back': 'bodymap:partLowerBack',
  'trapezius': 'bodymap:partTrapezius',
  'hamstring': 'bodymap:partHamstring',
  'gluteal': 'bodymap:partGluteal',
  'hips': 'bodymap:partHips',
  'calves': 'bodymap:partCalves',
  'adductors': 'bodymap:partAdductors',
};

// Slugs ignored by the underlying body highlighter interaction
const IGNORED_SLUGS = new Set(['head', 'hair', 'neck', 'hands', 'feet', 'ankles', 'knees']);

const PAIN_CHIPS: string[] = [
  'neck', 'shoulders', 'upper-back', 'lower-back', 'elbows', 'wrists', 'hips', 'knees', 'ankles'
];

const FOCUS_CHIPS: string[] = [
  'chest', 'upper-back', 'lower-back', 'trapezius', 'deltoids',
  'biceps', 'triceps', 'forearm', 'abs', 'obliques',
  'quadriceps', 'hamstring', 'adductors', 'gluteal', 'calves',
];

const VARIANT_CONFIG = {
  pain: {
    color: '#E05555',
    chipBorder: BrandColors.error,
    chipBg: 'rgba(198, 91, 91, 0.15)',
    chipTextColor: BrandColors.error,
    instruction: 'Tap the circles where you feel pain',
    chipLabel: 'Or select from the list:',
    noneLabel: 'No pain',
    chips: PAIN_CHIPS,
  },
  focus: {
    color: BrandColors.accent,
    chipBorder: BrandColors.accent,
    chipBg: 'rgba(244, 124, 60, 0.12)',
    chipTextColor: BrandColors.accent,
    instruction: 'Tap the muscle groups you want to focus on',
    chipLabel: 'Or select from the list:',
    noneLabel: '',
    chips: FOCUS_CHIPS,
  },
} as const;

// Coordinate system for pain points (percentage 0-100)
// Based on typical body map SVG proportions
interface Point { x: number; y: number; }
interface PainPointDef {
  slug: string;
  front?: Point[];
  back?: Point[];
}

const PAIN_POINTS: PainPointDef[] = [
  { slug: 'neck', front: [{x: 50, y: 14}], back: [{x: 50, y: 14}] },
  { slug: 'shoulders', front: [{x: 30, y: 19}, {x: 70, y: 19}], back: [{x: 30, y: 19}, {x: 70, y: 19}] },
  { slug: 'elbows', front: [{x: 22, y: 34}, {x: 78, y: 34}], back: [{x: 22, y: 34}, {x: 78, y: 34}] },
  { slug: 'wrists', front: [{x: 16, y: 44}, {x: 84, y: 44}], back: [{x: 16, y: 44}, {x: 84, y: 44}] },
  { slug: 'knees', front: [{x: 34, y: 70}, {x: 66, y: 70}], back: [] },
  { slug: 'ankles', front: [{x: 35, y: 91}, {x: 65, y: 91}], back: [{x: 35, y: 91}, {x: 65, y: 91}] },
  { slug: 'upper-back', front: [], back: [{x: 50, y: 25}] },
  { slug: 'lower-back', front: [], back: [{x: 50, y: 42}] },
  { slug: 'hips', front: [{x: 35, y: 48}, {x: 65, y: 48}], back: [{x: 40, y: 50}, {x: 60, y: 50}] },
];

const screenWidth = Dimensions.get('window').width;

interface BodyMapSelectorProps {
  selectedParts: string[];
  onPartsChange: (parts: string[]) => void;
  gender?: 'male' | 'female';
  variant?: BodyMapVariant;
}

export const BodyMapSelector: React.FC<BodyMapSelectorProps> = ({
  selectedParts,
  onPartsChange,
  gender = 'female',
  variant = 'pain',
}) => {
  const { t } = useTranslation(['bodymap']);
  const [viewSide, setViewSide] = useState<'front' | 'back'>('front');
  const cfg = VARIANT_CONFIG[variant];

  const getDisplayLabel = (slug: string): string => {
    const key = SLUG_TO_I18N_KEY[slug];
    return key ? t(key) : (BODY_PART_LABELS[slug] || slug);
  };

  const isFullBody = selectedParts.includes('full_body');
  const mapSlugs = selectedParts.filter(s => s !== 'full_body');

  // For Focus mode: light up muscles
  // For Pain mode: we don't light up muscles on the map itself (except maybe very subtly), 
  // we rely on the circles. But to keep the map visible we pass empty data or minimal data.
  // Actually, for pain mode let's keep the body neutral and only show circles.
  const bodyData: ExtendedBodyPart[] = variant === 'focus' 
    ? (isFullBody ? cfg.chips : mapSlugs).map(slug => ({
        slug: slug as any,
        intensity: 1,
        color: cfg.color,
      }))
    : []; // Empty data for pain mode (background only)

  const togglePart = (slug: string, base: string[] = selectedParts): string[] =>
    base.includes(slug) ? base.filter(s => s !== slug) : [...base, slug];

  const handleBodyPartPress = (part: ExtendedBodyPart) => {
    if (variant === 'pain') return;
    if (!part.slug || IGNORED_SLUGS.has(part.slug)) return;

    const base = isFullBody ? selectedParts.filter(s => s !== 'full_body') : selectedParts;
    onPartsChange(togglePart(part.slug, base));
  };

  const handleChipToggle = (slug: string) => {
    const base = (variant === 'focus' && isFullBody)
      ? selectedParts.filter(s => s !== 'full_body')
      : selectedParts;
    onPartsChange(togglePart(slug, base));
  };

  const handleFullBodySelect = () => {
    if (isFullBody) {
      onPartsChange(selectedParts.filter(s => s !== 'full_body'));
    } else {
      onPartsChange(['full_body']);
    }
  };

  const handleNoPain = () => {
    if (selectedParts.length > 0) {
      onPartsChange([]);
    }
  };

  const isSelected = (slug: string) => selectedParts.includes(slug);
  
  // Calculate scale and dimensions
  const bodyScale = Math.min((screenWidth - 64) / 220, 1.5);
  const containerWidth = 220 * bodyScale; // Approximate width based on library defaults
  const containerHeight = 400 * bodyScale; // Approximate height

  return (
    <ScrollView
      style={styles.wrapper}
      contentContainerStyle={styles.wrapperContent}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.instruction}>
        {variant === 'pain' ? t('bodymap:painInstruction') : t('bodymap:focusInstruction')}
      </Text>

      {/* Front / Back toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, viewSide === 'front' && styles.toggleBtnActive]}
          onPress={() => setViewSide('front')}
          activeOpacity={0.7}
        >
          <Text style={[styles.toggleText, viewSide === 'front' && styles.toggleTextActive]}>
            {t('bodymap:front')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, viewSide === 'back' && styles.toggleBtnActive]}
          onPress={() => setViewSide('back')}
          activeOpacity={0.7}
        >
          <Text style={[styles.toggleText, viewSide === 'back' && styles.toggleTextActive]}>
            {t('bodymap:back')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Body map Container */}
      <View style={[styles.bodyContainer, { width: containerWidth, height: containerHeight }]}>
        <Body
          data={bodyData}
          onBodyPartPress={handleBodyPartPress}
          gender={gender}
          side={viewSide}
          scale={bodyScale}
          border="#3A4D52"
          colors={[cfg.color]}
          defaultFill={variant === 'pain' ? "#2A383A" : "#1E2A2C"} // Slightly lighter background for pain map
        />

        {/* Overlay Circles for Pain Mode */}
        {variant === 'pain' && (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {PAIN_POINTS.map((p) => {
              const points = viewSide === 'front' ? p.front : p.back;
              if (!points || points.length === 0) return null;

              const active = isSelected(p.slug);
              
              return points.map((pt, idx) => (
                <TouchableOpacity
                  key={`${p.slug}-${idx}`}
                  style={[
                    styles.painCircle,
                    {
                      left: `${pt.x}%`,
                      top: `${pt.y}%`,
                      transform: [{ translateX: -12 }, { translateY: -12 }], // Center the 24x24 circle
                    },
                    active && styles.painCircleActive
                  ]}
                  onPress={() => onPartsChange(togglePart(p.slug))}
                  activeOpacity={0.8}
                >
                  {active && <View style={styles.painCircleInner} />}
                </TouchableOpacity>
              ));
            })}
          </View>
        )}
      </View>

      {/* Chip selector */}
      <Text style={styles.chipListLabel}>{t('bodymap:chipListLabel')}</Text>
      <View style={styles.chipContainer}>
        {/* "Full body equally" as first chip for focus variant */}
        {variant === 'focus' && (
          <TouchableOpacity
            style={[
              styles.chip,
              styles.chipFullWidth,
              isFullBody && { borderColor: cfg.chipBorder, backgroundColor: cfg.chipBg },
            ]}
            onPress={handleFullBodySelect}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.chipText,
              isFullBody && { color: cfg.chipTextColor, fontWeight: '600' as const },
            ]}>
              {t('bodymap:fullBodyEqually')}
            </Text>
          </TouchableOpacity>
        )}
        {cfg.chips.map((slug) => {
          const active = isSelected(slug);
          return (
            <TouchableOpacity
              key={slug}
              style={[
                styles.chip,
                active && { borderColor: cfg.chipBorder, backgroundColor: cfg.chipBg },
              ]}
              onPress={() => handleChipToggle(slug)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.chipText,
                active && { color: cfg.chipTextColor, fontWeight: '600' as const },
              ]}>
                {getDisplayLabel(slug)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* "No pain" for pain variant */}
      {variant === 'pain' && (
        <TouchableOpacity
          style={[styles.specialButton, selectedParts.length === 0 && styles.specialButtonActiveGreen]}
          onPress={handleNoPain}
          activeOpacity={0.7}
        >
          <Text style={[
            styles.specialButtonText,
            selectedParts.length === 0 && styles.specialButtonTextActiveGreen,
          ]}>
            {t('bodymap:noPain')}
          </Text>
        </TouchableOpacity>
      )}

      {(isFullBody || mapSlugs.length > 0) && (
        <Text style={styles.selectedSummary}>
          {t('bodymap:selectedSummary', {
            parts: isFullBody ? t('bodymap:fullBodyEqually') : mapSlugs.map(id => getDisplayLabel(id)).join(', ')
          })}
        </Text>
      )}
    </ScrollView>
  );
};

export function bodyPartIdsToLabels(ids: string[]): string[] {
  return ids
    .map(id => BODY_PART_LABELS[id] || id)
    .filter(Boolean);
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  wrapperContent: {
    alignItems: 'center',
    paddingBottom: 24,
  },
  instruction: {
    fontSize: 14,
    color: BrandColors.textSecondary,
    marginBottom: 12,
    fontFamily: FontFamily.bodyRegular,
  },
  toggleRow: {
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BrandColors.inputBorder,
    marginBottom: 16,
  },
  toggleBtn: {
    paddingVertical: 10,
    paddingHorizontal: 28,
    backgroundColor: BrandColors.backgroundSecondary,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: BrandColors.accent,
  },
  toggleText: {
    fontSize: 15,
    color: BrandColors.textSecondary,
    fontFamily: FontFamily.bodySemiBold,
  },
  toggleTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  bodyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    position: 'relative', // Needed for absolute positioning of circles
  },
  painCircle: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  painCircleActive: {
    backgroundColor: 'rgba(224, 85, 85, 0.3)',
    borderColor: '#E05555',
  },
  painCircleInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E05555',
  },
  chipListLabel: {
    fontSize: 13,
    color: BrandColors.textTertiary,
    marginBottom: 10,
    fontFamily: FontFamily.bodyRegular,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  chip: {
    borderWidth: 1.5,
    borderColor: BrandColors.inputBorder,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: BrandColors.backgroundSecondary,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipFullWidth: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 12,
  },
  chipText: {
    fontSize: 14,
    color: BrandColors.textSecondary,
    fontFamily: FontFamily.bodyRegular,
  },
  specialButton: {
    borderWidth: 2,
    borderColor: BrandColors.inputBorder,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginBottom: 12,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  specialButtonActiveGreen: {
    borderColor: BrandColors.success,
    backgroundColor: 'rgba(79, 174, 138, 0.15)',
  },
  specialButtonText: {
    fontSize: 15,
    color: BrandColors.textSecondary,
    fontFamily: FontFamily.bodySemiBold,
    textAlign: 'center',
  },
  specialButtonTextActiveGreen: {
    color: BrandColors.success,
    fontWeight: '700',
  },
  selectedSummary: {
    fontSize: 13,
    color: BrandColors.accent,
    textAlign: 'center',
    marginTop: 4,
    fontFamily: FontFamily.bodyRegular,
    paddingHorizontal: 16,
  },
});
