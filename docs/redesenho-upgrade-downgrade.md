# Redesenho de upgrade/downgrade (pós-tokenização) — EidosForm/Asaas

> Status: **PROJETO** (aguardando tokenização prod — protocolo Asaas 1238651). Implementar + testar
> quando a tokenização ligar. Base: parecer do Codex 2026-06-09 + achado de produção.

## O problema (achado em produção 2026-06-09)
O Asaas de **produção** retorna `400 invalid_value` em `PUT /subscriptions/{id}` mudando `value`:
> *"Não é possível alterar o valor de assinaturas via cartão de crédito que já possuam faturas pagas."*

No **sandbox** isso NÃO é bloqueado → o bug ficou invisível. Implicação: **todo fluxo que edita o
valor de uma sub-cartão já paga é inválido em produção** — incluindo:
- **upgrade via proration-checkout** (cria a sub no valor prorateado e a auto-correção p/ o preço
  cheio falha → desconto eterno);
- **downgrade / Caminho D** (edita o valor da sub via `updateSubscription`);
- qualquer "corrigir valor recorrente depois".

⚠️ **Validar com o Asaas** (chamado aberto): a regra vale para downgrade também? Há alguma forma
oficial de alterar o valor recorrente? (Se houver, simplifica o redesenho.)

## Modelo CORRETO (Codex) — depende de tokenização
Não editar o valor da sub. **Cancelar a antiga e criar uma NOVA no preço certo, com o cartão salvo
(`creditCardToken`).** A diferença vira um **pagamento avulso** (não assinatura).

### Upgrade pago (ex.: Starter → Plus)
1. Cobrar a **diferença** (proration) como **pagamento avulso** (`POST /payments`, `creditCardToken`).
2. Quando o avulso **confirmar** (webhook):
   - cancelar a assinatura antiga;
   - criar **nova assinatura no preço CHEIO** (R$127) com `creditCardToken` e `nextDueDate` = fim do
     ciclo atual (o crédito/tempo já pago cobre até lá);
   - ativar o plano novo (reusar `activatePaidSubscription`);
   - reconcile (1 sub ACTIVE).
3. **Sem token → NÃO oferecer upgrade prorateado.** Alternativas (com texto honesto):
   - cobrar **preço cheio** via novo checkout (pior CX, mas válido); ou
   - **agendar** o upgrade p/ o próximo ciclo (sem cobrança agora, seguro).

### Downgrade (ex.: Plus → Starter)
- Mesma ideia: cancelar a sub Plus + criar sub Starter no preço cheio (R$49) com `creditCardToken`,
  `nextDueDate` = fim do período já pago (saldo vira tempo). **NÃO editar o valor da sub Plus.**
- Sem token → agendar p/ o próximo ciclo (cancela no fim do período + cria a nova).

### Troca de ciclo (mensal ↔ anual)
- Idem: cancelar + criar nova no ciclo/preço certo via token.

## Caminho D (crédito cobre tudo)
Hoje edita a sub existente (`updateSubscription` value + nextDueDate) → **provavelmente bloqueado em
prod** (mesma regra). Redesenhar p/ cancelar+recriar via token também. **Bloquear até confirmar.**

## NÃO usar
- `discount` na 1ª cobrança (sem prova oficial de que aplica 1× e a recorrência volta ao cheio —
  vira outra versão do desconto eterno).
- Auto-correção de valor recorrente pós-pagamento (provado que falha em prod).

## Dependências / pré-requisitos
1. **Tokenização prod ativa** (`creditCardToken` retornado) — protocolo 1238651.
2. **Backstop + reconcile crons** rodando (já implementados, ativar com `BILLING_RECONCILE_ACTIONS=true`).
3. Confirmação do Asaas sobre o alcance da regra (downgrade? alternativa oficial?).

## Plano de teste (quando tokenização ligar)
1. Compra Starter mensal → confirmar `asaas_card_token` capturado.
2. Upgrade Starter→Plus (avulso da diferença + sub nova cheia) → confirmar **recorrente = R$127**.
3. Downgrade Plus→Starter → confirmar **recorrente = R$49**, saldo vira tempo.
4. Cancelar + estornar + limpar.
5. Religar os fluxos (remover qualquer bloqueio temporário, se houver).
