
-- Add 12 new columns to creative_cases
ALTER TABLE public.creative_cases
  ADD COLUMN IF NOT EXISTS ai_executability_score integer,
  ADD COLUMN IF NOT EXISTS ai_execution_notes text,
  ADD COLUMN IF NOT EXISTS ai_adapted_scene text,
  ADD COLUMN IF NOT EXISTS texture_materials text,
  ADD COLUMN IF NOT EXISTS negative_prompt_notes text,
  ADD COLUMN IF NOT EXISTS product_reveal_technique text,
  ADD COLUMN IF NOT EXISTS product_screen_time_pct real,
  ADD COLUMN IF NOT EXISTS hook_technique text,
  ADD COLUMN IF NOT EXISTS hook_visual_description text,
  ADD COLUMN IF NOT EXISTS cta_style text,
  ADD COLUMN IF NOT EXISTS best_for_duration text,
  ADD COLUMN IF NOT EXISTS reference_frame_urls text[];

-- Drop 3 fields migrated to shot_breakdowns
ALTER TABLE public.creative_cases
  DROP COLUMN IF EXISTS shot_sequence,
  DROP COLUMN IF EXISTS dominant_scale,
  DROP COLUMN IF EXISTS dominant_movement;

-- Create shot_breakdowns sub-table
CREATE TABLE public.shot_breakdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.creative_cases(id) ON DELETE CASCADE,
  shot_number integer NOT NULL,
  scale text,
  lens_mm text,
  camera_motion text,
  camera_motion_detail text,
  subject text,
  subject_action text,
  lighting text,
  color_temp text,
  duration_target_sec real,
  ai_prompt_fragment text,
  ai_feasibility integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, shot_number)
);

-- Enable RLS
ALTER TABLE public.shot_breakdowns ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view all shot breakdowns (same as creative_cases)
CREATE POLICY "Authenticated users can view all shot breakdowns"
  ON public.shot_breakdowns
  FOR SELECT
  TO authenticated
  USING (true);
