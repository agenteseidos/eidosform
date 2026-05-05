# Relatório de Correções — Auditoria EidosForm

> Gerado em 2026-05-02. Atualizado continuamente por etapa.
> **Última atualização:** 2026-05-04 — fechamento (Blocos H, I, J, K).

---

## Sumário Executivo

**Origem:** [auditoria-uso-fase1.md](auditoria-uso-fase1.md) (107 achados) + [auditoria-uso-fase2.md](auditoria-uso-fase2.md) (20 achados) + 1 achado extra (BUG-EXTRA-1) = **128 achados**.

**Resultado (atualizado 2026-05-04 após Blocos H/I/J/K):**
- ✅ **~115 resolvidos (90%)**
- ⏳ **1 em propagação DNS** — I1 (exclusão de MX aplicada, aguardando ~1h)
- ⚠️ **~12 pendentes** — todos P1/P2/P3 UX/cosméticos não-bloqueantes + K1 manual
- ❌ **1 recusado** — multi-user Professional (feature paga em hold)
- ✅ **2 aceitos por decisão de produto** — I2 (DMARC rua via inbox monitorada por agente), J2 form de teste (mantido como referência)

**Blocos completos:**
- **A — Fogo no telhado** (Etapas 1-3): ✅ código (1 fix `86c7e10`); DNS deslocado para Bloco I
- **B — Auth/Secrets** (Etapas 4-6): ✅ `66fc225`, `ead7d8a`
- **C — Validação/Schema** (Etapas 7-9): ✅ `e9f6c4d`, `23676e5`, `64c51b7`, `ea22276`
- **D — Operacional VPS** (Etapas 10-11): ✅ `d62c4e6`, `63e6da4` + manual logrotate
- **E — UX/Dashboard** (Etapas 12-14): ✅ `633a844`, `cbc40e3`, `a2113e4`
- **F — Integrações** (Etapas 15-17): ✅ `5bd97f2`, `b435fcd`, `09b871c`
- **G — P3 cleanup + regressão** (Etapas 18-19): ✅ `3ee83f7` (P3) + `regression-checklist.md` (smoke parcial)
- **H — VPS hardening final** (Etapas H1, H2): ✅ `87feca0`, `ee511aa`
- **I — DNS** (Etapas I1, I2): ⏳ I1 em execução (Sidney excluindo MX do apex em 2026-05-04); I2 ✅ aceito por decisão de produto (rua monitorado pelo Zé/OpenClaw)
- **J — Backlog** (Etapas J1-J3): ✅ J1 (`2a1da80` + migration aplicada), J2 ✅ (form mantido por decisão; contas já deletadas), J3 ✅
- **K — Encerramento** (K1-K3): ✅ smoke automático + tabelas finais nas auditorias + este sumário

**Riscos remanescentes:**
1. **K1 manual**: smoke test ponta-a-ponta com browser+auth+email+WhatsApp+checkout não foi rodado por agente (sem credenciais interativas) — Sidney deve percorrer `regression-checklist.md` em sessão browser autenticada.
2. **DNS I1**: aguardando propagação após exclusão do MX do apex (2026-05-04). Validar em ~1h via `dig +short MX eidosform.com.br` (esperado: vazio).

**Próxima auditoria sugerida:** Fase 3 ponta-a-ponta com conta de teste secundária (não-admin) cobrindo o fluxo Free → Plus → Professional + integração Asaas em sandbox + recebimento real de email/WhatsApp/webhook.

---

## Etapas Originais sem entrada formal (preenchidas em K3)

### Etapa 1 — Restaurar `/api/responses` (POST 500)

**Status:** ✅ Concluída em 2026-05-02
**Commits:** `1638b78`, `86c7e10`
**Achados endereçados:** F2-E4-01 (P0)
**Arquivos alterados:** [app/api/responses/route.ts](app/api/responses/route.ts), [lib/database.types.ts](lib/database.types.ts)
**O que foi feito:** causa raiz NÃO era coluna faltante (hipótese inicial do plano) — era `supabase.rpc` perdendo `this` binding por cast `as unknown as`. Fix removeu o cast e adicionou try/catch no POST com `logError` para visibilidade futura.
**Validação:** `curl -X POST /api/responses` com form inexistente retorna `404` (antes: `500`).
**Pendências:** nenhuma.

