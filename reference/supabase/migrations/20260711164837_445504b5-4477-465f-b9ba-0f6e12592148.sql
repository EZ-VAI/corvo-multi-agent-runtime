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
    'direct_agent',
    'retry_clip_qc',
    'pause_film',
    'cancel_film'
  ));