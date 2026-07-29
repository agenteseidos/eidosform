-- Pré-venda 2026-07-29 — etapa 2/2 do fechamento de RLS.
--
-- APLICAR SOMENTE depois de:
--   1. 20260729_01_create_public_domain_resolver.sql;
--   2. deploy do middleware que usa resolve_public_custom_domain;
--   3. teste do resolver.
--
-- Estado vivo confirmado via pg_policies em 2026-07-29:
--   * forms: "Anyone can view published forms" expõe todas as colunas;
--   * responses: "anon_insert_responses" permite bypass da API/cota;
--   * answer_items: duas policies permitem INSERT anônimo;
--   * custom_domains: SELECT de tabela expõe colunas além do necessário.

-- Leitura pública de formulários passa exclusivamente pela view column-safe
-- public.published_forms. Resolução de domínio passa pela RPC da etapa 1.
DROP POLICY IF EXISTS "Anyone can view published forms" ON public.forms;
DROP POLICY IF EXISTS "anon_read_published_forms" ON public.forms;
REVOKE SELECT ON TABLE public.forms FROM anon;

DROP POLICY IF EXISTS "Anon can read verified custom domains" ON public.custom_domains;
REVOKE SELECT ON TABLE public.custom_domains FROM anon;

-- Toda submissão pública legítima passa pelas rotas da aplicação, que usam
-- service_role depois de validação, rate limit e cobrança da cota.
DROP POLICY IF EXISTS "Anyone can submit responses to published forms" ON public.responses;
DROP POLICY IF EXISTS "anon_insert_responses" ON public.responses;
REVOKE INSERT ON TABLE public.responses FROM anon;
-- Os fluxos autenticados também escrevem pelas rotas service_role. Impede o
-- dono do form de forjar quota_counted_at via REST direto.
DROP POLICY IF EXISTS "Respondents can insert own partial responses" ON public.responses;
DROP POLICY IF EXISTS "owners_update_responses" ON public.responses;
REVOKE INSERT, UPDATE ON TABLE public.responses FROM authenticated;

DROP POLICY IF EXISTS "Anyone can insert answer items for published forms" ON public.answer_items;
DROP POLICY IF EXISTS "anon_insert_answer_items" ON public.answer_items;
REVOKE INSERT ON TABLE public.answer_items FROM anon;
DROP POLICY IF EXISTS "owners_insert_answer_items" ON public.answer_items;
REVOKE INSERT ON TABLE public.answer_items FROM authenticated;

-- Garante que os caminhos públicos mínimos continuam disponíveis.
GRANT SELECT ON TABLE public.published_forms TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_public_custom_domain(text) TO anon, authenticated, service_role;
