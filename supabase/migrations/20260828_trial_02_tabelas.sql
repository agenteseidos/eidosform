-- =====================================================================
-- TRIAL — PASSO 2 de 3: tabelas, colunas, índices e RLS
-- RODAR DEPOIS do passo 1 (enum), em execução separada.
-- Só cria estrutura. Nenhuma função ainda (passo 3, depois da leitura do passo 0).
-- Idempotente: pode rodar de novo sem quebrar.
-- =====================================================================

-- ---------- 1. Campanhas de trial (uma linha por ação; reutilizável) ----------
CREATE TABLE IF NOT EXISTS public.trial_campaigns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome              text NOT NULL,
  codigo            text NOT NULL UNIQUE,          -- vai na URL /acesso/<codigo>
  codigo_anterior   text,                          -- rotação: o antigo passa a 404
  valido_ate        timestamptz NOT NULL,          -- prazo para SE CADASTRAR
  duration_days     int  NOT NULL DEFAULT 30  CHECK (duration_days   BETWEEN 1 AND 90),
  confirm_hours     int  NOT NULL DEFAULT 72  CHECK (confirm_hours   BETWEEN 1 AND 168),
  exige_lista       boolean NOT NULL DEFAULT true,
  teto              int CHECK (teto IS NULL OR teto >= 0),
  reservas          int NOT NULL DEFAULT 0 CHECK (reservas >= 0),
  ativa             boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trial_campaigns_teto_ok CHECK (teto IS NULL OR reservas <= teto)
);

-- ---------- 2. Quem pode usar cada campanha ----------
CREATE TABLE IF NOT EXISTS public.trial_whitelist (
  campaign_id        uuid NOT NULL REFERENCES public.trial_campaigns(id) ON DELETE CASCADE,
  phone_match_key_br text NOT NULL CHECK (phone_match_key_br ~ '^55[0-9]{10,11}$'),
  nome               text,
  imported_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, phone_match_key_br)
);

-- ---------- 3. Reserva de vaga no momento do cadastro (evidência durável) ----------
CREATE TABLE IF NOT EXISTS public.trial_signup_intents (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id            uuid NOT NULL REFERENCES public.trial_campaigns(id),
  email_hash             text NOT NULL,
  phone_match_key_br     text NOT NULL,
  duration_days_snapshot int  NOT NULL CHECK (duration_days_snapshot BETWEEN 1 AND 90),
  state                  text NOT NULL CHECK (state IN ('reserved','bound','expired')),
  user_id                uuid UNIQUE,
  expires_at             timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trial_intents_bound_tem_user CHECK (state <> 'bound' OR user_id IS NOT NULL)
);
-- Um cadastro vivo por telefone: mata duplo clique / retry / duas abas.
CREATE UNIQUE INDEX IF NOT EXISTS trial_signup_intents_one_live_phone
  ON public.trial_signup_intents (phone_match_key_br) WHERE state IN ('reserved','bound');
CREATE INDEX IF NOT EXISTS trial_signup_intents_reserved_recentes
  ON public.trial_signup_intents (created_at) WHERE state = 'reserved';

