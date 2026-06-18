import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Image, Platform } from 'react-native';
import { glowLogger } from './glow-logger';
import { i18n } from './i18n';

const TEST_IMAGE = require('../assets/images/food_estimation/hamburguer_photo.jpg');

export interface PickImageOptions {
  /**
   * Reject landscape images. Body-progress and social posts render in tall
   * cards, so a wide photo would letterbox badly — we ask the user to retake.
   */
  requireVertical?: boolean;
}

/** Returns false (and alerts) when a vertical-only pick came back landscape. */
const passesOrientation = (
  asset: ImagePicker.ImagePickerAsset,
  options?: PickImageOptions,
): boolean => {
  if (!options?.requireVertical) return true;
  if (asset.width && asset.height && asset.width > asset.height) {
    Alert.alert(
      i18n.t('common:verticalOnlyTitle'),
      i18n.t('common:verticalOnlyMessage'),
      [{ text: i18n.t('common:ok') }],
    );
    return false;
  }
  return true;
};

export const openCamera = async (options?: PickImageOptions): Promise<string | null> => {
  try {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    
    if (status !== 'granted') {
      // On simulator/emulator, camera permission will fail - use test image
      if (!Device.isDevice) {
        glowLogger.info('Camera not available (simulator/emulator), using test image', {
          platform: Platform.OS
        });
        const resolvedImage = Image.resolveAssetSource(TEST_IMAGE);
        return resolvedImage.uri;
      }
      
      Alert.alert(
        i18n.t('common:permissionCameraTitle'),
        i18n.t('common:permissionCameraMessage'),
        [{ text: i18n.t('common:ok') }]
      );
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });

    if (result.canceled) {
      return null;
    }

    const asset = result.assets[0];
    if (!passesOrientation(asset, options)) {
      return null;
    }
    return asset.uri;
  } catch (error) {
    glowLogger.error('Error opening camera', {
      error: error instanceof Error ? error.message : String(error),
      platform: Platform.OS
    });
    
    // Fallback to test image on error (simulator/emulator)
    if (!Device.isDevice) {
      glowLogger.info('Camera error on simulator/emulator, using test image as fallback', {
        platform: Platform.OS
      });
      const resolvedImage = Image.resolveAssetSource(TEST_IMAGE);
      return resolvedImage.uri;
    }
    
    Alert.alert(i18n.t('common:error'), i18n.t('common:openCameraError'));
    return null;
  }
};

export const openImageGallery = async (options?: PickImageOptions): Promise<string | null> => {
  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (status !== 'granted') {
      Alert.alert(
        i18n.t('common:permissionPhotoLibraryTitle'),
        i18n.t('common:permissionPhotoLibraryMessage'),
        [{ text: i18n.t('common:ok') }]
      );
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });

    if (result.canceled) {
      return null;
    }

    const asset = result.assets[0];
    if (!passesOrientation(asset, options)) {
      return null;
    }
    return asset.uri;
  } catch (error) {
    glowLogger.error('Error opening image gallery', {
      error: error instanceof Error ? error.message : String(error),
      platform: Platform.OS
    });
    
    Alert.alert(i18n.t('common:error'), i18n.t('common:openPhotoLibraryError'));
    return null;
  }
};

