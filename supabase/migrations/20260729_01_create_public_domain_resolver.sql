-- Pré-venda 2026-07-29 — etapa 1/2 do fechamento de RLS.
--
-- O middleware precisa resolver hostname -> slug antes de fechar o SELECT
-- anônimo direto em custom_domains/forms. Esta RPC SECURITY DEFINER expõe
-- somente o slug de um formulário publicado ligado a um domínio verificado.
--
-- ORDEM EM PRODUÇÃO:
--   1. aplicar este arquivo;
--   2. deployar o middleware que usa resolve_public_custom_domain;
--   3. testar um hostname e só então aplicar a migration 02.

CREATE OR REPLACE FUNCTION public.resolve_public_custom_domain(p_hostname text)
RETURNS TABLE(slug text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.slug
  FROM public.custom_domains AS cd
  JOIN public.forms AS f ON f.id = cd.form_id
  WHERE lower(cd.domain) = lower(trim(p_hostname))
    AND cd.verified = true
    AND (f.status = 'published'::public.form_status OR f.is_published = true)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_public_custom_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_public_custom_domain(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.resolve_public_custom_domain(text) IS
  'Resolução pública mínima hostname->slug; não expõe form_id, user_id nem configuração do formulário.';
