import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize, LetterSpacing, LineHeight, TextStyles } from '../constants/Typography';
import { formatLocalYmd, getWeekMondaySundayYmd } from '../lib/consistency-helper';
import { getCurrentLoggedInUser } from '../lib/db';
import {
  fetchLeaderboard,
  LeaderboardEntry,
  refreshLeaderboardScoreFromLocalData,
  syncUnsyncedScoresToSupabase,
} from '../lib/leaderboard-storage';
import { type ForgingCircle, listAccessibleCircles } from '../lib/forging-circle';
import { pickDefaultFeedAudience, type FeedAudience } from '../lib/social-posts';
import { getRemoteUserProfileLoggedInUser } from '../lib/supabase_db_new';
import { styles as coachStyles } from '../styles/CoachDashboard.styles';
import { Onboard } from '../types/onboard';
import { SocialFeed } from './SocialFeed';

type SocialSubTab = 'feed' | 'leaderboard';

// ─── Helpers ────────────────────────────────────────────────────────────────

const LEADERBOARD_SCALE = 0.85;
const lb = (n: number) => n * LEADERBOARD_SCALE;

/** Get the Monday of the current week as YYYY-MM-DD (matches CoachDashboard week bounds). */
const getCurrentWeekStart = (): string => {
  const { monday } = getWeekMondaySundayYmd(new Date());
  return formatLocalYmd(monday);
};

