
-- Cross-session brand DNA memory (per user, per brand)
CREATE TABLE public.agent_brand_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brand_name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  anchor_word text DEFAULT '',
  visual_bible jsonb NOT NULL DEFAULT '{}',
  creative_references text DEFAULT '',
  product_images text[] NOT NULL DEFAULT '{}',
  is_wearable boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}',
  source_conversation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_brand_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own brand memory"
  ON public.agent_brand_memory FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own brand memory"
  ON public.agent_brand_memory FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own brand memory"
  ON public.agent_brand_memory FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own brand memory"
  ON public.agent_brand_memory FOR DELETE
  USING (user_id = auth.uid());

CREATE INDEX idx_agent_brand_memory_user ON public.agent_brand_memory(user_id);

CREATE TRIGGER update_agent_brand_memory_updated_at
  BEFORE UPDATE ON public.agent_brand_memory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Preference signals: append-only log of user choices
CREATE TABLE public.agent_preference_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid,
  signal_type text NOT NULL, -- 'approval', 'rejection', 'vibe_modify', 'style_choice', 'direction_choice'
  category text DEFAULT '',
  context text DEFAULT '',
  original_value text DEFAULT '',
  chosen_value text DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_preference_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preference signals"
  ON public.agent_preference_signals FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own preference signals"
  ON public.agent_preference_signals FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role can insert preference signals"
  ON public.agent_preference_signals FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE INDEX idx_agent_pref_signals_user ON public.agent_preference_signals(user_id);
CREATE INDEX idx_agent_pref_signals_category ON public.agent_preference_signals(user_id, category);
