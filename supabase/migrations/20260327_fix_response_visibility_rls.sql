-- Fix QA Round 1: authenticated owners must be able to read responses and answer items
-- even after anonymous public submissions.

DO $$ BEGIN
  CREATE POLICY "owners_read_responses_v2" ON responses FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM forms
        WHERE forms.id = responses.form_id
          AND forms.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "owners_delete_responses_v2" ON responses FOR DELETE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM forms
        WHERE forms.id = responses.form_id
          AND forms.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "owners_read_answer_items_v2" ON answer_items FOR SELECT
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
