-- Fallback de cartão morto (2026-07-03): a troca de plano paga sem token utilizável abre
-- um checkout hospedado DETACHED cobrando só a diferença. O Asaas NÃO persiste
-- externalReference no checkout hospedado (smoke 2026-06-08), então a correlação do
-- pagamento avulso com a tentativa de troca é feita pelo ID DA SESSÃO, salvo aqui
-- ANTES de a URL ser entregue ao cliente.
ALTER TABLE billing_checkouts
  ADD COLUMN IF NOT EXISTS asaas_checkout_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_checkouts_session_id
  ON billing_checkouts (asaas_checkout_session_id)
  WHERE asaas_checkout_session_id IS NOT NULL;
