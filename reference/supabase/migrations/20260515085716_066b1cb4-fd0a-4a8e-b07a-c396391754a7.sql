
ALTER TABLE public.shopify_installations
  ADD COLUMN IF NOT EXISTS shopify_user_id text,
  ADD COLUMN IF NOT EXISTS shopify_user_email text;

CREATE INDEX IF NOT EXISTS shopify_installations_shop_user_idx
  ON public.shopify_installations (shop_domain, shopify_user_id)
  WHERE uninstalled_at IS NULL AND shopify_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.shopify_store_token_for_user(
  _user_id uuid,
  _shop_domain text,
  _access_token text,
  _refresh_token text,
  _expires_in integer,
  _scope text,
  _raw_payload jsonb DEFAULT '{}'::jsonb,
  _shopify_user_id text DEFAULT NULL,
  _shopify_user_email text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _existing RECORD;
  _collision uuid;
  _access_secret_id uuid;
  _refresh_secret_id uuid;
  _row_id uuid;
  _expires_at timestamptz;
BEGIN
  IF _user_id IS NULL OR _shop_domain IS NULL OR _access_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;

  _expires_at := CASE
    WHEN _expires_in IS NOT NULL AND _expires_in > 0
    THEN now() + (_expires_in || ' seconds')::interval
    ELSE NULL
  END;

  SELECT id INTO _collision
  FROM public.shopify_installations
  WHERE shop_domain = _shop_domain
    AND uninstalled_at IS NULL
    AND user_id IS NOT NULL
    AND user_id <> _user_id
  LIMIT 1;

  IF _collision IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'collision');
  END IF;

  SELECT id, vault_access_secret_id, vault_refresh_secret_id
    INTO _existing
  FROM public.shopify_installations
  WHERE shop_domain = _shop_domain
    AND user_id = _user_id
    AND uninstalled_at IS NULL
  ORDER BY installed_at DESC
  LIMIT 1
  FOR UPDATE;

  IF _existing.id IS NOT NULL THEN
    IF _existing.vault_access_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(_existing.vault_access_secret_id, _access_token);
      _access_secret_id := _existing.vault_access_secret_id;
    ELSE
      _access_secret_id := vault.create_secret(
        _access_token,
        'shopify_access_' || _shop_domain || '_' || extract(epoch from now())::text,
        'Shopify access token for ' || _shop_domain
      );
    END IF;

    IF _refresh_token IS NOT NULL AND length(_refresh_token) > 0 THEN
      IF _existing.vault_refresh_secret_id IS NOT NULL THEN
        PERFORM vault.update_secret(_existing.vault_refresh_secret_id, _refresh_token);
        _refresh_secret_id := _existing.vault_refresh_secret_id;
      ELSE
        _refresh_secret_id := vault.create_secret(
          _refresh_token,
          'shopify_refresh_' || _shop_domain || '_' || extract(epoch from now())::text,
          'Shopify refresh token for ' || _shop_domain
        );
      END IF;
    ELSE
      _refresh_secret_id := _existing.vault_refresh_secret_id;
    END IF;

    UPDATE public.shopify_installations
    SET vault_access_secret_id = _access_secret_id,
        vault_refresh_secret_id = _refresh_secret_id,
        access_token_expires_at = _expires_at,
        scope = _scope,
        raw_install_payload = _raw_payload,
        shopify_user_id = COALESCE(_shopify_user_id, shopify_user_id),
        shopify_user_email = COALESCE(_shopify_user_email, shopify_user_email),
        last_refresh_at = now(),
        installed_at = now(),
        needs_reconnect = false,
        updated_at = now()
    WHERE id = _existing.id;

    RETURN jsonb_build_object(
      'ok', true,
      'install_id', _existing.id,
      'already_installed', true
    );
  END IF;

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
    user_id, shop_domain,
    vault_access_secret_id, vault_refresh_secret_id,
    access_token_expires_at, scope, raw_install_payload,
    shopify_user_id, shopify_user_email,
    installed_at, uninstalled_at, needs_reconnect
  ) VALUES (
    _user_id, _shop_domain,
    _access_secret_id, _refresh_secret_id,
    _expires_at, _scope, _raw_payload,
    _shopify_user_id, _shopify_user_email,
    now(), NULL, false
  )
  RETURNING id INTO _row_id;

  RETURN jsonb_build_object(
    'ok', true,
    'install_id', _row_id,
    'already_installed', false
  );
END;
$function$;
