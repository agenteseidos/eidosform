-- #2b (2026-06-08): guarda o token do cartão (Asaas, armazenado POR CLIENTE) para permitir
-- recriar/reativar a assinatura sem pedir o cartão de novo — necessário quando o usuário
-- cancelou (a sub é deletada no Asaas) e depois quer reassinar um plano coberto pelo saldo.
-- Token é capturado na ativação (finalizeActivation). NÃO é dado de cartão cru — é o token
-- seguro do Asaas, cujo propósito é exatamente ser armazenado para cobranças recorrentes.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS asaas_card_token text;

COMMENT ON COLUMN profiles.asaas_card_token IS
  'Token do cartão tokenizado no Asaas (por cliente). Usado para recriar assinatura na reativação pós-cancelamento, sem novo input de cartão.';
