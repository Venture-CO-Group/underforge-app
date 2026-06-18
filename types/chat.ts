export interface ChatMessage {
  id: string;
  user_id: string;
  text: string;
  sender: 'user' | 'coach' | 'ai_coach' | 'human_coach';
  timestamp: string;
  user_display_name: string;
  is_from_notification: boolean;
  created_at?: string; // Optional since it has a default value
}
