import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize } from '../constants/Typography';
import { openCamera, openImageGallery } from '../lib/camera-helper';
import { uploadCircleImage } from '../lib/storage-upload';

interface CircleImagePickerProps {
  uri?: string | null;
  ownerUserId: string;
  circleId: number;
  circleName: string;
  onChange: (newUrl: string) => Promise<void> | void;
  size?: number;
}

/**
 * Round circle cover photo picker (owner only). Uploads to the `circle-images`
 * bucket and returns the public URL to the parent for persistence.
 */
export const CircleImagePicker: React.FC<CircleImagePickerProps> = ({
  uri,
  ownerUserId,
  circleId,
  circleName,
  onChange,
  size = 88,
}) => {
  const { t } = useTranslation(['social', 'common']);
  const [uploading, setUploading] = useState(false);

  const initial = (circleName || '?').trim().charAt(0).toUpperCase();
  const radius = size / 2;

  const handleUpload = async (localUri: string) => {
    setUploading(true);
    try {
      const newUrl = await uploadCircleImage(ownerUserId, circleId, localUri);
      if (!newUrl) {
        Alert.alert(t('common:error'), t('social:circleImageUploadError'));
        return;
      }
      await onChange(newUrl);
    } finally {
      setUploading(false);
    }
  };

  const openPicker = () => {
    if (uploading) return;
    const options = [t('social:avatarPickFromCamera'), t('social:avatarPickFromLibrary'), t('common:cancel')];
    const cancelIdx = 2;

    const launch = async (idx: number) => {
      if (idx === 0) {
        const result = await openCamera();
        if (result) await handleUpload(result);
      } else if (idx === 1) {
        const result = await openImageGallery();
        if (result) await handleUpload(result);
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIdx },
        launch,
      );
    } else {
      Alert.alert(
        t('social:circleImagePickTitle'),
        undefined,
        [
          { text: options[0], onPress: () => launch(0) },
          { text: options[1], onPress: () => launch(1) },
          { text: options[2], style: 'cancel' },
        ],
      );
    }
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        onPress={openPicker}
        activeOpacity={0.85}
        style={[styles.tile, { width: size, height: size, borderRadius: radius }]}
        accessibilityRole="button"
        accessibilityLabel={t('social:circleImagePickA11y')}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius }} />
        ) : (
          <Text style={[styles.initial, { fontSize: size * 0.38 }]}>{initial}</Text>
        )}
        {uploading && (
          <View style={[styles.overlay, { borderRadius: radius }]}>
            <ActivityIndicator size="small" color={BrandColors.accent} />
          </View>
        )}
        {!uploading && (
          <View style={styles.editBadge}>
            <Text style={styles.editBadgeText}>{t('social:avatarEditBadge')}</Text>
          </View>
        )}
      </TouchableOpacity>
      <Text style={styles.caption}>{t('social:circleImageCaption')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    marginBottom: 12,
  },
  tile: {
    backgroundColor: 'rgba(244,124,60,0.12)',
    borderWidth: 2,
    borderColor: 'rgba(244,124,60,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    fontFamily: FontFamily.bodyBold,
    color: BrandColors.accent,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11,17,20,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: BrandColors.accent,
  },
  editBadgeText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.metaSmall,
    color: '#0B1114',
  },
  caption: {
    marginTop: 8,
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    letterSpacing: 0.3,
  },
});
