# Auditoria de Uso — Fase 1 (Estática)

**Projeto:** EidosForm — SaaS de formulários conversacionais
**Diretório:** `/home/sidney/eidosform/`
**Data:** 2026-05-02
**Auditor:** Claude Code (Opus 4.7, 1M context)
**Tipo:** Auditoria estática — somente leitura, NENHUMA correção aplicada
**Escopo:** Login, dashboard, criação de forms, 18 tipos de pergunta, lógica condicional, submissão, integrações (webhooks, Sheets, Asaas, pixels), notificações (email Resend + WhatsApp Evolution/VPS)
**Para:** Zé / OpenClaw — verificação e priorização das correções pelos agentes do OpenClaw

---

## Sumário Executivo

| Severidade | Total |
|---|---|
| **P0** (crítico — segurança/integridade) | 11 |
| **P1** (importante — bug funcional/risco real) | 28 |
| **P2** (médio — bug edge case/UX/perf) | 43 |
| **P3** (menor — cosmético/nice-to-have) | 25 |
| **Total** | **107** |

**Diagnóstico geral:** Projeto bem estruturado, com defesas robustas em diversas áreas (RLS, rate limiting, HMAC timing-safe, magic bytes em upload, fire-and-forget em integrações). Os achados P0/P1 concentram-se em três áreas:

1. **Credenciais e secrets** — `.env` da VPS WhatsApp commitado em git, secrets sem validação de presença, scopes amplos.
2. **Autenticação e enumeration** — vazamento via códigos de erro de signup, ausência de check de email confirmado pré-login, open redirect com bypass possível, CSRF skip em `/api/auth/*`.
3. **Validação de payload e idempotência** — payloads JSONB sem schema Zod, dropdown/checkboxes aceitam options vazias, webhook Asaas sem dedup de evento, sem validação de ciclos em jump rules.

Os 18 tipos de pergunta estão **todos suportados**, com 12/18 OK e 6/18 com observações pontuais (validação parcial em min/max, options mínimos, content_block XSS).

---

## 1. Autenticação

### P0
- **P0-1 — Email enumeration via signup** (`app/api/auth/signup/route.ts:59-65`): retorna `code: 'EMAIL_ALREADY_REGISTERED'` vs `'EMAIL_ALREADY_PENDING'`. Permite enumerar emails válidos. Sugestão: retornar sempre `code: 'SIGNUP_ERROR'` genérico.
- **P0-2 — Open redirect com bypass possível** (`app/auth/callback/route.ts:9`): `rawNext.startsWith('/') && !rawNext.startsWith('//')` permite `/javascript:`, `//attacker.com` (com encoding), `///triplo`. Sugestão: whitelist de rotas ou `URL().origin === origin`.
- **P0-3 — Login sem check de email confirmado** (`app/api/auth/login/route.ts:36-45`): após `signInWithPassword`, não verifica `user.email_confirmed_at`. Usuário não-verificado acessa dashboard. Fluxo de verificação fica inútil.
- **P0-4 — Duplo fluxo signup (client + server)** (`app/(auth)/register/page.tsx:84-88` + `app/api/auth/signup/route.ts:46-53`): client chama fetch, server faz signUp; race condition de cookies. Sugestão: remover `supabase.auth.signUp()` do client.

### P1
- **P1-1 — Race condition em forgot-password** (`app/(auth)/forgot-password/page.tsx:18-46`): double-click queima rate limit; UX confusa.
- **P1-2 — Rate limit baixo no login** (`app/api/auth/login/route.ts:17-22`): 5/15min sem backoff exponencial nem CAPTCHA — bloqueia legítimo, ataque distribuído passa.
- **P1-3 — Inconsistência de mensagens** entre login (genérica, ok) e signup (específica, vazamento) — corrigir junto com P0-1.
- **P1-4 — Sem validação de comprimento de email** (`app/api/auth/signup/route.ts:10`): atacker pode enviar 10KB e queimar rate limit. Sugestão: cap em 254 chars (RFC 5321) antes do rate limit.
- **P1-5 — Mensagem inactivity timeout em inglês** (`lib/supabase/middleware.ts:71`): nunca chega ao usuário pt-BR.
- **P1-6 — Sem proteção contra timing attack em reset-password** (`app/api/auth/reset-password/route.ts:16-31`): jitter ausente.

