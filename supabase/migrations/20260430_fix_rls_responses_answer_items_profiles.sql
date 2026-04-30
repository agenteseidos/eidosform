-- 20260430: Fix critical RLS issues
--
-- 1. Remove anon read/update from responses (responses should only be readable by owners)
-- 2. Remove anon delete from answer_items
-- 3. Restrict profile UPDATE to safe fields only (prevent users from modifying billing/plan fields)

-- ============================================================
-- responses: remove anon read and anon update
-- ============================================================
DROP POLICY IF EXISTS "anon_read_responses" ON responses;
DROP POLICY IF EXISTS "anon_update_responses" ON responses;

-- anon: only INSERT allowed (public form submissions)
-- No SELECT, UPDATE, or DELETE for anon on responses

-- ============================================================
-- answer_items: remove anon delete
-- ============================================================
DROP POLICY IF EXISTS "anon_delete_answer_items" ON answer_items;

-- anon: only INSERT allowed
-- No SELECT, UPDATE, or DELETE for anon on answer_items

-- ============================================================
-- profiles: restrict UPDATE to safe fields only
-- ============================================================

-- Drop the overly permissive update policy
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;

-- Create a restricted update policy using a column-level check
-- Only allow updating safe profile fields, not billing/plan fields
CREATE POLICY "Users can update safe profile fields" ON profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    -- Safe fields: only these columns can change
    -- Billing/plan fields must remain unchanged
    plan IS NOT DISTINCT FROM (
      SELECT plan FROM profiles WHERE id = auth.uid()
    )
    AND responses_limit IS NOT DISTINCT FROM (
      SELECT responses_limit FROM profiles WHERE id = auth.uid()
    )
    AND responses_used IS NOT DISTINCT FROM (
      SELECT responses_used FROM profiles WHERE id = auth.uid()
    )
    AND plan_status IS NOT DISTINCT FROM (
      SELECT plan_status FROM profiles WHERE id = auth.uid()
    )
    AND plan_expires_at IS NOT DISTINCT FROM (
      SELECT plan_expires_at FROM profiles WHERE id = auth.uid()
    )
    AND plan_cycle IS NOT DISTINCT FROM (
      SELECT plan_cycle FROM profiles WHERE id = auth.uid()
    )
    AND asaas_customer_id IS NOT DISTINCT FROM (
      SELECT asaas_customer_id FROM profiles WHERE id = auth.uid()
    )
    AND asaas_subscription_id IS NOT DISTINCT FROM (
      SELECT asaas_subscription_id FROM profiles WHERE id = auth.uid()
    )
    AND asaas_plan_id IS NOT DISTINCT FROM (
      SELECT asaas_plan_id FROM profiles WHERE id = auth.uid()
    )
    AND asaas_payment_method IS NOT DISTINCT FROM (
      SELECT asaas_payment_method FROM profiles WHERE id = auth.uid()
    )
    AND asaas_webhook_secret IS NOT DISTINCT FROM (
      SELECT asaas_webhook_secret FROM profiles WHERE id = auth.uid()
    )
  );
