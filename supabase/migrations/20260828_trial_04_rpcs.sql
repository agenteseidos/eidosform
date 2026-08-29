-- =====================================================================
-- TRIAL — PASSO 4: as funções do fluxo (reserva → vínculo → concessão → lapso)
-- Rodar DEPOIS dos passos 1, 2 e 3.
--
-- Desenho (spec v12): criar a conta no Supabase e anotar o trial são dois passos que podem
-- falhar entre si. Por isso a EVIDÊNCIA nasce ANTES da conta (trial_signup_intents), com a vaga
-- do teto já reservada; se o processo morrer no meio, o reconciliador termina o serviço.
-- Nada aqui confia em `user_metadata` como autoridade: ele é só um LOCALIZADOR, e toda condição
-- real é conferida no servidor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) RESERVA — antes de criar a conta. Idempotente por telefone.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_trial_signup(
  p_codigo text, p_email_hash text, p_phone_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_camp public.trial_campaigns%ROWTYPE;
  v_intent public.trial_signup_intents%ROWTYPE;
  v_id uuid;
BEGIN
  -- Campanha pelo código VIGENTE (o `codigo_anterior` é 404 de propósito: rotacionar um código
  -- vazado tem que invalidar o antigo).
  SELECT * INTO v_camp FROM public.trial_campaigns
   WHERE codigo = p_codigo AND ativa AND now() < valido_ate
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'campanha_invalida'); END IF;

  IF v_camp.exige_lista AND NOT EXISTS (
    SELECT 1 FROM public.trial_whitelist
     WHERE campaign_id = v_camp.id AND phone_match_key_br = p_phone_key
  ) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'fora_da_lista');
  END IF;

  -- Um trial por telefone, para sempre.
  IF EXISTS (SELECT 1 FROM public.plan_trials WHERE phone_match_key_br = p_phone_key) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'telefone_ja_usou');
  END IF;

  -- Já existe cadastro VIVO para este telefone? (duplo clique, retry do navegador, duas abas)
  -- Mesmo e-mail = mesma pessoa tentando de novo: devolve o intent que já existe, SEM consumir
  -- outra vaga do teto. E-mail diferente = não é o mesmo cadastro: recusa sem reservar.
  SELECT * INTO v_intent FROM public.trial_signup_intents
   WHERE phone_match_key_br = p_phone_key AND state IN ('reserved','bound')
   FOR UPDATE;
  IF FOUND THEN
    IF v_intent.email_hash = p_email_hash AND v_intent.state = 'reserved' AND v_intent.expires_at > now() THEN
      RETURN jsonb_build_object('ok', true, 'intent_id', v_intent.id,
                                'duration_days', v_intent.duration_days_snapshot, 'reaproveitado', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'motivo', 'cadastro_em_andamento');
  END IF;

  -- Reserva a vaga do teto de forma atômica: quem não couber recebe 0 linhas e desiste.
  IF v_camp.teto IS NOT NULL THEN
    UPDATE public.trial_campaigns SET reservas = reservas + 1
     WHERE id = v_camp.id AND reservas < teto;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'teto_atingido'); END IF;
  ELSE
    UPDATE public.trial_campaigns SET reservas = reservas + 1 WHERE id = v_camp.id;
  END IF;

  INSERT INTO public.trial_signup_intents
    (campaign_id, email_hash, phone_match_key_br, duration_days_snapshot, state, expires_at)
  VALUES (v_camp.id, p_email_hash, p_phone_key, v_camp.duration_days, 'reserved', now() + interval '15 minutes')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'intent_id', v_id, 'duration_days', v_camp.duration_days);
END $$;

