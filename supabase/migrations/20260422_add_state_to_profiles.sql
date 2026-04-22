-- Add state (UF) column to profiles table for billing
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS state text;

-- Populate existing rows that have a province (bairro) with empty state
-- (no data migration needed — ViaCEP will fill it on next CEP lookup)
