# Auditoria de Uso do SaaS EidosForm — Fase 1 (Estática / Somente Leitura)

**Data:** 2026-05-18
**Escopo:** Revisão estática de código (sem execução, sem alterações). Repositório `agenteseidos/eidosform`, branch `main`.
**Método:** Leitura de código de `/app`, `/lib`, `/components`, `/services`, `/supabase/migrations`; `npx tsc --noEmit` (OK, exit 0); `npm run lint` (somente warnings + erros de `require()` em arquivo CommonJS legado); `npx vitest run` (testes individuais passam — ex. `webhook-hmac.test.ts` 11/11 — mas a suíte completa trava/expira, ver P2-12).

> ⚠️ Esta auditoria **não corrigiu nada**. Cada achado traz uma sugestão de correção *descrita*, não aplicada.

---

## 1. Resumo Executivo

| Severidade | Qtd | Definição |
|------------|-----|-----------|
| **P0** — Crítico | 1 | Quebra grave ou vulnerabilidade séria explorável |
| **P1** — Alto | 6 | Falha de segurança/lógica com impacto relevante |
| **P2** — Médio | 9 | Bug/inconsistência com impacto moderado |
| **P3** — Baixo/Cosmético | 7 | Comentário enganoso, código morto, melhoria |
| **Total** | **23** | |

Destaque: o tipo de pergunta **`html_block`** renderiza HTML do dono do formulário *sem nenhuma sanitização* no player público — XSS armazenado contra respondentes (P0-1). A maior parte das rotas de API já tem boas defesas (rate limit, validação Zod, feature gating, RLS endurecido, SSRF guard em webhooks, idempotência no webhook Asaas), o que reduz bastante a superfície. Os achados P1 concentram-se em **inconsistências entre o endpoint público `/api/responses` e o endpoint `/api/v1/forms/[id]`** (autorização, atomicidade do limite de respostas) e em **gating de plano por expiração lazy**.

---

## 2. Achados P0 — Crítico

### P0-1 — `html_block` renderiza HTML não sanitizado no player público (XSS armazenado)
**Arquivos:**
- `components/form-player/question-renderer.tsx:523` e `:539` — `const html = question.htmlContent?.trim()` … `<div dangerouslySetInnerHTML={{ __html: html }} />`
- `lib/database.types.ts:95` — comentário explícito: `htmlContent?: string // Raw HTML for html_block type (rendered as-is, no sanitization)`
- `lib/schemas/form-schema.ts:182-184` — Zod aceita `htmlContent` como string livre até 50 000 chars
- `lib/field-validators.ts:95-97` — validador backend de `html_block` retorna `{ valid: true }` sem inspecionar conteúdo
- `app/api/forms/route.ts:151` e `app/api/forms/[id]/route.ts:296` — `sanitizeContentBlocks` só trata `type === 'content_block'`, **nunca** `html_block`

**Problema:** O dono do formulário cola HTML/embed arbitrário em `htmlContent`. Esse conteúdo é persistido sem sanitização (nenhuma das funções `sanitizeContentBlocks`/`sanitizeContentBlocksServer` toca `html_block`) e renderizado *cru* via `dangerouslySetInnerHTML` no player público `/f/[slug]`. A CSP de `/f/:slug` (`embeddableFormHeaders` em `next.config.ts`) permite `script-src 'self' 'unsafe-inline'`, então tanto `<script>` inline quanto handlers `onload=`/`onerror=` injetados executam.

**Impacto:** Stored XSS executando no contexto de `eidosform.com.br` (ou do domínio personalizado) no navegador de **todos os respondentes** do formulário. Permite: phishing dentro do formulário, captura de cliques/teclas, exfiltração de respostas digitadas, redirecionamento. Como `html_block` está disponível em **todos os planos** (não há feature gate), qualquer usuário cadastrado — inclusive plano free — pode publicar um formulário malicioso. O recurso é "by design" para embeds (Calendly/YouTube/Maps), mas a implementação atual não distingue embed legítimo de script malicioso.

