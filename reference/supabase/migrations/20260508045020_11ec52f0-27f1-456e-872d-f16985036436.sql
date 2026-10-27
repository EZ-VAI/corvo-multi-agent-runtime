
CREATE TABLE public.style_vibe_boards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  style_key TEXT NOT NULL,
  goal TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (style_key, goal)
);

ALTER TABLE public.style_vibe_boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read vibe boards"
  ON public.style_vibe_boards FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage vibe boards"
  ON public.style_vibe_boards FOR ALL
  TO authenticated
  USING (public.has_role('admin'))
  WITH CHECK (public.has_role('admin'));
