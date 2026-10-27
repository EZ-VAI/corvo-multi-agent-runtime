CREATE TABLE public.shopify_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL,
  shop TEXT,
  previous_user_id UUID,
  reason TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shopify_audit_log_shop_created_at
  ON public.shopify_audit_log (shop, created_at DESC);
CREATE INDEX idx_shopify_audit_log_event_created_at
  ON public.shopify_audit_log (event, created_at DESC);

ALTER TABLE public.shopify_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view shopify_audit_log"
  ON public.shopify_audit_log
  FOR SELECT
  TO authenticated
  USING (has_role('admin'::app_role));

CREATE POLICY "No direct inserts on shopify_audit_log"
  ON public.shopify_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "No direct updates on shopify_audit_log"
  ON public.shopify_audit_log
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "No direct deletes on shopify_audit_log"
  ON public.shopify_audit_log
  FOR DELETE
  TO authenticated
  USING (false);