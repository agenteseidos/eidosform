-- Migração MANUAL — aplicar no SQL Editor do Supabase.
-- Não destrutiva: NÃO apaga dados, só remove permissões de acesso direto.
-- Segura de rodar mais de uma vez (usa IF EXISTS).
--
-- ── O PROBLEMA ───────────────────────────────────────────────────────────────
-- A tabela `form_whatsapp_settings` está exposta ao PostgREST (a API pública do
-- Supabase) e as políticas criadas em 2026-04-05 permitem que QUALQUER dono de
-- formulário faça INSERT/UPDATE na própria configuração direto do navegador —
-- sem passar por nenhuma rota da aplicação.
--
-- Isso torna o gate de aplicação (feito em 2026-07-30, que restringe a
-- notificação por WhatsApp a uma lista de contas) contornável: bastaria um
-- cliente logado chamar a API do banco diretamente para habilitar a feature.
-- Verificado ao vivo: GET anônimo na tabela responde HTTP 200.
--
-- ── POR QUE É SEGURO REMOVER ─────────────────────────────────────────────────
-- Conferido no código em 2026-07-30:
--   * NENHUM componente de tela (navegador) lê ou escreve esta tabela direto;
--   * TODAS as rotas do servidor usam SUPABASE_SERVICE_ROLE_KEY, e o
--     service_role IGNORA RLS por definição — continua funcionando igual.
-- Ou seja: estas políticas hoje não servem a nenhum uso legítimo. Só ao bypass.
--
-- ── O QUE MUDA ───────────────────────────────────────────────────────────────
-- Depois desta migração, o único caminho para ler/gravar configuração de
-- WhatsApp é pelas rotas da aplicação — que aplicam a política de capacidade
-- (`lib/whatsapp-capability.ts`).

-- 1) Remove as políticas de acesso direto por usuário.
DROP POLICY IF EXISTS "Users can view their form's WhatsApp settings"   ON form_whatsapp_settings;
DROP POLICY IF EXISTS "Users can update their form's WhatsApp settings" ON form_whatsapp_settings;
DROP POLICY IF EXISTS "Users can insert WhatsApp settings for their forms" ON form_whatsapp_settings;
DROP POLICY IF EXISTS "Users can delete their form's WhatsApp settings" ON form_whatsapp_settings;

-- 2) Garante que RLS segue LIGADA. Com RLS ligada e nenhuma política, os papéis
--    `anon` e `authenticated` não enxergam nem gravam nada. O `service_role`
--    (usado pelas rotas do servidor) não é afetado — ele ignora RLS.
ALTER TABLE form_whatsapp_settings ENABLE ROW LEVEL SECURITY;

-- 3) Cinto e suspensório: tira também os privilégios de tabela desses papéis.
--    Sem isto, uma política criada por engano no futuro voltaria a abrir acesso.
REVOKE ALL ON form_whatsapp_settings FROM anon;
REVOKE ALL ON form_whatsapp_settings FROM authenticated;

COMMENT ON TABLE form_whatsapp_settings IS
  'Configuração de notificação por WhatsApp. ACESSO SOMENTE via rotas da aplicação (service_role) — o acesso direto por anon/authenticated foi removido em 2026-07-30 porque permitia contornar o gate de capacidade. Não recriar políticas de usuário sem revisar lib/whatsapp-capability.ts.';

-- ── CONFERÊNCIA (rodar depois; opcional) ─────────────────────────────────────
-- Deve retornar ZERO linhas:
--   SELECT policyname FROM pg_policies WHERE tablename = 'form_whatsapp_settings';
-- E os 8 formulários do admin devem continuar com a configuração intacta:
--   SELECT count(*) FROM form_whatsapp_settings WHERE enabled = true;   -- espera 8
