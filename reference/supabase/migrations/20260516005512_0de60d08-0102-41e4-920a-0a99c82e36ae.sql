ALTER TABLE public.shopify_installations
  ADD COLUMN IF NOT EXISTS last_partner_poll_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_shopify_installations_partner_poll
  ON public.shopify_installations (last_partner_poll_at)
  WHERE uninstalled_at IS NULL AND user_id IS NOT NULL;