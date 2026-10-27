DROP POLICY IF EXISTS "Anyone can view active packages" ON public.credit_packages;
CREATE POLICY "Anyone can view active packages"
ON public.credit_packages
FOR SELECT
TO anon, authenticated
USING (active = true);