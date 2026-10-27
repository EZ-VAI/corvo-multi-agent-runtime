CREATE TABLE public.generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  product_description text,
  strategy_summary text,
  content_title text,
  content_description text,
  veo_prompt text,
  platform text,
  video_uri text,
  video_mime_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own generations"
  ON public.generations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own generations"
  ON public.generations FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());