### Etapa 2 — Corrigir DNS (SPF + MX + DMARC)

**Status:** ⚠️ Parcial — SPF realocado para subdomínio Resend; MX e DMARC pendentes em I1/I2.
**Commits:** `21ca57b` (revert FROM_EMAIL para subdomínio verificado)
**Achados:** F2-E1-01 (✅ deslocado), F2-E1-02 (⚠️), F2-E1-03 (⚠️)
**O que foi feito:** Resend foi configurado para usar `send.eidosform.com.br` (subdomínio dedicado com SPF/DKIM próprios). DKIM e DMARC publicados no apex mas com pendências (rua → Gmail pessoal; MX não-null).
**Pendências:** ver `dns-changes-pending.md` — Bloco I.

### Etapa 3 — Smoke test ponta-a-ponta (validação A)

**Status:** ⚠️ Parcial — automated portion ✅, manual portion ⚠️.
**Achados:** validação dos blocos A.
**O que foi feito:** smoke automático via curl confirmou: CSRF block 403, signup body unificado, `/api/responses` 404 não-500, headers nginx WhatsApp.
**Pendências:** validação manual em browser autenticado (preencher form, receber email/WhatsApp, conferir webhook). Ver `regression-checklist.md` — Etapa K1.

### Etapa 10 — Hardening VPS WhatsApp

**Status:** ✅ Concluída (estendida em H1/H2)
**Commits:** `d62c4e6` (env_file), `63e6da4` (services/whatsapp/), `87feca0` (hashPhone), `ee511aa` (nginx headers)
**Achados endereçados:** F2-E1-04, F2-E1-05, F2-E1-06, F2-E1-07, F2-E1-08, F2-E1-09, P0-N4
**O que foi feito:** chmod 600 em `.env`, `.gitignore` criado, logrotate `/etc/logrotate.d/eidosform-whatsapp` aplicado, ecosystem usando `env_file` em vez de hardcoded, `services/whatsapp/` agora versionado no monorepo. Em H1: hashPhone SHA-256 nos logs; em H2: nginx HSTS/nosniff/Referrer-Policy.
**Pendências:** rotação manual da `WHATSAPP_API_KEY` recomendada (operação ainda não confirmada explicitamente).

### Etapa 11 — Validar Resend após DNS

**Status:** ✅ Concluída (parcial — webhook bounced/complained não criado)
**Commits:** `21ca57b`, `58704a1` (DKIM/SPF subdomínio)
**O que foi feito:** sender configurado em `noreply@eidosform.com.br` via subdomínio verificado `send.eidosform.com.br`; DKIM e SPF passam.
**Pendências:** validar manualmente em 3 inboxes diferentes (parte do K1).

### Etapa 18 — P3 + cleanup geral

**Status:** ✅ Concluída (cleanup de artefatos em J2 pendente)
**Commits:** `3ee83f7`
**Achados endereçados:** ~26 P3 (acessibilidade, pt-BR, PII logger, paginação, UTM logging)
**Arquivos alterados:** [components/form-builder/question-editor.tsx](components/form-builder/question-editor.tsx), [lib/logger.ts](lib/logger.ts), [lib/utm-tracker.ts](lib/utm-tracker.ts), múltiplas API routes.
**Pendências:** deletar form/contas de teste (J2 — `cleanup-test-artifacts-pending.md`).

### Etapa 19 — Auditoria de regressão final

**Status:** ⚠️ Parcial — checklist criado, smoke automatizável marcado; manual pendente.
**Commits:** `3ee83f7` (criação do checklist), `0a4c1bb` (smoke automático em K1)
**Pendências:** percorrer manualmente o `regression-checklist.md` em sessão autenticada.

---

## Etapas de fechamento (Blocos H, I, J, K — 2026-05-04)

### Etapa H1 — Hash SHA-256 de PII em logs WhatsApp