**Sugestão de correção (descrita):**
1. Sanitizar `htmlContent` no servidor antes de persistir, usando uma allowlist restrita voltada a embeds: permitir apenas `<iframe>` (com allowlist de `src` por host — calendly.com, youtube.com, google.com/maps, etc.), além das tags de formatação já permitidas em `ALLOWED_TAGS`. Bloquear `<script>`, `<object>`, `<embed>`, e todos os atributos `on*`.
2. Aplicar a mesma sanitização no render (`HtmlBlockQuestion`) como defesa em profundidade — hoje `content_block` já passa por `sanitizeHtml`; `html_block` deveria passar por uma variante `sanitizeEmbedHtml`.
3. Alternativamente, restringir o campo a "URL de embed" + tipo, em vez de HTML livre, eliminando a superfície.
4. Considerar feature-gate de `html_block` para planos pagos enquanto a sanitização não existir (reduz exposição, não elimina).

---

## 3. Achados P1 — Alto

### P1-1 — `/api/v1/forms/[id]` permite sequestrar resposta anônima (autorização mais fraca que `/api/responses`)
**Arquivo:** `app/api/v1/forms/[id]/route.ts:285-291`
```ts
const bodyRespondentId = typeof body.respondent_id === 'string' ? body.respondent_id : null
if (existingResponse.respondent_id && existingResponse.respondent_id !== bodyRespondentId) {
  return ... 403
}
```
**Problema:** A verificação só rejeita quando `existingResponse.respondent_id` **existe** e diverge. Se a resposta foi criada sem `respondent_id` (anônima), `existingResponse.respondent_id` é `null` e a condição é falsa → o update prossegue. O endpoint público `/api/responses` (`route.ts:258-263`) foi corrigido (P1-A) para exigir que **ambos** os `respondent_id` existam e coincidam; o endpoint v1 não recebeu o mesmo fix.
**Impacto:** Possuindo uma chave de API válida (plano Professional) e um `response_id` de resposta anônima, é possível sobrescrever respostas anônimas de qualquer formulário do próprio usuário. Risco limitado a forms do dono da chave, mas ainda é uma falha de integridade que diverge do contrato esperado.
**Sugestão:** Espelhar a lógica de `/api/responses`: rejeitar quando `!existingResponse.respondent_id || existingResponse.respondent_id !== bodyRespondentId`.

### P1-2 — `/api/v1/forms/[id]` usa checagem de limite de respostas **não atômica** (TOCTOU)
**Arquivo:** `app/api/v1/forms/[id]/route.ts:257-265` e `:338`
**Problema:** O endpoint v1 chama `checkResponseLimit()` (lê `responses_used`) e depois, separadamente, `incrementResponseCount()` (RPC `increment_responses_used`). Entre as duas chamadas há uma janela de corrida. O endpoint público `/api/responses` foi corrigido para usar a RPC atômica `check_and_increment_response` (`plan-limits.ts:86`, `responses/route.ts:232`). O v1 ficou com o padrão antigo check-then-increment.
**Impacto:** Sob concorrência, um usuário pode ultrapassar o limite de respostas do plano via API v1. Além disso, `incrementResponseCount` roda fora de transação e com `.catch()` silencioso — falha de incremento não bloqueia a resposta, podendo subcontar.
**Sugestão:** Usar `checkAndIncrementResponseCount` (RPC atômica) também no endpoint v1, idêntico a `/api/responses`.

