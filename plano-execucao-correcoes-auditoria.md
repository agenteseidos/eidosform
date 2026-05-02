# Plano de Execução — Correção das Auditorias Fase 1 + Fase 2 (EidosForm)

> **Para:** Zé / OpenClaw
> **De:** Sidney (via Claude Code Opus 4.7)
> **Data:** 2026-05-02
> **Origem dos achados:** `auditoria-uso-fase1.md` (107 achados) + `auditoria-uso-fase2.md` (20 achados)
> **Total bruto:** 127 achados → após desduplicação (Fase 2 rebaixou 3 P0 da Fase 1, confirmou outros): **~115 achados únicos**

---

## Como o Zé deve trabalhar

1. **Executar uma etapa por vez.** Cada etapa é autocontida — não pular, não misturar.
2. **Antes de começar uma etapa:** ler os achados listados (IDs vêm dos relatórios `auditoria-uso-fase1.md` e `auditoria-uso-fase2.md`).
3. **Após terminar uma etapa:** gerar entrada no relatório consolidado em `/home/sidney/eidosform/relatorio-correcoes-auditoria.md` no formato:
   ```markdown
   ## Etapa N — <título>
   **Status:** ✅ Concluída em YYYY-MM-DD HH:MM
   **Commits:** <hash1>, <hash2>
   **Achados endereçados:** F2-E4-01, P1-A, ...
   **Arquivos alterados:** <lista>
   **O que foi feito:** <resumo objetivo, sem prosa>
   **Validação:** <como validou, ex: tsc passa, teste manual, etc>
   **Pendências dentro da etapa:** <lista ou "nenhuma">
   ```
4. **Não corrigir achados além do escopo da etapa atual.** Se descobrir bug novo, anotar na seção "Achados extras" e continuar.
5. **Validar produção depois de cada bloco** (etapas agrupadas em A/B/C/D/E).
6. **Commits em conventional commits** (`fix:`, `feat:`, `docs:`, `chore:`) e em **inglês**.
7. **Branch única por bloco** (ex: `fix/auditoria-bloco-a-fogo-telhado`), PR no final do bloco.

---

## BLOCO A — 🚨 FOGO NO TELHADO (produção quebrada)

> **Prazo:** TODAS as etapas deste bloco no mesmo dia. Hoje. Antes de qualquer outra coisa.

### Etapa 1 — Restaurar `/api/responses` (NENHUM usuário consegue submeter forms)

**Achados:** F2-E4-01 (P0)

**Contexto:** `POST /api/responses` retorna `500 Content-Length: 0` para qualquer payload válido. Honeypot path (linhas 152-157 de `app/api/responses/route.ts`) funciona, então o crash está entre as linhas 210-285 (validateAllAnswers, isResponseComplete, checkAndIncrementResponseCount, ou o insert na tabela `responses`).

**Passos:**
1. Conectar nos logs da Vercel (`vercel logs --prod` ou painel) e procurar exception em `/api/responses` POST nas últimas 24h.
2. Em paralelo: abrir Supabase Studio > Database > Tables > `responses` e listar colunas. Comparar com o insert na linha 279 do route.ts: `form_id, answers, meta_events, completed, last_question_answered, respondent_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content`. Identificar qual coluna não existe.
3. Aplicar migration que adicione a(s) coluna(s) faltante(s). Migration file: `supabase/migrations/20260503_fix_responses_columns.sql`.
4. Como hardening: envolver linhas 210-401 em `try { ... } catch (err) { logError('responses POST crashed', err); return NextResponse.json({error:'Erro interno', detail: err.message}, {status:500, headers: CORS_HEADERS}) }` para ter visibilidade futura.
5. Validar: rodar curl em produção:
   ```bash
   curl -i -X POST https://eidosform.com.br/api/responses \
     -H 'Content-Type: application/json' \
     -d '{"form_id":"af8ea379-cea0-4471-b1ee-d63e2daffc19","answers":{"0ea3c4ae-ab49-448e-81e4-73118e89d91c":"teste"}}'
   ```
   Esperado: `201 {"response_id":"<uuid>","completed":false}`.