**Status:** ✅ Concluída em 2026-05-04
**Commits:** `87feca0`
**Achados endereçados:** F2-E1-08
**Arquivos alterados:** [services/whatsapp/server.js](services/whatsapp/server.js)
**O que foi feito:** helper `hashPhone()` (SHA-256, 8 hex chars). Substituídos todos os `log()` que continham `phone`/`cleaned`/`to`/`status.phoneNumber` cru. Telefone continua em texto apenas no comando `wacli send --to` (necessário para envio).
**Validação:** `grep` confirma 0 logs com phone bruto.

### Etapa H2 — Headers de segurança no nginx

**Status:** ✅ Concluída em 2026-05-04
**Commits:** `ee511aa` (código) + `nginx -t && systemctl reload nginx` aplicado em produção
**Achados endereçados:** F2-E1-06
**Arquivos alterados:** [services/whatsapp/nginx-updated.conf](services/whatsapp/nginx-updated.conf), `/etc/nginx/sites-available/eidosform-whatsapp-api` (sincronizado)
**O que foi feito:** adicionados `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`. Reload feito sem erro.
**Validação:** `curl -sI https://wpp.eidosform.com.br/api/whatsapp/health` retorna os 3 headers.

### Etapa I1 — Null MX no apex

**Status:** ⏳ Em execução (Sidney aplicando no painel DNS em 2026-05-04). Painel não aceitou destino `.` literal — decisão: **excluir** o registro MX do apex (efeito prático equivalente ao null MX). Aguardando propagação para validação via `dig`.
**Achado:** F2-E1-02
**Doc:** [dns-changes-pending.md](dns-changes-pending.md)

### Etapa I2 — DMARC `rua` em inbox dedicada

**Status:** ✅ Aceito por decisão de produto em 2026-05-04 — `rua` permanece em `agenteseidos@gmail.com`.
**Achado:** F2-E1-03
**Justificativa:** a inbox `agenteseidos@gmail.com` é monitorada pelo agente Zé (OpenClaw), que processa relatórios DMARC automaticamente e dispara alertas relevantes ao Sidney via WhatsApp/Telegram. Não é uma inbox "pessoal solta" — é uma inbox de operação assistida por agente. Risco residual aceitável (relatórios contêm apenas metadados de envio, e o domínio é não-receptivo após I1).

### Etapa J1 — Notificação DLQ por email

**Status:** ✅ Concluída em 2026-05-04 (migration aplicada em produção)
**Commits:** `2a1da80`
**Achado:** P3-INT1 (pendência declarada da Etapa 16)
**Arquivos alterados:** [lib/resend.ts](lib/resend.ts), [lib/webhook-dispatcher.ts](lib/webhook-dispatcher.ts), [supabase/migrations/20260504_webhook_failure_notifications.sql](supabase/migrations/20260504_webhook_failure_notifications.sql)
**O que foi feito:** após `insertDlq`, se ≥3 falhas em 7d para o `formId`, `maybeNotifyOwnerOfWebhookFailures` envia email único via `sendWebhookFailureAlert` (Resend + Idempotency-Key). Antispam: tabela `webhook_failure_notifications` com `last_notified_at` (1x/24h).
**Validação:** `npx tsc --noEmit` sem erros. Migration aplicada via SQL Editor do Supabase em 2026-05-04 — tabela `webhook_failure_notifications` criada com 2 políticas RLS confirmadas.

### Etapa J2 — Deletar artefatos de teste

**Status:** ✅ Concluída em 2026-05-04
**Confirmado em produção:**
- ✅ `/tmp/eidos-audit/` já não existe na VPS.
- ✅ Conta `eb2d9c6d-6119-47a2-9c5f-f9bbe95a89ec` (`naoexiste-1777754994294@audittestxyz.com`): já estava deletada (busca por email no Authentication panel não retornou nada).
- ✅ Conta `a4066c51-3c0c-43f3-85f0-7298d2091482`: já estava deletada (query SQL retornou 0 linhas).
- 🟡 Form `af8ea379-cea0-4471-b1ee-d63e2daffc19` (`[TESTE-AUDITORIA-2026-05-02]`): **mantido por decisão de produto** — Sidney optou por preservar como referência. Sem impacto: form está pausado no banco e não recebe tráfego.

### Etapa J3 — Atualizar `achados-extras.md`

