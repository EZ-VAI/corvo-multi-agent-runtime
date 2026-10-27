-- Idempotency dedupe key for Shopify resends
CREATE UNIQUE INDEX IF NOT EXISTS shopify_webhook_events_event_id_uniq
  ON public.shopify_webhook_events (shopify_event_id)
  WHERE shopify_event_id IS NOT NULL;

-- Helpful working indexes for the processor
CREATE INDEX IF NOT EXISTS shopify_webhook_events_pending_idx
  ON public.shopify_webhook_events (received_at)
  WHERE processed = false AND hmac_verified = true AND dead_letter = false;

CREATE INDEX IF NOT EXISTS shopify_installations_uninstalled_idx
  ON public.shopify_installations (uninstalled_at)
  WHERE uninstalled_at IS NOT NULL;