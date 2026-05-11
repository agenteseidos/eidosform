# Correções Pendentes — Relatório de Progresso

**Data:** 2026-04-30  
**Status:** ✅ Concluído

---

## Avaliação Inicial

A maioria dos itens listados já estava implementada nas etapas anteriores (1–5). Abaixo o estado detalhado de cada item.

---

## P1 — Itens Críticos

### P1-A — Anonymous IDOR via X-Response-Id
**Status:** ✅ Já corrigido (etapas anteriores)  
**Arquivo:** `app/api/responses/route.ts:254-259`  
**Como:** Bloqueia update via X-Response-Id quando `respondent_id` é null ou não coincide com o body. Retorna 403.

### P1-D — Webhooks externos sem assinatura HMAC
**Status:** ✅ Já corrigido (etapas anteriores)  
**Arquivo:** `lib/webhook-dispatcher.ts`  
**Como:** Header `X-EidosForm-Signature: sha256=<hmac>` adicionado. Usa `WEBHOOK_SECRET` env var e Web Crypto API (HMAC-SHA256).

### P1-F — DNS rebinding em webhook URL
**Status:** ✅ Já corrigido (etapas anteriores)  
**Arquivo:** `lib/webhook-validator.ts`  
**Como:** `validateWebhookUrlAsync()` resolve o hostname via `dns.promises.resolve4` e bloqueia se todos os IPs forem privados/loopback.

### P1-J — Webhook Asaas fallback heurístico
**Status:** ✅ Corrigido agora  
**Arquivo:** `app/api/webhooks/asaas/route.ts`  
**Problema:** `detectPlanAndCycle` retornava `{ plan: 'starter', cycle: 'MONTHLY' }` como fallback mesmo sem correspondência de preço, podendo ativar plano errado.  
**Correção:**
- `detectPlanAndCycle` agora retorna `null` quando o valor não corresponde a nenhum preço conhecido.
- No handler PAYMENT_CONFIRMED/PAYMENT_RECEIVED: se não há `checkoutLink` e `detectPlanAndCycle` retorna null, loga erro com `logError` e faz `break` sem ativar plano.

### P1-K — Migrations RLS conflitantes
**Status:** ✅ Corrigido agora  
**Arquivos marcados como obsoletos:**
- `supabase/migrations/20260318_public_access_rls.sql` — adicionado header OBSOLETE
- `supabase/migrations/20260327_fix_p0_rls_responses.sql` — adicionado header OBSOLETE
- `supabase/migrations/20260327_fix_rls_p0_v2.sql` — adicionado header OBSOLETE
- `supabase/migrations/20260327_fix_rls_response_leak.sql` — adicionado header OBSOLETE
- `supabase/migrations/20260327_fix_response_visibility_rls.sql` — adicionado header OBSOLETE

Todas apontam para a migration definitiva: `20260428_consolidate_rls_policies.sql` (com posterior `20260430_fix_rls_responses_answer_items_profiles.sql`).

---

## P2 — Itens Prioritários

### P2-E — API key em plaintext
**Status:** ✅ Corrigido agora  
**Arquivo:** `lib/api-key-auth.ts`  
**Problema:** Havia fallback para busca por `api_key` em plaintext na tabela `profiles`. A migration `20260428_hash_api_keys.sql` já limpou todos os valores plaintext (SET api_key = NULL).  
**Correção:** Removido o bloco de fallback legacy. Agora usa exclusivamente `verify_api_key_hash` RPC (SHA-256). Se o RPC não encontrar, retorna 401 diretamente.

### P2-N — Race condition em response count
**Status:** ✅ Já corrigido (etapas anteriores)  
**Arquivo:** `lib/plan-limits.ts:86-123`  
**Como:** Usa `check_and_increment_response` RPC que faz check + increment atômicos via SQL (`20260428_atomic_response_count.sql`).

### P2-G — Dashboard select(*) + count em memória
**Status:** ✅ Já corrigido (etapas anteriores)  
**Arquivo:** `app/(dashboard)/forms/page.tsx`  
**Como:** Seleciona apenas colunas necessárias; usa `get_response_counts_by_forms` RPC para contagem agregada.

### P2-F — handleDowngrade carrega todas responses
**Status:** ✅ Já corrigido (etapas anteriores)  
**Arquivo:** `lib/plan-limits.ts:191-204`  
**Como:** Usa `get_response_counts_by_forms` RPC com SQL aggregate — não carrega responses em memória.

### P2-O — Builder PATCH sem limite de payload
**Status:** ✅ Já corrigido (etapas anteriores)  
**Arquivo:** `app/api/forms/[id]/route.ts:73-77`  
**Como:** Verifica `JSON.stringify(body).length > 500 * 1024` e retorna 413.

### P2-I — /api/forms/[id]/export sem rate limit
**Status:** ✅ Já corrigido (etapas anteriores)  
**Arquivo:** `app/api/forms/[id]/export/route.ts:57-65`  
**Como:** Usa `checkRateLimitAsync` com limite de 10 req/min por usuário.

---

## Resumo das alterações nesta sessão

| Arquivo | Alteração |
|---|---|
| `app/api/webhooks/asaas/route.ts` | P1-J: `detectPlanAndCycle` retorna null; handler não ativa plano sem match |
| `lib/api-key-auth.ts` | P2-E: Removido fallback plaintext; só usa `verify_api_key_hash` RPC |
| `supabase/migrations/20260318_public_access_rls.sql` | P1-K: Marcado OBSOLETE |
| `supabase/migrations/20260327_fix_p0_rls_responses.sql` | P1-K: Marcado OBSOLETE |
| `supabase/migrations/20260327_fix_rls_p0_v2.sql` | P1-K: Marcado OBSOLETE |
| `supabase/migrations/20260327_fix_rls_response_leak.sql` | P1-K: Marcado OBSOLETE |
| `supabase/migrations/20260327_fix_response_visibility_rls.sql` | P1-K: Marcado OBSOLETE |
