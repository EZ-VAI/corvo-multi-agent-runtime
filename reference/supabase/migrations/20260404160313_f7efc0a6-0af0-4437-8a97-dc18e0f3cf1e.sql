
-- 1. Fix product-images: restrict uploads to authenticated users only
DROP POLICY IF EXISTS "Anyone can upload product images" ON storage.objects;
CREATE POLICY "Authenticated users can upload product images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-images');

-- 2. Fix brand_assets: change all policies from public to authenticated
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'brand_assets'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.brand_assets', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Users can view own brand assets"
ON public.brand_assets FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own brand assets"
ON public.brand_assets FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own brand assets"
ON public.brand_assets FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own brand assets"
ON public.brand_assets FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- 3. Fix user_subscriptions: add explicit deny-all write policies
CREATE POLICY "No direct inserts on subscriptions"
ON public.user_subscriptions FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY "No direct updates on subscriptions"
ON public.user_subscriptions FOR UPDATE TO authenticated
USING (false) WITH CHECK (false);

CREATE POLICY "No direct deletes on subscriptions"
ON public.user_subscriptions FOR DELETE TO authenticated
USING (false);
