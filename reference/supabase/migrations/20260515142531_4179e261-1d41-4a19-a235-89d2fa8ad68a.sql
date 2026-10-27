
-- =====================================================================
-- Phase 4: Unified credit wallet (multi-channel)
-- Additive migration. Does NOT alter user_subscriptions or existing RPCs.
-- =====================================================================

-- 1. channel_subscriptions: per-channel subscription state
CREATE TABLE IF NOT EXISTS public.channel_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('main','shopify')),
  external_id text NOT NULL,
  plan_handle text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','past_due','canceled','expired','pending')),
  monthly_credits integer NOT NULL DEFAULT 0,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  canceled_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_subscriptions_channel_external_unique UNIQUE (channel, external_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_subs_user
  ON public.channel_subscriptions (user_id, channel, status);

ALTER TABLE public.channel_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own channel subscriptions"
  ON public.channel_subscriptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "No client inserts on channel_subscriptions"
  ON public.channel_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "No client updates on channel_subscriptions"
  ON public.channel_subscriptions FOR UPDATE
  TO authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "No client deletes on channel_subscriptions"
  ON public.channel_subscriptions FOR DELETE
  TO authenticated
  USING (false);

CREATE TRIGGER trg_channel_subs_updated
  BEFORE UPDATE ON public.channel_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Extend credit_transactions for multi-channel attribution + idempotency
ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS source text,         -- waffo|shopify|admin|signup|manual
  ADD COLUMN IF NOT EXISTS channel text,        -- main|shopify|null
  ADD COLUMN IF NOT EXISTS reference_id text,   -- external charge / sub renewal id
  ADD COLUMN IF NOT EXISTS period_start timestamptz;

-- Partial unique index — guarantees a single (channel, reference_id, period_start)
-- can only be credited once. Renewal webhooks pass the same triplet on retry → no double credit.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_credit_tx_channel_ref_period
  ON public.credit_transactions (channel, reference_id, period_start)
  WHERE reference_id IS NOT NULL;

-- 3. add_credits_to_wallet — idempotent wrapper
-- Returns jsonb { ok, already_added?, balance? }
CREATE OR REPLACE FUNCTION public.add_credits_to_wallet(
  _user_id uuid,
  _amount integer,
  _source text,
  _channel text,
  _reference_id text,
  _period_start timestamptz,
  _description text,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing_id uuid;
  _new_balance integer;
BEGIN
  IF _user_id IS NULL OR _amount IS NULL OR _amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;

  -- Idempotency check (only when reference_id is provided)
  IF _reference_id IS NOT NULL THEN
    SELECT id INTO _existing_id
    FROM public.credit_transactions
    WHERE channel = _channel
      AND reference_id = _reference_id
      AND (period_start IS NOT DISTINCT FROM _period_start)
    LIMIT 1;

    IF _existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'already_added', true);
    END IF;
  END IF;

  -- Atomic credit add — ensure wallet row exists (legacy: user_subscriptions seeded by handle_new_user)
  UPDATE public.user_subscriptions
  SET credits_balance = credits_balance + _amount,
      updated_at = now()
  WHERE user_id = _user_id
  RETURNING credits_balance INTO _new_balance;

  IF _new_balance IS NULL THEN
    -- Defensive: seed wallet if missing (should not happen for normal users)
    INSERT INTO public.user_subscriptions (user_id, tier, credits_balance, monthly_credits)
    VALUES (_user_id, 'free', _amount, 0)
    RETURNING credits_balance INTO _new_balance;
  END IF;

  -- Audit row (unique index protects against race; on conflict → already_added)
  BEGIN
    INSERT INTO public.credit_transactions (
      user_id, amount, type, description, metadata,
      source, channel, reference_id, period_start
    ) VALUES (
      _user_id, _amount, 'purchase', _description, _metadata,
      _source, _channel, _reference_id, _period_start
    );
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent webhook race — roll back the credit add we just did
    UPDATE public.user_subscriptions
    SET credits_balance = credits_balance - _amount,
        updated_at = now()
    WHERE user_id = _user_id;
    RETURN jsonb_build_object('ok', true, 'already_added', true);
  END;

  RETURN jsonb_build_object('ok', true, 'already_added', false, 'balance', _new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.add_credits_to_wallet(uuid, integer, text, text, text, timestamptz, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits_to_wallet(uuid, integer, text, text, text, timestamptz, text, jsonb) TO service_role;
