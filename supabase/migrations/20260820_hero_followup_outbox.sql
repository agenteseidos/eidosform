-- =============================================================================
-- Fila do follow-up do hero da landing (20/08/2026) — D-10
-- =============================================================================
-- Quem testa a demonstração da /v3 ou /v4 vira lead. Se, 30 minutos depois, essa
-- pessoa NÃO tiver criado conta e NÃO tiver falado com a Elen, ela recebe um
-- WhatsApp de confirmação do teste (template UTILITY `eidosform_teste_recebido_v1`).
--
-- POR QUE UMA FILA, e não um disparo direto no submit:
--  · o delay é a razão de existir (o lead ainda está lendo a página aos 30s);
--  · a Cloud API NÃO tem idempotência — reenviar gera OUTRA mensagem no celular
--    de alguém. A fila sela ANTES de chamar a Meta (garantia "no máximo uma vez",
--    mesma disciplina de `dunning_outbox`);
--  · a decisão de enviar depende de estado EXTERNO no momento do envio (conta
--    criada? falou com a Elen?) — não do estado do submit.
--
-- ⚠️ Rodar UMA VEZ pelo SQL Editor. Atômico, registra a própria migração.
-- ⚠️ NADA muda de comportamento: a tabela nasce vazia e o worker só enfileira
--    quando o formulário do hero estiver PUBLICADO.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.hero_followup_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Uma resposta do hero gera NO MÁXIMO uma mensagem. É a invariante gravada na
  -- estrutura: sem ela, um autosave repetido ou um retry do POST viraria
  -- mensagem repetida no celular de alguém.
  response_id uuid NOT NULL REFERENCES public.responses(id) ON DELETE CASCADE,

  -- E.164 só com dígitos (5583999999999). Normalizado ANTES de gravar: o mesmo
  -- número escrito de 4 formas não pode virar 4 linhas.
  phone       text NOT NULL,

  -- Snapshot dos parâmetros do template. Congelado na criação: o lead respondeu
  -- ISTO, e uma edição posterior do formulário não pode reescrever o passado.
  nome        text NOT NULL,
  objetivo    text NOT NULL,
  -- A frase de recomendação de plano, montada no servidor (parâmetro {{3}}).
  -- ⚠️ NUNCA contém o plano Free (regra do Sidney, 20/08).
  recomendacao text NOT NULL,

  -- Quando pode sair. Nasce em +30min e é EMPURRADO para a próxima abertura da
  -- janela (todos os dias, 8h–21h BRT) se cair fora dela.
  due_at      timestamptz NOT NULL,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','skipped','failed','expired')),
  -- Por que não saiu: 'conta_criada' | 'falou_com_elen' | 'opt_out' | 'sem_telefone'…
  -- Vira telemetria de produto: quantos testes viram conta sozinhos?
  skip_reason text,

  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  last_attempt_at timestamptz,
  sent_at         timestamptz,
  wamid           text,

  -- Lease do trabalhador (mesmo molde das outras filas): linha reservada que
  -- ficou órfã volta quando o lease vence.
  lease_token uuid,
  leased_at   timestamptz,

  -- Depois disto não faz mais sentido mandar "confirmamos seu teste".
  expires_at  timestamptz NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hero_followup_response_unica UNIQUE (response_id)
);

-- Consulta do trabalhador: o que está pronto para sair agora.
CREATE INDEX IF NOT EXISTS idx_hero_followup_a_enviar
  ON public.hero_followup_outbox (due_at)
  WHERE status IN ('pending', 'failed');

-- Recuperação de lease órfão.
CREATE INDEX IF NOT EXISTS idx_hero_followup_processando
  ON public.hero_followup_outbox (leased_at)
  WHERE status = 'processing';

-- ⚠️ NÃO há índice único por TELEFONE: o Sidney recusou explicitamente a dedup
-- por telefone/24h em 20/08 ("não quero isso, mas deixe salvo como sugestão").
-- Consequência aceita e registrada: a mesma pessoa testando duas vezes recebe
-- duas mensagens. Se um dia virar problema, o caminho é um índice parcial aqui.

ALTER TABLE public.hero_followup_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hero_followup_outbox FROM PUBLIC;
REVOKE ALL ON public.hero_followup_outbox FROM anon;
REVOKE ALL ON public.hero_followup_outbox FROM authenticated;
GRANT ALL ON public.hero_followup_outbox TO service_role;

COMMENT ON TABLE public.hero_followup_outbox IS
  'Fila do follow-up do hero da landing (D-10). UNIQUE(response_id) = no maximo uma mensagem por teste; sela antes de chamar a Meta (Cloud API nao tem idempotencia).';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260820_hero_followup_outbox',
  'Fila do follow-up do hero da landing (D-10)',
  ARRAY[
    'CREATE TABLE public.hero_followup_outbox com UNIQUE (response_id), snapshot dos parametros e estado de fila',
    'Indices: a_enviar (parcial por due_at), processando (lease orfao)',
    'RLS on, REVOKE ALL de PUBLIC/anon/authenticated, GRANT ALL a service_role'
  ]
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
