## Handoff — Zéfa — 2026-04-22 02:15 GMT-3

### O que foi feito
Auditoria completa do fluxo de checkout: revisão de 6 arquivos críticos + análise de consistência de preços + verificação de edge cases no webhook.

### Decisões tomadas
- Classificados bugs por severidade (P0/P1/P2)
- Browser sandbox indisponível — auditoria focada em código estático

### Bugs encontrados

#### P1-1: PAYMENT_OVERDUE não reseta `responses_used`
- **Arquivo:** `app/api/webhooks/asaas/route.ts` (linha ~156)
- **Descrição:** Quando pagamento fica overdue, o webhook reverte plano pra free mas NÃO reseta `responses_used`. O user fica com uso acumulado do plano pago mas limite de free (100), ficando imediatamente bloqueado.
- **Sugestão:** Adicionar `responses_used: 0` no update do PAYMENT_OVERDUE.

#### P1-2: plan-features não reseta `responses_used` na expiração automática
- **Arquivo:** `app/api/user/plan-features/route.ts` (linha ~46)
- **Descrição:** Mesmo problema do P1-1. Quando o plano expira por tempo (detetado no GET /plan-features), `responses_used` não é resetado. User fica bloqueado imediatamente com limite free.
- **Sugestão:** Adicionar `responses_used: 0` no update de reversão para free.

#### P1-3: Checkout aceita só cartão de crédito
- **Arquivo:** `lib/asaas.ts` (linha 118)
- **Descrição:** `billingTypes: ['CREDIT_CARD']` — o checkout hospedado do Asaas só oferece pagamento via cartão. PIX e boleto não estão disponíveis. Isso limita significativamente a conversão no Brasil.
- **Sugestão:** Mudar para `billingTypes: ['CREDIT_CARD', 'PIX', 'BOLETO']` ou pelo menos incluir PIX.

#### P2-1: Texto hardcoded "Ciclo reinicia em 1 de abril"
- **Arquivo:** `app/(dashboard)/billing/page.tsx` (linha 60)
- **Descrição:** O texto do ciclo é hardcoded. Sempre mostra "1 de abril" independente do plano real do usuário.
- **Sugestão:** Calcular dinamicamente baseado em `plan_expires_at` ou data de criação da assinatura.

#### P2-2: Checkout page sem Suspense boundary
- **Arquivo:** `app/(dashboard)/checkout/[plan]/page.tsx`
- **Descrição:** Usa `useSearchParams()` sem `<Suspense>` wrapper. No Next.js 14+, isso pode causar erro de hydration ou bailout.
- **Sugestão:** Envolver o componente que usa `useSearchParams` em `<Suspense>`.

#### P2-3: `yearlyPrice` em plan-limits.ts é o preço mensal equivalente, não o anual real
- **Arquivo:** `lib/plan-limits.ts`
- **Descrição:** `yearlyPrice` é o equivalente mensal (29, 97, 197) e não o preço anual total (348, 1164, 2364). O nome `yearlyPrice` é ambíguo — pode confundir desenvolvedores futuros. Atualmente só serve para display na UI, onde o billing-plans.tsx também tem o mesmo valor hardcoded, então não é fonte única de verdade.
- **Sugestão:** Renomear para `yearlyMonthlyEquivalent` ou similar, ou tornar plan-limits.ts a fonte única removendo os valores hardcoded de billing-plans.tsx.

### Zero P0 confirmado
Nenhum bug quebra o fluxo de pagamento ou perde dados de forma crítica.

### Estado atual
- Fluxo de checkout: funcional (criação de customer + redirect pro Asaas funciona)
- Webhook PAYMENT_CONFIRMED: funciona corretamente (identifica user, detecta plano, calcula expiração)
- Preços: consistentes entre asaas.ts, plan-limits.ts e billing-plans.tsx ✅
- Modal de confirmação: implementado corretamente ✅
- Expiração automática: implementada no plan-features ✅ (com caveat do responses_used)
- Reversão pra free: funciona nos 3 cenários (overdue, expired, deleted) ✅ (com caveat do responses_used)

### Arquivos alterados
- Apenas este handoff.md

### Pendências
- Corrigir P1-1, P1-2, P1-3, P2-1, P2-2, P2-3
- Teste visual no browser (sandbox indisponível nesta sessão)

### Próximo passo sugerido
- Toin corrige P1-1, P1-2 e P1-3 (prioridade)
- P2 items podem ser feitos em batch separado
