-- mcp_review_requests: tracks each agent-initiated brand-film generation session
-- that lives in an MCP host's conversation (Claude Desktop / Codex / Cursor).
-- 24h TTL on awaiting_user_review; approve resets to now()+30min for clipping window.

CREATE TABLE IF NOT EXISTS public.mcp_review_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  pipeline        text NOT NULL DEFAULT 'brand_film',
  state           text NOT NULL DEFAULT 'analyzing'
                  CHECK (state IN ('analyzing','keyframing','awaiting_user_review',
                                   'clipping','assembling','ready','abandoned','failed')),
  draft_id        uuid,
  job_id          uuid,
  input           jsonb NOT NULL DEFAULT '{}'::jsonb,
  understanding   jsonb NOT NULL DEFAULT '{}'::jsonb,
  concept         jsonb NOT NULL DEFAULT '{}'::jsonb,
  blocks          jsonb NOT NULL DEFAULT '[]'::jsonb,
  keyframes       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{shot_index, image_url, prompt, block_id}]
  clips           jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{shot_index, task_id, clip_url, status}]
  revise_counts   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"0":1,"3":2}
  final_video_url text,
  error_message   text,
  progress        jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_review_requests_user_idx
  ON public.mcp_review_requests(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mcp_review_requests_cleanup_idx
  ON public.mcp_review_requests(state, expires_at)
  WHERE state IN ('awaiting_user_review','analyzing','keyframing');

ALTER TABLE public.mcp_review_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own mcp review requests"
  ON public.mcp_review_requests FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "No direct inserts on mcp_review_requests"
  ON public.mcp_review_requests FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "No direct updates on mcp_review_requests"
  ON public.mcp_review_requests FOR UPDATE
  TO authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "No direct deletes on mcp_review_requests"
  ON public.mcp_review_requests FOR DELETE
  TO authenticated
  USING (false);

CREATE TRIGGER trg_mcp_review_requests_updated_at
  BEFORE UPDATE ON public.mcp_review_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Cleanup helper: marks stale awaiting_user_review / analyzing / keyframing as abandoned
-- and refunds any reserved credits via finalize_generation_job (existing RPC).
-- IMPORTANT: only touches review-blocked states, never clipping/assembling
-- (those have their own watchdog via generation_jobs.last_advance_at).
CREATE OR REPLACE FUNCTION public.expire_stale_mcp_reviews()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row record;
  _n   integer := 0;
BEGIN
  FOR _row IN
    SELECT id, job_id
    FROM public.mcp_review_requests
    WHERE state IN ('awaiting_user_review','analyzing','keyframing')
      AND expires_at < now()
    LIMIT 200
  LOOP
    IF _row.job_id IS NOT NULL THEN
      PERFORM public.finalize_generation_job(_row.job_id, 'canceled'::generation_job_state,
                                             'mcp_review_expired_24h');
    END IF;

    UPDATE public.mcp_review_requests
    SET state = 'abandoned',
        error_message = COALESCE(error_message, 'expired_24h'),
        updated_at = now()
    WHERE id = _row.id;

    _n := _n + 1;
  END LOOP;

  RETURN _n;
END;
$$;