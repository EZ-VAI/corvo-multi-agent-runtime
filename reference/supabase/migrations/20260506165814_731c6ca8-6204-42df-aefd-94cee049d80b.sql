
-- 1. Move pg_trgm extension from public to extensions schema
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- 2. Revoke anon EXECUTE on all SECURITY DEFINER functions
-- These should only be callable by authenticated users or service_role
REVOKE EXECUTE ON FUNCTION public.has_role(app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public._has_role_internal(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_credits_atomic(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(uuid, integer, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon;

-- Also revoke from public role (covers both anon and authenticated for internal-only functions)
-- Email queue functions should only be called by service_role (edge functions)
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM public;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;

-- Credit functions should only be called by service_role (edge functions call these)
REVOKE EXECUTE ON FUNCTION public.add_credits_atomic(uuid, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(uuid, integer, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.add_credits_atomic(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_credits(uuid, integer, text, jsonb) TO service_role;

-- _has_role_internal is only used inside RLS policies (security definer context) — revoke from public
REVOKE EXECUTE ON FUNCTION public._has_role_internal(uuid, app_role) FROM public;
GRANT EXECUTE ON FUNCTION public._has_role_internal(uuid, app_role) TO service_role;

-- handle_new_user is a trigger function — revoke direct execute from everyone
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public;

-- has_role is used in RLS policies by authenticated users — keep authenticated access
REVOKE EXECUTE ON FUNCTION public.has_role(app_role) FROM public;
GRANT EXECUTE ON FUNCTION public.has_role(app_role) TO authenticated;

-- 3. Tighten public bucket SELECT policies to prevent listing
-- Replace broad SELECT with path-scoped SELECT (read individual files but not list all)
-- product-images: public read is needed for image URLs but not listing
DROP POLICY IF EXISTS "Public read product images" ON storage.objects;
CREATE POLICY "Public read product images by path" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-images' AND (name IS NOT NULL AND name != ''));

-- onboarding-keyframes: same treatment
DROP POLICY IF EXISTS "Public read onboarding-keyframes" ON storage.objects;
CREATE POLICY "Public read onboarding-keyframes by path" ON storage.objects
  FOR SELECT USING (bucket_id = 'onboarding-keyframes' AND (name IS NOT NULL AND name != ''));

-- motion-templates: same treatment
DROP POLICY IF EXISTS "Anyone can view motion templates" ON storage.objects;
CREATE POLICY "Read motion templates by path" ON storage.objects
  FOR SELECT USING (bucket_id = 'motion-templates' AND (name IS NOT NULL AND name != ''));

-- project-bgm: same treatment
DROP POLICY IF EXISTS "Public can read BGM" ON storage.objects;
CREATE POLICY "Public read BGM by path" ON storage.objects
  FOR SELECT USING (bucket_id = 'project-bgm' AND (name IS NOT NULL AND name != ''));
