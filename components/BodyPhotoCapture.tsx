import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { appIcons } from '../assets/icons';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize } from '../constants/Typography';
import type { BodyPhotoAngle } from '../lib/storage-upload';
import { openCamera, openImageGallery } from '../lib/camera-helper';
import { Icon } from './Icon';

/** Local file URIs (or already-uploaded URLs) per angle. */
export interface BodyPhotoValue {
  front: string | null;
  side: string | null;
  back: string | null;
}

interface BodyPhotoCaptureProps {
  value: BodyPhotoValue;
  onChange: (next: BodyPhotoValue) => void;
  disabled?: boolean;
}

const ANGLES: BodyPhotoAngle[] = ['front', 'side', 'back'];

/**
 * Schematic standing-figure silhouette shown as a "stand like this" cue inside an
 * empty slot. `pose` swaps the path so Side reads as a profile; Front/Back share
 * the facing figure (a silhouette can't distinguish them — the label does).
 */
function PoseSilhouette({ pose }: { pose: BodyPhotoAngle }) {
  const facing =
    'M13 22 Q20 18 27 22 L31 46 L28 47 L25 28 L24 31 L26 54 L24 93 L20.5 93 L20 60 L19.5 93 L16 93 L14 54 L16 31 L15 28 L12 47 L9 46 Z';
  const profile =
    'M15 22 L24 22 Q26 30 25 42 Q24 52 26 60 L27 93 L23 93 L21.5 62 L19 62 L19 93 L15 93 L16 60 Q15 50 15 42 Q14 30 15 22 Z';
  const isProfile = pose === 'side';
  return (
    <Svg width={34} height={70} viewBox="0 0 40 100">
      <Circle cx={isProfile ? 19 : 20} cy={11} r={7.5} fill="#3A4A4D" />
      {isProfile && <Circle cx={26} cy={12} r={1.6} fill="#3A4A4D" />}
      <Path d={isProfile ? profile : facing} fill="#3A4A4D" />
    </Svg>
  );
}

