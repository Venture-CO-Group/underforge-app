import { supabase } from './supabase_db_new';
import { glowLogger } from './glow-logger';
import {
  listAllOwnedCircleParticipantIds,
  listCircleParticipantIds,
} from './forging-circle';

export type PostVisibility = 'public' | 'circle';

export interface ShareOptions {
  exercises: boolean;
  kcals: boolean;
  totalVolume: boolean;
  strengthGains: boolean;
  distance: boolean;
  altitude: boolean;
  newPR: boolean;
}

export const DEFAULT_SHARE_OPTIONS: ShareOptions = {
  exercises: true,
  kcals: true,
  totalVolume: true,
  strengthGains: true,
  distance: true,
  altitude: true,
  newPR: true,
};

export interface MetricsSnapshot {
  exercises?: { exerciseName: string; setsCompleted: number; summary: string }[];
  totalKcal?: number;
  totalVolumeKg?: number;
  newPRs?: { exerciseName: string; weightKg: number; reps: number; e1rmKg: number }[];
  distance?: { value: number; unit: 'km' | 'mi' } | null;
  elevationGainMeters?: number | null;
  /** Activity-only: how long the session lasted, in minutes. */
  durationMinutes?: number;
  workoutTitle?: string;
}

export interface SocialPost {
  id: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  workoutLogId: number | null;
  activityLogId: number | null;
  title: string;
  photoUrl: string | null;
  location: string | null;
  visibility: PostVisibility;
  shareOptions: ShareOptions;
  metricsSnapshot: MetricsSnapshot;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

export interface SocialPostComment {
  id: number;
  postId: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
}

export interface CreatePostInput {
  userId: string;
  workoutLogId?: number | null;
  activityLogId?: number | null;
  title: string;
  photoUrl?: string | null;
  location?: string | null;
  visibility: PostVisibility;
  shareOptions: ShareOptions;
  metricsSnapshot: MetricsSnapshot;
}

/**
 * Audience filter for {@link listFeedPosts}.
 *
 *  - `{ kind: 'public' }`: only globally public posts (visibility = 'public').
 *  - `{ kind: 'only-me' }`: only the viewer's own posts — a virtual "circle"
 *    that surfaces solo activity (no membership rows; everyone has it).
 *  - `{ kind: 'circle', circleId }`: posts authored by anyone in that specific
 *    circle (owner + members, ∪ self), where the post is either public or a
 *    circle-default post (visibility = 'circle' AND circle_id IS NULL OR
 *    matches the filter).
 *  - `{ kind: 'all-mine' }`: union of public posts plus posts from any of the
 *    viewer's owned circles. Used by the leaderboard's "circles" scope.
 */
export type FeedAudience =
  | { kind: 'public' }
  | { kind: 'only-me' }
  | { kind: 'circle'; circleId: number }
  | { kind: 'all-mine' };

/**
 * Insert a new social post. Returns the inserted row id or null on failure.
 */
export const createSocialPost = async (input: CreatePostInput): Promise<number | null> => {
  if (!supabase) {
    glowLogger.warn('Supabase not initialized, cannot create social post');
    return null;
  }
  try {
    const trimmedLocation = (input.location ?? '').trim().slice(0, 80);
    const { data, error } = await supabase
      .from('social_posts')
      .insert({
        user_id: input.userId,
        workout_log_id: input.workoutLogId ?? null,
        activity_log_id: input.activityLogId ?? null,
        title: input.title,
        photo_url: input.photoUrl ?? null,
        location: trimmedLocation ? trimmedLocation : null,
        visibility: input.visibility,
        share_options: input.shareOptions,
        metrics_snapshot: input.metricsSnapshot,
      })
      .select('id')
      .single();
    if (error) {
      glowLogger.error('createSocialPost failed', { error: error.message || String(error) });
      return null;
    }
    return data?.id ?? null;
  } catch (error) {
    glowLogger.error('createSocialPost threw', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

/**
 * Fetch the social feed for the current user. Returns posts visible to them:
 * - any 'public' post
 * - any 'circle' post from authors who are in the user's forging circle
 * - their own posts (both visibilities)
 *
 * Likes/comments counts are denormalized at read time via a single follow-up
 * query each; this keeps the schema simple while making feeds tolerable for
 * v1 audiences (<a few hundred posts).
 */
/**
 * Pick the first accessible circle that already has feed content; otherwise
 * fall back to the global Public filter.
 */
export const pickDefaultFeedAudience = async (
  currentUserId: string,
  circles: { id: number }[],
): Promise<FeedAudience> => {
  for (const circle of circles) {
    const posts = await listFeedPosts(currentUserId, 1, { kind: 'circle', circleId: circle.id });
    if (posts.length > 0) {
      return { kind: 'circle', circleId: circle.id };
    }
  }
  return { kind: 'public' };
};

export const listFeedPosts = async (
  currentUserId: string,
  limit: number = 50,
  audience: FeedAudience = { kind: 'public' },
): Promise<SocialPost[]> => {
  if (!supabase) return [];
  try {
    // Resolve the set of author ids allowed in circle-scoped filters. We
    // always include the viewer so they can see their own posts in every
    // filter.
    let circleAllowedIds = new Set<string>([currentUserId]);
    if (audience.kind === 'circle') {
      const ids = await listCircleParticipantIds(audience.circleId);
      circleAllowedIds = new Set<string>([currentUserId, ...ids]);
    } else if (audience.kind === 'all-mine') {
      const ids = await listAllOwnedCircleParticipantIds(currentUserId);
      circleAllowedIds = new Set<string>([currentUserId, ...ids]);
    }

    const { data: rows, error } = await supabase
      .from('social_posts')
      .select(`
        id, user_id, workout_log_id, activity_log_id, title, photo_url, location,
        visibility, circle_id, share_options, metrics_snapshot, created_at,
        user_profile:user_profile!social_posts_user_id_fkey ( display_name, avatar_url )
      `)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      glowLogger.error('listFeedPosts query failed', { error: error.message || String(error) });
      return [];
    }

    const visiblePosts = (rows || []).filter((r: any) => {
      const isPublic = r.visibility === 'public';

      // "Only me" is the strictest filter: even own posts that would otherwise
      // be public are kept, but no one else's posts ever show up. Compute this
      // before the "self is always visible" shortcut so the filter actually
      // narrows to a single user.
      if (audience.kind === 'only-me') {
        return r.user_id === currentUserId;
      }

      // Own posts are always visible in any other filter.
      if (r.user_id === currentUserId) return true;

      if (audience.kind === 'public') {
        // Strictly public posts only — the "Public" tab.
        return isPublic;
      }
      if (audience.kind === 'circle') {
        // Per-circle filter: posts authored by any participant of that circle
        // (owner + members), regardless of post visibility. Public posts
        // appear in every owned circle filter by design.
        if (!circleAllowedIds.has(r.user_id)) return false;
        if (isPublic) return true;
        // 'circle' visibility: NULL circle_id is a broadcast to all owned
        // circles; a specific circle_id must match the active filter.
        return r.circle_id == null || r.circle_id === audience.circleId;
      }
      // 'all-mine': public posts plus any circle-scoped posts authored by a
      // participant of any owned circle.
      if (isPublic) return true;
      return circleAllowedIds.has(r.user_id);
    });

    if (visiblePosts.length === 0) return [];

    const postIds = visiblePosts.map((r: any) => r.id);

    const [likesResp, commentsResp, myLikesResp] = await Promise.all([
      supabase.from('social_post_likes').select('post_id').in('post_id', postIds),
      supabase.from('social_post_comments').select('post_id').is('deleted_at', null).in('post_id', postIds),
      supabase.from('social_post_likes').select('post_id').in('post_id', postIds).eq('user_id', currentUserId),
    ]);

    const likeCounts = new Map<number, number>();
    (likesResp.data || []).forEach((row: any) => {
      likeCounts.set(row.post_id, (likeCounts.get(row.post_id) || 0) + 1);
    });
    const commentCounts = new Map<number, number>();
    (commentsResp.data || []).forEach((row: any) => {
      commentCounts.set(row.post_id, (commentCounts.get(row.post_id) || 0) + 1);
    });
    const myLikedSet = new Set<number>((myLikesResp.data || []).map((row: any) => row.post_id));

    return visiblePosts.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      displayName: r.user_profile?.display_name || 'A Forger',
      avatarUrl: r.user_profile?.avatar_url ?? null,
      workoutLogId: r.workout_log_id ?? null,
      activityLogId: r.activity_log_id ?? null,
      title: r.title,
      photoUrl: r.photo_url ?? null,
      location: r.location ?? null,
      visibility: r.visibility as PostVisibility,
      shareOptions: { ...DEFAULT_SHARE_OPTIONS, ...(r.share_options || {}) },
      metricsSnapshot: r.metrics_snapshot || {},
      createdAt: r.created_at,
      likeCount: likeCounts.get(r.id) || 0,
      commentCount: commentCounts.get(r.id) || 0,
      likedByMe: myLikedSet.has(r.id),
    }));
  } catch (error) {
    glowLogger.error('listFeedPosts threw', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

export const toggleLike = async (postId: number, userId: string, liked: boolean): Promise<boolean> => {
  if (!supabase) return false;
  try {
    if (liked) {
      const { error } = await supabase.from('social_post_likes').insert({ post_id: postId, user_id: userId });
      if (error && !String(error.message || '').includes('duplicate')) {
        glowLogger.error('toggleLike insert failed', { error: error.message });
        return false;
      }
    } else {
      const { error } = await supabase
        .from('social_post_likes')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', userId);
      if (error) {
        glowLogger.error('toggleLike delete failed', { error: error.message });
        return false;
      }
    }
    return true;
  } catch (error) {
    glowLogger.error('toggleLike threw', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
};

export const addComment = async (postId: number, userId: string, body: string): Promise<SocialPostComment | null> => {
  if (!supabase) return null;
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    const { data, error } = await supabase
      .from('social_post_comments')
      .insert({ post_id: postId, user_id: userId, body: trimmed.slice(0, 1000) })
      .select(`
        id, post_id, user_id, body, created_at,
        user_profile:user_profile!social_post_comments_user_id_fkey ( display_name, avatar_url )
      `)
      .single();
    if (error || !data) {
      glowLogger.error('addComment failed', { error: error?.message || 'no data' });
      return null;
    }
    return {
      id: data.id,
      postId: data.post_id,
      userId: data.user_id,
      displayName: (data as any).user_profile?.display_name || 'A Forger',
      avatarUrl: (data as any).user_profile?.avatar_url ?? null,
      body: data.body,
      createdAt: data.created_at,
    };
  } catch (error) {
    glowLogger.error('addComment threw', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
};

export const listComments = async (postId: number): Promise<SocialPostComment[]> => {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('social_post_comments')
      .select(`
        id, post_id, user_id, body, created_at,
        user_profile:user_profile!social_post_comments_user_id_fkey ( display_name, avatar_url )
      `)
      .is('deleted_at', null)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) {
      glowLogger.error('listComments failed', { error: error.message });
      return [];
    }
    return (data || []).map((r: any) => ({
      id: r.id,
      postId: r.post_id,
      userId: r.user_id,
      displayName: r.user_profile?.display_name || 'A Forger',
      avatarUrl: r.user_profile?.avatar_url ?? null,
      body: r.body,
      createdAt: r.created_at,
    }));
  } catch (error) {
    glowLogger.error('listComments threw', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
};

export const deletePost = async (postId: number, userId: string): Promise<boolean> => {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('social_posts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', postId)
      .eq('user_id', userId);
    if (error) {
      glowLogger.error('deletePost failed', { error: error.message });
      return false;
    }
    return true;
  } catch (error) {
    glowLogger.error('deletePost threw', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
};
