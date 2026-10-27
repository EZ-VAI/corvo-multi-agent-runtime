
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.user_subscriptions (user_id, tier, credits_balance, monthly_credits)
  VALUES (NEW.id, 'free', 50, 50);
  
  INSERT INTO public.credit_transactions (user_id, amount, type, description)
  VALUES (NEW.id, 50, 'free_grant', 'Welcome credits');
  
  RETURN NEW;
END;
$function$;
