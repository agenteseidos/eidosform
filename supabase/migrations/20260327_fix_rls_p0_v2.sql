-- FIX P0 v2: Garante remoção completa de todas as policies anon problemáticas em responses e answer_items.
-- Esta migration substitui e reforça a 20260327_fix_p0_rls_responses.sql.
-- As policies anteriores usavam USING(true) permitindo leitura/update irrestrito por anônimos.

-- ============================================================
-- STEP 1: DROP de TODAS as policies anon problemáticas
-- ============================================================

-- Policies em responses (todas as variações de nome que possam existir)
DROP POLICY IF EXISTS "anon_read_responses" ON responses;
DROP POLICY IF EXISTS "anon_update_responses" ON responses;
DROP POLICY IF EXISTS "anon_delete_responses" ON responses;

-- Policies em answer_items
DROP POLICY IF EXISTS "anon_delete_answer_items" ON answer_items;
DROP POLICY IF EXISTS "anon_read_answer_items" ON answer_items;
DROP POLICY IF EXISTS "anon_update_answer_items" ON answer_items;

-- ============================================================
-- STEP 2: Recria policies com escopo restrito a forms publicados
-- ============================================================

-- anon SELECT em responses: apenas de forms publicados
CREATE POLICY "anon_read_responses"
  ON responses FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = responses.form_id
        AND forms.status = 'published'
    )
  );

-- anon UPDATE em responses: apenas de forms publicados
CREATE POLICY "anon_update_responses"
  ON responses FOR UPDATE
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = responses.form_id
        AND forms.status = 'published'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = responses.form_id
        AND forms.status = 'published'
    )
  );

-- anon DELETE em answer_items: apenas para responses de forms publicados
CREATE POLICY "anon_delete_answer_items"
  ON answer_items FOR DELETE
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM responses r
      JOIN forms f ON f.id = r.form_id
      WHERE r.id = answer_items.response_id
        AND f.status = 'published'
    )
  );
