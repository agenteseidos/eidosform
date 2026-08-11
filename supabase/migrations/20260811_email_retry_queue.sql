-- =============================================================================
-- email_retry_queue — a fila de reenvio que faltava (D-05, auditoria 2026-08 · lote 3)
-- =============================================================================
--
-- POR QUE: `sendEmailWithRetry` tenta 3 vezes em ~16 segundos e desiste. Resend fora do ar por
-- alguns minutos = todo aviso de lead daquela janela perdido EM DEFINITIVO. O WhatsApp já tinha
-- fila de reenvio (`services/whatsapp/outbox.js`); o e-mail, não.
--
-- ⚠️ O DESENHO QUE DESTRAVOU ISTO (decisão Sidney 11/08/2026). O lote 3 adiou a fila por um
-- motivo legítimo: guardar o e-mail montado significa DUPLICAR dado pessoal do lead em repouso,
-- com prazo de retenção a definir. Esta tabela guarda apenas REFERÊNCIA — form_id, response_id e
-- o PAPEL do destinatário. Na hora do reenvio o e-mail é remontado a partir do banco, onde o
-- dado já vive. Consequências que valem ouro:
--   · zero dado pessoal duplicado (nem endereço, nem respostas do lead);
--   · se a resposta for APAGADA antes do reenvio, o reenvio é pulado — a exclusão é respeitada
--     por construção, sem rotina de expurgo;
--   · a pergunta "quantos dias posso reter?" deixa de ser sensível.
--
-- JANELA: 48h (decisão Sidney). "Chegou um lead" é informação de hora, não de semana — aviso
-- entregue 5 dias depois não serve para nada, e o lead em si NUNCA se perde (está no painel).
-- Esgotada a janela, a linha vira `dead` e o dono é avisado pelo WhatsApp, que é justamente o
-- canal que funciona quando o e-mail não funciona.
--
-- ⚠️ Rodar pelo SQL Editor do painel Supabase (CLAUDE.md, Regra Nº 1). Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.email_retry_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- que e-mail remontar ('new-response'; no futuro 'abandoned', 'billing', ...)
  kind             text NOT NULL,

  -- ── A REFERÊNCIA (e NADA além dela) ────────────────────────────────────────
  -- Sem FOREIGN KEY, pelo mesmo motivo de email_deliveries: a exclusão de um formulário não pode
  -- depender desta fila. Resposta sumida no reenvio = pular, não erro.
  form_id          uuid NOT NULL,
  response_id      uuid NOT NULL,
  -- 'owner' | 'form_email' — o endereço é RE-RESOLVIDO no reenvio (resolveEmailRecipients),
  -- então trocar o e-mail de notificação depois do erro faz o reenvio ir para o endereço NOVO.
  role             text NOT NULL,

  attempts         int  NOT NULL DEFAULT 0,
  last_error       text,

  -- pending | sent | dead
  status           text NOT NULL DEFAULT 'pending',

  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  -- o relógio da janela de 48h; NÃO é o created_at para o caso de a linha ser recriada
  first_failed_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz,

  -- Uma tentativa por (resposta, papel): reenvio de e-mail duplicado é spam para o dono.
  -- O ON CONFLICT do código conta com esta unicidade para não empilhar linhas na mesma falha.
  CONSTRAINT email_retry_queue_alvo_unico UNIQUE (kind, response_id, role)
);

-- A consulta do dreno: "o que está pendente e já pode tentar de novo?"
CREATE INDEX IF NOT EXISTS idx_email_retry_queue_pendentes
  ON public.email_retry_queue (next_attempt_at)
  WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- Permissões — a porta nasce fechada (lição do lote 1, caso 4).
-- -----------------------------------------------------------------------------
ALTER TABLE public.email_retry_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_retry_queue FROM PUBLIC;
REVOKE ALL ON public.email_retry_queue FROM anon;
REVOKE ALL ON public.email_retry_queue FROM authenticated;
GRANT ALL ON public.email_retry_queue TO service_role;

COMMENT ON TABLE public.email_retry_queue IS
  'Fila de reenvio de e-mail (D-05). Guarda REFERÊNCIA (form_id/response_id/role), nunca conteúdo: o e-mail é remontado do banco no reenvio. Janela 48h; esgotada, vira dead e avisa por WhatsApp. Drenada por /api/cron/email-retry.';

-- Registro no rastreamento criado no D-03 (11/08/2026) — a regra nova: toda mudança de banco
-- deixa rastro NA MESMA execução.
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260811_email_retry_queue',
  'D-05: fila de reenvio de e-mail por referência, janela de 48h',
  ARRAY['CREATE TABLE public.email_retry_queue (...); RLS + revoke; índice de pendentes']
)
ON CONFLICT (version) DO NOTHING;
