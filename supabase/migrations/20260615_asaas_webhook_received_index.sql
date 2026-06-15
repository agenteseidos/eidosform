-- 20260615_asaas_webhook_received_index
-- P1 (2026-06-15): índice parcial para o sweep de eventos 'received' órfãos (cron sweep-received +
-- listStaleReceivedEvents). Espelha idx_asaas_webhook_events_failed (20260604). Aditiva e idempotente.
CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_received
  ON asaas_webhook_events (processed_at)
  WHERE status = 'received';
