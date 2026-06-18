import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { FontFamily } from '../constants/Typography';

const VIDEO_BG = require('../assets/images/forging_video_man.mp4');

// ── Timing configuration ────────────────────────────────────────────
const WORD_KEYS = ['intro:forgingWords1', 'intro:forgingWords2', 'intro:forgingWords3', 'intro:forgingWords4'] as const;
const WORD_FADE_IN_MS = 400; // fade in duration
const WORD_HOLD_MS = 600; // how long word stays visible
const WORD_FADE_OUT_MS = 400; // fade out duration
const INITIAL_DELAY_MS = 500; // pause before animation begins
const FADE_OUT_MS = 800; // screen fade-out duration

interface ForgingIntroScreenProps {
  onComplete: () => void;
}

// =====================================================================
// ForgingIntroScreen – full-screen video + word-by-word reveal
// =====================================================================
export default function ForgingIntroScreen({ onComplete }: ForgingIntroScreenProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['intro']);
  const screenOpacity = useSharedValue(1);

  const player = useVideoPlayer(VIDEO_BG, (p) => {
    p.loop = true;
    p.muted = true;
    p.playbackRate = 0.6;
    p.play();
  });
  
  // Create opacity values for each word in the parent component
  const wordOpacities = WORD_KEYS.map(() => useSharedValue(0));
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Each word: fade in → hold → fade out, one at a time
    const WORD_CYCLE_MS = WORD_FADE_IN_MS + WORD_HOLD_MS + WORD_FADE_OUT_MS;
    
    WORD_KEYS.forEach((_, i) => {
      const startDelay = INITIAL_DELAY_MS + i * WORD_CYCLE_MS;
      
      wordOpacities[i].value = withDelay(
        startDelay,
        withSequence(
          // Fade in
          withTiming(1, {
            duration: WORD_FADE_IN_MS,
            easing: Easing.out(Easing.ease),
          }),
          // Hold at opacity 1
          withTiming(1, {
            duration: WORD_HOLD_MS,
          }),
          // Fade out
          withTiming(0, {
            duration: WORD_FADE_OUT_MS,
            easing: Easing.in(Easing.ease),
          })
        )
      );
    });

    // Fade out screen after all words complete
    const totalMs = INITIAL_DELAY_MS + WORD_KEYS.length * WORD_CYCLE_MS;
    fadeTimerRef.current = setTimeout(() => {
      screenOpacity.value = withTiming(
        0,
        { duration: FADE_OUT_MS },
        (finished) => {
          if (finished) runOnJS(onComplete)();
        },
      );
    }, totalMs);

    return () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, []);

  const screenStyle = useAnimatedStyle(() => ({ opacity: screenOpacity.value }));

  return (
    <Animated.View style={[styles.container, screenStyle]}>
      {/* Video background */}
      <View style={styles.videoLayer} pointerEvents="none">
        <VideoView
          player={player}
          style={styles.video}
          contentFit="cover"
          nativeControls={false}
        />
      </View>

      {/* Content layer above native video */}
      <View style={styles.contentLayer} pointerEvents="box-none">
      {/* Dark overlay for contrast */}
      <View style={styles.overlay} pointerEvents="none" />

      {/* Words reveal at the top of the screen */}
      <View style={styles.topArea}>
        {WORD_KEYS.map((key, i) => {
          const word = t(key);
          const animatedStyle = useAnimatedStyle(() => ({
            opacity: wordOpacities[i].value,
          }));
          
          const isAccent = i === 1;
          const wordColor = isAccent ? '#F47C3C' : '#F2F2EE';
          const shadowColor = isAccent
            ? 'rgba(244, 124, 60, 0.4)'
            : 'rgba(242, 242, 238, 0.2)';

          return (
            <Animated.Text
              key={word}
              style={[
                gStyles.word,
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
      </View>
      {/* Skip button (no background, no border) */}
      <TouchableOpacity
        style={[styles.skipButton, { top: insets.top + 10 }]}
        onPress={() => {
          // Cancel pending timer and immediately complete
          if (fadeTimerRef.current) {
            clearTimeout(fadeTimerRef.current);
            fadeTimerRef.current = null;
          }
          onComplete();
        }}
        accessibilityLabel={t('intro:skipA11y')}
      >
        <Text style={styles.skipText}>{t('intro:skip')}</Text>
      </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

// =====================================================================
// Styles
// =====================================================================
const gStyles = StyleSheet.create({
  word: {
    fontFamily: FontFamily.displayBold,
    fontSize: 48,
    letterSpacing: -0.6,
    position: 'absolute',
    textAlign: 'center',
  },
});

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
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 17, 20, 0.5)',
  },
  topArea: {
    position: 'absolute',
    top: '25%',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    height: 60,
  },
  skipButton: {
    position: 'absolute',
    right: 20,
    zIndex: 30,
    padding: 8,
    minWidth: 44,
    minHeight: 44,
  },
  skipText: {
    color: '#F2F2EE',
    fontSize: 16,
    opacity: 0.9,
  },
});
