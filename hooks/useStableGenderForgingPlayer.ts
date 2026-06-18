import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import { useEffect } from 'react';

const VIDEO_BG_MAN = require('../assets/images/forging_video_man.mp4');
const VIDEO_BG_WOMAN = require('../assets/images/forging_video_woman.mp4');

function applyForgingPlaybackDefaults(player: VideoPlayer) {
  player.loop = true;
  player.muted = true;
  player.playbackRate = 0.6;
}

/**
 * Forging background clips with a stable native player. Passing a changing asset into
 * `useVideoPlayer(source)` recreates the shared native object and can race with
 * `SurfaceVideoView` on Android ("shared object that was already released").
 * We keep one player and swap the source with `replaceAsync` instead.
 */
export function useStableGenderForgingPlayer(
  userGender: string | undefined | null,
  mode: 'autoplay' | 'manual'
): VideoPlayer {
  const player = useVideoPlayer(VIDEO_BG_MAN, (p) => {
    applyForgingPlaybackDefaults(p);
    if (mode === 'autoplay') {
      p.play();
    } else {
      p.pause();
    }
  });

  useEffect(() => {
    const src = userGender === 'female' ? VIDEO_BG_WOMAN : VIDEO_BG_MAN;
    let cancelled = false;
    void (async () => {
      try {
        await player.replaceAsync(src);
      } catch {
        return;
      }
      if (cancelled) return;
      try {
        applyForgingPlaybackDefaults(player);
        if (mode === 'autoplay') {
          player.play();
        }
      } catch {
        /* player may be tearing down */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userGender, player, mode]);

  return player;
}
