CREATE TABLE public.mcp_image_uploads (
  upload_id UUID NOT NULL DEFAULT gen_random_uuid(),
  chunk_index INTEGER NOT NULL,
  chunk_data TEXT NOT NULL,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (upload_id, chunk_index)
);

ALTER TABLE public.mcp_image_uploads ENABLE ROW LEVEL SECURITY;

-- service role only; no client policies (MCP server uses service role)
CREATE INDEX idx_mcp_image_uploads_created ON public.mcp_image_uploads(created_at);