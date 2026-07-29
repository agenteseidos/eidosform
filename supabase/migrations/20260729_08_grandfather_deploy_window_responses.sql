-- Pré-venda 2026-07-29 — fecha a janela entre migration de cota e deploy.
--
-- A migration 03 marcou o histórico existente, mas a produção continuou
-- recebendo respostas com o código legado durante sua execução. Essas respostas
-- já passaram pela contagem antiga; marcá-las agora evita ambiguidade sem
-- incrementar responses_used (decisão explícita: sem retroatividade).
--
-- APLICAR SOMENTE depois de o SHA novo estar READY: a versão nova sempre grava
-- quota_counted_at antes de promover completed=true, então qualquer NULL
-- restante é inequivocamente legado da janela de deploy.

UPDATE public.responses
SET quota_counted_at = COALESCE(submitted_at, now())
WHERE completed = true
  AND quota_counted_at IS NULL
RETURNING id, form_id, submitted_at, quota_counted_at;
