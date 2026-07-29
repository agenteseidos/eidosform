-- Pré-venda 2026-07-29 — cota mensal real e cobrança idempotente por response_id.
--
-- Decisões do produto:
--   * "respostas/mês" reseta mensalmente, inclusive no plano anual;
--   * nenhuma cobrança retroativa;
--   * parcial só consome cota quando é finalizada;
--   * retry, double-click, adoção por session key e corrida 23505 contam uma vez.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS response_period_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_period_end_at timestamptz;

-- Preserva o contador atual até o primeiro reset. Todos os perfis vivos começam
-- um período de transição no momento em que esta migration for aplicada.
UPDATE public.profiles
SET
  response_period_start_at = COALESCE(response_period_start_at, now()),
  response_period_end_at = COALESCE(response_period_end_at, now() + interval '1 month')
WHERE response_period_start_at IS NULL
   OR response_period_end_at IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN response_period_start_at SET DEFAULT now(),
  ALTER COLUMN response_period_end_at SET DEFAULT (now() + interval '1 month'),
  ALTER COLUMN response_period_start_at SET NOT NULL,
  ALTER COLUMN response_period_end_at SET NOT NULL;

ALTER TABLE public.responses
  ADD COLUMN IF NOT EXISTS quota_counted_at timestamptz;

-- NÃO incrementa profiles.responses_used. Apenas marca respostas já concluídas
-- como legado/grandfathered para que nenhum retry futuro as cobre retroativamente.
UPDATE public.responses
SET quota_counted_at = COALESCE(submitted_at, now())
WHERE completed = true
  AND quota_counted_at IS NULL;

-- Mantém temporariamente a assinatura legada (uuid) para zero downtime entre
-- aplicar o SQL e deployar o código que chama a versão (uuid, uuid).
DROP FUNCTION IF EXISTS public.check_and_increment_response(uuid, uuid);

