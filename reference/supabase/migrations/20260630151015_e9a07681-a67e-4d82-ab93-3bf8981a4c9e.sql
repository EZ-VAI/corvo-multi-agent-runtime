
CREATE TABLE IF NOT EXISTS public.brand_product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  category text,
  main_image text,
  source text NOT NULL DEFAULT 'manual',
  shopify_id text,
  sizechart_json jsonb,
  selected_dims jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_product TO authenticated;
GRANT ALL ON public.brand_product TO service_role;

ALTER TABLE public.brand_product ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own brand_product select" ON public.brand_product FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own brand_product insert" ON public.brand_product FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own brand_product update" ON public.brand_product FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own brand_product delete" ON public.brand_product FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS brand_product_user_idx ON public.brand_product(user_id, created_at DESC);

CREATE TRIGGER brand_product_set_updated_at
  BEFORE UPDATE ON public.brand_product
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
