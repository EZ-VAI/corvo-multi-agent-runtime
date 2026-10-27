ALTER TABLE public.shot_breakdowns
  ADD COLUMN IF NOT EXISTS angle_tag text,
  ADD COLUMN IF NOT EXISTS lighting_tag text,
  ADD COLUMN IF NOT EXISTS framing_intent text,
  ADD COLUMN IF NOT EXISTS temp_tag text;

CREATE INDEX IF NOT EXISTS idx_shot_breakdowns_angle_tag ON public.shot_breakdowns(angle_tag) WHERE angle_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shot_breakdowns_lighting_tag ON public.shot_breakdowns(lighting_tag) WHERE lighting_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shot_breakdowns_case_id ON public.shot_breakdowns(case_id);