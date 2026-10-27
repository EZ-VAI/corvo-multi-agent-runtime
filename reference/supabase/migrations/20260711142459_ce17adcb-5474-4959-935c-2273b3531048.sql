ALTER TABLE public.film_client_inbox
  ADD COLUMN IF NOT EXISTS target_agent text,
  ADD COLUMN IF NOT EXISTS target_panel integer;

ALTER TABLE public.film_client_inbox
  DROP CONSTRAINT IF EXISTS film_client_inbox_op_check;

ALTER TABLE public.film_client_inbox
  ADD CONSTRAINT film_client_inbox_op_check
  CHECK (op IN (
    'feedback',
    'answer',
    'approve_ship',
    'reject_board',
    'retry_bgm',
    'accept_scoreless',
    'direct_agent'
  ));

ALTER TABLE public.film_client_inbox
  DROP CONSTRAINT IF EXISTS film_client_inbox_target_agent_check;

ALTER TABLE public.film_client_inbox
  ADD CONSTRAINT film_client_inbox_target_agent_check
  CHECK (
    target_agent IS NULL OR
    target_agent IN ('overseer', 'director', 'cinematographer', 'critic')
  );

ALTER TABLE public.film_client_inbox
  DROP CONSTRAINT IF EXISTS film_client_inbox_target_panel_check;

ALTER TABLE public.film_client_inbox
  ADD CONSTRAINT film_client_inbox_target_panel_check
  CHECK (target_panel IS NULL OR target_panel BETWEEN 1 AND 8);