**Status:** ✅ Concluída em 2026-05-04
**Commits:** `f8c62fb`
**O que foi feito:** BUG-EXTRA-1 (upload 413) marcado como ✅ resolvido com referência aos commits `5d26ff3`, `2ee2ead`, `fa0822f`, `0f8e851`.

### Etapa K1 — Smoke test ponta-a-ponta

**Status:** ⚠️ Parcial (automatizada ✅, manual ⚠️)
**Commits:** `0a4c1bb`
**Doc:** [regression-checklist.md](regression-checklist.md)
**Validações automatizadas (4):** CSRF block 403, signup body unificado, `/api/responses` 404, nginx headers WhatsApp.
**Pendentes:** dashboard, 18 tipos de pergunta, billing/checkout, integrações reais (email/WhatsApp/webhook), acessibilidade builder. Sidney executa em browser autenticado.

### Etapa K2 — Marcar achados nas auditorias originais

**Status:** ✅ Concluída em 2026-05-04
**Commits:** `009ecd2`
**Arquivos:** [auditoria-uso-fase1.md](auditoria-uso-fase1.md), [auditoria-uso-fase2.md](auditoria-uso-fase2.md)
**O que foi feito:** tabela "Status Final dos Achados" no topo de cada arquivo mapeando `achado → status → etapa → commit`. 127 achados classificados.

### Etapa K3 — Sumário e fechamento do relatório

**Status:** ✅ Concluída em 2026-05-04
**O que foi feito:** este próprio sumário executivo + entradas formais para etapas 1, 2, 3, 10, 11, 18, 19 que faltavam. Riscos remanescentes e próxima auditoria documentados.

---

## Etapas originalmente registradas no relatório

> Mantidas abaixo na ordem original. Re-revisadas em K2/K3 — nenhuma marca alterada.

---

## Etapa 15 — Idempotência e correções no webhook Asaas (entrada)

**Status:** ✅ Concluída em 2026-05-03
**Commits:** 5bd97f2
**Achados endereçados:** P1-INT3, P1-INT4, P1-INT5, P1-INT6, P1-INT7, P1-INT8, P0-INT2
**Arquivos alterados:**
- `lib/webhook-hmac.ts`
- `app/api/webhooks/asaas/route.ts`
- `supabase/migrations/20260503_asaas_webhook_idempotency.sql`

**O que foi feito:**
- `webhook-hmac.ts`: substituído `URLSearchParams` por parser custom que faz split em `&` e `=` sem URL-decode — evita corrupção de hex-hashes (P1-INT3)
- Removida tolerância de `age < -30_000`: apenas timestamps no passado são aceitos (P1-INT4)
- Removido token fallback em `route.ts`: apenas HMAC-SHA256 é aceito via `asaas-signature` header (P1-INT5)
- Criada tabela `asaas_webhook_events (event_id unique)` e função `checkAndMarkIdempotent()`: evento duplicado retorna 200 sem reprocessar (P1-INT6)
- `default` case do switch agora chama `logWarn()` com o evento desconhecido (P1-INT7)
- `logWebhookEvent` chamadas removidas do campo `payload` (P1-INT8)
- `PAYMENT_OVERDUE` já tinha guard de subscription mismatch; confirmado correto (P0-INT2)

**Validação:** tsc sem erros nos arquivos alterados. Lógica testada por inspeção de código.
**Pendências dentro da etapa:** nenhuma.

---

## Etapa 16 — Webhooks de saída (HMAC, retry, SSRF)

**Status:** ✅ Concluída em 2026-05-03
**Commits:** b435fcd
**Achados endereçados:** P0-INT1, P1-INT1, P1-INT2, P2-INT1, P2-INT2, P3-INT1
**Arquivos alterados:**
- `lib/webhook-dispatcher.ts`
- `lib/webhook-validator.ts`
- `lib/webhook-logger.ts`
- `supabase/migrations/20260503_webhook_failures_dlq.sql`

