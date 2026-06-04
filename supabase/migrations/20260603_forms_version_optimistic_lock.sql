-- Camada 1 — Controle de concorrência otimista para `forms`.
--
-- Problema que resolve: o builder tem autosave (debounce 1.5s). Com duas abas abertas,
-- uma aba desatualizada salvava por cima da outra (lost update) e o EidosForm não tem
-- histórico — o estado novo era perdido sem aviso.
--
-- Solução: coluna `version` que incrementa a cada UPDATE bem-sucedido. O PATCH
-- /api/forms/[id] passa a fazer UPDATE condicional (WHERE version = expectedVersion).
-- Se 0 linhas casarem, é porque outra aba/sessão alterou o form no intervalo -> a API
-- responde 409 e o builder pausa o salvamento, pedindo recarregar (em vez de sobrescrever).
--
-- Idempotente: pode rodar mais de uma vez sem erro.
--
-- ⚠️ ORDEM DE DEPLOY (importante): rodar ESTA migration no Supabase SQL Editor ANTES
-- de publicar o código novo na Vercel. O código novo lê e grava `forms.version`; se a
-- coluna ainda não existir, todo save falharia com 500.

ALTER TABLE public.forms
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;

-- Backfill defensivo (o DEFAULT já preenche as linhas existentes com 0; este UPDATE
-- cobre qualquer linha que por algum motivo tenha ficado NULL).
UPDATE public.forms SET version = 0 WHERE version IS NULL;

-- Verificação (rode separado e confira que a coluna existe e vem preenchida):
-- SELECT id, title, version, updated_at FROM public.forms ORDER BY updated_at DESC LIMIT 5;
