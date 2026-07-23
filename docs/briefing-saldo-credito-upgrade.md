# Briefing técnico — Feature "Saldo de crédito" em troca de plano (EidosForm × Asaas)

> Documento para análise do Codex. Objetivo: avaliar **viabilidade, arquitetura e o melhor caminho** para honrar o crédito de proration quando o crédito do plano atual **excede** o preço do novo plano, mantendo a assinatura **recorrente** — em vez do comportamento atual, que é bugado.

---

## 1. Contexto e problema

O EidosForm é um SaaS de formulários com assinatura via **Asaas** (gateway brasileiro), planos `starter/plus/professional` nos ciclos `MONTHLY`/`YEARLY`. Preços (`lib/asaas.ts` → `PLAN_PRICES`):

| Plano | Mensal | Anual |
|---|---|---|
| starter | R$49 | R$348 |
| plus | R$127 | R$1.164 |
| professional | R$257 | R$2.364 |

Ao trocar de plano, calculamos **proration** (`lib/proration.ts`): crédito dos dias restantes do plano atual abate o preço do novo plano.

```
crédito   = (preço_plano_atual / dias_do_ciclo) × dias_restantes
valor_final = max(0, preço_novo_plano − crédito)
```

**O caso-problema:** quando o usuário troca para um plano cujo preço é **menor que o crédito** (ex.: estava no **Plus anual** com ~R$1.164 de crédito e seleciona **Professional mensal** R$257), `valor_final <= 0`. Hoje isso cai num caminho especial ("crédito cobre tudo") que **ativa o novo plano sem criar assinatura recorrente nova** e cancela a antiga. Resultado: o usuário fica num plano ativo **sem nenhuma cobrança futura** (vazamento de receita) — e isso já causou um bug grave (ver §3).

**O que queremos (padrão de mercado, ver §4):** manter a assinatura **recorrente** e **honrar o crédito** (não cobrar enquanto o crédito "vale"), depois voltar a cobrar normal.

---

## 2. Arquitetura atual (estado real do código)

### 2.1 Fluxo de pagamento
- **100% Checkout Hospedado do Asaas** (`POST /checkouts`, ver `lib/asaas.ts:createCheckout`). O cartão é digitado **na página do Asaas**; o app **nunca recebe o cartão nem o token**. Payload: `billingTypes:['CREDIT_CARD']`, `chargeTypes:['RECURRENT']`, `subscription:{value, nextDueDate, cycle, description}`.
- O app só recebe de volta um `checkout.id` e a URL de redirect. A **assinatura** (e seu `subscription_id`) chegam depois via **webhook** (`PAYMENT_CONFIRMED`) ou pelo **polling** (`GET /api/checkout/status`, que consulta o Asaas).
- **NÃO há captura nem armazenamento de `creditCardToken`** em lugar nenhum (grep no código: zero ocorrências).

### 2.2 Persistência (Supabase/Postgres)
- `profiles`: `plan`, `plan_status`, `plan_cycle`, `plan_expires_at`, `asaas_customer_id`, `asaas_subscription_id`, `responses_limit`, `responses_used`, `limit_alert_sent`.
- `billing_checkouts`: `plan`, `cycle`, `status`, `asaas_subscription_id`, `asaas_customer_id`, `last_event`, e campos de proration (`original_price`, `proration_credit`, `final_price`, `payment_method`).
- `asaas_webhook_events`: idempotência + DLQ (`status`, `error`, `attempts`, `customer_id`, `subscription_id`, `last_attempt_at`).
- RLS ativa: o usuário **não** pode alterar `plan/plan_status/asaas_*` no próprio profile → escritas de billing usam **service-role**.

### 2.3 Infra (relevante para "agendamento")
- **Vercel serverless** (Next.js 16) + **VPS própria** só para o serviço de WhatsApp.
- **NÃO existe cron/scheduler** no projeto: sem `app/api/cron`, sem `crons` no `vercel.json`. Qualquer solução que precise rodar "no fim do período" precisa criar essa infra (Vercel Cron + `CRON_SECRET`, ou lógica lazy disparada por outro evento).

