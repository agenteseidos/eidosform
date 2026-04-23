## Handoff — Toin → Sidney — 2026-04-22 21:55 GMT-3

### Demanda
Adicionar PIX e Boleto como métodos de pagamento no checkout do EidosForm.

### O que foi feito
1. **`lib/asaas.ts`** — `billingTypes` alterado de `['CREDIT_CARD']` para `['CREDIT_CARD', 'PIX', 'BOLETO']`
2. **Migration** — `supabase/migrations/20260422_payment_method_column.sql` cria coluna `payment_method TEXT` na tabela `billing_checkouts` (ainda precisa ser aplicada manualmente no Supabase — não há DB access neste ambiente)
3. **`app/api/checkout/[plan]/route.ts`** — Upsert salva `payment_method: null` na criação do checkout
4. **`app/api/webhooks/asaas/route.ts`** — `updateCheckoutLink` agora aceita `billingType` e salva na coluna `payment_method` quando recebido do webhook
5. **`components/billing-plans.tsx`** — Cards de planos pagantes exibem "💳 Cartão · ⚡ PIX · 📄 Boleto" abaixo do botão CTA
6. **Webhooks** — Confirmado que `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED` já tratam PIX e Boleto igual cartão (sem mudança necessária)
7. **TypeScript** — Build passa sem erros
8. **Commit & push** — `69b5bcb` em `main`

### Arquivos alterados
- `lib/asaas.ts` (1 linha)
- `app/api/checkout/[plan]/route.ts` (1 campo no upsert)
- `app/api/webhooks/asaas/route.ts` (billingType no updateCheckoutLink)
- `components/billing-plans.tsx` (indicadores de pagamento nos cards)
- `supabase/migrations/20260422_payment_method_column.sql` (novo)

### Pendências
- ⚠️ **Migration precisa ser aplicada manualmente** no Supabase: `ALTER TABLE billing_checkouts ADD COLUMN IF NOT EXISTS payment_method TEXT;`
- Testar PIX e Boleto em sandbox do Asaas

### Próximo passo
- Sidney aplica a migration no Supabase e testa o checkout
