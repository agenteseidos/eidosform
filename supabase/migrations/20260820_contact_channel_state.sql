-- =============================================================================
-- A FICHA DO CONTATO por telefone (20/08/2026) — decisão do Sidney
-- =============================================================================
-- "Quando a pessoa fala com a Elen, quando compra… uma ficha é abastecida. O que
-- o sistema precisa é acessar essa ficha vinculada ao número de telefone."
--
-- Esta tabela é a versão MÁQUINA dessa ficha, no banco que os dois lados já
-- alcançam: a Elen (VPS) ESCREVE via endpoint interno na Vercel a cada mensagem
-- recebida e a cada opt-out; o follow-up do hero e a régua de cobrança LEEM
-- daqui antes de disparar qualquer template pago. Sem túnel, sem localhost.
--
-- Uma linha por telefone (dígitos E.164). Sem conteúdo de conversa — só carimbos.
-- ⚠️ Rodar UMA VEZ pelo SQL Editor.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.contact_channel_state (
  -- Dígitos E.164 (5583999999999). Mesma sensibilidade dos telefones que já
  -- vivem em `responses`; o acesso é service_role apenas.
  phone            text PRIMARY KEY,

  -- Último inbound real na Elen. É O sinal de supressão do follow-up:
  -- "abriu o wa.me" é inobservável — só a MENSAGEM prova contato.
  last_inbound_at  timestamptz,

  -- A pessoa pediu para não receber. Definitivo até ela voltar a falar.
  opted_out        boolean NOT NULL DEFAULT false,
  opted_out_at     timestamptz,

  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_channel_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_channel_state FROM PUBLIC;
REVOKE ALL ON public.contact_channel_state FROM anon;
REVOKE ALL ON public.contact_channel_state FROM authenticated;
GRANT ALL ON public.contact_channel_state TO service_role;

COMMENT ON TABLE public.contact_channel_state IS
  'Ficha do contato por telefone (so carimbos, nunca conversa). Elen escreve a cada inbound/opt-out; follow-up do hero e regua de cobranca leem antes de disparar template pago.';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260820_contact_channel_state',
  'Ficha do contato por telefone (last_inbound + opt-out), escrita pela Elen e lida pelos disparos',
  ARRAY[
    'CREATE TABLE public.contact_channel_state (phone PK, last_inbound_at, opted_out, opted_out_at, updated_at)',
    'RLS on, REVOKE ALL de PUBLIC/anon/authenticated, GRANT ALL a service_role'
  ]
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
