ALTER TABLE public.creative_cases
  ADD COLUMN IF NOT EXISTS shot_sequence text,
  ADD COLUMN IF NOT EXISTS dominant_scale text,
  ADD COLUMN IF NOT EXISTS dominant_movement text;