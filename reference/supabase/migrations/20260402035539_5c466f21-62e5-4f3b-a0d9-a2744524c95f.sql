
CREATE TABLE public.style_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'Untitled Style',
  thumbnail_url TEXT DEFAULT '',
  visual_bible JSONB NOT NULL DEFAULT '{}'::jsonb,
  character_sheet JSONB DEFAULT '{}'::jsonb,
  source_product TEXT DEFAULT '',
  style_tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.style_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own presets" ON public.style_presets FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert own presets" ON public.style_presets FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own presets" ON public.style_presets FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own presets" ON public.style_presets FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER update_style_presets_updated_at
  BEFORE UPDATE ON public.style_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
