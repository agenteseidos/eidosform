-- Migration: adiciona campos plan e pixels (JSONB consolidado) na tabela forms
-- Data: 2026-03-17

-- Adiciona coluna plan no forms (herda do profile mas permite override por form)
ALTER TABLE forms ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free' NOT NULL;

-- Adiciona coluna pixels JSONB consolidada
-- Estrutura: { "facebook": "ID", "google": "ID", "tiktok": "ID", "custom": [...] }
ALTER TABLE forms ADD COLUMN IF NOT EXISTS pixels JSONB DEFAULT NULL;

-- Migra dados existentes de pixel para o novo campo JSONB consolidado
UPDATE forms SET pixels = jsonb_strip_nulls(jsonb_build_object(
  'facebook', meta_pixel_id,
  'google', COALESCE(gtm_id, google_ads_id),
  'tiktok', tiktok_pixel_id
))
WHERE meta_pixel_id IS NOT NULL 
   OR google_ads_id IS NOT NULL 
   OR gtm_id IS NOT NULL 
   OR tiktok_pixel_id IS NOT NULL;

-- Nota: campos individuais (meta_pixel_id, google_ads_id, etc.) são mantidos por compatibilidade
-- Podem ser removidos em uma migration futura após validação

COMMENT ON COLUMN forms.pixels IS 'Pixel tracking config: {facebook, google, tiktok, custom[]}';
COMMENT ON COLUMN forms.plan IS 'Plan tier para este form: free | pro | enterprise';