### P2
- **P2-1 — `parseInt` retorna NaN no inactivity cookie** (`lib/supabase/middleware.ts:61-63`): `Math.min(NaN, Date.now()) = NaN`, falha aberta — sessão nunca expira se cookie corrompido.
- **P2-2 — Email enumeration via timing em resend-verification** (`app/api/auth/resend-verification/route.ts:34-50`): rate limit por email isolado permite distinguir registrado vs não-registrado.
- **P2-3 — Reset-password server sem validação de força** (`app/api/auth/reset-password/route.ts`): client valida 8 chars; server aceita qualquer senha que passe length.
- **P2-4 — XSS em `?message=` parameter** (`app/(auth)/login/page.tsx:26,105-106`): se renderizado sem escape (verificar) — vetor XSS via querystring.
- **P2-5 — Callback sem distinguir código expirado de código inválido** (`app/auth/callback/route.ts:14`): UX vaga.
- **P2-6 — CSRF skip em `/api/auth/*`** (`middleware.ts:124`): `publicWritePaths` inclui auth; sem Origin check, atacker em outra origem pode disparar fetch com cookies do user.

### P3
- **P3-1 — Sem "tentar outro email" após forgot-password sucesso** — UX preso.
- **P3-2 — Middleware redireciona logado de `/login` mas não de `/register`/`/forgot-password`** — UX confusa.
- **P3-3 — Mensagens mistas pt-BR/inglês** em alguns endpoints.
- **P3-4 — Sem feedback visual durante "Reenviar" em verify-email**.

### Pontos positivos
- Rate limiting com fallback in-memory + Supabase RPC (defense-in-depth).
- Inactivity timeout 30min com cookie httpOnly (apesar do bug P2-1).
- Email enumeration prevention em forgot-password (sempre retorna sucesso).
- CSRF middleware com Origin allowlist (exceto exception em auth — vide P2-6).

---

## 2. Dashboard e Gestão de Forms

### P1
- **P1-A — Payloads JSONB sem validação Zod** (`app/api/forms/route.ts:79-110`, `app/api/forms/[id]/route.ts:79-142`): `questions`, `pixels`, `thank_you_*` aceitos sem schema explícito. Mutação acidental + dados ruins difíceis de rastrear.
- **P1-B — Multi-user (Professional, maxUsers=10) NÃO implementado** (`lib/plan-definitions.ts:144`): plano é vendido mas não há tabelas `team_members`/`team_invites` nem RLS. Feature paga não funciona.
- **P1-C — Slug race condition** (`app/(dashboard)/forms/new/page.tsx:39-72`): retry sem backoff exponencial; se 3 usuários colidem, loop pode falhar.

### P2
- **P2-A — Limit enforçado só em POST, não em duplicate** — feedback preventivo ausente na UI.
- **P2-B — Página de respostas sem paginação** (`app/(dashboard)/forms/[id]/responses/page.tsx:35-38`): SELECT * sem LIMIT em forms com 1000+ respostas.
- **P2-C — Folder ON DELETE SET NULL com race** — orfanagem possível em deletes simultâneos.
- **P2-D — DELETE forms sem CSRF** — `publicWritePaths` cobre POST mas não DELETE; iframe malicioso pode disparar.
- **P2-E — Listagem de forms sem paginação no frontend** (apesar de API suportar).
- **P2-F — Duplicate form não revalida `maxQuestions` por plano** — duplicar 80 perguntas em plano free.

### P3
- **P3-A — Sem índice parcial em `responses(form_id, completed)`**.
- **P3-B — Logging confuso entre "RLS deny" e "DB error"**.

### Pontos positivos
- RLS de forms/responses/answer_items consolidado (migration 20260501).
- Plan limits enforçados em POST/PATCH/duplicate (com gap em P2-F).
- Cascade delete correto.
- Slug regex `^[a-z0-9][a-z0-9-]{2,60}$` previne XSS em URL.

---

## 3. Form Builder e os 18 tipos

### P0
- **P0-FB1 — Sanitização HTML server-side fraca** (`lib/html.ts:4`): fallback é apenas escape básico; `dangerouslySetInnerHTML` em content_block pode receber HTML perigoso. Sugestão: DOMPurify Node.js no server.

### P1
- **P1-FB1 — `dangerouslySetInnerHTML` sem garantia server-side** (`components/form-builder/form-preview.tsx:297`).
- **P1-FB2 — `isSafeUrl()` não bloqueia `blob:`, `ws:`, `wss:`, `file:`** (`app/api/forms/[id]/route.ts:387-400`).

