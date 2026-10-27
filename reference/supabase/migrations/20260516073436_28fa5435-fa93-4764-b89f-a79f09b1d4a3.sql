
CREATE OR REPLACE FUNCTION public.check_advance_generation_cron_secret(_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'advance_generation_cron_secret'
      AND decrypted_secret = _token
  );
$$;

REVOKE EXECUTE ON FUNCTION public.check_advance_generation_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_advance_generation_cron_secret(text) TO service_role;
