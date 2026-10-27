
REVOKE EXECUTE ON FUNCTION public.shopify_store_token_pending(text, text, text, integer, text, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shopify_refresh_token(text, text, text, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shopify_update_tokens_after_refresh(text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shopify_get_token(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shopify_mark_uninstalled(text) FROM PUBLIC, anon, authenticated;
