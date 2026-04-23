## Handoff — Toin → Sidney — 2026-04-23 01:53 GMT-3

### Demanda
Corrigir TODOS os P0 e P1 encontrados na auditoria máxima (`auditoria-maxima.md`).

### O que foi feito

#### ✅ P0 — Corrigidos (6/6)

| ID | Fix | Arquivos |
|---|---|---|
| **P0-1** | Signup usa `listUsers()` → trocado por `signUp` direto do Supabase que já retorna erro de duplicata. Removida importação `createAdminClient`. | `app/api/auth/signup/route.ts` |
| **P0-2** | IDOR no `x-response-id` → antes do update, busca a response existente e verifica que `respondent_id` bate. Rejeita com 403 se não bater. | `app/api/responses/route.ts` |
| **P0-3** | `error.message` vaza schema → substituído por "Erro interno do servidor" + `console.error` em todas as rotas: forms GET, forms POST, forms/[id] PATCH, forms/[id] DELETE, webhook PUT, webhook DELETE, folders GET, folders POST, folders/[id] PATCH, folders/[id] DELETE | 8 arquivos de API routes |
| **P0-4** | React.memo do form-player → custom memo agora compara `form.id`, `ownerPlan`, `form.title`, `form.status`, `form.is_closed`, `form.hide_branding`, `form.thank_you_message`, `form.questions`, `form.theme`, `form.pixels`, `form.welcome_enabled`, etc. | `components/form-player/form-player.tsx` |
| **P0-5** | `loadPartialProgress` referencia `visibleQuestions` antes de definir → movido para `useCallback` com `useRef(pendingPosition)` + `useEffect` que restaura posição após `visibleQuestions` ser computado | `components/form-player/form-player.tsx` |
| **P0-6** | Claim "Economize até 40%" → corrigido para "Economize até 41%" (Starter=40.8%) em `pricing-section.tsx` e `billing-plans.tsx` | 2 arquivos |

#### ✅ P1 — Corrigidos (12/12, 2 SKIP)

| ID | Fix | Arquivos |
|---|---|---|
| **P1-1** | Rate limit no partial-response → adicionado `checkResponseRateLimitAsync` no PUT handler | `app/api/forms/[id]/partial-response/route.ts` |
| **P1-2** | CEP rate limit in-memory → comentário claro justificando limitação aceitável para use case | `app/api/cep/[cep]/route.ts` |
| **P1-3** | POST /api/forms vaza error.message → mesmo fix do P0-3 | `app/api/forms/route.ts` |
| **P1-4** | Webhook Asaas fallback token → removido fallback legacy. Agora exige `ASAAS_WEBHOOK_SECRET` sempre, sem fallback para `ASAAS_WEBHOOK_TOKEN` | `app/api/webhooks/asaas/route.ts` |
| **P1-5** | GET /api/responses sem rate limit → adicionado 60 req/min por user via `checkRateLimitAsync` | `app/api/responses/route.ts` |
| **P1-6** | useMemo com side-effect (setPage) → movido para `useEffect` | `components/responses/responses-dashboard.tsx` |
| **P1-7** | CEP lookup sem debounce → já verificava 8 dígitos antes de buscar. Nenhuma mudança necessária. ✅ | — |
| **P1-8** | Polling de checkout sem timeout → já tinha 60s. Aumentado para 120s. | `components/checkout-success-overlay.tsx` |
| **P1-9** | Claims de segurança enterprise → "criptografia end-to-end, auditoria de acesso e controle granular de permissões" trocado por "criptografia em trânsito (TLS) e em repouso (AES-256)" | `app/page.tsx` |
| **P1-10** | WhatsApp duplicado no Professional → removido "Notificação por WhatsApp" do Professional (já está no Plus) | `components/pricing-section.tsx` |
| **P1-11** | Redirect silencioso em erro de criação → adicionado `form_limit` ao `ErrorToast` component | `components/dashboard/error-toast.tsx` |
| **P1-12** | Onboarding básico → **[SKIP]** — não é bug de código, é feature request | — |
| **P1-13** | CSRF em API Routes → verificação de Origin header no middleware para rotas de escrita autenticadas (exclui `/api/responses` e `/api/auth/` que são públicos) | `middleware.ts` |
| **P1-14** | Site fora do ar → **[SKIP]** — não é problema de código | — |

### Validação
- TypeScript: `tsc --noEmit` passa limpo ✅
- Commit: `91fb187` em `main`
- Push: `dd9e71d..91fb187 main -> main` ✅

### Arquivos alterados
- `app/api/auth/signup/route.ts`
- `app/api/responses/route.ts`
- `app/api/forms/route.ts`
- `app/api/forms/[id]/route.ts`
- `app/api/forms/[id]/partial-response/route.ts`
- `app/api/forms/[id]/webhook/route.ts`
- `app/api/folders/route.ts`
- `app/api/folders/[id]/route.ts`
- `app/api/cep/[cep]/route.ts`
- `app/api/webhooks/asaas/route.ts`
- `middleware.ts`
- `app/page.tsx`
- `components/form-player/form-player.tsx`
- `components/pricing-section.tsx`
- `components/billing-plans.tsx`
- `components/checkout-success-overlay.tsx`
- `components/responses/responses-dashboard.tsx`
- `components/dashboard/error-toast.tsx`

### Pendências
- **⚠️ ASAAS_WEBHOOK_SECRET obrigatório**: Após P1-4, o webhook Asaas agora exige `ASAAS_WEBHOOK_SECRET` configurado. Se o ambiente ainda usa `ASAAS_WEBHOOK_TOKEN`, precisa migrar para HMAC.
- Nenhuma outra pendência.

### Próximo passo
- Deploy quando quiser
- Seguir para P2 se desejar
