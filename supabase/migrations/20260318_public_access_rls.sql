-- OBSOLETE: anon_read_responses, anon_update_responses, anon_delete_answer_items superseded by
-- 20260428_consolidate_rls_policies.sql and then removed by 20260430_fix_rls_responses_answer_items_profiles.sql.
-- anon_insert_responses and anon_insert_answer_items superseded by 20260428_consolidate_rls_policies.sql.
-- anon_read_published_forms removed by 20260430_fix_security_definer_public_access_whatsapp_logs.sql.
-- Kept for migration history only.

-- Allow anonymous (unauthenticated) users to read published forms
CREATE POLICY "anon_read_published_forms"
  ON forms FOR SELECT
  TO anon
  USING (status = 'published');

-- Allow anonymous users to insert responses (public form submissions)
CREATE POLICY "anon_insert_responses"
  ON responses FOR INSERT
  TO anon
  WITH CHECK (true);

-- FIX P0: anon SELECT restrito a responses cujo form_id pertence a um form publicado.
-- Impede leitura de respostas de outros usuários.
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

-- FIX P0: anon UPDATE restrito ao próprio response_id (via header X-Response-Id).
-- A API já verifica .eq('id', existingResponseId).eq('form_id', ...) — RLS adiciona
-- a camada de garantia: só permite update se o form estiver publicado.
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

-- Allow anonymous users to insert answer_items (normalized analytics data)
CREATE POLICY "anon_insert_answer_items"
  ON answer_items FOR INSERT
  TO anon
  WITH CHECK (true);

-- FIX P0: anon DELETE em answer_items apenas para responses de forms publicados.
-- Evita que anônimo apague answer_items de respostas alheias.
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
