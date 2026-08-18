-- =============================================================================
-- CAPI passa a usar o pixel E o token DO CLIENTE (18/08/2026)
-- =============================================================================
-- ANTES: o envio server-side ao Meta usava UM pixel e UM token GLOBAIS — os da
-- plataforma. O cliente colava o pixel dele no construtor e o servidor mandava
-- tudo para a NOSSA conta: a conversão dele nunca chegava por esse caminho, e o
-- e-mail/telefone hasheados do lead DELE entravam no NOSSO ativo do Meta.
--
-- O Pixel ID sozinho não resolve: ele é público (está no fonte de qualquer
-- página que anuncia) e por isso o Meta exige um TOKEN para aceitar evento pelo
-- servidor. Sem isso, qualquer um injetaria conversão falsa na conta alheia.
--
-- ⚠️ POR QUE TABELA PRÓPRIA e não uma coluna em `forms`: `forms.pixels` é
-- selecionada na página PÚBLICA (`app/f/[slug]/page.tsx`) e viaja inteira para o
-- navegador de todo visitante. O pixel pode — é público. O token, NÃO. Numa
-- tabela separada, ele não tem como pegar carona num SELECT distraído de forms.
--
-- ⚠️ Rodar UMA VEZ pelo SQL Editor. Atômico, registra a própria migração.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.form_capi_credentials (
  form_id      uuid PRIMARY KEY REFERENCES public.forms(id) ON DELETE CASCADE,

  -- Cifrado com AES-256-GCM (lib/capi-credential.ts), chave em META_CAPI_ENC_KEY.
  -- Guardado cifrado porque é credencial que injeta evento na conta de anúncios
  -- de um TERCEIRO: um vazamento do banco não pode entregar token utilizável.
  token_encrypted text NOT NULL,

  -- Últimos 4 caracteres, em claro. É o que a interface mostra ("••••ab12") para
  -- o cliente reconhecer QUAL token está lá sem o token voltar ao navegador.
  hint text,

  -- O pixel contra o qual este token foi VALIDADO. Se o cliente trocar o pixel
  -- depois, isto deixa de bater e a interface avisa em vez de falhar em silêncio.
  pixel_id text,

  validated_at timestamptz,
  last_error   text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Fechado por padrão ──────────────────────────────────────────────────────
-- Ninguém fala com esta tabela direto: nem o dono logado pelo navegador. O acesso
-- passa por /api/forms/[id]/capi-token, que confere sessão e propriedade. Assim
-- um XSS no painel não colhe os tokens de todos os formulários do usuário.
ALTER TABLE public.form_capi_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_capi_credentials FROM PUBLIC;
REVOKE ALL ON public.form_capi_credentials FROM anon;
REVOKE ALL ON public.form_capi_credentials FROM authenticated;
GRANT ALL ON public.form_capi_credentials TO service_role;

COMMENT ON TABLE public.form_capi_credentials IS
  'Token da API de Conversões do Meta, POR FORMULÁRIO e cifrado. Fora de forms de propósito: forms.pixels vai para o navegador do visitante e o token não pode ir junto.';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260818_form_capi_credentials',
  'Token de CAPI por formulario (cifrado, tabela propria, service_role apenas)',
  ARRAY[
    'CREATE TABLE public.form_capi_credentials (form_id PK -> forms ON DELETE CASCADE, token_encrypted, hint, pixel_id, validated_at, last_error)',
    'RLS habilitado, REVOKE ALL de PUBLIC/anon/authenticated, GRANT ALL a service_role'
  ]
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
