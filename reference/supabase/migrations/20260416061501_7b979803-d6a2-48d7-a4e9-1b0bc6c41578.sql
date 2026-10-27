-- Add launcher to subscription_tier enum
ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'launcher' BEFORE 'starter';