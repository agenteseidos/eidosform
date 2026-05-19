-- Migration: P1-6 — remover INSERT anônimo irrestrito em answer_items
--
-- Contexto: a policy "anon_insert_answer_items" era FOR INSERT TO anon
-- WITH CHECK (true) — sem nenhuma verificação. Qualquer cliente de posse da
-- anon key podia inserir linhas arbitrárias em answer_items para qualquer
-- response_id, poluindo os dados de analytics.
--
-- A aplicação NÃO usa o papel anon para escrever: toda submissão pública
-- passa por createPublicClient(), que usa SUPABASE_SERVICE_ROLE_KEY. O INSERT
-- legítimo continua coberto por "service_role_all_answer_items" (service_role)
-- e por "owners_insert_answer_items" (donos autenticados).
--
-- Fix: remover a policy de INSERT anônimo. Com RLS ativo e sem policy de
-- INSERT para anon, o papel anon deixa de conseguir inserir em answer_items.
--
-- Idempotente: DROP ... IF EXISTS.

DROP POLICY IF EXISTS "anon_insert_answer_items" ON answer_items;

-- Verificação (rodar após o DROP) — não deve listar nenhuma policy de INSERT
-- para o papel anon em answer_items:
--   SELECT polname, polcmd, polroles::regrole[]
--   FROM pg_policy WHERE polrelid = 'answer_items'::regclass;
