-- ════════════════════════════════════════════════════════════════════════════════════════════
-- CARÊNCIA DE INADIMPLÊNCIA · PASSO 2 de 2 — ESTE ALTERA O BANCO
--
-- O QUE MUDA, EM UMA FRASE: a função que autoriza salvar uma resposta para de cortar o cliente
-- inadimplente para free/100 no segundo seguinte ao vencimento; passa a respeitar os 5 dias de
-- carência que a régua de cobrança já promete.
--
-- ESCRITO CONTRA O CORPO REAL devolvido pelo passo 1 (Regra nº 1). Só o bloco marcado com
-- «CARÊNCIA» mudou; todo o resto é byte a byte o que já está rodando — inclusive o FOR UPDATE
-- que serializa a cobrança, o avanço de período mensal e o retry idempotente.
--
-- SEGURANÇA: só AMPLIA acesso de quem está dentro dos 5 dias. Não mexe em cota de quem está em
-- dia, não altera limite, não escreve em profiles fora do que já escrevia.
--
-- COMO USAR: cole TUDO de uma vez no SQL Editor e rode. São três instruções na mesma execução:
-- a função, o registro da migration (regra operacional de 11/08) e a sonda.
-- ════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_and_increment_response(p_user_id uuid, p_response_id uuid)
 RETURNS TABLE(allowed boolean, usage bigint, limit_val bigint, plan text, near_limit boolean, already_counted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- «CARÊNCIA» (25/08/2026): campos novos, lidos no mesmo SELECT ... FOR UPDATE.
  v_plan_status text;
  v_sub_id text;
  v_fim_carencia timestamptz;
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
    p.response_period_end_at,
    p.plan_status,
    p.asaas_subscription_id
  INTO
    v_plan, v_usage, v_limit, v_alert_sent, v_expires,
    v_period_start, v_period_end,
    v_plan_status, v_sub_id
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

  -- ══════════════════════════════════════════════════════════════════════════════════════════
  -- «CARÊNCIA» — ÚNICO BLOCO ALTERADO EM 25/08/2026
  --
  -- ANTES: plano pago vencido virava free/100 no segundo seguinte ao vencimento, SEMPRE. Isso
  -- criava split-brain: o /api/user/plan-features mostrava "Plus · 5.000" e a régua de cobrança
  -- prometia 5 dias, enquanto ESTA função — que é quem de fato autoriza a resposta a entrar —
  -- já recusava acima de 100. O cliente inadimplente via um plano que o produto não entregava.
  --
  -- AGORA: durante os 5 dias de carência o plano pago vale de verdade. Duas guardas impedem
  -- isso de virar acesso pago de graça:
  --   1. PRAZO DURO — a carência acaba por CÁLCULO. Se o cron expire-plans nunca rodar, o
  --      benefício acaba sozinho no mesmo instante. Falha de agendador não vira acesso vitalício.
  --   2. SÓ INADIMPLENTE — exige plan_status='active' E assinatura viva. Quem CANCELA fica
  --      'canceling'/'cancelled' e NÃO ganha os 5 dias (decisão do Sidney, 25/08).
  --
  -- ⚠️ A ÂNCORA: plan_expires_at é FIM de dia BRT (23:59:59). O expire-plans conta dias inteiros
  -- a partir da MEIA-NOITE do vencimento. Truncar para o dia BRT antes de somar é o que faz a
  -- carência daqui terminar no MESMO instante em que o rebaixamento acontece. Sem o date_trunc,
  -- esta função concederia ~24h a mais — diferença que só apareceria quando o cron falha, ou
  -- seja, exatamente na hora errada.
  --
  -- 🔗 O "5" espelha CARENCIA_INADIMPLENCIA_DIAS em lib/plans.ts. Mudou lá, muda aqui.
  -- ══════════════════════════════════════════════════════════════════════════════════════════
  IF v_plan IS DISTINCT FROM 'free'
     AND v_expires IS NOT NULL
     AND v_expires < v_now THEN
    v_fim_carencia := (
      date_trunc('day', v_expires AT TIME ZONE 'America/Sao_Paulo') + interval '5 days'
    ) AT TIME ZONE 'America/Sao_Paulo';

    IF NOT (v_plan_status = 'active' AND v_sub_id IS NOT NULL AND v_now < v_fim_carencia) THEN
      v_plan := 'free';
      v_limit := 100;
    END IF;
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
$function$;

-- ── Registro da migration (regra operacional de 11/08: mudança e registro na MESMA execução) ──
insert into supabase_migrations.schema_migrations (version, name, statements)
values (
  '20260825_carencia_cota',
  'check_and_increment_response passa a respeitar os 5 dias de carencia de inadimplencia (fim do split-brain com plan-features e a regua). Prazo duro por calculo; so plan_status=active + assinatura viva.',
  array['CREATE OR REPLACE FUNCTION public.check_and_increment_response(uuid, uuid) — bloco CARENCIA;']
);

-- ── SONDA REAL (obrigatória: "pronto" só depois dela) ────────────────────────────────────────
-- Chamada inofensiva com ids inexistentes: exercita o PLANEJAMENTO da função inteira sem tocar
-- em nenhum dado. Erro de tipo é de planejamento e apareceria AQUI — foi assim que o caso 6 da
-- Regra nº 1 derrubou todos os envios por 20h com a suíte verde.
-- ESPERADO: uma linha  allowed=false, usage=0, limit_val=0, plan=free, near_limit=f, already_counted=f
SELECT * FROM public.check_and_increment_response(
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid
);
