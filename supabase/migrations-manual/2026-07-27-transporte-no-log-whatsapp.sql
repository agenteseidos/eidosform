-- Migração MANUAL — aplicar no SQL Editor do Supabase.
-- Não destrutiva, aditiva, e SEGURA de rodar mais de uma vez.
--
-- Objetivo: registrar POR QUAL MOTOR cada notificação saiu (wuzapi | wacli),
-- para o painel /admin/whatsapp poder mostrar em "Últimos envios":
--
--     11997171418 (WuzAPI)
--     Pesquisa — Raciocínio Clínico na Gestalt-terapia (RCGT0826)
--
-- Até 2026-07-27 essa informação não existia em lugar nenhum: a VPS não
-- devolvia o motor na resposta de envio e a tabela não tinha onde guardar.
--
-- ⚠️ SEM DEFAULT, DE PROPÓSITO.
-- No Postgres, `ADD COLUMN ... DEFAULT <valor>` PREENCHE TAMBÉM AS LINHAS
-- EXISTENTES. Foi exatamente essa armadilha que causou o incidente de
-- 2026-07-23 (213 respostas antigas ganharam `last_activity_at = now()` e o
-- cron disparou alerta de lead abandonado para gente de meses atrás).
-- Aqui a coluna nasce NULA: envios anteriores à migração NÃO têm como saber
-- por onde saíram, e o painel mostra "—". Nulo honesto é melhor que um valor
-- inventado que parece dado real.
--
-- A ordem entre esta migração e o deploy NÃO importa: o código detecta a
-- coluna ausente e grava sem ela até a migração rodar.

ALTER TABLE form_whatsapp_logs
  ADD COLUMN IF NOT EXISTS transport text;

COMMENT ON COLUMN form_whatsapp_logs.transport IS
  'Motor de transporte que entregou (wuzapi | wacli). NULO em envios anteriores a 2026-07-27, quando o dado passou a ser gravado.';

-- Conferência (opcional): deve listar a coluna nova.
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'form_whatsapp_logs' AND column_name = 'transport';
