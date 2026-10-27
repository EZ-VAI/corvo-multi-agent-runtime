UPDATE storage.buckets 
SET allowed_mime_types = ARRAY[
  'image/png', 'image/jpeg', 'image/webp', 
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/mp4'
]
WHERE name = 'draft-media';