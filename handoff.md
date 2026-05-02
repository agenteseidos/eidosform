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

---

## Etapa 6 — Correções P1/P2 pendentes

**Data:** 2026-04-30 | **Relatório:** `correcoes-pendentes.md`

### Itens corrigidos nesta etapa

A maioria dos itens P1/P2 já estava implementada nas etapas 1–5. Esta etapa corrigiu os 3 restantes:

#### P1-J — Webhook Asaas sem ativação de plano inválido
**Arquivo:** `app/api/webhooks/asaas/route.ts`
- `detectPlanAndCycle` agora retorna `null` quando o valor não corresponde a nenhum preço conhecido (removido default para 'starter').
- Handler PAYMENT_CONFIRMED/PAYMENT_RECEIVED: se não há `checkoutLink` E `detectPlanAndCycle` retorna null, loga erro e faz `break` sem ativar plano.

#### P1-K — Migrations RLS conflitantes: correção cosmética (INSUFICIENTE — substituída pela Etapa 7)
**Status:** ⚠️ Supersedida — ver Etapa 7 abaixo.

A solução anterior apenas adicionava `-- OBSOLETE:` como comentário. O SQL continuava executável.
Além disso, `20260428_consolidate_rls_policies.sql` recriava as policies perigosas (`anon_read_responses`,
`anon_update_responses`, `anon_delete_answer_items`) que os arquivos 20260327 tinham removido — regressão
invisível que só era corrigida pelos `20260430_*`. Ver Etapa 7 para a correção real.

#### P2-E — API key plaintext fallback removido
**Arquivo:** `lib/api-key-auth.ts`
- Removido bloco de fallback que buscava `api_key` em plaintext na tabela `profiles`.
- Migration `20260428_hash_api_keys.sql` já limpou todos os valores plaintext (SET api_key = NULL).
- Agora usa exclusivamente `verify_api_key_hash` RPC (SHA-256).

### Itens já implementados (verificados)
- **P1-A** — IDOR via X-Response-Id: ✅ corrigido em `app/api/responses/route.ts:254-259`
- **P1-D** — Webhooks HMAC: ✅ corrigido em `lib/webhook-dispatcher.ts`
- **P1-F** — DNS rebinding: ✅ corrigido em `lib/webhook-validator.ts`
- **P2-N** — Race condition response count: ✅ RPC `check_and_increment_response` em `lib/plan-limits.ts`
- **P2-G** — Dashboard select(*): ✅ colunas específicas + RPC em `app/(dashboard)/forms/page.tsx`
- **P2-F** — handleDowngrade carrega responses: ✅ RPC `get_response_counts_by_forms` em `lib/plan-limits.ts`
- **P2-O** — PATCH sem limite de payload: ✅ limite 500KB em `app/api/forms/[id]/route.ts`
- **P2-I** — Export sem rate limit: ✅ `checkRateLimitAsync` em `app/api/forms/[id]/export/route.ts`

### Validação
- `next build` passa sem erros

---

## Etapa 7 — P1-K Correção Real: Neutralização de Migrations e Estado Final Idempotente

**Data:** 2026-05-01 | **Relatório:** `correcoes-pendentes-p1k.md`

### Por que a Etapa 6 era insuficiente

1. **Comentário cosmético não neutraliza SQL.** Os 5 arquivos antigos ainda executavam `CREATE POLICY` em ambiente novo.
2. **Regressão oculta:** `20260428_consolidate_rls_policies.sql` **recriava** `anon_read_responses`, `anon_update_responses` e `anon_delete_answer_items` — que os arquivos 20260327 já tinham removido. Se as migrations parassem após o consolidate e antes dos `20260430_*`, o banco ficava com anon podendo ler/modificar respostas de qualquer form publicado.

### O que foi feito

#### Neutralização das 5 migrations antigas

Os 5 arquivos tiveram seu conteúdo SQL substituído por `SELECT 1; -- no-op`:
- `supabase/migrations/20260318_public_access_rls.sql`
- `supabase/migrations/20260327_fix_p0_rls_responses.sql`
- `supabase/migrations/20260327_fix_rls_p0_v2.sql`
- `supabase/migrations/20260327_fix_rls_response_leak.sql`
- `supabase/migrations/20260327_fix_response_visibility_rls.sql`

Em ambiente novo, esses arquivos **não criam absolutamente nenhuma policy**.

#### Nova migration definitiva e idempotente

