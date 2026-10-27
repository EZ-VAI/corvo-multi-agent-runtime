-- ============================================================================
-- P-1.A  Brand Brain + Product Brain
-- Pure additive. Coexists with brand_profiles / agent_brand_memory.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.brand_brain (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  confirmed_by_brand boolean NOT NULL DEFAULT false,
  confirmed_at       timestamptz,
  source             text NOT NULL DEFAULT 'analyzer',
  essence            jsonb NOT NULL DEFAULT '{}'::jsonb,
  anti_identity      jsonb NOT NULL DEFAULT '{}'::jsonb,
  visual_dna         jsonb NOT NULL DEFAULT '{}'::jsonb,
  tonal_register     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_brain TO authenticated;
GRANT ALL ON public.brand_brain TO service_role;

CREATE TABLE IF NOT EXISTS public.product_brain (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  brand_brain_id     uuid REFERENCES public.brand_brain(id) ON DELETE CASCADE,
  product_key        text NOT NULL DEFAULT '',
  title              text NOT NULL DEFAULT '',
  version            integer NOT NULL DEFAULT 1,
  confirmed_by_brand boolean NOT NULL DEFAULT false,
  confirmed_at       timestamptz,
  source             text NOT NULL DEFAULT 'analyzer',
  synced_from_shopify boolean NOT NULL DEFAULT false,
  truth              jsonb NOT NULL DEFAULT '{}'::jsonb,
  value_proposition  jsonb NOT NULL DEFAULT '{}'::jsonb,
  value_translation  jsonb NOT NULL DEFAULT '{}'::jsonb,
  representation_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  product_images     text[] NOT NULL DEFAULT '{}',
  product_blurb      text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_brain TO authenticated;
GRANT ALL ON public.product_brain TO service_role;

CREATE INDEX IF NOT EXISTS idx_product_brain_user        ON public.product_brain(user_id);
CREATE INDEX IF NOT EXISTS idx_product_brain_brand_brain ON public.product_brain(brand_brain_id);

ALTER TABLE public.brand_brain   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_brain ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own brand_brain" ON public.brand_brain
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own product_brain" ON public.product_brain
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brand_brain_updated   ON public.brand_brain;
CREATE TRIGGER trg_brand_brain_updated   BEFORE UPDATE ON public.brand_brain
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_product_brain_updated ON public.product_brain;
CREATE TRIGGER trg_product_brain_updated BEFORE UPDATE ON public.product_brain
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();