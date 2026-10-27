CREATE POLICY "Authenticated users can upload to film-uploads"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = 'film-uploads'
  AND (storage.foldername(name))[2] = auth.uid()::text
);