**O que foi feito:**
- `WEBHOOK_SECRET` obrigatório: dispatcher retorna erro imediato sem ele (P0-INT1)
- `fixedTimestamp` gerado uma vez fora do loop de retry; assinatura também gerada uma única vez (P1-INT2)
- `canonicalJson()` ordena chaves recursivamente para HMAC determinístico entre retries (P1-INT2)
- `webhook-logger.ts`: campo `payload` agora armazena apenas metadados (`meta?: Record<...>`) — nunca payload completo (P1-INT1)
- `webhook-validator.ts`: DNS race fix — se DNS disponível mas resolução retorna array vazio (NXDOMAIN/timeout), bloqueia. Edge Runtime (sem módulo `dns`) ainda permite por best-effort (P2-INT2)
- Criada tabela `webhook_failures` (DLQ) com RLS; `insertDlq()` chamado após 4 retries falharem (P3-INT1)

**Validação:** tsc sem erros nos arquivos alterados.
**Pendências dentro da etapa:** notificação por email ao owner após N falhas no DLQ não implementada (registrado no DLQ mas sem envio automático — pode ser adicionado na Etapa 18/G).

---

## Etapa 17 — Notificações (Resend + WhatsApp): hardening

**Status:** ✅ Concluída em 2026-05-03
**Commits:** 09b871c
**Achados endereçados:** P1-N1, P1-N2, P1-N3, P2-N1, P2-N4
**Arquivos alterados:**
- `lib/resend.ts`
- `app/api/whatsapp/send/route.ts`

**O que foi feito:**
- `sanitizeSubject()`: remove CPF, email e telefone do assunto por regex; trunca em 50 chars (P1-N1)
- `sendEmailWithRetry()`: 3 tentativas com backoff 1s/5s/10s substituindo chamada direta ao fetch (P2-N1)
- `Idempotency-Key` header em `sendNewResponseNotification` = `sha256(new-response:{formId}:{responseId})` (P2-N3)
- `buildMessage()`: aplica `String.normalize('NFKC')` em todos os valores substituídos no template WhatsApp (P1-N2)
- `checkWhatsAppRateLimit()` aceita `formId` opcional e usa chave `whatsapp:{formId}:{phone}` em vez de `whatsapp:{phone}` — formulários distintos não compartilham quota (P1-N3)
- Plan gate já consolidado em `/api/whatsapp/send`; nenhum check duplicado no dispatcher (P2-N4)

**Validação:** tsc sem erros nos arquivos alterados.
**Pendências dentro da etapa:** retry Resend (3x com backoff) implementado; P1-N4 (retry) ✅. P2-N3 (idempotency key) ✅.

---

## Etapa 4 — Endurecimento do signup (email enumeration)

**Status:** ✅ Concluída em 2026-05-02 21:40
**Achados endereçados:** F2-E5-01, P0-1 (Fase 1)
**Arquivos alterados:**
- `app/api/auth/signup/route.ts`
- `app/(auth)/register/page.tsx`

**O que foi feito:**
- Removido campo `autoConfirmed` do body de retorno do POST `/api/auth/signup`. Antes, novos cadastros retornavam `{ success: true, autoConfirmed: false/true, message: ... }` enquanto emails duplicados retornavam `{ success: true, message: ... }` — a presença/ausência do campo permitia enumerar se o email já estava cadastrado.
- Agora ambos os casos retornam exatamente `{ success: true, message: 'Verifique seu email para confirmar.' }`.
- Atualizado `register/page.tsx` para sempre redirecionar para `/verify-email` ao invés de bifurcar em `/dashboard` quando `autoConfirmed` era `true`.

**Validação:** Body idêntico para email novo e email já registrado (201 em ambos os casos, sem campo diferenciador).

**Pendências dentro da etapa:** nenhuma.

---

## Etapa 5 — Login: bloquear email não-confirmado + slimmar response

**Status:** ✅ Concluída em 2026-05-02 (commit 66fc225)
**Achados endereçados:** P0-3 (Fase 1), F2-E2-01
**Arquivos alterados:**
- `app/api/auth/login/route.ts`
- `app/(auth)/login/page.tsx`

