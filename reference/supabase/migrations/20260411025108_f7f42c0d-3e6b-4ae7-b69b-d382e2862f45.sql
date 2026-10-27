ALTER TABLE public.credit_packages
  ADD COLUMN waffo_product_id text DEFAULT NULL,
  ADD COLUMN product_type text NOT NULL DEFAULT 'onetime';

COMMENT ON COLUMN public.credit_packages.waffo_product_id IS 'Waffo Pancake product ID for checkout';
COMMENT ON COLUMN public.credit_packages.product_type IS 'onetime or subscription';