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

---

# Handoff — Etapa 2: Correções de Segurança (Exploração Prática em Produção)

**Data:** 2026-04-30  
**Responsável:** Toin  
**Tipo:** Correção de segurança (exploração prática)  
**Status:** ✅ Concluída

## Demanda
Corrigir os próximos riscos práticos de exploração identificados nas auditorias.

## Itens corrigidos

### 1. WhatsApp de teste / abuso operacional
**Arquivo:** `app/api/form/[id]/whatsapp/test/route.ts`

- **Adicionado** rate limit de 5 testes por usuário por 15 minutos
- Usa `checkRateLimitAsync` com Supabase RPC (persistente entre invocações serverless)
- Retorna 429 com `resetIn` quando excedido
- Impede spam de mensagens de teste e risco de ban da operação WhatsApp

### 2. Custom domains / takeover
**Arquivo:** `app/api/domains/route.ts`

- **Adicionada** verificação de ownership antes do upsert de domínio
- Se o domínio já existe e pertence a outro usuário, retorna 409 (Conflict)
- Impede que um usuário assuma (takeover) o domínio personalizado de outro
- O endpoint de DELETE e PATCH já verificavam ownership corretamente

### 3. XSS em content blocks
**Arquivos:**
- `app/api/forms/[id]/route.ts` (PATCH — update)
- `app/api/forms/route.ts` (POST — create)
- `components/form-player/question-renderer.tsx` (render do player)

**Server-side (create + update):**
- Adicionada validação de URLs dentro de `questions` array
- Bloqueia esquemas perigosos: `javascript:`, `data:`, `vbscript:`, `mhtml:`, `x-javascript:`
- Valida `contentButtonUrl`, `imageUrl` e `videoUrl` em cada pergunta
- Retorna 400 com mensagem descritiva se URL insegura detectada
- Função `isSafeUrl` e `validateQuestionUrls` adicionadas em ambos os routes

**Client-side (player render):**
- Adicionada função `isSafeUrl` no question-renderer
- O `<a href>` de `contentButtonUrl` agora só renderiza se a URL for segura
- Defesa em profundidade: mesmo que algo passe pelo server, o player não renderiza

## Validação
- `tsc --noEmit` passa sem erros

## Pendências
- Nenhuma pendência dentro desta etapa

## Commit
- `8b9dbf9` — `fix(security): etapa 2 - rate limit whatsapp test, domain takeover prevention, XSS in content blocks`

---

# Handoff — Etapa 3: Superfícies de Abuso Interno e Automação

**Data:** 2026-04-30  
**Responsável:** Toin  
**Tipo:** Correção de segurança (etapa 3)  
**Status:** ✅ Concluída

## Demanda
Corrigir riscos de abuso via funções internas, exposição indevida de configuração e políticas mal escopadas.

## Itens corrigidos

### 1. SECURITY DEFINER functions — acesso de PUBLIC revogado
**Arquivo:** `supabase/migrations/20260430_fix_security_definer_public_access_whatsapp_logs.sql`

- **REVOKE EXECUTE FROM PUBLIC** em todas as 8 funções SECURITY DEFINER:
  - `check_rate_limit`, `cleanup_rate_limit_entries`, `get_response_counts_by_forms`
  - `check_and_increment_response`, `increment_responses_used`
  - `verify_api_key_hash`, `handle_new_user`, `increment_response_count`
- **GRANT EXECUTE** apenas para `authenticated` + `service_role` (onde aplicável)
- `handle_new_user` (trigger function) e `cleanup_rate_limit_entries` restritos a `service_role` apenas

### 2. Forms públicos expondo dados sensíveis
**Arquivo:** `supabase/migrations/20260430_fix_security_definer_public_access_whatsapp_logs.sql`

- **Criada** view `published_forms` com `security_barrier = true` — expõe apenas colunas seguras:
  - ✅ `id, title, description, slug, status, theme, questions, thank_you_*, pixels, redirect_url, welcome_*, is_closed, paused, hide_branding, pixel_event_*, created_at, updated_at`
  - ❌ NÃO expõe: `webhook_url, notify_email, notify_email_enabled, notify_whatsapp_enabled, notify_whatsapp_number, google_sheets_id, google_sheets_enabled, google_sheets_share_email, google_sheets_url, user_id, plan`
- **GRANT SELECT** na view para `anon` e `authenticated`
- **Removida** policy `anon_read_published_forms` — anon não pode mais consultar a tabela `forms` diretamente
- App (form player, sitemap) usa `createPublicClient` (service_role key), então continua funcionando sem alteração de código

### 3. Policies/logs mal escopadas
**Arquivo:** `supabase/migrations/20260430_fix_security_definer_public_access_whatsapp_logs.sql`

- **Removida** policy `Service role can insert WhatsApp logs` (usava `WITH CHECK (true)` — qualquer role podia inserir)
- **Criada** policy `service_role_insert_whatsapp_logs` — INSERT restrito a `service_role`
- **Recriada** policy `owners_read_whatsapp_logs` — SELECT restrito a `authenticated` (form owners)
- Anon não tem nenhum acesso à tabela `form_whatsapp_logs`

