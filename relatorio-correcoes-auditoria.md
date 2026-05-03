# Relatório de Correções — Auditoria EidosForm

> Gerado em 2026-05-02. Atualizado continuamente por etapa.

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
