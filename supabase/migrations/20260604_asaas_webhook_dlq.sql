-- 20260604_asaas_webhook_dlq.sql
-- DLQ / reprocessamento manual para webhooks do Asaas.
-- Adiciona rastreio de status/erro/tentativas + chaves mínimas (customer_id,
-- subscription_id) para reprocessar reconciliando contra o Asaas, SEM guardar
-- o payload (evita PII). Idempotente — seguro rodar mais de uma vez.

ALTER TABLE asaas_webhook_events
  ADD COLUMN IF NOT EXISTS status          text        NOT NULL DEFAULT 'processed',
  ADD COLUMN IF NOT EXISTS error           text,
  ADD COLUMN IF NOT EXISTS attempts        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_id     text,
  ADD COLUMN IF NOT EXISTS subscription_id text,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

-- Índice parcial para o reprocessador achar pendências rápido.
CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_failed
  ON asaas_webhook_events (last_attempt_at)
  WHERE status = 'failed';

-- Verificação:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'asaas_webhook_events' ORDER BY ordinal_position;
