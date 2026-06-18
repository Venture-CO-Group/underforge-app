/**
 * Leaderboard Storage
 * 
 * Manages consistency scores for the leaderboard feature.
 * - Local SQLite table for the current user's weekly scores
 * - Supabase table `weekly_consistency_scores` for cross-user leaderboard
 * 
 * Supabase table schema (create via Supabase dashboard):
 * 
 *   CREATE TABLE weekly_consistency_scores (
 *     id SERIAL PRIMARY KEY,
 *     user_id TEXT NOT NULL REFERENCES user_profile(user_id),
 *     week_start DATE NOT NULL,
 *     score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
 *     created_at TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at TIMESTAMPTZ DEFAULT NOW(),
 *     UNIQUE(user_id, week_start)
 *   );
 * 
 *   -- Index for leaderboard queries
 *   CREATE INDEX idx_wcs_week_start ON weekly_consistency_scores(week_start);
 *   CREATE INDEX idx_wcs_user_id ON weekly_consistency_scores(user_id);
 */

import { getQualifyingActivityCountsByDate } from './activity-storage';
import {
  computeThisWeekDashboardConsistencyScore,
  formatLocalYmd,
  getWeekMondaySundayYmd,
  mergeTrainingCountsWithDailyCap,
} from './consistency-helper';
import { getDatabase } from './db';
import {
  listAllOwnedCircleParticipantIds,
  listCircleParticipantIds,
} from './forging-circle';
import { GlowLogger } from './glow-logger';
import { getLocalMealCountsByDate } from './nutrition-storage';
import { withRetry } from './retry';
import type { FeedAudience } from './social-posts';
import { supabase } from './supabase_db_new';
import { getLocalWorkoutCountsByDate } from './workout-storage';

const glowLogger = new GlowLogger();

