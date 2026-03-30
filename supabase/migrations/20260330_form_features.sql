-- Toggle fechar formulário
ALTER TABLE forms ADD COLUMN IF NOT EXISTS is_closed BOOLEAN NOT NULL DEFAULT FALSE;

-- Toggle ocultar branding
ALTER TABLE forms ADD COLUMN IF NOT EXISTS hide_branding BOOLEAN NOT NULL DEFAULT FALSE;

-- Notificação por email
ALTER TABLE forms ADD COLUMN IF NOT EXISTS notify_email_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS notify_email TEXT;

-- Notificação por WhatsApp
ALTER TABLE forms ADD COLUMN IF NOT EXISTS notify_whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS notify_whatsapp_number TEXT;

-- Google Sheets
ALTER TABLE forms ADD COLUMN IF NOT EXISTS google_sheets_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS google_sheets_id TEXT;
