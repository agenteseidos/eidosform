-- =============================================================================
-- email_deliveries — aceite × entrega de e-mail (auditoria 2026-08, lote 3 · L3-4)
-- =============================================================================
--
-- POR QUE: a Resend responde 200 no envio para dizer "aceitei e vou tentar entregar". A recusa do
-- servidor do destinatário (endereço inexistente, caixa cheia, bloqueio por reputação) chega
-- DEPOIS, num evento assíncrono que ninguém escutava. Um dono de formulário com e-mail errado no
-- cadastro parava de receber lead e o sistema seguia logando "email sent".
--
-- Esta tabela guarda o COMPROVANTE de aceite; `app/api/webhooks/resend/route.ts` a atualiza com o
-- veredito real. O código já está no ar e é TOLERANTE À AUSÊNCIA desta tabela (vira no-op), então
-- rodar isto aqui não tem janela de indisponibilidade nem ordem obrigatória com o deploy.
--
-- ⚠️ Rodar pelo SQL Editor do painel Supabase — nesta VPS não há psql nem CLI (CLAUDE.md, Regra Nº 1).
-- Idempotente: pode rodar mais de uma vez sem efeito colateral.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.email_deliveries (
  -- id devolvido pela Resend no aceite. É o fio que liga o envio aos eventos posteriores.
  resend_id        text PRIMARY KEY,

  -- que tipo de e-mail era ('new-response', e no futuro 'abandoned', 'billing', ...)
  kind             text NOT NULL,

  -- destinatário MASCARADO (hash curto + domínio, `maskRecipient` em lib/resend.ts).
  -- Não guardamos o endereço em claro: para descobrir se um bounce é de um endereço conhecido,
  -- re-hasheie o candidato com a mesma regra. Evita duplicar a base de e-mails numa 2ª tabela.
  recipient_masked text,

  -- sem FOREIGN KEY de propósito: isto é telemetria. Um vínculo rígido faria a exclusão de um
  -- formulário depender desta tabela, e o histórico de bounce continua útil depois da exclusão.
  form_id          uuid,
  response_id      uuid,
  role             text,

  -- accepted | delivery_delayed | delivered | bounced | complained
  -- A ordem de avanço é imposta pelo CÓDIGO (lib/email-delivery.ts), não por constraint: um
  -- evento fora de ordem tem que ser DESCARTADO em silêncio, não virar erro de banco.
  status           text NOT NULL DEFAULT 'accepted',
  reason           text,

  accepted_at      timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz
);

-- A consulta que interessa: "quais e-mails deste formulário não chegaram?"
CREATE INDEX IF NOT EXISTS idx_email_deliveries_form_status
  ON public.email_deliveries (form_id, status);

-- E a varredura operacional: "o que quicou nas últimas 24h?"
CREATE INDEX IF NOT EXISTS idx_email_deliveries_status_accepted_at
  ON public.email_deliveries (status, accepted_at DESC)
  WHERE status IN ('bounced', 'complained');

-- -----------------------------------------------------------------------------
-- Permissões — lição do lote 1, caso 4: GRANT amplo ao `anon` passou despercebido
-- por uma auditoria inteira de código porque não existe em lugar nenhum do código.
-- Aqui a porta nasce fechada: só o service_role (usado pelo servidor) enxerga.
-- -----------------------------------------------------------------------------
ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_deliveries FROM PUBLIC;
REVOKE ALL ON public.email_deliveries FROM anon;
REVOKE ALL ON public.email_deliveries FROM authenticated;
GRANT ALL ON public.email_deliveries TO service_role;

-- Sem POLICY nenhuma: com RLS ligada e nenhuma policy, anon e authenticated não leem nem gravam
-- nada. O service_role ignora RLS por definição. Se um dia o painel do cliente for mostrar o
-- status de entrega, a policy de leitura por dono do formulário entra AQUI — e só ela.

COMMENT ON TABLE public.email_deliveries IS
  'Aceite x entrega de e-mail (lote 3 / L3-4). Alimentada por lib/email-delivery.ts e atualizada por /api/webhooks/resend. Retenção sugerida: 90 dias.';
