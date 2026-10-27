-- Move vector extension out of public
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION vector SET SCHEMA extensions;

-- Restrict match_user_preferences to caller's own data
CREATE OR REPLACE FUNCTION public.match_user_preferences(
  _user_id uuid,
  _query_embedding extensions.vector(1536),
  _match_count int DEFAULT 8,
  _min_similarity float DEFAULT 0.55
)
RETURNS TABLE (
  id uuid,
  signal_type text,
  category text,
  context text,
  original_value text,
  chosen_value text,
  summary text,
  similarity float,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Allow service_role unrestricted; signed-in users can only query themselves
  IF auth.role() <> 'service_role' AND auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
    SELECT
      s.id, s.signal_type, s.category, s.context,
      s.original_value, s.chosen_value, s.summary,
      (1 - (s.embedding <=> _query_embedding))::float AS similarity,
      s.created_at
    FROM public.agent_preference_signals s
    WHERE s.user_id = _user_id
      AND s.embedding IS NOT NULL
      AND 1 - (s.embedding <=> _query_embedding) >= _min_similarity
    ORDER BY s.embedding <=> _query_embedding
    LIMIT _match_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_user_preferences(uuid, extensions.vector, int, float) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_user_preferences(uuid, extensions.vector, int, float) TO authenticated, service_role;