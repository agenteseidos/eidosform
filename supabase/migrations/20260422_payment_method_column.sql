-- Add payment_method column to billing_checkouts
ALTER TABLE billing_checkouts ADD COLUMN IF NOT EXISTS payment_method TEXT;
