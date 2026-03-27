-- Rate limit table for serverless-compatible persistent rate limiting
-- Replaces in-memory Maps that don't survive across Vercel function invocations

CREATE TABLE IF NOT EXISTS rate_limit_entries (
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_rate_limit_key ON rate_limit_entries(key);

-- Function to check and increment rate limit atomically
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT,
  p_window_ms INTEGER DEFAULT 60000,
  p_max_requests INTEGER DEFAULT 10
) RETURNS TABLE(allowed BOOLEAN, current_count INTEGER, reset_in_ms INTEGER) AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
  v_now TIMESTAMPTZ := now();
  v_window_interval INTERVAL := (p_window_ms || ' milliseconds')::INTERVAL;
BEGIN
  -- Clean old entries for this key
  DELETE FROM rate_limit_entries
  WHERE rate_limit_entries.key = p_key
    AND window_start < v_now - v_window_interval;

  -- Try to get current window
  SELECT rle.window_start, rle.count INTO v_window_start, v_count
  FROM rate_limit_entries rle
  WHERE rle.key = p_key
    AND rle.window_start >= v_now - v_window_interval
  ORDER BY rle.window_start DESC
  LIMIT 1;

  IF v_window_start IS NULL THEN
    -- New window
    INSERT INTO rate_limit_entries (key, window_start, count)
    VALUES (p_key, v_now, 1);
    RETURN QUERY SELECT true, 1, p_window_ms;
  ELSIF v_count >= p_max_requests THEN
    -- Over limit
    RETURN QUERY SELECT false, v_count,
      EXTRACT(EPOCH FROM (v_window_start + v_window_interval - v_now))::INTEGER * 1000;
  ELSE
    -- Increment
    UPDATE rate_limit_entries rle
    SET count = count + 1
    WHERE rle.key = p_key AND rle.window_start = v_window_start;
    RETURN QUERY SELECT true, v_count + 1,
      EXTRACT(EPOCH FROM (v_window_start + v_window_interval - v_now))::INTEGER * 1000;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Periodic cleanup (can be called via cron or pg_cron)
CREATE OR REPLACE FUNCTION cleanup_rate_limit_entries() RETURNS void AS $$
BEGIN
  DELETE FROM rate_limit_entries WHERE window_start < now() - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql;