CREATE FUNCTION public.check_and_increment_response(
  p_user_id uuid,
  p_response_id uuid
)
RETURNS TABLE (
  allowed boolean,
  usage bigint,
  limit_val bigint,
  plan text,
  near_limit boolean,
  already_counted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_response_owner uuid;
  v_counted_at timestamptz;
  v_plan text;
  v_usage bigint;
  v_limit bigint;
  v_alert_sent boolean;
  v_expires timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_now timestamptz := now();
  v_new_usage bigint;
BEGIN
  -- Serializa todas as tentativas referentes à mesma resposta. É esta trava
  -- que faz token/session key/23505/double-click convergirem para UMA cobrança.
  SELECT f.user_id, r.quota_counted_at
  INTO v_response_owner, v_counted_at
  FROM public.responses AS r
  JOIN public.forms AS f ON f.id = r.form_id
  WHERE r.id = p_response_id
  FOR UPDATE OF r;

  IF NOT FOUND OR v_response_owner IS DISTINCT FROM p_user_id THEN
    RETURN QUERY SELECT false, 0::bigint, 0::bigint, 'free'::text, false, false;
    RETURN;
  END IF;

  -- Serializa o check+incremento de respostas diferentes do mesmo dono.
  SELECT
    p.plan::text,
    COALESCE(p.responses_used, 0),
    p.responses_limit,
    COALESCE(p.limit_alert_sent, false),
    p.plan_expires_at,
    p.response_period_start_at,
    p.response_period_end_at
  INTO
    v_plan, v_usage, v_limit, v_alert_sent, v_expires,
    v_period_start, v_period_end
  FROM public.profiles AS p
  WHERE p.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0::bigint, 0::bigint, 'free'::text, false, false;
    RETURN;
  END IF;

  -- Avança períodos mensais ancorados no período anterior. O loop cobre conta
  -- inativa por vários meses sem deslocar a âncora para o dia do retorno.
  IF v_period_start IS NULL OR v_period_end IS NULL THEN
    v_period_start := v_now;
    v_period_end := v_now + interval '1 month';
    UPDATE public.profiles
    SET response_period_start_at = v_period_start,
        response_period_end_at = v_period_end
    WHERE id = p_user_id;
  ELSIF v_now >= v_period_end THEN
    WHILE v_now >= v_period_end LOOP
      v_period_start := v_period_end;
      v_period_end := v_period_end + interval '1 month';
    END LOOP;
    v_usage := 0;
    v_alert_sent := false;
    UPDATE public.profiles
    SET responses_used = 0,
        limit_alert_sent = false,
        response_period_start_at = v_period_start,
        response_period_end_at = v_period_end
    WHERE id = p_user_id;
  END IF;

  -- Retry de uma resposta já cobrada é sempre permitido e nunca incrementa.
  IF v_counted_at IS NOT NULL THEN
    RETURN QUERY SELECT true, v_usage, COALESCE(v_limit, 100), v_plan, false, true;
    RETURN;
  END IF;

  -- Plano pago expirado perde o benefício mesmo se o webhook/cron atrasar.
  IF v_plan IS DISTINCT FROM 'free'
     AND v_expires IS NOT NULL
     AND v_expires < v_now THEN
    v_plan := 'free';
    v_limit := 100;
  END IF;

  IF v_plan NOT IN ('free', 'starter', 'plus', 'professional') THEN
    v_plan := 'free';
    v_limit := 100;
  END IF;

  -- NULL nunca deve sub-conceder um plano pago silenciosamente.
  IF v_limit IS NULL THEN
    v_limit := CASE v_plan
      WHEN 'starter' THEN 1000
      WHEN 'plus' THEN 5000
      WHEN 'professional' THEN 15000
      ELSE 100
    END;
  END IF;

  IF v_limit <> -1 AND v_usage >= v_limit THEN
    RETURN QUERY SELECT false, v_usage, v_limit, v_plan, false, false;
    RETURN;
  END IF;

  v_new_usage := v_usage + 1;

  UPDATE public.profiles
  SET responses_used = v_new_usage,
      limit_alert_sent = CASE
        WHEN v_limit <> -1
         AND NOT v_alert_sent
         AND v_new_usage >= (v_limit * 80 / 100)
        THEN true
        ELSE limit_alert_sent
      END
  WHERE id = p_user_id;

  UPDATE public.responses
  SET quota_counted_at = v_now
  WHERE id = p_response_id;

  RETURN QUERY
  SELECT
    true,
    v_new_usage,
    v_limit,
    v_plan,
    (v_limit <> -1 AND NOT v_alert_sent AND v_new_usage >= (v_limit * 80 / 100)),
    false;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_increment_response(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_response(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.check_and_increment_response(uuid, uuid) IS
  'Cobra uma resposta finalizada uma única vez e renova a cota em períodos mensais.';

-- Atualiza a leitura do dashboard mesmo quando ainda não houve resposta no
-- período novo. O enforcement também faz este avanço no submit, portanto esta
-- função é conveniência de apresentação, não a garantia principal.
CREATE OR REPLACE FUNCTION public.refresh_response_quota_period(p_user_id uuid)
RETURNS TABLE (
  usage bigint,
  limit_val bigint,
  period_start_at timestamptz,
  period_end_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_usage bigint;
  v_limit bigint;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz := now();
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(p.responses_used, 0),
    COALESCE(p.responses_limit, 100),
    p.response_period_start_at,
    p.response_period_end_at
  INTO v_usage, v_limit, v_start, v_end
  FROM public.profiles AS p
  WHERE p.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_start IS NULL OR v_end IS NULL THEN
    v_start := v_now;
    v_end := v_now + interval '1 month';
    UPDATE public.profiles
    SET response_period_start_at = v_start,
        response_period_end_at = v_end
    WHERE id = p_user_id;
  ELSIF v_now >= v_end THEN
    WHILE v_now >= v_end LOOP
      v_start := v_end;
      v_end := v_end + interval '1 month';
    END LOOP;
    v_usage := 0;
    UPDATE public.profiles
    SET responses_used = 0,
        limit_alert_sent = false,
        response_period_start_at = v_start,
        response_period_end_at = v_end
    WHERE id = p_user_id;
  END IF;

  RETURN QUERY SELECT v_usage, v_limit, v_start, v_end;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_response_quota_period(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_response_quota_period(uuid) TO authenticated, service_role;
