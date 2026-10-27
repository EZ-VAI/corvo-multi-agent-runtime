-- Allow service-role (used by edge functions) to manage creative_cases
CREATE POLICY "Service role can update creative_cases"
ON public.creative_cases
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can insert creative_cases"
ON public.creative_cases
FOR INSERT
TO service_role
WITH CHECK (true);

-- Allow service-role to manage shot_breakdowns
CREATE POLICY "Service role can insert shot_breakdowns"
ON public.shot_breakdowns
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Service role can update shot_breakdowns"
ON public.shot_breakdowns
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can delete shot_breakdowns"
ON public.shot_breakdowns
FOR DELETE
TO service_role
USING (true);