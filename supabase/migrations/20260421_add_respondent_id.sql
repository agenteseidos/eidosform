-- Add respondent_id to responses table for partial response tracking
-- Allows identifying which authenticated user owns a partial (incomplete) response

ALTER TABLE responses ADD COLUMN IF NOT EXISTS respondent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index for fast lookup of partial responses by user+form
CREATE INDEX IF NOT EXISTS idx_responses_respondent_form
  ON responses(respondent_id, form_id)
  WHERE completed = false;

-- RLS: Allow authenticated users to read their own incomplete responses
CREATE POLICY "Respondents can read own partial responses"
  ON responses FOR SELECT
  USING (auth.uid() = respondent_id AND completed = false);

-- RLS: Allow authenticated users to insert partial responses
CREATE POLICY "Respondents can insert own partial responses"
  ON responses FOR INSERT
  WITH CHECK (auth.uid() = respondent_id);

-- RLS: Allow authenticated users to update their own incomplete responses
CREATE POLICY "Respondents can update own partial responses"
  ON responses FOR UPDATE
  USING (auth.uid() = respondent_id AND completed = false);
