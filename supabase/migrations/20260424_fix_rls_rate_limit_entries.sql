-- P0 FIX: Enable RLS on rate_limit_entries and restrict to service_role only
-- Without this, any anon user could read/manipulate rate limit data

ALTER TABLE rate_limit_entries ENABLE ROW LEVEL SECURITY;

-- Remove any existing permissive policies
DO $$ BEGIN
  DROP POLICY IF EXISTS "anon_read_rate_limits" ON rate_limit_entries;
  DROP POLICY IF EXISTS "authenticated_read_rate_limits" ON rate_limit_entries;
  DROP POLICY IF EXISTS "authenticated_manage_rate_limits" ON rate_limit_entries;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Only service_role can manage rate limits (no anon or authenticated access)
CREATE POLICY "service_role_all_rate_limits" ON rate_limit_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Deny all other roles (anon, authenticated)
CREATE POLICY "deny_all_rate_limits" ON rate_limit_entries
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
