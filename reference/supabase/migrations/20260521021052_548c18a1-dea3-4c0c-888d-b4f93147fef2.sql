REVOKE EXECUTE ON FUNCTION public.expire_stale_mcp_reviews() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_mcp_reviews() TO service_role;