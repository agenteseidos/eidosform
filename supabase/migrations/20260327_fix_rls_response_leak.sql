-- P0 Fix: Remove overly permissive anon policies on responses and answer_items
-- anon should only INSERT (submit forms). SELECT/UPDATE/DELETE restricted to authenticated owners.

-- Drop the dangerous anon policies that allow unrestricted read/update/delete
DROP POLICY IF EXISTS "anon_read_responses" ON responses;
DROP POLICY IF EXISTS "anon_update_responses" ON responses;
DROP POLICY IF EXISTS "anon_delete_answer_items" ON answer_items;

-- Authenticated owners can update their form responses (e.g. mark as read)
DO $$ BEGIN
  CREATE POLICY "owners_update_responses" ON responses FOR UPDATE
    TO authenticated
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
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Authenticated owners can delete answer_items for their forms
DO $$ BEGIN
  CREATE POLICY "owners_delete_answer_items" ON answer_items FOR DELETE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM responses r
        JOIN forms f ON f.id = r.form_id
        WHERE r.id = answer_items.response_id
          AND f.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