-- ---------------------------------------------------------------------
-- 2) VÍNCULO — depois que o Supabase criou o usuário. Cria o ledger.
--    Confere o usuário em auth.users: no cadastro com e-mail JÁ existente o Supabase devolve um
--    objeto de usuário ofuscado, que não tem linha correspondente — o vínculo falha em silêncio,
--    o intent expira, a vaga volta, e o cliente não descobre que o e-mail existe.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trial_signup_bind(p_intent_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_intent public.trial_signup_intents%ROWTYPE;
  v_camp   public.trial_campaigns%ROWTYPE;
  v_email  text;
  v_meta   text;
  v_phone  text;
BEGIN
  SELECT * INTO v_intent FROM public.trial_signup_intents WHERE id = p_intent_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'intent_inexistente'); END IF;

  IF v_intent.state = 'bound' AND v_intent.user_id = p_user_id THEN
    RETURN jsonb_build_object('ok', true, 'ja_vinculado', true);   -- idempotente
  END IF;
  IF v_intent.state <> 'reserved' OR v_intent.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'intent_nao_reservado');
  END IF;

  SELECT u.email, u.raw_user_meta_data->>'trial_intent'
    INTO v_email, v_meta
    FROM auth.users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'usuario_inexistente'); END IF;
  IF v_meta IS DISTINCT FROM p_intent_id::text THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'metadata_nao_confere');
  END IF;
  IF encode(sha256(convert_to(lower(trim(v_email)), 'UTF8')), 'hex') <> v_intent.email_hash THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'email_nao_confere');
  END IF;

  SELECT phone_match_key_br INTO v_phone FROM public.profiles WHERE id = p_user_id;
  IF v_phone IS DISTINCT FROM v_intent.phone_match_key_br THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'telefone_nao_confere');
  END IF;

  SELECT * INTO v_camp FROM public.trial_campaigns WHERE id = v_intent.campaign_id;

  UPDATE public.trial_signup_intents SET state = 'bound', user_id = p_user_id WHERE id = p_intent_id;

  INSERT INTO public.plan_trials
    (phone_match_key_br, campaign_id, profile_id, status, duration_days_snapshot, signup_at, confirm_by)
  VALUES (v_intent.phone_match_key_br, v_intent.campaign_id, p_user_id, 'pendente_confirmacao',
          v_intent.duration_days_snapshot, now(), now() + make_interval(hours => v_camp.confirm_hours));

  UPDATE public.profiles SET signup_kind = 'trial', trial_intent_id = p_intent_id WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'confirm_hours', v_camp.confirm_hours);
END $$;

