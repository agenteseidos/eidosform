-- =============================================================================
-- Anexos deixam de morar em URL pública permanente (16/08/2026)
-- =============================================================================
-- O arquivo vira ENTIDADE: cada acesso resolve estado atual (dono, modo, revogação)
-- em vez de confiar num caminho embutido em token. Sem isto não há revogação,
-- expiração, limpeza nem transferência de formulário sem quebrar link.
--
-- ⚠️ Rodar UMA VEZ pelo SQL Editor. Atômico, registra a própria migração.
-- ⚠️ NÃO fecha o bucket — isso é o ÚLTIMO passo, depois que o código estiver no ar.
-- =============================================================================

BEGIN;

-- ── 1. Política de acesso, POR FORMULÁRIO ───────────────────────────────────
-- 'owner_only' = só o dono logado abre (PADRÃO, seguro).
-- 'link'       = quem tem o link abre, sem login — mas pelo endereço NOSSO.
-- A VERSÃO é o que mata links já distribuídos: trocar 'link' → 'owner_only'
-- incrementa a versão e todo link antigo deixa de resolver, sem mover arquivo.
ALTER TABLE public.forms
  ADD COLUMN IF NOT EXISTS file_access_mode text NOT NULL DEFAULT 'owner_only',
  ADD COLUMN IF NOT EXISTS file_access_version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'forms_file_access_mode_check'
  ) THEN
    ALTER TABLE public.forms
      ADD CONSTRAINT forms_file_access_mode_check
      CHECK (file_access_mode IN ('owner_only', 'link'));
  END IF;
END $$;

COMMENT ON COLUMN public.forms.file_access_mode IS
  'owner_only (padrão): só o dono logado abre o anexo. link: quem tem o link abre.';
COMMENT ON COLUMN public.forms.file_access_version IS
  'Incrementada ao restringir o modo — invalida todos os links já distribuídos.';

-- ── 2. O arquivo como entidade ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.form_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id           uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  question_id       text,
  response_id       uuid,
  object_path       text NOT NULL UNIQUE,
  original_name     text,
  declared_mime     text,
  size_bytes        bigint,
  -- pending: URL de upload assinada, conteúdo ainda não confirmado
  -- ready:   arquivo existe no storage, ainda não vinculado a uma resposta
  -- claimed: vinculado a uma resposta submetida (o estado normal)
  -- deleted: removido; o registro fica para o link responder 410 em vez de 404 mudo
  status            text NOT NULL DEFAULT 'pending',
  revoked_at        timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  claimed_at        timestamptz,
  CONSTRAINT form_files_status_check
    CHECK (status IN ('pending', 'ready', 'claimed', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_form_files_form      ON public.form_files (form_id);
CREATE INDEX IF NOT EXISTS idx_form_files_response  ON public.form_files (response_id)
  WHERE response_id IS NOT NULL;
-- Varredura de órfãos: upload que nunca virou resposta.
CREATE INDEX IF NOT EXISTS idx_form_files_pendentes ON public.form_files (created_at)
  WHERE status = 'pending';

-- ── 3. Fechado por padrão ───────────────────────────────────────────────────
-- Ninguém fala com esta tabela direto: só o servidor, com service-role. O acesso
-- do dono passa pela rota /arquivo, que confere sessão e política.
ALTER TABLE public.form_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_files FROM PUBLIC;
REVOKE ALL ON public.form_files FROM anon;
REVOKE ALL ON public.form_files FROM authenticated;
GRANT ALL ON public.form_files TO service_role;

COMMENT ON TABLE public.form_files IS
  'Anexos como entidade. Cada acesso via /arquivo resolve o estado ATUAL (dono do form, modo, revogação) — nunca confia em dado embutido no link.';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260816_form_files',
  'Anexos como entidade + política de acesso por formulário',
  ARRAY[
    'ALTER TABLE public.forms ADD COLUMN file_access_mode text DEFAULT owner_only, file_access_version integer DEFAULT 1',
    'CREATE TABLE public.form_files (...) com RLS fechado e grant exclusivo service_role',
    'Índices: form_id, response_id parcial, pendentes por created_at'
  ]
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
