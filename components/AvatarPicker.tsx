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
import { uploadAvatar } from '../lib/storage-upload';

interface AvatarPickerProps {
  /** Current avatar URL, if any. */
  uri?: string | null;
  /** Pulled from `user_profile.user_id`; used as the storage path key. */
  userId: string;
  /** Initial letter shown when no avatar is set. */
  displayName?: string | null;
  /** Called with the new public URL after a successful upload. */
  onChange: (newUrl: string) => Promise<void> | void;
  size?: number;
}

/**
 * Round avatar tile that opens a Camera / Photo Library action sheet on tap,
 * uploads the chosen image to the 'avatars' Supabase Storage bucket, and
 * reports the resulting public URL back to the parent for persistence.
 */
export const AvatarPicker: React.FC<AvatarPickerProps> = ({
  uri,
  userId,
  displayName,
  onChange,
  size = 96,
}) => {
  const { t } = useTranslation(['social', 'common']);
  const [uploading, setUploading] = useState(false);

  const initial = (displayName || '?').trim().charAt(0).toUpperCase();
  const radius = size / 2;

  const handleUpload = async (localUri: string) => {
    setUploading(true);
    try {
      const newUrl = await uploadAvatar(userId, localUri);
      if (!newUrl) {
        Alert.alert(t('common:error'), t('social:avatarUploadError'));
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
        t('social:avatarPickTitle'),
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
        style={[
          styles.tile,
          { width: size, height: size, borderRadius: radius },
        ]}
        accessibilityRole="button"
        accessibilityLabel={t('social:avatarPickA11y')}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius }} />
        ) : (
          <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
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
      <Text style={styles.caption}>{t('social:avatarCaption')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  tile: {
    backgroundColor: BrandColors.backgroundTertiary,
    borderWidth: 2,
    borderColor: BrandColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: BrandColors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  initial: {
    fontFamily: FontFamily.bodyBold,
    color: BrandColors.textPrimary,
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
    marginTop: 10,
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    letterSpacing: 0.3,
  },
});