-- ---------------------------------------------------------------------
-- 3) CONCESSÃO — na confirmação do e-mail. Aplica o plano e agenda a régua.
--    Exige posse do lock de ativação: é a mesma chave que o pagamento usa, então concessão e
--    ativação paga nunca escrevem no mesmo perfil ao mesmo tempo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_trial(p_profile_id uuid, p_owner_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_led    public.plan_trials%ROWTYPE;
  v_prof   record;
  v_exp    timestamptz;
  v_dias   int;
BEGIN
  -- Fencing: só age quem é dono do lock E com o lease vivo.
  IF NOT EXISTS (
    SELECT 1 FROM public.billing_locks
     WHERE lock_key = 'activation:' || p_profile_id::text
       AND owner_token = p_owner_token AND lease_until > now()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_posse_do_lock');
  END IF;

  SELECT * INTO v_led FROM public.plan_trials WHERE profile_id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'sem_ledger'); END IF;
  IF v_led.status = 'ativo' THEN
    RETURN jsonb_build_object('ok', true, 'ja_concedido', true, 'expires_at', v_led.expires_at);
  END IF;
  IF v_led.status <> 'pendente_confirmacao' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ledger_' || v_led.status);
  END IF;

  IF now() >= v_led.confirm_by THEN
    -- Confirmou tarde demais: lapsa e devolve a vaga. A conta segue normal, em Free.
    UPDATE public.plan_trials SET status = 'lapsed', lapsed_at = now()
     WHERE phone_match_key_br = v_led.phone_match_key_br;
    UPDATE public.trial_campaigns SET reservas = greatest(reservas - 1, 0) WHERE id = v_led.campaign_id;
    RETURN jsonb_build_object('ok', false, 'motivo', 'prazo_de_confirmacao_vencido');
  END IF;

  SELECT p.plan::text AS plan, p.email_confirmed_at, p.asaas_subscription_id, p.phone_match_key_br
    INTO v_prof FROM public.profiles p WHERE p.id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'perfil_inexistente'); END IF;
  IF v_prof.email_confirmed_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'motivo', 'email_nao_confirmado'); END IF;
  IF v_prof.plan <> 'free' THEN RETURN jsonb_build_object('ok', false, 'motivo', 'conta_nao_free'); END IF;
  IF v_prof.asaas_subscription_id IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'motivo', 'tem_assinatura'); END IF;
  IF v_prof.phone_match_key_br IS DISTINCT FROM v_led.phone_match_key_br THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'telefone_divergente');
  END IF;
  IF EXISTS (SELECT 1 FROM public.billing_checkouts
              WHERE profile_id = p_profile_id AND status IN ('pending','paid')) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'checkout_em_andamento');
  END IF;

  v_dias := v_led.duration_days_snapshot;
  -- Fim de dia em BRT, igual ao resto do produto (a carência e o cron contam a partir daí).
  v_exp := (date_trunc('day', (now() AT TIME ZONE 'America/Sao_Paulo')) + make_interval(days => v_dias)
            + interval '23 hours 59 minutes 59 seconds') AT TIME ZONE 'America/Sao_Paulo';

  UPDATE public.profiles SET
    plan = 'trial', plan_status = 'active', plan_cycle = NULL,
    plan_expires_at = v_exp,
    responses_limit = 5000, responses_used = 0, limit_alert_sent = false,
    response_period_start_at = now(), response_period_end_at = now() + interval '1 month',
    trial_intent_id = NULL
  WHERE id = p_profile_id;

  UPDATE public.plan_trials
     SET status = 'ativo', granted_at = now(), expires_at = v_exp
   WHERE phone_match_key_br = v_led.phone_match_key_br;

  -- O "aviso de lead no WhatsApp" prometido no convite não é flag de plano: é capacidade.
  INSERT INTO public.account_capabilities (profile_id, capability, valid_until, source)
  VALUES (p_profile_id, 'lead_whatsapp', v_exp, 'trial_campaign:' || v_led.campaign_id::text)
  ON CONFLICT (profile_id, capability) DO UPDATE
    SET valid_until = EXCLUDED.valid_until, source = EXCLUDED.source, granted_at = now();

  -- Régua inteira agendada agora: D0 imediato; as outras às 09:00 BRT do dia N.
  -- `valid_until` = 2 dias depois: etapa atrasada além disso não é mais enviada (mandar o aviso
  -- de "faltam 5 dias" com 3 dias de atraso é pior que não mandar).
  INSERT INTO public.trial_deliveries (phone_match_key_br, stage, due_at, valid_until)
  VALUES
    (v_led.phone_match_key_br, 'd0',  now(), now() + interval '2 days'),
    (v_led.phone_match_key_br, 'd15',
       (date_trunc('day', (now() AT TIME ZONE 'America/Sao_Paulo')) + interval '15 days' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo',
       (date_trunc('day', (now() AT TIME ZONE 'America/Sao_Paulo')) + interval '17 days' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo'),
    (v_led.phone_match_key_br, 'd25',
       (date_trunc('day', (now() AT TIME ZONE 'America/Sao_Paulo')) + interval '25 days' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo',
       (date_trunc('day', (now() AT TIME ZONE 'America/Sao_Paulo')) + interval '27 days' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo'),
    (v_led.phone_match_key_br, 'd30',
       (date_trunc('day', (now() AT TIME ZONE 'America/Sao_Paulo')) + make_interval(days => v_dias) + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo',
       (date_trunc('day', (now() AT TIME ZONE 'America/Sao_Paulo')) + make_interval(days => v_dias + 2) + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo')
  ON CONFLICT (phone_match_key_br, stage) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'trial_granted', true, 'expires_at', v_exp);
END $$;

-- ---------------------------------------------------------------------
-- 4) LAPSO — quem nunca confirmou o e-mail. Transição atômica; a vaga volta UMA vez.
--    `lapsed` é terminal, então o UPDATE não pega a mesma linha duas vezes.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lapse_trials_vencidos()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_n int := 0; r record;
BEGIN
  FOR r IN
    UPDATE public.plan_trials
       SET status = 'lapsed', lapsed_at = now()
     WHERE status = 'pendente_confirmacao' AND confirm_by <= now()
    RETURNING campaign_id
  LOOP
    UPDATE public.trial_campaigns SET reservas = greatest(reservas - 1, 0) WHERE id = r.campaign_id;
    v_n := v_n + 1;
  END LOOP;

  -- Intents que nunca viraram conta: devolvem a vaga do mesmo jeito.
  FOR r IN
    UPDATE public.trial_signup_intents
       SET state = 'expired'
     WHERE state = 'reserved' AND expires_at <= now()
    RETURNING campaign_id
  LOOP
    UPDATE public.trial_campaigns SET reservas = greatest(reservas - 1, 0) WHERE id = r.campaign_id;
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END $$;

-- ---------------------------------------------------------------------
-- Permissões: nada disto é chamável pelo cliente.
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.reserve_trial_signup(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trial_signup_bind(uuid, uuid)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_trial(uuid, uuid)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lapse_trials_vencidos()                FROM PUBLIC, anon, authenticated;

-- ── SONDAS (planejamento + permissão). Nada é escrito.
-- ESPERADO 1: ok=false, motivo=campanha_invalida
SELECT public.reserve_trial_signup('codigo-que-nao-existe', 'hash', '5583999999999') AS sonda_reserva;
-- ESPERADO 2: ok=false, motivo=intent_inexistente
SELECT public.trial_signup_bind('00000000-0000-0000-0000-000000000000'::uuid,
                                '00000000-0000-0000-0000-000000000000'::uuid) AS sonda_bind;
-- ESPERADO 3: ok=false, motivo=sem_posse_do_lock  (fencing funcionando)
SELECT public.grant_trial('00000000-0000-0000-0000-000000000000'::uuid,
                          '00000000-0000-0000-0000-000000000000'::uuid) AS sonda_grant;
-- ESPERADO 4: 0
SELECT public.lapse_trials_vencidos() AS sonda_lapse;
