-- Pré-venda 2026-07-29 — hardening pós-deploy de escritas diretas no profile.
--
-- APLICAR SOMENTE depois de o SHA novo estar READY. A versão anterior da rota
-- de API key ainda escrevia api_key_hash pelo cliente autenticado; o código
-- novo usa service_role para essa operação.
--
-- A policy histórica de UPDATE não protege colunas adicionadas depois. Sem
-- privilégio por coluna, um usuário poderia forjar email_confirmed_at e os
-- campos da cota diretamente pelo PostgREST.

REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (
  full_name,
  avatar_url,
  phone,
  cpf_cnpj,
  address,
  address_number,
  postal_code,
  complement,
  province,
  city,
  state
) ON TABLE public.profiles TO authenticated;