export const BodyPhotoCapture: React.FC<BodyPhotoCaptureProps> = ({ value, onChange, disabled }) => {
  const { t } = useTranslation(['bodylog', 'common']);
  const insets = useSafeAreaInsets();
  /** Angle whose source-picker sheet is open (null = closed). */
  const [pickerAngle, setPickerAngle] = useState<BodyPhotoAngle | null>(null);

  const setAngle = (angle: BodyPhotoAngle, uri: string | null) => {
    onChange({ ...value, [angle]: uri });
  };

  const pick = async (angle: BodyPhotoAngle, source: 'camera' | 'library') => {
    setPickerAngle(null);
    const uri = source === 'camera'
      ? await openCamera({ requireVertical: true })
      : await openImageGallery({ requireVertical: true });
    if (uri) setAngle(angle, uri);
  };

  const openSlot = (angle: BodyPhotoAngle) => {
    if (disabled) return;
    setPickerAngle(angle);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>{t('bodylog:photosTitle')}</Text>
        <View style={styles.recommendedBadge}>
          <Text style={styles.recommendedText}>{t('bodylog:photosRecommended')}</Text>
        </View>
        <View style={styles.verticalNoteBadge}>
          <Text style={styles.verticalNoteText}>↕ {t('bodylog:photosVerticalNote')}</Text>
        </View>
      </View>
      <Text style={styles.subtitle}>{t('bodylog:photosSubtitle')}</Text>

      <View style={styles.slotsRow}>
        {ANGLES.map((angle) => {
          const uri = value[angle];
          const isFront = angle === 'front';
          return (
            <View key={angle} style={styles.slotWrap}>
              <TouchableOpacity
                style={[styles.slot, uri ? styles.slotFilled : styles.slotEmpty]}
                onPress={() => openSlot(angle)}
                disabled={disabled}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('bodylog:photoSheetTitle', { angle: t(`bodylog:photoAngle_${angle}`) })}
              >
                {uri ? (
                  <>
                    <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
                    <View style={styles.editPill}>
                      <Text style={styles.editPillText}>{t('bodylog:photoChange')}</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <PoseSilhouette pose={angle} />
                    <Text style={styles.addText}>＋</Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={styles.slotLabel}>
                {t(`bodylog:photoAngle_${angle}`)}
                {isFront ? ' ★' : ''}
              </Text>
            </View>
          );
        })}
      </View>

      <Text style={styles.guideText}>{t('bodylog:photosGuide')}</Text>

      {/* Source picker — same brand bottom-sheet as the social photo composer. */}
      <Modal
        visible={pickerAngle !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerAngle(null)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setPickerAngle(null)}
          accessibilityRole="button"
          accessibilityLabel={t('common:cancel')}
        >
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {pickerAngle ? t('bodylog:photoSheetTitle', { angle: t(`bodylog:photoAngle_${pickerAngle}`) }) : ''}
            </Text>

            <View style={styles.sheetOptions}>
              <TouchableOpacity
                style={styles.sheetOption}
                onPress={() => pickerAngle && pick(pickerAngle, 'camera')}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <View style={styles.sheetIconCircle}>
                  <Icon source={appIcons.camera} width={22} height={22} fill={BrandColors.accent} />
                </View>
                <Text style={styles.sheetOptionLabel}>{t('bodylog:photoTakePhoto')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sheetOption}
                onPress={() => pickerAngle && pick(pickerAngle, 'library')}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <View style={styles.sheetIconCircle}>
                  <Icon source={appIcons.gallery_thumbnail} width={22} height={22} fill={BrandColors.accent} />
                </View>
                <Text style={styles.sheetOptionLabel}>{t('bodylog:photoChooseLibrary')}</Text>
              </TouchableOpacity>

              {pickerAngle && value[pickerAngle] ? (
                <TouchableOpacity
                  style={styles.sheetOption}
                  onPress={() => { if (pickerAngle) setAngle(pickerAngle, null); setPickerAngle(null); }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  <View style={[styles.sheetIconCircle, styles.sheetIconCircleDanger]}>
                    <Text style={styles.sheetTrashGlyph}>🗑</Text>
                  </View>
                  <Text style={[styles.sheetOptionLabel, styles.sheetOptionLabelDanger]}>{t('bodylog:photoRemove')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <TouchableOpacity
              style={styles.sheetDismiss}
              onPress={() => setPickerAngle(null)}
              activeOpacity={0.85}
            >
              <Text style={styles.sheetDismissText}>{t('common:cancel')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  recommendedBadge: {
    backgroundColor: 'rgba(244, 124, 60, 0.16)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  recommendedText: {
    color: '#F47C3C',
    fontSize: 11,
    fontWeight: '700',
  },
  verticalNoteBadge: {
    backgroundColor: 'rgba(78, 205, 196, 0.16)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  verticalNoteText: {
    color: '#4ECDC4',
    fontSize: 11,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    color: '#9AA3A6',
    lineHeight: 19,
    marginBottom: 14,
  },
  slotsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  slotWrap: {
    flex: 1,
    alignItems: 'center',
  },
  slot: {
    width: '100%',
    aspectRatio: 0.72,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#0E1A1A',
  },
  slotEmpty: {
    borderWidth: 1.5,
    borderColor: '#2A3A3D',
    borderStyle: 'dashed',
  },
  slotFilled: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2A3A3D',
  },
  thumb: {
    ...StyleSheet.absoluteFillObject,
  },
  addText: {
    position: 'absolute',
    bottom: 6,
    color: '#6F7A7E',
    fontSize: 20,
    fontWeight: '300',
  },
  editPill: {
    position: 'absolute',
    bottom: 6,
    backgroundColor: 'rgba(11, 17, 20, 0.78)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  editPillText: {
    color: '#F2F2EE',
    fontSize: 11,
    fontWeight: '600',
  },
  slotLabel: {
    marginTop: 6,
    fontSize: 13,
    color: '#C7CDCF',
    fontWeight: '500',
  },
  guideText: {
    marginTop: 12,
    fontSize: 12,
    color: '#6F7A7E',
    lineHeight: 18,
    textAlign: 'center',
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: BrandColors.overlayDark,
  },
  sheet: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: BrandColors.cardBorder,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: BrandColors.inputBorder,
    alignSelf: 'center',
    marginBottom: 16,
    opacity: 0.7,
  },
  sheetTitle: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
    textAlign: 'center',
    marginBottom: 16,
  },
  sheetOptions: {
    gap: 8,
    marginBottom: 12,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: BrandColors.backgroundTertiary,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
  },
  sheetIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(244,124,60,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(244,124,60,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetIconCircleDanger: {
    backgroundColor: 'rgba(198,91,91,0.12)',
    borderColor: 'rgba(198,91,91,0.25)',
  },
  sheetTrashGlyph: {
    fontSize: 18,
  },
  sheetOptionLabel: {
    flex: 1,
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  sheetOptionLabelDanger: {
    color: BrandColors.error,
  },
  sheetDismiss: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  sheetDismissText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.accent,
  },
});

export default BodyPhotoCapture;
