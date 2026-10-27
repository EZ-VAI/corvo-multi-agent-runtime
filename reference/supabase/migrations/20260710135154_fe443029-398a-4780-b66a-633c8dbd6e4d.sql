
ALTER TYPE public.generation_pipeline_mode ADD VALUE IF NOT EXISTS 'studio';

CREATE OR REPLACE FUNCTION public.finalize_studio_job(_job_id UUID, _outcome TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job RECORD; _refund INTEGER;
BEGIN
  IF _outcome NOT IN ('ready','failed') THEN RETURN jsonb_build_object('ok',false,'reason','bad_outcome'); END IF;
  SELECT * INTO _job FROM public.generation_jobs WHERE id=_job_id FOR UPDATE;
  IF _job.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
  IF _job.finalized_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF _outcome='ready' THEN
    UPDATE public.generation_jobs SET state='ready', committed_credits=reserved_credits,
      finalized_at=now(), updated_at=now() WHERE id=_job_id;
    RETURN jsonb_build_object('ok',true,'committed',_job.reserved_credits);
  ELSE
    _refund := _job.reserved_credits;
    IF _refund > 0 THEN
      UPDATE public.user_subscriptions SET credits_balance=credits_balance+_refund, updated_at=now() WHERE user_id=_job.user_id;
      INSERT INTO public.credit_transactions (user_id,amount,type,description,metadata,reference_id,channel)
        VALUES (_job.user_id,_refund,'refund','Studio generation failed — full refund',
          jsonb_build_object('job_id',_job.id),_job.draft_id::text,'refund');
    END IF;
    UPDATE public.generation_jobs SET state='failed', committed_credits=0, finalized_at=now(), updated_at=now() WHERE id=_job_id;
    RETURN jsonb_build_object('ok',true,'refunded',_refund);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.sweep_stuck_studio_jobs()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row RECORD; _n INTEGER := 0;
BEGIN
  FOR _row IN SELECT id FROM public.generation_jobs
    WHERE pipeline_mode='studio'::generation_pipeline_mode
      AND finalized_at IS NULL
      AND created_at < now() - interval '10 minutes'
    LIMIT 100
  LOOP PERFORM public.finalize_studio_job(_row.id,'failed'); _n:=_n+1; END LOOP;
  RETURN _n;
END; $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stuck-studio-jobs') THEN
    PERFORM cron.schedule('sweep-stuck-studio-jobs','*/5 * * * *', $cron$ SELECT public.sweep_stuck_studio_jobs(); $cron$);
  END IF;
END $$;
