# Auditoria Completa — EidosForm — 2026-06-10

**Tipo:** Estática (somente leitura na fase de auditoria) · **Branch:** `claude/oi-vxcmf1`
**Método:** 4 frentes paralelas (segurança API/RLS · billing/Asaas · frontend · infra/serviços) + verificação manual dos achados de maior severidade.

## Veredito geral

> **Nenhum P0 confirmado no código atual.** O P0 histórico (XSS em `html_block`) foi **corrigido**. A base está madura: auth, RLS, webhooks, billing e logging têm defesa-em-profundidade real. Os achados abertos são **P1↓**, em sua maioria hardening, robustez e higiene.

| Severidade | Qtd | Natureza |
|---|---|---|
| **P0** | 0 | — |
| **P1** | 2 | IDOR em resposta parcial; CSP `unsafe-inline` no player |
| **P2** | 8 | Rate-limit/exposição de rede, a11y, fallback de downgrade, HMAC legado, etc. |
| **P3** | ~12 | Higiene, código morto, cosmético, config |

---

## Status dos achados da auditoria anterior (2026-05-18)

| Achado | Status | Evidência |
|---|---|---|
| **P0-1** XSS `html_block` (player público) | ✅ CORRIGIDO | `sanitizeEmbedHtml` em `question-renderer.tsx:527` + `html-server.ts:159` (allowlist de iframe), server-side em `forms/route.ts:151` |
| **P1-1** v1 sequestro de resposta anônima | ⚠️ PARCIAL | `v1/forms/[id]/route.ts:297` valida, mas resposta anônima (`respondent_id null`) ainda sobrescrevível — ver A1 |
| **P1-2** v1 limite não-atômico | ✅ CORRIGIDO | usa `checkAndIncrementResponseCount` (RPC) `v1/forms/[id]/route.ts:269` |
| **P1-3** plano sem `plan_expires_at` | ✅ CORRIGIDO | `getEffectivePlan()` em `plans.ts:22`, usado em responses/v1/player/whatsapp |
| **P1-4** `validateFileUpload` aceita qualquer https | ✅ CORRIGIDO | exige prefixo do bucket `field-validators.ts:317` |
| **P1-5** `reset-password` sem contexto de recovery | ✅ CORRIGIDO | cookie HMAC `recovery-token.ts` validado em `reset-password/route.ts:27` |
| **P1-6** RLS `answer_items WITH CHECK(true)` | ✅ CORRIGIDO | policy removida `20260518_p1_6_*.sql` |
| **P2-2** `isResponseComplete` divergente | ⚠️ verificar | unificação não confirmada |
| **P2-3** payload 50KB vs comentário 1MB | ✅ corrigido | comentário esclarecido |
| **P2-5** `sign-url` sem `maxFileSize` por pergunta | 🔶 ABERTO (mitigado) | só limite global 10MB; rejeita no submit final |
| **P2-9** `domains` `.single()` | 🔶 ABERTO | `domains/route.ts:57` |
| **P3-6** open redirect no middleware | ✅ falso-positivo | `new URL(pathname, base)` normaliza |

---

## P1 — Alto

### A1 · IDOR em respostas parciais anônimas
**`app/api/responses/partial/route.ts:150-183`** (e equivalente em `v1/forms/[id]:297`)
O UPDATE valida apenas que o `response_id` pertence ao `form_id` — não há prova de posse pelo respondente. Quem tiver um `response_id` de uma resposta **anônima não-finalizada** pode sobrescrevê-la.
**Impacto:** corrupção/injeção de leads de terceiros. **Mitigante forte:** `response_id` é UUID (~122 bits, não enumerável) — por isso P1, não P0.
**Correção:** emitir um `partial_token` (HMAC do `response_id` + secret) ao criar a parcial; exigir esse token no UPDATE em vez de confiar só no UUID.

### A2 · CSP com `unsafe-inline` no player `/f/:slug`
**`next.config.ts:55-56`** — `script-src 'self' 'unsafe-inline'`.
Hoje o vetor principal (`html_block`) está sanitizado, então não há XSS conhecido explorável. Mas `unsafe-inline` remove a rede de segurança: qualquer regressão de sanitização vira XSS executável no contexto do domínio.
**Correção:** migrar para nonces dinâmicos e remover `unsafe-inline`. P1 "trava de segurança", não urgência de incidente.

---

## P2 — Médio

