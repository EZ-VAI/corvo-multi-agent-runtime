CREATE TABLE public.agent_modify_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  conversation_id UUID,
  status TEXT NOT NULL DEFAULT 'processing',
  total_items INTEGER NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_modify_jobs_user ON public.agent_modify_jobs(user_id, created_at DESC);

ALTER TABLE public.agent_modify_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own modify jobs"
  ON public.agent_modify_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own modify jobs"
  ON public.agent_modify_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_agent_modify_jobs_updated_at
  BEFORE UPDATE ON public.agent_modify_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();