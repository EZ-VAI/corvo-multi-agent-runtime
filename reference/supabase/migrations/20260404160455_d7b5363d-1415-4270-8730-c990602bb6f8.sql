
-- 1. Remove leftover public-role brand-assets storage policy
DROP POLICY IF EXISTS "Users can upload own brand assets" ON storage.objects;

-- 2. Lock down user_roles: deny all writes from authenticated users
CREATE POLICY "No direct inserts on user_roles"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY "No direct updates on user_roles"
ON public.user_roles FOR UPDATE TO authenticated
USING (false) WITH CHECK (false);

CREATE POLICY "No direct deletes on user_roles"
ON public.user_roles FOR DELETE TO authenticated
USING (false);

-- 3. Lock down credit_transactions: deny all writes from authenticated users
CREATE POLICY "No direct inserts on credit_transactions"
ON public.credit_transactions FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY "No direct updates on credit_transactions"
ON public.credit_transactions FOR UPDATE TO authenticated
USING (false) WITH CHECK (false);

CREATE POLICY "No direct deletes on credit_transactions"
ON public.credit_transactions FOR DELETE TO authenticated
USING (false);
