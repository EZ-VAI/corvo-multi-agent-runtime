-- Enable trigram similarity
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes on creative_cases for fast similarity ranking
CREATE INDEX IF NOT EXISTS idx_creative_cases_vertical_trgm
  ON public.creative_cases USING GIN (vertical gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_creative_cases_metaphor_trgm
  ON public.creative_cases USING GIN (metaphor_universe gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_creative_cases_sensory_trgm
  ON public.creative_cases USING GIN (sensory_quality gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_creative_cases_attr_trgm
  ON public.creative_cases USING GIN (primary_attribute gin_trgm_ops);

-- Telemetry table: one row per generate-angle-plan invocation
CREATE TABLE IF NOT EXISTS public.angle_plan_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT,
  user_id UUID,
  narrative_type TEXT,
  vertical TEXT,
  block_count INTEGER NOT NULL DEFAULT 0,
  candidates_found INTEGER NOT NULL DEFAULT 0,
  total_shots_referenced INTEGER NOT NULL DEFAULT 0,
  fallback_used BOOLEAN NOT NULL DEFAULT false,
  fallback_reason TEXT,
  confidence_score REAL,
  gpt_latency_ms INTEGER,
  output JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_angle_plan_logs_created
  ON public.angle_plan_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_angle_plan_logs_fallback
  ON public.angle_plan_logs (fallback_used, created_at DESC);

ALTER TABLE public.angle_plan_logs ENABLE ROW LEVEL SECURITY;

-- Only service role inserts
CREATE POLICY "Service role can insert angle_plan_logs"
  ON public.angle_plan_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Only admins can read (monitoring dashboard)
CREATE POLICY "Admins can view angle_plan_logs"
  ON public.angle_plan_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role('admin'::app_role));