### P1-3 — Gating de plano no player público não considera expiração (`plan_expires_at`)
**Arquivos:** `app/api/responses/route.ts:316-322` (lê `ownerProfile.plan` direto); `app/f/[slug]/page.tsx:109,116` e `app/api/forms/[id]/plan/route.ts:39` (idem); enforcement de expiração só em `app/api/user/plan-features/route.ts:29-67`.
**Problema:** A reversão de plano expirado para `free` é **lazy** — só ocorre quando o usuário autenticado abre `/api/user/plan-features` (dashboard). O player público, a submissão de respostas, o disparo de webhook/email/WhatsApp/pixels e o `fetchOwnerPlan` leem a coluna `profiles.plan` crua, sem comparar com `plan_expires_at`.
**Impacto:** Se o webhook do Asaas (`PAYMENT_OVERDUE`/`SUBSCRIPTION_DELETED`) for perdido ou atrasar, um usuário com plano pago **expirado** continua recebendo features pagas (webhooks, notificações, pixels, respostas acima do limite free) indefinidamente, enquanto não acessar o dashboard. Vazamento de receita / quebra de gating.
**Sugestão:** Centralizar a resolução de plano efetivo numa função (`getEffectivePlan(profile)`) que retorne `free` quando `plan_expires_at < now`, e usá-la em `/api/responses`, `app/f/[slug]/page.tsx` e `/api/forms/[id]/plan`. Idealmente, um job agendado também deveria reverter planos expirados proativamente.

### P1-4 — `validateFileUpload` aceita qualquer URL `https://`, anulando o prefixo de storage
**Arquivo:** `lib/field-validators.ts:282-288`
```ts
if (!obj.url.startsWith(allowedPrefix) && !obj.url.startsWith('https://') && !obj.url.startsWith('http://')) {
  return { valid: false, error: 'URL do arquivo inválida' }
}
```
**Problema:** A condição é uma disjunção: a URL é considerada válida se começar com o prefixo do bucket **OU** com `https://` **OU** com `http://`. Como qualquer URL HTTP(S) satisfaz a segunda/terceira cláusula, a restrição ao bucket `form-uploads` é efetivamente inútil. Um respondente pode submeter um `file_upload` apontando para qualquer URL externa.
**Impacto:** O dono do formulário, ao abrir a resposta no dashboard ou ao receber a URL via webhook/Sheets, recebe uma URL controlada pelo respondente — vetor de phishing, tracking pixel, ou conteúdo malicioso disfarçado de "anexo do lead". Também permite que o `name` (string sanitizada de tags, mas não validada) seja qualquer texto.
**Sugestão:** Trocar a lógica para exigir que a URL **comece com o prefixo do bucket público** (`${SUPABASE_URL}/storage/v1/object/public/form-uploads/`) — e nada mais. Aceitar `http://` deve ser removido de qualquer forma.

### P1-5 — `reset-password` aceita qualquer sessão autenticada, não só sessão de recovery
**Arquivos:** `app/api/auth/reset-password/route.ts:16-17`; `app/auth/callback/route.ts:18-19`
**Problema:** `POST /api/auth/reset-password` chama `supabase.auth.updateUser({ password })` para "qualquer" sessão presente nos cookies. O fluxo pretendido é: link de recovery → `/auth/callback` troca o code por sessão → redireciona para `/reset-password`. Mas o endpoint não verifica que a sessão atual veio de um fluxo de *recovery* (`AAL`/`amr`), nem exige reautenticação. Qualquer sessão válida (ex.: usuário logado normalmente) que faça POST nesse endpoint troca a própria senha sem informar a senha atual.
**Impacto:** Menor que parece — exige sessão já válida do próprio usuário (não é escalonamento entre contas). O risco real é: numa máquina compartilhada/sessão sequestrada, atacante troca a senha sem conhecer a senha atual (o `change-password` exige reautenticação; o `reset-password` não). Também: se um atacante conseguir levar a vítima logada a visitar uma página que dispara esse POST, é CSRF de troca de senha — porém o middleware exige `Origin` correto (P1-13/CSRF), o que mitiga.
**Sugestão:** Em `reset-password`, validar que a sessão tem `amr`/origem de recovery (ou exigir o token de recovery no body em vez de confiar no cookie). No `callback`, só estabelecer sessão de escopo "recovery" para `type=recovery`.

