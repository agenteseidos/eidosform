-- 20260615_asaas_webhook_events_payment_ref
-- P0/I2 (2026-06-15, Codex round 3): guarda payment_id e external_reference do evento na linha de
-- idempotência. O reprocessador (DLQ) usa o external_reference p/ extrair o planchange_attempt_id e
-- só aplicar o avulso de troca de plano se ele for da tentativa ATUAL — nunca usar o dinheiro de uma
-- tentativa superseded numa troca nova. Aditiva e idempotente.
ALTER TABLE asaas_webhook_events ADD COLUMN IF NOT EXISTS payment_id TEXT;
ALTER TABLE asaas_webhook_events ADD COLUMN IF NOT EXISTS external_reference TEXT;
