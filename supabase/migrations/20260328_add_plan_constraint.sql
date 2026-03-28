-- P1 #3: Add CHECK constraint to profiles.plan column
-- Ensures only valid plan IDs can be stored in the database.
-- Values must match PlanId type in lib/plans.ts.

-- First, normalize any invalid existing values to 'free'
UPDATE profiles
SET plan = 'free'
WHERE plan IS NULL
   OR plan NOT IN ('free', 'starter', 'plus', 'professional');

-- Set NOT NULL default so new rows always get a valid plan
ALTER TABLE profiles
ALTER COLUMN plan SET DEFAULT 'free',
ALTER COLUMN plan SET NOT NULL;

-- Add the CHECK constraint
ALTER TABLE profiles
ADD CONSTRAINT profiles_plan_check
CHECK (plan IN ('free', 'starter', 'plus', 'professional'));