### P1-6 — `answer_items`: política RLS de INSERT anônimo é `WITH CHECK (true)`
**Arquivo:** `supabase/migrations/20260501_enforce_rls_final_state.sql` (policy `anon_insert_answer_items`)
```sql
CREATE POLICY "anon_insert_answer_items" ON answer_items
  FOR INSERT TO anon WITH CHECK (true);
```
**Problema:** Diferente de `responses` (cujo INSERT anônimo exige que o `form_id` aponte para um form `published`), o INSERT anônimo em `answer_items` não tem nenhuma verificação — qualquer cliente com a anon key pode inserir linhas arbitrárias em `answer_items` para qualquer `response_id` (inclusive inexistente, se não houver FK estrita, ou de respostas de outros).
**Impacto:** Poluição de dados de analytics. Um atacante pode injetar `answer_items` falsos em respostas de qualquer formulário, distorcendo relatórios. A aplicação em si insere via `service_role`, então o caminho anônimo direto é abuso puro. Severidade limitada por exigir conhecer/forjar `response_id`s (UUIDs).
**Sugestão:** Restringir a `WITH CHECK` a `EXISTS (SELECT 1 FROM responses r JOIN forms f ON f.id=r.form_id WHERE r.id = answer_items.response_id AND f.status='published')`, ou — preferível — remover totalmente o INSERT anônimo, já que a aplicação só insere via `service_role`.

---

## 4. Achados P2 — Médio

### P2-1 — Plano `enterprise` referenciado mas inexistente em `PLANS`/`PLAN_ORDER`
**Arquivos:** `lib/api-key-auth.ts:58` (`plan !== 'professional' && plan !== 'enterprise'`); `app/api/settings/api-key/route.ts:23,133` (mesma checagem); `app/api/v1/forms/[id]/route.ts` usa `PlanName`.
**Problema:** `PLAN_ORDER` em `lib/plans.ts` é `['free','starter','plus','professional']` — não há `enterprise`. As checagens que aceitam `'enterprise'` são código morto/inconsistente; se algum dia uma linha `profiles.plan = 'enterprise'` existir (ex.: ajuste manual no banco), `PLANS['enterprise']` é `undefined` e o gating quebra silenciosamente (`PLANS[plan]?.webhooks` → `undefined` → falsy).
**Impacto:** Baixo hoje (nenhum usuário enterprise), mas é uma inconsistência que pode causar bugs sutis. A constraint `20260328_add_plan_constraint.sql` provavelmente nem permite `enterprise`.
**Sugestão:** Remover as referências a `'enterprise'` ou adicionar o plano formalmente a `PLANS`/`PLAN_ORDER` se ele existir no roadmap.

### P2-2 — `isResponseComplete` diverge entre `/api/responses` e a lib compartilhada (`content_block`)
**Arquivos:** `app/api/responses/route.ts:84` (`q.required && q.type !== 'content_block'`) vs. `lib/form-response-security.ts:32` (`questions.filter((q) => q.required)` — **sem** excluir `content_block`).
**Problema:** O endpoint v1 (`/api/v1/forms/[id]/route.ts:255`) usa a versão de `form-response-security.ts`, que considera `content_block` obrigatório como campo a preencher. Como `content_block`/`html_block` não capturam valor real (ou capturam `'viewed'`), uma pergunta `content_block` marcada `required:true` faz `isResponseComplete` retornar `false` permanentemente no caminho v1.
**Impacto:** Respostas submetidas via API v1 podem nunca ser marcadas `completed`, deixando de disparar webhooks e de aparecer em listagens filtradas por `completed=true` (`v1 .../route.ts:83`).
**Sugestão:** Unificar: a lib compartilhada deve excluir `content_block` (e `html_block`) igual ao `/api/responses`. Idealmente eliminar a duplicação e ter uma única função.

### P2-3 — `MAX_PAYLOAD_BYTES` é 50 KB, mas o comentário diz "1MB"
**Arquivo:** `app/api/responses/route.ts:20-21`
```ts
// Maximum payload size (1MB — covers long text forms with URLs; file uploads go to R2)
const MAX_PAYLOAD_BYTES = 50 * 1024
```
**Problema:** O valor real (50 KB) contradiz o comentário. Um formulário longo com vários campos `long_text` (validados até 10 000 chars cada em `field-validators.ts:138`) facilmente estoura 50 KB e recebe HTTP 413.
**Impacto:** Respostas legítimas de formulários extensos podem ser rejeitadas. Confusão de manutenção.
**Sugestão:** Decidir o limite real e alinhar comentário e constante (`lib/form-response-security.ts:3` tem a mesma constante 50 KB — manter coerente).

