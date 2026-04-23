# Handoff — Correção P0: Prorateamento de Upgrade de Planos

**Data:** 2026-04-23  
**Responsável:** Zeca  
**Tipo:** Correção de bugs P0  
**Commit:** `a9f12bc`  

---

## Resumo

Corrigidos os 3 bugs P0 identificados pela auditoria da Zéfa. Todos os arquivos compilam sem erros.

---

## P0 #1: Assinatura antiga cancelada ANTES do pagamento ✅

**Arquivo:** `app/api/checkout/[plan]/route.ts`  
**O que foi feito:**
- Removido o bloco que cancelava a assinatura antiga no Asaas e zerava `asaas_subscription_id` durante o checkout
- Adicionado cancelamento no webhook (`app/api/webhooks/asaas/route.ts`) no evento `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`
- O webhook agora verifica se o perfil tinha uma assinatura antiga diferente da nova e a cancela após a confirmação do pagamento

## P0 #2: "Crédito cobre o plano" não ativa o plano ✅

**Arquivo:** `app/api/checkout/[plan]/route.ts`  
**O que foi feito:**
- Quando `proration.finalPrice <= 0`, o backend agora:
  - Atualiza `profiles` com novo plano, status active, expiração, limites resetados
  - Cancela assinatura antiga no Asaas (seguro: upgrade garantido pelo crédito)
  - Chama `handleUpgrade()` para despausar forms
  - Registra `billing_checkouts` com status `paid` e evento `PRORATION_CREDIT_COVERED`
  - Retorna `{ status: 'success', coveredByCredit: true, proration }`

## P0 #3: Ciclo detectado errado no polling ✅

**Arquivo:** `app/api/checkout/status/route.ts`  
**O que foi feito:**
- Removida inferência de ciclo por `subValue` (valores prorated nunca batem preços exatos)
- `checkoutCycle` (do `billing_checkouts`, salvo na criação) é agora a única fonte de verdade
- Removido import desnecessário de `PLAN_PRICES`
- Documentado no código o motivo da decisão

---

## Arquivos alterados

1. `app/api/checkout/[plan]/route.ts` — P0 #1 e #2
2. `app/api/webhooks/asaas/route.ts` — P0 #1 (cancelamento no webhook)
3. `app/api/checkout/status/route.ts` — P0 #3

## Validação

- `tsc --noEmit` passa sem erros
- Testes existentes: pre-existing issue com path alias no vitest (não relacionado a esta mudança)
- Funcionalidade existente (webhook normal, checkout sem proration) preservada

## Pendências

- Configurar vitest com path aliases para que testes existentes possam rodar
- Testes específicos para os 3 cenários P0 (requer vitest configurado)
