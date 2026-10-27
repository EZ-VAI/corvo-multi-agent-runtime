ALTER TABLE public.creative_cases
ADD CONSTRAINT creative_cases_brand_campaign_unique UNIQUE (brand, campaign_name);