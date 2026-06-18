import { sendCircleInvitePushNotification } from './circle-invite-push';
import { glowLogger } from './glow-logger';
import { supabase } from './supabase_db_new';

export type CircleInviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

/**
 * A Forging Circle is a named group owned by a user. Participants =
 * `ownerUserId` ∪ members in `forging_circle_members` for this circle.
 */
export interface ForgingCircle {
  id: number;
  ownerUserId: string;
  name: string;
  createdAt: string;
  /** Public URL for the circle cover photo, if set by the owner. */
  imageUrl?: string | null;
  /** Owner + invited members count. Owner is always counted. */
  participantCount: number;
  /** True when the viewer created/owns this circle; false when they joined via invite. */
  isOwner: boolean;
  /** Populated for joined circles — the circle creator's display name. */
  ownerDisplayName?: string | null;
}

type CircleRow = {
  id: number;
  owner_user_id: string;
  name: string;
  created_at: string;
  image_url?: string | null;
};

export interface CircleInvite {
  id: number;
  circleId: number;
  circleName: string | null;
  /** Null for coach-sent invites (the inviter is a coach, see inviterCoachId). */
  inviterUserId: string | null;
  /** Set when the invite came from a coach (dashboard, coach-owned circle). */
  inviterCoachId: number | null;
  /** True when a coach sent this invite — render it as "Coach X invited you". */
  inviterIsCoach: boolean;
  inviterDisplayName: string;
  inviterAvatarUrl: string | null;
  inviteeUserId: string | null;
  inviteeDisplayName: string | null;
  inviteeAvatarUrl: string | null;
  inviteeEmail: string;
  status: CircleInviteStatus;
  createdAt: string;
  respondedAt: string | null;
}

