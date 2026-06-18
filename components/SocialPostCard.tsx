import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize } from '../constants/Typography';
import {
  addComment,
  deletePost,
  listComments,
  type SocialPost,
  type SocialPostComment,
  toggleLike,
} from '../lib/social-posts';

interface SocialPostCardProps {
  post: SocialPost;
  currentUserId: string;
  onChanged?: () => void;
  /** Called after the user successfully deletes their own post. */
  onDeleted?: (postId: number) => void;
}

function formatVolume(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}t`;
  return `${Math.round(kg)} kg`;
}

function formatRelativeTime(iso: string, t: (k: string, opts?: any) => string): string {
  try {
    const created = new Date(iso).getTime();
    const diff = (Date.now() - created) / 1000;
    if (diff < 60) return t('social:timeJustNow');
    if (diff < 3600) return t('social:timeMinutesAgo', { count: Math.floor(diff / 60) });
    if (diff < 86400) return t('social:timeHoursAgo', { count: Math.floor(diff / 3600) });
    if (diff < 86400 * 7) return t('social:timeDaysAgo', { count: Math.floor(diff / 86400) });
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

/**
 * Single post in the Social Feed. Optimistically toggles like state so the
 * UI feels instant; reverts on server error. Comments are loaded lazily on
 * first expand so the feed list stays cheap to render.
 */
export const SocialPostCard: React.FC<SocialPostCardProps> = ({
  post,
  currentUserId,
  onChanged,
  onDeleted,
}) => {
  const { t } = useTranslation(['social', 'common']);
  const isOwnPost = post.userId === currentUserId;

  const handleDelete = useCallback(() => {
    Alert.alert(
      t('social:deletePostConfirmTitle'),
      t('social:deletePostConfirmBody'),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('social:deletePost'),
          style: 'destructive',
          onPress: async () => {
            const ok = await deletePost(post.id, currentUserId);
            if (ok) {
              onDeleted?.(post.id);
            } else {
              Alert.alert(t('common:error'), t('social:postFailedBody'));
            }
          },
        },
      ],
    );
  }, [post.id, currentUserId, onDeleted, t]);

  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<SocialPostComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [exercisesExpanded, setExercisesExpanded] = useState(false);

  useEffect(() => {
    setLiked(post.likedByMe);
    setLikeCount(post.likeCount);
    setCommentCount(post.commentCount);
    setExercisesExpanded(false);
  }, [post.id, post.likedByMe, post.likeCount, post.commentCount]);

  const handleToggleLike = useCallback(async () => {
    const next = !liked;
    setLiked(next);
    setLikeCount(prev => prev + (next ? 1 : -1));
    const ok = await toggleLike(post.id, currentUserId, next);
    if (!ok) {
      // Revert on failure.
      setLiked(!next);
      setLikeCount(prev => prev - (next ? 1 : -1));
      return;
    }
    onChanged?.();
  }, [liked, post.id, currentUserId, onChanged]);

  const ensureCommentsLoaded = useCallback(async () => {
    if (commentsOpen || commentsLoading) return;
    setCommentsLoading(true);
    const data = await listComments(post.id);
    setComments(data);
    setCommentCount(data.length);
    setCommentsLoading(false);
  }, [commentsOpen, commentsLoading, post.id]);

  const handleToggleComments = useCallback(async () => {
    if (!commentsOpen) await ensureCommentsLoaded();
    setCommentsOpen(prev => !prev);
  }, [commentsOpen, ensureCommentsLoaded]);

  const handlePostComment = useCallback(async () => {
    const trimmed = commentDraft.trim();
    if (!trimmed) return;
    setPostingComment(true);
    const created = await addComment(post.id, currentUserId, trimmed);
    setPostingComment(false);
    if (!created) return;
    setCommentDraft('');
    setComments(prev => [...prev, created]);
    setCommentCount(prev => prev + 1);
  }, [commentDraft, post.id, currentUserId]);

  const initial = (post.displayName || '?').trim().charAt(0).toUpperCase();
  const snap = post.metricsSnapshot || {};
  const hasMetrics = !!(
    snap.totalKcal ||
    snap.totalVolumeKg ||
    snap.distance ||
    snap.elevationGainMeters ||
    snap.durationMinutes
  );

  const durationLabel = (() => {
    const minutes = snap.durationMinutes;
    if (!minutes || minutes <= 0) return null;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  })();

  const EXERCISE_PREVIEW_LIMIT = 3;
  const allExercises = snap.exercises ?? [];
  const exerciseCount = allExercises.length;
  const hasExerciseOverflow = exerciseCount > EXERCISE_PREVIEW_LIMIT;
  const visibleExercises = exercisesExpanded || !hasExerciseOverflow
    ? allExercises
    : allExercises.slice(0, EXERCISE_PREVIEW_LIMIT);

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.headerRow}>
        {post.avatarUrl ? (
          <Image source={{ uri: post.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarFallbackText}>{initial}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.author} numberOfLines={1}>{post.displayName}</Text>
          <Text style={styles.meta}>
            {formatRelativeTime(post.createdAt, t)}
            {post.visibility === 'circle' ? ` · ${t('social:visibilityCircleBadge')}` : ''}
          </Text>
        </View>
        {isOwnPost && (
          <TouchableOpacity
            onPress={handleDelete}
            style={styles.headerMoreButton}
            accessibilityRole="button"
            accessibilityLabel={t('social:deletePost')}
            hitSlop={8}
            activeOpacity={0.7}
          >
            <Text style={styles.headerMoreGlyph}>{'\u2026'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Photo */}
      {post.photoUrl ? (
        <Image source={{ uri: post.photoUrl }} style={styles.photo} resizeMode="cover" />
      ) : null}

      {/* Body */}
      <View style={styles.body}>
        <Text style={styles.title}>{post.title}</Text>

        {post.location ? (
          <View style={styles.locationRow}>
            <Text style={styles.locationGlyph}>{'\u{1F4CD}'}</Text>
            <Text style={styles.locationText} numberOfLines={1}>{post.location}</Text>
          </View>
        ) : null}

        {(snap.newPRs?.length ?? 0) > 0 ? (
          <View style={styles.prRow}>
            {snap.newPRs!.map(pr => (
              <View key={pr.exerciseName} style={styles.prChip}>
                <Text style={styles.prChipLabel}>{t('social:prBadge')}</Text>
                <Text style={styles.prChipText} numberOfLines={1}>
                  {pr.exerciseName} · {Math.round(pr.weightKg)}kg × {pr.reps}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {hasMetrics && (
          <View style={styles.chipRow}>
            {durationLabel ? (
              <View style={styles.chip}>
                <Text style={styles.chipValue}>{durationLabel}</Text>
                <Text style={styles.chipUnit}>{t('social:chipDuration')}</Text>
              </View>
            ) : null}
            {snap.totalKcal ? (
              <View style={styles.chip}>
                <Text style={styles.chipValue}>{snap.totalKcal}</Text>
                <Text style={styles.chipUnit}>kcal</Text>
              </View>
            ) : null}
            {snap.totalVolumeKg ? (
              <View style={styles.chip}>
                <Text style={styles.chipValue}>{formatVolume(snap.totalVolumeKg)}</Text>
                <Text style={styles.chipUnit}>{t('social:chipVolume')}</Text>
              </View>
            ) : null}
            {snap.distance ? (
              <View style={styles.chip}>
                <Text style={styles.chipValue}>{snap.distance.value.toFixed(snap.distance.value < 10 ? 1 : 0)} {snap.distance.unit}</Text>
                <Text style={styles.chipUnit}>{t('social:chipDistance')}</Text>
              </View>
            ) : null}
            {snap.elevationGainMeters ? (
              <View style={styles.chip}>
                <Text style={styles.chipValue}>+{Math.round(snap.elevationGainMeters)} m</Text>
                <Text style={styles.chipUnit}>{t('social:chipAltitude')}</Text>
              </View>
            ) : null}
          </View>
        )}

        {exerciseCount > 0 ? (
          <View style={styles.exerciseList}>
            {visibleExercises.map((e) => (
              <View key={e.exerciseName} style={styles.exerciseRow}>
                <Text style={styles.exerciseName} numberOfLines={1}>{e.exerciseName}</Text>
                <Text style={styles.exerciseSummary} numberOfLines={1}>{e.summary}</Text>
              </View>
            ))}
            {hasExerciseOverflow ? (
              <View style={styles.exerciseListFooter}>
                <Text style={styles.exerciseTotal}>
                  {t('social:exercisesTotal', { count: exerciseCount })}
                </Text>
                <TouchableOpacity
                  onPress={() => setExercisesExpanded(prev => !prev)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    exercisesExpanded ? t('social:showLessExercises') : t('social:seeAllExercises')
                  }
                >
                  <Text style={styles.exerciseSeeAll}>
                    {exercisesExpanded ? t('social:showLessExercises') : t('social:seeAllExercises')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity onPress={handleToggleLike} style={styles.actionButton} activeOpacity={0.7}>
          <Text style={[styles.actionIcon, liked && styles.actionIconActive]}>{liked ? '\u2665' : '\u2661'}</Text>
          <Text style={[styles.actionLabel, liked && styles.actionLabelActive]}>
            {likeCount > 0
              ? `${likeCount} ${t(likeCount === 1 ? 'social:likeSingular' : 'social:likes')}`
              : t('social:like')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleToggleComments} style={styles.actionButton} activeOpacity={0.7}>
          <Ionicons
            name={commentsOpen ? 'chatbubble' : 'chatbubble-outline'}
            size={19}
            color={commentsOpen ? BrandColors.accent : BrandColors.textSecondary}
            style={styles.actionIconVector}
          />
          <Text style={[styles.actionLabel, commentsOpen && styles.actionLabelActive]}>
            {commentCount > 0 ? `${commentCount} ` : ''}{t('social:comments')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Comments */}
      {commentsOpen && (
        <View style={styles.commentsSection}>
          {commentsLoading ? (
            <ActivityIndicator color={BrandColors.accent} size="small" />
          ) : (
            <>
              {comments.length === 0 ? (
                <Text style={styles.emptyComments}>{t('social:noCommentsYet')}</Text>
              ) : (
                comments.map(c => (
                  <View key={c.id} style={styles.commentRow}>
                    {c.avatarUrl ? (
                      <Image source={{ uri: c.avatarUrl }} style={styles.commentAvatar} />
                    ) : (
                      <View style={[styles.commentAvatar, styles.avatarFallback]}>
                        <Text style={styles.avatarFallbackTextSmall}>{(c.displayName || '?').charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.commentAuthor}>{c.displayName}</Text>
                      <Text style={styles.commentBody}>{c.body}</Text>
                    </View>
                  </View>
                ))
              )}
              <View style={styles.commentComposer}>
                <TextInput
                  value={commentDraft}
                  onChangeText={setCommentDraft}
                  placeholder={t('social:addCommentPlaceholder')}
                  placeholderTextColor={BrandColors.textTertiary}
                  style={styles.commentInput}
                  multiline
                  maxLength={1000}
                  returnKeyType="send"
                  blurOnSubmit
                  onSubmitEditing={handlePostComment}
                />
                <TouchableOpacity
                  style={[styles.commentSend, (!commentDraft.trim() || postingComment) && styles.commentSendDisabled]}
                  onPress={handlePostComment}
                  disabled={!commentDraft.trim() || postingComment}
                >
                  {postingComment ? (
                    <ActivityIndicator color="#0B1114" size="small" />
                  ) : (
                    <Text style={styles.commentSendText}>{t('social:commentSend')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    overflow: 'hidden',
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerMoreButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -8,
  },
  headerMoreGlyph: {
    fontSize: 22,
    color: BrandColors.textSecondary,
    fontFamily: FontFamily.bodyBold,
    marginTop: -8,
    letterSpacing: 2,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
  },
  locationGlyph: {
    fontSize: 13,
  },
  locationText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textSecondary,
    flex: 1,
    minWidth: 0,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  avatarFallback: {
    backgroundColor: '#1E2A2C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textPrimary,
  },
  avatarFallbackTextSmall: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textPrimary,
  },
  author: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  meta: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    marginTop: 1,
  },
  photo: {
    width: '75%',
    alignSelf: 'center',
    aspectRatio: 4 / 5,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0B1114',
  },
  body: {
    padding: 14,
    gap: 10,
  },
  title: {
    fontFamily: FontFamily.bodyBold,
    fontSize: 19,
    color: BrandColors.textPrimary,
  },
  prRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  prChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BrandColors.accent,
    backgroundColor: 'rgba(244,124,60,0.12)',
  },
  prChipLabel: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.metaSmall,
    color: BrandColors.accent,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  prChipText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textPrimary,
    maxWidth: 200,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: BrandColors.backgroundTertiary,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
  },
  chipValue: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  chipUnit: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
  },
  exerciseList: {
    paddingTop: 4,
    gap: 4,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  exerciseName: {
    flex: 1,
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textPrimary,
  },
  exerciseSummary: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textSecondary,
  },
  exerciseListFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    gap: 12,
  },
  exerciseTotal: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    flex: 1,
  },
  exerciseSeeAll: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.metaSmall,
    color: BrandColors.accent,
  },
  actionsRow: {
    flexDirection: 'row',
    borderTopColor: BrandColors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  actionIcon: {
    fontSize: 18,
    color: BrandColors.textSecondary,
  },
  actionIconActive: {
    color: BrandColors.accent,
  },
  actionIconVector: {
    marginTop: 1,
  },
  actionLabel: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textSecondary,
  },
  actionLabelActive: {
    color: BrandColors.accent,
  },
  commentsSection: {
    borderTopColor: BrandColors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  emptyComments: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  commentRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  commentAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
  },
  commentAuthor: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textPrimary,
  },
  commentBody: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textPrimary,
    marginTop: 2,
    lineHeight: 20,
  },
  commentComposer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
    marginTop: 4,
  },
  commentInput: {
    flex: 1,
    backgroundColor: BrandColors.inputBackground,
    borderWidth: 1,
    borderColor: BrandColors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: Platform.OS === 'ios' ? 10 : 6,
    paddingBottom: Platform.OS === 'ios' ? 10 : 6,
    color: BrandColors.textPrimary,
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    maxHeight: 100,
  },
  commentSend: {
    backgroundColor: BrandColors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentSendDisabled: {
    backgroundColor: '#3A484C',
  },
  commentSendText: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.metaSmall,
    color: '#0B1114',
    letterSpacing: 0.3,
  },
});
