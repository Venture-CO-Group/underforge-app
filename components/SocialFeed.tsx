import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize, TextStyles } from '../constants/Typography';
import { type FeedAudience, listFeedPosts, type SocialPost } from '../lib/social-posts';
import { SocialPostCard } from './SocialPostCard';

interface SocialFeedProps {
  currentUserId: string;
  /** Bumping this key forces a refetch — used after the user shares a new post. */
  refreshKey?: number;
  /** Audience scope for the feed. Defaults to the global public feed. */
  audience?: FeedAudience;
}

const DEFAULT_FEED_AUDIENCE: FeedAudience = { kind: 'public' };

/**
 * Feed sub-tab inside the Social screen. Pulls a single page of posts at mount
 * and on pull-to-refresh; v1 has no infinite scroll. Posts visible to this
 * user are filtered server-then-client by visibility + forging circle.
 */
export const SocialFeed: React.FC<SocialFeedProps> = ({
  currentUserId,
  refreshKey = 0,
  audience = DEFAULT_FEED_AUDIENCE,
}) => {
  const { t } = useTranslation(['social', 'common']);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!currentUserId) {
      setLoading(false);
      return;
    }
    const data = await listFeedPosts(currentUserId, 50, audience);
    setPosts(data);
    setLoading(false);
    setRefreshing(false);
  }, [currentUserId, audience]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load, refreshKey]);

  // Remove a post locally after the user deletes their own card — avoids the
  // extra round-trip and keeps the UI snappy.
  const handleDeleted = useCallback((postId: number) => {
    setPosts(prev => prev.filter(p => p.id !== postId));
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={BrandColors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BrandColors.accent} />
      }
      showsVerticalScrollIndicator={false}
    >
      {posts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t('social:feedEmptyTitle')}</Text>
          <Text style={styles.emptyBody}>{t('social:feedEmptyBody')}</Text>
        </View>
      ) : (
        posts.map(p => (
          <SocialPostCard
            key={p.id}
            post={p}
            currentUserId={currentUserId}
            onChanged={load}
            onDeleted={handleDeleted}
          />
        ))
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    ...TextStyles.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textSecondary,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
