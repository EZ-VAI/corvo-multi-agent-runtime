INSERT INTO storage.buckets (id, name, public) VALUES ('motion-templates', 'motion-templates', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can view motion templates" ON storage.objects FOR SELECT USING (bucket_id = 'motion-templates');

CREATE POLICY "Service role can upload motion templates" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'motion-templates' AND auth.role() = 'service_role');