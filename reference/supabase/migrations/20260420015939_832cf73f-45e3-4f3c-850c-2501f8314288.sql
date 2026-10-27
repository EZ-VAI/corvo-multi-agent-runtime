-- Add archive snapshot support to ad_drafts
ALTER TABLE public.ad_drafts
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_draft_id UUID REFERENCES public.ad_drafts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_ad_drafts_user_archived ON public.ad_drafts(user_id, archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_drafts_parent ON public.ad_drafts(parent_draft_id);