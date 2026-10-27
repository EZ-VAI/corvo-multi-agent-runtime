CREATE TABLE public.understanding_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain jsonb NOT NULL DEFAULT '{}'::jsonb,
  gathered jsonb NOT NULL DEFAULT '{}'::jsonb,
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.understanding_session TO authenticated;
GRANT ALL ON public.understanding_session TO service_role;

ALTER TABLE public.understanding_session ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own understanding sessions"
  ON public.understanding_session FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own understanding sessions"
  ON public.understanding_session FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own understanding sessions"
  ON public.understanding_session FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own understanding sessions"
  ON public.understanding_session FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_understanding_session_user_id ON public.understanding_session(user_id);

CREATE TRIGGER update_understanding_session_updated_at
  BEFORE UPDATE ON public.understanding_session
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();