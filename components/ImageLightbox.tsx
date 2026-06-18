import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface LightboxImage {
  uri: string;
  /** Optional caption shown under the photo (e.g. "Week 23 · Front"). */
  caption?: string;
}

interface ImageLightboxProps {
  visible: boolean;
  images: LightboxImage[];
  initialIndex: number;
  onClose: () => void;
}

/**
 * Full-screen image viewer. Shows one photo at a time at its natural aspect
 * ratio (contain) with left/right arrows to step through the supplied list.
 * Reused by body-progress thumbnails and anywhere else that needs a gallery.
 */
export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  visible,
  images,
  initialIndex,
  onClose,
}) => {
  const { t } = useTranslation(['progress', 'common']);
  // useSafeAreaInsets reads from context, which (unlike the SafeAreaView
  // component's native measurement) propagates correctly into a RN Modal.
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);

  // Re-sync when reopened on a different thumbnail.
  useEffect(() => {
    if (visible) setIndex(initialIndex);
  }, [visible, initialIndex]);

  if (images.length === 0) return null;

  const safeIndex = Math.min(Math.max(index, 0), images.length - 1);
  const current = images[safeIndex];
  const hasPrev = safeIndex > 0;
  const hasNext = safeIndex < images.length - 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Top bar: counter + close */}
        <View style={styles.topBar}>
          <Text style={styles.counter}>
            {t('progress:photoViewerCounter', { current: safeIndex + 1, total: images.length })}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={t('progress:photoViewerClose')}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.closeGlyph}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Photo */}
        <View style={styles.imageWrap}>
          <Image
            source={{ uri: current.uri }}
            style={styles.image}
            resizeMode="contain"
          />

          {/* Left / right navigators */}
          {hasPrev && (
            <TouchableOpacity
              style={[styles.navButton, styles.navLeft]}
              onPress={() => setIndex(safeIndex - 1)}
              accessibilityRole="button"
              accessibilityLabel={t('progress:photoViewerPrev')}
            >
              <Text style={styles.navGlyph}>‹</Text>
            </TouchableOpacity>
          )}
          {hasNext && (
            <TouchableOpacity
              style={[styles.navButton, styles.navRight]}
              onPress={() => setIndex(safeIndex + 1)}
              accessibilityRole="button"
              accessibilityLabel={t('progress:photoViewerNext')}
            >
              <Text style={styles.navGlyph}>›</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Caption */}
        {current.caption ? (
          <View style={styles.captionWrap}>
            <Text style={styles.caption}>{current.caption}</Text>
          </View>
        ) : (
          <View style={styles.captionWrap} />
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.96)',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  counter: {
    color: '#F2F2EE',
    fontSize: 15,
    fontWeight: '600',
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: {
    color: '#F2F2EE',
    fontSize: 22,
    fontWeight: '600',
  },
  imageWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  navButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  navLeft: {
    left: 12,
  },
  navRight: {
    right: 12,
  },
  navGlyph: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '300',
    lineHeight: 38,
  },
  captionWrap: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  caption: {
    color: '#C7CDCF',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default ImageLightbox;
