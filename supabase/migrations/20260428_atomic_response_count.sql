-- Migration: Atomic check+increment for response count
-- Replaces the separate checkResponseLimit + incrementResponseCount pattern
-- with a single atomic RPC to prevent race conditions.

CREATE OR REPLACE FUNCTION check_and_increment_response(p_user_id UUID)
RETURNS TABLE(allowed boolean, usage bigint, limit_val bigint, plan text, near_limit boolean) AS $$
DECLARE
  v_plan text;
  v_usage bigint;
  v_limit bigint;
  v_alert_sent boolean;
BEGIN
  -- Read current state
  SELECT plan, responses_used, responses_limit, limit_alert_sent
  INTO v_plan, v_usage, v_limit, v_alert_sent
  FROM profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    allowed := false;
    usage := 0;
    limit_val := 0;
    plan := 'free';
    near_limit := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Default limit for free plan
  IF v_limit IS NULL THEN v_limit := 100; END IF;
  IF v_usage IS NULL THEN v_usage := 0; END IF;

  -- Check if unlimited
  IF v_limit = -1 THEN
    UPDATE profiles SET responses_used = responses_used + 1 WHERE id = p_user_id;
    allowed := true;
    usage := v_usage + 1;
    limit_val := v_limit;
    plan := v_plan;
    near_limit := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Check limit before increment
  IF v_usage >= v_limit THEN
    allowed := false;
    usage := v_usage;
    limit_val := v_limit;
    plan := v_plan;
    near_limit := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Increment atomically
  UPDATE profiles
  SET responses_used = responses_used + 1
  WHERE id = p_user_id;

  -- Check near limit (80%)
  near_limit := (NOT v_alert_sent) AND (v_usage >= (v_limit * 80 / 100));

  -- Mark alert sent if near limit
  IF near_limit THEN
    UPDATE profiles SET limit_alert_sent = true WHERE id = p_user_id;
  END IF;

  allowed := true;
  usage := v_usage + 1;
  limit_val := v_limit;
  plan := v_plan;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
