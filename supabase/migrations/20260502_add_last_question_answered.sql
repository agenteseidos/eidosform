-- Add last_question_answered column to responses table
-- Used to track which question the respondent last answered (for partial responses / analytics)

ALTER TABLE responses ADD COLUMN IF NOT EXISTS last_question_answered TEXT;
