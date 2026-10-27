
REVOKE ALL ON FUNCTION public.shopify_store_token_pending(text, text, text, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shopify_refresh_token(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shopify_claim_install(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_shopify_pending() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.shopify_store_token_pending(text, text, text, text, timestamptz, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.shopify_refresh_token(text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.shopify_claim_install(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_shopify_pending() TO service_role;

-- Pre-existing functions same treatment (already service_role-only in practice)
REVOKE ALL ON FUNCTION public.shopify_get_token(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shopify_mark_uninstalled(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_shopify_oauth_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shopify_get_token(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.shopify_mark_uninstalled(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_shopify_oauth_state() TO service_role;