**`supabase/migrations/20260501_enforce_rls_final_state.sql`**

- Roda **por último** (data 20260501 — posterior a todos os arquivos existentes)
- Inicia com `DROP POLICY IF EXISTS` para todos os nomes que já existiram em qualquer migration
- Define o estado final correto explicitamente:
  - `responses`: anon INSERT apenas; owners SELECT/UPDATE/DELETE; service_role ALL
  - `answer_items`: anon INSERT apenas; owners SELECT/INSERT/DELETE; service_role ALL
  - `forms`: anon sem acesso direto (usa `published_forms` view)
- Pode ser re-executada ilimitadas vezes sem efeito colateral

### Por que o risco está neutralizado

- Antigos são no-ops: nunca criam policies perigosas, nem transitoriamente
- Parar em qualquer ponto após os `20260430_*` = estado seguro
- `20260501_enforce_rls_final_state.sql` varre e reaplica o estado correto mesmo que qualquer migration anterior tenha criado algo inesperado
- Executar qualquer dos 5 arquivos antigos manualmente = não-operação

### Arquivos alterados
- `supabase/migrations/20260318_public_access_rls.sql` — neutralizado (no-op)
- `supabase/migrations/20260327_fix_p0_rls_responses.sql` — neutralizado (no-op)
- `supabase/migrations/20260327_fix_rls_p0_v2.sql` — neutralizado (no-op)
- `supabase/migrations/20260327_fix_rls_response_leak.sql` — neutralizado (no-op)
- `supabase/migrations/20260327_fix_response_visibility_rls.sql` — neutralizado (no-op)
- `supabase/migrations/20260501_enforce_rls_final_state.sql` — **NOVO** (state definitivo)
- `correcoes-pendentes-p1k.md` — **NOVO** (relatório completo)
- `handoff.md` — atualizado

### Pendências para produção
- Aplicar `20260501_enforce_rls_final_state.sql` no Supabase (via dashboard ou manualmente)

---

## Etapa 8 — P2 Residual: Eliminação da janela insegura no `20260428`

**Data:** 2026-05-01 | **Relatório:** `correcoes-pendentes-p2-residual.md`

### Problema

`20260428_consolidate_rls_policies.sql` criava `anon_read_responses`, `anon_update_responses` e `anon_delete_answer_items` — policies inseguras — que só eram removidas pelos arquivos `20260430_*`. Um deploy que parasse entre as duas migrations deixava o banco exposto transitoriamente.

### O que foi feito

**Arquivo:** `supabase/migrations/20260428_consolidate_rls_policies.sql`

- Removidos os três `CREATE POLICY` perigosos (`anon_read_responses`, `anon_update_responses`, `anon_delete_answer_items`)
- Mantidos os `DROP IF EXISTS` correspondentes (idempotentes; limpam ambientes que rodaram versão anterior)
- Adicionado comentário de cabeçalho explicando a remoção

### Por que é seguro

- Ambientes existentes não re-executam a migration — `20260430` e `20260501` já garantem o estado correto neles
- Ambientes novos nunca verão as policies inseguras, nem transitoriamente
- `DROP IF EXISTS` são no-ops se as policies não existem — sem efeito colateral
- `20260501_enforce_rls_final_state.sql` continua válido e idempotente

### Resultado

**P2 residual zerado.** A cadeia de migrations é segura em qualquer ponto de parada.

---

## Etapa 9 — Correções P3: qualidade, UX e hardening residual

**Data:** 2026-04-30 | **Relatório:** `correcoes-p3.md`

### Bugs funcionais corrigidos

#### GET /api/folders não retornava resposta (S1-P2-8)
**Arquivo:** `app/api/folders/route.ts`
- O handler GET terminava sem `return` no caminho de sucesso — listagem de pastas estava quebrada.
- Adicionado `return NextResponse.json({ folders: data })`.

#### DELETE /api/folders/[id] não retornava resposta (S1-P2-9)
**Arquivo:** `app/api/folders/[id]/route.ts`
- Mesmo bug em DELETE — front-end não recebia confirmação 200.
- Adicionado `return NextResponse.json({ success: true })`.

### Hardening de segurança

