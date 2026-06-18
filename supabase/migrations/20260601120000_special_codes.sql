-- special_codes: pre-auth onboarding entry codes (coach, event, promo).
-- Codes are stored lowercase; app normalizes input before lookup.

CREATE TABLE IF NOT EXISTS public.special_codes (
  id BIGSERIAL PRIMARY KEY,
  code text NOT NULL,
  code_type text NOT NULL CHECK (code_type IN ('coach', 'event', 'promo')),
  coach_id bigint REFERENCES public.coaches(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT special_codes_code_lowercase CHECK (code = lower(trim(code))),
  CONSTRAINT special_codes_coach_required CHECK (
    (code_type = 'coach' AND coach_id IS NOT NULL)
    OR (code_type <> 'coach')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_special_codes_code
  ON public.special_codes (code);

CREATE INDEX IF NOT EXISTS idx_special_codes_active
  ON public.special_codes (is_active, code_type)
  WHERE is_active = true;

ALTER TABLE public.special_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Special codes can be public read." ON public.special_codes;
CREATE POLICY "Special codes can be public read."
  ON public.special_codes FOR SELECT
  USING (
    is_active = true
    AND (expires_at IS NULL OR expires_at > now())
  );

-- Test coach code for Jesús Gutiérrez (coach id 6).
INSERT INTO public.special_codes (code, code_type, coach_id, metadata)
VALUES ('jesus2026', 'coach', 6, '{}'::jsonb)
ON CONFLICT (code) DO NOTHING;
