ALTER TABLE public.film_client_inbox
  DROP CONSTRAINT IF EXISTS film_client_inbox_op_check;

ALTER TABLE public.film_client_inbox
  ADD CONSTRAINT film_client_inbox_op_check
  CHECK (op IN (
    'feedback',
    'answer',
    'reject_board',
    'approve_ship',
    'retry_bgm',
    'accept_scoreless'
  ));