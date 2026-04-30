# Handoff — Correções Críticas de Segurança (Etapa 1)

**Data:** 2026-04-30  
**Responsável:** Toin  
**Tipo:** Correção de segurança crítica  
**Status:** ✅ Concluída

## Demanda
Corrigir os riscos mais graves identificados nas auditorias (`auditoria-final.md` e `auditoria-sessao1.md`).

## Itens corrigidos

### 1. RLS de responses / answer_items
**Arquivo:** `supabase/migrations/20260430_fix_rls_responses_answer_items_profiles.sql`

- **Removido** `anon_read_responses` — anon não pode mais ler respostas de forms publicados
- **Removido** `anon_update_responses` — anon não pode mais atualizar respostas
- **Removido** `anon_delete_answer_items` — anon não pode mais deletar answer_items
- Anon agora só pode INSERT em responses e answer_items (submissão pública)
- Owner (authenticated) mantém SELECT, UPDATE, DELETE para forms que owns

### 2. RLS de profiles — proteção de campos sensíveis
**Arquivo:** `supabase/migrations/20260430_fix_rls_responses_answer_items_profiles.sql`

- **Removida** policy `Users can update their own profile` (permitia alterar qualquer campo)
- **Criada** policy `Users can update safe profile fields` com WITH CHECK que garante que campos sensíveis não sejam alterados:
  - `plan`, `responses_limit`, `responses_used`, `plan_status`, `plan_expires_at`, `plan_cycle`
  - `asaas_customer_id`, `asaas_subscription_id`, `asaas_plan_id`, `asaas_payment_method`, `asaas_webhook_secret`

### 3. Auth flow — rate limiting consistente
**Arquivos alterados:**

- **`app/(auth)/login/page.tsx`** — agora usa `fetch('/api/auth/login')` em vez de `supabase.auth.signInWithPassword` direto
- **`app/(auth)/forgot-password/page.tsx`** — agora usa `fetch('/api/auth/forgot-password')` em vez de `supabase.auth.resetPasswordForEmail` direto
- **`app/(auth)/reset-password/page.tsx`** — agora usa `fetch('/api/auth/reset-password')` em vez de `supabase.auth.updateUser` direto
- **`app/(auth)/verify-email/page.tsx`** — agora usa `fetch('/api/auth/resend-verification')` em vez de `supabase.auth.resend` direto
- **`app/api/auth/login/route.ts`** — removido vazamento de `error.message`, agora retorna erro genérico
- **`app/api/auth/forgot-password/route.ts`** — NOVO endpoint com rate limit (3/15min), sempre retorna sucesso
- **`app/api/auth/reset-password/route.ts`** — NOVO endpoint para reset de senha via API
- **`app/api/auth/resend-verification/route.ts`** — NOVO endpoint com rate limit (3/15min), sempre retorna sucesso

## Correção pós-handoff — regressão de auth
**Data:** 2026-04-30

Os auth routes (`login`, `forgot-password`, `reset-password`, `resend-verification`, `signup`) usavam `createPublicClient()` (service_role key + `persistSession: false`), quebrando criação/persistência de sessão do usuário.

**Correção:** substituído por `await createClient()` de `@/lib/supabase/server` (anon key + cookie handling SSR). Rate limit mantido intacto.

Commit: `fix(auth): replace createPublicClient with createClient in auth routes`

## Validação
- `tsc --noEmit` passa sem erros

## Pendências
- **Migration precisa ser aplicada** no Supabase (executar `20260430_fix_rls_responses_answer_items_profiles.sql` manualmente ou via dashboard)
- Nenhuma pendência de código dentro desta etapa

## Próximos passos sugeridos
- Etapa 2: demais itens da auditoria
- Testar os fluxos de auth manualmente no browser
