-- Add onboarding fields to brand_profiles
ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS product_type text DEFAULT '',
  ADD COLUMN IF NOT EXISTS mood text DEFAULT '',
  ADD COLUMN IF NOT EXISTS texture text DEFAULT '',
  ADD COLUMN IF NOT EXISTS editing_style text DEFAULT '',
  ADD COLUMN IF NOT EXISTS user_persona text DEFAULT '',
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_keyframes text[] DEFAULT '{}';

-- Storage bucket for onboarding keyframes (public so any visitor can preview at low res)
INSERT INTO storage.buckets (id, name, public)
VALUES ('onboarding-keyframes', 'onboarding-keyframes', true)
ON CONFLICT (id) DO NOTHING;

-- Public read for onboarding-keyframes bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public read onboarding-keyframes'
  ) THEN
    CREATE POLICY "Public read onboarding-keyframes"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'onboarding-keyframes');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Service role can write onboarding-keyframes'
  ) THEN
    CREATE POLICY "Service role can write onboarding-keyframes"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'onboarding-keyframes');
  END IF;
END $$;