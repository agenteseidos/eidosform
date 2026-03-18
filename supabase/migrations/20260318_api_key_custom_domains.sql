-- Migration: API Key no profile + tabela custom_domains

-- 1. Adicionar campo api_key na tabela profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS api_key TEXT UNIQUE;

-- Índice para lookup rápido por api_key
CREATE INDEX IF NOT EXISTS idx_profiles_api_key ON profiles(api_key);

-- 2. Tabela de domínios personalizados
CREATE TABLE IF NOT EXISTS custom_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  form_id UUID REFERENCES forms(id) ON DELETE SET NULL,
  domain TEXT NOT NULL UNIQUE,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_domains_user_id ON custom_domains(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_domains_form_id ON custom_domains(form_id);

-- RLS para custom_domains
ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own domains"
  ON custom_domains
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Função para gerar API key segura (32 chars hex)
CREATE OR REPLACE FUNCTION generate_api_key()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT 'ek_' || encode(gen_random_bytes(24), 'hex');
$$;

-- Trigger para atualizar updated_at em custom_domains
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_custom_domains_updated_at ON custom_domains;
CREATE TRIGGER update_custom_domains_updated_at
  BEFORE UPDATE ON custom_domains
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON COLUMN profiles.api_key IS 'API key para acesso à API pública (plano Professional)';
COMMENT ON TABLE custom_domains IS 'Domínios personalizados associados aos formulários via Vercel API';
