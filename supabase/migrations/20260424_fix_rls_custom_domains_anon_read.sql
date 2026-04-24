-- Allow anon to read verified custom domains (needed by middleware for custom domain routing)
-- Only exposes: domain, form_id, verified status — no user_id or sensitive fields
CREATE POLICY "Anon can read verified custom domains"
  ON custom_domains
  FOR SELECT
  USING (verified = true);
