-- Create project-bgm storage bucket for AI-generated background music tracks.
-- Public bucket so the audio URL can be loaded directly by <audio> tags in the editor without signed-URL refresh.
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-bgm', 'project-bgm', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload BGM into a folder named after their user_id
CREATE POLICY "Users can upload own BGM"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'project-bgm'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to update / replace their own BGM files (e.g. regenerate)
CREATE POLICY "Users can update own BGM"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'project-bgm'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to delete their own BGM
CREATE POLICY "Users can delete own BGM"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'project-bgm'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Public read so anyone (including unauthenticated previewers) can stream the track
CREATE POLICY "Public can read BGM"
ON storage.objects
FOR SELECT
USING (bucket_id = 'project-bgm');
