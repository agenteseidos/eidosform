-- ============================================================================
-- ⛔ ARQUIVO APOSENTADO — NÃO EXECUTE ESTE ARQUIVO. NUNCA.
-- ============================================================================
--
-- Este é um RETRATO HISTÓRICO do schema. Ele NÃO descreve o banco de dados real
-- do EidosForm e sabidamente DIVERGE dele. Ver a REGRA Nº 1 do CLAUDE.md
-- ("O REPOSITÓRIO NÃO DESCREVE O BANCO"): as migrations sempre foram aplicadas
-- à mão, sem registro do que rodou, então o estado verdadeiro só existe no
-- catálogo do Postgres (pg_policies, pg_proc, pg_indexes, pg_views,
-- information_schema.role_table_grants), consultado pelo SQL Editor do Supabase.
--
-- POR QUE EXECUTAR ISTO MACHUCA QUEM USA O PRODUTO: mais abaixo este arquivo
-- ainda cria a policy "Anyone can view published forms" (e a de INSERT anônimo
-- em responses). Essa permissão foi REMOVIDA da produção em 29/07/2026 pela
-- migration supabase/migrations/20260729_02_close_legacy_anon_rls.sql, porque
-- deixava QUALQUER visitante, sem login, ler a linha inteira de um formulário
-- publicado de qualquer cliente — inclusive webhook_url, notify_email, telefone
-- de notificação e google_sheets_id — e, somada aos GRANTs amplos ao papel anon,
-- abria caminho para ALTERAR e APAGAR formulário publicado alheio. Rodar este
-- arquivo numa instalação REABRE esse buraco: o dono do formulário perde os
-- dados de contato dos leads dele para qualquer um com o link.
--
-- As policies antigas ficam aqui de propósito, como registro do que já existiu.
-- NÃO "conserte" este SQL para bater com produção: não há como saber o que está
-- em produção sem ler o catálogo, e fingir que sabe é exatamente o erro que a
-- Regra Nº 1 existe para impedir.
--
-- Precisa subir um ambiente novo? Peça ao dono do projeto o dump do banco vivo.
-- ============================================================================

-- Trava: aborta a execução inteira antes de qualquer DDL, para o caso de alguém
-- colar este arquivo no SQL Editor sem ler o aviso acima.
DO $$
BEGIN
  RAISE EXCEPTION 'ARQUIVO APOSENTADO: supabase/schema.sql nao deve ser executado'
    USING HINT = 'Retrato historico que diverge do banco real e recria a policy anonima "Anyone can view published forms". Ver REGRA No 1 do CLAUDE.md e a migration 20260729_02_close_legacy_anon_rls.sql.';
END $$;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types
CREATE TYPE form_status AS ENUM ('draft', 'published', 'closed');
CREATE TYPE theme_preset AS ENUM ('midnight', 'ocean', 'sunset', 'forest', 'lavender', 'minimal');

-- Profiles table (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Forms table
CREATE TABLE forms (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Form',
  description TEXT,
  slug TEXT NOT NULL,
  status form_status DEFAULT 'draft' NOT NULL,
  is_public BOOLEAN DEFAULT FALSE NOT NULL,
  theme theme_preset DEFAULT 'minimal' NOT NULL,
  questions JSONB DEFAULT '[]'::jsonb NOT NULL,
  thank_you_message TEXT DEFAULT 'Thank you for your response!' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Ensure slug is unique per user
  UNIQUE(user_id, slug)
);

-- Create index for faster slug lookups
CREATE INDEX idx_forms_slug ON forms(slug);
CREATE INDEX idx_forms_user_id ON forms(user_id);
CREATE INDEX idx_forms_status ON forms(status);

-- Responses table
CREATE TABLE responses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  form_id UUID REFERENCES forms(id) ON DELETE CASCADE NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create index for faster response lookups
CREATE INDEX idx_responses_form_id ON responses(form_id);
CREATE INDEX idx_responses_submitted_at ON responses(submitted_at DESC);

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Forms policies
CREATE POLICY "Users can view their own forms"
  ON forms FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own forms"
  ON forms FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own forms"
  ON forms FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own forms"
  ON forms FOR DELETE
  USING (auth.uid() = user_id);

-- Public can view published forms (for form submissions)
CREATE POLICY "Anyone can view published forms"
  ON forms FOR SELECT
  USING (status = 'published');

-- Responses policies
CREATE POLICY "Form owners can view responses"
  ON responses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM forms 
      WHERE forms.id = responses.form_id 
      AND forms.user_id = auth.uid()
    )
  );

CREATE POLICY "Form owners can delete responses"
  ON responses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM forms 
      WHERE forms.id = responses.form_id 
      AND forms.user_id = auth.uid()
    )
  );

-- Anyone can submit responses to published forms
CREATE POLICY "Anyone can submit responses to published forms"
  ON responses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM forms 
      WHERE forms.id = form_id 
      AND forms.status = 'published'
    )
  );

-- Functions and Triggers

-- Function to handle new user signup
-- Handles both Google OAuth (uses 'name', 'picture') and email signups (uses 'full_name', 'avatar_url')
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      ''
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture',
      ''
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), profiles.full_name),
    avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), profiles.avatar_url),
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_forms_updated_at
  BEFORE UPDATE ON forms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to generate unique slug
CREATE OR REPLACE FUNCTION generate_unique_slug(base_slug TEXT, uid UUID)
RETURNS TEXT AS $$
DECLARE
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  final_slug := base_slug;
  
  WHILE EXISTS (SELECT 1 FROM forms WHERE slug = final_slug AND user_id = uid) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;
  
  RETURN final_slug;
END;
$$ LANGUAGE plpgsql;

