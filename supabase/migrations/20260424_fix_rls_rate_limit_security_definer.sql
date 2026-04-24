-- P1 FIX: Add SECURITY DEFINER to rate limit functions
-- Without this, RLS deny policy blocks anon/authenticated from calling these functions,
-- breaking persistent rate limiting (falls back to in-memory only, which resets on cold starts).

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT,
  p_window_ms INTEGER DEFAULT 60000,
  p_max_requests INTEGER DEFAULT 10
) RETURNS TABLE(allowed BOOLEAN, current_count INTEGER, reset_in_ms INTEGER) 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
  v_now TIMESTAMPTZ := now();
  v_window_interval INTERVAL := (p_window_ms || ' milliseconds')::INTERVAL;
BEGIN
  DELETE FROM rate_limit_entries
  WHERE rate_limit_entries.key = p_key
    AND window_start < v_now - v_window_interval;

  SELECT rle.window_start, rle.count INTO v_window_start, v_count
  FROM rate_limit_entries rle
  WHERE rle.key = p_key
    AND rle.window_start >= v_now - v_window_interval
  ORDER BY rle.window_start DESC
  LIMIT 1;

  IF v_window_start IS NULL THEN
    INSERT INTO rate_limit_entries (key, window_start, count)
    VALUES (p_key, v_now, 1);
    RETURN QUERY SELECT true, 1, p_window_ms;
  ELSIF v_count >= p_max_requests THEN
    RETURN QUERY SELECT false, v_count,
      EXTRACT(EPOCH FROM (v_window_start + v_window_interval - v_now))::INTEGER * 1000;
  ELSE
    UPDATE rate_limit_entries rle
    SET count = count + 1
    WHERE rle.key = p_key AND rle.window_start = v_window_start;
    RETURN QUERY SELECT true, v_count + 1,
      EXTRACT(EPOCH FROM (v_window_start + v_window_interval - v_now))::INTEGER * 1000;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_rate_limit_entries() RETURNS void 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM rate_limit_entries WHERE window_start < now() - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql;
