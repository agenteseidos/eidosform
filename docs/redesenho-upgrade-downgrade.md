# Redesenho de upgrade/downgrade (pós-tokenização) — EidosForm/Asaas

> Status: **IMPLEMENTADO em 2026-06-10** (tokenização prod liberada — protocolo Asaas 1238651).
> Aguardando o **teste único em produção** (roteiro abaixo) antes de virar as flags.
> Base: parecer do Codex 2026-06-09 + achado de produção + decisão Sidney 2026-06-10
> (modelo conservador p/ TUDO, sem depender de exceção de downgrade não confirmada).

## O problema (achado em produção 2026-06-09)
O Asaas de **produção** retorna `400 invalid_value` em `PUT /subscriptions/{id}` mudando `value`:
> *"Não é possível alterar o valor de assinaturas via cartão de crédito que já possuam faturas pagas."*

No **sandbox** isso NÃO é bloqueado → o bug ficou invisível. Implicação: **todo fluxo que edita o
valor de uma sub-cartão já paga é inválido em produção**. Por decisão de 2026-06-10, assumimos o
modelo conservador: a regra vale para QUALQUER mudança (upgrade E downgrade) — nenhum fluxo edita
valor de assinatura, nunca. (Não há chamado aberto com o Asaas sobre isso; não é necessário.)

## Modelo implementado — cancelar + recriar via token

**Nunca editar o valor da sub.** Toda mudança de plano/ciclo cancela a assinatura antiga e cria
uma NOVA no preço CHEIO com o cartão salvo (`creditCardToken`). A diferença, quando existe, é
cobrada como **pagamento avulso** (não assinatura).

### Onde está no código
| Peça | Arquivo |
|---|---|
| Executor único (cancelar+recriar, CAS, limites, reconcile) | `lib/plan-switch.ts` → `executePlanSwitch` |
| Backstop (webhook + DLQ) | `lib/plan-switch.ts` → `runPlanChangeBackstop` |
| Avulso no token + estorno fail-closed | `lib/asaas.ts` → `createPaymentWithToken`, `refundPayment` |
| Marcador do avulso (`kind:planchange`) | `lib/asaas.ts` → `buildPlanChangeReference` |
| Orquestração (lock, cobrança, refund-on-failure) | `app/api/checkout/[plan]/route.ts` |
| Gancho do webhook (avulso sem subscription) | `app/api/webhooks/asaas/route.ts` |
| Retry do backstop na DLQ | `lib/asaas-reprocess.ts` (checkout `plan_switch_token` não-pago) |
| Testes | `lib/plan-switch.test.ts` (12) + `lib/asaas-external-ref.test.ts` |

### Fluxos
1. **Mudança PAGA** (upgrade, downgrade raro com diferença, ciclo mensal→anual):
   cobra `proration.finalPrice` como avulso no token (`kind:planchange` no externalReference)
   → confirmado, `executePlanSwitch` cria a sub nova no preço CHEIO com `nextDueDate` = hoje
   + 1 ciclo (o avulso comprou um ciclo cheio começando agora) → profile trocado (CAS) →
   reconcile cancela a antiga. **Falhou a troca depois de cobrar → ESTORNA o avulso**
   (fail-closed); estorno falhou → alerta CRÍTICO + DLQ.
2. **Saldo cobre tudo** (Caminho D novo — downgrade típico — e reativação canceling):
   sem cobrança; sub nova no preço cheio com `nextDueDate` = data de cobertura do saldo
   ("saldo vira tempo", mesma fonte do preview).
3. **Backstop**: se o processo morrer entre cobrar o avulso e trocar, o `PAYMENT_CONFIRMED`
   do avulso (webhook) ou o retry da DLQ completa a troca — idempotente, serializado pelo
   mesmo lock `planchange:{profileId}`.
4. **Sem token salvo** (assinante pré-tokenização): mensagem honesta orientando o suporte —
   nunca cobra errado, nunca edita sub.
5. **Downgrade de ciclo anual→mensal**: segue a mensagem honesta (cancelar e reassinar) — sem
   mudança.

### O que foi REMOVIDO (provado que falha em prod)
- Caminho D antigo (`updateSubscription` value/nextDueDate em sub existente).
- Proration-checkout (`customValue` no hosted checkout → sub criada prorateada + auto-correção).
- O hosted checkout agora é SEMPRE preço cheio (primeira compra). A auto-correção de valor (4b
  em `billing-activation`) permanece como sentinela: se disparar, é bug — alerta/DLQ.

## Roteiro do TESTE ÚNICO em produção (compras reais; estornar no fim)

Pré: env de prod com `BILLING_MVP_ONLY=false` e `BILLING_ALLOWED_PLANS=starter,plus`
(anual continua travado; `BILLING_RECONCILE_ACTIONS` continua false durante o teste).

1. **Compra Starter mensal** (cartão real) → conferir:
   `profiles.asaas_card_token` PREENCHIDO (log `card token capturado`; se aparecer
   `card token AUSENTE`, parar aqui — tokenização não está funcional).
2. **Upgrade Starter→Plus** → conferir: avulso da diferença cobrado; sub antiga DELETADA no
   Asaas; sub nova ACTIVE com **value = R$127** e `nextDueDate` = hoje+30d; profile plan=plus.
3. **Downgrade Plus→Starter** (saldo cobre → R$0 agora) → conferir: sub Plus deletada; sub nova
   ACTIVE com **value = R$49** e `nextDueDate` = data de cobertura mostrada no preview
   (saldo vira tempo); forms excedentes pausados.
4. **Cancelar** a assinatura, **estornar** o avulso e a compra inicial no painel Asaas, e
   limpar o profile de teste.
5. Tudo ok → flags em produção na ordem: `BILLING_ALLOWED_PLANS=starter,plus,professional` →
   liberar anual (testar 1 ciclo anual depois) → `BILLING_RECONCILE_ACTIONS=true`.

## NÃO usar (decidido e mantido)
- `discount` na 1ª cobrança (risco de desconto eterno sem prova oficial).
- Edição de valor recorrente pós-pagamento (provado que falha em prod).
