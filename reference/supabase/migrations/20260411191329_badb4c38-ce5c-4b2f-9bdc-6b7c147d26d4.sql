
DELETE FROM public.shot_breakdowns
WHERE case_id IN (
  SELECT id FROM public.creative_cases
  WHERE created_at = '2026-04-11 19:05:53.978764+00'
);

DELETE FROM public.creative_cases
WHERE created_at = '2026-04-11 19:05:53.978764+00';