| Fix | Arquivo | Descrição |
|---|---|---|
| P3-I | `lib/asaas.ts` | `asaasFetch` não expõe mais `JSON.stringify(data.errors)` — loga internamente e lança erro genérico |
| S1-P2-13 | `app/api/admin/users/route.ts` | Removido UUID mágico `00000000-...`; query forms pulada quando profileIds vazio |
| S1-P2-14/18 | `app/api/forms/route.ts`, `app/api/forms/[id]/route.ts` | Slug regex reforçada: mínimo 3 chars, começa com alfanumérico (`/^[a-z0-9][a-z0-9-]{2,60}$/`) |
| S1-P2-19 | `app/api/forms/[id]/duplicate/route.ts` | `duplicateError?.message` não vaza mais; mensagem genérica + logError |
| S1-P2-25 | `middleware.ts` | logWarn em produção quando ALLOWED_ORIGINS vazio (CSRF check desativado) |
| S1-P2-26 | `middleware.ts` | customDomainCache limitada a 1000 entradas (evict FIFO) |
| S1-P3-5 | `app/api/responses/route.ts` | Removido `Authorization` de CORS Allow-Headers (endpoint não usa Bearer) |
| S1-P3-7 | `app/api/forms/[id]/analytics/route.ts` | `select('*')` → `select('id')` nos COUNT queries |
| S1-P3-8 | `question-renderer.tsx` | Validação de tamanho client-side antes do upload (10MB) |
| S1-P3-9 | `question-renderer.tsx` | `accept="image/*"` → tipos exatos que o servidor aceita |

### Padronização de logging (console.error → logError)

Arquivos: `lib/auth.ts`, `app/api/admin/whatsapp/disconnect/route.ts`, `app/api/admin/whatsapp/status/route.ts`, `app/api/folders/route.ts`, `app/api/folders/[id]/route.ts`, `app/api/forms/route.ts`, `app/api/forms/[id]/route.ts`, `app/api/forms/[id]/webhook/route.ts`, `app/api/whatsapp/send/route.ts`

### P3 já estavam corrigidos

- P3-B: `__lastActivity` httpOnly: true (Etapa 4)
- P3-G: `incrementResponseCount` agora é atômico via RPC
- P3-L: CSV injection: fórmulas neutralizadas em `responses-dashboard.tsx`

### P3 não corrigidos (complexidade desproporcional)

Documentados em `correcoes-p3.md` — todos os itens são de baixo impacto ou requerem redesign maior (nova feature de audit log, isomorphic-dompurify, consolidação de WhatsApp endpoints, RPC SQL para analytics).

### Validação

- `tsc --noEmit`: ✅ 0 erros
- `next build`: ✅ 0 erros

---

## Fix: Upload de imagem no form-player (Storage + payload limit)

**Data:** 2026-05-02  
**Responsável:** Toin  
**Tipo:** Bug fix  
**Status:** ✅ Concluída

### Problema
Quando um respondente anexa uma imagem num formulário, o frontend codifica em base64 e inclui no JSON do payload. Isso ultrapassava o limite de 50KB (`MAX_PAYLOAD_BYTES`), retornando erro 413.

### Causa raiz
O endpoint `/api/upload` existente requer autenticação (`createClient`), mas respondentes de forms são anônimos. Quando falhava com 503 (R2 não configurado), o frontend fazia fallback para base64 — que infla o payload.

### O que foi feito

#### 1. Novo endpoint público de upload
**Arquivo:** `app/api/upload/public/route.ts` (NOVO)

- Endpoint `/api/upload/public` — sem autenticação, acessível por respondentes anônimos
- Rate limit por IP (reutiliza `checkUploadRateLimitAsync`)
- Validação de magic bytes (mesmo padrão do endpoint autenticado)
- CORS headers públicas (necessário para forms embutidos em qualquer domínio)
- Arquivos salvos em `public-uploads/` no R2 (separado de uploads autenticados)
- Max 10MB, tipos: JPEG, PNG, GIF, WebP, PDF

#### 2. Frontend atualizado
**Arquivo:** `components/form-player/question-renderer.tsx`

- Upload agora aponta para `/api/upload/public` em vez de `/api/upload`
- Fallback para base64 mantido (para quando R2 não está configurado)
- Quando R2 está disponível, o payload contém apenas a URL pública (poucos bytes)

#### 3. Payload limit aumentado
**Arquivo:** `app/api/responses/route.ts`

- `MAX_PAYLOAD_BYTES` aumentado de 50KB para 1MB
- Justificativa: formulários longos com campos de texto podem ultrapassar 50KB mesmo sem uploads
- Proteção contra abuso mantida: rate limit (10 req/min/IP), honeypot, MAX_ANSWER_KEYS (200)

