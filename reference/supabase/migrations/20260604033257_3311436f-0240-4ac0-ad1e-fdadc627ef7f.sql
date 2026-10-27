
CREATE TABLE public.deliberation_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  direction jsonb,
  shots jsonb,
  brief jsonb,
  result jsonb,
  log jsonb,
  status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.deliberation_session TO authenticated;
GRANT ALL ON public.deliberation_session TO service_role;

ALTER TABLE public.deliberation_session ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read their own deliberation sessions"
  ON public.deliberation_session
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_deliberation_session_updated_at
  BEFORE UPDATE ON public.deliberation_session
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_deliberation_session_user_id ON public.deliberation_session(user_id);
