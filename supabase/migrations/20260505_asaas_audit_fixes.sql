-- Migration: Asaas integration audit fixes (2026-05-05)
--
-- 1. Add asaas_customer_payload_hash to profiles (P1-2: dedup updateCustomer calls)
-- 2. Add billing_period_end to billing_checkouts (P1-5: persist subscription end date)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS asaas_customer_payload_hash TEXT;

ALTER TABLE billing_checkouts
  ADD COLUMN IF NOT EXISTS billing_period_end TIMESTAMPTZ;
