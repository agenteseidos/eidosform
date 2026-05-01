-- P1-K: Consolidate RLS migrations for responses and answer_items.
-- This migration removes all previously conflicting policies and creates
-- a single clean set of policies.
--
-- Conflicting migrations being consolidated:
--   20260318_public_access_rls.sql
--   20260327_fix_p0_rls_responses.sql
--   20260327_fix_response_visibility_rls.sql
--   20260327_fix_rls_p0_v2.sql
--   20260327_fix_rls_response_leak.sql
--
-- NOTE (2026-05-01 P2 residual fix): anon_read_responses, anon_update_responses and
-- anon_delete_answer_items were intentionally removed from this file.
-- Creating them here then removing them in 20260430_* produced a transient insecure
-- window for deploys that stopped between the two migrations.
-- The DROP IF EXISTS statements below are kept so that environments where those
-- policies were created by an earlier version of this file are cleaned up correctly.
--
-- Final state (idempotent — safe to run multiple times):

-- ============================================================
-- responses table policies
-- ============================================================

-- DROP all existing policies that may conflict
DROP POLICY IF EXISTS "anon_insert_responses" ON responses;
DROP POLICY IF EXISTS "anon_read_responses" ON responses;
DROP POLICY IF EXISTS "anon_update_responses" ON responses;
DROP POLICY IF EXISTS "anon_delete_responses" ON responses;
DROP POLICY IF EXISTS "owners_read_responses" ON responses;
DROP POLICY IF EXISTS "owners_read_responses_v2" ON responses;
DROP POLICY IF EXISTS "owners_update_responses" ON responses;
DROP POLICY IF EXISTS "owners_delete_responses" ON responses;
DROP POLICY IF EXISTS "owners_delete_responses_v2" ON responses;
DROP POLICY IF EXISTS "service_role_all_responses" ON responses;
DROP POLICY IF EXISTS "authenticated_insert_responses" ON responses;

-- anon: INSERT allowed (public form submissions) — WITH CHECK ensures form is published
CREATE POLICY "anon_insert_responses" ON responses
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = responses.form_id
        AND forms.status = 'published'
    )
  );

-- anon_read_responses and anon_update_responses intentionally NOT created here.
-- See header note.

-- authenticated: SELECT responses for forms they own
CREATE POLICY "owners_read_responses" ON responses
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = responses.form_id
        AND forms.user_id = auth.uid()
    )
  );

-- authenticated: UPDATE responses for forms they own
CREATE POLICY "owners_update_responses" ON responses
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = responses.form_id
        AND forms.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = responses.form_id
        AND forms.user_id = auth.uid()
    )
  );

-- authenticated: DELETE responses for forms they own
CREATE POLICY "owners_delete_responses" ON responses
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = responses.form_id
        AND forms.user_id = auth.uid()
    )
  );

-- service_role: full access (bypasses RLS, but explicit for clarity)
CREATE POLICY "service_role_all_responses" ON responses
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- answer_items table policies
-- ============================================================

-- DROP all existing policies
DROP POLICY IF EXISTS "anon_insert_answer_items" ON answer_items;
DROP POLICY IF EXISTS "anon_read_answer_items" ON answer_items;
DROP POLICY IF EXISTS "anon_update_answer_items" ON answer_items;
DROP POLICY IF EXISTS "anon_delete_answer_items" ON answer_items;
DROP POLICY IF EXISTS "owners_read_answer_items" ON answer_items;
DROP POLICY IF EXISTS "owners_read_answer_items_v2" ON answer_items;
DROP POLICY IF EXISTS "owners_delete_answer_items" ON answer_items;
DROP POLICY IF EXISTS "owners_delete_answer_items_v2" ON answer_items;
DROP POLICY IF EXISTS "service_role_all_answer_items" ON answer_items;
DROP POLICY IF EXISTS "authenticated_insert_answer_items" ON answer_items;

-- anon: INSERT allowed (submitted with response)
CREATE POLICY "anon_insert_answer_items" ON answer_items
  FOR INSERT TO anon
  WITH CHECK (true);

-- anon_delete_answer_items intentionally NOT created here. See header note.

-- authenticated: SELECT answer_items for forms they own
CREATE POLICY "owners_read_answer_items" ON answer_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM responses r
      JOIN forms f ON f.id = r.form_id
      WHERE r.id = answer_items.response_id
        AND f.user_id = auth.uid()
    )
  );

-- authenticated: INSERT for form owners
CREATE POLICY "owners_insert_answer_items" ON answer_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM responses r
      JOIN forms f ON f.id = r.form_id
      WHERE r.id = answer_items.response_id
        AND f.user_id = auth.uid()
    )
  );

-- authenticated: DELETE for form owners
CREATE POLICY "owners_delete_answer_items" ON answer_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM responses r
      JOIN forms f ON f.id = r.form_id
      WHERE r.id = answer_items.response_id
        AND f.user_id = auth.uid()
    )
  );

-- service_role: full access
CREATE POLICY "service_role_all_answer_items" ON answer_items
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
