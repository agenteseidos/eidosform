-- =====================================================================
-- TRIAL — PASSO 1 de 3: adicionar 'trial' ao enum plan_type
-- RODAR SOZINHO. Não juntar com os outros scripts.
-- Motivo: no Postgres, um valor novo de enum NÃO pode ser USADO na mesma
-- transação em que foi criado ("unsafe use of new value of enum type").
-- O SQL Editor do Supabase envolve o script em transação, então misturar
-- este ALTER com as tabelas/funções que citam 'trial' quebra.
-- Estado conferido no catálogo em 28/08: plan_type = free|starter|plus|professional.
-- =====================================================================

ALTER TYPE public.plan_type ADD VALUE IF NOT EXISTS 'trial';

-- Conferência (rode DEPOIS, numa segunda execução):
--   SELECT enum_range(NULL::public.plan_type);
--   -> esperado: {free,starter,plus,professional,trial}