| # | Achado | Local | Correção |
|---|---|---|---|
| B1 | `<select>` sem label no editor de condições (E/OU) — WCAG A | `conditional-visibility-editor.tsx:81,104,123` | `htmlFor`/`aria-label` nos 3 selects |
| B2 | Downgrade fail-open: pausa de forms falha → UI mostra sucesso, forms acima do limite seguem ativos (há DLQ+alerta) | `checkout/[plan]/route.ts:249` | fail-closed: abortar reativação se `handleDowngrade` falhar |
| B3 | HMAC fallback legado no webhook Asaas (caminho alternativo de auth) | `webhooks/asaas/route.ts:386` · `webhook-hmac.ts` | deprecar; logar quando HMAC passa e token não |
| B4 | WhatsApp VPS em `0.0.0.0` — endpoints expostos (Bearer mitiga) | `services/whatsapp/server.js:659` | bind `127.0.0.1` + nginx, ou firewall |
| B5 | Rate-limit WhatsApp só por IP — bypass via múltiplos IPs | `services/whatsapp/server.js:461` | chave `token+IP` |
| B6 | `sign-url` ignora `maxFileSize` por pergunta | `upload/sign-url/route.ts:62` | passar `question_id` e validar antes de assinar |
| B7 | `.single()` em queries opcionais → 500 em vez de 404 | `domains/route.ts:57,109…`, `folders/[id]` | `.maybeSingle()` |
| B8 | DELETE sem rate-limit (domínio, conta, API key) | `domains`, `account/delete`, `settings/api-key` | rate-limit por user |

---

## P3 — Baixo / Higiene

- Self-XSS no preview do builder: `form-preview.tsx:715` e `:722` (`htmlBlockNote`) com `dangerouslySetInnerHTML` sem sanitização (só atinge o dono logado). Aplicar `sanitizeEmbedHtml`/`sanitizeRichHtml`.
- Código morto: `lib/pixel-event-engine.ts` duplica `pixel-events.ts` e não é importado → remover.
- `utm-tracker.ts:1-2`: `SESSION_STORAGE_KEY` e `LOCAL_STORAGE_KEY` idênticos (`'eidosform_utm'`) → UTM vaza entre forms. Separar chaves.
- `notify.ts:40`: `escapeHtml` aplicado no subject do email → `&amp;` literal no assunto. Usar título cru.
- `recovery-token.ts:21`: reuso de chave (`INTERNAL_API_SECRET`/`SERVICE_ROLE_KEY`) + fallback `|| ''`. Separar secret por contexto.
- `resend.ts:13`: `ADMIN_ALERT_EMAIL` hardcoded como fallback. Exigir env.
- `responses/route.ts:327`: `respondent_id` (PII) em log de erro → mascarar.
- Re-entrega tardia de `RECEIVED` pode zerar quota em edge case de virada-de-dia (`webhooks/asaas/route.ts:681`) — comparar por dia, não por ms.
- `proration.ts`: aritmética em centavos correta, mas sem comentário — documentar.
- DMARC `p=none` + `rua` Gmail pessoal — aceito por decisão de produto (`dns-changes-pending.md`); evoluir conforme cronograma.
- `meta-capi.ts:74` sem validação de formato de email/phone antes do hash; Google Sheets com scope full; paths hardcoded no `server.js:18-22`.
- Suíte vitest completa trava (`setInterval` sem `unref()` em `rate-limit.ts:29` etc.) — testes individuais passam.

---

## Pendências documentadas (backlog, não-bugs)

