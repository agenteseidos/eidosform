-- 20260608_uniq_profiles_asaas_customer_id
-- Garante 1 customer Asaas ↔ 1 profile. O webhook agora confia nessa relação para
-- resolver o DONO pelo customerId (pivô 2026-06-08). Sem unicidade, um customer
-- duplicado em 2 profiles tornaria a resolução do dono ambígua. (P3, audit Codex 2026-06-08.)
--
-- ⚠️ ANTES DE APLICAR: checar se há duplicados (a criação do índice falha se houver):
--   select asaas_customer_id, count(*)
--   from profiles
--   where asaas_customer_id is not null
--   group by asaas_customer_id
--   having count(*) > 1;
-- Se retornar linhas, resolver os duplicados manualmente antes de rodar o índice.
--
-- CONCURRENTLY não pode rodar dentro de transação — rodar este comando AVULSO no SQL
-- editor do Supabase (não dentro de um BEGIN/COMMIT).

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uniq_profiles_asaas_customer_id
  ON profiles (asaas_customer_id)
  WHERE asaas_customer_id IS NOT NULL;