### P2-4 — Assinatura HMAC do webhook usa `created_at` no payload, mas envia `X-EidosForm-Timestamp` separado e não assinado
**Arquivo:** `lib/webhook-dispatcher.ts:194-209,231`
**Problema:** O `payload.created_at` é gerado na linha 198; a assinatura HMAC cobre `bodyStr` (que inclui `created_at`). Em seguida, na linha 209, gera-se um `fixedTimestamp` *novo* (`new Date().toISOString()`), enviado no header `X-EidosForm-Timestamp` (linha 231). Esse header **não faz parte do HMAC**, então o consumidor não consegue verificar sua autenticidade nem usá-lo para defesa de replay. Os dois timestamps também divergem entre si.
**Impacto:** Consumidores que confiem no `X-EidosForm-Timestamp` para anti-replay estão verificando um valor não assinado (forjável). Inconsistência semântica.
**Sugestão:** Assinar o timestamp (incluí-lo no que entra no HMAC, ex.: `HMAC(timestamp + "." + body)`) e documentar para os consumidores; ou remover o header e instruir o uso de `payload.created_at`.

### P2-5 — `sign-url` não aplica o `maxFileSize` configurado por pergunta
**Arquivo:** `app/api/upload/sign-url/route.ts:8,63`
**Problema:** O endpoint que gera a URL assinada valida apenas o limite global `MAX_SIZE = 10MB`. O `field-validators.ts:291` valida o `maxFileSize` por pergunta (cap em 25 MB), mas isso só roda na submissão final. O `sign-url` não recebe o `question_id`, então não consegue aplicar o limite específico — e como o upload vai direto navegador→Storage, nada impede subir até 10 MB mesmo se a pergunta limita a 2 MB.
**Impacto:** Limite por pergunta é apenas cosmético no upload; arquivos acima do limite configurado chegam ao Storage (e só são rejeitados na validação da resposta — mas o arquivo já foi armazenado, consumindo storage).
**Sugestão:** Passar `question_id` para `sign-url`, buscar o `maxFileSize` da pergunta e validar `size` contra ele antes de assinar.

### P2-6 — `partial-response` PUT não valida tamanho de payload, nº de chaves nem coerência com as perguntas
**Arquivo:** `app/api/forms/[id]/partial-response/route.ts:155-168`
**Problema:** Diferente de `/api/responses` (que aplica `MAX_PAYLOAD_BYTES`, `MAX_ANSWER_KEYS` e `validateAllAnswers`), o PUT de partial-response só faz `sanitizeValue` e checa que `answers` é objeto. Não há limite de tamanho nem validação de tipos de campo.
**Impacto:** Um usuário autenticado pode gravar `answers` arbitrariamente grandes em `responses` (linha 187/205), com chaves que não correspondem a perguntas. Abuso de armazenamento e dados sujos. Mitigado por exigir autenticação e rate limit (30/min por IP), mas ainda assim sem teto de tamanho.
**Sugestão:** Aplicar `MAX_PAYLOAD_BYTES`/`MAX_ANSWER_KEYS` e, idealmente, `validateAllAnswers` (parcial) também aqui.

### P2-7 — `subject` de email de notificação é HTML-escapado indevidamente
**Arquivo:** `lib/notify.ts:40`
```ts
subject: `Nova resposta em "${safeFormTitle}"`,
```
**Problema:** `safeFormTitle = escapeHtml(formTitle)`. O `subject` de um email **não é HTML**; aplicar `escapeHtml` faz com que um título com `&`, `<`, `'` apareça literalmente como `&amp;`, `&lt;`, `&#039;` no assunto recebido.
**Impacto:** Cosmético, mas visível ao cliente: assuntos de email com entidades HTML cruas. (O `html` do corpo está correto em usar `safeFormTitle`.)
**Sugestão:** Usar `formTitle` cru no `subject` e manter `safeFormTitle` apenas no corpo HTML.

