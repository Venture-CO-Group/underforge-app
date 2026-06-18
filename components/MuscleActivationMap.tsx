import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Body, { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useTranslation } from 'react-i18next';
import type { BodyDatum } from '../lib/muscle-activation';

/**
 * Heat palette: index 0 = low (intensity 1) → index 2 = high (intensity 3).
 * Homogeneous warm ramp (soft amber → amber → red-orange) so the three levels read as one
 * coherent scale instead of the low level clashing with the others.
 */
const HEAT_COLORS = ['#EAC58F', '#E8A13C', '#F4552B'];

const screenWidth = Dimensions.get('window').width;

interface MuscleActivationMapProps {
  /** Aggregated body data: slug + intensity (1–3). */
  data: BodyDatum[];
  gender?: 'male' | 'female';
  /** Optional caption shown above the figures. */
  caption?: string;
  /** Hide the Low/Med/High legend. */
  hideLegend?: boolean;
  /** Multiplier on the figure size (e.g. 0.6 = 40% smaller). Defaults to 1. */
  sizeFactor?: number;
  /**
   * Overlay mode: transparent background + faint default fill + no side labels, so the figures
   * can sit on top of a photo (only the lit muscles show through in warm colors).
   */
  overlay?: boolean;
}

/**
 * Read-only muscle heatmap. Renders front + back body figures side by side, coloring each
 * muscle by activation intensity. Reuses `react-native-body-highlighter` (same lib as
 * BodyMapSelector). Pass aggregated data from `lib/muscle-activation`.
 */
export const MuscleActivationMap: React.FC<MuscleActivationMapProps> = ({
  data,
  gender = 'female',
  caption,
  hideLegend = false,
  sizeFactor = 1,
  overlay = false,
}) => {
  const { t } = useTranslation(['bodymap']);

  const bodyData = data.map((d) => ({ slug: d.slug, intensity: d.intensity })) as ExtendedBodyPart[];

  // Two figures side by side; size each to ~40% of screen width, then apply the caller factor.
  const scale = Math.min((screenWidth * 0.42) / 220, 1) * sizeFactor;

  return (
    <View style={[styles.container, overlay && styles.containerOverlay]}>
      {!!caption && <Text style={styles.caption}>{caption}</Text>}

      <View style={[styles.figuresRow, overlay && styles.figuresRowOverlay]}>
        {(['front', 'back'] as const).map((side) => (
          <View key={side} style={styles.figure}>
            <Body
              data={bodyData}
              gender={gender}
              side={side}
              scale={scale}
              border={overlay ? 'rgba(255,255,255,0.35)' : '#3A4D52'}
              colors={HEAT_COLORS}
              defaultFill={overlay ? 'rgba(255,255,255,0.14)' : '#1E2A2C'}
            />
            {!overlay && (
              <Text style={styles.sideLabel}>
                {side === 'front' ? t('bodymap:front') : t('bodymap:back')}
              </Text>
            )}
          </View>
        ))}
      </View>

      {!hideLegend && !overlay && (
        <View style={styles.legend}>
          {[
            { c: HEAT_COLORS[0], label: t('bodymap:legendLow', { defaultValue: 'Light' }) },
            { c: HEAT_COLORS[1], label: t('bodymap:legendMed', { defaultValue: 'Moderate' }) },
            { c: HEAT_COLORS[2], label: t('bodymap:legendHigh', { defaultValue: 'High' }) },
          ].map(({ c, label }) => (
            <View key={label} style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: c }]} />
              <Text style={styles.legendText}>{label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    width: '100%',
  },
  containerOverlay: {
    alignItems: 'flex-end',
  },
  caption: {
    fontSize: 13,
    color: '#9AA3A6',
    textAlign: 'center',
    marginBottom: 8,
  },
  figuresRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: 12,
  },
  figuresRowOverlay: {
    justifyContent: 'flex-end',
    gap: 0,
  },
  figure: {
    alignItems: 'center',
  },
  sideLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6F7A7E',
    marginTop: 4,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 11,
    color: '#9AA3A6',
  },
});