**Critério de done:** submissão retorna 201, resposta aparece em Supabase Studio > responses.

**Reportar no relatório:** qual era a causa raiz, qual migration foi aplicada, link do commit, screenshot do curl 201.

---

### Etapa 2 — Corrigir DNS (SPF + MX) de `eidosform.com.br`

**Achados:** F2-E1-01 (P0), F2-E1-02 (P0), F2-E1-03 (P1)

**Contexto:** Sem SPF, emails do Resend caem em spam. MX aponta para o próprio domínio (Vercel sem SMTP) — incoming email quebra. DMARC em `p=none`.

**Passos:**
1. **No painel DNS (Registro.br ou onde estiver):**
   - **Adicionar TXT em `eidosform.com.br`:** `v=spf1 include:_spf.resend.com ~all` (confirmar valor exato no painel Resend > Domains).
   - **Trocar MX:** se o domínio NÃO precisa receber email, criar registro nulo (`0 .`) ou apontar para Google Workspace/Zoho. Se tiver dúvida, usar `0 .` (RFC 7505 — explicitamente diz "este domínio não recebe email") e configurar `Reply-To: agenteseidos@gmail.com` em todos os emails do Resend.
   - **DMARC:** primeiro deixar em `p=none` por 14 dias coletando relatórios via `rua=mailto:agenteseidos@eidosform.com.br` (ou um Gmail dedicado, **não** pessoal). Depois, evoluir para `p=quarantine`. Em ~30 dias para `p=reject`.
2. Aguardar propagação (~1h). Validar:
   ```bash
   dig +short TXT eidosform.com.br
   dig +short MX eidosform.com.br
   dig +short TXT _dmarc.eidosform.com.br
   ```
3. Enviar email de teste via Resend para um Gmail/Outlook externo. Verificar headers (`Authentication-Results: spf=pass; dkim=pass; dmarc=pass`).

**Critério de done:** SPF resolve, MX correto, email de teste chega na inbox (não spam) com SPF+DKIM=pass.

**Reportar:** valores DNS antigos vs novos, headers do email de teste, prints.

---

### Etapa 3 — Smoke test ponta-a-ponta após etapas 1+2

**Achados:** validação de A.

**Contexto:** confirmar que com os 2 P0 acima resolvidos, o fluxo principal funciona.

**Passos:**
1. Acessar form de teste deixado pela auditoria: `https://eidosform.com.br/f/teste-auditoria-1777753535312` (ID `af8ea379-cea0-4471-b1ee-d63e2daffc19`).
2. Preencher manualmente todas as 18 perguntas e submeter.
3. Validar:
   - ✅ Tela de "Obrigado" aparece.
   - ✅ Resposta aparece em `/forms/{id}/responses` no dashboard.
   - ✅ Email chega em `medeiros.sco@gmail.com` (com SPF/DKIM=pass).
   - ✅ WhatsApp chega em `83999376704`.
   - ✅ Webhook (se configurado) recebe POST com signature.

**Critério de done:** submissão completa, todas as notificações chegam.

**Reportar:** prints da inbox, screenshot WhatsApp, log do webhook receiver. **Se algum item falhar, abrir etapa nova e não fechar o bloco A.**

---

## BLOCO B — Endurecimento de Auth/Secrets

> **Prazo:** próximos 3 dias após bloco A.

### Etapa 4 — Endurecimento do signup (email enumeration)

**Achados:** F2-E5-01 (P1), P0-1 da Fase 1 (já parcialmente resolvido — fechar agora)

**Passos:**
1. Em `app/api/auth/signup/route.ts`: substituir o body de sucesso por:
   ```ts
   return NextResponse.json({ success: true, message: 'Verifique seu email para confirmar.' }, { status: 201 })
   ```
   Não retornar mais o objeto `user`.
2. Em `app/(auth)/register/page.tsx`: ajustar o frontend para não esperar `user` no response.
3. Validar com curl: signup com email registrado e signup com email novo devem retornar exatamente o mesmo body.

**Critério de done:** body do response identico nos dois casos.

---

### Etapa 5 — Login: bloquear email não-confirmado + slimmar response

