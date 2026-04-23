# Handoff — Auditoria: Prorateamento de Upgrade de Planos

**Data:** 2026-04-23  
**Auditora:** Zéfa  
**Commit base:** `7ad6dfe7af546064a4bfe327b4601fa80619819e`  
**Implementador:** Zeca  

---

## Resumo

Encontrei **3 bugs P0** (críticos, bloqueiam deploy), **3 bugs P1** e **3 sugestões P2**.

A migration SQL está correta e segura. O webhook continua funcionando para pagamentos normais. Os cálculos de proration estão corretos na fórmula base.

---

## Bugs P0 — Críticos

### 1. Assinatura anterior cancelada ANTES do pagamento confirmado

- **Arquivo:** `app/api/checkout/[plan]/route.ts`, linhas ~108-118
- **Descrição:** Quando o usuário inicia um upgrade, a assinatura antiga é cancelada imediatamente no Asaas e `asaas_subscription_id` é zerado no banco — **antes** do checkout ser pago. Se o usuário abandonar o checkout ou o pagamento falhar, ele perde a assinatura antiga sem obter a nova.
- **Impacto:** Usuário pode ficar sem plano ativo. Na próxima renovação/overdue, será rebaixado para free automaticamente.
- **Correção:** Não cancelar a assinatura antiga no momento do checkout. Cancelar apenas no webhook `PAYMENT_CONFIRMED` (ou quando a nova estiver `ACTIVE`). Manter `asaas_subscription_id` até confirmação.

### 2. "Crédito cobre o novo plano" NÃO ativa o plano no backend

- **Arquivo:** `app/api/checkout/[plan]/route.ts`, linhas ~100-106
- **Descrição:** Quando `proration.finalPrice <= 0`, a rota retorna `coveredByCredit: true` com a mensagem "será ativado automaticamente", mas **nenhuma atualização é feita no banco**. O plano do usuário continua o antigo. Não há webhook, não há polling, não há nada que efetive a mudança.
- **Impacto:** O upgrade nunca acontece. O usuário acha que foi feito mas o plano não muda.
- **Correção:** Ativar o plano diretamente no backend quando `coveredByCredit`:
  - Atualizar `profiles` (plan, plan_status, plan_expires_at, limits)
  - Cancelar assinatura antiga
  - Chamar `handleUpgrade()`
  - Enviar email de ativação

### 3. Inconsistência de preços entre `PLAN_PRICES` (asaas.ts) e `PLANS` (plan-definitions.ts)

- **Arquivo:** `lib/asaas.ts` vs `lib/plan-definitions.ts`
- **Descrição:** Os preços anuais divergem:
  - `PLAN_PRICES`: yearly = `348.0`, `1164.0`, `2364.0`
  - `PLANS`: yearlyPrice = `29`, `97`, `197`
  - O `plan-definitions.ts` parece ter preços mensais com "desconto anual" (ex: R$29/mês no anual = R$348/ano, bate para starter, mas R$97×12 = R$1.164 bate para plus, e R$197×12 = R$2.364 bate para professional — então os valores estão corretos mas com semântica diferente)
  - **O problema real:** `checkout/status/route.ts` linha ~82 usa `PLAN_PRICES` para detectar ciclo pelo valor. Para upgrades prorated, o valor NÃO bate nenhum preço, e o ciclo é inferido incorretamente (`checkoutCycle ?? 'MONTHLY'`). Se o usuário fizer upgrade prorado para yearly, a expiração pode ser calculada como 30 dias ao invés de 365.
- **Impacto:** Expiração do plano errada em upgrades prorated via polling fallback.
- **Correção:** `billing_checkouts` já salva `cycle` na criação — o `persistPlanFromAsaas` já usa `checkoutCycle` como default, que está correto. O bug é mitigado mas o código de fallback por `subValue` é confuso. Documentar que `checkoutCycle` é a fonte de verdade.

