-- 20260615_billing_checkout_attempt_id
-- P0-A (2026-06-15, reforço pós-Codex): identificador ÚNICO por TENTATIVA de troca de plano.
-- A linha de recuperação 'planchange-pay-{profile}' é reusada entre trocas; sem um nonce por
-- tentativa, duas trocas pro MESMO plano (em momentos diferentes) colidem no mesmo externalReference,
-- e o fluxo reaproveitava o avulso antigo → PULAVA a cobrança da troca nova (vazamento de receita).
-- Este id entra no externalReference do avulso, tornando cada tentativa única. Aditiva e idempotente.
ALTER TABLE billing_checkouts ADD COLUMN IF NOT EXISTS planchange_attempt_id TEXT;

COMMENT ON COLUMN billing_checkouts.planchange_attempt_id IS
  'Nonce por TENTATIVA de troca de plano; idempotência por tentativa, entra no externalReference (P0-A, 2026-06-15).';
