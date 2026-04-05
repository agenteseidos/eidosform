-- Create form_whatsapp_settings table for WhatsApp integration configuration
CREATE TABLE IF NOT EXISTS form_whatsapp_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,
  owner_phone VARCHAR(20) NOT NULL,
  message_template TEXT DEFAULT 'Nova resposta em {form_name}: {nome}',
  instance_name VARCHAR(50) DEFAULT 'default',
  rate_limit_per_hour INTEGER DEFAULT 100,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  UNIQUE(form_id)
);

-- Enable Row Level Security (RLS)
ALTER TABLE form_whatsapp_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their form's WhatsApp settings
CREATE POLICY "Users can view their form's WhatsApp settings"
  ON form_whatsapp_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = form_whatsapp_settings.form_id
      AND forms.user_id = auth.uid()
    )
  );

-- RLS Policy: Users can update their form's WhatsApp settings
CREATE POLICY "Users can update their form's WhatsApp settings"
  ON form_whatsapp_settings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = form_whatsapp_settings.form_id
      AND forms.user_id = auth.uid()
    )
  );

-- RLS Policy: Users can insert WhatsApp settings for their forms
CREATE POLICY "Users can insert WhatsApp settings for their forms"
  ON form_whatsapp_settings
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = form_whatsapp_settings.form_id
      AND forms.user_id = auth.uid()
    )
  );

-- RLS Policy: Users can delete their form's WhatsApp settings
CREATE POLICY "Users can delete their form's WhatsApp settings"
  ON form_whatsapp_settings
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = form_whatsapp_settings.form_id
      AND forms.user_id = auth.uid()
    )
  );

-- Create index on form_id for faster queries
CREATE INDEX IF NOT EXISTS idx_form_whatsapp_settings_form_id
  ON form_whatsapp_settings(form_id);

-- Create index on created_by for user-scoped queries
CREATE INDEX IF NOT EXISTS idx_form_whatsapp_settings_created_by
  ON form_whatsapp_settings(created_by);
