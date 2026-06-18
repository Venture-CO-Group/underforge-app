-- Optional progress photos on weekly body-composition entries.
-- One set of photos per ISO week (front/side/back); public URLs in the
-- 'body-photos' bucket. Front is the angle rendered on the weight chart.
ALTER TABLE public.body_composition_log
  ADD COLUMN IF NOT EXISTS photo_front_url text;
ALTER TABLE public.body_composition_log
  ADD COLUMN IF NOT EXISTS photo_side_url text;
ALTER TABLE public.body_composition_log
  ADD COLUMN IF NOT EXISTS photo_back_url text;

-- Public-read bucket (see migration header rationale in schema.sql): keeps the
-- coach dashboard's read path simple and matches the app's trusted-client RLS.
INSERT INTO storage.buckets (id, name, public)
     VALUES ('body-photos', 'body-photos', true)
     ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Body photos are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Body photos can be uploaded by anyone" ON storage.objects;
DROP POLICY IF EXISTS "Body photos can be updated by anyone" ON storage.objects;
DROP POLICY IF EXISTS "Body photos can be deleted by anyone" ON storage.objects;

CREATE POLICY "Body photos are publicly readable"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'body-photos');

CREATE POLICY "Body photos can be uploaded by anyone"
  ON storage.objects FOR INSERT
  TO public
  WITH CHECK (bucket_id = 'body-photos');

CREATE POLICY "Body photos can be updated by anyone"
  ON storage.objects FOR UPDATE
  TO public
  USING (bucket_id = 'body-photos')
  WITH CHECK (bucket_id = 'body-photos');

CREATE POLICY "Body photos can be deleted by anyone"
  ON storage.objects FOR DELETE
  TO public
  USING (bucket_id = 'body-photos');
