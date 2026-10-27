
-- Table to persist clip generation tasks so they survive page refresh/tab close
CREATE TABLE public.generation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id text NOT NULL, -- links to a specific Create session
  block_index integer NOT NULL,
  block_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending, generating, polling, completed, failed
  engine text NOT NULL DEFAULT 'kling-std',
  request_payload jsonb DEFAULT '{}'::jsonb, -- stores the generation request params
  external_task_id text, -- e.g. Kling task ID for polling
  clip_url text, -- final clip URL when done
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, block_id)
);

ALTER TABLE public.generation_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tasks"
  ON public.generation_tasks FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own tasks"
  ON public.generation_tasks FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own tasks"
  ON public.generation_tasks FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own tasks"
  ON public.generation_tasks FOR DELETE TO authenticated
  USING (user_id = auth.uid());
