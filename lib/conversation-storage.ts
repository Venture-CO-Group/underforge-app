import mitt from 'mitt';
import { getDatabase } from './db'; // Use shared singleton
import { glowLogger } from './glow-logger';
import { saveChatMessageToSupabase, saveConversationToSupabase } from './supabase_db';
import { getChatMessages as getChatMessagesFromSupabase } from './supabase_db_new';

// Configuration flag for Supabase mirroring
const MIRROR_IN_SUPABASE = true;

const db = getDatabase(); // Use singleton instance
export const chatEvents = mitt(); // Add this line

export interface ConversationEntry {
  id: number;
  userMessage: string;
  coachResponse: string;
  timestamp: string;
  userDisplayName: string;
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'coach' | 'ai_coach' | 'human_coach';
  timestamp: Date;
  userDisplayName: string;
  isFromNotification?: boolean;
  imageUri?: string;
}

// Initialize the database
export async function initializeConversationDB() {
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userMessage TEXT NOT NULL,
        coachResponse TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        userDisplayName TEXT NOT NULL
      );
    `);
    
    // Also create chat messages table with expanded sender types
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        sender TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        userDisplayName TEXT NOT NULL,
        imageUri TEXT
      );
    `);
    
    // Migration: Add imageUri column if it doesn't exist (for existing tables)
    try {
      const tableInfo = await db.getAllAsync(`PRAGMA table_info(chat_messages);`) as any[];
      const hasImageUri = tableInfo.some(col => col.name === 'imageUri');
      
      if (!hasImageUri) {
        await db.execAsync(`ALTER TABLE chat_messages ADD COLUMN imageUri TEXT;`);
        glowLogger.info('Added imageUri column to existing chat_messages table', {});
      }
    } catch (error) {
      glowLogger.warn('Could not check/add imageUri column', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    // CRITICAL MIGRATION: Add user_id column to chat_messages table
    // This fixes a bug where messages were being identified by display name instead of unique user ID
    try {
      const tableInfo = await db.getAllAsync(`PRAGMA table_info(chat_messages);`) as any[];
      const hasUserId = tableInfo.some((col: any) => col.name === 'user_id');
      
      if (!hasUserId) {
        await db.execAsync(`ALTER TABLE chat_messages ADD COLUMN user_id TEXT;`);
        glowLogger.info('Added user_id column to chat_messages table (critical privacy fix)', {});
        
        // Note: Existing messages will have NULL user_id and will need to be migrated
        // or will be re-synced from Supabase which has correct user_id
      }
    } catch (error) {
      glowLogger.warn('Could not check/add user_id column', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    // Migration: Add synced column to chat_messages table for local-first sync tracking
    try {
      const syncInfo = await db.getAllAsync(`PRAGMA table_info(chat_messages);`) as any[];
      const hasSynced = syncInfo.some((col: any) => col.name === 'synced');
      
      if (!hasSynced) {
        await db.execAsync(`ALTER TABLE chat_messages ADD COLUMN synced INTEGER DEFAULT 1;`);
        glowLogger.info('Added synced column to chat_messages table for reliable sync tracking', {});
      }
    } catch (error) {
      glowLogger.warn('Could not check/add synced column to chat_messages', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Migration: Add user_id to conversations table as well
    try {
      const tableInfo = await db.getAllAsync(`PRAGMA table_info(conversations);`) as any[];
      const hasUserId = tableInfo.some((col: any) => col.name === 'user_id');
      
      if (!hasUserId) {
        await db.execAsync(`ALTER TABLE conversations ADD COLUMN user_id TEXT;`);
        glowLogger.info('Added user_id column to conversations table', {});
      }
    } catch (error) {
      glowLogger.warn('Could not check/add user_id column to conversations', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    glowLogger.info('Conversation database initialized successfully', {});
  } catch (error) {
    glowLogger.error('Error initializing conversation database', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

// Get recent conversations for a user by user_id (UUID)
export async function getRecentConversations(userId: string, limit: number = 10) {
  try {
    const result = await db.getAllAsync(
      'SELECT * FROM conversations WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?',
      [userId, limit]
    );
    return result;
  } catch (error) {
    glowLogger.error('Error getting recent conversations', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    throw error;
  }
}

// Save a conversation
export async function saveConversation(conversation: {
  userMessage: string;
  coachResponse: string;
  timestamp: string;
  userId: string; // CRITICAL: Use user_id for unique identification
  userDisplayName: string;
}) {
  try {
    const result = await db.runAsync(
      'INSERT INTO conversations (userMessage, coachResponse, timestamp, user_id, userDisplayName) VALUES (?, ?, ?, ?, ?)',
      [conversation.userMessage, conversation.coachResponse, conversation.timestamp, conversation.userId, conversation.userDisplayName]
    );
    glowLogger.info('Conversation saved successfully', { user_id: conversation.userId });

    // Mirror to Supabase if enabled
    if (MIRROR_IN_SUPABASE) {
      try {
        await saveConversationToSupabase({
          sqlite_id: result.lastInsertRowId as number,
          user_id: conversation.userId,
          user_message: conversation.userMessage,
          coach_response: conversation.coachResponse,
          timestamp: conversation.timestamp,
          user_display_name: conversation.userDisplayName
        });
      } catch (supabaseError) {
        glowLogger.error('Failed to mirror conversation to Supabase', {
          error: supabaseError instanceof Error ? supabaseError.message : String(supabaseError)
        });
      }
    }
  } catch (error) {
    glowLogger.error('Error saving conversation', {
      error: error instanceof Error ? error.message : String(error),
      user_id: conversation.userId
    });
    throw error;
  }
}

// Get chat messages for a user
// DEPRECATED: Use loadChatHistory(userId) instead
// This function is kept for backwards compatibility but should not be used for new code
export async function getChatMessages(userId: string, limit: number = 50) {
  try {
    const result = await db.getAllAsync(
      'SELECT * FROM chat_messages WHERE user_id = ? ORDER BY timestamp ASC LIMIT ?',
      [userId, limit]
    );
    return result.map((row: any) => ({
      ...row,
      timestamp: new Date(row.timestamp)
    }));
  } catch (error) {
    glowLogger.error('Error getting chat messages', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    throw error;
  }
}

// Save a chat message
export async function saveChatMessage(message: {
  id: string;
  text: string;
  sender: 'user' | 'coach' | 'ai_coach' | 'human_coach';
  timestamp: Date;
  userId: string; // CRITICAL: Use user_id (UUID) for unique identification, NOT display name
  userDisplayName: string;
  isFromNotification?: boolean;
  imageUri?: string;
}) {
  try {
    // Save locally first with synced = 0 (will update to 1 after successful Supabase sync)
    await db.runAsync(
      'INSERT OR REPLACE INTO chat_messages (id, text, sender, timestamp, user_id, userDisplayName, imageUri, synced) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [message.id, message.text, message.sender, message.timestamp.toISOString(), message.userId, message.userDisplayName, message.imageUri || null]
    );
    glowLogger.info(
      `Chat message (${message.sender}) saved`,
      {
        user_id: message.userId,
        sender: message.sender,
        message_text: message.text,
      }
    );
    chatEvents.emit('newMessage', { userId: message.userId, userDisplayName: message.userDisplayName }); // Emit event after save

    // Mirror to Supabase if enabled
    if (MIRROR_IN_SUPABASE) {
      try {
        await saveChatMessageToSupabase({
          id: message.id,
          user_id: message.userId,
          text: message.text,
          sender: message.sender,
          timestamp: message.timestamp.toISOString(),
          user_display_name: message.userDisplayName,
          is_from_notification: message.isFromNotification || false
        });
        // Mark as synced in local DB
        await db.runAsync('UPDATE chat_messages SET synced = 1 WHERE id = ?', [message.id]);
      } catch (supabaseError) {
        glowLogger.error('Failed to mirror chat message to Supabase (will retry later)', {
          error: (supabaseError as any)?.message || (typeof supabaseError === 'object' ? JSON.stringify(supabaseError) : String(supabaseError)),
          message_id: message.id,
        });
        // synced stays 0 - will be picked up by retryPendingChatMessages
      }
    } else {
      // No Supabase mirroring - mark as synced since there's nothing to sync
      await db.runAsync('UPDATE chat_messages SET synced = 1 WHERE id = ?', [message.id]);
    }
  } catch (error) {
    glowLogger.error('Error saving chat message', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

// Load chat history for a user by user_id (UUID)
export async function loadChatHistory(userId: string): Promise<ChatMessage[]> {
  try {
    const result = await db.getAllAsync(
      'SELECT * FROM chat_messages WHERE user_id = ? ORDER BY timestamp ASC',
      [userId]
    ) as any[];
    
    return result.map(row => ({
      id: row.id,
      text: row.text,
      sender: row.sender as 'user' | 'coach' | 'ai_coach' | 'human_coach',
      timestamp: new Date(row.timestamp),
      userDisplayName: row.userDisplayName,
      imageUri: row.imageUri || undefined
    }));
  } catch (error) {
    glowLogger.error('Error loading chat history', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return [];
  }
}

// Load chat history with pagination (most recent messages first)
// Returns messages in chronological order (oldest to newest) for display
export async function loadChatHistoryPaginated(
  userId: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ messages: ChatMessage[]; hasMore: boolean; totalCount: number }> {
  try {
    // Get total count first
    const countResult = await db.getFirstAsync(
      'SELECT COUNT(*) as count FROM chat_messages WHERE user_id = ?',
      [userId]
    ) as { count: number };
    const totalCount = countResult?.count || 0;
    
    // Load messages in DESC order (most recent first), then reverse for display
    const result = await db.getAllAsync(
      'SELECT * FROM chat_messages WHERE user_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?',
      [userId, limit, offset]
    ) as any[];
    
    // Reverse to get chronological order for display (oldest first)
    const messages = result.reverse().map(row => ({
      id: row.id,
      text: row.text,
      sender: row.sender as 'user' | 'coach' | 'ai_coach' | 'human_coach',
      timestamp: new Date(row.timestamp),
      userDisplayName: row.userDisplayName,
      imageUri: row.imageUri || undefined
    }));
    
    const hasMore = offset + result.length < totalCount;
    
    glowLogger.info('Loaded paginated chat history', {
      user_id: userId,
      loaded: messages.length,
      offset,
      hasMore,
      totalCount
    });
    
    return { messages, hasMore, totalCount };
  } catch (error) {
    glowLogger.error('Error loading paginated chat history', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return { messages: [], hasMore: false, totalCount: 0 };
  }
}

// Clear chat history for a user by user_id (UUID)
export async function clearChatHistory(userId: string) {
  try {
    await db.runAsync('DELETE FROM chat_messages WHERE user_id = ?', [userId]);
    glowLogger.info('Chat history cleared successfully', { user_id: userId });
  } catch (error) {
    glowLogger.error('Error clearing chat history', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    throw error;
  }
}

// Clear all chat history (for app reset)
export async function clearAllChatHistory() {
  try {
    await db.runAsync('DELETE FROM chat_messages');
    glowLogger.info('All chat history cleared successfully', {});
  } catch (error) {
    glowLogger.error('Error clearing all chat history', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

// Add conversation entry
export async function addConversationEntry(
  userMessage: string,
  coachResponse: string,
  userId: string, // CRITICAL: Use user_id for unique identification
  userDisplayName: string
): Promise<void> {
  try {
    const timestamp = new Date().toISOString();
    const result = await db.runAsync(
      'INSERT INTO conversations (userMessage, coachResponse, timestamp, user_id, userDisplayName) VALUES (?, ?, ?, ?, ?)',
      [userMessage, coachResponse, timestamp, userId, userDisplayName]
    );
    glowLogger.info('Conversation entry added successfully', { user_id: userId });

    // Mirror to Supabase if enabled
    if (MIRROR_IN_SUPABASE) {
      try {
        await saveConversationToSupabase({
          sqlite_id: result.lastInsertRowId as number,
          user_id: userId,
          user_message: userMessage,
          coach_response: coachResponse,
          timestamp: timestamp,
          user_display_name: userDisplayName
        });
      } catch (supabaseError) {
        glowLogger.error('Failed to mirror conversation entry to Supabase', {
          error: supabaseError instanceof Error ? supabaseError.message : String(supabaseError)
        });
      }
    }
  } catch (error) {
    glowLogger.error('Error adding conversation entry', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    throw error;
  }
}

// Get all conversations for a user by user_id (UUID)
export async function getConversations(userId: string): Promise<ConversationEntry[]> {
  try {
    const result = await db.getAllAsync(
      'SELECT * FROM conversations WHERE user_id = ? ORDER BY timestamp ASC',
      [userId]
    ) as any[];
    
    return result.map(row => ({
      id: row.id,
      userMessage: row.userMessage,
      coachResponse: row.coachResponse,
      timestamp: row.timestamp,
      userDisplayName: row.userDisplayName
    }));
  } catch (error) {
    glowLogger.error('Error getting conversations', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId
    });
    return [];
  }
}

// Clear conversation history for a user (backward compatibility)
// Clear conversation history for a user by user_id (UUID)
export async function clearConversationHistory(userId?: string): Promise<void> {
  try {
    if (userId) {
      await db.runAsync('DELETE FROM conversations WHERE user_id = ?', [userId]);
      glowLogger.info(`Conversation history cleared for user`, { user_id: userId });
    } else {
      await db.runAsync('DELETE FROM conversations');
      glowLogger.info('All conversation history cleared', {});
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('no such table')) {
      glowLogger.info('Conversation table does not exist yet, nothing to clear', { user_id: userId });
      return;
    }
    glowLogger.error('Error clearing conversation history', {
      error: errorMsg,
      user_id: userId
    });
    throw error;
  }
}

// Save a chat message to local SQLite only (no Supabase mirror - used for syncing from Supabase)
async function saveChatMessageLocalOnly(message: {
  id: string;
  text: string;
  sender: 'user' | 'coach' | 'ai_coach' | 'human_coach';
  timestamp: Date;
  userId: string; // CRITICAL: Use user_id for unique identification
  userDisplayName: string;
  isFromNotification?: boolean;
  imageUri?: string;
}): Promise<void> {
  try {
    await db.runAsync(
      'INSERT OR IGNORE INTO chat_messages (id, text, sender, timestamp, user_id, userDisplayName, imageUri, synced) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [message.id, message.text, message.sender, message.timestamp.toISOString(), message.userId, message.userDisplayName, message.imageUri || null]
    );
  } catch (error) {
    glowLogger.error('Error saving chat message locally', {
      error: error instanceof Error ? error.message : String(error),
      message_id: message.id,
      user_id: message.userId
    });
    // Don't throw - we don't want sync failures to break the app
  }
}

// Result type for sync operation
export interface ChatSyncResult {
  messages: ChatMessage[];
  syncStatus: 'success' | 'failed' | 'offline';
  newMessageCount: number;
}

/**
 * Sync chat messages from Supabase to local SQLite.
 * This is a hybrid approach:
 * 1. Load local messages first (fast, offline-capable)
 * 2. Fetch remote messages from Supabase
 * 3. Find messages in remote that don't exist locally (by ID)
 * 4. Save those to local SQLite
 * 5. Return merged, sorted list with sync status
 * 
 * CRITICAL: Uses user_id (UUID) for all operations to ensure message privacy
 * 
 * @param userId - The Supabase user_id (UUID) - REQUIRED for unique user identification
 * @returns Object with messages, sync status, and new message count
 */
export async function syncAndLoadChatHistory(
  userId: string
): Promise<ChatSyncResult> {
  // Step 1: Load local messages first (fast, works offline) - using user_id
  const localMessages = await loadChatHistory(userId);
  const localMessageIds = new Set(localMessages.map(msg => msg.id));
  
  glowLogger.info('Loaded local chat messages', {
    count: localMessages.length,
    user_id: userId
  });

  // Step 2: Try to fetch remote messages from Supabase
  let newMessagesFromRemote: ChatMessage[] = [];
  try {
    const remoteMessages = await getChatMessagesFromSupabase(userId);
    
    glowLogger.info('Fetched remote chat messages from Supabase', {
      count: remoteMessages.length,
      user_id: userId
    });

    // Step 3: Find messages in remote that don't exist locally (by ID)
    const newRemoteMessages = remoteMessages.filter(msg => !localMessageIds.has(msg.id));
    
    if (newRemoteMessages.length > 0) {
      glowLogger.info('Found new messages from Supabase not in local', {
        new_count: newRemoteMessages.length,
        user_id: userId
      });

      // Step 4: Save new messages to local SQLite (without re-mirroring to Supabase)
      for (const remoteMsg of newRemoteMessages) {
        await saveChatMessageLocalOnly({
          id: remoteMsg.id,
          text: remoteMsg.text,
          sender: remoteMsg.sender as 'user' | 'coach' | 'ai_coach' | 'human_coach',
          timestamp: new Date(remoteMsg.timestamp),
          userId: remoteMsg.user_id, // Use user_id from remote message
          userDisplayName: remoteMsg.user_display_name,
          isFromNotification: remoteMsg.is_from_notification
        });

        // Add to our list of new messages
        newMessagesFromRemote.push({
          id: remoteMsg.id,
          text: remoteMsg.text,
          sender: remoteMsg.sender as 'user' | 'coach' | 'ai_coach' | 'human_coach',
          timestamp: new Date(remoteMsg.timestamp),
          userDisplayName: remoteMsg.user_display_name,
          isFromNotification: remoteMsg.is_from_notification
        });
      }

      glowLogger.info('Synced new messages to local SQLite', {
        synced_count: newMessagesFromRemote.length,
        user_id: userId
      });
    } else {
      glowLogger.info('No new messages to sync from Supabase', {
        user_id: userId
      });
    }
  } catch (error) {
    // If Supabase fetch fails, just use local messages (offline-first)
    glowLogger.warn('Failed to sync messages from Supabase, using local cache', {
      error: error instanceof Error ? error.message : String(error),
      user_id: userId,
      local_message_count: localMessages.length
    });
    // Return local messages with failed status
    return {
      messages: localMessages,
      syncStatus: 'failed',
      newMessageCount: 0
    };
  }

  // Step 5: Merge and sort all messages by timestamp
  const allMessages = [...localMessages, ...newMessagesFromRemote];
  allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  glowLogger.info('Chat history sync complete', {
    total_messages: allMessages.length,
    local_count: localMessages.length,
    new_from_remote: newMessagesFromRemote.length,
    user_id: userId
  });

  return {
    messages: allMessages,
    syncStatus: 'success',
    newMessageCount: newMessagesFromRemote.length
  };
}

/**
 * Retry syncing chat messages that failed to save to Supabase.
 * Picks up all local messages with synced = 0 and attempts to push them.
 */
export async function retryPendingChatMessages(): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> {
  try {
    // Ensure synced column exists (migration may not have run yet).
    // First confirm the chat_messages table itself exists — this function can
    // be invoked from screens (e.g. CoachDashboard) that don't initialize the
    // conversation DB, in which case there's simply nothing to retry.
    try {
      const existingTable = await db.getFirstAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages';`
      );
      if (!existingTable) {
        return { total: 0, succeeded: 0, failed: 0 };
      }

      const tableInfo = await db.getAllAsync(`PRAGMA table_info(chat_messages);`) as any[];
      const hasSynced = tableInfo.some((col: any) => col.name === 'synced');
      if (!hasSynced) {
        await db.execAsync(`ALTER TABLE chat_messages ADD COLUMN synced INTEGER DEFAULT 1;`);
        glowLogger.info('Added synced column to chat_messages during retry', {});
      }
    } catch (migrationErr) {
      glowLogger.warn('Could not ensure synced column exists', {
        error: migrationErr instanceof Error ? migrationErr.message : String(migrationErr),
      });
      return { total: 0, succeeded: 0, failed: 0 };
    }

    const unsyncedMessages = await db.getAllAsync<{
      id: string;
      text: string;
      sender: string;
      timestamp: string;
      user_id: string;
      userDisplayName: string;
      imageUri: string | null;
    }>(
      'SELECT id, text, sender, timestamp, user_id, userDisplayName, imageUri FROM chat_messages WHERE synced = 0 AND user_id IS NOT NULL'
    );

    if (unsyncedMessages.length === 0) {
      return { total: 0, succeeded: 0, failed: 0 };
    }

    glowLogger.info('Retrying pending chat message syncs', { count: unsyncedMessages.length });

    let succeeded = 0;
    let failed = 0;

    for (const msg of unsyncedMessages) {
      try {
        await saveChatMessageToSupabase({
          id: msg.id,
          user_id: msg.user_id,
          text: msg.text,
          sender: msg.sender as 'user' | 'coach' | 'ai_coach' | 'human_coach',
          timestamp: msg.timestamp,
          user_display_name: msg.userDisplayName,
          is_from_notification: false,
        });
        await db.runAsync('UPDATE chat_messages SET synced = 1 WHERE id = ?', [msg.id]);
        succeeded++;
      } catch (error) {
        failed++;
        glowLogger.warn('Failed to retry chat message sync', {
          message_id: msg.id,
          error: (error as any)?.message || (typeof error === 'object' ? JSON.stringify(error) : String(error)),
        });
      }
    }

    glowLogger.info('Completed pending chat message sync retry', {
      total: unsyncedMessages.length,
      succeeded,
      failed,
    });

    return { total: unsyncedMessages.length, succeeded, failed };
  } catch (error) {
    glowLogger.error('Error in retryPendingChatMessages', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { total: 0, succeeded: 0, failed: 0 };
  }
}

