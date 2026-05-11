# Correções P3 — EidosForm

**Data:** 2026-04-30  
**Status:** ✅ Concluído

---

## P3 verificados como JÁ CORRIGIDOS (antes desta sessão)

| ID | Achado | Evidência |
|---|---|---|
| P3-B | cookie `__lastActivity` httpOnly: false | `lib/auth.ts:49` tem `httpOnly: true` (corrigido na Etapa 4) |
| P3-G | `incrementResponseCount` fire-and-forget | `app/api/responses/route.ts` usa `checkAndIncrementResponseCount` (atômico) |
| P3-L | CSV injection client-side em responses-dashboard | `components/responses/responses-dashboard.tsx:484` já neutraliza fórmulas com `"'" + raw` |
| S1-P2-3 | OAuth callback sem validação de `state` | `app/auth/callback/route.ts:9` já valida path relativo (requer `/`, bloqueia `//`) |
| S1-P2-16 | `validateAllAnswers` não verifica se questionIds existem | `lib/field-validators.ts:101-105` já retorna erro `'Pergunta desconhecida'` para IDs não reconhecidos |

---

## P3 corrigidos nesta sessão

### P3-I — `lib/asaas.ts` expõe `JSON.stringify(data.errors)` em mensagem de erro
**Arquivo:** `lib/asaas.ts`  
**Correção:** `asaasFetch` agora faz `logWarn` internamente com os detalhes e lança erro genérico `Asaas API error ${res.status}` (sem conteúdo da resposta).

### P3-E + S1-P2-12 — `console.error` → `logError` em múltiplos routes
**Arquivos alterados:**
- `lib/auth.ts` — `clearAuthSession` (S1-P3-1/12)
- `app/api/admin/whatsapp/disconnect/route.ts` — 2 ocorrências
- `app/api/admin/whatsapp/status/route.ts` — 2 ocorrências
- `app/api/folders/route.ts` — 2 ocorrências
- `app/api/folders/[id]/route.ts` — 2 ocorrências
- `app/api/forms/route.ts` — 1 ocorrência
- `app/api/forms/[id]/route.ts` — 1 ocorrência
- `app/api/forms/[id]/webhook/route.ts` — 2 ocorrências
- `app/api/whatsapp/send/route.ts` — 1 ocorrência

### S1-P2-8 — GET /api/folders não retornava resposta no sucesso (bug funcional)
**Arquivo:** `app/api/folders/route.ts`  
**Correção:** Adicionado `return NextResponse.json({ folders: data })` no caminho de sucesso. Feature de listagem de pastas estava quebrada silenciosamente.

### S1-P2-9 — DELETE /api/folders/[id] não retornava resposta no sucesso (bug funcional)
**Arquivo:** `app/api/folders/[id]/route.ts`  
**Correção:** Adicionado `return NextResponse.json({ success: true })` após delete bem-sucedido.

### S1-P2-13 — Admin users usava UUID mágico `00000000-...` no IN clause vazio
**Arquivo:** `app/api/admin/users/route.ts`  
**Correção:** Query de contagem de forms agora é pulada completamente quando `profileIds` está vazio. Não há mais UUID hardcoded.

### S1-P2-14/18 — Slug regex aceitava slugs de 1 char e não exigia início alfanumérico
**Arquivos:** `app/api/forms/route.ts`, `app/api/forms/[id]/route.ts`  
**Correção:** Regex alterada de `/^[a-z0-9-]+$/` para `/^[a-z0-9][a-z0-9-]{2,60}$/` (mínimo 3 chars, máximo 61, deve começar com alfanumérico).

### S1-P2-19 — Duplicate form vazava `duplicateError?.message` ao cliente
**Arquivo:** `app/api/forms/[id]/duplicate/route.ts`  
**Correção:** `duplicateError?.message ?? 'Failed to duplicate form'` → `'Erro ao duplicar formulário'` + `logError` interno.

### S1-P2-25 — CSRF bypass silencioso quando ALLOWED_ORIGINS vazio em produção
**Arquivo:** `middleware.ts`  
**Correção:** Adicionado `logWarn` quando `NODE_ENV === 'production'` e `ALLOWED_ORIGINS` está vazio, alertando que o check está desabilitado.

### S1-P2-26 — Cache de custom domains sem limite de tamanho
**Arquivo:** `middleware.ts`  
**Correção:** `customDomainCache` agora tem limite de 1000 entradas (`CACHE_MAX_SIZE = 1000`). Entrada mais antiga é removida quando o limite é atingido.

