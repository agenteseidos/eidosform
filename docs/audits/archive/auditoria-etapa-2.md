# Auditoria ETAPA 2

**Data:** 2026-04-28
**Auditora:** Zéfa
**Repo:** `/home/sidney/eidosform`
**Commit auditado:** `2e55522` (fix(P1): etapa 2 — 11 correções de segurança P1 do relatório Claude)
**Revisão handoff:** `eca1120`

---

## Status
✅ **APROVADA**

---

## P0/P1 restantes
Nenhum P0/P1 restante.

Todos os 11 itens P1 da Etapa 2 foram corrigidos e validados. Itens P2 da auditoria original (handoff.md) permanecem como P2 e não bloqueiam avanço.

---

## Correções validadas

Todas as 11 correções de `2e55522` foram revisadas e aprovadas:

1. **P1-A — IDOR residual em `x-response-id`** ✅ — Rejeita update quando `respondent_id` é null. Correto.
2. **P1-B — Vazamento de `error.message` em admin** ✅ — Mensagem genérica aplicada.
3. **P1-C — PATCH do form aceita `plan` arbitrário** ✅ — Campo `plan` removido do update.
4. **P1-D — Webhooks externos sem HMAC** ✅ — HMAC-SHA256 com `WEBHOOK_SECRET`, backward compat sem secret.
5. **P1-E — Sem limite de quantidade/tamanho de questions** ✅ — `maxQuestions` por plano implementado (25/50/100/200) + 500KB payload cap.
6. **P1-F — Webhook URL vulnerável a DNS rebinding** ✅ — Resolução DNS async + cache 60s + bloqueio cloud metadata endpoints.
7. **P1-G — Email HTML sem escape no nome** ✅ — `escapeHtml()` aplicado em name e plan nos 3 templates de email.
8. **P1-H — `welcome_image_url` sem validação** ✅ — Validação HTTP/HTTPS + bloqueio localhost/private IPs.
9. **P1-I — `/api/forms/[id]/export` sem rate limit** ✅ — 10 req/min por usuário.
10. **P1-J — Fallback heurístico no Asaas** ✅ — Heurística removida, default starter.
11. **P1-K — Migrations RLS antigas/confusas** ✅ — Migration idempotente de consolidação criada.

---

## Correções feitas pela auditoria
Nenhuma. Todas as correções foram executadas pelo Zeca.

---

## Commits relevantes da etapa

| Hash | Autor | Descrição |
|------|-------|-----------|
| `2e55522` | Zeca | fix(P1): etapa 2 — 11 correções de segurança P1 do relatório Claude |
| `eca1120` | Zeca | docs: update handoff with etapa 2 P1 corrections |

---

## Veredito final
**ETAPA 2 está APROVADA e pode avançar.** Todas as 11 correções P1 foram implementadas corretamente, sem bypass residual. TypeScript compila sem erros novos. Nenhum P0/P1 pendente.
