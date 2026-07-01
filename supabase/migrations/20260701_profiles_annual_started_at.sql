-- Janela do benefício de migração (política Sidney 2026-07-01): início da assinatura
-- ANUAL vigente, gravado de forma explícita (Codex Rodada 6 P1 — não inferir início
-- comercial por billing_checkouts.created_at).
--
-- Semântica (será implementada no código de ativação APÓS esta migration ser aplicada):
--   • grava quando o profile passa a ter plano pago com ciclo YEARLY vindo de um estado
--     que NÃO era anual ativo (1ª compra anual, conversão mensal→anual, reativação);
--   • NÃO é resetado em renovação nem em upgrade anual→anual (a "assinatura anual
--     vigente" continua a mesma relação comercial);
--   • zerado (NULL) quando o plano cai pra free/cancelado.
--
-- Aditiva e idempotente. Backfill: melhor esforço pelo checkout pago YEARLY mais
-- recente de cada profile atualmente anual (mesma heurística que o endpoint usa hoje).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS annual_started_at timestamptz;

COMMENT ON COLUMN profiles.annual_started_at IS
  'Início da assinatura ANUAL vigente (janela do benefício de migração feita-pela-equipe, 20d). Não reseta em renovação/upgrade anual→anual.';

UPDATE profiles p
SET annual_started_at = sub.created_at
FROM (
  SELECT DISTINCT ON (bc.profile_id) bc.profile_id, bc.created_at
  FROM billing_checkouts bc
  WHERE bc.status = 'paid' AND bc.cycle = 'YEARLY'
  ORDER BY bc.profile_id, bc.created_at DESC
) sub
WHERE p.id = sub.profile_id
  AND p.plan_cycle = 'YEARLY'
  AND p.plan_status IN ('active', 'canceling')
  AND p.annual_started_at IS NULL;
