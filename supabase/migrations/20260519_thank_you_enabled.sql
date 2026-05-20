-- 20260519_thank_you_enabled.sql
-- Adiciona toggle pra desativar a tela de agradecimento (similar ao welcome_enabled).
-- DEFAULT true preserva o comportamento atual em todos os forms existentes.

ALTER TABLE forms
  ADD COLUMN IF NOT EXISTS thank_you_enabled boolean NOT NULL DEFAULT true;

-- Verificação rápida:
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'forms' AND column_name = 'thank_you_enabled';