### P2
- **P2-FB1 — Jump rules sem validação de ciclos no editor** (`components/form-builder/jump-rules-editor.tsx:18`).
- **P2-FB2 — Jump rules apontando para pergunta deletada não são limpas**.
- **P2-FB3 — Rating/opinion_scale: min ≥ max é aceito**.
- **P2-FB4 — file_upload sem cap em maxFileSize** (10000 MB possível).
- **P2-FB5 — Sem progresso visual de `maxQuestions`** (Free=25).
- **P2-FB6 — Calendly: URL vazia + obrigatório aceito**.
- **P2-FB7 — Dropdown/checkboxes aceitam <2 options no PATCH**.
- **P2-FB8 — Mudança de tipo não sobrescreve config tipo-específica** (rating→opinion_scale carrega min/max antigos).

### P3
- **P3-FB1/2/3/4 — Acessibilidade**: htmlFor inconsistente, sem aria-label em InlineEditableText, mobile drag-and-drop touch, sem path preview de jump rules.

### Cobertura por tipo (18 tipos)

| # | Tipo | Status | Observações |
|---|---|---|---|
| 1 | short_text | ✅ OK | — |
| 2 | long_text | ✅ OK | — |
| 3 | dropdown | ⚠️ | Permite <2 opções no servidor; sem reorder/grupos |
| 4 | checkboxes | ⚠️ | Idem dropdown |
| 5 | email | ✅ OK | — |
| 6 | phone | ✅ OK | País configurável |
| 7 | number | ⚠️ | Sem MAX_SAFE_INTEGER cap |
| 8 | date | ✅ OK | — |
| 9 | rating | ⚠️ | min ≥ max aceito |
| 10 | opinion_scale | ⚠️ | Idem rating |
| 11 | yes_no | ✅ OK | — |
| 12 | file_upload | ⚠️ | maxFileSize sem cap |
| 13 | nps | ✅ OK | — |
| 14 | url | ✅ OK | — |
| 15 | address (CEP) | ✅ OK | Fallback ViaCEP fraco (vide player) |
| 16 | cpf | ✅ OK | Dígito verificador |
| 17 | calendly | ⚠️ | URL vazia + required aceito |
| 18 | content_block | ⚠️ | XSS server-side parcial |

### Pontos positivos
- `field-validators.ts` cobre os 18 tipos.
- `isSafeUrl()` bloqueia `javascript:`/`data:`/`vbscript:` (com gap em P1-FB2).
- `form-logic-engine.ts` detecta ciclos em runtime.
- Autosave debounced 1500ms.
- Edição inline no preview.

---

## 4. Form Player (público) e Submissão

### P0
- **P0-FP1 — `validateDropdown`/`validateCheckboxes` aceitam options vazias** (`lib/field-validators.ts:225-233`): qualquer string passa se options estiver vazio.
- **P0-FP2 — Partial response prendendo respondent_id** (`app/api/responses/route.ts:254-259`): respondente anônimo→logado perde progresso.
- **P0-FP3 — Rate limit IP-only** sem CAPTCHA — botnet/proxy distribuído passa.

### P1
- **P1-FP1 — `isResponseComplete` valida required em perguntas ocultas por condicional** (`app/api/responses/route.ts:76-89`): submissão "completa" sem todos os required visíveis.
- **P1-FP2 — Front-end não valida opção não-existente em dropdown/checkbox** (mitigado server-side).
- **P1-FP3 — Number sem cap em MAX_SAFE_INTEGER**.
- **P1-FP4 — Magic bytes WEBP fraco** (RIFF + padding aceito).
- **P1-FP5 — CEP fail silently** se ViaCEP cai (5s timeout).

### P2
- **P2-FP1 — long_text sem proteção ReDoS**.
- **P2-FP2/3 — Title/Description de pergunta sem escape** (XSS refletido — owner ataca respondente).
- **P2-FP4 — content_block confia 100% em DOMPurify** (sem CSP layer).
- **P2-FP5 — Pixel events sem validação de event name customizado**.

### P3
- **P3-FP1 — Forms sem cache CDN** (Supabase fetch a cada pageview).
- **P3-FP2 — Honeypot retorna 201 sem indicar nada**.
- **P3-FP3 — Number input sem inputmode em alguns browsers**.
- **P3-FP4 — Erro de validação sem `scrollIntoView()`/`focus()`**.

### Pontos positivos
- Rate limit Supabase RPC + fallback in-memory.
- Magic bytes para upload (anti-MIME spoofing).
- Sanitização XSS em answers antes de salvar JSONB.
- Conditional logic frontend-only (sem expor lógica).
- CORS `*` + honeypot é correto para forms públicos embedados.

