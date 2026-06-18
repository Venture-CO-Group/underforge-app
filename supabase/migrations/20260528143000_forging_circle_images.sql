-- Optional cover photo per forging circle (public URL in Supabase Storage).
ALTER TABLE public.forging_circles
  ADD COLUMN IF NOT EXISTS image_url text;

INSERT INTO storage.buckets (id, name, public)
     VALUES ('circle-images', 'circle-images', true)
     ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Circle images are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Circle images can be uploaded by anyone" ON storage.objects;
DROP POLICY IF EXISTS "Circle images can be updated by anyone" ON storage.objects;
DROP POLICY IF EXISTS "Circle images can be deleted by anyone" ON storage.objects;

CREATE POLICY "Circle images are publicly readable"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'circle-images');

CREATE POLICY "Circle images can be uploaded by anyone"
  ON storage.objects FOR INSERT
  TO public
  WITH CHECK (bucket_id = 'circle-images');

CREATE POLICY "Circle images can be updated by anyone"
  ON storage.objects FOR UPDATE
  TO public
  USING (bucket_id = 'circle-images')
  WITH CHECK (bucket_id = 'circle-images');

CREATE POLICY "Circle images can be deleted by anyone"
  ON storage.objects FOR DELETE
  TO public
  USING (bucket_id = 'circle-images');