### P2-8 — Jump logic: `getNextQuestionId` pode pular para pergunta oculta por lógica condicional
**Arquivos:** `lib/form-logic-engine.ts:77-98,100-121`
**Problema:** `buildQuestionPath` calcula `visibleQuestions` (filtrando por `conditionalLogic`) e navega com `getNextQuestionId(currentId, visibleQuestions, ...)`. Porém, se uma jump rule tem `targetQuestionId` apontando para uma pergunta que está **oculta** (não pertence a `visibleQuestions`), `getNextQuestionId` retorna esse `targetQuestionId` mesmo assim (linha 90-92) — `findIndex` dela em `visibleQuestions` falharia depois, mas o id é retornado diretamente. O `visited`/`break` evita loop infinito, mas o caminho pode incluir um id inválido ou encerrar prematuramente.
**Impacto:** Comportamento de navegação imprevisível quando jump rules e lógica condicional coexistem e apontam para perguntas ocultas. Pode encerrar o formulário cedo ou renderizar pergunta inconsistente.
**Sugestão:** Em `getNextQuestionId`, se `jumpAction.targetQuestionId` não estiver presente na lista de perguntas visíveis fornecida, ignorar o jump (cair na navegação sequencial) ou pular para a próxima visível após o alvo. Adicionar teste cobrindo jump → pergunta oculta.

### P2-9 — `domains` POST: `.single()` em consulta que pode não retornar linha
**Arquivo:** `app/api/domains/route.ts:52-56`
**Problema:** `.from('custom_domains').select('id,user_id').eq('domain',domain).single()` — `.single()` retorna erro quando há 0 linhas (caso comum: domínio novo). O `error` é descartado e `existingDomain` vem `null`, então o fluxo funciona — mas se algum dia houver 2 linhas com o mesmo `domain` (sem unique constraint global), `.single()` erra e o check de takeover é silenciosamente pulado.
**Impacto:** Baixo, depende de não existir unique constraint em `custom_domains.domain` globalmente. Se não existir, a proteção contra domain takeover pode falhar.
**Sugestão:** Usar `.maybeSingle()` e garantir unique constraint global em `custom_domains.domain` (não apenas por usuário).

---

## 5. Achados P3 — Baixo / Cosmético

### P3-1 — Erros de lint em `services/whatsapp/server.js` (`require()` proibido)
`npm run lint` reporta 59 errors, a maioria `@typescript-eslint/no-require-imports` em `services/whatsapp/server.js`, que é um arquivo CommonJS legítimo. **Não é bug** — é o ESLint aplicando regra de ESM a um arquivo CJS. Sugestão: adicionar `services/whatsapp/**` ao `ignores` do `eslint.config.mjs` ou um override que desligue a regra para `*.js` nesse diretório.

### P3-2 — Comentário enganoso sobre payload de 1MB
Ver P2-3. O comentário em `app/api/responses/route.ts:20` deveria ser corrigido para refletir 50 KB.

### P3-3 — Warnings de variáveis não usadas
`lib/custom-domain.ts:29` (`formSlug`), `lib/field-validators.ts:6` (`QuestionType`), `lib/schemas/form-schema.ts:35` (`SAFE_PROTOCOLS`), `scripts/test-integration.ts:80` (`b2`), `services/whatsapp/server.js:41,112`. Limpeza recomendada.

### P3-4 — `console.log`/`console.error` diretos em rotas de produção
`app/api/responses/route.ts:326,340,357,367,69`, `lib/meta-capi.ts:124,129,132`, `lib/notify.ts:63` usam `console.*` em vez do `logger` estruturado (`lib/logger.ts`). Logs de submissão de resposta (`[responses] sending owner email notification` etc.) verbosos no caminho quente. Sugestão: padronizar via `logger` e reduzir verbosidade.