## Validação
- `tsc --noEmit` passa sem erros
- Nenhuma alteração de código de app necessária

## Commit
- `d9086c4` — `fix(security): etapa 3 - revoke PUBLIC execute on SECURITY DEFINER functions, restrict whatsapp_logs, create safe published_forms view`

## Pendências
- **Migration precisa ser aplicada** no Supabase (executar `20260430_fix_security_definer_public_access_whatsapp_logs.sql` manualmente ou via dashboard)
- Nenhuma pendência de código dentro desta etapa

## Arquivos alterados
- `supabase/migrations/20260430_fix_security_definer_public_access_whatsapp_logs.sql` (NOVO)
- `handoff.md` (atualizado)

---

## Etapa 4 — Sessão, checkout e hardening operacional
**Data:** 2026-04-30 | **Commits:** `18ce322`, `c6e5a1e`

### 1. Cookie `__lastActivity` — proteção contra burla de timeout
**Arquivos:** `lib/auth.ts`, `lib/supabase/middleware.ts`

- **`httpOnly: true`** — cookie não é mais acessível via JS/XSS. Apenas o middleware (server-side) atualiza o timestamp.
- **Cap para `Date.now()`** — middleware agora faz `Math.min(cookieValue, Date.now())` antes de verificar timeout. Se um atacante injetar timestamp futuro (via cookie manipulation antes do fix), é neutralizado.
- Fluxo de timeout permanece 30min de inatividade, sem mudança de UX.

### 2. Revogação de sessão — troca de senha
**Arquivo:** `components/settings/password-settings.tsx`

- Alteração de senha nas configurações agora faz `signOut()` e redireciona para `/login`.
- Antes: senha mudava mas todas as sessões permaneciam ativas (incluindo dispositivos comprometidos).
- Reset de senha (via email) já revogava sessão — consistente agora.

### 3. Rate limiting — checkout e API key
**Arquivos:** `app/api/checkout/status/route.ts`, `app/api/checkout/[plan]/route.ts`, `app/api/settings/api-key/route.ts`

| Endpoint | Limite | Justificativa |
|---|---|---|
| `GET /api/checkout/status` | 30 req/min/user | Protege API externa do Asaas contra polling abusivo |
| `POST /api/checkout/[plan]` | 10 req/min/user | Previne spam de criação de checkout |
| `POST/DELETE /api/settings/api-key` | 5 req/min/user | Previne abuso de geração/revogação de keys |

Todos retornam `429` com header `Retry-After`.

### Validação
- `next build` passa sem erros

### Pendências
- Nenhuma pendência dentro desta etapa

---

## Etapa 5 — Hardening final (upload, CSP, sanitizeValue)

**Data:** 2026-04-30 | **Commit:** `4bd3319`

### 1. Upload magic bytes validation
**Arquivo:** `app/api/upload/route.ts`

- **Adicionada** validação de magic bytes para todos os tipos suportados (JPEG, PNG, GIF, WebP, PDF)
- Antes: confiava apenas no MIME type enviado pelo client (trivialmente forjável)
- Agora: lê os primeiros bytes do arquivo e verifica assinatura real
- Se MIME detectado ≠ MIME declarado, usa o detectado para storage
- Bloqueia uploads de conteúdo disfarçado (ex: `.jpg` contendo script)

### 2. CSP hardening
**Arquivo:** `next.config.ts`

- **Removido** `'unsafe-eval'` de `script-src` nas duas políticas (dashboard + form player)
- **Adicionadas** diretivas `form-action 'self'` e `base-uri 'self'` em ambas
- `unsafe-eval` permitia `eval()` / `new Function()` em qualquer contexto — superfície de XSS amplificada

### 3. `sanitizeValue` hardening
**Arquivo:** `lib/form-response-security.ts`

- **Melhorada** sanitização de strings em respostas de forms
- Primeira pass: remove tags HTML normais
- Segunda pass: decodifica entidades HTML (`&lt;`, `&#x3c;`, etc.) e re-strip tags
- Previne bypass via HTML entity encoding (`&lt;script&gt;`)

### 4. Vazamento de `error.message` em folder route
**Arquivo:** `app/api/forms/[id]/folder/route.ts`

- Substituído `error.message` por mensagem genérica, consistente com correção do P0-3

### Validação
- `tsc --noEmit` passa sem erros

### Pendências (requerem redesign/mudança maior)
- **P0-A:** Custom domain CNAME validation — requer decisão de infraestrutura DNS
- **P0-B:** CSV/XLSX formula injection — requer neutralizar células no export (já existe `sanitize-formula.ts`, verificar se está aplicado)
- **P0-C:** Domínios `.com` vs `.com.br` — requer decisão de marca/infra
- **P0-D:** `responses_limit` default no trigger — migration simples mas afeta billing
- **P1-A:** Anonymous response IDOR — requer redesign do fluxo de partial response
- **P1-D:** Webhooks sem HMAC — requer geração/armazenamento de secret por usuário
- **P1-F:** DNS rebinding em webhook URL — requer mudança de arquitetura de validação
- **P2-21:** API Key plaintext — requer hash + migration de dados existentes
