DROP INDEX IF EXISTS public.shopify_webhook_events_event_id_key;
ALTER TABLE public.shopify_webhook_events
  ADD CONSTRAINT shopify_webhook_events_event_id_key UNIQUE (shopify_event_id);