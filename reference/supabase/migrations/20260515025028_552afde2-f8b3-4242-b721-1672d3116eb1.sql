
-- 1. Schema changes
ALTER TABLE public.shopify_installations
  ADD COLUMN IF NOT EXISTS vault_access_secret_id uuid,
  ADD COLUMN IF NOT EXISTS vault_refresh_secret_id uuid,
  ADD COLUMN IF NOT EXISTS access_token_expires_at timestamptz;

-- 2. Drop old pgsodium-based RPCs (recreated below against Vault)
DROP FUNCTION IF EXISTS public.shopify_store_token_pending(text, text, text, text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.shopify_refresh_token(text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.shopify_get_token(text);
DROP FUNCTION IF EXISTS public.shopify_mark_uninstalled(text);

-- 3. shopify_store_token_pending — store on first install (pending claim)
CREATE OR REPLACE FUNCTION public.shopify_store_token_pending(
  _shop_domain text,
  _access_token text,
  _refresh_token text,
  _expires_in integer,
  _scope text,
  _pending_id text,
  _pending_expires_at timestamptz,
  _raw_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _access_secret_id uuid;
  _refresh_secret_id uuid;
  _row_id uuid;
  _expires_at timestamptz;
BEGIN
  _expires_at := CASE WHEN _expires_in IS NOT NULL AND _expires_in > 0
                      THEN now() + (_expires_in || ' seconds')::interval
                      ELSE NULL END;

  -- Soft-archive any prior abandoned pending row for this shop
  UPDATE public.shopify_installations
  SET uninstalled_at = now(), updated_at = now()
  WHERE shop_domain = _shop_domain
    AND uninstalled_at IS NULL
    AND user_id IS NULL;

  _access_secret_id := vault.create_secret(
    _access_token,
    'shopify_access_' || _shop_domain || '_' || extract(epoch from now())::text,
    'Shopify access token for ' || _shop_domain
  );

  IF _refresh_token IS NOT NULL AND length(_refresh_token) > 0 THEN
    _refresh_secret_id := vault.create_secret(
      _refresh_token,
      'shopify_refresh_' || _shop_domain || '_' || extract(epoch from now())::text,
      'Shopify refresh token for ' || _shop_domain
    );
  END IF;

  INSERT INTO public.shopify_installations (
    user_id, shop_domain, vault_access_secret_id, vault_refresh_secret_id,
    access_token_expires_at, scope, raw_install_payload,
    pending_id, pending_expires_at, installed_at, uninstalled_at, needs_reconnect
  ) VALUES (
    NULL, _shop_domain, _access_secret_id, _refresh_secret_id,
    _expires_at, _scope, _raw_payload,
    _pending_id, _pending_expires_at, now(), NULL, false
  )
  RETURNING id INTO _row_id;

  RETURN _row_id;
END;
$$;

-- 4. shopify_refresh_token — re-install path (shop already bound to a user)
CREATE OR REPLACE FUNCTION public.shopify_refresh_token(
  _shop_domain text,
  _access_token text,
  _refresh_token text,
  _expires_in integer,
  _scope text,
  _raw_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _row RECORD;
  _new_access_id uuid;
  _new_refresh_id uuid;
  _expires_at timestamptz;
BEGIN
  _expires_at := CASE WHEN _expires_in IS NOT NULL AND _expires_in > 0
                      THEN now() + (_expires_in || ' seconds')::interval
                      ELSE NULL END;

  SELECT id, vault_access_secret_id, vault_refresh_secret_id
    INTO _row
  FROM public.shopify_installations
  WHERE shop_domain = _shop_domain
    AND uninstalled_at IS NULL
    AND user_id IS NOT NULL
  FOR UPDATE;

  IF _row.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Rotate access token in vault (or create if missing)
  IF _row.vault_access_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(_row.vault_access_secret_id, _access_token);
    _new_access_id := _row.vault_access_secret_id;
  ELSE
    _new_access_id := vault.create_secret(
      _access_token,
      'shopify_access_' || _shop_domain || '_' || extract(epoch from now())::text,
      'Shopify access token for ' || _shop_domain
    );
  END IF;

  -- Rotate refresh token in vault (or create if missing)
  IF _refresh_token IS NOT NULL AND length(_refresh_token) > 0 THEN
    IF _row.vault_refresh_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(_row.vault_refresh_secret_id, _refresh_token);
      _new_refresh_id := _row.vault_refresh_secret_id;
    ELSE
      _new_refresh_id := vault.create_secret(
        _refresh_token,
        'shopify_refresh_' || _shop_domain || '_' || extract(epoch from now())::text,
        'Shopify refresh token for ' || _shop_domain
      );
    END IF;
  ELSE
    _new_refresh_id := _row.vault_refresh_secret_id;
  END IF;

  UPDATE public.shopify_installations
  SET vault_access_secret_id = _new_access_id,
      vault_refresh_secret_id = _new_refresh_id,
      access_token_expires_at = _expires_at,
      scope = _scope,
      raw_install_payload = _raw_payload,
      last_refresh_at = now(),
      installed_at = now(),
      needs_reconnect = false,
      updated_at = now()
  WHERE id = _row.id;

  RETURN _row.id;
END;
$$;

-- 5. shopify_update_tokens_after_refresh — called by edge fn after Shopify refresh exchange
CREATE OR REPLACE FUNCTION public.shopify_update_tokens_after_refresh(
  _shop_domain text,
  _access_token text,
  _refresh_token text,
  _expires_in integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _row RECORD;
  _new_access_id uuid;
  _new_refresh_id uuid;
  _expires_at timestamptz;
BEGIN
  _expires_at := CASE WHEN _expires_in IS NOT NULL AND _expires_in > 0
                      THEN now() + (_expires_in || ' seconds')::interval
                      ELSE NULL END;

  SELECT id, vault_access_secret_id, vault_refresh_secret_id
    INTO _row
  FROM public.shopify_installations
  WHERE shop_domain = _shop_domain
    AND uninstalled_at IS NULL
  FOR UPDATE;

  IF _row.id IS NULL THEN
    RETURN false;
  END IF;

  IF _row.vault_access_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(_row.vault_access_secret_id, _access_token);
    _new_access_id := _row.vault_access_secret_id;
  ELSE
    _new_access_id := vault.create_secret(
      _access_token,
      'shopify_access_' || _shop_domain || '_' || extract(epoch from now())::text,
      'Shopify access token for ' || _shop_domain
    );
  END IF;

  IF _refresh_token IS NOT NULL AND length(_refresh_token) > 0 THEN
    IF _row.vault_refresh_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(_row.vault_refresh_secret_id, _refresh_token);
      _new_refresh_id := _row.vault_refresh_secret_id;
    ELSE
      _new_refresh_id := vault.create_secret(
        _refresh_token,
        'shopify_refresh_' || _shop_domain || '_' || extract(epoch from now())::text,
        'Shopify refresh token for ' || _shop_domain
      );
    END IF;
  ELSE
    _new_refresh_id := _row.vault_refresh_secret_id;
  END IF;

  UPDATE public.shopify_installations
  SET vault_access_secret_id = _new_access_id,
      vault_refresh_secret_id = _new_refresh_id,
      access_token_expires_at = _expires_at,
      last_refresh_at = now(),
      updated_at = now()
  WHERE id = _row.id;

  RETURN true;
END;
$$;

-- 6. shopify_get_token — returns access_token + expiry + refresh_token as jsonb
CREATE OR REPLACE FUNCTION public.shopify_get_token(_shop_domain text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _row RECORD;
  _access_token text;
  _refresh_token text;
BEGIN
  SELECT vault_access_secret_id, vault_refresh_secret_id, access_token_expires_at
    INTO _row
  FROM public.shopify_installations
  WHERE shop_domain = _shop_domain
    AND uninstalled_at IS NULL
    AND vault_access_secret_id IS NOT NULL
  ORDER BY installed_at DESC
  LIMIT 1;

  IF _row.vault_access_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO _access_token
  FROM vault.decrypted_secrets
  WHERE id = _row.vault_access_secret_id;

  IF _row.vault_refresh_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO _refresh_token
    FROM vault.decrypted_secrets
    WHERE id = _row.vault_refresh_secret_id;
  END IF;

  RETURN jsonb_build_object(
    'access_token', _access_token,
    'refresh_token', _refresh_token,
    'expires_at', _row.access_token_expires_at
  );
END;
$$;

-- 7. shopify_mark_uninstalled — also clear vault pointers (vault rows themselves left for audit)
CREATE OR REPLACE FUNCTION public.shopify_mark_uninstalled(_shop_domain text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.shopify_installations
  SET uninstalled_at = now(),
      vault_access_secret_id = NULL,
      vault_refresh_secret_id = NULL,
      access_token_encrypted = NULL,
      access_token_nonce = NULL,
      needs_reconnect = true,
      updated_at = now()
  WHERE shop_domain = _shop_domain;

  DELETE FROM public.shopify_products_cache WHERE shop_domain = _shop_domain;
END;
$$;
