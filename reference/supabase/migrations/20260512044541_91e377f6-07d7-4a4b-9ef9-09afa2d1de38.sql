-- ============================================================
-- Step 2 — Shopify integration: schema + pgsodium token encryption
-- ============================================================

-- 1. pgsodium extension (idempotent)
CREATE EXTENSION IF NOT EXISTS pgsodium;

-- 2. Provision a named key for Shopify token encryption (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgsodium.key WHERE name = 'shopify_token_key') THEN
    PERFORM pgsodium.create_key(name := 'shopify_token_key');
  END IF;
END $$;

-- ============================================================
-- TABLE: shopify_installations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shopify_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  shop_domain text NOT NULL UNIQUE,
  access_token_encrypted bytea,
  access_token_nonce bytea,
  scope text NOT NULL DEFAULT '',
  installed_at timestamptz NOT NULL DEFAULT now(),
  uninstalled_at timestamptz,
  raw_install_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  last_sync_error text,
  needs_reconnect boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopify_installations_user_id
  ON public.shopify_installations(user_id);
CREATE INDEX IF NOT EXISTS idx_shopify_installations_active
  ON public.shopify_installations(user_id, installed_at DESC)
  WHERE uninstalled_at IS NULL;

ALTER TABLE public.shopify_installations ENABLE ROW LEVEL SECURITY;

-- User can read own installations, but the encrypted token bytea is never
-- exposed to clients via the SDK because we use a sanitized view below.
CREATE POLICY "Users can view own shopify installations"
  ON public.shopify_installations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Block direct writes from clients — only service_role (edge functions) writes
CREATE POLICY "No direct inserts on shopify_installations"
  ON public.shopify_installations FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "No direct updates on shopify_installations"
  ON public.shopify_installations FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No direct deletes on shopify_installations"
  ON public.shopify_installations FOR DELETE TO authenticated USING (false);

-- Sanitized view that strips the encrypted token columns
CREATE OR REPLACE VIEW public.shopify_installations_view AS
SELECT
  id, user_id, shop_domain, scope,
  installed_at, uninstalled_at, last_synced_at, last_sync_error,
  needs_reconnect, created_at, updated_at
FROM public.shopify_installations;

GRANT SELECT ON public.shopify_installations_view TO authenticated;

-- ============================================================
-- TABLE: shopify_oauth_state  (CSRF nonce, 5-min TTL, single-use)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shopify_oauth_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  shop_domain text NOT NULL,
  nonce text NOT NULL UNIQUE,
  state_hmac text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_shopify_oauth_state_expires
  ON public.shopify_oauth_state(expires_at);

ALTER TABLE public.shopify_oauth_state ENABLE ROW LEVEL SECURITY;

-- Service-role only (no client policies)
CREATE POLICY "No client access to shopify_oauth_state"
  ON public.shopify_oauth_state FOR SELECT TO authenticated USING (false);

-- ============================================================
-- TABLE: shopify_webhook_events  (audit log — always written)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shopify_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_event_id text,
  shop_domain text NOT NULL,
  topic text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  hmac_verified boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  dead_letter boolean NOT NULL DEFAULT false,
  error text
);

CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_pending
  ON public.shopify_webhook_events(received_at)
  WHERE processed = false AND dead_letter = false;
CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_shop_topic
  ON public.shopify_webhook_events(shop_domain, topic, received_at DESC);
-- Idempotency for retried Shopify deliveries
CREATE UNIQUE INDEX IF NOT EXISTS uq_shopify_webhook_events_event_id
  ON public.shopify_webhook_events(shopify_event_id)
  WHERE shopify_event_id IS NOT NULL;

ALTER TABLE public.shopify_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view shopify_webhook_events"
  ON public.shopify_webhook_events FOR SELECT
  TO authenticated
  USING (has_role('admin'::app_role));

-- ============================================================
-- TABLE: shopify_products_cache
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shopify_products_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  shop_domain text NOT NULL,
  shopify_product_id text NOT NULL,
  handle text,
  title text,
  description text,
  vendor text,
  product_type text,
  status text,
  featured_image_url text,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shop_domain, shopify_product_id)
);

