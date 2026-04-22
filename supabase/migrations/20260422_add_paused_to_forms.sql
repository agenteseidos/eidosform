-- Downgrade de plano: pausar formulários acima do limite do plano free
ALTER TABLE forms ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE;