### P3-5 — Detecção de extensão de arquivo confia no MIME em `sign-url`
`app/api/upload/sign-url/route.ts:88` define a extensão a partir do `mime` enviado pelo cliente (não há magic-byte check possível pré-upload). O endpoint autenticado `app/api/upload/route.ts` faz magic-byte check corretamente. Como `sign-url` é o caminho usado pelo player público, o arquivo final no Storage pode ter extensão que não corresponde ao conteúdo real. Risco baixo (bucket público serve com `Content-Type` do upload). Sugestão: validar o `Content-Type` no `upload` direto ao Storage, ou processar/validar pós-upload.

### P3-6 — `redirect 302` para domínio não encontrado preserva o path arbitrário
`middleware.ts:96-99` — quando um domínio personalizado não resolve, redireciona para `NEXT_PUBLIC_APP_URL + request.nextUrl.pathname`. O `pathname` vem do request e é concatenado numa `new URL(...)` — `URL` normaliza, então não é open redirect, mas vale confirmar que `pathname` malicioso (`//evil.com`) é tratado. `new URL(pathname, base)` com `pathname` começando em `//` seria interpretado como host — **potencial open redirect**. Recomenda-se normalizar/validar `pathname` antes (garantir que começa com `/` e não `//`), como já é feito em `app/auth/callback/route.ts:9`.

> Observação: P3-6 fica em P3 por exigir um domínio personalizado não verificado apontado para o app; ainda assim recomenda-se a correção de normalização do path.

### P3-7 — Suíte de testes completa não conclui
`npx vitest run` (suíte inteira) expira/trava (exit 143 após timeout), embora arquivos individuais passem (`webhook-hmac.test.ts` 11/11, `tsc --noEmit` exit 0). Pode ser um teste que abre handle/intervalo sem fechar (note os `setInterval` globais em `lib/rate-limit.ts:29`, `response-rate-limit.ts:29`, `upload-rate-limit.ts:14` — em ambiente de teste mantêm o processo vivo) ou dependência de rede. Sugestão: investigar; usar `vitest run --pool=forks` ou garantir `unref()` nos `setInterval`, e/ou isolar testes que tocam Supabase.

---

## 6. Pontos Verificados e OK

Os seguintes itens foram inspecionados e **não apresentaram problema** (ou já estão corretamente endurecidos):