**Achados:** P0-3 da Fase 1, F2-E2-01 (P1)

**Passos:**
1. Em `app/api/auth/login/route.ts`, após `signInWithPassword` sucesso, checar `data.user?.email_confirmed_at`. Se nulo, retornar `403 {"error":"Confirme seu email antes de entrar.","code":"EMAIL_NOT_CONFIRMED"}`.
2. Slim response: retornar apenas `{ success: true, redirectTo: '/forms' }`. Não retornar o objeto `user` completo.
3. Frontend (`app/(auth)/login/page.tsx`): se receber `code: 'EMAIL_NOT_CONFIRMED'`, mostrar mensagem com link "Reenviar email de confirmação".

**Critério de done:** login com email não confirmado bloqueia + body slim.

---

### Etapa 6 — Remover CSRF skip de `/api/auth/*`

**Achados:** F2-E5-02 (P1), P2-6 da Fase 1

**Passos:**
1. Em `middleware.ts`, na variável `publicWritePaths`, **remover** `/api/auth/`. Manter apenas `/api/responses` (forms públicos precisam de CORS aberto).
2. Garantir que `app/(auth)/login/page.tsx` (e outras páginas auth) enviam Origin do mesmo domínio.
3. Validar: `curl -X POST -H 'Origin: https://attacker.example.com' https://eidosform.com.br/api/auth/login` deve retornar 403 com mensagem CSRF.

**Critério de done:** Origin atacante é bloqueado em todos os endpoints `/api/auth/*`.

---

## BLOCO C — Validação e Schema (defense-in-depth)

> **Prazo:** semana 1.

### Etapa 7 — Adicionar validação Zod em forms (POST + PATCH)

**Achados:** P1-A da Fase 1, P0-FB1 (sanitização HTML)

**Passos:**
1. Criar `lib/schemas/form-schema.ts` com Zod:
   - `QuestionSchema` discriminated union por `type` (18 tipos).
   - `FormCreateSchema` e `FormUpdateSchema`.
   - Validar `pixels`, `thank_you_*`, URLs com `isSafeUrl`.
2. Em `app/api/forms/route.ts` (POST) e `app/api/forms/[id]/route.ts` (PATCH): chamar `.parse()` ou `.safeParse()` antes de inserir/atualizar.
3. Erros Zod retornam `400 { error: 'Payload inválido', issues: [...] }`.
4. Validar: payload com `type: "evil_type"` deve retornar 400.

**Critério de done:** payloads inválidos rejeitados, payloads válidos seguem normalmente.

---

### Etapa 8 — Endurecer validators server-side (dropdown/checkboxes/rating/calendly/file_upload/number)

**Achados:** P0-FP1 (Fase 1), P2-FB3, P2-FB4, P2-FB6, P2-FB7 (Fase 1), P1-FP3

**Passos:**
1. Em `lib/field-validators.ts`:
   - `validateDropdown`/`validateCheckboxes`: rejeitar se `question.options.length === 0` ou `< 2`.
   - `validateRating`/`validateOpinionScale`: rejeitar se `min >= max`.
   - `validateNumber`: cap em `Number.MAX_SAFE_INTEGER` e `-Number.MAX_SAFE_INTEGER`.
   - `validateCalendly`: rejeitar se `required: true` e `calendlyUrl` vazio.
   - `validateFileUpload`: cap em `maxFileSize <= 25` (MB).
2. Espelhar validações no client (`question-renderer.tsx`) para feedback imediato.
3. Testes unitários cobrindo cada caso.

**Critério de done:** todos os edge cases rejeitados com mensagem clara.

---

### Etapa 9 — Sanitização HTML server-side em content_block

**Achados:** P0-FB1 (Fase 1), P1-FB1, P1-FB2

**Passos:**
1. Instalar `isomorphic-dompurify` (ou alternativa server-side de DOMPurify).
2. Em `lib/html.ts`: usar DOMPurify Node.js no server (não fallback básico). Whitelist conservadora: `p, br, strong, em, ul, ol, li, a` (com `href` validado por `isSafeUrl`).
3. `isSafeUrl` adicionar bloqueio de `blob:`, `ws:`, `wss:`, `file:`. Usar whitelist estrita: `['https:','http:','mailto:','tel:','sms:']`.
4. PATCH/POST de forms aplica `sanitizeHtml` em `contentBody` antes de gravar.
5. Player aplica novamente como defense-in-depth.

