-- Migration: Sprint Dia 4-5 — Planos, Asaas, Webhooks
-- 2026-03-18

-- 1. Adicionar campos de plano e Asaas na tabela profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS plan_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS response_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS limit_alert_sent BOOLEAN NOT NULL DEFAULT false;

-- Index para lookup por customer_id do Asaas
CREATE INDEX IF NOT EXISTS idx_profiles_asaas_customer ON profiles(asaas_customer_id);

-- 2. Adicionar webhook_url na tabela forms
ALTER TABLE forms
  ADD COLUMN IF NOT EXISTS webhook_url TEXT;

-- 3. Função para incrementar response_count atomicamente
CREATE OR REPLACE FUNCTION increment_response_count(user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET response_count = response_count + 1
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RLS: profiles pode ser atualizado pelo service_role (webhooks Asaas)
-- (já deve estar ok se service_role bypassa RLS)
