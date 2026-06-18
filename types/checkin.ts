export interface Checkin {
  id: number;
  user_id: string;
  step_id: string;
  step_title: string;
  checked_in_at: string; // ISO date string (timestamptz)
  checkin_due_at: string; // ISO date string (timestamptz)
}