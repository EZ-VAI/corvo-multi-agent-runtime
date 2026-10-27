
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.brand_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  brand_name TEXT NOT NULL DEFAULT '',
  brand_url TEXT DEFAULT '',
  origin_story TEXT DEFAULT '',
  core_values TEXT DEFAULT '',
  target_audience TEXT DEFAULT '',
  past_ad_style TEXT DEFAULT '',
  free_text TEXT DEFAULT '',
  scraped_summary TEXT DEFAULT '',
  scraped_raw JSONB DEFAULT '{}'::jsonb,
  color_palette TEXT DEFAULT '',
  typography TEXT DEFAULT '',
  vibe TEXT DEFAULT '',
  logo_url TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.brand_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own brand profile"
  ON public.brand_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own brand profile"
  ON public.brand_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own brand profile"
  ON public.brand_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own brand profile"
  ON public.brand_profiles FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER update_brand_profiles_updated_at
  BEFORE UPDATE ON public.brand_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
