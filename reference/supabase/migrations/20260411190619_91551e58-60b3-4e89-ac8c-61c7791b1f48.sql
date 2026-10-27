
-- Delete shot_breakdowns for old cases first (foreign key)
DELETE FROM public.shot_breakdowns
WHERE case_id IN (
  SELECT id FROM public.creative_cases
  WHERE created_at < '2026-04-11T00:00:00Z'
);

-- Delete old creative_cases
DELETE FROM public.creative_cases
WHERE created_at < '2026-04-11T00:00:00Z';
