-- =====================================================================
-- TRIAL — PASSO 0: LEITURA (não altera nada). Rode e me devolva a saída.
-- Preciso do corpo REAL da RPC de cota para alterá-la sem quebrar nada
-- (o .sql do repo diverge do banco — regra da ficha config-eidosform §4).
-- =====================================================================

-- 1) Corpo vivo da função que autoriza cada resposta a entrar
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosrc
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('check_and_increment_response', 'refresh_response_quota_period');

-- 2) Valores atuais do enum
SELECT enum_range(NULL::public.plan_type) AS plan_type_valores;

-- 3) Colunas de profiles que o trial toca (confirmar tipos)
SELECT column_name, data_type, udt_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='profiles'
   AND column_name IN ('plan','plan_status','plan_cycle','plan_expires_at',
                       'responses_used','responses_limit','limit_alert_sent',
                       'phone','phone_match_key_br','asaas_subscription_id')
 ORDER BY column_name;

-- 4) Tabela de formulários: nome das colunas que a expiração usa
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='forms'
   AND column_name IN ('id','user_id','created_by','status','is_published','published','paused','updated_at','created_at')
 ORDER BY column_name;

-- 5) Confirmar que os nomes novos estão livres
SELECT tablename FROM pg_tables
 WHERE schemaname='public'
   AND tablename IN ('trial_campaigns','trial_whitelist','trial_signup_intents',
                     'plan_trials','trial_deliveries','whatsapp_status_events',
                     'account_capabilities','billing_locks','trial_claim_attempts');
