-- Add redirect_delay column to forms table
-- Allows configuring custom redirect delay after form submission
ALTER TABLE forms ADD COLUMN IF NOT EXISTS redirect_delay integer NOT NULL DEFAULT 3000;
-- Default 3000ms (3s), matching the previous hardcoded value
