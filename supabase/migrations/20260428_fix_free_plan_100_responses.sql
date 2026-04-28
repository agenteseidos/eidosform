-- P0-D: Fix free plan response limit from 50 to 100
-- 1. Update existing free users who have 50 responses_limit
-- 2. Update the trigger to use 100 for new users (idempotent)

-- Update existing free users
UPDATE public.profiles
SET responses_limit = 100
WHERE plan = 'free'
  AND responses_limit = 50;

-- The trigger in 20260424_auto_create_profile_on_signup.sql was already updated to 100.
-- This migration handles existing data.