---

## Bugs P1 — Importantes

### 4. Race condition: duas requisições de upgrade simultâneas

- **Arquivo:** `app/api/checkout/[plan]/route.ts`
- **Descrição:** Não há locking. Se o usuário clicar duas vezes ou tiver duas abertas, duas checkouts podem ser criados, a assinatura antiga cancelada duas vezes (segunda gera erro que é ignorado), e dois checkouts ficam pendentes. O webhook pode ativar o plano na primeira e a segunda pode sobrepor.
- **Impacto:** Dupla cobranção potencial. Plano ativado com dados do segundo checkout.
- **Correção:** Adicionar verificação de checkout pendente existente antes de criar um novo. Ou usar advisory lock no profile.

### 5. `detectPlanAndCycle` não funciona para valores prorated

- **Arquivo:** `app/api/webhooks/asaas/route.ts`, linhas ~29-42
- **Descrição:** A função fallback compara o valor de pagamento com preços exatos. Valores prorated (ex: R$102.50) nunca vão bater. Se `checkoutLink` não for encontrado (ex: DB inconsistency), o plano será detectado incorretamente.
- **Impacto:** Plano errado ativado em cenário de fallback. Baixa probabilidade mas alta severidade.
- **Correção:** Já mitigado pelo `checkoutLink.plan/cycle` ser preferido. Adicionar log de WARN quando valor não bate nenhum plano conhecido e checkout link não encontrado.

### 6. `isUpgrade` não considera ciclo (MONTHLY → YEARLY do mesmo plano)

- **Arquivo:** `lib/proration.ts`, função `isUpgrade`
- **Descrição:** Se um usuário está no `starter MONTHLY` e tenta ir para `starter YEARLY`, `isUpgrade` retorna `false` (mesmo índice no `PLAN_ORDER`). O checkout vai bloquear como "downgrade".
- **Impacto:** Usuário não pode trocar de ciclo dentro do mesmo plano. Pode ser intencional (não é upgrade de plano), mas o comportamento é confuso.
- **Correção:** Se a troca de ciclo no mesmo plano deve ser permitida, tratar como caso separado. Se não, documentar.

---

## P2 — Melhorias

### 7. Verificação redundante de `isUpgrade`

- **Arquivo:** `app/api/checkout/[plan]/route.ts`
- `isUpgrade` é chamado em dois blocos if separados (bloco de downgrade e bloco de proration). Pode ser simplificado em um único bloco.

### 8. Tipagem `BillingCycle` duplicada

- **Arquivos:** `lib/asaas.ts` e `lib/proration.ts` definem `BillingCycle` independentemente.
- **Correção:** Importar de um único lugar (ex: `lib/plans.ts`).

### 9. Testes não cobrem edge cases importantes

- Testes atuais cobrem o happy path mas faltam:
  - Upgrade com crédito > preço novo (coveredByCredit)
  - Downgrade bloqueado
  - Plano expirado
  - Cross-cycle upgrade (MONTHLY → YEARLY)
  - Valores fracionados com arredondamento

---

## O que está OK ✅

- **Migration SQL** — `IF NOT EXISTS`, NUMERIC(10,2), não altera dados existentes
- **Fórmula de proration** — `(preço / dias_total) × dias_restantes`, arredondamento para 2 casas, correto
- **Webhook para pagamentos normais** — usa `checkoutLink.plan/cycle` como preferência, fallback por valor funciona para preços normais
- **Detecção de downgrade** — corretamente bloqueada no checkout
- **Logs** — suficientes para debug
- **Tratamento de erros no cancelamento** — não bloqueia o fluxo (embora o cancelamento precoce em si seja bug P0)

---

## Veredito

**🔴 BLOQUEIA DEPLOY** — 3 bugs P0 encontrados. Corrigir P0 #1 e #2 antes de liberar. P0 #3 é baixo risco mas deve ser revisado.
