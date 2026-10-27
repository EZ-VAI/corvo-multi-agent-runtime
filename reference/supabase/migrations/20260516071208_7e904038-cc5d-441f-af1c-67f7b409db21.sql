
-- Enable cron extensions for orchestrator scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- State machine enum
DO $$ BEGIN
  CREATE TYPE public.generation_job_state AS ENUM (
    'queued',
    'analyzing',
    'concepting',
    'blocking',
    'keyframing',
    'submitting_clips',
    'polling_clips',
    'assembling',
    'ready',
    'failed',
    'canceled',
    'partial_failure_awaiting_user'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Pipeline mode enum (matches client PipelineMode but DB-enforced)
DO $$ BEGIN
  CREATE TYPE public.generation_pipeline_mode AS ENUM ('brand_film', 'editorial', 'presenter');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- generation_jobs — one row per draft generation run
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.generation_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  draft_id UUID NOT NULL,
  pipeline_mode public.generation_pipeline_mode NOT NULL DEFAULT 'brand_film',
  state public.generation_job_state NOT NULL DEFAULT 'queued',

  -- credits
  reserved_credits INTEGER NOT NULL DEFAULT 0,
  committed_credits INTEGER NOT NULL DEFAULT 0,
  expected_cost_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- mode-specific persisted state (editorial scenePool, shotAssignments, etc.)
  mode_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- engine selection captured at reserve time (for tier-gating audit)
  engine TEXT,

  -- per-state timing for stuck-job + VPS auto-retry detection
  analyzing_started_at TIMESTAMPTZ,
  keyframing_started_at TIMESTAMPTZ,
  assembling_started_at TIMESTAMPTZ,
  vps_retry_count INTEGER NOT NULL DEFAULT 0,

  -- cron coordination
  last_advance_at TIMESTAMPTZ,
  error_message TEXT,
  partial_failure_resolution TEXT, -- 'retry' | 'skip' | 'cancel' once user picks

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS generation_jobs_user_idx ON public.generation_jobs(user_id);
CREATE INDEX IF NOT EXISTS generation_jobs_draft_idx ON public.generation_jobs(draft_id);
-- cron driver: pick non-terminal jobs ordered by last_advance_at
CREATE INDEX IF NOT EXISTS generation_jobs_advance_idx
  ON public.generation_jobs(state, last_advance_at NULLS FIRST)
  WHERE state NOT IN ('ready','failed','canceled','partial_failure_awaiting_user');

ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own generation_jobs" ON public.generation_jobs;
CREATE POLICY "Users view own generation_jobs"
  ON public.generation_jobs FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "No direct inserts on generation_jobs" ON public.generation_jobs;
CREATE POLICY "No direct inserts on generation_jobs"
  ON public.generation_jobs FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "No direct updates on generation_jobs" ON public.generation_jobs;
CREATE POLICY "No direct updates on generation_jobs"
  ON public.generation_jobs FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "No direct deletes on generation_jobs" ON public.generation_jobs;
CREATE POLICY "No direct deletes on generation_jobs"
  ON public.generation_jobs FOR DELETE TO authenticated USING (false);

-- updated_at trigger
DROP TRIGGER IF EXISTS update_generation_jobs_updated_at ON public.generation_jobs;
CREATE TRIGGER update_generation_jobs_updated_at
  BEFORE UPDATE ON public.generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- reserve_generation_credits — atomic balance check + job insert + audit
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_generation_credits(
  _user_id UUID,
  _draft_id UUID,
  _amount INTEGER,
  _pipeline_mode public.generation_pipeline_mode,
  _engine TEXT,
  _cost_breakdown JSONB,
  _mode_state JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _balance INTEGER;
  _is_admin BOOLEAN;
  _job_id UUID;
BEGIN
  IF _user_id IS NULL OR _draft_id IS NULL OR _amount IS NULL OR _amount < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;

  SELECT public._has_role_internal(_user_id, 'admin') INTO _is_admin;

  IF NOT _is_admin THEN
    SELECT credits_balance INTO _balance
    FROM public.user_subscriptions
    WHERE user_id = _user_id
    FOR UPDATE;

    IF _balance IS NULL OR _balance < _amount THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_credits',
                                'balance', COALESCE(_balance, 0), 'required', _amount);
    END IF;

    UPDATE public.user_subscriptions
    SET credits_balance = credits_balance - _amount,
        updated_at = now()
    WHERE user_id = _user_id;
  END IF;

  INSERT INTO public.generation_jobs (
    user_id, draft_id, pipeline_mode, state,
    reserved_credits, expected_cost_breakdown, mode_state_json, engine,
    last_advance_at
  ) VALUES (
    _user_id, _draft_id, _pipeline_mode, 'queued',
    _amount, _cost_breakdown, _mode_state, _engine,
    NULL
  )
  RETURNING id INTO _job_id;

  INSERT INTO public.credit_transactions (
    user_id, amount, type, description, metadata, reference_id, channel
  ) VALUES (
    _user_id, -_amount, 'generation',
    'Reserved for generation (' || _pipeline_mode::text || ')',
    jsonb_build_object('job_id', _job_id, 'draft_id', _draft_id,
                       'pipeline_mode', _pipeline_mode, 'engine', _engine,
                       'cost_breakdown', _cost_breakdown,
                       'admin_skipped', _is_admin),
    _draft_id::text,
    'reservation'
  );

  RETURN jsonb_build_object('ok', true, 'job_id', _job_id, 'reserved', _amount);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- finalize_generation_job — refund (reserved - committed) on terminal state
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_generation_job(
  _job_id UUID,
  _outcome public.generation_job_state,
  _error_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job RECORD;
  _refund INTEGER;
  _is_admin BOOLEAN;
BEGIN
  IF _outcome NOT IN ('ready','failed','canceled','partial_failure_awaiting_user') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_outcome');
  END IF;

  SELECT * INTO _job FROM public.generation_jobs WHERE id = _job_id FOR UPDATE;
  IF _job.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'job_not_found');
  END IF;

  IF _job.finalized_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_finalized', true);
  END IF;

  -- Re-tally committed from generation_tasks (source of truth)
  SELECT COALESCE(SUM(credits_charged_amount), 0) INTO _job.committed_credits
  FROM public.generation_tasks
  WHERE session_id = _job.draft_id::text AND credits_charged = TRUE;

  _refund := GREATEST(_job.reserved_credits - _job.committed_credits, 0);

  SELECT public._has_role_internal(_job.user_id, 'admin') INTO _is_admin;

  IF _refund > 0 AND NOT _is_admin THEN
    UPDATE public.user_subscriptions
    SET credits_balance = credits_balance + _refund,
        updated_at = now()
    WHERE user_id = _job.user_id;

    INSERT INTO public.credit_transactions (
      user_id, amount, type, description, metadata, reference_id, channel
    ) VALUES (
      _job.user_id, _refund, 'refund',
      'Refund of unused reservation (' || _outcome::text || ')',
      jsonb_build_object('job_id', _job.id, 'draft_id', _job.draft_id,
                         'reserved', _job.reserved_credits,
                         'committed', _job.committed_credits,
                         'error', _error_message),
      _job.draft_id::text,
      'refund'
    );
  END IF;

  UPDATE public.generation_jobs
  SET state = _outcome,
      committed_credits = _job.committed_credits,
      error_message = _error_message,
      finalized_at = now(),
      updated_at = now()
  WHERE id = _job_id;

  RETURN jsonb_build_object('ok', true, 'refunded', _refund,
                            'committed', _job.committed_credits);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- advance_generation_job_state — orchestrator state transition helper
-- (called by edge fn under pg_advisory_lock per cron tick)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.advance_generation_job_state(
  _job_id UUID,
  _new_state public.generation_job_state,
  _mode_state_patch JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.generation_jobs
  SET state = _new_state,
      mode_state_json = CASE
        WHEN _mode_state_patch IS NULL THEN mode_state_json
        ELSE mode_state_json || _mode_state_patch
      END,
      analyzing_started_at = CASE
        WHEN _new_state = 'analyzing' AND analyzing_started_at IS NULL THEN now()
        ELSE analyzing_started_at END,
      keyframing_started_at = CASE
        WHEN _new_state = 'keyframing' AND keyframing_started_at IS NULL THEN now()
        ELSE keyframing_started_at END,
      assembling_started_at = CASE
        WHEN _new_state = 'assembling' AND assembling_started_at IS NULL THEN now()
        ELSE assembling_started_at END,
      last_advance_at = now(),
      updated_at = now()
  WHERE id = _job_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'job_not_found');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
