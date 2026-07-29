-- Pré-venda 2026-07-29 — limpeza pós-deploy da cota.
--
-- APLICAR SOMENTE depois de o SHA com check_and_increment_response(user,response)
-- estar READY e uma submissão de teste ter sido contabilizada corretamente.

DROP FUNCTION IF EXISTS public.check_and_increment_response(uuid);
