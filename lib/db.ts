import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { GlowLogger } from './glow-logger';
import { initializeLeaderboardDB } from './leaderboard-storage';
import { initializeTaskCompletionDB } from './task-completion-storage';

export interface LocalUser {
  id: string;
  display_name: string;
  seen_intro_tutorial: boolean;
  active: boolean;
}

// Singleton database instance
let db: SQLite.SQLiteDatabase | null = null;
export const getDatabase = (): SQLite.SQLiteDatabase => {
  if (!db) {
    db = SQLite.openDatabaseSync('longeviq.db');
  }
  return db;
};

// Utility to close the database connection
export const closeDatabase = async (): Promise<void> => {
  if (db) {
    try {
      await db.closeAsync();
      db = null;
    } catch (error) {
      // Log but don't throw
      console.warn('Error closing database:', error);
    }
  }
}

// Module-level GlowLogger instance
const glowLogger = new GlowLogger();

export const initializeDatabase = async (): Promise<void> => {
  try {
    const dbInstance = getDatabase();
    // Create or ensure the new table structure exists
    await dbInstance.execAsync(`
      CREATE TABLE IF NOT EXISTS logged_in_user (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT 0,
        seen_intro_tutorial BOOLEAN NOT NULL DEFAULT 0
      );
    `);
    
    // Initialize task completion table
    await initializeTaskCompletionDB();
    
    // Initialize leaderboard/consistency scores table
    await initializeLeaderboardDB();
    
    // Initialize body composition table
    await dbInstance.execAsync(`
      CREATE TABLE IF NOT EXISTS body_composition_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        log_date TEXT NOT NULL,
        week_number INTEGER NOT NULL,
        year INTEGER NOT NULL,
        weight_value REAL NOT NULL,
        weight_unit TEXT NOT NULL CHECK (weight_unit IN ('kg', 'lbs')),
        muscle_percent REAL NOT NULL,
        fat_percent REAL NOT NULL,
        photo_front_url TEXT,
        photo_side_url TEXT,
        photo_back_url TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, week_number, year)
      );
    `);
    glowLogger.info('Body composition table initialized', {});

    // Lightweight migration: progress-photo URL columns on body_composition_log.
    // SQLite ALTER TABLE adds one column per call; wrap each so devices created
    // before the photos feature pick them up without losing existing rows.
    for (const col of ['photo_front_url', 'photo_side_url', 'photo_back_url']) {
      try {
        await dbInstance.getFirstAsync(`SELECT ${col} FROM body_composition_log LIMIT 1;`);
      } catch {
        try {
          await dbInstance.execAsync(`ALTER TABLE body_composition_log ADD COLUMN ${col} TEXT;`);
          glowLogger.info(`Added ${col} column to body_composition_log`, {});
        } catch (alterError) {
          glowLogger.error(`Failed to add ${col} to body_composition_log`, {
            error: alterError instanceof Error ? alterError.message : String(alterError),
          });
        }
      }
    }

    // Initialize meal_logs table for offline nutrition tracking
    await dbInstance.execAsync(`
      CREATE TABLE IF NOT EXISTS meal_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supabase_id INTEGER,
        user_id TEXT NOT NULL,
        log_date TEXT NOT NULL,
        meal_description TEXT NOT NULL,
        carbs_grams REAL NOT NULL,
        protein_grams REAL NOT NULL,
        fat_grams REAL NOT NULL,
        fiber_grams REAL NOT NULL,
        calories INTEGER NOT NULL,
        food_quantities TEXT,
        food_item_macros TEXT,
        logged_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced INTEGER DEFAULT 0
      );
    `);
    glowLogger.info('Meal logs table initialized', {});

    // Initialize workout_logs table for offline workout tracking
    await dbInstance.execAsync(`
      CREATE TABLE IF NOT EXISTS workout_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supabase_id INTEGER,
        user_id TEXT NOT NULL,
        workout_date TEXT NOT NULL,
        workout_day_name TEXT NOT NULL,
        step_id TEXT,
        status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'deleted')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced INTEGER DEFAULT 0
      );
    `);
    glowLogger.info('Workout logs table initialized', {});

    // Initialize workout_exercise_logs table for individual exercise entries
    await dbInstance.execAsync(`
      CREATE TABLE IF NOT EXISTS workout_exercise_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supabase_id INTEGER,
        workout_log_id INTEGER NOT NULL,
        exercise_id TEXT NOT NULL,
        exercise_name TEXT NOT NULL,
        set_number INTEGER NOT NULL,
        weight_value REAL,
        weight_unit TEXT CHECK (weight_unit IN ('kg', 'lbs')),
        reps INTEGER,
        rest_time_seconds INTEGER,
        rir INTEGER CHECK (rir >= 0 AND rir <= 5),
        difficulty_perception INTEGER CHECK (difficulty_perception >= 1 AND difficulty_perception <= 5),
        comments TEXT,
        completed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced INTEGER DEFAULT 0,
        FOREIGN KEY (workout_log_id) REFERENCES workout_logs(id) ON DELETE CASCADE
      );
    `);
    glowLogger.info('Workout exercise logs table initialized', {});

    await dbInstance.execAsync(`
      CREATE TABLE IF NOT EXISTS custom_exercises (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        body_region TEXT NOT NULL CHECK (body_region IN ('upper', 'lower', 'core')),
        muscle_group TEXT NOT NULL CHECK (muscle_group IN ('chest', 'back', 'shoulders', 'arms', 'legs', 'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'abs', 'obliques')),
        movement_type TEXT NOT NULL CHECK (movement_type IN ('compound', 'isolation')),
        category TEXT NOT NULL DEFAULT 'strength' CHECK (category IN ('strength', 'endurance', 'conditioning', 'mobility', 'power')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_custom_exercises_user_id ON custom_exercises(user_id);
    `);

    // Lightweight migration for devices created before quads/hamstrings + category.
    // The muscle_group CHECK can't be widened in-place, so rebuild when the new
    // `category` column is missing (a reliable marker of the old schema).
    try {
      await dbInstance.getFirstAsync('SELECT category FROM custom_exercises LIMIT 1;');
    } catch {
      try {
        glowLogger.info('Migrating custom_exercises (quads/hamstrings + category)', {});
        await dbInstance.execAsync(`
          BEGIN;
          CREATE TABLE custom_exercises_new (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            body_region TEXT NOT NULL CHECK (body_region IN ('upper', 'lower', 'core')),
            muscle_group TEXT NOT NULL CHECK (muscle_group IN ('chest', 'back', 'shoulders', 'arms', 'legs', 'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'abs', 'obliques')),
            movement_type TEXT NOT NULL CHECK (movement_type IN ('compound', 'isolation')),
            category TEXT NOT NULL DEFAULT 'strength' CHECK (category IN ('strength', 'endurance', 'conditioning', 'mobility', 'power')),
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO custom_exercises_new (
            id, user_id, name, body_region, muscle_group, movement_type, created_at, updated_at
          )
          SELECT id, user_id, name, body_region, muscle_group, movement_type, created_at, updated_at
            FROM custom_exercises;
          DROP TABLE custom_exercises;
          ALTER TABLE custom_exercises_new RENAME TO custom_exercises;
          CREATE INDEX IF NOT EXISTS idx_custom_exercises_user_id ON custom_exercises(user_id);
          COMMIT;
        `);
      } catch (e) {
        glowLogger.warn('Failed to migrate custom_exercises table', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Second migration: widen the `category` CHECK to allow 'mobility' + 'power'
    // (added 2026-06). SQLite can't ALTER a CHECK in place, so inspect the stored
    // table SQL and rebuild only when the new categories aren't yet allowed.
    try {
      const row = await dbInstance.getFirstAsync<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='custom_exercises';",
      );
      if (row?.sql && !row.sql.includes("'power'")) {
        glowLogger.info('Migrating custom_exercises (category mobility/power)', {});
        await dbInstance.execAsync(`
          BEGIN;
          CREATE TABLE custom_exercises_new (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            body_region TEXT NOT NULL CHECK (body_region IN ('upper', 'lower', 'core')),
            muscle_group TEXT NOT NULL CHECK (muscle_group IN ('chest', 'back', 'shoulders', 'arms', 'legs', 'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'abs', 'obliques')),
            movement_type TEXT NOT NULL CHECK (movement_type IN ('compound', 'isolation')),
            category TEXT NOT NULL DEFAULT 'strength' CHECK (category IN ('strength', 'endurance', 'conditioning', 'mobility', 'power')),
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO custom_exercises_new (
            id, user_id, name, body_region, muscle_group, movement_type, category, created_at, updated_at
          )
          SELECT id, user_id, name, body_region, muscle_group, movement_type, category, created_at, updated_at
            FROM custom_exercises;
          DROP TABLE custom_exercises;
          ALTER TABLE custom_exercises_new RENAME TO custom_exercises;
          CREATE INDEX IF NOT EXISTS idx_custom_exercises_user_id ON custom_exercises(user_id);
          COMMIT;
        `);
      }
    } catch (e) {
      glowLogger.warn('Failed to widen custom_exercises category CHECK', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    glowLogger.info('Custom exercises table initialized', {});

    // Initialize activity_logs table for cardio/sport/activity tracking
    await dbInstance.execAsync(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supabase_id INTEGER,
        user_id TEXT NOT NULL,
        activity_date TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        activity_name TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        intensity TEXT CHECK (intensity IN ('easy', 'moderate', 'hard', 'max')),
        distance_value REAL,
        distance_unit TEXT CHECK (distance_unit IN ('km', 'mi')),
        elevation_gain REAL,
        calories_burned INTEGER,
        avg_heart_rate INTEGER,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced INTEGER DEFAULT 0
      );
    `);
    glowLogger.info('Activity logs table initialized', {});

    // Initialize user_nutrition_targets table for personalized nutrition targets.
    // Existing macro columns act as the REST-day baseline; the training_day_*
    // columns hold the higher target for planned training days. They default
    // to NULL for legacy rows so existing readers keep working.
    await dbInstance.execAsync(`
      CREATE TABLE IF NOT EXISTS user_nutrition_targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supabase_id INTEGER,
        user_id TEXT NOT NULL,
        calories_target INTEGER NOT NULL,
        carbs_target_grams REAL NOT NULL,
        protein_target_grams REAL NOT NULL,
        fat_target_grams REAL NOT NULL,
        fiber_target_grams REAL NOT NULL,
        training_day_calories_target INTEGER,
        training_day_carbs_target_grams REAL,
        training_day_protein_target_grams REAL,
        training_day_fat_target_grams REAL,
        training_day_fiber_target_grams REAL,
        baseline_movement_kcal INTEGER,
        baseline_movement_minutes INTEGER,
        baseline_movement_steps INTEGER,
        effective_from TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced INTEGER DEFAULT 0,
        UNIQUE(user_id, effective_from)
      );
    `);
    // Lightweight migration for devices that already had the v1 table.
    try {
      await dbInstance.getFirstAsync(`SELECT training_day_calories_target FROM user_nutrition_targets LIMIT 1;`);
    } catch {
      try {
        await dbInstance.execAsync(`
          ALTER TABLE user_nutrition_targets ADD COLUMN training_day_calories_target INTEGER;
          ALTER TABLE user_nutrition_targets ADD COLUMN training_day_carbs_target_grams REAL;
          ALTER TABLE user_nutrition_targets ADD COLUMN training_day_protein_target_grams REAL;
          ALTER TABLE user_nutrition_targets ADD COLUMN training_day_fat_target_grams REAL;
          ALTER TABLE user_nutrition_targets ADD COLUMN training_day_fiber_target_grams REAL;
        `);
        glowLogger.info('Added training_day_* columns to user_nutrition_targets', {});
      } catch (e) {
        glowLogger.warn('Failed to add training_day_* columns to user_nutrition_targets', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    // Lightweight migration: add baseline_movement_* columns. These hold the
    // explicit non-training NEAT recommendation (kcal/min/steps). Legacy
    // rows stay NULL; readers fall back to a runtime recompute.
    try {
      await dbInstance.getFirstAsync(`SELECT baseline_movement_kcal FROM user_nutrition_targets LIMIT 1;`);
    } catch {
      try {
        await dbInstance.execAsync(`
          ALTER TABLE user_nutrition_targets ADD COLUMN baseline_movement_kcal INTEGER;
          ALTER TABLE user_nutrition_targets ADD COLUMN baseline_movement_minutes INTEGER;
          ALTER TABLE user_nutrition_targets ADD COLUMN baseline_movement_steps INTEGER;
        `);
        glowLogger.info('Added baseline_movement_* columns to user_nutrition_targets', {});
      } catch (e) {
        glowLogger.warn('Failed to add baseline_movement_* columns to user_nutrition_targets', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    glowLogger.info('User nutrition targets table initialized', {});

    // ---- Wearables v1: daily_metrics, provider connections (public view),
    // nutrition_daily_adjustments. Raw payloads live server-side only and are
    // not mirrored to SQLite.
    //
    // The metric CHECK constraint grew in 20260429 to include sleep + recovery
    // indicators. SQLite cannot ALTER a CHECK in place, so on devices that
    // previously created the table with the old constraint we rebuild it
    // (preserving rows) before any inserts of the new metric names happen.
    const DAILY_METRICS_DDL = `
      CREATE TABLE IF NOT EXISTS daily_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supabase_id INTEGER,
        user_id TEXT NOT NULL,
        metric_date TEXT NOT NULL,
        metric TEXT NOT NULL CHECK (metric IN (
          'steps','active_energy_kcal','resting_energy_kcal',
          'sleep_total_min','sleep_efficiency_pct',
          'recovery_score','hrv_rmssd_ms','resting_hr_bpm'
        )),
        source TEXT NOT NULL CHECK (source IN ('healthkit','whoop','garmin','healthconnect','manual')),
        value REAL NOT NULL,
        is_canonical INTEGER NOT NULL DEFAULT 0,
        winner_reason TEXT,
        confidence TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high','medium','low')),
        synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced INTEGER DEFAULT 0,
        UNIQUE(user_id, metric_date, metric, source)
      );
    `;
    const DAILY_METRICS_INDEXES = `
      CREATE INDEX IF NOT EXISTS idx_daily_metrics_user_date
        ON daily_metrics(user_id, metric_date);
      CREATE INDEX IF NOT EXISTS idx_daily_metrics_canonical
        ON daily_metrics(user_id, metric_date, metric, is_canonical);
    `;

    const existingDailyMetricsRow = await dbInstance.getFirstAsync<{ sql: string | null }>(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_metrics'`,
    );
    const existingDailyMetricsSql = existingDailyMetricsRow?.sql ?? '';
    const needsDailyMetricsRebuild =
      Boolean(existingDailyMetricsSql) && !existingDailyMetricsSql.includes('sleep_total_min');

    if (needsDailyMetricsRebuild) {
      glowLogger.info('Migrating daily_metrics CHECK constraint', {});
      await dbInstance.execAsync(`
        BEGIN;
        CREATE TABLE daily_metrics_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supabase_id INTEGER,
          user_id TEXT NOT NULL,
          metric_date TEXT NOT NULL,
          metric TEXT NOT NULL CHECK (metric IN (
            'steps','active_energy_kcal','resting_energy_kcal',
            'sleep_total_min','sleep_efficiency_pct',
            'recovery_score','hrv_rmssd_ms','resting_hr_bpm'
          )),
          source TEXT NOT NULL CHECK (source IN ('healthkit','whoop','garmin','healthconnect','manual')),
          value REAL NOT NULL,
          is_canonical INTEGER NOT NULL DEFAULT 0,
          winner_reason TEXT,
          confidence TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high','medium','low')),
          synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
          synced INTEGER DEFAULT 0,
          UNIQUE(user_id, metric_date, metric, source)
        );
        INSERT INTO daily_metrics_new (
          id, supabase_id, user_id, metric_date, metric, source, value,
          is_canonical, winner_reason, confidence, synced_at, synced
        )
        SELECT
          id, supabase_id, user_id, metric_date, metric, source, value,
          is_canonical, winner_reason, confidence, synced_at, synced
          FROM daily_metrics;
        DROP TABLE daily_metrics;
        ALTER TABLE daily_metrics_new RENAME TO daily_metrics;
        COMMIT;
      `);
    }

    await dbInstance.execAsync(DAILY_METRICS_DDL);
    await dbInstance.execAsync(DAILY_METRICS_INDEXES);
    glowLogger.info('Daily metrics table initialized', {});

    await dbInstance.execAsync(`
      CREATE TABLE IF NOT EXISTS user_provider_connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supabase_id INTEGER,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('healthkit','whoop','garmin','healthconnect')),
        external_user_id TEXT,
        connected_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_sync_at TEXT,
        last_sync_cursor TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','error')),
        last_error TEXT,
        UNIQUE(user_id, provider)
      );
      CREATE INDEX IF NOT EXISTS idx_upc_user_id ON user_provider_connections(user_id);
    `);
    glowLogger.info('Provider connections table initialized', {});

    await dbInstance.execAsync(`
      CREATE TABLE IF NOT EXISTS nutrition_daily_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supabase_id INTEGER,
        user_id TEXT NOT NULL,
        adjustment_date TEXT NOT NULL,
        base_calories_target INTEGER NOT NULL,
        base_carbs_target_grams REAL NOT NULL,
        base_protein_target_grams REAL NOT NULL,
        base_fat_target_grams REAL NOT NULL,
        base_fiber_target_grams REAL NOT NULL,
        activity_calories_burned INTEGER NOT NULL DEFAULT 0,
        steps_neat_calories INTEGER NOT NULL DEFAULT 0,
        adjusted_calories_target INTEGER NOT NULL,
        adjusted_carbs_target_grams REAL NOT NULL,
        adjusted_protein_target_grams REAL NOT NULL,
        adjusted_fat_target_grams REAL NOT NULL,
        adjusted_fiber_target_grams REAL NOT NULL,
        strategy TEXT NOT NULL DEFAULT 'carbs_first_v1',
        inputs_digest TEXT,
        computed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced INTEGER DEFAULT 0,
        UNIQUE(user_id, adjustment_date)
      );
      CREATE INDEX IF NOT EXISTS idx_nda_user_date
        ON nutrition_daily_adjustments(user_id, adjustment_date);
    `);
    glowLogger.info('Nutrition daily adjustments table initialized', {});

    // ---- Wearables v1.1: activity ↔ workout links.
    // When a wearable reports a workout on the same day as a workout_log,
    // likely strength matches are auto-linked (merged) and the dashboard
    // pill is a review step (confirm or separate). Cardio-style imports
    // default to separated. Linked rows count once for calories blending;
    // `review_acknowledged` gates the review UI for auto-linked rows.
    await dbInstance.execAsync(`
      CREATE TABLE IF NOT EXISTS activity_workout_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supabase_id INTEGER,
        user_id TEXT NOT NULL,
        activity_log_id INTEGER NOT NULL,
        workout_log_id INTEGER NOT NULL,
        link_state TEXT NOT NULL CHECK (link_state IN ('pending','linked','separated')) DEFAULT 'pending',
        review_acknowledged INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced INTEGER DEFAULT 0,
        UNIQUE(user_id, activity_log_id),
        FOREIGN KEY (activity_log_id) REFERENCES activity_logs(id) ON DELETE CASCADE,
        FOREIGN KEY (workout_log_id) REFERENCES workout_logs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_awl_user_state
        ON activity_workout_links(user_id, link_state);
      CREATE INDEX IF NOT EXISTS idx_awl_workout
        ON activity_workout_links(workout_log_id);
    `);
    glowLogger.info('Activity ↔ workout links table initialized', {});

    // Wearables: user review for auto-merged (linked) strength matches.
    try {
      await dbInstance.getFirstAsync(`SELECT review_acknowledged FROM activity_workout_links LIMIT 1`);
    } catch {
      try {
        await dbInstance.execAsync(`
          ALTER TABLE activity_workout_links ADD COLUMN review_acknowledged INTEGER NOT NULL DEFAULT 1;
        `);
        glowLogger.info('Added review_acknowledged column to activity_workout_links', {});
      } catch (e) {
        glowLogger.warn('Failed to add review_acknowledged to activity_workout_links', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Wearables v1.2: how to merge linked kcal. Per linked pair we record
    // whether to use the wearable estimate, the UF strength estimate, or
    // average them. Defaults to 'average' so existing rows keep behaving as
    // before. `pending_review` flags pairs that deviate by more than the
    // configured threshold (20%) so the LinkActivityPill surfaces them.
    try {
      await dbInstance.getFirstAsync(`SELECT calories_resolution FROM activity_workout_links LIMIT 1`);
    } catch {
      try {
        await dbInstance.execAsync(`
          ALTER TABLE activity_workout_links ADD COLUMN calories_resolution TEXT NOT NULL DEFAULT 'average';
        `);
        glowLogger.info('Added calories_resolution column to activity_workout_links', {});
      } catch (e) {
        glowLogger.warn('Failed to add calories_resolution to activity_workout_links', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    try {
      await dbInstance.runAsync(
        `UPDATE activity_workout_links SET review_acknowledged = 0 WHERE link_state = 'pending'`,
      );
    } catch (e) {
      glowLogger.warn('Failed to backfill review_acknowledged for pending links', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Lightweight migration: activity_logs wearable columns.
    // SQLite ALTER TABLE only adds a single column per call; wrap each in try/catch
    // so upgrading users skip columns that already exist.
    const activityLogsWearableColumns: { name: string; ddl: string }[] = [
      { name: 'source', ddl: `ALTER TABLE activity_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'` },
      { name: 'external_id', ddl: `ALTER TABLE activity_logs ADD COLUMN external_id TEXT` },
      { name: 'calories_source', ddl: `ALTER TABLE activity_logs ADD COLUMN calories_source TEXT DEFAULT 'manual'` },
      { name: 'calories_confidence', ddl: `ALTER TABLE activity_logs ADD COLUMN calories_confidence TEXT DEFAULT 'medium'` },
      { name: 'dedupe_fingerprint', ddl: `ALTER TABLE activity_logs ADD COLUMN dedupe_fingerprint TEXT` },
      { name: 'started_at', ddl: `ALTER TABLE activity_logs ADD COLUMN started_at TEXT` },
      { name: 'ended_at', ddl: `ALTER TABLE activity_logs ADD COLUMN ended_at TEXT` },
    ];
    for (const col of activityLogsWearableColumns) {
      try {
        await dbInstance.getFirstAsync(`SELECT ${col.name} FROM activity_logs LIMIT 1;`);
      } catch {
        try {
          await dbInstance.execAsync(col.ddl + ';');
          glowLogger.info(`Added ${col.name} column to activity_logs`, {});
        } catch (e) {
          glowLogger.warn(`Failed to add ${col.name} column to activity_logs`, {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
    // Indexes are idempotent via IF NOT EXISTS.
    await dbInstance.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_activity_logs_fingerprint
        ON activity_logs(user_id, dedupe_fingerprint);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_external
        ON activity_logs(user_id, source, external_id);
    `);

    // Lightweight migration: Check if completed column exists in workout_exercise_logs and add if missing
    try {
      await dbInstance.getFirstAsync(`SELECT completed FROM workout_exercise_logs LIMIT 1;`);
      glowLogger.info('completed column already exists in workout_exercise_logs', {});
    } catch (checkError) {
      try {
        await dbInstance.execAsync(`
          ALTER TABLE workout_exercise_logs ADD COLUMN completed INTEGER DEFAULT 0;
        `);
        glowLogger.info('Added completed column to workout_exercise_logs table', {});
      } catch (alterError) {
        glowLogger.error('Failed to add completed column to workout_exercise_logs', {
          error: alterError instanceof Error ? alterError.message : String(alterError)
        });
      }
    }

    // Lightweight migration: per-set kcal estimate on workout_exercise_logs.
    // Populated at write time by `lib/workout-energy.ts` using bodyweight +
    // RIR / difficulty signals. Read-side `estimateStrengthWorkoutKcal` falls
    // back to the old time-based formula when this column is NULL on a row.
    try {
      await dbInstance.getFirstAsync(`SELECT calories_burned FROM workout_exercise_logs LIMIT 1;`);
      glowLogger.info('calories_burned column already exists in workout_exercise_logs', {});
    } catch (checkError) {
      try {
        await dbInstance.execAsync(`
          ALTER TABLE workout_exercise_logs ADD COLUMN calories_burned INTEGER;
        `);
        glowLogger.info('Added calories_burned column to workout_exercise_logs', {});
      } catch (alterError) {
        glowLogger.error('Failed to add calories_burned column to workout_exercise_logs', {
          error: alterError instanceof Error ? alterError.message : String(alterError),
        });
      }
    }
    await dbInstance.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_workout_exercise_logs_workout
        ON workout_exercise_logs(workout_log_id);
    `);

    // One-shot backfill: recompute calories_burned for every non-deleted
    // row using the session-MET model in `estimateSetKcal`. Inlined here in
    // SQL so a migration can refresh the entire history in a single
    // statement. Per-session bodyweight is read from the latest
    // `body_composition_log` entry on or before the workout's date; if no
    // body comp log exists yet we fall back to 70 kg (the same default as
    // the runtime writer when `getLatestUserWeightKg` returns undefined).
    //
    // Keep this formula in sync with `lib/workout-energy.ts:estimateSetKcal`.
    // SQLite's `LN()` is used for the saturating load factor.
    //
    // Gated on `PRAGMA user_version` so the (correlated, full-table) UPDATE
    // runs once after upgrade and not on every cold start. Bumping
    // SCHEMA_USER_VERSION below re-runs the backfill (e.g. when tuning
    // coefficients).
    const SCHEMA_USER_VERSION = 1;
    try {
      const versionRow = await dbInstance.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version;',
      );
      const currentVersion = Number(versionRow?.user_version ?? 0);
      if (currentVersion < SCHEMA_USER_VERSION) {
        await dbInstance.execAsync(`
        UPDATE workout_exercise_logs AS wel
           SET calories_burned = CAST(ROUND(
             5.0
               * (
                   CASE
                     WHEN wel.rir IS NOT NULL OR wel.difficulty_perception IS NOT NULL THEN
                       MAX(
                         COALESCE(CASE
                           WHEN wel.rir <= 1 THEN 1.2
                           WHEN wel.rir <= 3 THEN 1.0
                           ELSE 0.85
                         END, 0),
                         COALESCE(CASE
                           WHEN wel.difficulty_perception >= 4 THEN 1.2
                           WHEN wel.difficulty_perception >= 2 THEN 1.0
                           ELSE 0.85
                         END, 0)
                       )
                     ELSE 1.0
                   END
                 )
               * (
                   1.0 + 0.3 * LN(
                     1.0 + (
                       CASE
                         WHEN wel.weight_value IS NULL OR wel.weight_value <= 0 THEN 0.0
                         WHEN wel.weight_unit = 'lbs' THEN wel.weight_value * 0.453592
                         ELSE wel.weight_value
                       END
                     ) / COALESCE(
                       (SELECT CASE WHEN bcl.weight_unit = 'lbs'
                                      THEN bcl.weight_value * 0.453592
                                    ELSE bcl.weight_value END
                          FROM body_composition_log bcl
                          INNER JOIN workout_logs wl ON wl.user_id = bcl.user_id
                         WHERE wl.id = wel.workout_log_id
                           AND bcl.log_date <= wl.workout_date
                         ORDER BY bcl.log_date DESC
                         LIMIT 1),
                       70.0
                     )
                   )
                 )
               * COALESCE(
                   (SELECT CASE WHEN bcl.weight_unit = 'lbs'
                                  THEN bcl.weight_value * 0.453592
                                ELSE bcl.weight_value END
                      FROM body_composition_log bcl
                      INNER JOIN workout_logs wl ON wl.user_id = bcl.user_id
                     WHERE wl.id = wel.workout_log_id
                       AND bcl.log_date <= wl.workout_date
                     ORDER BY bcl.log_date DESC
                     LIMIT 1),
                   70.0
                 )
               * (
                   (CAST(MAX(15, MIN(60, COALESCE(wel.reps, 8) * 3)) AS REAL)
                     + CAST(COALESCE(wel.rest_time_seconds, 60) AS REAL))
                   / 60.0
                 )
               / 60.0
           ) AS INTEGER)
         WHERE wel.workout_log_id IN (
           SELECT id FROM workout_logs WHERE status != 'deleted'
         );
        `);
        await dbInstance.execAsync(`PRAGMA user_version = ${SCHEMA_USER_VERSION};`);
        glowLogger.info('Recomputed calories_burned for workout_exercise_logs rows', {
          previous_user_version: currentVersion,
          new_user_version: SCHEMA_USER_VERSION,
        });
      }
    } catch (backfillError) {
      glowLogger.warn('Backfill of workout_exercise_logs.calories_burned failed', {
        error: backfillError instanceof Error ? backfillError.message : String(backfillError),
      });
    }

    // Lightweight migration: Check if food_quantities column exists in meal_logs and add if missing
    try {
      await dbInstance.getFirstAsync(`SELECT food_quantities FROM meal_logs LIMIT 1;`);
      glowLogger.info('food_quantities column already exists in meal_logs', {});
    } catch (checkError) {
      try {
        await dbInstance.execAsync(`
          ALTER TABLE meal_logs ADD COLUMN food_quantities TEXT;
        `);
        glowLogger.info('Added food_quantities column to meal_logs table', {});
      } catch (alterError) {
        glowLogger.error('Failed to add food_quantities column to meal_logs', {
          error: alterError instanceof Error ? alterError.message : String(alterError)
        });
      }
    }

    // Lightweight migration: Check if food_item_macros column exists in meal_logs and add if missing
    try {
      await dbInstance.getFirstAsync(`SELECT food_item_macros FROM meal_logs LIMIT 1;`);
      glowLogger.info('food_item_macros column already exists in meal_logs', {});
    } catch (checkError) {
      try {
        await dbInstance.execAsync(`
          ALTER TABLE meal_logs ADD COLUMN food_item_macros TEXT;
        `);
        glowLogger.info('Added food_item_macros column to meal_logs table', {});
      } catch (alterError) {
        glowLogger.error('Failed to add food_item_macros column to meal_logs', {
          error: alterError instanceof Error ? alterError.message : String(alterError)
        });
      }
    }

    // Migration: dedupe meal_logs and enforce a UNIQUE index on
    // (user_id, supabase_id). Without this constraint, the
    // `syncMealLogsFromSupabase` check-then-insert pattern was racy when
    // the function ran concurrently (app start sync + dashboard mount sync +
    // nutrition chart mount sync), which on slower devices (Android) caused
    // the same Supabase row to be inserted multiple times locally — leading
    // to charts and totals showing 2x/3x values. With the UNIQUE index, the
    // INSERT OR IGNORE in `syncMealLogsFromSupabase` becomes atomically safe.
    try {
      // Drop duplicates first, keeping the row with the lowest id per
      // (user_id, supabase_id). Only applies to rows with a supabase_id —
      // unsynced local rows (supabase_id IS NULL) must all be preserved.
      const dedupeResult = await dbInstance.runAsync(`
        DELETE FROM meal_logs
        WHERE supabase_id IS NOT NULL
          AND id NOT IN (
            SELECT MIN(id) FROM meal_logs
            WHERE supabase_id IS NOT NULL
            GROUP BY user_id, supabase_id
          );
      `);
      if (dedupeResult.changes > 0) {
        glowLogger.info('Removed duplicate meal_logs rows', { removed: dedupeResult.changes });
      }
      // Partial unique index: only enforced on synced rows (supabase_id NOT NULL).
      await dbInstance.execAsync(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_logs_user_supabase
          ON meal_logs(user_id, supabase_id)
          WHERE supabase_id IS NOT NULL;
      `);
      glowLogger.info('Ensured unique index idx_meal_logs_user_supabase', {});
    } catch (dedupeError) {
      glowLogger.warn('Failed to dedupe meal_logs / create unique index', {
        error: dedupeError instanceof Error ? dedupeError.message : String(dedupeError),
      });
    }

    // Migration: dedupe workout_logs / workout_exercise_logs and enforce UNIQUE
    // indexes so concurrent Supabase sync (Progress training tab + charts mount)
    // cannot double-insert on Android.
    try {
      const dedupeWorkouts = await dbInstance.runAsync(`
        DELETE FROM workout_logs
        WHERE supabase_id IS NOT NULL
          AND id NOT IN (
            SELECT MIN(id) FROM workout_logs
            WHERE supabase_id IS NOT NULL
            GROUP BY user_id, supabase_id
          );
      `);
      if (dedupeWorkouts.changes > 0) {
        glowLogger.info('Removed duplicate workout_logs rows', { removed: dedupeWorkouts.changes });
      }
      await dbInstance.execAsync(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_logs_user_supabase
          ON workout_logs(user_id, supabase_id)
          WHERE supabase_id IS NOT NULL;
      `);

      const dedupeExerciseLogs = await dbInstance.runAsync(`
        DELETE FROM workout_exercise_logs
        WHERE supabase_id IS NOT NULL
          AND id NOT IN (
            SELECT MIN(id) FROM workout_exercise_logs
            WHERE supabase_id IS NOT NULL
            GROUP BY supabase_id
          );
      `);
      if (dedupeExerciseLogs.changes > 0) {
        glowLogger.info('Removed duplicate workout_exercise_logs rows', {
          removed: dedupeExerciseLogs.changes,
        });
      }
      await dbInstance.execAsync(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_exercise_logs_supabase
          ON workout_exercise_logs(supabase_id)
          WHERE supabase_id IS NOT NULL;
      `);
      glowLogger.info('Ensured unique indexes for workout sync dedupe', {});
    } catch (workoutDedupeError) {
      glowLogger.warn('Failed to dedupe workout logs / create unique indexes', {
        error: workoutDedupeError instanceof Error ? workoutDedupeError.message : String(workoutDedupeError),
      });
    }

    // Lightweight migration: Check if seen_intro_tutorial column exists and add if missing
    try {
      // Check if the column exists by trying to select it
      await dbInstance.getFirstAsync(`SELECT seen_intro_tutorial FROM logged_in_user LIMIT 1;`);
      glowLogger.info('seen_intro_tutorial column already exists', {});
    } catch (checkError) {
      // Column doesn't exist, add it
      try {
        await dbInstance.execAsync(`
          ALTER TABLE logged_in_user ADD COLUMN seen_intro_tutorial BOOLEAN NOT NULL DEFAULT 0;
        `);
        glowLogger.info('Added seen_intro_tutorial column to existing table', {});
      } catch (alterError) {
        glowLogger.warn('Failed to add seen_intro_tutorial column', {
          error: alterError instanceof Error ? alterError.message : String(alterError)
        });
      }
    }
  } catch (error) {
    glowLogger.error('Error initializing database', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

export const saveLoggedInUser = async (displayName: string): Promise<string> => {
  try {
    // Validate input
    if (!displayName || typeof displayName !== 'string' || displayName.trim() === '') {
      throw new Error('Display name is required and cannot be empty');
    }
    
    const cleanDisplayName = displayName.trim();
    glowLogger.info('Saving user with display name', { display_name: cleanDisplayName });
    
    // Generate a new UUID for the user using expo-crypto
    const userId = Crypto.randomUUID();
    
    const dbInstance = getDatabase();
    // First, deactivate all currently active users
    await dbInstance.execAsync(`
      UPDATE logged_in_user SET active = 0 WHERE active = 1;
    `);
    
    // Insert the new user as active
    await dbInstance.runAsync(`
      INSERT INTO logged_in_user (id, display_name, active) VALUES (?, ?, 1);
    `, [userId, cleanDisplayName]);
    
    glowLogger.info(`User saved to local database`, { 
      display_name: cleanDisplayName, 
      user_id: userId 
    });
    return userId;
  } catch (error) {
    glowLogger.error('Error saving logged in user', {
      error: error instanceof Error ? error.message : String(error),
      input_display_name: displayName,
      type_of_display_name: typeof displayName
    });
    throw error;
  }
};

export const getActiveLoggedInUser = async (): Promise<LocalUser | null> => {
  try {
    const dbInstance = getDatabase();
    const result = await dbInstance.getFirstAsync<{ id: string; display_name: string; seen_intro_tutorial: number; active: number }>(`
      SELECT id, display_name, seen_intro_tutorial, active FROM logged_in_user WHERE active = 1 LIMIT 1;
    `);
    
    if (!result) {
      return null;
    }
    
    return {
      id: result.id,
      display_name: result.display_name,
      seen_intro_tutorial: result.seen_intro_tutorial === 1,
      active: result.active === 1
    };
  } catch (error) {
    console.error('Error getting active logged in user:', error);
    throw error;
  }
};

// Add alias for backwards compatibility
export const getCurrentLoggedInUser = async (): Promise<LocalUser | null> => {
  try {
    const dbInstance = getDatabase();
    const result = await dbInstance.getFirstAsync<{ id: string; display_name: string; seen_intro_tutorial: number; active: number }>(`
      SELECT id, display_name, seen_intro_tutorial, active FROM logged_in_user WHERE active = 1 LIMIT 1;
    `);
    
    if (!result) {
      glowLogger.info('No active users found', {});
      return null;
    }
    
    const localUser: LocalUser = {
      id: result.id,
      display_name: result.display_name,
      seen_intro_tutorial: result.seen_intro_tutorial === 1,
      active: result.active === 1
    };
    
    glowLogger.info('Active user found', {
      id: localUser.id,
      display_name: localUser.display_name,
      seen_intro_tutorial: localUser.seen_intro_tutorial
    });
    
    return localUser;
  } catch (error) {
    glowLogger.error('Error getting current logged in user', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};

export const getAllLoggedInUsers = async (): Promise<LocalUser[]> => {
  try {
    const dbInstance = getDatabase();
    const result = await dbInstance.getAllAsync<{ id: string; display_name: string; active: number; seen_intro_tutorial: number }>(`
      SELECT id, display_name, active, seen_intro_tutorial FROM logged_in_user ORDER BY display_name;
    `);
    
    // Convert to LocalUser objects with proper boolean conversion
    return result.map(user => ({
      id: user.id,
      display_name: user.display_name,
      active: user.active === 1,
      seen_intro_tutorial: user.seen_intro_tutorial === 1
    }));
  } catch (error) {
    glowLogger.error('Error getting all logged in users', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

export const switchActiveUser = async (userId: string): Promise<void> => {
  try {
    const dbInstance = getDatabase();
    // Deactivate all users first
    await dbInstance.execAsync(`
      UPDATE logged_in_user SET active = 0 WHERE active = 1;
    `);
    
    // Activate the selected user
    await dbInstance.runAsync(`
      UPDATE logged_in_user SET active = 1 WHERE id = ?;
    `, [userId]);
    
    glowLogger.info(`Switched active user`, { user_id: userId });
  } catch (error) {
    console.error('Error switching active user:', error);
    throw error;
  }
};

export const deleteLoggedInUser = async (userId: string): Promise<void> => {
  try {
    const dbInstance = getDatabase();
    await dbInstance.runAsync(`
      DELETE FROM logged_in_user WHERE id = ?;
    `, [userId]);
    
    glowLogger.info(`Deleted user`, { user_id: userId });
  } catch (error) {
    glowLogger.error('Error deleting logged in user', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

export const clearAllLoggedInUsers = async (): Promise<void> => {
  try {
    const dbInstance = getDatabase();
    await dbInstance.execAsync(`
      DELETE FROM logged_in_user;
    `);
    glowLogger.info('All logged in users cleared', {});
  } catch (error) {
    glowLogger.error('Error clearing logged in users', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

export const restoreUserProfile = async (userId: string, displayName: string): Promise<string> => {
  try {
    const dbInstance = getDatabase();
    // First, deactivate all existing users
    await dbInstance.execAsync(`
      UPDATE logged_in_user SET active = 0 WHERE active = 1;
    `);
    
    // Insert or update the user as active
    await dbInstance.runAsync(`
      INSERT OR REPLACE INTO logged_in_user (id, display_name, active) VALUES (?, ?, 1);
    `, [userId, displayName]);
    
    // Chat messages are synced via syncAndLoadChatHistory() in ChatScreen,
    // which correctly includes user_id. No need to duplicate here.
    
    glowLogger.info(`User profile restored to local database`, { 
      display_name: displayName, 
      user_id: userId 
    });
    return userId;
  } catch (error) {
    glowLogger.error('Error restoring user profile', {
      error: error instanceof Error ? error.message : String(error),
      input_display_name: displayName,
      input_user_id: userId
    });
    throw error;
  }
};

export const setUserSeenIntroTutorial = async (userId?: string, seen: boolean = true): Promise<void> => {
  try {
    const dbInstance = getDatabase();
    const seenValue = seen ? 1 : 0;

    if (userId) {
      await dbInstance.runAsync(`
        UPDATE logged_in_user SET seen_intro_tutorial = ? WHERE id = ?;
      `, [seenValue, userId]);
    } else {
      await dbInstance.runAsync(`
        UPDATE logged_in_user SET seen_intro_tutorial = ? WHERE active = 1;
      `, [seenValue]);
    }

    glowLogger.info('Updated user intro tutorial status', { 
      user_id: userId ?? 'active_user',
      seen_intro_tutorial: seen
    });
  } catch (error) {
    glowLogger.error('Error setting seen_intro_tutorial', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId ?? 'active_user',
      seen_value: seen
    });
    throw error;
  }
};

/**
 * Purge ALL local data for a user across both SQLite databases and AsyncStorage.
 * Called after server-side account deletion succeeds.
 */
export const clearAllLocalUserData = async (userId: string): Promise<void> => {
  glowLogger.info('Clearing all local user data', { user_id: userId });

  const mainDb = getDatabase();
  const taskDb = SQLite.openDatabaseSync('glow360.db');

  // --- SQLite: longeviq.db ---

  // workout_exercise_logs has no user_id column; it references workout_logs(id).
  // SQLite FK CASCADE isn't enabled (no PRAGMA foreign_keys=ON), so delete explicitly.
  try {
    await mainDb.runAsync(
      `DELETE FROM workout_exercise_logs WHERE workout_log_id IN (SELECT id FROM workout_logs WHERE user_id = ?)`,
      [userId]
    );
  } catch (e) {
    glowLogger.warn('Failed to clear workout_exercise_logs', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const userIdTables = [
    'workout_logs',
    'meal_logs',
    'activity_logs',
    'body_composition_log',
    'user_nutrition_targets',
    'consistency_scores',
    'chat_messages',
    'conversations',
    'daily_metrics',
    'user_provider_connections',
    'nutrition_daily_adjustments',
  ];

  for (const table of userIdTables) {
    try {
      await mainDb.runAsync(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
    } catch (e) {
      glowLogger.warn(`Failed to clear ${table}`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  try {
    await mainDb.runAsync('DELETE FROM logged_in_user WHERE id = ?', [userId]);
  } catch (e) {
    glowLogger.warn('Failed to clear logged_in_user', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // --- SQLite: glow360.db (task completions) ---
  try {
    await taskDb.runAsync('DELETE FROM task_completions WHERE user_id = ?', [userId]);
  } catch (e) {
    glowLogger.warn('Failed to clear task_completions', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // --- AsyncStorage: pending sync queues ---
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const pendingPrefixes = [
      'pendingProfileData',
      'pendingBodyCompositionData',
      'pendingMealLogData',
      'pendingWorkoutLogData',
      'pendingWorkoutExerciseLogData',
    ];
    const keysToRemove = allKeys.filter(key =>
      pendingPrefixes.some(prefix => key.startsWith(prefix))
    );
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
    }
  } catch (e) {
    glowLogger.warn('Failed to clear AsyncStorage pending queues', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // --- AsyncStorage: workout tutorial views ---
  try {
    await AsyncStorage.removeItem('workoutTutorialViews');
  } catch (e) {
    glowLogger.warn('Failed to clear workoutTutorialViews', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // --- AsyncStorage: onboarding + sync status ---
  const { clearLocalOnboardingData, clearCachedAccountStatus, setNeedsProfileSync } = await import('./sync-status');
  await clearLocalOnboardingData();
  await clearCachedAccountStatus();
  await setNeedsProfileSync(false);

  glowLogger.info('All local user data cleared', { user_id: userId });
};