**O que foi feito:**
- Após `signInWithPassword` com sucesso, o endpoint checa `data.user?.email_confirmed_at`. Se nulo, faz `signOut()` imediato e retorna `403 { error: 'Confirme seu email antes de entrar.', code: 'EMAIL_NOT_CONFIRMED' }`.
- Response de sucesso reduzido a `{ success: true, redirectTo: '/forms' }` — objeto `user` completo não é mais exposto.
- Frontend (`login/page.tsx`): ao receber `code: 'EMAIL_NOT_CONFIRMED'`, mostra toast explicativo e dispara `POST /api/auth/resend-verification` (fire-and-forget) para reenviar o link.

**Validação:** login com email não confirmado retorna 403; login bem-sucedido retorna 200 apenas com `success + redirectTo`.

**Pendências dentro da etapa:** nenhuma.

---

## Etapa 6 — Remover CSRF skip de `/api/auth/*`


**Status:** ✅ Concluída em 2026-05-02 (commit 66fc225)
**Achados endereçados:** F2-E5-02, P2-6 (Fase 1)
**Arquivos alterados:**
- `middleware.ts`

**O que foi feito:**
- `publicWritePaths` foi reduzido a `['/api/responses']`. Rotas `/api/auth/*` não têm mais bypass de CSRF.
- Qualquer POST para `/api/auth/login`, `/api/auth/signup` etc. com `Origin` fora de `ALLOWED_ORIGINS` recebe `403 { error: 'Forbidden' }`.
- Domínios customizados verificados (`isVerifiedCustomDomain`) mantêm bypass apenas para `/api/responses` (necessário para embeds de forms).

**Validação:** `curl -X POST -H 'Origin: https://attacker.example.com' .../api/auth/login` retorna `403`.

**Pendências dentro da etapa:** nenhuma.

---

## Etapa 7 — Validação Zod em forms (POST + PATCH)

**Status:** ✅ Concluída em 2026-05-02 (commit e9f6c4d)
**Achados endereçados:** P1-A (Fase 1), P0-FB1 (routes)
**Arquivos alterados:**
- `lib/schemas/form-schema.ts` (novo)
- `app/api/forms/route.ts`
- `app/api/forms/[id]/route.ts`

**O que foi feito:**
- Criado `lib/schemas/form-schema.ts` com `QuestionSchema` (discriminated union por tipo, 18 tipos), `FormCreateSchema`, `FormUpdateSchema` e `formatZodIssues`.
- Campos URL validados por `optionalSafeUrl` (bloqueia `javascript:`, `data:`, `blob:`, `ws:`, `wss:`, `file:`).
- POST `/api/forms` e PATCH `/api/forms/[id]` chamam `safeParse()` antes das regras de negócio. Erros retornam `400 { error: 'Payload inválido', issues: [...] }`.
- Payload com `type: "evil_type"` retorna 400.

**Validação:** payloads inválidos rejeitados com 400 + issues detalhados; payloads válidos seguem normalmente.

**Pendências dentro da etapa:** nenhuma.

---

## Etapa 8 — Endurecer validators server-side

**Status:** ✅ Concluída em 2026-05-02 (commit 23676e5)
**Achados endereçados:** P0-FP1 (Fase 1), P2-FB3, P2-FB4, P2-FB6, P2-FB7 (Fase 1), P1-FP3
**Arquivos alterados:**
- `lib/field-validators.ts`

**O que foi feito:**
- `validateDropdown` / `validateCheckboxes`: rejeitam quando `options.length < 2` (pergunta mal configurada).
- `validateRating` / `validateOpinionScale`: guarda explícita `min >= max` antes de chamar `validateRange`.
- `validateNumber`: cap em `±Number.MAX_SAFE_INTEGER`.
- `validateFileUpload`: recebe `question.maxFileSize`; cap hard em 25 MB; mensagem de erro com o limite exato.
- `validateCalendly`: rejeita quando `required: true` e `calendlyUrl` não configurado.

**Validação:** cada edge case gera `{ valid: false, error: '...' }` com mensagem clara.

**Pendências dentro da etapa:** nenhuma.

---

## Etapa 9 — Sanitização HTML server-side em content_block

**Status:** ✅ Concluída em 2026-05-02 (commit 64c51b7)
**Achados endereçados:** P0-FB1 (Fase 1), P1-FB1, P1-FB2
**Arquivos alterados:**
- `lib/html.ts`
- `app/api/forms/route.ts` (via Etapa 7 commit)
- `app/api/forms/[id]/route.ts` (via Etapa 7 commit)

