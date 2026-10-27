
-- 1. shopify_installations: pending state + re-install support
ALTER TABLE public.shopify_installations
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.shopify_installations
  ADD COLUMN IF NOT EXISTS pending_id text,
  ADD COLUMN IF NOT EXISTS pending_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_refresh_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_installations_pending_id
  ON public.shopify_installations(pending_id)
  WHERE pending_id IS NOT NULL;

-- Replace global UNIQUE with partial UNIQUE (only active rows)
ALTER TABLE public.shopify_installations
  DROP CONSTRAINT IF EXISTS shopify_installations_shop_domain_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_installations_shop_active
  ON public.shopify_installations(shop_domain)
  WHERE uninstalled_at IS NULL;

-- 2. oauth_state: support Shopify-initiated installs (no user yet)
ALTER TABLE public.shopify_oauth_state
  ALTER COLUMN user_id DROP NOT NULL;

-- 3. claim audit table
CREATE TABLE IF NOT EXISTS public.shopify_claim_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_id text NOT NULL,
  shop_domain text NOT NULL DEFAULT '',
  user_id uuid,
  ip text,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shopify_claim_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view shopify_claim_audit" ON public.shopify_claim_audit;
CREATE POLICY "Admins view shopify_claim_audit"
  ON public.shopify_claim_audit FOR SELECT TO authenticated
  USING (has_role('admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_shopify_claim_audit_pending_id
  ON public.shopify_claim_audit(pending_id, created_at DESC);

-- 4. Drop old store_token (relied on ON CONFLICT against dropped constraint)
DROP FUNCTION IF EXISTS public.shopify_store_token(text, uuid, text, text, jsonb);

-- 5. New: store token in pending (no user_id) row
CREATE OR REPLACE FUNCTION public.shopify_store_token_pending(
  _shop_domain text,
  _access_token text,
  _scope text,
  _pending_id text,
  _pending_expires_at timestamptz,
  _raw_payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pgsodium
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
    convert_to(_shop_domain, 'utf8'),
    _key_uuid
  );

  -- Soft-archive any prior abandoned pending row for this shop
  UPDATE public.shopify_installations
  SET uninstalled_at = now(), updated_at = now()
  WHERE shop_domain = _shop_domain
    AND uninstalled_at IS NULL
    AND user_id IS NULL;

  INSERT INTO public.shopify_installations (
    user_id, shop_domain, access_token_encrypted, scope, raw_install_payload,
    pending_id, pending_expires_at, installed_at, uninstalled_at, needs_reconnect
  ) VALUES (
    NULL, _shop_domain, _ciphertext, _scope, _raw_payload,
    _pending_id, _pending_expires_at, now(), NULL, false
  )
  RETURNING id INTO _row_id;

  RETURN _row_id;
END;
$$;

-- 6. New: refresh access token in place (re-install for already-bound shop)
CREATE OR REPLACE FUNCTION public.shopify_refresh_token(
  _shop_domain text,
  _access_token text,
  _scope text,
  _raw_payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pgsodium
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
    convert_to(_shop_domain, 'utf8'),
    _key_uuid
  );

  UPDATE public.shopify_installations
  SET access_token_encrypted = _ciphertext,
      scope = _scope,
      raw_install_payload = _raw_payload,
      last_refresh_at = now(),
      installed_at = now(),
      needs_reconnect = false,
      updated_at = now()
  WHERE shop_domain = _shop_domain
    AND uninstalled_at IS NULL
    AND user_id IS NOT NULL
  RETURNING id INTO _row_id;

  RETURN _row_id;
END;
$$;

-- 7. New: atomic claim with rate limit, expiry, collision detection, audit
CREATE OR REPLACE FUNCTION public.shopify_claim_install(
  _pending_id text,
  _user_id uuid,
  _ip text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _row RECORD;
  _existing uuid;
BEGIN
  SELECT id, user_id, shop_domain, pending_expires_at, claim_attempts, uninstalled_at
    INTO _row
  FROM public.shopify_installations
  WHERE pending_id = _pending_id
  FOR UPDATE;

  IF _row.id IS NULL THEN
    INSERT INTO public.shopify_claim_audit(pending_id, shop_domain, user_id, ip, outcome)
    VALUES (_pending_id, '', _user_id, _ip, 'not_found');
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF _row.uninstalled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'uninstalled');
  END IF;

  IF _row.user_id IS NOT NULL THEN
    INSERT INTO public.shopify_claim_audit(pending_id, shop_domain, user_id, ip, outcome)
    VALUES (_pending_id, _row.shop_domain, _user_id, _ip, 'already_claimed');
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed');
  END IF;

  IF _row.pending_expires_at IS NULL OR _row.pending_expires_at < now() THEN
    INSERT INTO public.shopify_claim_audit(pending_id, shop_domain, user_id, ip, outcome)
    VALUES (_pending_id, _row.shop_domain, _user_id, _ip, 'expired');
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  IF _row.claim_attempts >= 3 THEN
    INSERT INTO public.shopify_claim_audit(pending_id, shop_domain, user_id, ip, outcome)
    VALUES (_pending_id, _row.shop_domain, _user_id, _ip, 'rate_limited');
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  UPDATE public.shopify_installations
  SET claim_attempts = claim_attempts + 1, updated_at = now()
  WHERE id = _row.id;

  -- Collision: shop already actively bound to a different user
  SELECT id INTO _existing FROM public.shopify_installations
  WHERE shop_domain = _row.shop_domain
    AND uninstalled_at IS NULL
    AND user_id IS NOT NULL
    AND id <> _row.id
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    INSERT INTO public.shopify_claim_audit(pending_id, shop_domain, user_id, ip, outcome)
    VALUES (_pending_id, _row.shop_domain, _user_id, _ip, 'collision');
    RETURN jsonb_build_object('ok', false, 'reason', 'collision');
  END IF;

  UPDATE public.shopify_installations
  SET user_id = _user_id,
      pending_id = NULL,
      pending_expires_at = NULL,
      updated_at = now()
  WHERE id = _row.id;

  INSERT INTO public.shopify_claim_audit(pending_id, shop_domain, user_id, ip, outcome)
  VALUES (_pending_id, _row.shop_domain, _user_id, _ip, 'claimed');

  RETURN jsonb_build_object('ok', true, 'shop_domain', _row.shop_domain, 'install_id', _row.id);
END;
$$;

-- 8. Cleanup expired pending rows
CREATE OR REPLACE FUNCTION public.cleanup_shopify_pending()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  DELETE FROM public.shopify_installations
  WHERE pending_id IS NOT NULL
    AND pending_expires_at IS NOT NULL
    AND pending_expires_at < now() - interval '1 day';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
