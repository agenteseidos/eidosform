-- =============================================================================
-- Estado recuperável da régua de cobrança (auditoria S1, 13/08/2026)
-- =============================================================================
--
-- POR QUE: no corte D+5 o expire-plans precisa remover a assinatura ativa, mas a régua e
-- /pagar ainda precisam saber qual assinatura e plano originaram a pendência. Sem este
-- snapshot, o sexto aviso nunca sai e links enviados antes do corte deixam de funcionar.
--
-- ⚠️ Rodar UMA VEZ pelo SQL Editor do Supabase. O bloco é atômico e registra a própria
-- migração na mesma execução, conforme a Regra nº 1 do CLAUDE.md.
-- =============================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS overdue_subscription_id text,
  ADD COLUMN IF NOT EXISTS previous_plan text,
  ADD COLUMN IF NOT EXISTS previous_plan_cycle text,
  ADD COLUMN IF NOT EXISTS downgraded_at timestamptz;

COMMENT ON COLUMN public.profiles.overdue_subscription_id IS
  'Assinatura que originou a cobrança vencida preservada após o corte D+5; limpa na próxima ativação.';
COMMENT ON COLUMN public.profiles.previous_plan IS
  'Plano pago anterior ao corte D+5, usado somente na comunicação de recuperação.';
COMMENT ON COLUMN public.profiles.previous_plan_cycle IS
  'Ciclo do plano pago anterior ao corte D+5, usado somente na comunicação de recuperação.';
COMMENT ON COLUMN public.profiles.downgraded_at IS
  'Instante em que o acesso foi cortado por inadimplência; limpa na próxima ativação.';

CREATE INDEX IF NOT EXISTS idx_profiles_overdue_subscription
  ON public.profiles (overdue_subscription_id)
  WHERE overdue_subscription_id IS NOT NULL;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260813_dunning_state',
  'Estado recuperável da régua após o corte D+5',
  ARRAY[
    'ALTER TABLE public.profiles ADD COLUMN overdue_subscription_id text, previous_plan text, previous_plan_cycle text, downgraded_at timestamptz',
    'CREATE INDEX idx_profiles_overdue_subscription ON public.profiles (overdue_subscription_id) WHERE overdue_subscription_id IS NOT NULL'
  ]
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