### 2.4 Lógica de troca de plano (`app/api/checkout/[plan]/route.ts`)
- `isCycleChange = profile.plan === plan && profile.plan_cycle !== cycle`
- `isPlanUpgrade = profile.plan !== plan && isUpgrade(profile.plan, plan)` (compara índice em `PLAN_ORDER = ['free','starter','plus','professional']`)
- `shouldApplyProration = isCycleChange || isPlanUpgrade`
- **Downgrade** (`profile.plan !== plan && !isPlanUpgrade`): hoje **apenas retorna uma mensagem** `"Downgrades são processados ao final do período atual"` — **NÃO agenda nem aplica nada**. Ou seja: o "agendamento ao fim do período" **não existe de fato** no sistema hoje.
- Se `shouldApplyProration` e há `asaasSubscriptionId`:
  - **`finalPrice <= 0`** → caminho "crédito cobre tudo" (linhas ~144-219): atualiza profile pro novo plano (`plan_status='active'`, `plan_expires_at = now + ciclo`), **cancela a sub antiga no Asaas**, **zera `asaas_subscription_id`**, registra `billing_checkouts` como `paid/PRORATION_CREDIT_COVERED`, retorna `{status:'success', coveredByCredit:true}`. **Não cria assinatura nova.**
  - **`finalPrice > 0`** → cria um Checkout Hospedado com `customValue = finalPrice` (cobra a diferença). A sub antiga é cancelada no `PAYMENT_CONFIRMED` do webhook (com guarda de mismatch).

---

## 3. Bug que originou esta investigação (já corrigido, mas relevante)

No caminho `finalPrice <= 0`, ao **cancelar a sub antiga** e **zerar `asaas_subscription_id`**, o Asaas emite `SUBSCRIPTION_DELETED`/`SUBSCRIPTION_INACTIVATED`. O handler do webhook **rebaixava o usuário para `free`** porque a guarda anti-mismatch só protegia quando `asaas_subscription_id` era **não-null** (falhava aberta com null).

**Correções já deployadas:**
1. Guarda de **match estrito** nos handlers de reversão: só reverte se `evento.subscription === profile.asaas_subscription_id` (commit `168b2f2`).
2. **Error-check** no update do caminho credit-covered: `.select('id')` + checagem; em falha aborta 500 **antes** de cancelar a sub antiga (commit `5d5cde6`).

> Esses fixes pararam o sangramento, mas o **design** do caminho credit-covered continua errado (deixa o usuário sem assinatura recorrente). É o que este briefing quer resolver.

---

## 4. Como o mercado resolve (pesquisa Stripe/Chargebee)

- A assinatura **continua ativa e recorrente** — não para.
- O excedente vira um **"saldo de crédito" (customer credit balance)** na conta.
- Esse saldo é **abatido automaticamente das próximas faturas**, uma a uma, até zerar; depois cobra normal.
- Créditos **não** são reembolsados automaticamente (ficam como crédito).

