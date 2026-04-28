-- Migration: Hash API keys for secure storage
-- Strategy: Store SHA-256 hash of API key in profiles.api_key_hash column.
-- The plaintext api_key column is kept temporarily for migration, then cleared.
-- Auth flow: compute hash of incoming key, compare against api_key_hash.

-- 1. Add api_key_hash column if not exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS api_key_hash text;

-- 2. Migrate existing plaintext keys to hashes
-- For each profile with a non-null api_key, compute SHA-256 hash
UPDATE profiles
SET api_key_hash = encode(digest(api_key, 'sha256'), 'hex')
WHERE api_key IS NOT NULL AND api_key_hash IS NULL;

-- 3. Create function to verify API key against hash
CREATE OR REPLACE FUNCTION verify_api_key_hash(p_api_key text)
RETURNS TABLE(id uuid, plan text, api_key_hash text) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.plan, p.api_key_hash
  FROM profiles p
  WHERE p.api_key_hash = encode(digest(p_api_key, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Clear plaintext api_key values (keep column for backward compat reference)
-- After verifying migration success, the plaintext column should be dropped in a future migration.
-- For now, we set it to null to avoid storing plaintext.
UPDATE profiles SET api_key = NULL WHERE api_key IS NOT NULL;
