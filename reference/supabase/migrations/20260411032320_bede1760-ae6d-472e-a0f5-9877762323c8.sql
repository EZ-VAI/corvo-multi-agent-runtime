CREATE OR REPLACE FUNCTION public.add_credits_atomic(_user_id uuid, _amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_subscriptions
  SET credits_balance = credits_balance + _amount,
      updated_at = now()
  WHERE user_id = _user_id;
END;
$$;