### Validação
- `tsc --noEmit`: ✅ 0 erros

### Arquivos alterados
- `app/api/upload/public/route.ts` (NOVO)
- `components/form-player/question-renderer.tsx` (modificado)
- `app/api/responses/route.ts` (modificado)
- `handoff.md` (atualizado)

### Pendências
- Nenhuma pendência de código

### Nota
Bucket do Supabase Storage não foi criado pois o projeto já usa R2 (Cloudflare) como storage. O endpoint existente `/api/upload` (autenticado) e o novo `/api/upload/public` (anônimo) ambos usam R2.

---

## Upload via Supabase Storage (Signed URL)

**Data:** 2026-05-02  
**Responsável:** Toin  
**Tipo:** Feature/Migração  
**Status:** ✅ Concluída

### Problema
Upload de imagem no form-player usava base64 inline no JSON → payload grande → erro 413. R2 não estava configurado. Migrado para Supabase Storage com upload direto do browser via signed URL.

### O que foi feito

#### 1. Migration — bucket `form-uploads`
**Arquivo:** `supabase/migrations/20260502_create_form_uploads_bucket.sql` (NOVO)

- Bucket público para leitura (public: true)
- Limite 10MB, tipos: JPEG, PNG, GIF, WebP, PDF
- Policy SELECT para qualquer um (public read)
- Sem policy INSERT para anon — upload só via signed URL (service_role)

#### 2. Novo endpoint `/api/upload/sign-url`
**Arquivo:** `app/api/upload/sign-url/route.ts` (NOVO)

- Recebe `{ form_id, mime, size }`
- Rate limit por IP (checkResponseRateLimitAsync)
- Valida form existe e está published (via createAdminClient)
- Valida tipo e tamanho (máx 10MB)
- Gera caminho: `{user_id}/{form_id}/{uuid}.{ext}`
- Retorna `{ upload_url, upload_token, public_url, path }` via `createSignedUploadUrl`

#### 3. Frontend — upload direto browser → Supabase
**Arquivo:** `components/form-player/question-renderer.tsx` (modificado)

- Pedir signed URL do `/api/upload/sign-url`
- PUT direto pro Supabase Storage (sem passar pelo Next.js)
- Salva apenas `{ url: public_url, name, size, type }`
- Fallback base64 removido — se upload falhar, mostra erro claro
- `formId` adicionado às props do QuestionRenderer

**Arquivo:** `components/form-player/form-player.tsx` (modificado)

- Passa `formId={form.id}` para QuestionRenderer

#### 4. Payload limit reduzido
**Arquivo:** `app/api/responses/route.ts` (modificado)

- `MAX_PAYLOAD_BYTES` de volta para 50KB (upload agora é via Storage, não no payload)

#### 5. Validação de upload atualizada
**Arquivo:** `lib/field-validators.ts` (modificado)

- Valida URL do Supabase Storage
- Valida size se presente
- Removida aceitação de data URLs (base64)

#### 6. Upload autenticado migrado para Supabase Storage
**Arquivo:** `app/api/upload/route.ts` (reescrito)

- Removida dependência de R2/S3
- Upload via admin client (service_role) para bucket `form-uploads`
- Caminho: `assets/{user_id}/{uuid}-{name}.{ext}`
- Magic bytes validation mantida

#### 7. Endpoint público deletado
**Deletado:** `app/api/upload/public/route.ts`

#### 8. R2 limpo
- Nenhuma referência a R2 no código fonte (apenas node_modules)
- Variáveis R2_* podem ser removidas do Vercel se desejado

### Validação
- `tsc --noEmit`: ✅ 0 erros

### Pendências
- **Migration precisa ser aplicada** no Supabase: `20260502_create_form_uploads_bucket.sql`
- Testar upload ponta-a-ponta com imagem 5MB
- Testar form sem upload continua funcionando

### Arquivos alterados
- `supabase/migrations/20260502_create_form_uploads_bucket.sql` (NOVO)
- `app/api/upload/sign-url/route.ts` (NOVO)
- `app/api/upload/route.ts` (reescrito)
- `app/api/upload/public/route.ts` (DELETADO)
- `components/form-player/question-renderer.tsx` (modificado)
- `components/form-player/form-player.tsx` (modificado)
- `app/api/responses/route.ts` (modificado)
- `lib/field-validators.ts` (modificado)
- `handoff.md` (atualizado)