CREATE INDEX IF NOT EXISTS idx_shopify_products_cache_user
  ON public.shopify_products_cache(user_id, synced_at DESC);

ALTER TABLE public.shopify_products_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own shopify products"
  ON public.shopify_products_cache FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "No direct inserts on shopify_products_cache"
  ON public.shopify_products_cache FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "No direct updates on shopify_products_cache"
  ON public.shopify_products_cache FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No direct deletes on shopify_products_cache"
  ON public.shopify_products_cache FOR DELETE TO authenticated USING (false);

-- ============================================================
-- updated_at trigger on shopify_installations
-- ============================================================
DROP TRIGGER IF EXISTS shopify_installations_set_updated_at ON public.shopify_installations;
CREATE TRIGGER shopify_installations_set_updated_at
  BEFORE UPDATE ON public.shopify_installations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- pgsodium token store / fetch — service_role only
-- Uses crypto_aead_det_xchacha20() with the named key
-- ============================================================
CREATE OR REPLACE FUNCTION public.shopify_store_token(
  _shop_domain text,
  _user_id uuid,
  _access_token text,
  _scope text,
  _raw_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgsodium
AS $$
DECLARE
  _key_uuid uuid;
  _ciphertext bytea;
  _row_id uuid;
BEGIN
  SELECT id INTO _key_uuid FROM pgsodium.key WHERE name = 'shopify_token_key';
  IF _key_uuid IS NULL THEN
    RAISE EXCEPTION 'shopify_token_key not provisioned';
  END IF;

  _ciphertext := pgsodium.crypto_aead_det_encrypt(
    convert_to(_access_token, 'utf8'),
    convert_to(_shop_domain, 'utf8'),  -- additional data binds ciphertext to shop
    _key_uuid
  );

  INSERT INTO public.shopify_installations
    (user_id, shop_domain, access_token_encrypted, scope, raw_install_payload, installed_at, uninstalled_at, needs_reconnect)
  VALUES
    (_user_id, _shop_domain, _ciphertext, _scope, _raw_payload, now(), NULL, false)
  ON CONFLICT (shop_domain) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        scope = EXCLUDED.scope,
        raw_install_payload = EXCLUDED.raw_install_payload,
        installed_at = now(),
        uninstalled_at = NULL,
        needs_reconnect = false,
        updated_at = now()
  RETURNING id INTO _row_id;

  RETURN _row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.shopify_store_token(text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.shopify_get_token(_shop_domain text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgsodium
AS $$
DECLARE
  _key_uuid uuid;
  _ct bytea;
  _plain bytea;
BEGIN
  SELECT id INTO _key_uuid FROM pgsodium.key WHERE name = 'shopify_token_key';
  SELECT access_token_encrypted INTO _ct
  FROM public.shopify_installations
  WHERE shop_domain = _shop_domain
    AND uninstalled_at IS NULL
    AND access_token_encrypted IS NOT NULL;

  IF _ct IS NULL THEN
    RETURN NULL;
  END IF;

  _plain := pgsodium.crypto_aead_det_decrypt(
    _ct,
    convert_to(_shop_domain, 'utf8'),
    _key_uuid
  );

  RETURN convert_from(_plain, 'utf8');
END;
$$;

REVOKE ALL ON FUNCTION public.shopify_get_token(text) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- Mark installation as needing reconnect (called on Admin API 401/403)
-- ============================================================
CREATE OR REPLACE FUNCTION public.shopify_mark_uninstalled(_shop_domain text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.shopify_installations
  SET uninstalled_at = now(),
      access_token_encrypted = NULL,
      needs_reconnect = true,
      updated_at = now()
  WHERE shop_domain = _shop_domain;

  -- Wipe synced product cache for that shop
  DELETE FROM public.shopify_products_cache WHERE shop_domain = _shop_domain;
END;
$$;

REVOKE ALL ON FUNCTION public.shopify_mark_uninstalled(text) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- Cleanup expired oauth state rows (called by pg_cron eventually)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_shopify_oauth_state()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n int;
BEGIN
  DELETE FROM public.shopify_oauth_state
  WHERE expires_at < now() - interval '1 hour';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
