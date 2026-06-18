import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import mitt from 'mitt';
import { glowLogger } from './glow-logger';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let supabase: any;

// Create event emitter for onboarding data changes
export const onboardingEvents = mitt();

// Conversation storage interfaces
export interface SupabaseConversationEntry {
  sqlite_id: number;
  user_id?: string;
  user_message: string;
  coach_response: string;
  timestamp: string;
  user_display_name: string;
}

export interface SupabaseChatMessage {
  id: string;
  user_id?: string;
  text: string;
  sender: 'user' | 'coach';
  timestamp: string;
  user_display_name: string;
  is_from_notification?: boolean;
}

// Initialize Supabase client
export const initializeSupabase = async (): Promise<void> => {
  try {
    // Debug logging to see what env vars are loaded
    glowLogger.info('Environment check', {
      supabase_url_exists: !!SUPABASE_URL,
      supabase_anon_key_exists: !!SUPABASE_ANON_KEY,
      supabase_url_preview: SUPABASE_URL ? `${SUPABASE_URL.substring(0, 20)}...` : 'undefined'
    });
    
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      glowLogger.info('Supabase credentials not found, skipping Supabase initialization', {
        env_vars_help: 'Make sure your .env file has EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY'
      });
      return;
    }

    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false, // Not needed for React Native
      },
    });
    glowLogger.info('Supabase initialized successfully with persistent session storage', {});
  } catch (error) {
    glowLogger.error('Error initializing Supabase', {
      error: error instanceof Error ? error.message : String(error)
    });
    // Don't throw error to avoid breaking app if Supabase is unavailable
  }
};


// Save a conversation to Supabase
export async function saveConversationToSupabase(conversation: SupabaseConversationEntry): Promise<void> {
  try {
    const insertData: any = {
      sqlite_id: conversation.sqlite_id,
      user_message: conversation.user_message,
      coach_response: conversation.coach_response,
      timestamp: conversation.timestamp,
      user_display_name: conversation.user_display_name
    };

    // Add user_id if provided
    if (conversation.user_id) {
      insertData.user_id = conversation.user_id;
    }

    const { error } = await supabase
      .from('conversations')
      .insert([insertData]);

    if (error) {
      throw error;
    }

    glowLogger.info('Conversation mirrored to Supabase successfully', {
      sqlite_id: conversation.sqlite_id,
      user_display_name: conversation.user_display_name,
      user_id: conversation.user_id
    });
  } catch (error) {
    glowLogger.error('Failed to mirror conversation to Supabase', {
      error: error instanceof Error ? error.message : String(error),
      sqlite_id: conversation.sqlite_id,
      user_display_name: conversation.user_display_name
    });
    throw error;
  }
}

// Save a chat message to Supabase
export async function saveChatMessageToSupabase(message: SupabaseChatMessage): Promise<void> {
  try {
    const insertData: any = {
      id: message.id,
      text: message.text,
      sender: message.sender,
      timestamp: message.timestamp,
      user_display_name: message.user_display_name,
      is_from_notification: message.is_from_notification || false
    };

    if (message.user_id) {
      insertData.user_id = message.user_id;
    }

    const { error } = await supabase
      .from('chat_messages')
      .upsert([insertData], { onConflict: 'id' });

    if (error) {
      throw error;
    }

    glowLogger.info('Chat message mirrored to Supabase successfully', {
      message_id: message.id,
      sender: message.sender,
      user_display_name: message.user_display_name,
      user_id: message.user_id,
      is_from_notification: message.is_from_notification
    });
  } catch (error: any) {
    const errMsg = error?.message || error?.details || (typeof error === 'object' ? JSON.stringify(error) : String(error));
    glowLogger.error('Failed to mirror chat message to Supabase', {
      error: errMsg,
      message_id: message.id,
      sender: message.sender,
      user_display_name: message.user_display_name
    });
    throw error;
  }
}