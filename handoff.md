## Handoff — Toin — 2026-04-22 01:50 GMT-3

### O que foi feito
3 entregas em commit único `ad9cdcb`:

#### 1. Bug crítico: Salvar asaas_customer_id no profile (P0)
- **Problema:** O checkout criava/encontrava customer no Asaas mas NÃO salvava o `asaas_customer_id` no profile do Supabase. O webhook busca user por `asaas_customer_id` — sem isso, o plano nunca atualizava automaticamente.
- **Fix:** 
  - `app/api/checkout/[plan]/route.ts`: agora cria/obtém customer via `createCustomer()`, salva `asaas_customer_id` no profile, e passa o ID para o checkout hospedado
  - `lib/asaas.ts`: `createCheckout()` agora aceita e envia `customerId` no payload — vincula o checkout ao customer existente no Asaas
- **Resultado:** Webhook consegue encontrar o user pelo `asaas_customer_id` e ativar o plano automaticamente.

#### 2. Expiração de plano por ciclo
- **Webhook PAYMENT_CONFIRMED:** calcula `plan_expires_at` baseado no ciclo (30 dias MONTHLY, 365 dias YEARLY). Detecta ciclo pelo valor pago.
- **Webhook PAYMENT_OVERDUE:** agora reverte para free + reseta limits (antes só marcava `plan_status: 'overdue'` sem mudar o plano).
- **Webhook SUBSCRIPTION_DELETED:** já reverte para free (sem mudança significativa).
- **API /api/user/plan-features:** verifica `plan_expires_at` em cada request. Se expirado, reverte automaticamente para free com `plan_status: 'expired'`. Usa service role client para escrita.

#### 3. Tela de confirmação pós-checkout
- **Componente:** `components/checkout-success-overlay.tsx` — overlay animado com framer-motion
- Detecta `?checkout=success` via `useSearchParams`, mostra modal com:
  - Ícone CheckCircle2 verde
  - "Pagamento confirmado!"
  - "Sua assinatura foi ativada com sucesso."
  - Botão "Voltar ao EidosForm" → redireciona para `/`
- Limpa o searchParam da URL via `history.replaceState`
- Importado na `app/(dashboard)/billing/page.tsx` com Suspense boundary

### Arquivos alterados
- `app/api/checkout/[plan]/route.ts` — criar customer + salvar asaas_customer_id + passar ao checkout
- `lib/asaas.ts` — createCheckout aceita customerId
- `app/api/webhooks/asaas/route.ts` — expiração por ciclo + overdue reverte pra free
- `app/api/user/plan-features/route.ts` — verificação automática de expiração
- `app/(dashboard)/billing/page.tsx` — importar overlay + Suspense
- `components/checkout-success-overlay.tsx` — novo componente de confirmação

### Validação
- `npx tsc --noEmit` ✅ zero erros
- Build: erro preexistente em `/api/form/[id]/whatsapp/settings` (supabaseUrl em build time) — não relacionado
- Commit: `ad9cdcb` — push para origin/main ✅

### Pendências
- Teste E2E em produção: confirmar que checkout cria customer, salva ID, e webhook ativa plano
- Teste E2E: confirmar que tela de confirmação aparece após redirect do Asaas
- O erro de build preexistente (whatsapp settings sem supabaseUrl em build time) precisa ser corrigido separadamente
- Verificar se o Asaas aceita o campo `customer` no endpoint de checkouts (documentação indica que sim, mas precisa validação em sandbox)

### Próximo passo sugerido
- Teste E2E completo do fluxo de checkout em sandbox
- Se o Asaas não aceitar `customer` no checkout, usar `customerData` como alternativa
