CREATE UNIQUE INDEX IF NOT EXISTS shopify_webhook_events_event_id_key
  ON public.shopify_webhook_events (shopify_event_id)
  WHERE shopify_event_id IS NOT NULL;