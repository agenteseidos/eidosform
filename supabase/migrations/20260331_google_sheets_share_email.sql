-- Google Sheets: email para compartilhamento da planilha
ALTER TABLE forms ADD COLUMN IF NOT EXISTS google_sheets_share_email TEXT;
