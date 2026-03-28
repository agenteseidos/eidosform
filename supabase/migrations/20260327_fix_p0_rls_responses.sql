-- FIX P0: Corrige vazamento de RLS nas tabelas responses e answer_items
-- Políticas anteriores usavam USING(true) permitindo acesso irrestrito a anônimos.
-- As novas políticas restringem leitura/update/delete ao escopo do form publicado.

-- Drop políticas inseguras existentes
DROP POLICY IF EXISTS "anon_read_responses" ON responses;
DROP POLICY IF EXISTS "anon_update_responses" ON responses;
DROP POLICY IF EXISTS "anon_delete_answer_items" ON answer_items;

-- Recria leitura anon: apenas responses de forms publicados
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

-- Recria update anon: apenas responses de forms publicados
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

-- Recria delete anon em answer_items: apenas para responses de forms publicados
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