**Critério de done:** payload com `<script>` ou `javascript:` no contentBody é sanitizado/rejeitado.

---

## BLOCO D — Operacional VPS + Nginx + Logs

> **Prazo:** semana 1.

### Etapa 10 — Hardening da VPS WhatsApp

**Achados:** F2-E1-04, F2-E1-05, F2-E1-08, P0-N4 (Fase 1), F2-E1-06

**Passos:**
1. **Permissões:**
   ```bash
   chmod 600 /home/sidney/eidosform-whatsapp/.env
   chmod 600 /home/sidney/eidosform-whatsapp/server.log
   chmod 600 /home/sidney/eidosform-whatsapp/latest-qr.{png,txt}
   chmod 600 /home/sidney/eidosform-whatsapp/status.json
   ```
2. **Criar `.gitignore` na VPS** com `.env`, `*.log`, `latest-qr.*`, `status.json`, `node_modules`.
3. **Logrotate:** criar `/etc/logrotate.d/eidosform-whatsapp`:
   ```
   /home/sidney/eidosform-whatsapp/server.log {
     daily
     rotate 7
     compress
     missingok
     notifempty
     copytruncate
     create 600 sidney sidney
   }
   ```
4. **Hash de PII em logs:** em `/home/sidney/eidosform-whatsapp/server.js` e `lib/integration-stubs.ts`, hashear phone com `sha256(phone).slice(0, 8)` antes de logar.
5. **Rotacionar `WHATSAPP_API_KEY`** atual: gerar nova em `wacli`, atualizar `.env` da VPS e `WHATSAPP_API_KEY` na Vercel. Testar `/api/form/{id}/whatsapp/test`.
6. **Headers de segurança no nginx-updated.conf:** adicionar `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`. Reload nginx (`nginx -t && systemctl reload nginx`).
7. **Commitar `server.js` e `fix-nginx-timeout.sh`** que estão untracked no repo da VPS.

**Critério de done:** todos os arquivos com permissões corretas, logrotate funcionando, headers presentes, chave rotacionada, server.js commitado.

---

### Etapa 11 — Validar Resend (email saindo OK após DNS)

**Achados:** validação do bloco A.

**Passos:**
1. Painel Resend > Domains > confirmar `eidosform.com.br` com status "Verified" (DKIM, SPF, DMARC alinhados).
2. Enviar email de teste para Gmail, Outlook, Hotmail. Verificar:
   - ✅ Chega na inbox (não spam).
   - ✅ Headers `Authentication-Results: spf=pass; dkim=pass; dmarc=pass`.
   - ✅ Reply-To não cai no vazio.
3. Configurar webhook Resend para "bounced/complained" em `/api/webhooks/resend` (criar endpoint se não existir) — opcional mas recomendado.

**Critério de done:** 3 inboxes diferentes recebem o email de teste com auth-results pass.

---

## BLOCO E — UX e Dashboard

> **Prazo:** semana 2.

### Etapa 12 — Indicador de plano/quota no dashboard

**Achados:** F2-E2-02 (P2), P2-A da Fase 1

**Passos:**
1. Componente `<PlanQuotaCard>` no topo do `/forms` mostrando: `Plano: <nome> • <usado>/<limite> respostas • <X>/<Y> formulários`.
2. Card de upsell quando `usado >= 80%` do limite.
3. Endpoint usado: `/api/user/plan-features` (já existe).

**Critério de done:** card visível e atualizado.

---

### Etapa 13 — Corrigir player UX

**Achados:** F2-E3-02 (P2), F2-E4-02 (P1), P3-FP4 da Fase 1

**Passos:**
1. **"1 de 18 (17 total)"** → padronizar para `Pergunta 1 de 17` (descontando content_blocks). Atualizar `form-player.tsx`.
2. **Textarea long_text:** instruções viram `Pressione Ctrl+Enter ↵`, ou adicionar botão "OK" visível. Aceitar Ctrl+Enter para avançar.
3. **Erro de validação:** `scrollIntoView({behavior:'smooth', block:'center'})` + `focus()` no campo com erro.

