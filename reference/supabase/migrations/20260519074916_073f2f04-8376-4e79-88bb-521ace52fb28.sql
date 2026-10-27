-- Character Portraits — three-view identity anchor for human-bearing keyframes.
-- Stores a stable "casting contract" per character per user: front/side/back portraits
-- + static identity traits (skin, hair, build, ethnicity, age) that never change
-- + dynamic per-shot variables (wardrobe, accessories, expression) that DO change.
-- Used by brand_film / agent / presenter pipelines. Editorial intentionally opts out
-- (wardrobe diversity is a feature there, not a bug).

CREATE TABLE public.character_portraits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  character_slug TEXT NOT NULL,         -- user-chosen handle, e.g. "sarah", "alex-male-30s"
  display_name TEXT NOT NULL,
  archetype TEXT,                       -- e.g. "minimalist-creative-female-30s"
  front_url TEXT,
  side_url TEXT,
  back_url TEXT,
  static_features JSONB NOT NULL DEFAULT '{}'::jsonb,
                                        -- { skinTone, hairColor, hairStyle, build, ethnicity, ageRange, distinctiveFeatures }
  dynamic_features JSONB NOT NULL DEFAULT '{}'::jsonb,
                                        -- defaults that callers may override per shot: { wardrobe, accessories, makeup, expressionDefault }
  source_image_url TEXT,                -- optional: user-uploaded reference that seeded the three views
  status TEXT NOT NULL DEFAULT 'pending', -- pending | generating | ready | failed
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, character_slug)
);

CREATE INDEX idx_character_portraits_user ON public.character_portraits(user_id);

ALTER TABLE public.character_portraits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own characters"
  ON public.character_portraits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own characters"
  ON public.character_portraits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own characters"
  ON public.character_portraits FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own characters"
  ON public.character_portraits FOR DELETE
  USING (auth.uid() = user_id);

-- Reuse existing updated_at trigger function if present, else create.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_character_portraits_updated_at
  BEFORE UPDATE ON public.character_portraits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();