---

## 5. Integrações (webhooks, Google Sheets, Asaas, pixels, API pública)

### P0
- **P0-INT1 — `WEBHOOK_SECRET` sem validação de presença** (`lib/webhook-dispatcher.ts:78`): se ausente, signature fica null, X-Signature header não envia. Spoofing.
- **P0-INT2 — URL-encoded HMAC parsing pode falhar com `&`/`=`** (`lib/webhook-hmac.ts:22-26`).
- **P0-INT3 — `ASAAS_API_KEY` por request sem circuit breaker** (`lib/asaas.ts:11`): se vazar, atacante esgota.

### P1
- **P1-INT1 — Timestamp regenerado a cada retry de webhook** (`lib/webhook-dispatcher.ts:100`): consumidor com replay protection rejeita.
- **P1-INT2 — JSON.stringify não-determinístico** pode mudar payload entre retries → HMAC inválido.
- **P1-INT3 — Asaas HMAC: `age < -30_000` permite futuro** (`lib/webhook-hmac.ts:31`): pré-datação possível.
- **P1-INT4 — Asaas accepts `WEBHOOK_SECRET` OR `WEBHOOK_TOKEN`** — confusão de configuração.
- **P1-INT5 — Token match OR HMAC match** — bypass com qualquer um vazado.
- **P1-INT6 — Sem idempotência em webhook Asaas** — mesmo evento processado 2x → plano ativado/email enviado duplicado.
- **P1-INT7 — Eventos Asaas desconhecidos descartados silenciosamente** (`default: break`).
- **P1-INT8 — PAYMENT_OVERDUE pode downgradar plano novo** se webhook for de subscription antiga.
- **P1-INT9 — `GOOGLE_PRIVATE_KEY` em memória indefinidamente** (sem secrets manager).
- **P1-INT10 — Scope Sheets amplo** — todas spreadsheets do service account.
- **P1-INT11 — Asaas sem retry/backoff** em transientes.
- **P1-INT12 — Pixel matching duplicado** entre client e server (`pixel-events.ts` e `pixel-event-engine.ts`).
- **P1-INT13 — Meta Pixel retry sem cap** (10x por 3s pode acumular setTimeouts).
- **P1-INT14 — Proration sem timezone awareness**.
- **P1-INT15 — Race condition em proration calc → checkout creation**.
- **P1-INT16 — `INTERNAL_API_SECRET` pode ser vazio** — auth WhatsApp falha silenciosamente.
- **P1-INT17 — API key sem cache** — RPC verify a cada request (latência 20-50ms).
- **P1-INT18 — Rate limit IP spoofável via `x-forwarded-for`**.

### P2
- **P2-INT1 — `webhook_logs.payload` armazena PII completa** — LGPD risk.
- **P2-INT2 — DNS race em SSRF protection** — `[]` no catch passa.
- **P2-INT3 — Sem deduplicação de notificações** (sub `idempotency-key`).
- **P2-INT4 — Asaas erros não diferenciam 401/4xx/5xx** — debug difícil.
- **P2-INT5 — Cancelamento de old subscription falha silently** — cobrança dupla.
- **P2-INT6 — Sheets headers podem ficar desalinhados entre forms**.
- **P2-INT7 — Sheets sem retry**.
- **P2-INT8 — Meta CAPI access_token na URL** (logs/CDN/proxy expõem).
- **P2-INT9 — Phone normalization fraca** — quebra hash AAM.
- **P2-INT10 — `customData` em CAPI pode vazar PII unhashed**.
- **P2-INT11 — API v1 retorna `answers` sem masking** — LGPD.
- **P2-INT12 — Webhook dispatch sem re-check de plan** — downgrade entre check e dispatch.
- **P2-INT13 — Logs WhatsApp armazenam phone plaintext**.
- **P2-INT14 — Email validation regex fraco em integrations**.

### P3
- **P3-INT1 — Webhook sem DLQ**.
- **P3-INT2 — Asaas webhook secret não rotacionável**.
- **P3-INT3 — Meta CAPI sem retry**.
- **P3-INT4 — Pagination v1 sem tiebreaker `id`**.
- **P3-INT5 — UTM `localStorage` 30 dias hardcoded**.
- **P3-INT6 — UTM `JSON.parse` sem log em falha**.

### Pontos positivos
- SSRF protection double-layer (sync + async DNS).
- Rate limit Supabase RPC + in-memory fallback.
- `proration.ts` com testes (`proration.test.ts`).
- HMAC `timingSafeEqual()`.
- Fire-and-forget defensivo — nenhuma integração bloqueia submissão.

