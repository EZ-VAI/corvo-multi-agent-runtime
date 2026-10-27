
CREATE TABLE public.ad_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Untitled Draft',
  step text NOT NULL DEFAULT 'intake',
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  thumbnail_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own drafts" ON public.ad_drafts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert own drafts" ON public.ad_drafts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own drafts" ON public.ad_drafts FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own drafts" ON public.ad_drafts FOR DELETE TO authenticated USING (user_id = auth.uid());
