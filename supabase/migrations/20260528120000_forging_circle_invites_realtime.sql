-- Enable realtime for invite rows so invitees see pending invites without reopening the app.
ALTER TABLE public.forging_circle_invites REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.forging_circle_invites;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