export interface CircleMember {
  /** Membership row id; useful for keying the UI list. */
  membershipId: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface ProfileLookup {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

/**
 * Look up a UserProfile by email (case-insensitive). Returns null if no user
 * with that email exists in this UnderForge instance. v1 blocks invites to
 * unknown emails by checking this client-side.
 */
export const findUserByEmail = async (email: string): Promise<ProfileLookup | null> => {
  if (!supabase) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  try {
    const { data, error } = await supabase
      .from('user_profile')
      .select('user_id, display_name, avatar_url, email')
      .ilike('email', normalized)
      .limit(1)
      .maybeSingle();
    if (error) {
      glowLogger.error('findUserByEmail failed', { error: error.message });
      return null;
    }
    if (!data) return null;
    return {
      userId: data.user_id,
      displayName: data.display_name ?? null,
      avatarUrl: data.avatar_url ?? null,
      email: data.email ?? null,
    };
  } catch (error) {
    glowLogger.error('findUserByEmail threw', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
};

// ─── Circle CRUD ────────────────────────────────────────────────────────────

export interface CreateCircleResult {
  ok: boolean;
  circle?: ForgingCircle;
  reason?: 'no_client' | 'invalid_name' | 'duplicate_name' | 'unknown_error';
}

const MAX_CIRCLE_NAME_LEN = 40;

function normalizeCircleName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_CIRCLE_NAME_LEN);
}

export const createCircle = async (
  ownerUserId: string,
  name: string,
): Promise<CreateCircleResult> => {
  if (!supabase) return { ok: false, reason: 'no_client' };
  const cleaned = normalizeCircleName(name);
  if (!cleaned) return { ok: false, reason: 'invalid_name' };

  try {
    const { data, error } = await supabase
      .from('forging_circles')
      .insert({ owner_user_id: ownerUserId, name: cleaned })
      .select('id, owner_user_id, name, created_at')
      .single();
    if (error) {
      // Postgres unique_violation has code 23505; surface a friendly hint.
      if ((error as any).code === '23505' || /duplicate/i.test(error.message || '')) {
        return { ok: false, reason: 'duplicate_name' };
      }
      glowLogger.error('createCircle failed', { error: error.message });
      return { ok: false, reason: 'unknown_error' };
    }
    return {
      ok: true,
      circle: {
        id: data.id,
        ownerUserId: data.owner_user_id,
        name: data.name,
        createdAt: data.created_at,
        imageUrl: null,
        participantCount: 1,
        isOwner: true,
      },
    };
  } catch (error) {
    glowLogger.error('createCircle threw', { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, reason: 'unknown_error' };
  }
};

export const renameCircle = async (circleId: number, newName: string): Promise<boolean> => {
  if (!supabase) return false;
  const cleaned = normalizeCircleName(newName);
  if (!cleaned) return false;
  try {
    const { error } = await supabase
      .from('forging_circles')
      .update({ name: cleaned, updated_at: new Date().toISOString() })
      .eq('id', circleId);
    if (error) {
      glowLogger.error('renameCircle failed', { error: error.message });
      return false;
    }
    return true;
  } catch (error) {
    glowLogger.error('renameCircle threw', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
};

export const deleteCircle = async (circleId: number): Promise<boolean> => {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('forging_circles').delete().eq('id', circleId);
    if (error) {
      glowLogger.error('deleteCircle failed', { error: error.message });
      return false;
    }
    return true;
  } catch (error) {
    glowLogger.error('deleteCircle threw', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
};

export const updateCircleImage = async (circleId: number, imageUrl: string): Promise<boolean> => {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('forging_circles')
      .update({ image_url: imageUrl, updated_at: new Date().toISOString() })
      .eq('id', circleId);
    if (error) {
      glowLogger.error('updateCircleImage failed', { error: error.message });
      return false;
    }
    return true;
  } catch (error) {
    glowLogger.error('updateCircleImage threw', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
};

/** Attach member counts to circle rows returned from Supabase. */
async function withParticipantCounts(
  rows: CircleRow[],
  isOwner: boolean,
  ownerNames?: Map<number, string | null>,
): Promise<ForgingCircle[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(c => c.id);
  const { data: memberRows } = await supabase!
    .from('forging_circle_members')
    .select('circle_id')
    .in('circle_id', ids);
  const counts = new Map<number, number>();
  (memberRows || []).forEach((r: { circle_id: number }) => {
    counts.set(r.circle_id, (counts.get(r.circle_id) || 0) + 1);
  });
  return rows.map(c => ({
    id: c.id,
    ownerUserId: c.owner_user_id,
    name: c.name,
    createdAt: c.created_at,
    imageUrl: c.image_url ?? null,
    participantCount: 1 + (counts.get(c.id) || 0),
    isOwner,
    ownerDisplayName: ownerNames?.get(c.id) ?? null,
  }));
}

/**
 * List circles owned by the given user, each with a `participantCount` that
 * includes the owner. Used by the menu list and Social filter (owned half).
 */
export const listMyCircles = async (ownerUserId: string): Promise<ForgingCircle[]> => {
  if (!supabase) return [];
  try {
    const { data: circles, error } = await supabase
      .from('forging_circles')
      .select('id, owner_user_id, name, created_at, image_url')
      .eq('owner_user_id', ownerUserId)
      .order('created_at', { ascending: true });
    if (error) {
      glowLogger.error('listMyCircles failed', { error: error.message });
      return [];
    }
    const rows = circles || [];
    return withParticipantCounts(rows, true);
  } catch (error) {
    glowLogger.error('listMyCircles threw', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
};

/**
 * Circles the user joined via invite (member but not owner). These do not
 * appear in {@link listMyCircles} — that is why accept looked successful but
 * the circle was missing from "Your circles".
 */
export const listJoinedCircles = async (memberUserId: string): Promise<ForgingCircle[]> => {
  if (!supabase) return [];
  try {
    const { data: memberships, error: mErr } = await supabase
      .from('forging_circle_members')
      .select(`
        circle_id,
        circle:forging_circles (
          id, owner_user_id, name, created_at, image_url,
          owner:user_profile!forging_circles_owner_user_id_fkey ( display_name )
        )
      `)
      .eq('member_user_id', memberUserId);
    if (mErr) {
      glowLogger.error('listJoinedCircles failed', { error: mErr.message });
      return [];
    }
    const ownerNames = new Map<number, string | null>();
    const rows: CircleRow[] = [];
    for (const row of memberships || []) {
      const c = (row as any).circle;
      if (!c?.id || c.owner_user_id === memberUserId) continue;
      rows.push({
        id: c.id,
        owner_user_id: c.owner_user_id,
        name: c.name,
        created_at: c.created_at,
        image_url: c.image_url ?? null,
      });
      ownerNames.set(c.id, c.owner?.display_name ?? null);
    }
    return withParticipantCounts(rows, false, ownerNames);
  } catch (error) {
    glowLogger.error('listJoinedCircles threw', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
};

/** Owned + joined circles (for Social tab audience filter). */
export const listAccessibleCircles = async (userId: string): Promise<ForgingCircle[]> => {
  const [owned, joined] = await Promise.all([
    listMyCircles(userId),
    listJoinedCircles(userId),
  ]);
  return [...owned, ...joined];
};

/** Load a single circle by id (for navigation after accepting an invite). */
export const getCircleById = async (
  circleId: number,
  viewerUserId: string,
): Promise<ForgingCircle | null> => {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('forging_circles')
      .select(`
        id, owner_user_id, name, created_at, image_url,
        owner:user_profile!forging_circles_owner_user_id_fkey ( display_name )
      `)
      .eq('id', circleId)
      .maybeSingle();
    if (error || !data) {
      if (error) glowLogger.error('getCircleById failed', { error: error.message });
      return null;
    }
    const isOwner = data.owner_user_id === viewerUserId;
    const [circle] = await withParticipantCounts(
      [{
        id: data.id,
        owner_user_id: data.owner_user_id,
        name: data.name,
        created_at: data.created_at,
        image_url: data.image_url ?? null,
      }],
      isOwner,
      new Map([[data.id, (data as any).owner?.display_name ?? null]]),
    );
    return circle ?? null;
  } catch (error) {
    glowLogger.error('getCircleById threw', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
};

/** True when the user has at least one pending forging-circle invite. */
export const hasPendingCircleInvites = async (userId: string): Promise<boolean> => {
  const invites = await listIncomingInvites(userId);
  return invites.length > 0;
};

// ─── Invites ────────────────────────────────────────────────────────────────

export interface SendInviteResult {
  ok: boolean;
  reason?:
    | 'no_client'
    | 'unknown_email'
    | 'self_invite'
    | 'already_member'
    | 'already_pending'
    | 'not_owner'
    | 'unknown_error';
  inviteId?: number;
}

/**
 * Confirm that `userId` is the owner of `circleId`. Used as a client-side
 * guard before mutating a circle's invites or members; the database also
 * enforces this via RLS so the check is defense-in-depth.
 */
async function assertCircleOwner(circleId: number, userId: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase
      .from('forging_circles')
      .select('owner_user_id')
      .eq('id', circleId)
      .maybeSingle();
    if (error || !data) return false;
    return data.owner_user_id === userId;
  } catch {
    return false;
  }
}

/**
 * Send an invite to a target email scoped to a specific circle. Blocks unknown
 * emails (v1 design), self-invites, duplicate active invites, and users that
 * are already a member of this circle.
 */
export const sendCircleInvite = async (
  inviterUserId: string,
  circleId: number,
  inviteeEmail: string,
): Promise<SendInviteResult> => {
  if (!supabase) return { ok: false, reason: 'no_client' };

  // Only the owner of the circle may invite into it.
  if (!(await assertCircleOwner(circleId, inviterUserId))) {
    return { ok: false, reason: 'not_owner' };
  }

  const target = await findUserByEmail(inviteeEmail);
  if (!target) return { ok: false, reason: 'unknown_email' };
  if (target.userId === inviterUserId) return { ok: false, reason: 'self_invite' };

  try {
    // Already a member of this specific circle?
    const { data: existingMember } = await supabase
      .from('forging_circle_members')
      .select('id')
      .eq('circle_id', circleId)
      .eq('member_user_id', target.userId)
      .maybeSingle();
    if (existingMember) return { ok: false, reason: 'already_member' };

    // Existing pending/accepted invite to this circle for this user?
    const { data: existingInvite } = await supabase
      .from('forging_circle_invites')
      .select('id')
      .eq('circle_id', circleId)
      .eq('invitee_user_id', target.userId)
      .in('status', ['pending', 'accepted'])
      .limit(1)
      .maybeSingle();
    if (existingInvite) return { ok: false, reason: 'already_pending' };

    const { data, error } = await supabase
      .from('forging_circle_invites')
      .insert({
        circle_id: circleId,
        inviter_user_id: inviterUserId,
        invitee_email: target.email || inviteeEmail.trim().toLowerCase(),
        invitee_user_id: target.userId,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) {
      glowLogger.error('sendCircleInvite insert failed', { error: error.message });
      return { ok: false, reason: 'unknown_error' };
    }

    const [{ data: circleRow }, { data: inviterRow }] = await Promise.all([
      supabase.from('forging_circles').select('name').eq('id', circleId).maybeSingle(),
      supabase.from('user_profile').select('display_name').eq('user_id', inviterUserId).maybeSingle(),
    ]);

    void sendCircleInvitePushNotification({
      inviteeUserId: target.userId,
      inviterDisplayName: inviterRow?.display_name || 'A Forger',
      circleName: circleRow?.name || 'a circle',
      inviteId: data.id,
    });

    return { ok: true, inviteId: data?.id };
  } catch (error) {
    glowLogger.error('sendCircleInvite threw', { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, reason: 'unknown_error' };
  }
};

async function fetchInvitesByColumn(
  column: 'inviter_user_id' | 'invitee_user_id',
  userId: string,
  status: CircleInviteStatus | CircleInviteStatus[] = 'pending',
  circleId?: number,
): Promise<CircleInvite[]> {
  if (!supabase) return [];
  try {
    const statuses = Array.isArray(status) ? status : [status];
    let query = supabase
      .from('forging_circle_invites')
      .select(`
        id, circle_id, inviter_user_id, inviter_coach_id, invitee_user_id, invitee_email, status, created_at, responded_at,
        circle:forging_circles!forging_circle_invites_circle_id_fkey ( name ),
        inviter:user_profile!forging_circle_invites_inviter_user_id_fkey ( display_name, avatar_url ),
        inviterCoach:coaches!forging_circle_invites_inviter_coach_id_fkey ( full_name, coach_name ),
        invitee:user_profile!forging_circle_invites_invitee_user_id_fkey ( display_name, avatar_url )
      `)
      .eq(column, userId)
      .in('status', statuses)
      .order('created_at', { ascending: false });

    if (typeof circleId === 'number') {
      query = query.eq('circle_id', circleId);
    }

    const { data, error } = await query;
    if (error) {
      glowLogger.error('fetchInvitesByColumn failed', { column, error: error.message });
      return [];
    }
    return (data || []).map((r: any) => {
      const isCoach = r.inviter_coach_id != null;
      const coachName = r.inviterCoach?.full_name || r.inviterCoach?.coach_name || null;
      return {
      id: r.id,
      circleId: r.circle_id,
      circleName: r.circle?.name ?? null,
      inviterUserId: r.inviter_user_id ?? null,
      inviterCoachId: r.inviter_coach_id ?? null,
      inviterIsCoach: isCoach,
      inviterDisplayName: isCoach
        ? (coachName || 'Your coach')
        : (r.inviter?.display_name || 'A Forger'),
      inviterAvatarUrl: r.inviter?.avatar_url ?? null,
      inviteeUserId: r.invitee_user_id ?? null,
      inviteeDisplayName: r.invitee?.display_name ?? null,
      inviteeAvatarUrl: r.invitee?.avatar_url ?? null,
      inviteeEmail: r.invitee_email,
      status: r.status,
      createdAt: r.created_at,
      respondedAt: r.responded_at ?? null,
      };
    });
  } catch (error) {
    glowLogger.error('fetchInvitesByColumn threw', { column, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Pending invites where this user is the invitee. Across all circles (the
 * recipient hasn't opted into any circle yet, so we don't scope by circleId).
 */
export const listIncomingInvites = (userId: string) =>
  fetchInvitesByColumn('invitee_user_id', userId, 'pending');

/**
 * Pending invites the user has sent. Optionally scoped to a single circle.
 */
export const listOutgoingInvites = (userId: string, circleId?: number) =>
  fetchInvitesByColumn('inviter_user_id', userId, 'pending', circleId);

/**
 * Accept an invite using the server-side RPC, which atomically flips status
 * and writes the membership row scoped to the invite's circle. We use an RPC
 * because doing this with two client writes risks partial state on network
 * failure.
 */
export const acceptInvite = async (inviteId: number): Promise<boolean> => {
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc('accept_circle_invite', { p_invite_id: inviteId });
    if (error) {
      glowLogger.error('acceptInvite RPC failed', { invite_id: inviteId, error: error.message });
      return false;
    }
    return true;
  } catch (error) {
    glowLogger.error('acceptInvite threw', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
};

export const declineInvite = async (inviteId: number): Promise<boolean> => {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('forging_circle_invites')
      .update({ status: 'declined', responded_at: new Date().toISOString() })
      .eq('id', inviteId);
    if (error) {
      glowLogger.error('declineInvite failed', { error: error.message });
      return false;
    }
    return true;
  } catch (error) {
    glowLogger.error('declineInvite threw', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
};

export const cancelInvite = async (inviteId: number): Promise<boolean> => {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('forging_circle_invites')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .eq('id', inviteId);
    if (error) {
      glowLogger.error('cancelInvite failed', { error: error.message });
      return false;
    }
    return true;
  } catch (error) {
    glowLogger.error('cancelInvite threw', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
};

// ─── Members ────────────────────────────────────────────────────────────────

/**
 * Remove a member from a specific circle. Only the circle's owner may do this.
 * Visibility updates immediately on the next feed/leaderboard fetch because
 * those queries resolve membership at read time — there is no per-post
 * denormalization to repair.
 */
export const removeCircleMember = async (
  circleId: number,
  memberUserId: string,
  actorUserId: string,
): Promise<boolean> => {
  if (!supabase) return false;
  if (!(await assertCircleOwner(circleId, actorUserId))) {
    glowLogger.warn('removeCircleMember blocked: not owner', { circleId, actorUserId });
    return false;
  }
  try {
    const { error } = await supabase
      .from('forging_circle_members')
      .delete()
      .eq('circle_id', circleId)
      .eq('member_user_id', memberUserId);
    if (error) {
      glowLogger.error('removeCircleMember failed', { error: error.message });
      return false;
    }
    return true;
  } catch (error) {
    glowLogger.error('removeCircleMember threw', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
};

/**
 * List the members of a circle (excluding the owner — the owner is always a
 * participant and is rendered separately by the UI).
 */
export const listCircleMembers = async (circleId: number): Promise<CircleMember[]> => {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('forging_circle_members')
      .select(`
        id, member_user_id, created_at,
        member:user_profile!forging_circle_members_member_user_id_fkey ( display_name, avatar_url )
      `)
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false });
    if (error) {
      glowLogger.error('listCircleMembers failed', { error: error.message });
      return [];
    }
    return (data || []).map((r: any) => ({
      membershipId: r.id,
      userId: r.member_user_id,
      displayName: r.member?.display_name || 'A Forger',
      avatarUrl: r.member?.avatar_url ?? null,
      createdAt: r.created_at,
    }));
  } catch (error) {
    glowLogger.error('listCircleMembers threw', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
};

/**
 * Return the set of user ids that participate in **any** circle owned by the
 * given user (owner + members across all owned circles). Used as the
 * "My Circles" default audience for feed and leaderboard scoping.
 */
export const listAllOwnedCircleParticipantIds = async (ownerUserId: string): Promise<string[]> => {
  if (!supabase) return [];
  try {
    const { data: circles, error } = await supabase
      .from('forging_circles')
      .select('id')
      .eq('owner_user_id', ownerUserId);
    if (error || !circles || circles.length === 0) {
      if (error) glowLogger.error('listAllOwnedCircleParticipantIds: list circles failed', { error: error.message });
      return [ownerUserId];
    }
    const circleIds = circles.map((c: any) => c.id);
    const { data: members, error: mErr } = await supabase
      .from('forging_circle_members')
      .select('member_user_id')
      .in('circle_id', circleIds);
    if (mErr) {
      glowLogger.error('listAllOwnedCircleParticipantIds: list members failed', { error: mErr.message });
      return [ownerUserId];
    }
    const set = new Set<string>([ownerUserId]);
    (members || []).forEach((r: any) => set.add(r.member_user_id));
    return Array.from(set);
  } catch (error) {
    glowLogger.error('listAllOwnedCircleParticipantIds threw', { error: error instanceof Error ? error.message : String(error) });
    return [ownerUserId];
  }
};

/**
 * Return the set of user ids that participate in a specific circle, including
 * the owner. The owner is always included even if `listCircleMembers` returns
 * an empty list.
 */
export const listCircleParticipantIds = async (circleId: number): Promise<string[]> => {
  if (!supabase) return [];
  try {
    const { data: circle, error: cErr } = await supabase
      .from('forging_circles')
      .select('owner_user_id')
      .eq('id', circleId)
      .maybeSingle();
    if (cErr || !circle) {
      if (cErr) glowLogger.error('listCircleParticipantIds: load circle failed', { error: cErr.message });
      return [];
    }
    const { data: members, error: mErr } = await supabase
      .from('forging_circle_members')
      .select('member_user_id')
      .eq('circle_id', circleId);
    if (mErr) {
      glowLogger.error('listCircleParticipantIds: list members failed', { error: mErr.message });
      return [circle.owner_user_id];
    }
    const set = new Set<string>([circle.owner_user_id]);
    (members || []).forEach((r: any) => set.add(r.member_user_id));
    return Array.from(set);
  } catch (error) {
    glowLogger.error('listCircleParticipantIds threw', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
};
