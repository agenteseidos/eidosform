-- =============================================================================
-- Outbox por canal da régua de cobrança (auditoria S1, 13/08/2026)
-- =============================================================================
-- Reserva antes da rede, registra aceite/falha depois e permite retomar uma reserva órfã.
-- Não guarda e-mail, telefone nem conteúdo: somente referência operacional sem PII duplicada.
--
-- ⚠️ Rodar UMA VEZ pelo SQL Editor do Supabase. O bloco é atômico e registra a própria
-- migração na mesma execução, conforme a Regra nº 1 do CLAUDE.md.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.dunning_outbox (
  idempotency_key    text PRIMARY KEY,
  profile_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stage              smallint NOT NULL CHECK (stage BETWEEN 0 AND 5),
  day                date NOT NULL,
  channel            text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  status             text NOT NULL CHECK (status IN ('reserved', 'accepted', 'sent', 'failed')),
  lease_token        uuid NOT NULL,
  leased_at          timestamptz NOT NULL,
  provider_message_id text,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dunning_outbox_delivery_unique UNIQUE (profile_id, stage, day, channel)
);

CREATE INDEX IF NOT EXISTS idx_dunning_outbox_recoverable
  ON public.dunning_outbox (leased_at)
  WHERE status IN ('reserved', 'failed');

ALTER TABLE public.dunning_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dunning_outbox FROM PUBLIC;
REVOKE ALL ON public.dunning_outbox FROM anon;
REVOKE ALL ON public.dunning_outbox FROM authenticated;
GRANT ALL ON public.dunning_outbox TO service_role;

COMMENT ON TABLE public.dunning_outbox IS
  'Outbox sem PII da régua: uma entrega por perfil, estágio, dia e canal, com lease recuperável.';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260813_dunning_outbox',
  'Outbox por canal da régua de cobrança com lease',
  ARRAY[
    'CREATE TABLE public.dunning_outbox (...)',
    'RLS fechado para anon/authenticated; acesso exclusivo service_role',
    'CREATE INDEX idx_dunning_outbox_recoverable ON public.dunning_outbox (leased_at) WHERE status IN (reserved, failed)'
  ]
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
