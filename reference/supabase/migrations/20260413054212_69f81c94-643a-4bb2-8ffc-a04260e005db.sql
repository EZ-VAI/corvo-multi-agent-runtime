
-- Add pipeline_mode to ad_drafts
ALTER TABLE public.ad_drafts
ADD COLUMN pipeline_mode text NOT NULL DEFAULT 'brand_film';

-- Create presenter_avatars table (global resource, not per-user)
CREATE TABLE public.presenter_avatars (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  heygen_avatar_id text NOT NULL,
  preview_url text,
  voice_id text,
  language text NOT NULL DEFAULT 'en',
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.presenter_avatars ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view active avatars
CREATE POLICY "Authenticated users can view active avatars"
ON public.presenter_avatars
FOR SELECT
TO authenticated
USING (active = true);

-- Only admins can manage avatars (via service role or has_role check)
CREATE POLICY "Admins can insert avatars"
ON public.presenter_avatars
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update avatars"
ON public.presenter_avatars
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete avatars"
ON public.presenter_avatars
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Timestamp trigger
CREATE TRIGGER update_presenter_avatars_updated_at
BEFORE UPDATE ON public.presenter_avatars
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
