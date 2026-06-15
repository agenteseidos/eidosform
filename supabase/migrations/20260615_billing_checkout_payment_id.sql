-- 20260615_billing_checkout_payment_id
-- P0-A (2026-06-15): guarda o id do pagamento AVULSO da troca de plano na linha 'recovering' de
-- billing_checkouts. Em retry/crash, o fluxo de troca consulta este id (ou o externalReference)
-- ANTES de cobrar de novo → idempotência, evita cobrança em dobro. Aditiva e idempotente.
ALTER TABLE billing_checkouts ADD COLUMN IF NOT EXISTS asaas_payment_id TEXT;

COMMENT ON COLUMN billing_checkouts.asaas_payment_id IS
  'Id do pagamento avulso (Asaas) da troca de plano; idempotência da cobrança (P0-A, 2026-06-15).';
