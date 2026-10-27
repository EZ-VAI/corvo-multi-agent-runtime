
-- Subscription tiers enum
CREATE TYPE public.subscription_tier AS ENUM ('free', 'starter', 'pro', 'business');

-- User subscriptions table
CREATE TABLE public.user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  tier subscription_tier NOT NULL DEFAULT 'free',
  credits_balance INTEGER NOT NULL DEFAULT 0,
  monthly_credits INTEGER NOT NULL DEFAULT 0,
  credits_used_this_month INTEGER NOT NULL DEFAULT 0,
  billing_cycle_start TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Credit transactions ledger
CREATE TABLE public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'generation', 'purchase', 'subscription_grant', 'free_grant', 'admin_grant'
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Credit packages for purchase
CREATE TABLE public.credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  price_cents INTEGER NOT NULL, -- price in cents USD
  popular BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Admin roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- RLS
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role function (security definer to avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- User subscriptions: users can read their own
CREATE POLICY "Users can view own subscription" ON public.user_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Credit transactions: users can read their own
CREATE POLICY "Users can view own transactions" ON public.credit_transactions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Credit packages: anyone can read active packages
CREATE POLICY "Anyone can view active packages" ON public.credit_packages
  FOR SELECT TO authenticated USING (active = true);

-- User roles: users can read their own
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Auto-create subscription on signup
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.user_subscriptions (user_id, tier, credits_balance, monthly_credits)
  VALUES (NEW.id, 'free', 20, 20);
  
  INSERT INTO public.credit_transactions (user_id, amount, type, description)
  VALUES (NEW.id, 20, 'free_grant', 'Welcome credits');
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();

-- Seed credit packages
INSERT INTO public.credit_packages (name, credits, price_cents, popular) VALUES
  ('Starter Pack', 50, 499, false),
  ('Creator Pack', 150, 1199, true),
  ('Studio Pack', 500, 2999, false),
  ('Agency Pack', 2000, 9999, false);

-- Function to deduct credits (called from edge functions)
CREATE OR REPLACE FUNCTION public.deduct_credits(_user_id UUID, _amount INTEGER, _description TEXT, _metadata JSONB DEFAULT '{}')
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_balance INTEGER;
  is_admin BOOLEAN;
BEGIN
  -- Admins have unlimited credits
  SELECT public.has_role(_user_id, 'admin') INTO is_admin;
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
