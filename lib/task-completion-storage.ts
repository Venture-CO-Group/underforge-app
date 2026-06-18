import * as SQLite from 'expo-sqlite';
import { GlowLogger } from './glow-logger';

const glowLogger = new GlowLogger();
const db = SQLite.openDatabaseSync('glow360.db');

export interface TaskCompletion {
  step_id: string;
  completed: boolean;
  completion_date: string; // YYYY-MM-DD format
  user_id: string;
}

/**
 * Initialize the task completion table
 */
export const initializeTaskCompletionDB = async (): Promise<void> => {
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS task_completions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        step_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        completed BOOLEAN NOT NULL DEFAULT 0,
        completion_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(step_id, user_id, completion_date)
      );
    `);
    
    glowLogger.info('Task completion database initialized successfully', {});
  } catch (error) {
    glowLogger.error('Error initializing task completion database', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

/**
 * Get today's date in YYYY-MM-DD format
 */
const getTodayDate = (): string => {
  const today = new Date();
  return today.toISOString().split('T')[0];
};

/**
 * Save or update task completion status for today
 */
export const saveTaskCompletion = async (
  stepId: string,
  userId: string,
  completed: boolean
): Promise<void> => {
  try {
    const today = getTodayDate();
    
    await db.runAsync(
      `INSERT OR REPLACE INTO task_completions (step_id, user_id, completed, completion_date)
       VALUES (?, ?, ?, ?)`,
      [stepId, userId, completed ? 1 : 0, today]
    );
    
    glowLogger.info('Task completion saved', {
      step_id: stepId,
      user_id: userId,
      completed,
      date: today
    });
  } catch (error) {
    glowLogger.error('Error saving task completion', {
      error: error instanceof Error ? error.message : String(error),
      step_id: stepId,
      user_id: userId
    });
    throw error;
  }
};

/**
 * Get all task completions for today for a specific user
 */
export const getTodayTaskCompletions = async (userId: string): Promise<{ [stepId: string]: boolean }> => {
  try {
    const today = getTodayDate();
    
    const rows = await db.getAllAsync<{ step_id: string; completed: number }>(
      `SELECT step_id, completed FROM task_completions 
       WHERE user_id = ? AND completion_date = ?`,
      [userId, today]
    );
    
    const completions: { [stepId: string]: boolean } = {};
    rows.forEach(row => {
      completions[row.step_id] = row.completed === 1;
    });
    
    glowLogger.info('Retrieved today task completions', {
      user_id: userId,
      date: today,
      count: rows.length
    });
    
    return completions;
  } catch (error) {
    glowLogger.error('Error getting today task completions', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return {};
  }
};

/**
 * Get compliance data for the last N days
 * Returns an array of { date, completionRate } for each day
 */
export const getComplianceHistory = async (
  userId: string,
  totalTasksPerDay: number,
  days: number = 14
): Promise<Array<{ date: string; completionRate: number }>> => {
  try {
    const result: Array<{ date: string; completionRate: number }> = [];
    const today = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const rows = await db.getAllAsync<{ completed: number }>(
        `SELECT completed FROM task_completions 
         WHERE user_id = ? AND completion_date = ?`,
        [userId, dateStr]
      );
      
      const completedCount = rows.filter(row => row.completed === 1).length;
      const completionRate = totalTasksPerDay > 0 ? (completedCount / totalTasksPerDay) * 100 : 0;
      
      result.push({
        date: dateStr,
        completionRate: Math.round(completionRate)
      });
    }
    
    glowLogger.info('Retrieved compliance history', {
      user_id: userId,
      days,
      data_points: result.length
    });
    
    return result;
  } catch (error) {
    glowLogger.error('Error getting compliance history', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return [];
  }
};

/**
 * Clear old task completions (older than 30 days)
 */
export const clearOldTaskCompletions = async (): Promise<void> => {
  try {
    const Yesterday = new Date();
    Yesterday.setDate(Yesterday.getDate() - 1);
    const cutoffDate = Yesterday.toISOString().split('T')[0];
    
    await db.runAsync(
      `DELETE FROM task_completions WHERE completion_date < ?`,
      [cutoffDate]
    );
    
    glowLogger.info('Cleared old task completions', { cutoff_date: cutoffDate });
  } catch (error) {
    glowLogger.error('Error clearing old task completions', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

