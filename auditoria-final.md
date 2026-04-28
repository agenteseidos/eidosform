# Auditoria Final EidosForm — 2026-04-28

**Auditor:** Claude (Opus 4.7)
**Domínio de produção:** eidosform.com.br
**Branch:** main · commit base: d73299d
**Escopo:** Re-auditoria completa pós-correções e revalidação dos achados anteriores

> **Pré-requisito não atendido:** O arquivo `auditoria-sessao1.md` mencionado no prompt original não existe.
> Esta auditoria foi feita a partir do código atual usando como contexto:
> `auditoria-maxima.md` (2026-04-23, P0/P1/P2/P3), `audit-etapa-1.md` a `8.md` (2026-04-04) e `auditoria-browser.md`.
> O `auditoria-maxima.md` foi feito quando o domínio configurado/testado estava errado e por isso muitos
> achados estavam marcados [NÃO TESTADO]. Esses itens foram re-examinados aqui via leitura do código atual.

---

## Sumário

| Severidade | Achados |
|---|---|
| **P0** | 4 |
| **P1** | 11 |
| **P2** | 18 |
| **P3** | 12 |
| **Total** | **45** |

---

## Status dos achados anteriores

### P0 da auditoria-maxima — verificação atual

| ID | Achado original | Status | Evidência |
|----|----|----|----|
| P0-1 | Signup usa `listUsers()` para checar email | ✅ **CORRIGIDO** | `app/api/auth/signup/route.ts:46-67` usa `signUp` direto + map de erros |
| P0-2 | `x-response-id` permite update sem auth | ⚠️ **PARCIAL** | `app/api/responses/route.ts:255` valida `respondent_id`, mas só bloqueia quando não-nulo. Anônimos com leak de UUID ainda sobrescrevem (ver F-12) |
| P0-3 | `error.message` vaza detalhes | ✅ **CORRIGIDO** em forms; ⚠️ ainda vaza em admin/plan, admin/users, admin/metrics, integrations |
| P0-4 | `React.memo` ignorando questions/status/is_closed | ✅ **CORRIGIDO** | `form-player.tsx:1007-1027` compara title, status, is_closed, hide_branding, redirect_url, theme, welcome_enabled, questions, pixels |
| P0-5 | `loadPartialProgress` referencia `visibleQuestions` antes de definido | ✅ **CORRIGIDO** | `form-player.tsx:148,160-167` usa `pendingPositionRef` + `useEffect` |
| P0-6 | "Economize até 40%" imprecisa | ❓ Não verificado nesta sessão (UX/copy, não bloqueante de produção) |

### P1 da auditoria-maxima — verificação atual

