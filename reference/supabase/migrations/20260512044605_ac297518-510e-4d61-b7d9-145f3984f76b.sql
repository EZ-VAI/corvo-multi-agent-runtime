-- Fix 1: View must run with invoker rights so RLS on underlying table applies
ALTER VIEW public.shopify_installations_view SET (security_invoker = true);

-- Fix 2-4: Hard-revoke EXECUTE on all SECURITY DEFINER Shopify helpers
REVOKE EXECUTE ON FUNCTION public.shopify_store_token(text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shopify_get_token(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shopify_mark_uninstalled(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_shopify_oauth_state() FROM PUBLIC, anon, authenticated;
