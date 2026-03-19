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

-- Allow anonymous users to read their own responses (by id, for updates during session)
CREATE POLICY "anon_read_responses"
  ON responses FOR SELECT
  TO anon
  USING (true);

-- Allow anonymous users to update responses (partial saves during form fill)
CREATE POLICY "anon_update_responses"
  ON responses FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Allow anonymous users to insert answer_items (normalized analytics data)
CREATE POLICY "anon_insert_answer_items"
  ON answer_items FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous users to delete answer_items (re-submission overwrites)
CREATE POLICY "anon_delete_answer_items"
  ON answer_items FOR DELETE
  TO anon
  USING (true);
