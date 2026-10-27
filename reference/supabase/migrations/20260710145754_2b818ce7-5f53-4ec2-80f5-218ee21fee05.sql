
CREATE OR REPLACE FUNCTION public.record_brandfilm_task(
  _user_id UUID, _session_id TEXT, _board_id TEXT, _amount INTEGER, _clip_url TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.generation_tasks
    (user_id, session_id, block_index, block_id, status, engine, clip_url, credits_charged, credits_charged_amount)
  VALUES
    (_user_id, _session_id, 0, _board_id, 'completed', 'seedance', _clip_url, TRUE, _amount)
  ON CONFLICT (session_id, block_id) DO UPDATE
    SET status='completed',
        credits_charged=TRUE,
        credits_charged_amount=_amount,
        clip_url=COALESCE(EXCLUDED.clip_url, generation_tasks.clip_url),
        updated_at=now();
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_brandfilm_job(_job_id UUID, _outcome TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job RECORD; _committed INTEGER; _refund INTEGER;
BEGIN
  IF _outcome NOT IN ('ready','failed','canceled') THEN
    RETURN jsonb_build_object('ok',false,'reason','bad_outcome');
  END IF;
  SELECT * INTO _job FROM public.generation_jobs WHERE id=_job_id FOR UPDATE;
  IF _job.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
  IF _job.finalized_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;

  SELECT COALESCE(SUM(credits_charged_amount),0) INTO _committed
  FROM public.generation_tasks
  WHERE session_id = _job.draft_id::text AND credits_charged = TRUE;

  _refund := GREATEST(_job.reserved_credits - _committed, 0);
  IF _refund > 0 THEN
    UPDATE public.user_subscriptions
      SET credits_balance = credits_balance + _refund, updated_at = now()
      WHERE user_id = _job.user_id;
    INSERT INTO public.credit_transactions (user_id,amount,type,description,metadata,reference_id,channel)
      VALUES (_job.user_id,_refund,'refund',
        'Brand film — refund unused reservation ('||_outcome||')',
        jsonb_build_object('job_id',_job.id,'reserved',_job.reserved_credits,'committed',_committed),
        _job.draft_id::text,'refund');
  END IF;
  UPDATE public.generation_jobs
    SET state=(CASE WHEN _outcome='ready' THEN 'ready' ELSE 'failed' END)::generation_job_state,
        committed_credits=_committed, finalized_at=now(), updated_at=now()
    WHERE id=_job_id;
  RETURN jsonb_build_object('ok',true,'committed',_committed,'refunded',_refund);
END; $$;

CREATE OR REPLACE FUNCTION public.sweep_stuck_brandfilm_jobs()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row RECORD; _n INTEGER := 0;
BEGIN
  FOR _row IN SELECT id FROM public.generation_jobs
    WHERE pipeline_mode='brand_film'
      AND finalized_at IS NULL
      AND created_at < now() - interval '30 minutes'
    LIMIT 100
  LOOP
    PERFORM public.finalize_brandfilm_job(_row.id,'canceled');
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END; $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='sweep-stuck-brandfilm-jobs') THEN
    PERFORM cron.schedule('sweep-stuck-brandfilm-jobs','*/10 * * * *',
      $cron$ SELECT public.sweep_stuck_brandfilm_jobs(); $cron$);
  END IF;
END $$;
