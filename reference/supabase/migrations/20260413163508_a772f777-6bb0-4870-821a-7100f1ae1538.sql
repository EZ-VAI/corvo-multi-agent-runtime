
-- 1. Drop dependent policies first
DROP POLICY IF EXISTS "Admins can delete avatars" ON public.presenter_avatars;
DROP POLICY IF EXISTS "Admins can insert avatars" ON public.presenter_avatars;
DROP POLICY IF EXISTS "Admins can update avatars" ON public.presenter_avatars;

-- 2. Now safe to drop old function and create new one
DROP FUNCTION IF EXISTS public.has_role(_user_id uuid, _role app_role);

CREATE OR REPLACE FUNCTION public.has_role(_role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = _role
  )
$$;

-- 3. Recreate presenter_avatars policies with new has_role signature
CREATE POLICY "Admins can delete avatars" ON public.presenter_avatars
  FOR DELETE TO authenticated USING (public.has_role('admin'));

CREATE POLICY "Admins can insert avatars" ON public.presenter_avatars
  FOR INSERT TO authenticated WITH CHECK (public.has_role('admin'));

CREATE POLICY "Admins can update avatars" ON public.presenter_avatars
  FOR UPDATE TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- 4. Fix email_unsubscribe_tokens: scope to service_role directly
DROP POLICY IF EXISTS "Service role can insert tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can read tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens
  FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS "Service role can mark tokens as used" ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
