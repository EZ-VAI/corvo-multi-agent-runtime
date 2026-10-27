
CREATE POLICY "film-assets public read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'film-assets');

CREATE POLICY "film-assets service write"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'film-assets')
WITH CHECK (bucket_id = 'film-assets');