### S1-P3-5 — CORS Allow-Headers incluía `Authorization` desnecessariamente
**Arquivo:** `app/api/responses/route.ts`  
**Correção:** `'Content-Type, Authorization, X-Response-Id'` → `'Content-Type, X-Response-Id'`. O endpoint não usa Bearer token.

### S1-P3-7 — Analytics usava `select('*')` para contagem (HEAD request)
**Arquivo:** `app/api/forms/[id]/analytics/route.ts`  
**Correção:** `select('*', { count: 'exact', head: true })` → `select('id', { count: 'exact', head: true })` nos dois COUNT queries.

### S1-P3-6 — Analytics carregava todos os timestamps de respostas em memória
**Arquivo:** `app/api/forms/[id]/analytics/route.ts`  
**Correção (parcial):** Adicionado `.limit(10000)` na query de `completedTimestamps`. Previne DoS em forms com centenas de milhares de respostas. Fix completo exigiria RPC SQL de agregação (pendência documentada).

### S1-P3-8 — File upload sem validação de tamanho client-side antes do envio
**Arquivo:** `components/form-player/question-renderer.tsx`  
**Correção:** `handleFileSelect` agora verifica `file.size > 10MB` antes de iniciar o upload, retornando erro imediato sem consumir banda do servidor.

### S1-P3-9 — Input `accept="image/*"` mais amplo que os tipos aceitos pelo servidor
**Arquivo:** `components/form-player/question-renderer.tsx`  
**Correção:** `accept="image/*,application/pdf"` → `accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"`. Alinha com o whitelist do servidor.

---

## P3 que sobraram (redesign/complexidade desproporcional)

| ID | Achado | Razão da pendência |
|---|---|---|
| P3-C | API v1 retorna `questions` JSONB completo | Nenhum campo sensível encontrado em questions; risco baixo |
| P3-D | `proration.ts` usa DAYS_IN_MONTH = 30 | Aceitável para SaaS; não vale a complexidade do fix |
| P3-F | googleSheets falha lazily no uso, não na inicialização | Arquitetural; init check causaria falha em boot sem credenciais |
| P3-H | Trigger `handle_new_user` re-declarado em schema.sql + migration | schema.sql é apenas docs; migration 20260424 tem a versão correta |
| P3-J | next.config.ts — CSP/HSTS | Auditoria confirmou OK; sem pendência |
| P3-K | Admin sem audit log para mudanças manuais de plano | Requer nova tabela + integração de logging; é feature nova |
| S1-P2-5 | responses SELECT para owners não filtra paused/is_closed | Comportamento intencional; owners devem ver respostas mesmo pausado |
| S1-P2-6 | `webhook_logs.profile_id` é TEXT sem FK | Requer migration de schema + conversão de dados existentes |
| S1-P2-15 | `validateAllAnswers` não valida primitivos vs objects | Next.js parser limita depth; sanitizeValue já processa recursivamente |
| S1-P2-20 | `sanitizeHtml` fallback SSR é escape básico | Requer `isomorphic-dompurify` — dependência nova; DOMPurify client-side cobre o render final |
| S1-P2-24 | CSP img-src permite qualquer HTTPS | Requer inventário completo de origens; mudança quebraria uploads existentes |
| S1-P2-27 | Middleware matcher exclui `/f/` do CSRF check | Sem impacto atual; nenhuma API route sob `/f/` |
| S1-P3-3 | Triplicação de endpoints WhatsApp settings | Refactoring de grande escopo; endpoints funcionam corretamente |
| S1-P3-4 | CEP rate limit via X-Forwarded-For falsificável | Plataforma (Vercel) reescreve headers de borda; risco prático baixo |
| S1-P3-6 | Analytics carrega timestamps em memória (fix completo) | Fix parcial: LIMIT 10000. Fix completo requer RPC SQL agregador |
| S1-P3-10 | Upload GET expõe `configured: true/false` | Requer autenticação; impacto muito baixo |
| S1-P3-11 | Sem endpoint admin de revogação de sessão | Nova feature; complexidade com auth.admin.signOut global |
| S1-P1-10 | Trigger SECURITY DEFINER sem SET search_path em schema.sql | schema.sql é docs; migration 20260424 já corrige na versão executável |

---

## Validação

- `tsc --noEmit`: ✅ 0 erros
- `next build`: ✅ 0 erros
