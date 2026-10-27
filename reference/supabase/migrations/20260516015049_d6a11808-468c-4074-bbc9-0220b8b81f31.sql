ALTER TABLE public.channel_subscriptions
  DROP CONSTRAINT IF EXISTS channel_subscriptions_channel_check;

UPDATE public.channel_subscriptions
SET channel = 'web', updated_at = now()
WHERE channel = 'main';

ALTER TABLE public.channel_subscriptions
  ADD CONSTRAINT channel_subscriptions_channel_check
  CHECK (channel IN ('web', 'shopify'));

INSERT INTO public.channel_subscriptions (
  user_id,
  channel,
  external_id,
  plan_handle,
  status,
  monthly_credits,
  current_period_start,
  raw
)
SELECT
  us.user_id,
  'web',
  'web:' || us.user_id::text,
  us.tier::text,
  'active',
  us.monthly_credits,
  us.billing_cycle_start,
  jsonb_build_object('source', 'backfill_from_user_subscriptions', 'tier', us.tier::text)
FROM public.user_subscriptions us
WHERE us.tier::text <> 'free'
ON CONFLICT (channel, external_id) DO UPDATE
SET
  plan_handle = EXCLUDED.plan_handle,
  status = 'active',
  monthly_credits = EXCLUDED.monthly_credits,
  current_period_start = EXCLUDED.current_period_start,
  updated_at = now();