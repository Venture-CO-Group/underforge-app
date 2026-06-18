import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withSequence,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontFamily, Typography } from '../constants/Typography';

const VIDEO_BG_MAN = require('../assets/images/forging_video_man.mp4');
const VIDEO_BG_WOMAN = require('../assets/images/forging_video_woman.mp4');

// ── Timing configuration ────────────────────────────────────────────
// We animate three words in sequence; the actual text comes from i18n.
const WORD_KEYS = ['intro:forgingWords1', 'intro:forgingWords2', 'intro:forgingWords3'] as const;
const WORD_FADE_IN_MS = 400;
const WORD_HOLD_MS = 600;
const WORD_FADE_OUT_MS = 400;
const INITIAL_DELAY_MS = 500;
const BRAND_FADE_IN_MS = 800;
const CROSSFADE_DURATION = 1500;

interface IntroVideoScreenProps {
  onNewUser: () => void;
  onExistingUser: () => void;
  onHaveCode?: () => void;
}

export default function IntroVideoScreen({ onNewUser, onExistingUser, onHaveCode }: IntroVideoScreenProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['intro', 'common']);

  // Word animation opacities
  const wordOpacities = WORD_KEYS.map(() => useSharedValue(0));
  const brandOpacity = useSharedValue(0);
  const subtitleOpacity = useSharedValue(0);

  // Video transition state
  const isTransitioning = useRef(false);
  const activeVideoRef = useRef<'man' | 'woman'>('man');
  
  // Opacities
  const manOpacity = useSharedValue(1);
  const womanOpacity = useSharedValue(0);

  const manPlayer = useVideoPlayer(VIDEO_BG_MAN, (p) => {
    p.loop = false;
    p.muted = true;
    p.playbackRate = 0.6;
    p.play();
  });

  const womanPlayer = useVideoPlayer(VIDEO_BG_WOMAN, (p) => {
    p.loop = false;
    p.muted = true;
    p.playbackRate = 0.6;
  });

  useEffect(() => {
    const WORD_CYCLE_MS = WORD_FADE_IN_MS + WORD_HOLD_MS + WORD_FADE_OUT_MS;

    // Animate each word: fade in → hold → fade out
    WORD_KEYS.forEach((_, i) => {
      const startDelay = INITIAL_DELAY_MS + i * WORD_CYCLE_MS;

      wordOpacities[i].value = withDelay(
        startDelay,
        withSequence(
          withTiming(1, {
            duration: WORD_FADE_IN_MS,
            easing: Easing.out(Easing.ease),
          }),
          withTiming(1, {
            duration: WORD_HOLD_MS,
          }),
          withTiming(0, {
            duration: WORD_FADE_OUT_MS,
            easing: Easing.in(Easing.ease),
          })
        )
      );
    });

    // After all words complete, fade in the brand name and subtitle (they stay)
    const totalWordsMs = INITIAL_DELAY_MS + WORD_KEYS.length * WORD_CYCLE_MS;

    brandOpacity.value = withDelay(
      totalWordsMs + 200,
      withTiming(1, {
        duration: BRAND_FADE_IN_MS,
        easing: Easing.out(Easing.ease),
      })
    );

    subtitleOpacity.value = withDelay(
      totalWordsMs + 600,
      withTiming(1, {
        duration: BRAND_FADE_IN_MS,
        easing: Easing.out(Easing.ease),
      })
    );
  }, []);

  const brandStyle = useAnimatedStyle(() => ({ opacity: brandOpacity.value }));
  const subtitleStyle = useAnimatedStyle(() => ({ opacity: subtitleOpacity.value }));
  
  const manStyle = useAnimatedStyle(() => ({ opacity: manOpacity.value }));
  const womanStyle = useAnimatedStyle(() => ({ opacity: womanOpacity.value }));

  const switchToWoman = () => {
    if (isTransitioning.current) return;
    isTransitioning.current = true;
    activeVideoRef.current = 'woman';

    try { womanPlayer.currentTime = 0; womanPlayer.play(); } catch {}

    manOpacity.value = withTiming(0, { duration: CROSSFADE_DURATION });
    womanOpacity.value = withTiming(1, { duration: CROSSFADE_DURATION });

    setTimeout(() => {
      try { manPlayer.pause(); manPlayer.currentTime = 0; } catch {}
      isTransitioning.current = false;
    }, CROSSFADE_DURATION + 100);
  };

  const switchToMan = () => {
    if (isTransitioning.current) return;
    isTransitioning.current = true;
    activeVideoRef.current = 'man';

    try { manPlayer.currentTime = 0; manPlayer.play(); } catch {}

    womanOpacity.value = withTiming(0, { duration: CROSSFADE_DURATION });
    manOpacity.value = withTiming(1, { duration: CROSSFADE_DURATION });

    setTimeout(() => {
      try { womanPlayer.pause(); womanPlayer.currentTime = 0; } catch {}
      isTransitioning.current = false;
    }, CROSSFADE_DURATION + 100);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        if (isTransitioning.current) return;
        const active = activeVideoRef.current;
        const player = active === 'man' ? manPlayer : womanPlayer;
        if (player.duration > 0 && player.currentTime >= player.duration - CROSSFADE_DURATION / 1000) {
          if (active === 'man') {
            switchToWoman();
          } else {
            switchToMan();
          }
        }
      } catch {}
    }, 100);
    return () => clearInterval(interval);
  }, [manPlayer, womanPlayer]);

  return (
    <View style={styles.container}>
      {/* Video background layer */}
      <View style={styles.videoLayer} pointerEvents="none">
        <Animated.View style={[styles.videoContainer, womanStyle]}>
          <VideoView
            player={womanPlayer}
            style={styles.video}
            contentFit="cover"
            nativeControls={false}
            {...(Platform.OS === 'android' ? { surfaceType: 'textureView' as const } : {})}
          />
        </Animated.View>

        <Animated.View style={[styles.videoContainer, manStyle]}>
          <VideoView
            player={manPlayer}
            style={styles.video}
            contentFit="cover"
            nativeControls={false}
            {...(Platform.OS === 'android' ? { surfaceType: 'textureView' as const } : {})}
          />
        </Animated.View>
      </View>

      {/* Content layer - rendered above native video views */}
      <View style={styles.contentLayer} pointerEvents="box-none">
        {/* Dark overlay for contrast */}
        <View style={styles.overlay} pointerEvents="none" />

        {/* Word-by-word reveal (centered at top) */}
        <View style={styles.topArea}>
        {WORD_KEYS.map((key, i) => {
          const word = t(key);
          const animatedStyle = useAnimatedStyle(() => ({
            opacity: wordOpacities[i].value,
          }));

          const isAccent = i === 1; // middle word is accent color
          const wordColor = isAccent ? '#F47C3C' : '#F2F2EE';
          const shadowColor = isAccent
            ? 'rgba(244, 124, 60, 0.4)'
            : 'rgba(242, 242, 238, 0.2)';

          return (
            <Animated.Text
              key={word}
              style={[
                styles.word,
                animatedStyle,
                {
                  color: wordColor,
                  textShadowColor: shadowColor,
                  textShadowOffset: { width: 0, height: 4 },
                  textShadowRadius: 12,
                },
              ]}
            >
              {word}
            </Animated.Text>
          );
        })}

        {/* Brand name – fades in after words finish and stays */}
        <Animated.Text style={[styles.brandTitle, brandStyle]}>
          {t('common:appName')}
        </Animated.Text>

        {/* Subtitle – fades in slightly after brand */}
        <Animated.Text style={[styles.subtitle, subtitleStyle]}>
          {t('intro:heroTagline')}
        </Animated.Text>
      </View>

        {/* Buttons always visible at bottom */}
        <View style={[styles.buttonContainer, { bottom: Math.max(insets.bottom, 20) + 40 }]}>
          <TouchableOpacity style={styles.primaryButton} onPress={onNewUser}>
            <Text style={styles.primaryButtonText}>{t('intro:newUser')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={onExistingUser}>
            <Text style={styles.secondaryButtonText}>{t('intro:existingUser')}</Text>
          </TouchableOpacity>

          {onHaveCode ? (
            <TouchableOpacity style={styles.secondaryButton} onPress={onHaveCode}>
              <Text style={styles.secondaryButtonText}>{t('intro:haveCode')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  videoLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  contentLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  videoContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 17, 20, 0.45)',
  },
  topArea: {
    position: 'absolute',
    top: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    height: 210,
  },
  word: {
    fontFamily: FontFamily.displayBold,
    fontSize: 48,
    letterSpacing: -0.6,
    position: 'absolute',
    textAlign: 'center',
    top: 0,
  },
  brandTitle: {
    position: 'absolute',
    top: 0,
    fontSize: 62,
    ...Typography.brandText,
    color: '#F47C3C',
    textShadowColor: 'rgba(244, 124, 60, 0.4)',
    textShadowOffset: { width: 0, height: 6 },
    textShadowRadius: 16,
  },
  subtitle: {
    position: 'absolute',
    top: 112,
    fontFamily: FontFamily.displayRegular,
    fontSize: 18,
    color: '#F2F2EE',
    opacity: 0.85,
    textAlign: 'center',
    paddingHorizontal: 44,
    lineHeight: 28,
    letterSpacing: 0.3,
  },
  buttonContainer: {
    position: 'absolute',
    left: 36,
    right: 36,
    zIndex: 20,
  },
  primaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#F47C3C',
    paddingVertical: 16,
    borderRadius: 3,
    alignItems: 'center',
    marginBottom: 20,
  },
  primaryButtonText: {
    color: '#F47C3C',
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 13,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#9AA3A6',
    fontFamily: FontFamily.bodyRegular,
    fontSize: 13,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
});
