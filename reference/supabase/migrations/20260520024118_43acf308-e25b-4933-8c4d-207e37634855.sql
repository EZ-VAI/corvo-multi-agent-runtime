-- P1: Enable pgvector for semantic preference recall
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding + summary to preference signals
ALTER TABLE public.agent_preference_signals
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Approximate-nearest-neighbor index (cosine)
CREATE INDEX IF NOT EXISTS idx_agent_pref_signals_embedding
  ON public.agent_preference_signals
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RPC: semantic match for a user's preference signals
CREATE OR REPLACE FUNCTION public.match_user_preferences(
  _user_id uuid,
  _query_embedding vector(1536),
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id, s.signal_type, s.category, s.context,
    s.original_value, s.chosen_value, s.summary,
    1 - (s.embedding <=> _query_embedding) AS similarity,
    s.created_at
  FROM public.agent_preference_signals s
  WHERE s.user_id = _user_id
    AND s.embedding IS NOT NULL
    AND 1 - (s.embedding <=> _query_embedding) >= _min_similarity
  ORDER BY s.embedding <=> _query_embedding
  LIMIT _match_count;
$$;

-- P0: persistent dynamic plan + reflection log per conversation
ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS current_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reflection_log jsonb NOT NULL DEFAULT '[]'::jsonb;