**Critério de done:** UX testada em desktop + mobile (Chrome DevTools), nenhum trava.

---

### Etapa 14 — Corrigir bug "Profile not found" no API Key

**Achados:** F2-E6-01 (P2), F2-E3-01 (P1 — `GET /api/forms/{id}` 404)

**Passos:**
1. **API Key:** em `app/api/settings/api-key/route.ts`, retornar `200 {"hasKey": false}` quando user existe mas não tem API key. Frontend: card mostra botão "Gerar chave".
2. **GET /api/forms/{id}:** substituir o `select(...)` longo por `select('*')` temporariamente. Comparar diff com `\d forms` no Supabase. Identificar coluna fantasma e remover do select OU criar migration. Logar diff de "RLS deny" vs "DB error" com `logError`.

**Critério de done:** ambos os bugs resolvidos, validados via curl.

---

## BLOCO F — Integrações (P1/P2 não-críticos)

> **Prazo:** semana 2-3.

### Etapa 15 — Idempotência e correções no webhook Asaas (entrada)

**Achados:** P1-INT3, P1-INT4, P1-INT5, P1-INT6, P1-INT7, P1-INT8, P0-INT2 (todos da Fase 1)

**Passos:**
1. **HMAC parsing:** mudar `URLSearchParams` para parser custom robusto (linha 22-26 de `lib/webhook-hmac.ts`).
2. **Timestamp:** remover `age < -30_000`. Aceitar apenas passado.
3. **Token vs HMAC:** unificar — apenas HMAC, deprecar token fallback.
4. **Idempotência:** criar tabela `asaas_webhook_events (id, event_id, processed_at)` com unique constraint em `event_id`. Em `app/api/webhooks/asaas/route.ts`, antes de processar, verificar se já existe; se sim, retornar 200 sem reprocessar.
5. **Eventos desconhecidos:** trocar `default: break` por `default: { logWarn('Unknown asaas event', {event}); break }`.
6. **PAYMENT_OVERDUE:** comparar `payment.subscription` com `profile.asaas_subscription_id` ANTES de qualquer downgrade.

**Critério de done:** webhook idempotente (mesmo evento 2x não duplica), eventos desconhecidos logados, sem falsos downgrades.

---

### Etapa 16 — Webhooks de saída (HMAC, retry, SSRF)

**Achados:** P0-INT1, P1-INT1, P1-INT2, P2-INT1, P2-INT2, P3-INT1 (Fase 1)

**Passos:**
1. **`WEBHOOK_SECRET` obrigatório:** validar no startup; abortar dispatch se ausente.
2. **Timestamp fixo entre retries:** gerar uma vez fora do loop (linha 100 de `webhook-dispatcher.ts`).
3. **JSON canônico:** ordenar chaves antes de stringify para HMAC ser determinístico entre retries.
4. **`webhook_logs.payload`:** parar de armazenar payload completo. Apenas metadados.
5. **DNS race em SSRF:** se DNS falha, bloquear (não passar com array vazio).
6. **DLQ:** criar tabela `webhook_failures` para falhas após 4 retries; notificar owner por email após N falhas.

**Critério de done:** HMAC válido entre retries, sem PII em logs, DLQ funcionando.

---

### Etapa 17 — Notificações (Resend + WhatsApp): hardening

**Achados:** P1-N1, P1-N2, P1-N3, P1-N4, P2-N1, P2-N3, P2-N4 (Fase 1)

**Passos:**
1. **Subject de email:** truncar em 50 chars, remover patterns CPF/email/phone do assunto.
2. **Template WhatsApp:** normalizar Unicode (`String.normalize('NFKC')`) e escapar caracteres especiais.
3. **Rate limit WhatsApp:** chave `whatsapp:${form_id}:${cleanPhone}` (não só phone).
4. **Idempotency-Key Resend:** hash de `(form_id, response_id, completion_time)` no header.
5. **Retry Resend:** 3 tentativas com backoff (1s, 5s, 10s).
6. **Plan gate único:** consolidar em `/api/whatsapp/send` (remover do dispatcher).