| ID | Achado | Status |
|----|----|----|
| P1-1 | partial-response sem rate limiting | ✅ **CORRIGIDO** — `route.ts:114` |
| P1-2 | CEP rate limit in-memory | ⚠️ Persiste — risco baixo |
| P1-3 | POST /api/forms vaza `error.message` | ✅ **CORRIGIDO** |
| P1-4 | Webhook Asaas — fallback fraco | ✅ **CORRIGIDO** — HMAC timing-safe + replay window 5min |
| P1-5 | GET /api/responses sem rate limiting | ✅ **CORRIGIDO** — 60/min |
| P1-13 | CSRF ausente em /api/* writes | ✅ **MITIGADO** — `middleware.ts:113-130` Origin check |
| P1-14 | Site não deployado | ✅ **CORRIGIDO** (premissa: domínio agora é eidosform.com.br) |

### P2/P3 selecionados — verificação atual

| ID | Achado | Status |
|----|----|----|
| P2-3 | `/api/forms/[id]/export?format=csv` sem rate limit | ❌ **AINDA** — `app/api/forms/[id]/export/route.ts` |
| P2-1 | `/api/upload` GET expõe configuração R2 | ❌ **AINDA** — `app/api/upload/route.ts:123` |
| P2-21 | API Key plaintext | ❌ **AINDA** — lookup por `eq('api_key', apiKey)` em `lib/api-key-auth.ts:49` |
| P2-22 | Rate limit fallback in-memory | ⚠️ **MITIGADO** (RPC `SECURITY DEFINER`) |
| P2-23 | Webhook Asaas fallback via query string | ⚠️ **AINDA** — query `accessToken` aceito em fallback |
| P2-24 | Meta Pixel ID injection | ✅ **MITIGADO** — regex `/^\d{10,20}$/` |
| P3-1 | `sanitizeValue` regex simples | ❌ **AINDA** — `lib/form-response-security.ts:9` |
| P3-13 | `httpOnly: false` no cookie `__lastActivity` | ❌ **AINDA** — `lib/auth.ts:50` |
| P3-15 | Upload — nome de arquivo no key R2 | ✅ **MITIGADO** — sanitização aplicada |

---

## Achados novos / revalidados

### P0 — bloqueiam venda

#### P0-A — Custom domain quebrado: instruções incoerentes com validação DNS
- **Arquivos:** `components/settings/domain-settings.tsx:147,239` e `lib/custom-domain.ts:6,87-101`
- **Problema:** A UI orienta o cliente Professional a configurar CNAME apontando para `cname.eidosform.com`, mas:
  1. `lib/custom-domain.ts:6` define `VERCEL_DOMAIN_SUFFIX = 'vercel.app'` e `validateDomainCNAME()` só retorna `true` se algum CNAME do domínio do cliente conter `vercel.app`.
  2. `dns/promises#resolveCname` retorna apenas o **next-hop** CNAME (não a cadeia resolvida), portanto se o cliente apontar para `cname.eidosform.com`, o array de CNAMEs será `['cname.eidosform.com']` e nunca casará com `vercel.app`.
  3. Domínio `eidosform.com` (sem `.br`) provavelmente não é controlado pela empresa (correção do usuário foi explícita: o domínio é `.com.br`).
- **Impacto:** Recurso pago do plano Professional não verifica corretamente. `verified` permanece `false` indefinidamente. Bloqueador de venda do plano top.
- **Correção:** (a) decidir o destino canônico CNAME (ex.: `cname.eidosform.com.br` apontando para `cname.vercel-dns.com`) e ajustar UI; (b) `validateDomainCNAME` deve aceitar qualquer um de [`cname.eidosform.com.br`, `vercel-dns.com`, `vercel.app`] OU usar `dns.resolve` para seguir a cadeia até a raiz; (c) corrigir `domain-settings.tsx:147,239` para o domínio efetivamente apontado pelo cliente.
- **Severidade:** **P0**

#### P0-B — CSV / XLSX / PDF export vulnerável a CSV/Formula Injection
- **Arquivos:** `app/api/forms/[id]/export-csv/route.ts:115-121`, `app/api/forms/[id]/export/route.ts:91-97`, `lib/export-excel.ts`, `lib/export-pdf.ts`
- **Problema:** `escapeCSV` apenas escapa `,`, `"` e `\n`. Não neutraliza valores começando com `=`, `+`, `-`, `@`, `\t`, `\r`. Um respondente envia `=cmd|'/c calc'!A0` ou `@SUM(1+1)*cmd|'/c calc'!A0` no campo de texto. Quando o dono do formulário (cliente pagante) abre o CSV/XLSX no Excel, fórmulas executam — pode incluir comandos para baixar/executar binários.
- **Impacto:** RCE no cliente do dono do formulário; fuga de dados via fórmulas que fazem requisição HTTP. CWE-1236.
- **Correção:** Prefixar com `'` qualquer cell que comece com caractere de fórmula. Função utilitária:
  ```ts
  function neutralizeFormula(s: string): string {
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  }
  ```
- **Severidade:** **P0** — afeta todo cliente pago que exporta CSV/XLSX. PDF export é menos crítico (não interpreta fórmulas).

#### P0-C — Inconsistência de domínio em mailto e CNAME instrucional
- **Arquivos:**
  - `app/page.tsx:318` (`mailto:suporte@eidosform.com`)
  - `app/pgb/page.tsx:662` (`mailto:contato@eidosform.com`)
  - `app/(dashboard)/billing/page.tsx:90` (`mailto:suporte@eidosform.com`)
  - `components/settings/domain-settings.tsx:147,239` (`cname.eidosform.com`)
- **Problema:** Premissa correta do projeto é `eidosform.com.br`. Esses endereços apontam para domínio sem `.br`. Se a empresa não controla `eidosform.com`, e-mails ricocheteiam ou caem em conta de outro dono; CNAME é inválido.
- **Impacto:** Usuários que clicam no "Fale conosco" caem em SMTP inexistente; instruções DNS levam a CNAME inválido. Custo de imagem + bloqueio de feature paga.
- **Correção:** Substituir todas as ocorrências por `eidosform.com.br`.
- **Severidade:** **P0** — bloqueador de produção (suporte ao cliente quebrado + feature de domínio quebrada).

#### P0-D — `responses_limit` default no trigger não bate com plano free
- **Arquivos:** `supabase/migrations/20260424_auto_create_profile_on_signup.sql:13` e `lib/plan-definitions.ts:39`
- **Problema:** O trigger `handle_new_user()` cria profile com `responses_limit: 50`. Mas `PLANS.free.maxResponses = 100`. Em `lib/plan-limits.ts:44` a checagem usa `profile.responses_limit ?? PLANS[plan].maxResponses ?? 100` — como `responses_limit` está definido como 50, o usuário recém-criado só pode receber 50 respostas (não 100 como anunciado em pricing).
- **Impacto:** Usuário free tem metade do limite anunciado. Reclamação por descumprimento de oferta. Inconsistência de billing/UX.
- **Correção:** Migration alterando default para 100 e atualizando rows existentes onde `plan='free'` e `responses_limit=50`.
- **Severidade:** **P0** — false advertising / billing.

---

### P1 — críticos, mas não bloqueiam

#### P1-A — Anonymous response IDOR via X-Response-Id
- **Arquivo:** `app/api/responses/route.ts:225-269`
- **Problema:** A correção do P0-2 só bloqueia se `existingResponse.respondent_id` for não-nulo (linha 255: `if (existingResponse.respondent_id && existingResponse.respondent_id !== bodyRespondentId)`). Para forms públicos sem login, `respondent_id` é null em todas as respostas. Logo, qualquer atacante que descubra/intercepte um `response_id` válido pode mandar `POST /api/responses` com header `x-response-id: <uuid>` e sobrescrever as respostas de outra pessoa.
- **Mitigação parcial existente:** Response ID é UUID v4 (122 bits de entropia) — adivinhação computacionalmente inviável. Vetor real: response_id leakado em URL, screenshots, query strings, logs.
- **Impacto:** Hijack/corrupção de respostas alheias se UUID for vazado. Ainda assim, integridade das respostas não pode ser garantida em forms públicos.
- **Correção:** Para `respondent_id === null`, o update por X-Response-Id deve exigir HMAC token de continuação emitido pelo servidor (cookie httpOnly setado no insert) ou simplesmente proibir. A maior parte dos casos de uso (auto-save partial) já requer auth com `respondent_id`.
- **Severidade:** **P1**

#### P1-B — `app/api/admin/users/[id]/plan/route.ts:60` vaza `error.message`
- **Arquivo:** `app/api/admin/users/[id]/plan/route.ts:60`
- **Problema:** `return NextResponse.json({ error: error.message }, { status: 500 })` retorna mensagem Supabase crua. Mesmo padrão do P0-3 que foi corrigido em forms.
- **Impacto:** Vazamento de schema/erro DB para administradores (admins são confiáveis, mas inconsistência).
- **Correção:** Padronizar para "Erro interno do servidor" + log via `logError`.
- **Severidade:** **P1** (impacto baixo por ser endpoint admin-only).

#### P1-C — Builder permite forçar `plan` arbitrário no PATCH
- **Arquivo:** `app/api/forms/[id]/route.ts:232`
- **Problema:** O PATCH aceita `plan` como campo do body e grava direto: `...(plan !== undefined && { plan })`. Não há validação de que o `plan` enviado bate com o plano do usuário no `profiles`. Um usuário free pode setar `plan: 'professional'` no form. Embora o gating real seja feito por `PLANS[ownerPlan]?.X` no momento da renderização (no `app/f/[slug]/page.tsx` lê o plan do profile, não do form), o campo `forms.plan` pode ser usado em outras queries / relatórios.
- **Impacto:** Uso indevido / risco de regressão se algum gate consultar `forms.plan` em vez de `profiles.plan`.
- **Correção:** Remover `plan` do whitelist do PATCH; só aceitar `status, theme, questions, ...` etc.
- **Severidade:** **P1**

#### P1-D — Webhooks externos enviados sem assinatura HMAC
- **Arquivo:** `lib/webhook-dispatcher.ts:73-83`
- **Problema:** Quando o EidosForm dispara webhook para a URL configurada pelo cliente (Plus+), só envia headers `X-EidosForm-Event` e `X-EidosForm-Form-Id`. Não há HMAC para o cliente verificar autenticidade. Qualquer pessoa pode fingir ser EidosForm e disparar webhooks falsos.
- **Impacto:** Cliente que confia em webhook para CRM/automação pode receber dados falsos.
- **Correção:** Adicionar `X-EidosForm-Signature: t=<timestamp>&v1=<hmac-sha256>` usando `WEBHOOK_HMAC_SECRET` por usuário (gerar e armazenar). Cliente valida antes de processar.
- **Severidade:** **P1**

#### P1-E — Builder não valida tamanho/quantidade de questions na persistência
- **Arquivos:** `app/api/forms/route.ts:122-135`, `app/api/forms/[id]/route.ts:225`
- **Problema:** O array `questions` é JSONB sem limite. Um usuário pode enviar 50.000 perguntas. Storage cresce, request size aumenta, builder/player travam.
- **Impacto:** DoS / abuso de armazenamento. Já antecipado no `audit-etapa-6.md` (P2 não corrigido).
- **Correção:** Validar `questions.length <= PLANS[plan].maxQuestions` (definir limites: free=20, starter=100, plus=500, professional=ilimitado). Validar tamanho serializado < 200KB.
- **Severidade:** **P1**

#### P1-F — Validação de webhook URL é vulnerável a DNS rebinding
- **Arquivo:** `lib/webhook-validator.ts:1-50`
- **Problema:** A validação só verifica string literal de hostname/IP. Atacante registra `attacker.com` resolvendo (na hora do fetch) para `127.0.0.1`. A 1ª resolução pode dar IP público, a 2ª (no fetch) dá privado.
- **Impacto:** SSRF para localhost / metadata services, exfiltração de dados internos.
- **Correção:** Após validar o URL, resolver IP via `dns.lookup`, validar que IP não é privado/loopback, e fazer fetch usando o IP literal com header `Host` original. Ou usar `Vercel Functions Edge Runtime` com `DNS allowlist`.
- **Severidade:** **P1**

#### P1-G — `lib/resend.ts` injeta nome de usuário em HTML sem escape
- **Arquivo:** `lib/resend.ts:89,115,140`
- **Problema:** `<strong>${name}</strong>` interpola `user.full_name` direto. Embora o e-mail seja enviado ao próprio usuário, ele pode usar `<img onerror=...>` para tentar XSS no webmail. Modernos webmails sanitizam, mas é prática inadequada.
- **Impacto:** Self-XSS limitado; risco de regressão se template for reutilizado em emails para terceiros.
- **Correção:** Aplicar `escapeHtml(name)` em todos os usos.
- **Severidade:** **P1** (deveria ser P2, mas user-controllable + HTML email é risco crônico).

#### P1-H — `app/api/forms/[id]/route.ts` PATCH não valida `welcome_image_url`
- **Arquivo:** `app/api/forms/[id]/route.ts:241`
- **Problema:** `welcome_image_url` é gravado direto sem `validateWebhookUrl` ou domínio whitelist. Atacante pode setar URL para imagem privada (CSRF de imagem) ou tracking pixel externo.
- **Impacto:** Tracking não-autorizado, CSP bypass se domínio externo for permitido pelo CSP.
- **Correção:** Validar URL é HTTPS e domínio é Supabase Storage / R2 da própria conta.
- **Severidade:** **P1**

#### P1-I — `/api/forms/[id]/export` (alternativa ao export-csv) sem rate limit
- **Arquivo:** `app/api/forms/[id]/export/route.ts:30-150`
- **Problema:** `export-csv` (rota dedicada) tem rate limit 5/h, mas o `/export?format=csv` não tem. Cliente pode bypassar limite de export usando esta rota.
- **Impacto:** DoS / consumo excessivo de DB / storage temporário.
- **Correção:** Adicionar `checkRateLimitAsync` aqui ou consolidar em uma única rota.
- **Severidade:** **P1**

#### P1-J — Webhook Asaas: `description` heurística pode cair em plano errado
- **Arquivo:** `app/api/webhooks/asaas/route.ts:22-35`
- **Problema:** Se o valor pago não bater com nenhum preço conhecido (proration, mudança futura de preço), `detectPlanAndCycle` cai em fallback de parsear `description.toLowerCase()` procurando "plus"/"professional". Se a descrição mudar (ex.: incluir "Eidos Plus Pro Plan"), pode mapear para "professional" indevidamente.
- **Mitigação:** O fluxo principal usa `checkoutLink.plan` quando existe. O fallback só roda quando `checkoutLink` está nulo (raro).
- **Impacto:** Cliente paga por plano X e recebe Y. Possível abuso se atacante consegue criar payment direto na Asaas com descrição arbitrária.
- **Correção:** Remover fallback heurístico; se valor não casar e não houver checkoutLink, logar erro e devolver 200 sem ativar plano. Exigir que pagamentos sempre tenham checkoutLink registrado.
- **Severidade:** **P1**

#### P1-K — RLS conflitante entre migrations 20260327
- **Arquivos:** `supabase/migrations/20260327_fix_rls_p0_v2.sql` e `20260327_fix_rls_response_leak.sql`
- **Problema:** As migrations rodam em ordem alfabética: `fix_p0_rls_responses` → `fix_response_visibility_rls` → `fix_rls_p0_v2` → `fix_rls_response_leak`. A última (response_leak) **dropa** as policies anon que a anterior (rls_p0_v2) **acabou de criar**. Estado final: anon não pode SELECT/UPDATE/DELETE responses (correto). Mas a leitura linear dessas migrations confunde — em ambiente novo o resultado é OK; em ambiente que ficou em estado intermediário pode haver inconsistência.
- **Impacto:** Confusão de manutenção, risco de ressuscitar policy insegura em rebase/seed.
- **Correção:** Consolidar em uma única migration "definitiva" e remover as conflitantes.
- **Severidade:** **P1** (manutenção / risco operacional, não vulnerabilidade ativa).

---

### P2 — médios

#### P2-A — `app/api/upload/route.ts` GET expõe `configured: true/false`
- **Arquivo:** `app/api/upload/route.ts:123-127`
- **Problema:** GET sem auth retorna se R2 está configurado. Reconhecimento de infraestrutura.
- **Correção:** Mover para `/api/admin` ou exigir auth.

#### P2-B — Welcome image upload aceita SVG
- **Arquivo:** `components/form-builder/form-builder.tsx:311-317`
- **Problema:** `allowedTypes` inclui `'image/svg+xml'`. SVG aceita scripts; embora `<img>` tag não execute, embed/object/iframe podem.
- **Correção:** Remover `image/svg+xml` ou sanitizar SVG via DOMPurify server-side antes de upload.

#### P2-C — Webhook Asaas aceita token via query string como fallback
- **Arquivo:** `app/api/webhooks/asaas/route.ts:191,201`
- **Problema:** `accessToken` por query aparece em logs/referer. Fallback ainda existe.
- **Correção:** Remover fallback de query string; exigir HMAC ou header.

#### P2-D — `sanitizeValue` regex insuficiente
- **Arquivo:** `lib/form-response-security.ts:8-17` e `app/api/responses/route.ts:51-63`
- **Problema:** `replace(/<[^>]*>/g, '')` falha em entities/malformed (`&lt;script&gt;`, `<scr<script>ipt`). Embora React escape no render, é defesa em profundidade fraca.
- **Correção:** Usar DOMPurify server-side (`isomorphic-dompurify`).

#### P2-E — API Key armazenada em plaintext
- **Arquivo:** `lib/api-key-auth.ts:46-50`, `app/api/settings/api-key/route.ts:38-44`
- **Problema:** `eq('api_key', apiKey)` confirma plaintext. Backup vazado expõe todas as chaves.
- **Correção:** Hash SHA-256 (ou bcrypt) na coluna; comparar hash.

#### P2-F — `handleDowngrade` carrega todas responses só pra contar
- **Arquivo:** `lib/plan-limits.ts:151-166`
- **Problema:** Para usuário com 100K responses, traz 100K rows de `form_id` para o app server. Persistente em downgrades automáticos.
- **Correção:** RPC `count_responses_per_form(user_id)` retornando aggregate via SQL.

#### P2-G — Dashboard `forms/page.tsx` usa `select('*')` e count em memória
- **Arquivo:** `app/(dashboard)/forms/page.tsx:22,38-47`
- **Problema:** `select('*')` traz todos os campos JSONB de questions, pixels, etc. para o servidor. Count de responses por form via `select('form_id').in('form_id', formIds)` em memória.
- **Correção:** Selecionar apenas colunas necessárias para o card; usar RPC para count agregado.

#### P2-H — `setInterval` global em `whatsapp/send` em ambiente serverless
- **Arquivo:** `app/api/whatsapp/send/route.ts:30-35`
- **Problema:** `setInterval` em handler de função serverless é executado a cada cold start mas a função morre logo. Vazamento de timer se a runtime mantiver o isolate vivo. Cleanup do rate limiter never executes confiavelmente.
- **Correção:** Cleanup inline durante check (lazy expiration) ou migrar para Supabase RPC como o resto.

#### P2-I — `app/api/admin/whatsapp/qr/route.ts` rate limit global em variável de módulo
- **Arquivo:** `app/api/admin/whatsapp/qr/route.ts:6-7`
- **Problema:** `let lastQrTime = 0` é per-isolate. Em serverless, cold start zera. Rate limit ineficaz.
- **Correção:** Migrar para `checkRateLimitAsync(...)` com chave `admin:qr`.

#### P2-J — PATCH /api/domains não valida ownership do domínio antes de chamar Vercel
- **Arquivo:** `app/api/domains/route.ts:202`
- **Problema:** `checkDomainStatus(domain)` é chamado sem checar se o domínio pertence ao usuário autenticado. Qualquer usuário Professional pode probar status Vercel de qualquer domínio.
- **Impacto:** Pequeno (info pública). Pode ser usado para sniffing de quais domínios outros tenants registraram.
- **Correção:** Antes de chamar, `select id from custom_domains where domain = $1 and user_id = auth.uid()`.

#### P2-K — `app/api/admin/users/route.ts` carrega todos profiles sem paginação
- **Arquivo:** `app/api/admin/users/route.ts:15-18`
- **Problema:** `select` sem `range`. Para tenants com muitos usuários, carrega tudo em memória do app server.
- **Correção:** Adicionar paginação (`page`, `limit`).

#### P2-L — `app/api/admin/metrics/route.ts` usa `select('*')` apenas para count
- **Arquivo:** `app/api/admin/metrics/route.ts:11-15`
- **Problema:** `count: 'exact', head: true` faz HEAD, mas usa `select('*')`. Pode ser otimizado para `select('id', { count: 'exact', head: true })`.
- **Correção:** Trocar `*` por coluna mais leve.

#### P2-M — Onboarding de novo usuário relies on session cookie sem invalidação ao downgrade
- **Arquivo:** `lib/auth.ts:45-54`
- **Problema:** Cookie `__lastActivity` é `httpOnly: false` com path `/` — legível por qualquer JS. Downgrade de plano feito por webhook não invalida sessão atual; usuário continua vendo features Plus+ no front até refresh.
- **Correção:** Server actions/SWR-revalidate em mudança de plano; força reload.

#### P2-N — `incrementResponseCount` não é atômico contra `checkResponseLimit`
- **Arquivos:** `app/api/responses/route.ts:227,289`
- **Problema:** Race: dois POSTs simultâneos checam `responses_used < limit` (passa) e ambos incrementam. Resultado: 1 acima do limite. RPC `increment_responses_used` é atômico mas o check precede o increment.
- **Correção:** RPC `try_increment_responses_used()` que retorna `allowed=true` apenas se `responses_used < responses_limit` e increment atômico no mesmo statement.

#### P2-O — Builder PATCH não valida tamanho do payload
- **Arquivo:** `app/api/forms/[id]/route.ts:50-72`
- **Problema:** Não há check de Content-Length. Usuário pode mandar PATCH com 10MB de questions JSONB.
- **Correção:** `MAX_PAYLOAD_BYTES` similar ao `/api/responses` (50KB) ou maior (200KB) e abortar early.

#### P2-P — `/api/cep/[cep]` rate limit in-memory puro
- **Arquivo:** `app/api/cep/[cep]/route.ts` (referência da auditoria-maxima)
- **Problema:** Map local; cold starts resetam. (P3 da maxima, mantido como P2 por persistência).

#### P2-Q — Schemas conflict: `forms.plan` em `20260317_forms_new_fields.sql` vs constraint em profiles
- **Arquivos:** `supabase/migrations/20260317_forms_new_fields.sql:5` e `20260328_add_plan_constraint.sql`
- **Problema:** `forms.plan` aceita qualquer string (não tem CHECK constraint). Colunas inconsistentes entre profiles (constraint) e forms (sem constraint). Permite valores como `"plan_promo"` que não existem.
- **Correção:** Adicionar constraint em `forms.plan` ou remover a coluna se não tem uso real (override por form não está exposto).

#### P2-R — `lib/whatsapp.ts` e `whatsapp-panel.tsx` hardcoded instâncias
- **Arquivo:** `components/form-builder/whatsapp-panel.tsx` (P2-9 da maxima)
- **Status:** Persistência de `['default', 'instancia-2', 'instancia-3']` já flagged, manter como P2.

---

### P3 — baixos

#### P3-A — `mailto:` aponta para `eidosform.com` (sem `.br`)
- Mesma família de P0-C, mas se DNS de `eidosform.com` for da empresa, é só inconsistência de copy.

#### P3-B — `cookie __lastActivity` legível por JS
- `lib/auth.ts:50` `httpOnly: false`. Mantido como P3.

#### P3-C — API v1 retorna `questions` completas (incluindo metadata sensível)
- `app/api/v1/forms/[id]/route.ts:111` retorna `questions` JSONB direto. Se questions guardam `webhookSecret`/`apiKey` por field (não vi mas é comum), exporia.
- **Risk baixo** — não vi armazenamento de secrets em questions.

#### P3-D — `lib/proration.ts` usa `DAYS_IN_MONTH = 30` constante
- Cálculo aproximado; usuário em mês de 31 dias paga ligeiramente diferente. Aceitável para SaaS.

#### P3-E — `app/api/admin/whatsapp/disconnect/route.ts` usa `console.error` direto
- Sem `logError`. Inconsistência.

#### P3-F — `googleSheets` requer `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_PRIVATE_KEY` mas falha em `getAuth()` apenas no momento de uso, não na inicialização.
- Pode causar erros confusos.

#### P3-G — `app/api/responses/route.ts:288-289` `incrementResponseCount` é fire-and-forget com `.catch`
- Se falhar, contador fica desincronizado. Cliente pode receber respostas grátis até reconciliação.

#### P3-H — Trigger `handle_new_user` declarado em `schema.sql:163` e re-declarado em migration `20260424_auto_create_profile_on_signup.sql`
- Possíveis estados conflitantes em ambientes que rodaram um e não o outro. Aceitável se schema.sql é só docs.

#### P3-I — `lib/asaas.ts:65` — error message inclui `JSON.stringify(data.errors)` da Asaas
- Pode vazar detalhes internos da Asaas no client (via /api/checkout/[plan]:263 que repassa o `message`).

#### P3-J — `next.config.ts` não verificado nesta sessão; etapa 8 confirma CSP/HSTS OK.

#### P3-K — Hardcoded admin emails sem audit log
- `lib/admin-auth.ts:9` lê de env. Sem trail de "quem mudou plano X de Y para Z" — `webhook_logs` cobre webhooks mas mudanças manuais via `/api/admin/users/[id]/plan` não são logadas.

#### P3-L — `responses-dashboard.tsx` exporta para CSV no client (`exportToCSV`)
- `components/responses/responses-dashboard.tsx:469-490` faz export client-side sem rate limit de servidor; mesmo problema de CSV injection se reusar lógica.

---

## Estado dos módulos

### 1. Arquitetura
- **OK.** Next.js 16 + Supabase SSR. Middleware com Origin check. Custom domain rewrite. CSP/HSTS fortes (etapa 8).

### 2. Auth e sessão
- **OK** com observações: brute-force rate limit em login/signup (5/15min), inactivity timeout 30min via cookie, `httpOnly:false` (P3-B), `getRequestUser` aceita cookie ou Bearer token. **Bom.**

### 3. RLS e migrations
- **Aceitável**, mas com migrations conflitantes (P1-K). Estado final correto: anon só pode INSERT em responses; owners read/update/delete via authenticated. `rate_limit_entries` com policy deny + `SECURITY DEFINER` nas funções RPC. `forms`/`profiles`/`folders`/`custom_domains` com policies de ownership corretas.

### 4. Isolamento de dados
- **Bom.** Todos os endpoints autenticados verificam `eq('user_id', user.id)`. RLS é segunda camada. Único risco residual: P1-A (X-Response-Id IDOR para responses anônimas).

### 5. Webhooks Asaas
- **Bom**, com observações: HMAC implementado e timing-safe; replay window 5min; query token fallback (P2-C); fallback heurístico por description (P1-J). Idempotência: `webhook_logs` armazena cada evento; `billing_checkouts.checkout_id` é UNIQUE evitando duplicatas. Webhook ack rápido (não bloqueia processamento).

### 6. Gates por plano
- **Bom**, com inconsistência: `responses_limit=50` no trigger não bate com `PLANS.free.maxResponses=100` (P0-D). Demais features (pixels, webhooks, custom_domain, csvExport, pdfExport, partialResponses) gated em servidor antes de persistir.

### 7. Builder
- **OK**, com observações: sem limite de questions (P1-E), sem limite de payload no PATCH (P2-O), `welcome_image_url` sem validação (P1-H), permite forçar `plan` arbitrário (P1-C).

### 8. Player
- **Bom.** P0-4 e P0-5 corrigidos. CSP separado para forms públicos (frame-ancestors *). Embed gated por plano. Pixel ID validado.

### 9. Billing end-to-end
- **Bom**, com observações: proration calculado, downgrade graceful (pause forms, mantém data), cancel old subscription pós-confirm. Race condition de double-charge possível mas mitigada por `checkout_id` UNIQUE. `checkout/status` polling com timeout não definido no client (P1-8 da maxima — não verificado nesta sessão).

### 10. Dashboard / Analytics
- **OK**, mas `select('*')` no listing (P2-G), count de responses em memória (P2-G), CSV/XLSX/PDF export vulnerável a Formula Injection (P0-B).

### 11. Admin
- **Adequado.** Auth por email em env var. Sem audit log de mudanças manuais (P3-K). `error.message` vaza no plan PATCH (P1-B). Sem paginação em users (P2-K).

### 12. Integrações
- **OK**, com observações: WhatsApp via VPS com Bearer key + INTERNAL_API_SECRET. Google Sheets via service account; URL validada. Webhooks externos sem signature (P1-D). DNS rebinding possível (P1-F).

---

## Relatório executivo

### Bloqueia venda (P0)

1. **P0-A — Custom domain quebrado**: feature do plano Professional não funciona. Cliente paga e não consegue ativar domínio próprio.
2. **P0-B — CSV/XLSX export vulnerável a Formula Injection**: respondentes maliciosos podem injetar comandos no Excel do dono do form. Risco RCE na máquina do cliente.
3. **P0-C — Domínios `eidosform.com` (sem `.br`) em mailto e CNAME**: suporte por e-mail quebrado, instruções DNS apontam para domínio que possivelmente não é da empresa.
4. **P0-D — Free plan com `responses_limit=50` em vez de 100**: usuários free recebem metade do anunciado. Reclamação de produto.

### Não bloqueia venda

- P1-J fallback heurístico de plano (raro acionar)
- P1-D HMAC de webhook saída (clientes que dependem disso são minoria)
- P1-F DNS rebinding (depende de cliente configurar URL maliciosa propositalmente)
- P1-K migrations conflitantes (estado final correto)
- todos os P2/P3

### O que está pronto

- **Auth & Sessão**: sólido — Origin CSRF check, brute-force rate limit, inactivity timeout, HMAC Asaas timing-safe, RLS bem fechada.
- **Player & Builder UX**: P0-4 e P0-5 corrigidos. Embed gated. Welcome screen, jump rules, conditional logic, partial responses, content blocks. Mobile responsivo.
- **Billing flow**: Asaas hosted checkout + proration + webhook reliability + checkout polling fallback.
- **Plan gates**: 95% de cobertura. Apenas P1-C (forms.plan arbitrário) e P0-D (default 50 vs 100) abertos.
- **Performance**: React.memo aplicado, N+1 corrigidos no admin, select('*') removido na maioria.

### Corrigiria primeiro

1. **P0-C** (mailto + CNAME `eidosform.com` → `.com.br`) — 30min, search-and-replace.
2. **P0-D** (responses_limit=100 no trigger + migration de update) — 15min, 1 migration.
3. **P0-A** (Custom domain CNAME) — 1-2h, decidir destino canônico + ajustar UI + ajustar `validateDomainCNAME`.
4. **P0-B** (CSV/XLSX Formula Injection) — 1h, função utilitária `neutralizeFormula` aplicada em todos os exports.

Esses 4 podem ser feitos no mesmo dia. Após eles, MVP está pronto para venda.

---

## Plano de ação priorizado

### Fase 1 — P0 (mesmo dia, ~3-4 horas)

1. **P0-C**: substituir `eidosform.com` por `eidosform.com.br` em mailto e domain-settings.tsx (147,239).
2. **P0-D**: nova migration `ALTER TABLE profiles ALTER COLUMN responses_limit SET DEFAULT 100; UPDATE profiles SET responses_limit=100 WHERE plan='free' AND responses_limit=50;` + atualizar trigger `handle_new_user` em `20260424_auto_create_profile_on_signup.sql`.
3. **P0-B**: criar `lib/csv-injection.ts` com `neutralizeFormula()`. Aplicar em `formatValue` de `export-csv/route.ts` e `export/route.ts`. Aplicar em `lib/export-excel.ts` e `lib/export-pdf.ts`. Aplicar no client-side `exportToCSV` em `responses-dashboard.tsx`.
4. **P0-A**: definir `cname.eidosform.com.br` apontando para `cname.vercel-dns.com`. Alterar `lib/custom-domain.ts:6` para verificar `cname.eidosform.com.br` ou `vercel-dns.com`. Atualizar `domain-settings.tsx:147,239`. Documentar setup DNS no Vercel.

### Fase 2 — P1 (próximos 2-3 dias)

5. **P1-A**: bloquear X-Response-Id update quando `respondent_id IS NULL` ou exigir token de continuação HMAC.
6. **P1-B**: padronizar mensagens de erro em `/api/admin/users/[id]/plan/route.ts:60`.
7. **P1-C**: remover `plan` do whitelist de PATCH em `/api/forms/[id]`.
8. **P1-D**: adicionar HMAC signature em outgoing webhooks; documentar.
9. **P1-E**: limites de questions por plano (validação no PATCH/POST).
10. **P1-F**: `dns.lookup` na URL de webhook, validar IP não-privado.
11. **P1-G**: `escapeHtml(name)` em `lib/resend.ts`.
12. **P1-H**: validar `welcome_image_url` (HTTPS + domínio próprio).
13. **P1-I**: adicionar rate limit em `/api/forms/[id]/export`.
14. **P1-J**: remover fallback heurístico em `detectPlanAndCycle`.
15. **P1-K**: consolidar migrations 20260327_*.

### Fase 3 — P2 (próxima sprint)

16. P2-A → P2-R conforme acima. Priorizar:
   - **P2-N** (race condition em response count) — risco de feature gating bypass
   - **P2-E** (API key plaintext) — depois de implementar hash, rotacionar todas as keys existentes
   - **P2-F** (handleDowngrade ineficiente) — antes do primeiro cliente Professional fazer downgrade
   - **P2-G** (dashboard `select('*')` + count em memória) — performance em dashboards grandes

### Fase 4 — P3 (backlog)

17. Inconsistências menores, audit log de mudanças admin, proration mais precisa, cleanup de console.error inconsistentes.

---

## Anotações sobre comportamento externo (não verificado em runtime)

- **Asaas API**: validação assume que `payment.value` corresponde a `PLAN_PRICES`. Em produção, valores prorated nunca casam — o código usa `checkoutLink.plan` como source of truth (correto). Risco: se webhook chega antes do checkout ser persistido em `billing_checkouts`, fallback heurístico ativa (P1-J).
- **Vercel API**: `addDomain`, `removeDomain`, `checkDomainStatus` dependem de `VERCEL_TOKEN` + `VERCEL_PROJECT_ID`. Sem essas envs, custom domain quebra silenciosamente.
- **DNS resolveCname**: comportamento depende do resolver DNS. Em alguns providers, retorna a cadeia completa. Em outros, apenas o next-hop. Implementação em Vercel Functions (Linux glibc): retorna apenas next-hop (P0-A).
- **Cloudflare R2**: `file.type` no upload é client-provided. Server não revalida via magic bytes. Risco de upload de binário disfarçado de imagem (mitigado por whitelist de MIME e validação de tamanho).
- **Resend**: emails só enviam se `RESEND_API_KEY` estiver setada; sem ela, falha silenciosa via `logWarn`.
- **WhatsApp VPS** (`wpp.eidosform.com.br`): assumido que o serviço VPS está deployado e respondendo; sem health check explícito visível no app.

---

**Fim do relatório.**
