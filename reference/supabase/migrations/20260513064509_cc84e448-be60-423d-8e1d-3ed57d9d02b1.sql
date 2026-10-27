
REVOKE EXECUTE ON FUNCTION public.charge_clip_credits(TEXT, TEXT, UUID, INTEGER, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_clip_credits(TEXT, TEXT, UUID, INTEGER, TEXT, JSONB) TO service_role;
