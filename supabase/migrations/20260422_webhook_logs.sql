CREATE TABLE webhook_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  payload jsonb,
  error text,
  profile_id text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON webhook_logs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