**Critério de done:** subject não vaza PII, sem duplicatas em retry, rate limit isolado por form.

---

## BLOCO G — Limpeza Final + P3

> **Prazo:** semana 3.

### Etapa 18 — Achados P3 + cleanup geral

**Achados:** todos os P3 das duas fases (~26 itens menores).

**Passos:**
1. Acessibilidade do builder (`htmlFor`, `aria-label`).
2. Mensagens em pt-BR (varredura por strings em inglês).
3. Logs sem PII (filter automático em `logger.ts`).
4. Tiebreakers em paginação (`order id desc`).
5. JSON.parse com log em falha (`utm-tracker.ts`).
6. **Deletar artefatos da auditoria** que ficaram em produção:
   - Form `af8ea379-cea0-4471-b1ee-d63e2daffc19` ("[TESTE-AUDITORIA-2026-05-02]").
   - Contas `eb2d9c6d-6119-47a2-9c5f-f9bbe95a89ec` e `a4066c51-3c0c-43f3-85f0-7298d2091482`.
   - Pasta `/tmp/eidos-audit/` na VPS.

**Critério de done:** lint clean, sem strings em inglês, artefatos deletados.

---

### Etapa 19 — Auditoria de regressão final

**Contexto:** após blocos A-G, validar que nada quebrou.

**Passos:**
1. Re-rodar smoke test ponta-a-ponta (Etapa 3).
2. Conferir todos os 18 tipos de pergunta no player + dashboard.
3. Conferir checkout em conta de teste secundária (Free → Plus → Professional).
4. Conferir webhook + Sheets + email + WhatsApp em uma submissão real.
5. Atualizar `auditoria-uso-fase1.md` e `auditoria-uso-fase2.md` marcando cada achado como `✅ resolvido / ⚠️ pendente / ❌ recusado`.

**Critério de done:** todas as funcionalidades testadas funcionam.

---

## RELATÓRIO FINAL — instrução para o Zé

Quando terminar TODAS as etapas, gerar `/home/sidney/eidosform/relatorio-correcoes-auditoria.md` com:

1. **Sumário executivo:**
   - Total de achados endereçados (resolvidos, pendentes, recusados, com justificativa de cada recusa).
   - Tempo total e dias trabalhados.
   - Lista de blocos completos.
2. **Para cada etapa:** o template descrito no início ("Como o Zé deve trabalhar").
3. **Achados extras descobertos durante execução** (separados por etapa, classificados P0-P3).
4. **Lista de PRs/commits** com links.
5. **Riscos remanescentes** (achados não resolvidos e por quê).
6. **Próxima auditoria sugerida** (Fase 3 ponta-a-ponta com conta de teste secundária).

---

## Resumo dos blocos

| Bloco | Etapas | Prazo | Achados aproximados |
|---|---|---|---|
| **A — Fogo no telhado** 🚨 | 1-3 | hoje | 3 P0 + validação |
| **B — Auth/Secrets** | 4-6 | 3 dias | 4 P1 |
| **C — Validação/Schema** | 7-9 | semana 1 | 1 P0 + 8 P1/P2 |
| **D — Operacional VPS** | 10-11 | semana 1 | 6 P1 + ops |
| **E — UX/Dashboard** | 12-14 | semana 2 | 4 P1/P2 |
| **F — Integrações** | 15-17 | semana 2-3 | ~25 P1/P2 |
| **G — Limpeza P3** | 18-19 | semana 3 | ~26 P3 + regressão |

**Cadência sugerida:** 1 etapa por agente do OpenClaw, em paralelo onde possível (Bloco D pode rodar junto com B/C — não há overlap de arquivos). Bloco A é serial e bloqueia tudo.

---

**FIM do plano.** Cole isso no Zé, o instrua a começar pelo Bloco A imediatamente. Os relatórios `auditoria-uso-fase1.md` e `auditoria-uso-fase2.md` em `/home/sidney/eidosform/` são o input detalhado de cada achado por ID.
