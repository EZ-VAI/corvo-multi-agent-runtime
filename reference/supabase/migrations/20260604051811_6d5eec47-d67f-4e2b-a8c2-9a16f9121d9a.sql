CREATE TABLE public.ai_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  caller text NOT NULL,
  model text NOT NULL,
  prompt_tokens integer,
  completion_tokens integer,
  reasoning_tokens integer,
  total_tokens integer,
  latency_ms integer,
  context text,
  status integer,
  error text,
  raw_usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ai_call_log TO authenticated;
GRANT ALL ON public.ai_call_log TO service_role;

ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own ai call log"
  ON public.ai_call_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public._has_role_internal(auth.uid(), 'admin'));

CREATE INDEX ai_call_log_created_idx ON public.ai_call_log (created_at DESC);
CREATE INDEX ai_call_log_model_idx ON public.ai_call_log (model, created_at DESC);
CREATE INDEX ai_call_log_caller_idx ON public.ai_call_log (caller, created_at DESC);