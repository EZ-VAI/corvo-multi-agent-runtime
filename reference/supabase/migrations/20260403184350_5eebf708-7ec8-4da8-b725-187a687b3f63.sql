
CREATE TABLE public.creative_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  campaign_name text NOT NULL,
  year integer,
  director text,
  agency text,
  vertical text NOT NULL,
  product_type text,
  product_name text,
  primary_attribute text,
  secondary_attribute text,
  sensory_quality text,
  metaphor_universe text,
  specific_metaphor text,
  filmable_scene text,
  bridge_technique text,
  association_distance integer,
  shot_sequence text,
  dominant_scale text,
  dominant_movement text,
  movement_speed text,
  lighting_approach text,
  color_palette text,
  aspect_ratio text,
  duration_seconds integer,
  cut_count integer,
  avg_shot_duration real,
  rhythm_pattern text,
  music_style text,
  music_bpm integer,
  cuts_on_beat boolean DEFAULT false,
  audio_technique text,
  emotional_arc text,
  opening_emotion text,
  peak_emotion text,
  closing_emotion text,
  has_human_face boolean DEFAULT true,
  face_first_appears_sec integer,
  metaphor_opens boolean DEFAULT false,
  cannes_lions boolean DEFAULT false,
  viral_organic boolean DEFAULT false,
  industry_reference boolean DEFAULT false,
  effectiveness_notes text,
  reference_url text,
  notes text,
  tags text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.creative_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all cases"
ON public.creative_cases FOR SELECT
TO authenticated
USING (true);

CREATE INDEX idx_creative_cases_vertical ON public.creative_cases (vertical);
CREATE INDEX idx_creative_cases_product_type ON public.creative_cases (product_type);
CREATE INDEX idx_creative_cases_primary_attribute ON public.creative_cases (primary_attribute);
CREATE INDEX idx_creative_cases_association_distance ON public.creative_cases (association_distance);
CREATE INDEX idx_creative_cases_tags ON public.creative_cases USING GIN (tags);
