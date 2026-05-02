-- Create form-uploads bucket (public read, no anonymous insert)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'form-uploads',
  'form-uploads',
  true,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read files from form-uploads
CREATE POLICY "Public read form-uploads"
ON storage.objects FOR SELECT
USING (bucket_id = 'form-uploads');

-- No INSERT policy for anon — uploads only via signed URL (service_role)