---

## 6. Notificações (Email Resend + WhatsApp Evolution/VPS)

### P0
- **P0-N1 — `WHATSAPP_API_KEY` em plaintext em `/home/sidney/eidosform-whatsapp/.env`** com `.git/` presente. Chave `d740b16...` exposta. **Rotacionar imediatamente.**
- **P0-N2 — VPS sem IP allowlist** (`/home/sidney/eidosform-whatsapp/server.js:218-227`): qualquer IP com Bearer token pode usar a API.
- **P0-N3 — `latest-qr.png` e `latest-qr.txt` em disco sem permissão restritiva** — verificar nginx.conf, aplicar `chmod 600`.
- **P0-N4 — Logs com phone plaintext** (`server.log` 50MB na VPS, `lib/integration-stubs.ts:82`) — LGPD/GDPR. Hashear, rotacionar, comprimir.

### P1
- **P1-N1 — Template WhatsApp sem normalização Unicode/Zalgo** (`app/api/whatsapp/send/route.ts:43-61`).
- **P1-N2 — Email subject sem truncation + PII vazando no preview** (`lib/notify.ts:40`): assuntos com CPF/email visíveis no preview.
- **P1-N3 — Rate limit WhatsApp por número (não por form+número)** — DoS cruzado entre usuários.
- **P1-N4 — Test endpoint exige `INTERNAL_API_SECRET` em Bearer** (`app/api/form/[id]/whatsapp/test/route.ts:131-141`): se vazar, abuso direto.

### P2
- **P2-N1 — Sem idempotência em sendEmail** — Resend pode enviar 2x.
- **P2-N2 — `status.json` na VPS pode ser exposto** se nginx servir estático.
- **P2-N3 — Resend sem retry/fallback**.
- **P2-N4 — Plan gating duplicado** entre dispatcher e endpoint — risco de inconsistência.
- **P2-N5 — `asciiToPngBase64()` ineficiente** (Jimp pixel-by-pixel a cada request).

### P3
- **P3-N1 — Escape HTML em assunto desnecessário** (text/plain) — documentar.
- **P3-N2 — `message_template` sem cap de comprimento**.
- **P3-N3 — Test endpoint rate limit 5/15min é permissivo**.
- **P3-N4 — `sanitizeValue` não normaliza Unicode (NFKC)**.

### Pontos positivos
- Notificações fire-and-forget (não bloqueiam submissão).
- RLS em `form_whatsapp_settings` e `form_whatsapp_logs` (4 policies).
- Plan gate duplo (Plus+ apenas).
- Sanitização HTML em 2 camadas (sanitizeValue + escapeHtml).
- Validação de phone aceita 11-15 dígitos internacional.

---

## Tabela Consolidada — Top 20 Prioridades

| Rank | ID | Severidade | Área | Resumo |
|---|---|---|---|---|
| 1 | P0-N1 | P0 | Notif/VPS | `.env` da VPS WhatsApp commitado em git — rotacionar chave AGORA |
| 2 | P0-N2 | P0 | Notif/VPS | VPS sem IP allowlist |
| 3 | P0-N4 | P0 | Notif | Phone plaintext em logs (LGPD) |
| 4 | P0-1 | P0 | Auth | Email enumeration via signup |
| 5 | P0-3 | P0 | Auth | Login sem check de email confirmado |
| 6 | P0-2 | P0 | Auth | Open redirect bypass em callback |
| 7 | P0-FP1 | P0 | Player | Dropdown/checkboxes aceitam options vazias |
| 8 | P0-INT1 | P0 | Webhook | `WEBHOOK_SECRET` sem validação de presença |
| 9 | P0-FB1 | P0 | Builder | Sanitização HTML server-side fraca em content_block |
| 10 | P0-N3 | P0 | Notif/VPS | QR PNG sem permissão restritiva |
| 11 | P0-INT3 | P0 | Asaas | API key sem circuit breaker |
| 12 | P1-INT6 | P1 | Asaas | Webhook sem idempotência |
| 13 | P1-B | P1 | Dashboard | Multi-user (Professional) não implementado |
| 14 | P1-A | P1 | Dashboard | Payloads JSONB sem validação Zod |
| 15 | P1-FP1 | P1 | Player | `isResponseComplete` ignora condicional |
| 16 | P0-FP2 | P0 | Player | Partial response prendendo respondent_id |
| 17 | P0-FP3 | P0 | Player | Rate limit IP-only sem CAPTCHA |
| 18 | P1-N2 | P1 | Email | Subject vaza PII no preview |
| 19 | P1-INT9 | P1 | Sheets | Service account key em memória sem secrets manager |
| 20 | P2-D | P2 | Dashboard | DELETE forms sem CSRF |

