-- ETAPA 4 / P2-Q
-- Normalize legacy forms.plan values and constrain to valid app plan ids.

UPDATE forms
SET plan = CASE lower(plan)
  WHEN 'free' THEN 'free'
  WHEN 'starter' THEN 'starter'
  WHEN 'plus' THEN 'plus'
  WHEN 'professional' THEN 'professional'
  WHEN 'pro' THEN 'professional'
  WHEN 'enterprise' THEN 'professional'
  ELSE 'free'
END
WHERE plan IS DISTINCT FROM CASE lower(plan)
  WHEN 'free' THEN 'free'
  WHEN 'starter' THEN 'starter'
  WHEN 'plus' THEN 'plus'
  WHEN 'professional' THEN 'professional'
  WHEN 'pro' THEN 'professional'
  WHEN 'enterprise' THEN 'professional'
  ELSE 'free'
END;

ALTER TABLE forms DROP CONSTRAINT IF EXISTS forms_plan_valid;

ALTER TABLE forms
  ADD CONSTRAINT forms_plan_valid
  CHECK (plan IN ('free', 'starter', 'plus', 'professional'));

COMMENT ON COLUMN forms.plan IS 'Legacy snapshot of owner plan. Valid values constrained to app plan ids.';