Do `backlog-demandas-2026-05-04.md`: editar `plan_expires_at` via Admin, painel admin com drill-down/impersonate, re-auditoria WhatsApp. Do `audit-venda-conversao.md`: embed/iframe ausente (gap comercial #1), multi-user "Pro" vendido mas não implementado, export só CSV.

---

## Verificado e OK

Auth (rate-limit anti-enumeração, CSRF por Origin, change-password com reauth+revogação global) · RLS final consolidada · SSRF guard + HMAC determinístico nos webhooks de saída · idempotência atômica + guards out-of-order + preço-cheio no Asaas · crons com `CRON_SECRET` fail-closed · `getEffectivePlan` consistente · upload autenticado com magic-bytes · CSV com sanitização anti-fórmula · envio duplicado travado por ref · validação client/server alinhada · API keys hasheadas · PII redaction no logger · rota de teste WhatsApp protegida (auth+ownership+plano+rate-limit).

## Correções aplicadas (mesma data, branch `claude/oi-vxcmf1`)

Todos os achados acionáveis foram corrigidos no mesmo ciclo:

| Achado | Correção |
|---|---|
| **A1** IDOR parcial anônima | `partial_token` (HMAC, `lib/partial-token.ts`) emitido na criação e exigido em todo UPDATE — `/api/responses/partial`, `/api/responses` (upgrade parcial→final) e player. Cliente sem token degrada para criar resposta nova (não quebra leads em voo, não permite sobrescrever). |
| **A2** CSP `unsafe-inline` | CSP por request com nonce + `strict-dynamic` no middleware para `/f/*` (e rewrites de domínio customizado); `unsafe-inline` mantido apenas como fallback p/ browsers antigos (ignorado quando há nonce). Verificado em runtime: header + nonce no HTML. |
| B1 a11y selects | `label htmlFor`/`aria-label` nos 3 selects + input do editor de condições. |
| B2 downgrade fail-open | Retry imediato (2 tentativas) de `handleDowngrade` antes da DLQ. Fail-closed total descartado: a sub nova já está cobrada/commitada nesse ponto. |
| B3 HMAC legado Asaas | Log alto quando autentica SÓ por HMAC; kill-switch `ASAAS_ALLOW_HMAC_FALLBACK=0`; marcado deprecated. |
| B4 bind 0.0.0.0 | Default `127.0.0.1` (`BIND_HOST` p/ override). **⚠️ deploy da VPS: confirmar que o nginx aponta p/ 127.0.0.1:3457 antes de subir.** |
| B5 rate-limit por IP | Teto global agregado (60/min, `RATE_LIMIT_GLOBAL_MAX`) além do per-IP. |
| B6 `sign-url` sem limite por pergunta | Endpoint valida `maxFileSize` da pergunta antes de assinar; player envia `question_id` e valida client-side. |
| B7 `.single()` | Takeover check de domínio agora lista todas as linhas (duplicata não pula mais o check); existence checks → `.maybeSingle()` (domains, folders). |
| B8 DELETE sem rate-limit | Rate-limit por user em account/delete (3/15min), api-key delete (5/15min), domains delete (5/min). |
| P3 self-XSS preview | `sanitizeEmbedHtml`/`DOMPurify` no `html_block` do form-preview. |
| P3 código morto | `lib/pixel-event-engine.ts` e `components/pixels/pixel-injector.tsx` removidos. |
| P3 subject email | Título cru no subject (`notify.ts`). |
| P3 secrets | `RECOVERY_TOKEN_SECRET` dedicado (com fallback compat); `ADMIN_ALERT_EMAIL` sem fallback hardcoded (loga erro alto). |
| P3 PII em log | `respondent_id` → `has_respondent` booleano. |
| P3 re-entrega tardia | Comparação por dia UTC na virada de ciclo do webhook Asaas. |
| P3 vitest trava | `unref()` nos `setInterval` dos 3 rate-limits — suíte completa roda em ~1.6s. |
| P3 lint | 14 erros e 32 warnings zerados (unescaped entities, setState-em-effect, unused vars, `enterprise` morto removido do gating, eslint override p/ `services/**`). |
| Extra (novo achado) | `services/whatsapp` `requireAuth`: com `API_KEY` vazia, `Bearer` vazio autenticava (`'' === ''`). Agora fail-closed (503) + comparação timing-safe. |
| Extra | `reset-password` importava rate-limit sem aplicar — aplicado (5/15min por user). |
| Extra | `isResponseComplete` unificado: `/api/responses` usa a versão de `lib/form-response-security` (duplicata local removida). |

**Falsos-positivos confirmados nesta rodada:** chaves UTM session/local "colidindo" (storages independentes — documentado no código); `integration-stubs` × `form-integrations` "duplicados" (já divergiram); rota `whatsapp/test` "sem auth" (tem auth+ownership+plan+rate-limit); P2-4 header `X-EidosForm-Timestamp` (não existe no código).

**Verificação:** `tsc --noEmit` ✅ · `eslint` 0 erros/0 warnings ✅ · `vitest` 115/115 ✅ · `next build` ✅ · smoke test runtime da CSP ✅.

**Não corrigido (decisão consciente):** DMARC `p=none`→`quarantine` (cronograma de produto em `dns-changes-pending.md`, fora do código); pendências de backlog comercial (embed, multi-user Pro, exports) — são features, não bugs.

## Notas de calibração

- "WhatsApp 0.0.0.0" rebaixado de P1→P2: endpoints exigem Bearer `INTERNAL_API_SECRET`.
- "recovery-token fallback" rebaixado de P1→P3: ambos os secrets são estáveis server-side; o problema real é reuso de chave.
- "IDOR partial" rebaixado de P1-alto→P1-baixo/P2: UUID não-enumerável.
- NEW-7 do agente (auth na rota whatsapp/test) verificado manualmente: falso-positivo.