**O que foi feito:**
- `lib/html.ts` substituído por pipeline DOMPurify + jsdom no server. Whitelist conservadora: `p, br, strong, em, b, i, u, s, a, ul, ol, li, h1-h3, blockquote, pre, code, span`.
- `isSafeUrl` bloqueia `blob:`, `ws:`, `wss:`, `file:` além dos esquemas já bloqueados.
- Belt-and-braces: `href` de âncoras re-validado por regex pós-sanitização.
- `sanitizeContentBlocks()` aplicado em POST e PATCH antes de persistir.
- Player mantém DOMPurify client-side como defense-in-depth.

**Validação:** payload com `<script>alert(1)</script>` em `contentBody` é sanitizado para string vazia; `javascript:` em href vira `href="#"`.

**Pendências dentro da etapa:** nenhuma.

---

## Etapa 12 — Indicador de plano/quota no dashboard

**Status:** ✅ Concluída em 2026-05-03
**Commits:** 633a844
**Achados endereçados:** F2-E2-02 (P2), P2-A (Fase 1)
**Arquivos alterados:**
- `components/dashboard/plan-quota-card.tsx` (novo)
- `app/(dashboard)/forms/page.tsx`

**O que foi feito:**
- Criado componente `<PlanQuotaCard>` renderizado no topo de `/forms`.
- Exibe: nome do plano, barra de progresso de respostas (usadas/limite), contagem de formulários (usados/limite).
- Barra muda de cor: azul → âmbar aos 80% → vermelho aos 90%.
- Card de upsell (link para `/billing`) aparece quando `responsePct >= 80%`.
- Dashboard page busca `plan`, `responses_used`, `responses_limit` da tabela `profiles` e passa ao componente.

**Validação:** componente renderiza sem erros de TypeScript; lógica de upsell condicional verificada.

**Pendências dentro da etapa:** nenhuma.

---

## Etapa 13 — Corrigir player UX

**Status:** ✅ Concluída em 2026-05-03
**Commits:** cbc40e3
**Achados endereçados:** F2-E3-02 (P2), F2-E4-02 (P1), P3-FP4 (Fase 1)
**Arquivos alterados:**
- `components/form-player/form-player.tsx`

**O que foi feito:**
- **Contador de perguntas:** substituído `{currentIndex + 1} de {visibleQuestions.length}` por posição e total entre perguntas não-`content_block` (`currentQuestionNumber` / `visibleNonContentCount`). Removida anotação `({questionCount} total)`.
- **Hint Ctrl+Enter:** hint renderiza "Ctrl+Enter ↵" quando `currentQuestion.type === 'long_text'`, "Enter ↵" nos demais.
- **scrollIntoView em erro:** adicionado `errorRef` e `useEffect` que chama `scrollIntoView({behavior:'smooth', block:'center'})` na `motion.p` do erro quando este aparece.

**Validação:** TypeScript passa sem erros nos arquivos modificados.

**Pendências dentro da etapa:** nenhuma.

---

## Etapa 14 — Corrigir bug "Profile not found" no API Key e 404 em GET /api/forms/{id}

**Status:** ✅ Concluída em 2026-05-03
**Commits:** a2113e4
**Achados endereçados:** F2-E6-01 (P2), F2-E3-01 (P1)
**Arquivos alterados:**
- `app/api/settings/api-key/route.ts`
- `app/api/forms/[id]/route.ts`

**O que foi feito:**
- **API Key GET:** quando upsert do perfil faltante falha, retorna `200 {has_api_key: false, plan: 'free'}` em vez de `404 "Profile not found"`. Frontend exibirá botão "Gerar API Key" corretamente.
- **GET /api/forms/[id]:** removida lista fixa de colunas (incluía `plan` que não existe na tabela `forms`) substituída por `select('*')`. Erros de BD agora distinguidos de "not found": `PGRST116` → 404; outros → 500 + `logError`.

**Validação:** TypeScript passa sem erros; separação de erros elimina falsos 404 por coluna inexistente.

**Pendências dentro da etapa:** nenhuma.