Refs: [Stripe Prorations](https://docs.stripe.com/billing/subscriptions/prorations) · [Chargebee Proration](https://www.chargebee.com/subscription-management/handle-prorations/)

---

## 5. Capacidades e limitações do Asaas (pesquisa)

**Suporta (mecanismo existe):**
- Criar assinatura via **API** com `creditCardToken` (cartão salvo) **em vez** de `creditCard`+`creditCardHolderInfo`. Token é **por cliente** (não cruza clientes).
- `nextDueDate` **futuro** → assinatura criada **sem cobrança imediata**.
- `PUT /v3/subscriptions/{id}/creditCard` → atualizar cartão **sem cobrança imediata**.
- **Tokenização** precisa estar **ativa** na conta para alterar valor/vencimento de assinatura.

Refs: [Criar assinatura com cartão](https://docs.asaas.com/reference/criar-assinatura-com-cartao-de-credito) · [Tokenização](https://docs.asaas.com/reference/tokenizacao-de-cartao-de-credito)

**LACUNA CRÍTICA / ponto em aberto:**
- Nosso fluxo é **Checkout Hospedado**; o token do cartão fica no Asaas, **não no nosso código**.
- **A doc NÃO confirma** se dá para **recuperar o `creditCardToken`** de uma assinatura criada via Checkout Hospedado (GET subscription retorna o token? existe endpoint para obter o token salvo do cliente?). **Precisa ser confirmado** via teste no sandbox ou suporte Asaas.
- Não confirmado se a **tokenização está ativa** na conta do Instituto Eidos.

---

## 6. Os três caminhos (para o Codex avaliar/escolher/refinar)

### Caminho A — Agendar a troca para o fim do período (mais simples, sem token)
Quando o crédito cobre o novo plano, **não trocar na hora**: manter o plano atual (já pago) até `plan_expires_at`, e então aplicar o novo plano.
- **Prós:** não precisa de token de cartão; honra o crédito naturalmente; elimina o cancelamento-fantasma.
- **Contras:** a troca não é imediata (UX); **exige construir o agendamento que hoje não existe** (sem cron). Opções: Vercel Cron diário que processa `plan_expires_at <= now`; ou lógica "lazy" no login/no webhook de renovação; ou no próprio fluxo de renovação do Asaas.
- **Pergunta:** como aplicar a troca no vencimento sem cron dedicado? A renovação recorrente do Asaas continua cobrando o **plano antigo** — como interceptar para trocar o valor/plano no ciclo seguinte?

### Caminho B — Adiar a 1ª cobrança via token salvo (médio)
Criar **nova assinatura recorrente** para o novo plano via API, reusando `creditCardToken`, com `nextDueDate` empurrado para frente pelo tempo que o crédito cobre (`dias = crédito / preço_diário_do_novo_plano`). Depois disso, cobra normal. Cancelar a sub antiga.
- **Prós:** mantém recorrência; honra o crédito "no tempo"; sem digitar cartão de novo.
- **Contras / bloqueios:** depende de **recuperar o token** (ponto em aberto §5) + **tokenização ativa**. Migrar parte do fluxo de "Checkout Hospedado" para "API com token".
- **Perguntas:** dá pra obter o token de uma sub feita por Checkout Hospedado? O arredondamento de "dias cobertos" é aceitável vs. abater valor exato? O que fazer com o "resto" (crédito que não completa um ciclo inteiro)?

### Caminho C — Carteira de crédito completa (mais fiel ao Stripe, mais complexo)
Guardar um **saldo de crédito** (coluna/tabela nova + ledger) e abater de **cada fatura**.
- **Contras:** Asaas cobra **valor fixo por ciclo** numa assinatura recorrente; abater por fatura exigiria, a cada ciclo, **ajustar o valor da próxima cobrança** (precisa tokenização) ou usar mecanismo de desconto do Asaas — bem mais engenharia, mais pontos de falha, e ainda depende do token.
- **Pergunta:** vale a complexidade vs. Caminho B (que é "saldo em tempo" em vez de "saldo em valor")?

### ⭐ Caminho D — Editar a assinatura EXISTENTE (RECOMENDADO — análise Codex 2026-06-05)
Quando `finalPrice <= 0`: **NÃO cancelar** a assinatura. Fazer `PUT /v3/subscriptions/{asaasSubscriptionId}` alterando a própria assinatura para o novo plano.
- **Body:** `value` = preço do novo plano; `cycle` = novo ciclo; `nextDueDate` = data futura coberta pelo crédito; `description` = novo plano; `externalReference` = `profile:<id>:plan-change:<n>`; `updatePendingPayments = true`.
- Atualizar `profiles` para o novo plano; **MANTER `asaas_subscription_id`** (não zerar); registrar proration em `billing_checkouts`.
- **"Saldo em tempo":** `dias_cobertos = round(credito / (preço_novo / dias_do_ciclo_novo))`; `nextDueDate = hoje + dias_cobertos`. Ex.: crédito R$1.164, Professional mensal R$257 → preço/dia ≈ 8,57 → ~136 dias → primeira cobrança daqui a 136 dias; depois cobra normal.
- **Prós:** menor diff; **sem cron**; **sem recuperar token** (a sub já tem o cartão); **não cancela** (mata o bug de raiz); **mantém recorrência**; encaixa no modelo do Asaas. É **melhor que A/B/C**.
- **Bloqueio / pré-requisito:** a conta precisa ter **tokenização ATIVA** (a doc indica que para alterar valor/vencimento de assinatura é necessário; **não** precisa informar o token para editar). Sandbox já tem; **produção exige habilitação pelo gerente Asaas** → **bloqueador de go-live**, confirmar antes. Refs: [Update subscription](https://docs.asaas.com/reference/update-existing-subscription) · [Subscriptions via credit card](https://docs.asaas.com/docs/cobrancas-via-cartao-de-credito).
- **Validação obrigatória antes de implementar (gate):** confirmar no **sandbox** que `PUT /v3/subscriptions/{id}` funciona numa assinatura **criada via Hosted Checkout** (altera value/cycle/nextDueDate de fato — conferir com GET depois). Se passar, implementar Caminho D. Se falhar por tokenização/permissão: fallback A (agendar) → B (novo checkout/cartão) → C (carteira), nessa ordem.

### Plano de implementação do Caminho D (pendente validação sandbox)
1. **Gate sandbox:** `PUT /v3/subscriptions/{id}` numa sub criada por Hosted Checkout → confirmar via GET.
2. **Tokenização:** confirmar ativa em sandbox **e** produção (suporte/gerente Asaas).
3. `lib/asaas.ts`: nova função `updateSubscription(id, { value, cycle, nextDueDate, description, externalReference, updatePendingPayments })`.
4. `lib/proration.ts`: helper `daysCoveredByCredit(credit, newPlan, newCycle)` = `round(credit / (planPrice/daysInCycle))`; `nextDueDate = hoje + dias`.
5. `app/api/checkout/[plan]/route.ts`, ramo `finalPrice <= 0`: trocar "cancelar + ativar + zerar sub" por "**updateSubscription** + ativar profile (MANTENDO `asaas_subscription_id`) + audit em `billing_checkouts`". Manter **error-check** e **idempotência**.
6. **Edge cases:** usuário troca de novo antes do `nextDueDate` (recalcular sobre o crédito restante / `nextDueDate` vigente); cancelamento durante o período coberto; refund/chargeback; operação rodar 2x.
7. **Testes + E2E sandbox:** criar sub → PUT → conferir `value/cycle/nextDueDate` → validar que a próxima cobrança só ocorre após o `nextDueDate`.

> **Recomendação consolidada (Claude + Codex):** ir de **Caminho D**, com o **teste sandbox do PUT como portão**. A/B/C viram fallback só se o PUT não funcionar numa sub de Hosted Checkout ou se a tokenização não puder ser ativada em produção.

---

## 7. Perguntas específicas para o Codex

1. **Viabilidade do token:** confirmar (via doc/sandbox/suporte) se dá para **recuperar e reutilizar** o `creditCardToken` de uma assinatura criada por **Checkout Hospedado**. Isso decide se o **Caminho B** está aberto. Como testar isso no sandbox de forma mínima?
2. **Melhor caminho** dado: (a) Asaas (valor fixo por ciclo, token por cliente, Checkout Hospedado atual), (b) infra **sem cron** (Vercel serverless + sem scheduler), (c) prioridade de **não perder receita recorrente** e **não quebrar contas**.
3. **Caminho A sem cron:** existe forma robusta de aplicar a "troca agendada" no fim do período sem criar um scheduler? (ex.: ao receber o `PAYMENT_*` de renovação, ou lazy no acesso). Riscos?
4. **Edge cases a cobrir** em qualquer caminho: usuário troca de plano de novo **antes** do crédito acabar; reembolso/chargeback durante o período coberto; interação ciclo×tier (anual→mensal de tier maior, como o caso real); cancelamento durante o período coberto; idempotência (a operação roda 2x).
5. **Migração de fluxo:** o Caminho B exige sair parcialmente do Checkout Hospedado para criação de assinatura via API com token. Qual o **menor diff** possível para isso sem reescrever o fluxo de primeira compra (que pode continuar em Checkout Hospedado)?
6. **Decisão de produto vs. técnica:** "saldo em tempo" (Caminho B, pula cobranças) vs. "saldo em valor" (Caminho C, abate por fatura) — qual é aceitável para o usuário e contabilmente?

---

## 8. Arquivos/pontos de código relevantes

- `app/api/checkout/[plan]/route.ts` — lógica de troca, proration, caminho `finalPrice<=0` (~144-219), downgrade que só avisa (~105-111).
- `lib/proration.ts` — `calculateProrationCredit`, `calculateUpgradePrice`, `isUpgrade`.
- `lib/asaas.ts` — `createCheckout` (Hosted Checkout), `getSubscription`, `getCustomerSubscriptions`, `cancelSubscription`, `PLAN_PRICES`. **(não há criação de assinatura via API com token hoje)**
- `app/api/webhooks/asaas/route.ts` — `PAYMENT_CONFIRMED` (ativa + cancela sub antiga), `SUBSCRIPTION_DELETED`/`SUBSCRIPTION_INACTIVATED`/refund (reversão com match estrito).
- `app/api/checkout/status/route.ts` — polling/ativação (service-role).
- Schema: `profiles`, `billing_checkouts`, `asaas_webhook_events`.

## 9. Restrições não-funcionais
- Toca em **dinheiro** → idempotência, error-check em todo update, nunca cancelar sub sem garantir ativação.
- RLS: escritas de billing por **service-role**.
- Webhook responde **200** mesmo em erro (anti retry-storm) + DLQ para reprocesso.
- Sem segredos em log. Sandbox tem cota de 30k req/12h (cuidado com loops em testes).
