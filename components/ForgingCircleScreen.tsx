import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Clipboard,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize, TextStyles } from '../constants/Typography';
import { CircleImagePicker } from './CircleImagePicker';
import {
  acceptInvite,
  cancelInvite,
  CircleInvite,
  CircleMember,
  createCircle,
  declineInvite,
  deleteCircle,
  ForgingCircle,
  getCircleById,
  listCircleMembers,
  listIncomingInvites,
  listJoinedCircles,
  listMyCircles,
  listOutgoingInvites,
  removeCircleMember,
  sendCircleInvite,
  SendInviteResult,
  updateCircleImage,
} from '../lib/forging-circle';
import { supabase, updateUserProfile } from '../lib/supabase_db_new';

const MAX_VISIBLE_CIRCLES = 3;

interface ForgingCircleScreenProps {
  userId: string;
  currentUserEmail: string | null;
  currentUserDisplayName?: string | null;
  currentUserAvatarUrl?: string | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** App Store link copied when inviting someone who is not on UnderForge yet. */
const UNDERFORGE_INVITE_LINK = 'https://apps.apple.com/de/app/underforge/id6758098630\nUnderForge';

function Avatar({ uri, name, size = 36 }: { uri: string | null; name: string; size?: number }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (uri) {
    return <Image source={{ uri }} style={[styles.avatarBase, { width: size, height: size, borderRadius: size / 2 }]} />;
  }
  return (
    <View style={[styles.avatarBase, styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.avatarFallbackText}>{initial}</Text>
    </View>
  );
}

type ScreenMode =
  | { kind: 'list' }
  | { kind: 'all' }
  | { kind: 'detail'; circle: ForgingCircle; returnTo: 'list' | 'all' };

function CircleRowThumbnail({
  circle,
  size = 40,
}: {
  circle: ForgingCircle;
  size?: number;
}) {
  const initial = (circle.name || '?').trim().charAt(0).toUpperCase();
  if (circle.imageUrl) {
    return (
      <Image
        source={{ uri: circle.imageUrl }}
        style={[styles.circleRowAvatar, { width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }
  return (
    <View style={[styles.circleRowAvatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.circleRowAvatarText}>{initial}</Text>
    </View>
  );
}

/**
 * Forging Circles management surface. Two screens:
 *
 *  - **List view** (default): the user's default audience setting (Public vs
 *    My Circles) at the top, a "Create circle" composer, the list of owned
 *    circles, and any pending incoming invites (across all circles).
 *  - **Detail view**: per-circle invite composer, outgoing invites for that
 *    circle, and the participant list (owner pinned at top + members).
 *
 * Invites are scoped to a specific circle, so the user must create a circle
 * before they can invite anyone.
 */
export const ForgingCircleScreen: React.FC<ForgingCircleScreenProps> = ({
  userId,
  currentUserEmail,
  currentUserDisplayName,
  currentUserAvatarUrl,
}) => {
  const { t } = useTranslation(['social', 'common']);
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<ScreenMode>({ kind: 'list' });

  // List-view state
  const [loading, setLoading] = useState(true);
  const [ownedCircles, setOwnedCircles] = useState<ForgingCircle[]>([]);
  const [joinedCircles, setJoinedCircles] = useState<ForgingCircle[]>([]);
  const [incoming, setIncoming] = useState<CircleInvite[]>([]);
  const [newCircleName, setNewCircleName] = useState('');
  const [creating, setCreating] = useState(false);

  // Detail-view state
  const [detailLoading, setDetailLoading] = useState(false);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [outgoing, setOutgoing] = useState<CircleInvite[]>([]);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  /**
   * Single "default audience" preference applied to both new posts and the
   * leaderboard. 'circles' is the safe default; 'public' opens the user up to
   * the wider community.
   */
  const [defaultAudience, setDefaultAudience] = useState<'public' | 'circles'>('circles');
  const [savingAudience, setSavingAudience] = useState(false);

  // ── List view loaders ──────────────────────────────────────────────────

  const refreshList = useCallback(async () => {
    const [owned, joined, inc] = await Promise.all([
      listMyCircles(userId),
      listJoinedCircles(userId),
      listIncomingInvites(userId),
    ]);
    setOwnedCircles(owned);
    setJoinedCircles(joined);
    setIncoming(inc);

    // Hydrate the current default audience from Supabase. We use a direct
    // query (rather than getUserProfile) so the screen doesn't depend on the
    // larger profile mapping pipeline.
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('user_profile')
          .select('default_share_audience')
          .eq('user_id', userId)
          .single();
        if (!error && data?.default_share_audience === 'public') {
          setDefaultAudience('public');
        } else {
          setDefaultAudience('circles');
        }
      } catch {
        // Non-fatal; keep the 'circles' default.
      }
    }

    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // ── Detail view loaders ───────────────────────────────────────────────

  const refreshDetail = useCallback(async (circle: ForgingCircle) => {
    setDetailLoading(true);
    const mems = await listCircleMembers(circle.id);
    setMembers(mems);
    if (circle.isOwner) {
      const out = await listOutgoingInvites(userId, circle.id);
      setOutgoing(out);
    } else {
      setOutgoing([]);
    }
    setDetailLoading(false);
  }, [userId]);

  useEffect(() => {
    if (mode.kind === 'detail') {
      refreshDetail(mode.circle);
    }
  }, [mode, refreshDetail]);

  // Live refresh when a new invite row lands for this user.
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`forging-circle-invites-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'forging_circle_invites',
          filter: `invitee_user_id=eq.${userId}`,
        },
        () => {
          void refreshList();
          if (mode.kind === 'detail') void refreshDetail(mode.circle);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, refreshList, refreshDetail, mode]);

  // ── Live refresh: whenever the app comes back to the foreground we
  // ── re-sync from the server so changes made on another device or by
  // ── another participant (e.g. someone removed me, someone accepted my
  // ── invite) land "immediately" the next time the user looks at the
  // ── screen, without needing pull-to-refresh.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev !== 'active' && next === 'active') {
        refreshList();
        if (mode.kind === 'detail') refreshDetail(mode.circle);
      }
    });
    return () => sub.remove();
  }, [refreshList, refreshDetail, mode]);

  // ── Default audience ──────────────────────────────────────────────────

  const handleAudienceChange = async (next: 'public' | 'circles') => {
    if (next === defaultAudience || savingAudience) return;
    setDefaultAudience(next);
    setSavingAudience(true);
    try {
      await updateUserProfile({ user_id: userId, default_share_audience: next });
    } catch {
      // Revert on failure.
      setDefaultAudience(prev => (prev === 'public' ? 'circles' : 'public'));
    } finally {
      setSavingAudience(false);
    }
  };

  // ── Circle CRUD ────────────────────────────────────────────────────────

  const handleCreateCircle = async () => {
    const cleaned = newCircleName.trim();
    // Empty submit is ignored (no alert): on iOS, onSubmitEditing can fire when
    // focusing/blurring inside a keyboard-adjusted bottom sheet; alerting here
    // blocks typing. The Create button stays disabled until there is text.
    if (!cleaned) return;
    setCreating(true);
    try {
      const result = await createCircle(userId, cleaned);
      if (!result.ok) {
        if (result.reason === 'duplicate_name') {
          Alert.alert(t('social:circleCreateDuplicateTitle'), t('social:circleCreateDuplicateBody'));
        } else if (result.reason === 'invalid_name') {
          Alert.alert(t('social:circleCreateInvalidTitle'), t('social:circleCreateInvalidBody'));
        } else {
          Alert.alert(t('social:circleCreateFailedTitle'), t('social:circleCreateFailedBody'));
        }
        return;
      }
      setNewCircleName('');
      await refreshList();
      // Jump straight into the new circle so the user can invite right away.
      if (result.circle) {
        setMode({ kind: 'detail', circle: result.circle, returnTo: 'list' });
      }
    } finally {
      setCreating(false);
    }
  };

  const allCircles = useMemo(
    () => [...ownedCircles, ...joinedCircles],
    [ownedCircles, joinedCircles],
  );

  const applyCircleImageUrl = useCallback((circleId: number, imageUrl: string) => {
    const patch = (c: ForgingCircle) => (c.id === circleId ? { ...c, imageUrl } : c);
    setOwnedCircles(prev => prev.map(patch));
    setJoinedCircles(prev => prev.map(patch));
    setMode(prev =>
      prev.kind === 'detail' && prev.circle.id === circleId
        ? { ...prev, circle: { ...prev.circle, imageUrl } }
        : prev,
    );
  }, []);

  const handleCircleImageChange = async (circle: ForgingCircle, imageUrl: string) => {
    const ok = await updateCircleImage(circle.id, imageUrl);
    if (!ok) {
      Alert.alert(t('common:error'), t('social:circleImageUploadError'));
      return;
    }
    applyCircleImageUrl(circle.id, imageUrl);
  };

  const openCircleDetail = (circle: ForgingCircle, returnTo: 'list' | 'all') => {
    setMode({ kind: 'detail', circle, returnTo });
  };

  const handleDeleteCircle = (circle: ForgingCircle) => {
    Alert.alert(
      t('social:circleDeleteTitle'),
      t('social:circleDeleteBody', { name: circle.name }),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('social:circleDelete'),
          style: 'destructive',
          onPress: async () => {
            const ok = await deleteCircle(circle.id);
            if (ok) {
              setMode({ kind: 'list' });
              await refreshList();
            }
          },
        },
      ],
    );
  };

  // ── Invites ───────────────────────────────────────────────────────────

  const handleSendInvite = async () => {
    if (mode.kind !== 'detail') return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    if (!EMAIL_REGEX.test(trimmed)) {
      Alert.alert(t('social:circleInviteInvalidEmailTitle'), t('social:circleInviteInvalidEmailBody'));
      return;
    }
    if (currentUserEmail && trimmed === currentUserEmail.trim().toLowerCase()) {
      Alert.alert(t('social:circleInviteSelfTitle'), t('social:circleInviteSelfBody'));
      return;
    }

    setSending(true);
    try {
      const result: SendInviteResult = await sendCircleInvite(userId, mode.circle.id, trimmed);
      if (result.ok) {
        setEmail('');
        Alert.alert(t('social:circleInviteSentTitle'), t('social:circleInviteSentBody'));
        await refreshDetail(mode.circle);
        await refreshList();
        return;
      }
      if (result.reason === 'unknown_email') {
        Alert.alert(
          t('social:circleInviteFailedTitle'),
          t('social:circleInviteUnknownEmailBody'),
          [
            {
              text: t('social:circleInviteCopyLink'),
              onPress: () => Clipboard.setString(UNDERFORGE_INVITE_LINK),
            },
            { text: t('common:ok'), style: 'cancel' },
          ],
        );
        return;
      }
      const reasonKey =
        result.reason === 'self_invite'
          ? 'social:circleInviteSelfBody'
          : result.reason === 'already_member'
            ? 'social:circleInviteAlreadyMemberBody'
            : result.reason === 'already_pending'
              ? 'social:circleInviteAlreadyPendingBody'
              : result.reason === 'not_owner'
                ? 'social:circleInviteNotOwnerBody'
                : 'social:circleInviteGenericErrorBody';
      Alert.alert(t('social:circleInviteFailedTitle'), t(reasonKey));
    } finally {
      setSending(false);
    }
  };

  const handleAccept = async (invite: CircleInvite) => {
    const ok = await acceptInvite(invite.id);
    if (!ok) {
      Alert.alert(t('common:error'), t('social:circleInviteGenericErrorBody'));
      return;
    }
    await refreshList();
    const circle = await getCircleById(invite.circleId, userId);
    if (circle) {
      setMode({ kind: 'detail', circle, returnTo: 'list' });
    }
  };

  const handleDecline = async (invite: CircleInvite) => {
    const ok = await declineInvite(invite.id);
    if (!ok) return;
    await refreshList();
  };

  const handleCancel = async (invite: CircleInvite) => {
    const ok = await cancelInvite(invite.id);
    if (!ok) return;
    if (mode.kind === 'detail') await refreshDetail(mode.circle);
  };

  const handleRemoveMember = (member: CircleMember) => {
    if (mode.kind !== 'detail') return;
    const circleId = mode.circle.id;
    Alert.alert(
      t('social:circleRemoveConfirmTitle'),
      t('social:circleRemoveConfirmBody', { name: member.displayName }),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('social:circleRemove'),
          style: 'destructive',
          onPress: async () => {
            const ok = await removeCircleMember(circleId, member.userId, userId);
            if (ok && mode.kind === 'detail') {
              await refreshDetail(mode.circle);
              await refreshList();
            }
          },
        },
      ],
    );
  };

  // ── Rendering ─────────────────────────────────────────────────────────

  const isSendDisabled = useMemo(
    () => sending || !EMAIL_REGEX.test(email.trim().toLowerCase()),
    [sending, email],
  );

  const visibleCircles = useMemo(
    () => allCircles.slice(0, MAX_VISIBLE_CIRCLES),
    [allCircles],
  );

  const hasMoreCircles = allCircles.length > MAX_VISIBLE_CIRCLES;

  const circleRowMeta = useCallback(
    (circle: ForgingCircle) => {
      const membersLabel = t('social:circleParticipantsLabel', { count: circle.participantCount });
      if (circle.isOwner) return membersLabel;
      const hostName = circle.ownerDisplayName || t('social:circleOwnerFallback');
      return `${membersLabel} ${t('social:circleJoinedHostedByParen', { name: hostName })}`;
    },
    [t],
  );

  const renderCircleRow = (c: ForgingCircle) => (
    <Pressable
      key={c.isOwner ? `owned-${c.id}` : `joined-${c.id}`}
      onPress={() => openCircleDetail(c, mode.kind === 'all' ? 'all' : 'list')}
      style={({ pressed }) => [
        styles.circleRow,
        pressed && styles.circleRowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={c.name}
    >
      <CircleRowThumbnail circle={c} />
      <View style={styles.rowText}>
        <Text style={styles.rowName}>{c.name}</Text>
        <Text style={styles.rowMeta}>{circleRowMeta(c)}</Text>
      </View>
      <Text style={styles.circleRowChevron}>{'\u203A'}</Text>
    </Pressable>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={BrandColors.accent} />
      </View>
    );
  }

  if (mode.kind === 'detail') {
    const isOwner = mode.circle.isOwner;
    return (
      <DetailView
        circle={mode.circle}
        isOwner={isOwner}
        members={members}
        outgoing={outgoing}
        email={email}
        sending={sending}
        detailLoading={detailLoading}
        isSendDisabled={isSendDisabled}
        onBack={() => setMode({ kind: mode.returnTo })}
        onEmailChange={setEmail}
        onSend={handleSendInvite}
        onCancelInvite={handleCancel}
        onRemoveMember={handleRemoveMember}
        onDelete={() => handleDeleteCircle(mode.circle)}
        currentUserDisplayName={currentUserDisplayName}
        currentUserAvatarUrl={currentUserAvatarUrl}
        onCircleImageChange={(url) => handleCircleImageChange(mode.circle, url)}
      />
    );
  }

  if (mode.kind === 'all') {
    return (
      <View style={styles.container}>
        <View style={styles.detailHeader}>
          <TouchableOpacity
            onPress={() => setMode({ kind: 'list' })}
            style={styles.detailBackButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('common:back')}
          >
            <Text style={styles.detailBackText}>{`\u2039 ${t('social:circleDetailBack')}`}</Text>
          </TouchableOpacity>
          <Text style={styles.detailTitle}>{t('social:circleSeeAllTitle')}</Text>
          <View style={styles.detailDeleteButton} />
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            {allCircles.length === 0 ? (
              <Text style={styles.empty}>{t('social:circleListEmpty')}</Text>
            ) : (
              allCircles.map(renderCircleRow)
            )}
          </View>
          <View style={{ height: 32 }} />
        </ScrollView>
      </View>
    );
  }

  const canCreateCircle = newCircleName.trim().length > 0 && !creating;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.intro}>{t('social:circlesIntro')}</Text>

        {/* Create circle composer — the very first action a new user takes. */}
        <View style={styles.inviteCard}>
          <Text style={styles.inviteLabel}>{t('social:circleCreateTitle')}</Text>
          <View style={styles.inviteRow}>
            <TextInput
              style={styles.input}
              value={newCircleName}
              onChangeText={setNewCircleName}
              placeholder={t('social:circleCreatePlaceholder')}
              placeholderTextColor={BrandColors.textTertiary}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={40}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={() => {
                if (canCreateCircle) void handleCreateCircle();
              }}
            />
            <TouchableOpacity
              style={[styles.sendButton, !canCreateCircle && styles.sendButtonDisabled]}
              onPress={() => void handleCreateCircle()}
              disabled={!canCreateCircle}
              pointerEvents={canCreateCircle ? 'auto' : 'none'}
              activeOpacity={0.8}
            >
              {creating ? (
                <ActivityIndicator color="#0B1114" size="small" />
              ) : (
                <Text style={styles.sendButtonText}>{t('social:circleCreateCta')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Owned circles list, immediately under the composer so the page
            reads top-down as: intro -> create -> what I have -> invites
            -> default audience setting. */}
        <View style={[styles.section, styles.circlesListSection]}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, styles.sectionTitleInRow]}>
              {t('social:circleListSectionTitle')}
            </Text>
            {hasMoreCircles ? (
              <TouchableOpacity
                style={styles.seeAllButton}
                onPress={() => setMode({ kind: 'all' })}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('social:circleSeeAll')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.seeAllButtonText}>{t('social:circleSeeAll')}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.seeAllButtonPlaceholder} />
            )}
          </View>
          {visibleCircles.length === 0 ? (
            <Text style={styles.empty}>{t('social:circleListEmpty')}</Text>
          ) : (
            visibleCircles.map(renderCircleRow)
          )}
        </View>

        {incoming.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('social:circlePendingIncoming')}</Text>
            {incoming.map((invite) => (
              <View key={invite.id} style={styles.row}>
                <Avatar uri={invite.inviterAvatarUrl} name={invite.inviterDisplayName} />
                <View style={styles.rowText}>
                  <View style={styles.rowNameLine}>
                    <Text style={styles.rowName}>{invite.inviterDisplayName}</Text>
                    {invite.inviterIsCoach ? (
                      <View style={styles.coachBadge}>
                        <Text style={styles.coachBadgeText}>{t('social:circleInviterCoachBadge')}</Text>
                      </View>
                    ) : null}
                  </View>
                  {invite.circleName ? (
                    <Text style={styles.rowMeta}>
                      {t('social:circleIncomingToCircle', { circle: invite.circleName })}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.rowActions}>
                  <TouchableOpacity onPress={() => handleAccept(invite)} style={styles.acceptButton}>
                    <Text style={styles.acceptButtonText}>{t('social:circleAccept')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDecline(invite)} style={styles.declineButton}>
                    <Text style={styles.declineButtonText}>{t('social:circleDecline')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Default audience for stats + posts — moved to the bottom so the
            page leads with circle management. This control is global (not
            per-circle) so it sits below the circle list as a settings-style
            footer card. */}
        <View style={[styles.audienceCard, styles.audienceCardFooter]}>
          <View style={styles.audienceTitleRow}>
            <Text style={styles.audienceTitle}>{t('social:defaultAudienceTitle')}</Text>
            <TouchableOpacity
              onPress={() =>
                Alert.alert(t('social:defaultAudienceTitle'), t('social:defaultAudienceHint'))
              }
              style={styles.audienceInfoButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('social:defaultAudienceInfoA11y')}
            >
              <Text style={styles.audienceInfoIcon}>{'\u24D8'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.audienceSegmented}>
            <TouchableOpacity
              style={[
                styles.audienceSegment,
                defaultAudience === 'public' && styles.audienceSegmentActive,
              ]}
              onPress={() => handleAudienceChange('public')}
              disabled={savingAudience}
              activeOpacity={0.85}
            >
              <Text style={[
                styles.audienceSegmentLabel,
                defaultAudience === 'public' && styles.audienceSegmentLabelActive,
              ]}>
                {t('social:defaultAudiencePublic')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.audienceSegment,
                defaultAudience === 'circles' && styles.audienceSegmentActive,
              ]}
              onPress={() => handleAudienceChange('circles')}
              disabled={savingAudience}
              activeOpacity={0.85}
            >
              <Text style={[
                styles.audienceSegmentLabel,
                defaultAudience === 'circles' && styles.audienceSegmentLabelActive,
              ]}>
                {t('social:defaultAudienceCircle')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
};

// ─── Detail subview ─────────────────────────────────────────────────────────

interface DetailViewProps {
  circle: ForgingCircle;
  isOwner: boolean;
  members: CircleMember[];
  outgoing: CircleInvite[];
  email: string;
  sending: boolean;
  detailLoading: boolean;
  isSendDisabled: boolean;
  onBack: () => void;
  onEmailChange: (v: string) => void;
  onSend: () => void;
  onCancelInvite: (invite: CircleInvite) => void;
  onRemoveMember: (member: CircleMember) => void;
  onDelete: () => void;
  currentUserDisplayName?: string | null;
  currentUserAvatarUrl?: string | null;
  onCircleImageChange: (url: string) => Promise<void>;
}

const DetailView: React.FC<DetailViewProps> = ({
  circle,
  isOwner,
  members,
  outgoing,
  email,
  sending,
  detailLoading,
  isSendDisabled,
  onBack,
  onEmailChange,
  onSend,
  onCancelInvite,
  onRemoveMember,
  onDelete,
  currentUserDisplayName,
  currentUserAvatarUrl,
  onCircleImageChange,
}) => {
  const { t } = useTranslation(['social', 'common']);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={styles.detailHeader}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.detailBackButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('common:back')}
        >
          <Text style={styles.detailBackText}>{`\u2039 ${t('social:circleDetailBack')}`}</Text>
        </TouchableOpacity>
        <Text style={styles.detailTitle} numberOfLines={1}>{circle.name}</Text>
        {isOwner ? (
          <TouchableOpacity
            onPress={onDelete}
            style={styles.detailDeleteButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('social:circleDelete')}
          >
            <Text style={styles.detailDeleteText}>{t('social:circleDelete')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.detailDeleteButton} />
        )}
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {isOwner ? (
          <>
            <CircleImagePicker
              uri={circle.imageUrl}
              ownerUserId={circle.ownerUserId}
              circleId={circle.id}
              circleName={circle.name}
              onChange={onCircleImageChange}
            />
            <View style={styles.inviteCard}>
              <Text style={styles.inviteLabel}>{t('social:circleInviteByEmail')}</Text>
              <View style={styles.inviteRow}>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={onEmailChange}
                  placeholder={t('social:circleInviteEmailPlaceholder')}
                  placeholderTextColor={BrandColors.textTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="send"
                  onSubmitEditing={onSend}
                />
                <TouchableOpacity
                  style={[styles.sendButton, isSendDisabled && styles.sendButtonDisabled]}
                  onPress={onSend}
                  disabled={isSendDisabled}
                  activeOpacity={0.8}
                >
                  {sending ? (
                    <ActivityIndicator color="#0B1114" size="small" />
                  ) : (
                    <Text style={styles.sendButtonText}>{t('social:circleInviteSend')}</Text>
                  )}
                </TouchableOpacity>
              </View>
              <Text style={styles.inviteHint}>{t('social:circleInviteEmailHint')}</Text>
            </View>

            {outgoing.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('social:circlePendingOutgoing')}</Text>
                {outgoing.map((invite) => (
                  <View key={invite.id} style={styles.row}>
                    <Avatar uri={invite.inviteeAvatarUrl} name={invite.inviteeDisplayName ?? invite.inviteeEmail} />
                    <View style={styles.rowText}>
                      <Text style={styles.rowName}>{invite.inviteeDisplayName ?? invite.inviteeEmail}</Text>
                      <Text style={styles.rowMeta}>{t('social:circleOutgoingPendingHint')}</Text>
                    </View>
                    <TouchableOpacity onPress={() => onCancelInvite(invite)} style={styles.declineButton}>
                      <Text style={styles.declineButtonText}>{t('social:circleCancelInvite')}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </>
        ) : (
          circle.imageUrl ? (
            <View style={styles.circlePhotoReadOnly}>
              <Image source={{ uri: circle.imageUrl }} style={styles.circlePhotoReadOnlyImage} />
            </View>
          ) : null
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('social:circleMembersTitle')}</Text>

          {/* Owner row pinned at top — implicit participant of every circle. */}
          <View style={styles.row}>
            <Avatar
              uri={isOwner ? (currentUserAvatarUrl ?? null) : null}
              name={
                isOwner
                  ? (currentUserDisplayName || t('common:you', { defaultValue: 'You' }))
                  : (circle.ownerDisplayName || t('social:circleOwnerFallback'))
              }
            />
            <View style={styles.rowText}>
              <Text style={styles.rowName}>
                {isOwner
                  ? t('common:you', { defaultValue: 'You' })
                  : (circle.ownerDisplayName || t('social:circleOwnerFallback'))}
                <Text style={styles.rowMetaInline}>{t('social:circleOwnerSuffix')}</Text>
              </Text>
            </View>
          </View>

          {detailLoading ? (
            <View style={{ paddingVertical: 12 }}>
              <ActivityIndicator color={BrandColors.accent} />
            </View>
          ) : members.length === 0 ? (
            <Text style={styles.empty}>{t('social:circleEmpty')}</Text>
          ) : (
            members.map((m) => (
              <View key={m.membershipId} style={styles.row}>
                <Avatar uri={m.avatarUrl} name={m.displayName} />
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{m.displayName}</Text>
                </View>
                {isOwner ? (
                  <TouchableOpacity onPress={() => onRemoveMember(m)} style={styles.declineButton}>
                    <Text style={styles.declineButtonText}>{t('social:circleRemove')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  intro: {
    ...TextStyles.body,
    color: BrandColors.textSecondary,
    paddingHorizontal: 4,
    marginBottom: 16,
  },
  audienceCard: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  audienceCardFooter: {
    marginTop: 4,
  },
  audienceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  audienceTitle: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textPrimary,
    flex: 1,
  },
  audienceInfoButton: {
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -8,
  },
  audienceInfoIcon: {
    fontSize: 18,
    color: BrandColors.textTertiary,
    lineHeight: 20,
  },
  audienceSegmented: {
    flexDirection: 'row',
    gap: 3,
    backgroundColor: BrandColors.backgroundTertiary,
    borderRadius: 8,
    padding: 3,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
  },
  audienceSegment: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    paddingVertical: 7,
  },
  audienceSegmentActive: {
    backgroundColor: 'rgba(244,124,60,0.18)',
  },
  audienceSegmentLabel: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textSecondary,
  },
  audienceSegmentLabelActive: {
    color: BrandColors.accent,
  },
  inviteCard: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  inviteLabel: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textSecondary,
    marginBottom: 8,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  inviteRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  inviteHint: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    marginTop: 8,
    lineHeight: 18,
  },
  input: {
    flex: 1,
    backgroundColor: BrandColors.inputBackground,
    borderWidth: 1,
    borderColor: BrandColors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    color: BrandColors.textPrimary,
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.body,
  },
  sendButton: {
    backgroundColor: BrandColors.accent,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#3A484C',
  },
  sendButtonText: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.bodySmall,
    color: '#0B1114',
    letterSpacing: 0.3,
  },
  section: {
    marginTop: 10,
    marginBottom: 6,
  },
  circlesListSection: {
    marginTop: 4,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  sectionTitle: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.meta,
    color: BrandColors.textTertiary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  sectionTitleInRow: {
    flex: 1,
    marginBottom: 0,
  },
  empty: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textTertiary,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomColor: BrandColors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  rowName: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  coachBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.accent,
  },
  coachBadgeText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.metaSmall,
    color: BrandColors.accent,
  },
  rowMeta: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    marginTop: 2,
  },
  rowMetaInline: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textTertiary,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 6,
  },
  acceptButton: {
    backgroundColor: BrandColors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  acceptButtonText: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.metaSmall,
    color: '#0B1114',
    letterSpacing: 0.3,
  },
  declineButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BrandColors.inputBorder,
  },
  declineButtonText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textSecondary,
    letterSpacing: 0.3,
  },
  avatarBase: {
    overflow: 'hidden',
  },
  avatarFallback: {
    backgroundColor: '#1E2A2C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontFamily: FontFamily.bodyBold,
    color: BrandColors.textPrimary,
    fontSize: FontSize.bodySmall,
  },
  // ── Circle list row ──
  circleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomColor: BrandColors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  circleRowPressed: {
    opacity: 0.7,
  },
  circleRowAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(244,124,60,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(244,124,60,0.4)',
    overflow: 'hidden',
  },
  circleRowAvatarText: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.body,
    color: BrandColors.accent,
  },
  circleRowChevron: {
    fontSize: 22,
    color: BrandColors.textTertiary,
    paddingHorizontal: 4,
  },
  seeAllButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 4,
    paddingLeft: 8,
  },
  seeAllButtonPlaceholder: {
    width: 1,
  },
  seeAllButtonText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: Math.round(FontSize.metaSmall * 1.3),
    color: BrandColors.accent,
    letterSpacing: 0.2,
  },
  circlePhotoReadOnly: {
    alignItems: 'center',
    marginBottom: 12,
  },
  circlePhotoReadOnlyImage: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: 'rgba(244,124,60,0.45)',
  },
  // ── Detail header ──
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  detailBackButton: {
    minHeight: 44,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  detailBackText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.accent,
  },
  detailTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  detailDeleteButton: {
    minHeight: 44,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  detailDeleteText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textTertiary,
  },
});