/** Get a deterministic color for a user based on their ID */
const getAvatarColor = (userId: string): string => {
  const colors = [
    '#F47C3C', '#4FAE8A', '#5B9BD5', '#9B7BB8',
    '#E0A458', '#62B6CB', '#7B8FD4', '#5AAFA9',
    '#C65B5B', '#F9A06A',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

// ─── Props ──────────────────────────────────────────────────────────────────

export interface CommunityScreenProps {
  onboardingData: Onboard;
  /** Bumped by the parent after a successful share post so the Feed refetches. */
  feedRefreshKey?: number;
  /** Bumped to force the Leaderboard sub-tab open (e.g. from the streak sheet). */
  leaderboardRequestKey?: number;
  /** Opens the Hamburger menu directly on the Forging Circle screen. */
  onOpenForgingCircle?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const CommunityScreen: React.FC<CommunityScreenProps> = ({
  onboardingData,
  feedRefreshKey = 0,
  leaderboardRequestKey = 0,
  onOpenForgingCircle,
}) => {
  const { t } = useTranslation(['social', 'common']);
  const [activeSubTab, setActiveSubTab] = useState<SocialSubTab>('feed');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  /**
   * "What I see" audience filter for both Feed and Leaderboard.
   *  - `{ kind: 'public' }` (default): only globally public posts.
   *  - `{ kind: 'circle', circleId }`: posts in that specific owned circle
   *    plus any public posts from that circle's participants.
   */
  const [audience, setAudience] = useState<FeedAudience>({ kind: 'public' });
  const [audiencePickerOpen, setAudiencePickerOpen] = useState(false);
  const [myCircles, setMyCircles] = useState<ForgingCircle[]>([]);
  /**
   * Bumped by the AppState foreground listener so the SocialFeed and
   * leaderboard re-fetch any time the user reopens the app. Membership and
   * post visibility are computed at read time, so this is all we need to
   * surface changes made by other participants "immediately" without
   * pull-to-refresh.
   */
  const [foregroundTick, setForegroundTick] = useState(0);
  /** Current user's sharing preference (Menu → Forging Circles). Drives the visibility note on the leaderboard. */
  const [myShareAudience, setMyShareAudience] = useState<'public' | 'circles'>('circles');
  const insets = useSafeAreaInsets();
  /** Once the user picks a filter manually, stop auto-selecting a circle default. */
  const audienceLockedByUserRef = useRef(false);

  // When the parent flags a fresh share, jump the user into the Feed so they
  // immediately see (or can find) the post they just published.
  useEffect(() => {
    if (feedRefreshKey > 0) setActiveSubTab('feed');
  }, [feedRefreshKey]);

  // When the parent asks for the Leaderboard sub-tab (e.g. from "See other
  // people's consistency"), honor it.
  useEffect(() => {
    if (leaderboardRequestKey > 0) setActiveSubTab('leaderboard');
  }, [leaderboardRequestKey]);

  const loadUserJoinDateYmd = useCallback(async (userId: string): Promise<string | null> => {
    try {
      const { supabase } = await import('../lib/supabase_db_new');
      if (!supabase) return null;

      const { data, error } = await supabase
        .from('user_profile')
        .select('created_at')
        .eq('user_id', userId)
        .single();

      if (error || !data?.created_at) return null;
      return formatLocalYmd(new Date(data.created_at));
    } catch {
      return null;
    }
  }, []);

  // ── Load leaderboard ──────────────────────────────────────────────────
  const loadLeaderboard = useCallback(async () => {
    try {
      const user = await getCurrentLoggedInUser();
      let plannedTrainingDays = new Set(
        (onboardingData.actionPlan?.steps?.[0]?.daysOfWeek ?? []).map(d => d.toLowerCase()),
      );

      if (user) {
        setCurrentUserId(user.id);
        const userJoinDateYmd = await loadUserJoinDateYmd(user.id);

        const remote = await getRemoteUserProfileLoggedInUser();
        if (remote?.default_share_audience) {
          setMyShareAudience(remote.default_share_audience);
        }

        if (plannedTrainingDays.size === 0) {
          const remoteDays = remote?.onboardingProfile?.actionPlan?.steps?.[0]?.daysOfWeek;
          if (remoteDays?.length) {
            plannedTrainingDays = new Set(remoteDays.map(d => d.toLowerCase()));
          }
        }

        await refreshLeaderboardScoreFromLocalData(user.id, plannedTrainingDays, userJoinDateYmd);
        await syncUnsyncedScoresToSupabase(user.id);
      }

      const weekStart = getCurrentWeekStart();
      console.log('[CommunityScreen] Fetching leaderboard for week:', weekStart);
      const entries = await fetchLeaderboard(weekStart, user?.id, audience);
      console.log('[CommunityScreen] Leaderboard entries:', entries.length);
      setLeaderboard(entries);
    } catch (error) {
      console.error('[CommunityScreen] Error loading leaderboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadUserJoinDateYmd, onboardingData.actionPlan?.steps, audience]);

  useEffect(() => {
    loadLeaderboard();
    // foregroundTick is intentionally part of the dep array so we re-fetch
    // the leaderboard whenever the app returns to the foreground.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadLeaderboard, foregroundTick]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadLeaderboard();
  }, [loadLeaderboard]);

  // ── Audience filter pill ──────────────────────────────────────────────

  /** Refresh the user's owned circles so the filter sheet stays current. */
  const loadMyCircles = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const cs = await listAccessibleCircles(currentUserId);
      setMyCircles(cs);
      if (!audienceLockedByUserRef.current) {
        const next = await pickDefaultFeedAudience(currentUserId, cs);
        setAudience(next);
      } else {
        // If the active filter points at a circle that no longer exists (e.g.
        // the user deleted it from the menu), fall back to Public.
        setAudience(prev => {
          if (prev.kind === 'circle' && !cs.some(c => c.id === prev.circleId)) {
            return { kind: 'public' };
          }
          return prev;
        });
      }
    } catch {
      // Non-fatal: leave previous list as-is.
    }
  }, [currentUserId]);

  useEffect(() => {
    loadMyCircles();
  }, [loadMyCircles]);

  // Live refresh on app foreground: bump foregroundTick so the leaderboard
  // and SocialFeed re-fetch, and reload owned circles in case the user
  // created/deleted one in the menu while suspended.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev !== 'active' && next === 'active') {
        setForegroundTick(n => n + 1);
        loadMyCircles();
      }
    });
    return () => sub.remove();
  }, [loadMyCircles]);

  const audienceLabel = useMemo(() => {
    if (audience.kind === 'circle') {
      const match = myCircles.find(c => c.id === audience.circleId);
      return match?.name ?? t('social:audienceCircle');
    }
    if (audience.kind === 'all-mine') return t('social:audienceCircle');
    if (audience.kind === 'only-me') return t('social:audienceOnlyMe');
    return t('social:audienceAll');
  }, [audience, myCircles, t]);

  const handlePressAudience = useCallback(() => {
    // Make sure circle names are fresh when the picker opens (in case the
    // user just created/renamed one from the menu).
    loadMyCircles();
    setAudiencePickerOpen(true);
  }, [loadMyCircles]);

  type AudienceOptionTone = 'public' | 'private' | 'circle';

  type AudienceOption = {
    key: string;
    label: string;
    subtitle: string;
    value: FeedAudience;
    tone: AudienceOptionTone;
  };

  const globalAudienceOptions = useMemo<AudienceOption[]>(
    () => [
      {
        key: 'public',
        label: t('social:audienceAll'),
        subtitle: t('social:audienceAllSubtitle'),
        value: { kind: 'public' },
        tone: 'public',
      },
      {
        key: 'only-me',
        label: t('social:audienceOnlyMe'),
        subtitle: t('social:audienceOnlyMeSubtitle'),
        value: { kind: 'only-me' },
        tone: 'private',
      },
    ],
    [t],
  );

  const circleAudienceOptions = useMemo<AudienceOption[]>(
    () =>
      myCircles.map(c => ({
        key: `circle-${c.id}`,
        label: c.name,
        subtitle: t('social:audienceCircleFilterSubtitle'),
        value: { kind: 'circle' as const, circleId: c.id },
        tone: 'circle' as const,
      })),
    [myCircles, t],
  );

  const isSelected = useCallback((opt: AudienceOption) => {
    if (opt.value.kind === 'public' && audience.kind === 'public') return true;
    if (opt.value.kind === 'only-me' && audience.kind === 'only-me') return true;
    if (opt.value.kind === 'circle' && audience.kind === 'circle') {
      return opt.value.circleId === audience.circleId;
    }
    return false;
  }, [audience]);

  const selectAudience = useCallback((value: FeedAudience) => {
    audienceLockedByUserRef.current = true;
    setAudience(value);
    setAudiencePickerOpen(false);
  }, []);

  const renderAudienceOption = (opt: AudienceOption) => {
    const selected = isSelected(opt);
    const toneStyle =
      opt.tone === 'public'
        ? styles.audienceSheetOptionPublic
        : opt.tone === 'private'
          ? styles.audienceSheetOptionPrivate
          : null;
    const leadingStyle =
      opt.tone === 'public'
        ? styles.audienceOptionLeadingPublic
        : opt.tone === 'private'
          ? styles.audienceOptionLeadingPrivate
          : styles.audienceOptionLeadingCircle;
    const leadingLabel =
      opt.tone === 'public' ? 'ALL' : opt.tone === 'private' ? 'ME' : (opt.label || '?').trim().charAt(0).toUpperCase();

    return (
      <TouchableOpacity
        key={opt.key}
        style={[
          styles.audienceSheetOption,
          toneStyle,
          selected && styles.audienceSheetOptionSelected,
        ]}
        onPress={() => selectAudience(opt.value)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ selected }}
      >
        <View style={[styles.audienceOptionLeading, leadingStyle]}>
          <Text
            style={[
              styles.audienceOptionLeadingText,
              opt.tone === 'private' && styles.audienceOptionLeadingTextPrivate,
            ]}
          >
            {leadingLabel}
          </Text>
        </View>
        <View style={styles.audienceOptionCopy}>
          <Text
            style={[
              styles.audienceSheetOptionLabel,
              selected && styles.audienceSheetOptionLabelSelected,
            ]}
            numberOfLines={1}
          >
            {opt.label}
          </Text>
          <Text style={styles.audienceSheetOptionSubtitle} numberOfLines={2}>
            {opt.subtitle}
          </Text>
        </View>
        {selected ? (
          <View style={styles.audienceSheetCheck}>
            <Text style={styles.audienceSheetCheckMark}>{'\u2713'}</Text>
          </View>
        ) : (
          <View style={styles.audienceSheetCheckPlaceholder} />
        )}
      </TouchableOpacity>
    );
  };

  // ── Render Helpers ────────────────────────────────────────────────────

  const renderLeaderboardRow = (entry: LeaderboardEntry, index: number) => {
    const isCurrentUser = entry.user_id === currentUserId;
    const rankColor = index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : BrandColors.textSecondary;
    const initial = (entry.display_name || 'U').charAt(0).toUpperCase();
    const avatarBg = getAvatarColor(entry.user_id);

    return (
      <View
        key={entry.user_id}
        style={[
          styles.leaderboardRow,
          isCurrentUser && styles.leaderboardRowHighlight,
          index === 0 && styles.leaderboardRowFirst,
        ]}
      >
        {/* Rank */}
        <View style={styles.rankContainer}>
          <Text style={[styles.rankText, { color: rankColor }]}>
            {index + 1}
          </Text>
        </View>

        {/* Avatar */}
        <View style={[styles.avatarContainer, { backgroundColor: avatarBg }]}>
          {entry.avatar_url ? (
            <Image source={{ uri: entry.avatar_url }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarInitial}>{initial}</Text>
          )}
        </View>

        {/* Name */}
        <View style={styles.nameContainer}>
          <Text style={[styles.nameText, isCurrentUser && styles.nameTextHighlight]} numberOfLines={1}>
            {entry.display_name}
            {isCurrentUser ? t('social:youSuffix') : ''}
          </Text>
        </View>

        {/* This Week */}
        <View style={styles.scoreCell}>
          <Text style={styles.scoreCellValue}>{entry.this_week_score}</Text>
        </View>

        {/* Avg Score */}
        <View style={styles.scoreCell}>
          <Text style={[styles.scoreCellValue, styles.scoreCellValueAccent]}>
            {entry.score_to_date}
          </Text>
        </View>

        {/* Weeks */}
        <View style={styles.weeksCell}>
          <Text style={styles.weeksCellValue}>{entry.weeks_active}</Text>
        </View>
      </View>
    );
  };

  const renderEmptyLeaderboard = () => (
    <View style={styles.emptyState}>
      {/* removed leaderboard icon for consistency */ }
      <Text style={styles.emptyTitle}>{t('social:emptyLeaderboardTitle')}</Text>
      <Text style={styles.emptySubtitle}>{t('social:emptyLeaderboardSubtitle')}</Text>
    </View>
  );

  // ── Main Render ───────────────────────────────────────────────────────

  const renderLeaderboard = () => (
    <ScrollView
      style={styles.scrollView}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={BrandColors.accent}
        />
      }
    >
      <View style={styles.section}>
        <Text style={coachStyles.scoreLabel}>{t('social:leaderboardTitle')}</Text>

        {currentUserId && audience.kind === 'public' ? (
          myShareAudience === 'public' ? (
            <Text
              style={styles.leaderboardVisibilityNote}
              accessibilityLiveRegion="polite"
            >
              {t('social:defaultAudienceVisibleToOthers')}
            </Text>
          ) : myShareAudience === 'circles' ? (
            <Text
              style={styles.leaderboardVisibilityNote}
              accessibilityLiveRegion="polite"
            >
              {t('social:defaultAudienceHiddenFromOthers')}
            </Text>
          ) : null
        ) : null}

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={BrandColors.accent} />
            <Text style={styles.loadingText}>{t('social:loadingLeaderboard')}</Text>
          </View>
        ) : leaderboard.length === 0 ? (
          renderEmptyLeaderboard()
        ) : (
          <>
            <View style={styles.tableHeader}>
              <View style={styles.rankContainer}>
                <Text style={styles.tableHeaderText}>{t('social:tableHeaderRank')}</Text>
              </View>
              <View style={styles.avatarContainer} />
              <View style={styles.nameContainer}>
                <Text style={styles.tableHeaderText}>{t('social:tableHeaderName')}</Text>
              </View>
              <View style={styles.scoreCell}>
                <Text style={styles.tableHeaderText}>{t('social:tableHeaderWeek')}</Text>
              </View>
              <View style={styles.scoreCell}>
                <Text style={styles.tableHeaderText}>{t('social:tableHeaderAvg')}</Text>
              </View>
              <View style={styles.weeksCell}>
                <Text style={styles.tableHeaderText}>{t('social:tableHeaderWks')}</Text>
              </View>
            </View>
            <View style={styles.tableDivider} />
            {leaderboard.map((entry, index) => renderLeaderboardRow(entry, index))}
          </>
        )}

      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      {/* Compact toolbar: Feed | Leaderboard + audience filter pill */}
      <View style={styles.socialToolbar}>
        <View style={styles.segmentedRow}>
          <TouchableOpacity
            onPress={() => setActiveSubTab('feed')}
            style={[styles.segmentBtn, activeSubTab === 'feed' && styles.segmentBtnActive]}
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentLabel, activeSubTab === 'feed' && styles.segmentLabelActive]}>
              {t('social:tabFeed')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveSubTab('leaderboard')}
            style={[styles.segmentBtn, activeSubTab === 'leaderboard' && styles.segmentBtnActive]}
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentLabel, activeSubTab === 'leaderboard' && styles.segmentLabelActive]}>
              {t('social:tabLeaderboard')}
            </Text>
          </TouchableOpacity>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('social:audienceFilterLabel')}: ${audienceLabel}`}
          onPress={handlePressAudience}
          style={({ pressed }) => [styles.audiencePill, pressed && styles.audiencePillPressed]}
        >
          <Text style={styles.audiencePillValue} numberOfLines={1}>
            {audienceLabel}
          </Text>
          <Text style={styles.audiencePillChevron}>{'\u25BE'}</Text>
        </Pressable>
      </View>

      <View style={styles.decideRow}>
        <Text style={styles.decideText} numberOfLines={1}>
          {t('social:decideAudienceLine')}{' '}
          <Text
            style={styles.decideLink}
            onPress={onOpenForgingCircle}
            accessibilityRole="link"
          >
            {t('social:decideAudienceLink')}
          </Text>
        </Text>
      </View>

      <Modal
        transparent
        animationType="slide"
        visible={audiencePickerOpen}
        onRequestClose={() => setAudiencePickerOpen(false)}
      >
        <Pressable
          style={styles.audienceSheetBackdrop}
          onPress={() => setAudiencePickerOpen(false)}
        >
          <Pressable
            style={[styles.audienceSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.audienceSheetHandle} />
            <Text style={styles.audienceSheetTitle}>{t('social:audienceFilterLabel')}</Text>
            <Text style={styles.audienceSheetSubtitle}>{t('social:audienceFilterSubtitle')}</Text>

            <View style={styles.audienceSheetOptions}>
              {globalAudienceOptions.map(renderAudienceOption)}
              {circleAudienceOptions.length > 0 ? (
                <>
                  <Text style={styles.audienceSheetSectionLabel}>
                    {t('social:audienceCirclesSection')}
                  </Text>
                  {circleAudienceOptions.map(renderAudienceOption)}
                </>
              ) : null}
            </View>

            <TouchableOpacity
              style={styles.audienceSheetDismiss}
              onPress={() => setAudiencePickerOpen(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.audienceSheetDismissText}>{t('common:cancel')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {activeSubTab === 'feed' ? (
        currentUserId ? (
          <SocialFeed
            currentUserId={currentUserId}
            refreshKey={feedRefreshKey + foregroundTick}
            audience={audience}
          />
        ) : (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={BrandColors.accent} />
          </View>
        )
      ) : (
        renderLeaderboard()
      )}
    </View>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BrandColors.backgroundPrimary,
  },
  scrollView: {
    flex: 1,
  },

  // ── Screen Header ─────────────────────────────────────────────────────
  screenHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  screenTitle: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
    marginBottom: 4,
  },
  screenSubtitle: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textSecondary,
  },

  // ── Sections ──────────────────────────────────────────────────────────
  section: {
    backgroundColor: BrandColors.backgroundSecondary,
    padding: 20,
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
  },
  leaderboardVisibilityNote: {
    marginTop: 6,
    marginBottom: 4,
    fontFamily: FontFamily.body,
    fontSize: lb(FontSize.meta),
    color: BrandColors.textSecondary,
    textAlign: 'center',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    ...TextStyles.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  sectionTitleStandalone: {
    ...TextStyles.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
    marginBottom: 16,
  },

  // ── Leaderboard table (0.85 scale; title uses coachStyles.scoreLabel) ─
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: lb(6),
  },
  tableHeaderText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: lb(FontSize.metaSmall),
    color: BrandColors.textTertiary,
    letterSpacing: lb(LetterSpacing.wide),
    textTransform: 'uppercase',
  },
  tableDivider: {
    height: 1,
    backgroundColor: BrandColors.divider,
    marginBottom: lb(4),
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: lb(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BrandColors.divider,
  },
  leaderboardRowFirst: {
    // Subtle golden glow for #1
  },
  leaderboardRowHighlight: {
    backgroundColor: 'rgba(244, 124, 60, 0.06)',
    marginHorizontal: lb(-12),
    paddingHorizontal: lb(12),
    borderRadius: lb(10),
    borderBottomWidth: 0,
  },
  rankContainer: {
    width: lb(28),
    alignItems: 'center',
  },
  rankText: {
    fontFamily: FontFamily.bodyBold,
    fontSize: lb(FontSize.bodySmall),
  },
  avatarContainer: {
    width: lb(36),
    height: lb(36),
    borderRadius: lb(18),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: lb(10),
    overflow: 'hidden',
  },
  avatarImage: {
    width: lb(36),
    height: lb(36),
    borderRadius: lb(18),
  },
  avatarInitial: {
    fontFamily: FontFamily.bodyBold,
    fontSize: lb(FontSize.bodySmall),
    color: '#FFFFFF',
  },
  nameContainer: {
    flex: 1,
    minWidth: 0,
    marginRight: lb(4),
  },
  nameText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: lb(FontSize.bodySmall),
    color: BrandColors.textPrimary,
  },
  nameTextHighlight: {
    fontFamily: FontFamily.bodySemiBold,
    color: BrandColors.accent,
  },
  scoreCell: {
    width: lb(54),
    alignItems: 'center',
  },
  scoreCellValue: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: lb(FontSize.bodySmall),
    color: BrandColors.textPrimary,
  },
  scoreCellValueAccent: {
    color: BrandColors.accent,
  },
  weeksCell: {
    width: lb(44),
    alignItems: 'center',
  },
  weeksCellValue: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: lb(FontSize.bodySmall),
    color: BrandColors.textSecondary,
  },

  // ── Empty / Loading States ────────────────────────────────────────────
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: lb(10),
    paddingVertical: lb(24),
  },
  loadingText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: lb(FontSize.bodySmall),
    color: BrandColors.textTertiary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: lb(24),
    gap: lb(8),
  },
  emptyTitle: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: lb(FontSize.body),
    color: BrandColors.textSecondary,
    marginTop: lb(4),
  },
  emptySubtitle: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: lb(FontSize.bodySmall),
    color: BrandColors.textTertiary,
    textAlign: 'center',
    lineHeight: lb(LineHeight.bodySmall),
    paddingHorizontal: lb(16),
  },
  // ── Compact toolbar (tabs + audience filter) ─────────────────────────
  socialToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 6,
  },
  segmentedRow: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    minWidth: 0,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: 'rgba(244,124,60,0.12)',
  },
  segmentLabel: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textSecondary,
    letterSpacing: 0.2,
  },
  segmentLabelActive: {
    color: BrandColors.accent,
  },

  // ── Audience filter pill + helper caption ────────────────────────────
  audiencePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 36,
    maxWidth: '42%',
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    flexShrink: 0,
  },
  audiencePillPressed: {
    opacity: 0.75,
    borderColor: 'rgba(244,124,60,0.35)',
  },
  audiencePillLabel: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textTertiary,
  },
  audiencePillDot: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textTertiary,
    opacity: 0.6,
  },
  audiencePillValue: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textPrimary,
    flexShrink: 1,
  },
  audiencePillChevron: {
    fontSize: 11,
    color: BrandColors.accent,
    marginTop: 1,
    marginLeft: 2,
  },
  decideRow: {
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 10,
    alignItems: 'center',
  },
  decideText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 11,
    color: BrandColors.textTertiary,
    lineHeight: 15,
    textAlign: 'center',
  },
  decideLink: {
    fontFamily: FontFamily.bodySemiBold,
    color: BrandColors.accent,
    textDecorationLine: 'underline',
  },

  // ── Branded audience picker (bottom sheet, all platforms) ────────────
  audienceSheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: BrandColors.overlayDark,
  },
  audienceSheet: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: BrandColors.cardBorder,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  audienceSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: BrandColors.inputBorder,
    alignSelf: 'center',
    marginBottom: 16,
    opacity: 0.7,
  },
  audienceSheetTitle: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
  },
  audienceSheetSubtitle: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  audienceSheetOptions: {
    gap: 8,
    marginBottom: 12,
  },
  audienceSheetSectionLabel: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 4,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  audienceSheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: BrandColors.backgroundTertiary,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
  },
  audienceSheetOptionPublic: {
    backgroundColor: 'rgba(91, 155, 213, 0.08)',
    borderColor: 'rgba(91, 155, 213, 0.35)',
  },
  audienceSheetOptionPrivate: {
    backgroundColor: 'rgba(111, 122, 126, 0.12)',
    borderColor: 'rgba(111, 122, 126, 0.45)',
  },
  audienceSheetOptionSelected: {
    backgroundColor: 'rgba(244,124,60,0.12)',
    borderColor: 'rgba(244,124,60,0.45)',
  },
  audienceOptionLeading: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audienceOptionLeadingPublic: {
    backgroundColor: 'rgba(91, 155, 213, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(91, 155, 213, 0.5)',
  },
  audienceOptionLeadingPrivate: {
    backgroundColor: 'rgba(111, 122, 126, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(111, 122, 126, 0.55)',
  },
  audienceOptionLeadingCircle: {
    backgroundColor: 'rgba(244,124,60,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(244,124,60,0.4)',
  },
  audienceOptionLeadingText: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.metaSmall,
    color: '#7EB8E8',
    letterSpacing: 0.5,
  },
  audienceOptionLeadingTextPrivate: {
    color: BrandColors.textSecondary,
  },
  audienceOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  audienceSheetOptionLabel: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.body,
    color: BrandColors.textSecondary,
  },
  audienceSheetOptionSubtitle: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    marginTop: 2,
    lineHeight: 16,
  },
  audienceSheetOptionLabelSelected: {
    fontFamily: FontFamily.bodySemiBold,
    color: BrandColors.textPrimary,
  },
  audienceSheetCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: BrandColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audienceSheetCheckMark: {
    fontSize: 13,
    color: '#0B1114',
    fontFamily: FontFamily.bodyBold,
    marginTop: -1,
  },
  audienceSheetCheckPlaceholder: {
    width: 24,
    height: 24,
  },
  audienceSheetDismiss: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  audienceSheetDismissText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textSecondary,
  },
});
