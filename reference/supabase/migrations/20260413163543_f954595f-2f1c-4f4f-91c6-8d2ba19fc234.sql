
-- Create internal helper only usable by other SECURITY DEFINER functions
CREATE OR REPLACE FUNCTION public._has_role_internal(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Revoke execute from public roles so only SECURITY DEFINER functions can use it
REVOKE EXECUTE ON FUNCTION public._has_role_internal(uuid, app_role) FROM public;
REVOKE EXECUTE ON FUNCTION public._has_role_internal(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public._has_role_internal(uuid, app_role) FROM authenticated;

-- Update deduct_credits to use internal helper
CREATE OR REPLACE FUNCTION public.deduct_credits(_user_id uuid, _amount integer, _description text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance INTEGER;
  is_admin BOOLEAN;
BEGIN
  SELECT public._has_role_internal(_user_id, 'admin') INTO is_admin;
  IF is_admin THEN
    INSERT INTO public.credit_transactions (user_id, amount, type, description, metadata)
    VALUES (_user_id, -_amount, 'generation', _description, _metadata);
    RETURN TRUE;
  END IF;

  SELECT credits_balance INTO current_balance FROM public.user_subscriptions WHERE user_id = _user_id;
  IF current_balance IS NULL OR current_balance < _amount THEN
    RETURN FALSE;
  END IF;

  UPDATE public.user_subscriptions
  SET credits_balance = credits_balance - _amount,
      credits_used_this_month = credits_used_this_month + _amount,
      updated_at = now()
  WHERE user_id = _user_id;

  INSERT INTO public.credit_transactions (user_id, amount, type, description, metadata)
  VALUES (_user_id, -_amount, 'generation', _description, _metadata);

  RETURN TRUE;
END;
$$;