/** Normalize Postgres DATE / timestamptz strings for week comparison */
function normalizeWeekStartKey(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

/** Monday YYYY-MM-DD for the calendar week immediately before `currentWeekStart`. */
function getPreviousWeekStartYmd(currentWeekStart: string): string {
  const monday = new Date(`${currentWeekStart}T12:00:00`);
  monday.setDate(monday.getDate() - 7);
  return formatLocalYmd(monday);
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  this_week_score: number;
  score_to_date: number; // Average of all weekly scores
  weeks_active: number;  // Number of weeks with data
}

export interface WeeklyScore {
  user_id: string;
  week_start: string;
  score: number;
}

// ─── Local SQLite ───────────────────────────────────────────────────────────

/**
 * Initialize the local consistency_scores table
 */
export const initializeLeaderboardDB = async (): Promise<void> => {
  try {
    const db = getDatabase();
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS consistency_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        week_start TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced INTEGER DEFAULT 0,
        UNIQUE(user_id, week_start)
      );
    `);
    glowLogger.info('Consistency scores table initialized', {});
  } catch (error) {
    glowLogger.error('Error initializing consistency scores table', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Save or update a weekly consistency score locally
 */
export const saveLocalConsistencyScore = async (
  userId: string,
  weekStart: string,
  score: number
): Promise<void> => {
  try {
    const db = getDatabase();
    await db.runAsync(
      `INSERT INTO consistency_scores (user_id, week_start, score, synced)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(user_id, week_start) DO UPDATE SET score = ?, synced = 0`,
      [userId, weekStart, score, score]
    );
  } catch (error) {
    glowLogger.error('Error saving local consistency score', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      week_start: weekStart,
    });
  }
};

/**
 * Get all local consistency scores for a user
 */
export const getLocalConsistencyScores = async (
  userId: string
): Promise<WeeklyScore[]> => {
  try {
    const db = getDatabase();
    const rows = await db.getAllAsync<{ user_id: string; week_start: string; score: number }>(
      `SELECT user_id, week_start, score FROM consistency_scores
       WHERE user_id = ? ORDER BY week_start ASC`,
      [userId]
    );
    return rows;
  } catch (error) {
    glowLogger.error('Error getting local consistency scores', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return [];
  }
};

// ─── Supabase ───────────────────────────────────────────────────────────────

/**
 * Upsert the current user's weekly score to Supabase
 */
export const saveConsistencyScoreToSupabase = async (
  userId: string,
  weekStart: string,
  score: number
): Promise<void> => {
  try {
    if (!supabase) {
      glowLogger.info('Supabase not initialized, skipping score upload', {});
      return;
    }

    await withRetry(
      async () => {
        const { error } = await supabase
          .from('weekly_consistency_scores')
          .upsert(
            {
              user_id: userId,
              week_start: weekStart,
              score,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,week_start' }
          );

        if (error) {
          throw new Error(error.message);
        }
      },
      {
        label: 'saveConsistencyScoreToSupabase',
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 8000,
      }
    );

    // Mark local row as synced
    const db = getDatabase();
    await db.runAsync(
      `UPDATE consistency_scores SET synced = 1 WHERE user_id = ? AND week_start = ?`,
      [userId, weekStart]
    );

    glowLogger.info('Consistency score synced to Supabase', {
      user_id: userId,
      week_start: weekStart,
      score,
    });
  } catch (error) {
    glowLogger.error('Error saving consistency score to Supabase', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
  }
};

/**
 * Recompute this week's dashboard consistency from local logs and upsert to SQLite + Supabase.
 * Call when opening the social leaderboard so scores stay fresh even if CoachDashboard is unmounted.
 */
export const refreshLeaderboardScoreFromLocalData = async (
  userId: string,
  plannedTrainingDays: Set<string>,
  userJoinDateYmd: string | null,
): Promise<{ weekStart: string; score: number } | null> => {
  try {
    const now = new Date();
    const { mondayStr, sundayStr } = getWeekMondaySundayYmd(now);

    const [mealCounts, workoutCounts, qualifyingActivityCounts] = await Promise.all([
      getLocalMealCountsByDate(userId, mondayStr, sundayStr),
      getLocalWorkoutCountsByDate(userId, mondayStr, sundayStr),
      getQualifyingActivityCountsByDate(userId, mondayStr, sundayStr),
    ]);

    const mergedTraining = mergeTrainingCountsWithDailyCap(workoutCounts, qualifyingActivityCounts);

    const score = computeThisWeekDashboardConsistencyScore({
      now,
      plannedTrainingDayAbbrevs: plannedTrainingDays,
      weeklyMealCountsByDate: mealCounts,
      mergedTrainingCountsByDate: mergedTraining,
      userJoinDateYmd,
    });

    await saveLocalConsistencyScore(userId, mondayStr, score);
    await saveConsistencyScoreToSupabase(userId, mondayStr, score);

    return { weekStart: mondayStr, score };
  } catch (error) {
    glowLogger.error('Error refreshing leaderboard score from local data', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return null;
  }
};

/** Read the locally-stored consistency score for a given week, or null if none. */
const getStoredLocalConsistencyScore = async (
  userId: string,
  weekStart: string,
): Promise<number | null> => {
  try {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ score: number }>(
      `SELECT score FROM consistency_scores WHERE user_id = ? AND week_start = ?`,
      [userId, weekStart],
    );
    return row ? row.score : null;
  } catch {
    return null;
  }
};

/**
 * Recompute this week's leaderboard score from local logs and upload to Supabase
 * ONLY when it differs from the locally-stored value. Safe (and intended) to call
 * after every user meal/workout/activity log.
 *
 * Because the score caps nutrition at 3 meals/day and training at 1 session/day,
 * redundant logs don't move it — e.g. the 4th meal of a day, or a 2nd workout /
 * qualifying activity on a day that already counts. In those cases the recomputed
 * score equals the stored score and we skip the Supabase write entirely. This is a
 * more robust equivalent of "don't update on the 3rd+ meal / already-trained day":
 * it can never skip a log that would actually change the score.
 *
 * Planned training days come from local onboarding data so callers only pass the
 * userId. `userJoinDateYmd` is left null here (it only affects a user's very first
 * partial week); the dashboard / community refresh paths supply the precise value.
 */
export const refreshConsistencyScoreAfterLog = async (
  userId: string,
): Promise<{ weekStart: string; score: number; uploaded: boolean } | null> => {
  try {
    const { getLocalOnboardingData } = await import('./sync-status');
    const onboarding = await getLocalOnboardingData().catch(() => null);
    const plannedTrainingDays = new Set(
      (onboarding?.actionPlan?.steps?.[0]?.daysOfWeek ?? []).map((d: string) => d.toLowerCase()),
    );

    const now = new Date();
    const { mondayStr, sundayStr } = getWeekMondaySundayYmd(now);

    const [mealCounts, workoutCounts, qualifyingActivityCounts] = await Promise.all([
      getLocalMealCountsByDate(userId, mondayStr, sundayStr),
      getLocalWorkoutCountsByDate(userId, mondayStr, sundayStr),
      getQualifyingActivityCountsByDate(userId, mondayStr, sundayStr),
    ]);

    const mergedTraining = mergeTrainingCountsWithDailyCap(workoutCounts, qualifyingActivityCounts);

    const score = computeThisWeekDashboardConsistencyScore({
      now,
      plannedTrainingDayAbbrevs: plannedTrainingDays,
      weeklyMealCountsByDate: mealCounts,
      mergedTrainingCountsByDate: mergedTraining,
      userJoinDateYmd: null,
    });

    const storedScore = await getStoredLocalConsistencyScore(userId, mondayStr);
    if (storedScore === score) {
      return { weekStart: mondayStr, score, uploaded: false };
    }

    await saveLocalConsistencyScore(userId, mondayStr, score);
    await saveConsistencyScoreToSupabase(userId, mondayStr, score);
    return { weekStart: mondayStr, score, uploaded: true };
  } catch (error) {
    glowLogger.error('Error refreshing consistency score after log', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    return null;
  }
};

/**
 * Sync all unsynced local scores to Supabase
 */
export const syncUnsyncedScoresToSupabase = async (userId: string): Promise<void> => {
  try {
    const db = getDatabase();
    const unsynced = await db.getAllAsync<{ week_start: string; score: number }>(
      `SELECT week_start, score FROM consistency_scores WHERE user_id = ? AND synced = 0`,
      [userId]
    );

    if (unsynced.length === 0) return;

    for (const row of unsynced) {
      await saveConsistencyScoreToSupabase(userId, row.week_start, row.score);
    }

    glowLogger.info('Synced unsynced consistency scores', {
      user_id: userId,
      count: unsynced.length,
    });
  } catch (error) {
    glowLogger.error('Error syncing unsynced scores', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
  }
};

/**
 * Fetch the full leaderboard from Supabase.
 * Aggregates all users' weekly scores to compute:
 * - this_week_score (score for the current week)
 * - score_to_date (average of all weekly scores)
 * - weeks_active (count of weeks with scores)
 */
export const fetchLeaderboard = async (
  currentWeekStart: string,
  currentUserId?: string,
  audience: FeedAudience = { kind: 'public' },
): Promise<LeaderboardEntry[]> => {
  try {
    if (!supabase) {
      glowLogger.info('Supabase not initialized, returning empty leaderboard', {});
      return [];
    }

    // Resolve the set of users allowed by a circle-scoped audience filter.
    // Self is always allowed regardless of audience choice.
    const circleAllowed = new Set<string>();
    if (currentUserId) {
      circleAllowed.add(currentUserId);
      try {
        if (audience.kind === 'circle') {
          const ids = await listCircleParticipantIds(audience.circleId);
          for (const id of ids) circleAllowed.add(id);
        } else if (audience.kind === 'all-mine') {
          const ids = await listAllOwnedCircleParticipantIds(currentUserId);
          for (const id of ids) circleAllowed.add(id);
        }
        // 'only-me' and 'public' don't need extra participants.
      } catch {
        // Non-fatal: leave the set with just self.
      }
    }

    // Fetch all scores + user profile info in a single query using a join.
    // Includes share_stats (hard opt-out kill switch) AND
    // default_share_audience (per-user 'public' | 'circle' choice).
    const { data: scores, error: scoresError } = await supabase
      .from('weekly_consistency_scores')
      .select(`
        user_id,
        week_start,
        score,
        user_profile!inner(display_name, avatar_url, created_at, share_stats, default_share_audience)
      `)
      .order('week_start', { ascending: true });

    if (scoresError) {
      glowLogger.error('Error fetching leaderboard scores', {
        error: scoresError.message,
      });
      // Fallback: fetch scores without join
      return await fetchLeaderboardFallback(currentWeekStart, currentUserId, audience);
    }

    if (!scores || scores.length === 0) return [];

    const previousWeekStart = getPreviousWeekStartYmd(currentWeekStart);

    // Aggregate per user
    const userMap = new Map<string, {
      display_name: string;
      avatar_url: string | null;
      totalScore: number;
      weekCount: number;
      thisWeekScore: number;
      previousWeekScore: number | null;
      createdAt: string | null;
      shareStats: boolean;
      defaultShareAudience: 'public' | 'circles';
    }>();

    for (const row of scores) {
      const userId = row.user_id;
      const profile = row.user_profile as any;
      const weekKey = normalizeWeekStartKey(row.week_start);

      if (!userMap.has(userId)) {
        userMap.set(userId, {
          display_name: profile?.display_name || 'User',
          avatar_url: profile?.avatar_url ?? null,
          totalScore: 0,
          weekCount: 0,
          thisWeekScore: 0,
          previousWeekScore: null,
          createdAt: profile?.created_at || null,
          shareStats: profile?.share_stats === true,
          defaultShareAudience: profile?.default_share_audience === 'public' ? 'public' : 'circles',
        });
      }

      const entry = userMap.get(userId)!;
      entry.totalScore += row.score;
      entry.weekCount += 1;

      if (weekKey === normalizeWeekStartKey(currentWeekStart)) {
        entry.thisWeekScore = row.score;
        glowLogger.info('Found current week score', {
          user_id: userId,
          week_start: row.week_start,
          score: row.score,
        });
      }

      if (weekKey === normalizeWeekStartKey(previousWeekStart)) {
        entry.previousWeekScore = row.score;
      }
    }

    // Build leaderboard array, filtering out users who haven't opted in.
    // The current user always sees their own entry.
    const leaderboard: LeaderboardEntry[] = [];
    const now = new Date();

    for (const [userId, data] of userMap.entries()) {
      const isCurrentUser = userId === currentUserId;

      // Audience scope (default_share_audience is set in Menu > Forging Circles):
      //  - 'only-me' view: nobody else (drop every non-self entry)
      //  - 'public' view: 'public'-default users only (plus self)
      //  - 'circle' / 'all-mine' view: circle members only (plus self)
      if (!isCurrentUser) {
        if (audience.kind === 'only-me') {
          continue;
        }
        if (audience.kind === 'public') {
          if (data.defaultShareAudience !== 'public') continue;
        } else {
          if (!circleAllowed.has(userId)) continue;
        }
      }

      // Drop external users who finished the previous Mon–Sun week at zero consistency
      if (!isCurrentUser && data.previousWeekScore === 0) {
        continue;
      }

      // Calculate weeks since account creation
      let weeksActive = 1; // Default to 1 week if no created_at
      if (data.createdAt) {
        const createdDate = new Date(data.createdAt);
        const diffMs = now.getTime() - createdDate.getTime();
        const diffWeeks = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7));
        weeksActive = Math.max(1, diffWeeks + 1); // +1 because current week counts, minimum 1
      }
      
      leaderboard.push({
        user_id: userId,
        display_name: data.display_name,
        avatar_url: data.avatar_url,
        this_week_score: data.thisWeekScore,
        score_to_date: data.weekCount > 0 ? Math.round(data.totalScore / data.weekCount) : 0,
        weeks_active: weeksActive,
      });
    }

    // Sort by score_to_date descending (best average first)
    leaderboard.sort((a, b) => b.score_to_date - a.score_to_date);

    glowLogger.info('Leaderboard fetched successfully', {
      entries: leaderboard.length,
      currentWeekStart,
      sampleEntry: leaderboard.length > 0 ? JSON.stringify({
        user_id: leaderboard[0].user_id,
        this_week_score: leaderboard[0].this_week_score,
        score_to_date: leaderboard[0].score_to_date,
        weeks_active: leaderboard[0].weeks_active,
      }) : 'none',
    });

    return leaderboard;
  } catch (error) {
    glowLogger.error('Error fetching leaderboard', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

/**
 * Fallback leaderboard fetch without join (in case the join fails due to missing FK)
 */
const fetchLeaderboardFallback = async (
  currentWeekStart: string,
  currentUserId?: string,
  audience: FeedAudience = { kind: 'public' },
): Promise<LeaderboardEntry[]> => {
  try {
    if (!supabase) return [];

    // Resolve circle scope (self always allowed).
    const circleAllowed = new Set<string>();
    if (currentUserId) {
      circleAllowed.add(currentUserId);
      try {
        if (audience.kind === 'circle') {
          const ids = await listCircleParticipantIds(audience.circleId);
          for (const id of ids) circleAllowed.add(id);
        } else if (audience.kind === 'all-mine') {
          const ids = await listAllOwnedCircleParticipantIds(currentUserId);
          for (const id of ids) circleAllowed.add(id);
        }
        // 'only-me' and 'public' don't need extra participants.
      } catch {
        // Non-fatal.
      }
    }

    // Fetch scores
    const { data: scores, error: scoresError } = await supabase
      .from('weekly_consistency_scores')
      .select('user_id, week_start, score')
      .order('week_start', { ascending: true });

    if (scoresError || !scores || scores.length === 0) return [];

    // Get unique user IDs
    const userIds = [...new Set(scores.map((s: any) => s.user_id))];

    // Fetch profiles including share_stats + default_share_audience
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profile')
      .select('user_id, display_name, avatar_url, created_at, share_stats, default_share_audience')
      .in('user_id', userIds);

    const profileMap = new Map<string, {
      display_name: string;
      avatar_url: string | null;
      created_at: string | null;
      share_stats: boolean;
      default_share_audience: 'public' | 'circles';
    }>();
    if (profiles && !profilesError) {
      for (const p of profiles) {
        profileMap.set(p.user_id, {
          display_name: p.display_name || 'User',
          avatar_url: p.avatar_url ?? null,
          created_at: p.created_at || null,
          share_stats: p.share_stats === true,
          default_share_audience: p.default_share_audience === 'public' ? 'public' : 'circles',
        });
      }
    }

    const previousWeekStart = getPreviousWeekStartYmd(currentWeekStart);

    // Aggregate
    const userMap = new Map<string, {
      totalScore: number;
      weekCount: number;
      thisWeekScore: number;
      previousWeekScore: number | null;
    }>();

    for (const row of scores) {
      const weekKey = normalizeWeekStartKey(row.week_start);

      if (!userMap.has(row.user_id)) {
        userMap.set(row.user_id, {
          totalScore: 0,
          weekCount: 0,
          thisWeekScore: 0,
          previousWeekScore: null,
        });
      }
      const entry = userMap.get(row.user_id)!;
      entry.totalScore += row.score;
      entry.weekCount += 1;
      if (weekKey === normalizeWeekStartKey(currentWeekStart)) {
        entry.thisWeekScore = row.score;
      }
      if (weekKey === normalizeWeekStartKey(previousWeekStart)) {
        entry.previousWeekScore = row.score;
      }
    }

    const leaderboard: LeaderboardEntry[] = [];
    const now = new Date();
    
    for (const [userId, data] of userMap.entries()) {
      const profile = profileMap.get(userId);

      const isCurrentUser = userId === currentUserId;

      // Audience scope (mirrors the primary path).
      if (!isCurrentUser) {
        if (audience.kind === 'only-me') {
          continue;
        }
        if (audience.kind === 'public') {
          if (profile?.default_share_audience !== 'public') continue;
        } else {
          if (!circleAllowed.has(userId)) continue;
        }
      }

      if (!isCurrentUser && data.previousWeekScore === 0) {
        continue;
      }

      // Calculate weeks since account creation
      let weeksActive = 1;
      if (profile?.created_at) {
        const createdDate = new Date(profile.created_at);
        const diffMs = now.getTime() - createdDate.getTime();
        const diffWeeks = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7));
        weeksActive = Math.max(1, diffWeeks + 1);
      }
      
      leaderboard.push({
        user_id: userId,
        display_name: profile?.display_name || 'User',
        avatar_url: profile?.avatar_url ?? null,
        this_week_score: data.thisWeekScore,
        score_to_date: data.weekCount > 0 ? Math.round(data.totalScore / data.weekCount) : 0,
        weeks_active: weeksActive,
      });
    }

    leaderboard.sort((a, b) => b.score_to_date - a.score_to_date);
    return leaderboard;
  } catch (error) {
    glowLogger.error('Error in fallback leaderboard fetch', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};
