
-- Revoke authenticated access from functions that should be service_role-only
REVOKE EXECUTE ON FUNCTION public.add_credits_atomic(uuid, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(uuid, integer, text, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
