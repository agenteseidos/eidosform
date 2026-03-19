-- Migration: Fix response limit to read from DB columns instead of hardcoded values
-- Uses profiles.responses_used and profiles.responses_limit columns from schema

-- Function to atomically increment responses_used
CREATE OR REPLACE FUNCTION increment_responses_used(p_user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET responses_used = responses_used + 1
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
