-- Allow anonymous (guest) uploads to product-images/guest/* so visitors can try before signing in.
-- Authenticated user uploads remain scoped to their own uid folder via existing policies.
CREATE POLICY "Anon guest upload product images"
ON storage.objects FOR INSERT TO anon
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = 'guest'
);