
REVOKE EXECUTE ON FUNCTION public.reserve_generation_credits(UUID, UUID, INTEGER, public.generation_pipeline_mode, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_generation_job(UUID, public.generation_job_state, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.advance_generation_job_state(UUID, public.generation_job_state, JSONB) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_generation_credits(UUID, UUID, INTEGER, public.generation_pipeline_mode, TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_generation_job(UUID, public.generation_job_state, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_generation_job_state(UUID, public.generation_job_state, JSONB) TO service_role;
