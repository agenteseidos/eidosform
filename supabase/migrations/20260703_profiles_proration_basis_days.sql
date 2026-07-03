-- proration_basis_days: RÉGUA DE VALORAÇÃO (denominador) dos dias restantes do plano
-- vigente. credit = planPrice / proration_basis_days × remainingPaidDays.
-- NÃO é "duração até a próxima cobrança" (essa armadilha faz o downgrade perder saldo):
-- é quantos dias UM preço-cheio compra. Período REAL do Asaas na 1ª compra/renovação
-- (28-31/365-366); 30/365 nominal quando a sub é criada por nós (executePlanSwitch,
-- incl. saldo-vira-tempo). NULLABLE: legado (base ausente) cai no fallback 30/365 no
-- código, COM log. Sem backfill comercial (zero clientes pagantes reais; a conta E2E
-- foi resetada p/ free). smallint: 28..366 cabe folgado.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS proration_basis_days smallint;

COMMENT ON COLUMN profiles.proration_basis_days IS
  'Denominador de valoração da proration: dias que UM preço-cheio do plano vigente compra. Período real do Asaas (1a compra/renovacao) ou 30/365 nominal (executePlanSwitch/saldo-vira-tempo). NULL = legado -> fallback 30/365 no codigo, com log. NAO usar coverageDays.';

-- Auditoria (opcional, mas barata e útil p/ conferir a base gravada):
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS billing_period_start_on date;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS billing_period_end_on date;

COMMENT ON COLUMN profiles.billing_period_start_on IS
  'Auditoria: inicio do periodo pago corrente (payment.dueDate) usado p/ derivar proration_basis_days.';
COMMENT ON COLUMN profiles.billing_period_end_on IS
  'Auditoria: fim do periodo pago corrente (subscription.nextDueDate) usado p/ derivar proration_basis_days.';