- **Login / senha:** `signInWithPassword` com rate limit por email (5/15min); bloqueio de login com email não confirmado (`login/route.ts:51-58`) descartando a sessão parcial; mensagens de erro genéricas (anti-enumeração).
- **Signup:** trata email duplicado como sucesso para evitar enumeração (`signup/route.ts:57-70`); valida senha ≥ 8 chars; rate limit.
- **Forgot/resend:** sempre retornam `success` (anti-enumeração), inclusive em erro de servidor; rate limit 3/15min.
- **Change-password:** exige reautenticação com a senha atual e revoga todas as sessões (`scope: 'global'`) — correto. (Contraste com P1-5, que é sobre o `reset-password`.)
- **OAuth callback:** protege contra open redirect validando `next` (`callback/route.ts:9`).
- **Middleware de sessão:** timeout de inatividade de 30 min com cookie `httpOnly`; tampering de timestamp futuro neutralizado (`middleware.ts:61-63`); redireciona rotas protegidas sem auth.
- **CSRF:** middleware verifica `Origin`/`Referer` em writes para `/api/*`, com exceção intencional e documentada apenas para `/api/responses` e domínios personalizados verificados.
- **Headers de segurança:** CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options` configurados; CSP separada (com `frame-ancestors *`) só para `/f/:slug` (forms embarcáveis), correta.
- **SSRF em webhooks:** `webhook-validator.ts` bloqueia IPs privados/CGNAT, `localhost`, endpoints de metadata de cloud, e faz pré-resolução de DNS (anti-rebinding); `dispatchWebhook` usa `redirect: 'manual'` e timeout de 10s.
- **Webhook HMAC (Asaas):** `verifyAsaasSignature` usa `timingSafeEqual`, rejeita timestamps futuros e > 5 min (anti-replay); webhook Asaas tem **idempotência atômica** (`asaas_webhook_events` unique) e guards de "subscription mismatch" para ignorar eventos de assinaturas antigas.
- **Webhook dispatcher:** exige `WEBHOOK_SECRET` (aborta sem ele), JSON canônico (chaves ordenadas) para HMAC determinístico entre retries, retry com backoff e DLQ (`webhook_failures`) + alerta ao dono.
- **Limites de plano / gating:** `PATCH /api/forms/[id]` ignora o campo `plan` (anti-escalonamento, P1-C); bloqueia pixels/webhooks/email/hide_branding/domínio conforme plano; valida `maxQuestions` e tamanho de payload; cria forms sempre como `draft`.
- **Validação de campos:** `field-validators.ts` cobre os 18 tipos com checagens coerentes (CPF com dígito verificador, ranges de rating/nps/opinion_scale, números finitos e dentro de `MAX_SAFE_INTEGER`, email/url/telefone). O backend roda `validateAllAnswers` em `/api/responses` e em `/api/v1` — bom alinhamento client/server (exceto a permissividade de URL em P1-4 e a divergência de `isResponseComplete` em P2-2).
- **`content_block`:** sanitizado server-side (`sanitizeContentBlocksServer`) na escrita e via `sanitizeHtml` no render; `contentButtonUrl` validado com `isSafeUrl` (bloqueia `javascript:`, `data:`, etc.).
- **Pixels / Meta CAPI:** Meta Pixel ID validado por regex `^\d{10,20}$` antes de injetar no script inline (`app/f/[slug]/page.tsx:115`), evitando injeção; CAPI faz hash SHA-256 de PII; pixels só renderizam para planos Plus/Professional.
- **Upload autenticado (`/api/upload`):** valida MIME por allowlist **e** por magic bytes, tamanho, sanitiza nome do arquivo, exige auth e rate limit.
- **RLS:** migração `20260501_enforce_rls_final_state.sql` é idempotente e estabelece estado final claro — `responses`/`answer_items` com INSERT anônimo restrito a forms publicados (exceto a ressalva P1-6 sobre `answer_items`), SELECT/UPDATE/DELETE só para o dono; `forms` sem acesso direto anônimo (anon lê via view `published_forms`).
- **Rotas admin:** `requireAdmin`/`requireAdminUser` checam allowlist `ADMIN_EMAILS`; rota de mudança de plano valida o plano e a data de expiração (futuro).
- **Account delete:** cancela assinatura Asaas antes de deletar; limpa `form_whatsapp_settings` (sem cascade) e usa `admin.deleteUser` (cascade nas demais tabelas).
- **WhatsApp send:** exige `INTERNAL_API_SECRET` para ambos os modos; rate limit por form+telefone; normalização Unicode NFKC no template (anti-homoglyph); plan gate Plus+.
- **Checkout/Asaas:** rate limit; valida plano e ciclo; exige campos de cobrança completos; não cancela a assinatura antiga antes da confirmação de pagamento (evita perda de plano em checkout abandonado); proration tratada.
- **CEP proxy (`/api/cep`):** valida 8 dígitos numéricos, rate limit por IP, timeout de 5s — sem risco de SSRF (host fixo `viacep.com.br`).
- **`tsc --noEmit`:** passou sem erros de tipo.

---

## 7. Recomendações Priorizadas (resumo de ação)

1. **P0-1** — Sanitizar `html_block` (allowlist de embed) no servidor e no render. **Bloqueante.**
2. **P1-1 / P1-2 / P2-2** — Alinhar o endpoint v1 (`/api/v1/forms/[id]`) com `/api/responses`: ownership de resposta anônima, incremento atômico de limite, `isResponseComplete` unificado.
3. **P1-3** — Resolver "plano efetivo" considerando `plan_expires_at` em todos os caminhos públicos.
4. **P1-4** — Corrigir `validateFileUpload` para exigir o prefixo do bucket.
5. **P1-5** — Endurecer `reset-password` (exigir contexto de recovery).
6. **P1-6** — Restringir o INSERT anônimo em `answer_items`.
7. **P2-x / P3-x** — Itens de robustez e higiene conforme detalhado acima.

---

*Fim do relatório — Fase 1 (estática). Nenhum arquivo de código foi modificado.*
