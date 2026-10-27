
-- Subscriptions: align with useCredits.ts TIER_INFO ($0.10/cr)
UPDATE public.credit_packages SET credits = 70,  price_cents = 699   WHERE name = 'Launcher';
UPDATE public.credit_packages SET credits = 170, price_cents = 1699  WHERE name = 'Starter';
UPDATE public.credit_packages SET credits = 400, price_cents = 3999  WHERE name = 'Pro';
UPDATE public.credit_packages SET credits = 1300, price_cents = 12900 WHERE name = 'Business';

-- One-time Boost packs at $0.10/cr
UPDATE public.credit_packages SET price_cents = 500   WHERE name = 'Boost 50';
UPDATE public.credit_packages SET price_cents = 2000  WHERE name = 'Boost 200';
UPDATE public.credit_packages SET price_cents = 5000  WHERE name = 'Boost 500';

-- Promo: ~17% bonus vs base $0.10/cr
UPDATE public.credit_packages SET price_cents = 2500  WHERE name = '🔥 Launch Special';
