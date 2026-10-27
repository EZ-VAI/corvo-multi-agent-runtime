-- Phase A: Creative Decision Enum Layer instrumentation tables

CREATE TABLE public.mode_usage_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  draft_id UUID NULL,
  film_mode TEXT NOT NULL,
  mood TEXT NOT NULL,
  cultural_register TEXT NOT NULL,
  shot_count INTEGER NOT NULL DEFAULT 0,
  custom_ratio NUMERIC NULL,
  render_engine TEXT NULL,
  final_clip_url TEXT NULL,
  outcome_quality NUMERIC NULL,
  outcome_notes TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mode_usage_log_created_at ON public.mode_usage_log(created_at DESC);
CREATE INDEX idx_mode_usage_log_film_mode ON public.mode_usage_log(film_mode);

ALTER TABLE public.mode_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view mode_usage_log"
  ON public.mode_usage_log FOR SELECT
  TO authenticated
  USING (has_role('admin'::app_role));

CREATE POLICY "Service role can insert mode_usage_log"
  ON public.mode_usage_log FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update mode_usage_log"
  ON public.mode_usage_log FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);


CREATE TABLE public.enum_violation (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NULL,
  draft_id UUID NULL,
  film_mode TEXT NULL,
  recipe_name TEXT NULL,
  recipe_version TEXT NULL,
  violation_type TEXT NOT NULL,
  violation_detail TEXT NOT NULL,
  retry_attempt INTEGER NOT NULL DEFAULT 0,
  final_action TEXT NOT NULL,
  raw_input JSONB NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_enum_violation_created_at ON public.enum_violation(created_at DESC);
CREATE INDEX idx_enum_violation_type ON public.enum_violation(violation_type);

ALTER TABLE public.enum_violation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view enum_violation"
  ON public.enum_violation FOR SELECT
  TO authenticated
  USING (has_role('admin'::app_role));

CREATE POLICY "Service role can insert enum_violation"
  ON public.enum_violation FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 30-day TTL helper (run manually or via pg_cron later)
CREATE OR REPLACE FUNCTION public.cleanup_enum_violation_30d()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.enum_violation
  WHERE created_at < now() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;