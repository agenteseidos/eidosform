-- 20260501: Authoritative idempotent RLS final state (P1-K definitive fix)
--
-- This migration is the single source of truth for RLS policies on:
--   responses, answer_items, and forms (anon access to forms table).
--
-- It is FULLY IDEMPOTENT: safe to re-run any number of times.
-- It runs LAST (date 20260501) so it always overrides any prior migration, including
-- the consolidate (20260428) which transiently recreated policies that were later removed.
--
-- Why this is needed: 20260428_consolidate_rls_policies.sql created anon_read_responses,
-- anon_update_responses, and anon_delete_answer_items — policies that allow anonymous
-- users to read and modify response data. Those were removed by the 20260430 fixes,
-- but only if that migration runs. This migration ensures the correct state is enforced
-- regardless of which prior migrations ran or in what order.
--
-- Final policy intent:
--   responses:    anon INSERT only (submit); owners SELECT/UPDATE/DELETE; service_role ALL
--   answer_items: anon INSERT only (submit); owners SELECT/INSERT/DELETE; service_role ALL
--   forms:        anon NO direct access (reads go through published_forms view)

-- ============================================================
-- responses
-- ============================================================

-- Drop every policy name that has ever existed on this table across all migrations
DROP POLICY IF EXISTS "anon_read_published_forms"       ON forms;
DROP POLICY IF EXISTS "anon_read_responses"             ON responses;
DROP POLICY IF EXISTS "anon_update_responses"           ON responses;
DROP POLICY IF EXISTS "anon_delete_responses"           ON responses;
DROP POLICY IF EXISTS "anon_insert_responses"           ON responses;
DROP POLICY IF EXISTS "owners_read_responses"           ON responses;
DROP POLICY IF EXISTS "owners_read_responses_v2"        ON responses;
DROP POLICY IF EXISTS "owners_update_responses"         ON responses;
DROP POLICY IF EXISTS "owners_delete_responses"         ON responses;
DROP POLICY IF EXISTS "owners_delete_responses_v2"      ON responses;
DROP POLICY IF EXISTS "service_role_all_responses"      ON responses;
DROP POLICY IF EXISTS "authenticated_insert_responses"  ON responses;

-- anon: INSERT only — public form submission, only for published forms
CREATE POLICY "anon_insert_responses" ON responses
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = responses.form_id
        AND forms.status = 'published'
    )
  );

-- owners: read responses for their forms
CREATE POLICY "owners_read_responses" ON responses
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = responses.form_id
        AND forms.user_id = auth.uid()
    )
  );

-- owners: update responses for their forms
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

-- owners: delete responses for their forms
CREATE POLICY "owners_delete_responses" ON responses
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = responses.form_id
        AND forms.user_id = auth.uid()
    )
  );

-- service_role: unrestricted (needed for webhook/background jobs)
CREATE POLICY "service_role_all_responses" ON responses
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- answer_items
-- ============================================================

DROP POLICY IF EXISTS "anon_insert_answer_items"           ON answer_items;
DROP POLICY IF EXISTS "anon_read_answer_items"             ON answer_items;
DROP POLICY IF EXISTS "anon_update_answer_items"           ON answer_items;
DROP POLICY IF EXISTS "anon_delete_answer_items"           ON answer_items;
DROP POLICY IF EXISTS "owners_read_answer_items"           ON answer_items;
DROP POLICY IF EXISTS "owners_read_answer_items_v2"        ON answer_items;
DROP POLICY IF EXISTS "owners_insert_answer_items"         ON answer_items;
DROP POLICY IF EXISTS "owners_delete_answer_items"         ON answer_items;
DROP POLICY IF EXISTS "owners_delete_answer_items_v2"      ON answer_items;
DROP POLICY IF EXISTS "service_role_all_answer_items"      ON answer_items;
DROP POLICY IF EXISTS "authenticated_insert_answer_items"  ON answer_items;

-- anon: INSERT only (submitted alongside responses)
CREATE POLICY "anon_insert_answer_items" ON answer_items
  FOR INSERT TO anon
  WITH CHECK (true);

-- owners: read answer_items for their forms
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

-- owners: insert answer_items for their forms (authenticated form preview/debug)
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

-- owners: delete answer_items for their forms
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

-- service_role: unrestricted
CREATE POLICY "service_role_all_answer_items" ON answer_items
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- forms: ensure anon has no direct table access
-- (anon reads published forms ONLY through the published_forms view
--  created in 20260430_fix_security_definer_public_access_whatsapp_logs.sql)
-- ============================================================
DROP POLICY IF EXISTS "anon_read_published_forms" ON forms;