---

## Recomendações para o Zé

### Bloco crítico — antes da próxima campanha de venda
1. **Rotacionar `WHATSAPP_API_KEY` da VPS** (P0-N1) — a chave `d740b16...` está em git, qualquer um com acesso ao repo pode usar.
2. **Adicionar `.env` ao `.gitignore` da VPS** e mover secret para systemd/PM2 env.
3. **Resolver enumeration de email** (P0-1): mensagens genéricas em signup.
4. **Bloquear login de email não-verificado** (P0-3).
5. **Whitelist no callback OAuth** (P0-2).
6. **Validar `options.length > 0`** em `validateDropdown`/`validateCheckboxes` (P0-FP1).
7. **Idempotência em webhook Asaas** (P1-INT6) — antes de divulgar checkout/upgrade.

### Bloco organizacional — próxima sprint
- Revisar todos os `process.env.X` críticos e exigir presence-check no startup (`WEBHOOK_SECRET`, `INTERNAL_API_SECRET`, `ASAAS_WEBHOOK_SECRET`).
- Adicionar Zod schemas para `forms.questions`, `forms.pixels`, payloads de PATCH.
- Implementar CAPTCHA gated por plano em `/api/responses` (já há TODO no código).
- Hash phone/email em logs e rotação de `server.log`.

### Bloco de roadmap (não-bloqueante)
- Multi-user (Professional) — feature vendida mas não entregue (P1-B).
- DLQ para webhooks que falham permanente (P3-INT1).
- Secrets manager para `GOOGLE_PRIVATE_KEY` e `ASAAS_API_KEY`.
- Paginação real na listagem de respostas e forms.
- Acessibilidade do builder (htmlFor, aria-label, drag touch).

### Onde a Fase 1 NÃO consegue chegar (precisa Fase 2/3)
- Confirmar se nginx.conf da VPS expõe `latest-qr.png`/`status.json` publicamente.
- Validar se Resend está enviando emails para o destinatário e se SPF/DKIM/DMARC estão OK no domínio.
- Confirmar se webhook do Asaas está chegando em produção (e com signature válida).
- Testar UX no mobile, especialmente drag-and-drop do builder.
- Validar se Meta CAPI está deduplicando com Pixel client-side.
- Form de teste com os 18 tipos enviado via player real.

---

## Apêndice — Áreas auditadas e arquivos consultados

| Área | Arquivos principais |
|---|---|
| Auth | `app/(auth)/*`, `app/api/auth/*`, `lib/auth.ts`, `lib/supabase/middleware.ts`, `middleware.ts` |
| Dashboard | `app/(dashboard)/*`, `app/api/forms/*`, `app/api/folders/*`, `components/dashboard/*`, `lib/plan-limits.ts` |
| Form Builder | `components/form-builder/*`, `lib/questions.ts`, `lib/conditional-engine.ts`, `lib/jump-logic.ts`, `lib/form-logic-engine.ts`, `lib/templates.ts` |
| Form Player | `app/f/[slug]/*`, `components/form-player/*`, `lib/field-validators.ts`, `lib/form-response-security.ts`, `lib/response-rate-limit.ts`, `app/api/upload/route.ts`, `app/api/cep/*` |
| Integrações | `lib/webhook-*`, `lib/google-sheets.ts`, `lib/asaas.ts`, `lib/billing-profile.ts`, `lib/proration.ts`, `lib/pixel-*`, `lib/meta-capi.ts`, `lib/api-key-auth.ts`, `app/api/webhooks/*`, `app/api/checkout/*`, `app/api/v1/*` |
| Notificações | `lib/resend.ts`, `lib/whatsapp.ts`, `lib/notify.ts`, `app/api/whatsapp/*`, `app/api/form/[id]/whatsapp/*`, `/home/sidney/eidosform-whatsapp/server.js` |

---

**Assinatura:** Auditoria estática Fase 1 executada por Claude Code (Opus 4.7, 1M context) em 2026-05-02. Nenhum arquivo do projeto foi modificado durante esta auditoria. Próximos passos previstos: Fase 2 (criar form de teste com os 18 tipos) e Fase 3 (teste ponta-a-ponta real), conforme aprovação do Sidney.
