-- Migration: add proration columns to billing_checkouts
ALTER TABLE billing_checkouts
  ADD COLUMN IF NOT EXISTS original_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS proration_credit NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS final_price NUMERIC(10,2);
