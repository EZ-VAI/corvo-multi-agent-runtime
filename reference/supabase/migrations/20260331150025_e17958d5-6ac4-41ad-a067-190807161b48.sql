-- Create storage bucket for draft media (keyframes + clips)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('draft-media', 'draft-media', false, 104857600, ARRAY['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'])
ON CONFLICT (id) DO NOTHING;

-- RLS: users can upload/read/delete their own files (path starts with their user_id)
CREATE POLICY "Users can upload own draft media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'draft-media' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read own draft media"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'draft-media' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own draft media"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'draft-media' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update own draft media"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'draft-media' AND (storage.foldername(name))[1] = auth.uid()::text);