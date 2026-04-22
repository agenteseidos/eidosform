ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS address_number TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS province TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT;

CREATE TABLE IF NOT EXISTS billing_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  checkout_id TEXT NOT NULL UNIQUE,
  asaas_customer_id TEXT,
  asaas_subscription_id TEXT,
  plan TEXT NOT NULL,
  cycle TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  last_event TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_checkouts_cycle_check CHECK (cycle IN ('MONTHLY', 'YEARLY'))
);

CREATE INDEX IF NOT EXISTS idx_billing_checkouts_profile_id ON billing_checkouts(profile_id);
CREATE INDEX IF NOT EXISTS idx_billing_checkouts_asaas_customer_id ON billing_checkouts(asaas_customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_checkouts_subscription_id ON billing_checkouts(asaas_subscription_id);

CREATE OR REPLACE FUNCTION update_billing_checkouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS billing_checkouts_updated_at ON billing_checkouts;
CREATE TRIGGER billing_checkouts_updated_at
BEFORE UPDATE ON billing_checkouts
FOR EACH ROW
EXECUTE FUNCTION update_billing_checkouts_updated_at();

ALTER TABLE billing_checkouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own billing checkouts" ON billing_checkouts;
CREATE POLICY "Users can view their own billing checkouts"
  ON billing_checkouts
  FOR SELECT
  USING (auth.uid() = profile_id);
