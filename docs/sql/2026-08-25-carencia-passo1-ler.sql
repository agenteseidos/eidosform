-- ════════════════════════════════════════════════════════════════════════════════════════════
-- CARÊNCIA DE INADIMPLÊNCIA · PASSO 1 de 2 — SÓ LEITURA, não altera nada
--
-- Por que este passo existe: a REGRA Nº 1 deste projeto diz que os arquivos .sql do repositório
-- NÃO descrevem o banco real (já divergiram 6 vezes, uma delas derrubou todos os submits por
-- ~20h). Antes de reescrever a função da cota eu preciso ver a versão que está de fato rodando.
--
-- COMO USAR: cole no SQL Editor do painel Supabase, rode, e me mande o resultado inteiro.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- 1) A função da cota, como ela existe HOJE no banco (assinatura real + corpo completo).
SELECT
  p.oid::regprocedure                AS assinatura_real,
  p.prosecdef                        AS security_definer,
  pg_get_functiondef(p.oid)          AS definicao_completa
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'check_and_increment_response'
  AND n.nspname = 'public';

-- 2) Os tipos REAIS das colunas que a carência vai passar a ler (o database.types.ts já mentiu
--    sobre uma coluna antes — caso 6 da regra).
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name IN ('plan', 'plan_status', 'plan_expires_at', 'asaas_subscription_id', 'responses_limit')
ORDER BY column_name;

-- 3) Quais valores de plan_status existem de verdade na base (a carência depende de 'active';
--    se houver variação de caixa ou valor legado, o patch precisa saber).
SELECT plan_status, count(*) AS perfis
FROM public.profiles
GROUP BY plan_status
ORDER BY perfis DESC;