-- ---------- 4. Ledger: um trial por telefone, para sempre ----------
CREATE TABLE IF NOT EXISTS public.plan_trials (
  phone_match_key_br     text PRIMARY KEY,
  campaign_id            uuid NOT NULL REFERENCES public.trial_campaigns(id),
  profile_id             uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  status                 text NOT NULL CHECK (status IN
                           ('pendente_confirmacao','ativo','convertido','expirado','lapsed')),
  duration_days_snapshot int NOT NULL,
  signup_at              timestamptz NOT NULL DEFAULT now(),
  confirm_by             timestamptz NOT NULL,
  granted_at             timestamptz,
  expires_at             timestamptz,
  converted_at           timestamptz,
  expired_at             timestamptz,
  lapsed_at              timestamptz,
  CONSTRAINT plan_trials_ativo_completo CHECK (status <> 'ativo'
    OR (granted_at IS NOT NULL AND expires_at IS NOT NULL AND profile_id IS NOT NULL)),
  CONSTRAINT plan_trials_convertido_completo CHECK (status <> 'convertido' OR converted_at IS NOT NULL),
  CONSTRAINT plan_trials_expirado_completo   CHECK (status <> 'expirado'   OR expired_at  IS NOT NULL),
  CONSTRAINT plan_trials_lapsed_completo     CHECK (status <> 'lapsed'     OR lapsed_at   IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS plan_trials_status_expira ON public.plan_trials (status, expires_at);
CREATE INDEX IF NOT EXISTS plan_trials_profile       ON public.plan_trials (profile_id);

-- ---------- 5. Régua: uma linha por (trial, etapa) ----------
DO $$ BEGIN
  CREATE TYPE public.dispatch_state AS ENUM
    ('pending','reserved','sealed','accepted','ambiguous','skipped','dead');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.delivery_status AS ENUM ('none','sent','delivered','read','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.trial_deliveries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_match_key_br text NOT NULL REFERENCES public.plan_trials(phone_match_key_br) ON DELETE CASCADE,
  stage              text NOT NULL CHECK (stage IN ('d0','d15','d25','d30')),
  state              public.dispatch_state  NOT NULL DEFAULT 'pending',
  delivery           public.delivery_status NOT NULL DEFAULT 'none',
  due_at             timestamptz NOT NULL,
  valid_until        timestamptz NOT NULL,
  next_attempt_at    timestamptz,
  lease_token        uuid,
  lease_until        timestamptz,
  attempts           int NOT NULL DEFAULT 0,
  template           text,
  params             jsonb,
  provider_id        text,                      -- WAMID
  sealed_at          timestamptz,
  accepted_at        timestamptz,
  ambiguous_at       timestamptz,
  dead_at            timestamptz,
  last_http_status   int,
  last_graph_code    text,
  last_error         text,
  skip_reason        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone_match_key_br, stage),
  CONSTRAINT td_lease_par        CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CONSTRAINT td_sealed_ts        CHECK (state <> 'sealed'    OR sealed_at    IS NOT NULL),
  CONSTRAINT td_accepted_ts      CHECK (state <> 'accepted'  OR (accepted_at IS NOT NULL AND provider_id IS NOT NULL)),
  CONSTRAINT td_ambiguous_ts     CHECK (state <> 'ambiguous' OR ambiguous_at IS NOT NULL),
  CONSTRAINT td_dead_ts          CHECK (state <> 'dead'      OR dead_at      IS NOT NULL),
  CONSTRAINT td_retry_agendado   CHECK (state <> 'pending'   OR attempts = 0 OR next_attempt_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS trial_deliveries_provider
  ON public.trial_deliveries (provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trial_deliveries_fila
  ON public.trial_deliveries (state, due_at, next_attempt_at);
CREATE INDEX IF NOT EXISTS trial_deliveries_lease
  ON public.trial_deliveries (lease_until) WHERE lease_until IS NOT NULL;

-- ---------- 6. Eventos de status da Meta (append-only) ----------
CREATE TABLE IF NOT EXISTS public.whatsapp_status_events (
  event_id                 text PRIMARY KEY,  -- sha256(wamid|status|occurred_at|graph_error_code)
  wamid                    text,
  biz_opaque_callback_data text,
  status                   text NOT NULL,
  graph_error_code         text,
  occurred_at              timestamptz NOT NULL,
  received_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wse_wamid    ON public.whatsapp_status_events (wamid);
CREATE INDEX IF NOT EXISTS wse_callback ON public.whatsapp_status_events (biz_opaque_callback_data);

-- ---------- 7. Capacidades por conta (aviso de lead no WhatsApp) ----------
CREATE TABLE IF NOT EXISTS public.account_capabilities (
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability  text NOT NULL CHECK (capability IN ('lead_whatsapp')),
  valid_until timestamptz,          -- NULL = enquanto a origem valer
  source      text NOT NULL,        -- 'trial_campaign:<id>' | 'plan:plus' | 'manual'
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, capability)
);

-- ---------- 8. Lock de billing com dono (substitui o marcador em asaas_webhook_events) ----------
CREATE TABLE IF NOT EXISTS public.billing_locks (
  lock_key    text PRIMARY KEY,
  owner_token uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- 9. Tentativas inválidas de reivindicação (log, nunca bloqueia a oferta) ----------
CREATE TABLE IF NOT EXISTS public.trial_claim_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_tentado     text,
  campaign_codigo   text,
  motivo            text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------- 10. Colunas novas em profiles ----------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS signup_kind text NOT NULL DEFAULT 'normal';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS trial_intent_id uuid;
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_signup_kind_ok
    CHECK (signup_kind IN ('normal','trial'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- signup_kind: só a transição normal -> trial é permitida; nunca volta.
CREATE OR REPLACE FUNCTION public.trial_guard_signup_kind()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.signup_kind IS DISTINCT FROM OLD.signup_kind THEN
    IF NOT (OLD.signup_kind = 'normal' AND NEW.signup_kind = 'trial') THEN
      RAISE EXCEPTION 'signup_kind: transição % -> % não permitida', OLD.signup_kind, NEW.signup_kind;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_profiles_signup_kind ON public.profiles;
CREATE TRIGGER trg_profiles_signup_kind BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trial_guard_signup_kind();

-- O dono da conta não mexe nessas duas colunas (defesa extra; quem escreve é o service role).
REVOKE UPDATE (signup_kind, trial_intent_id) ON public.profiles FROM authenticated, anon;

-- ---------- 11. updated_at automático ----------
CREATE OR REPLACE FUNCTION public.trial_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_trial_campaigns_updated  ON public.trial_campaigns;
CREATE TRIGGER trg_trial_campaigns_updated  BEFORE UPDATE ON public.trial_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.trial_set_updated_at();
DROP TRIGGER IF EXISTS trg_trial_deliveries_updated ON public.trial_deliveries;
CREATE TRIGGER trg_trial_deliveries_updated BEFORE UPDATE ON public.trial_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.trial_set_updated_at();

-- ---------- 12. RLS: ninguém além do service role (que ignora RLS) ----------
ALTER TABLE public.trial_campaigns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_whitelist       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_signup_intents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_trials           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_deliveries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_capabilities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_locks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_claim_attempts  ENABLE ROW LEVEL SECURITY;
-- Nenhuma policy criada de propósito: sem policy + RLS ligada = só service role enxerga.

REVOKE ALL ON public.trial_campaigns, public.trial_whitelist, public.trial_signup_intents,
              public.plan_trials, public.trial_deliveries, public.whatsapp_status_events,
              public.account_capabilities, public.billing_locks, public.trial_claim_attempts
  FROM anon, authenticated;

-- ---------- CONFERÊNCIA (rode e me mande a saída) ----------
SELECT tablename,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename) AS policies,
       rowsecurity AS rls_ligada
  FROM pg_tables t
 WHERE schemaname='public'
   AND tablename IN ('trial_campaigns','trial_whitelist','trial_signup_intents','plan_trials',
                     'trial_deliveries','whatsapp_status_events','account_capabilities',
                     'billing_locks','trial_claim_attempts')
 ORDER BY tablename;
