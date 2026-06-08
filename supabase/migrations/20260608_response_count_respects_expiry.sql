-- 20260608_response_count_respects_expiry
-- check_and_increment_response ignorava plan_expires_at: um plano pago VENCIDO continuava
-- aceitando respostas no limite pago, porque os formulários PÚBLICOS não passam pelo
-- dashboard que reverte o plano na expiração. Agora, se o plano é pago e já expirou, a RPC
-- usa o LIMITE FREE (100). (P1, audit Codex 2026-06-08.)
CREATE OR REPLACE FUNCTION check_and_increment_response(p_user_id UUID)
RETURNS TABLE(allowed boolean, usage bigint, limit_val bigint, plan text, near_limit boolean) AS $$
DECLARE
  v_plan text;
  v_usage bigint;
  v_limit bigint;
  v_alert_sent boolean;
  v_expires timestamptz;
BEGIN
  -- Read current state
  SELECT plan, responses_used, responses_limit, limit_alert_sent, plan_expires_at
  INTO v_plan, v_usage, v_limit, v_alert_sent, v_expires
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

  -- EXPIRAÇÃO (P1): plano pago vencido → limite/plano efetivo = free.
  IF v_plan IS DISTINCT FROM 'free' AND v_expires IS NOT NULL AND v_expires < now() THEN
    v_plan := 'free';
    v_limit := 100;
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
