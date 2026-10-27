
ALTER TABLE public.generation_tasks
  ADD COLUMN IF NOT EXISTS credits_charged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS credits_charged_amount INTEGER;

CREATE INDEX IF NOT EXISTS idx_generation_tasks_session_block
  ON public.generation_tasks(session_id, block_id);

-- Atomic, idempotent credit charge for a completed clip.
-- Called by edge functions (service_role) the moment a generation task hits "completed".
-- Uses generation_tasks.credits_charged as a per-task lock so retries / double-polling never bill twice.
CREATE OR REPLACE FUNCTION public.charge_clip_credits(
  _session_id TEXT,
  _block_id   TEXT,
  _user_id    UUID,
  _amount     INTEGER,
  _description TEXT,
  _metadata   JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _task_row RECORD;
  _is_admin BOOLEAN;
BEGIN
  -- Lock the task row so concurrent pollers can't race.
  SELECT id, credits_charged
    INTO _task_row
  FROM public.generation_tasks
  WHERE session_id = _session_id AND block_id = _block_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF _task_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'task_not_found');
  END IF;

  IF _task_row.credits_charged THEN
    RETURN jsonb_build_object('ok', true, 'already_charged', true);
  END IF;

  SELECT public._has_role_internal(_user_id, 'admin') INTO _is_admin;

  IF _is_admin THEN
    INSERT INTO public.credit_transactions (user_id, amount, type, description, metadata)
    VALUES (_user_id, -_amount, 'generation', _description,
            _metadata || jsonb_build_object('admin_skipped', true,
                                             'session_id', _session_id,
                                             'block_id', _block_id));
  ELSE
    UPDATE public.user_subscriptions
    SET credits_balance = credits_balance - _amount,
        credits_used_this_month = credits_used_this_month + _amount,
        updated_at = now()
    WHERE user_id = _user_id;

    INSERT INTO public.credit_transactions (user_id, amount, type, description, metadata)
    VALUES (_user_id, -_amount, 'generation', _description,
            _metadata || jsonb_build_object('session_id', _session_id,
                                             'block_id', _block_id));
  END IF;

  UPDATE public.generation_tasks
  SET credits_charged = TRUE,
      credits_charged_amount = _amount,
      updated_at = now()
  WHERE id = _task_row.id;

  RETURN jsonb_build_object('ok', true, 'charged', _amount);
END;
$$;
