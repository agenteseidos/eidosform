# BRIEFING PARA AUDITORIA — âncora de cobrança na reativação após rebaixamento

Contexto: **EidosForm** (Next.js 16 / Supabase / **Asaas** / Vercel). Assinatura recorrente
mensal, **somente cartão de crédito** (decisão travada por teste: sem PIX, sem boleto).
Zero clientes pagantes hoje; 17 perfis na base. O dono não é programador.

Acabamos de concluir um teste de inadimplência **com dinheiro real** de ponta a ponta, e ele
expôs uma decisão de produto que nunca foi tomada explicitamente. Quero seu parecer sobre o
**diagnóstico**, sobre o **desenho proposto** e sobre os **riscos que eu possa não estar vendo**.

Separe, por favor, **medido × inferido × não determinado**.

---

## 1. O QUE FOI MEDIDO NO TESTE REAL

Linha do tempo, conta real do dono (`sidney@institutoeidos.com.br`, assinatura
`sub_e2a1ckw3m2m431y7`, Plus mensal R$127):

| Data | Evento |
|---|---|
| 20/08 | Fatura vence (`pay_cktw434zli25sgjz`). Não paga. |
| 21/08 | Asaas marca `OVERDUE`. Régua de cobrança começa. |
| 20/08→25/08 | **Carência de 5 dias** (`OVERDUE_GRACE_DAYS`). Acesso mantido. |
| 25/08 | **Rebaixamento real** para `free` (cota 5.000 → 100). |
| 25/08→27/08 | **Sem acesso pago.** ~2,7 dias. |
| 27/08 | Dono paga a fatura de **20/08**. Webhook `PAYMENT_CONFIRMED` em 22:07:08. |

Estado imediatamente após a reativação (lido do banco e do Asaas):

```
profiles: plan=plus  plan_status=active  responses_limit=5000
          plan_expires_at=2026-10-21T02:59:59Z   (= 20/10 23:59:59 BRT)
          asaas_subscription_id religado; overdue_subscription_id/previous_plan/downgraded_at = null

Asaas sub: status=ACTIVE  nextDueDate=2026-10-20
Cobranças: 20/08 CONFIRMED (paga hoje) · 20/09 PENDING (ainda vai cobrar no cartão salvo)
```

**A âncora não se moveu.** O pagamento quitou a fatura de AGOSTO; o ciclo seguiu em 20/09 e 20/10.

`plan_expires_at` vem de `expiryFromNextDueDate(sub.nextDueDate)` — ou seja, o acesso é concedido
até a **próxima data do ciclo**, assumindo que as faturas já geradas e ainda pendentes serão pagas.

---

## 2. O PROBLEMA

**Cobramos por um período em que o serviço estava desligado.** A fatura de 20/08 cobre
20/08→20/09; o cliente ficou sem acesso de 25/08 até pagar. No teste isso foi ~2,7 dias e não doeu.

**O caso ruim é o mesmo defeito em dose maior.** Se o cliente pagasse a fatura de 20/08 no dia
**19/09**:
- teria tido acesso de 20/08 a 25/08 (**5 dias**) e ficado no escuro **25 dias**;
- pagaria **R$127** por esse mês;
- e no dia **20/09** — no dia seguinte — a fatura seguinte cobraria **R$127 de novo** no cartão salvo.

Duas cobranças em dois dias, sendo que uma delas paga um mês majoritariamente sem serviço.
Esse cliente não reclama: ele pede estorno e conta a história.

**Contradiz uma decisão explícita do dono** (10/06/2026), que rege todo o motor de proração:
> *"dias pagos são o ativo"*

Cobrar dias em que o produto estava desligado é o oposto disso.

---

## 3. O QUE O MERCADO FAZ (pesquisa)

Três modelos; a variável decisiva é **se o serviço chegou a ser cortado**.

1. **Preservar a âncora.** Padrão quando a assinatura continua viva. Stripe mantém o
   `billing_cycle_anchor`, e não perdê-lo ao recriar assinatura é tratado como boa prática.
   Coerente quando o cliente teve acesso o tempo todo (atrasou, mas usou).
2. **Resetar no pagamento.** Stripe, ao *resume* de uma assinatura pausada, reseta a âncora e o
   default é `now`. Chargebee permite reativar com data retroativa justamente quando você *quer*
   manter o ciclo antigo — o comportamento natural é o outro.
3. **Híbrido (Zoho Billing).** Retomou **antes** da próxima data de cobrança → ciclo não muda.
   Retomou **depois** → a data é resetada para o dia da retomada.

O híbrido é exatamente a distinção que nos interessa: **carência ≠ rebaixamento**.

---

## 4. DESENHO PROPOSTO

**Regra:** a fronteira é o rebaixamento, que já existe e já é carimbado.

- **Pagou DENTRO da carência** (conta nunca foi rebaixada) → **nada muda**. Teve acesso o tempo
  todo; o ciclo segue. É o comportamento atual e está correto.
- **Pagou DEPOIS do rebaixamento** → **ciclo novo a partir do pagamento**:
  1. `nextDueDate` da assinatura passa a ser **data do pagamento + 1 ciclo**;
  2. as cobranças **PENDING/OVERDUE órfãs** dessa assinatura são **removidas**
     (senão a de 20/09 cobra de novo — é o gatilho concreto da reclamação);
  3. `plan_expires_at` passa a ser calculado a partir da nova data.

**Como saber que houve rebaixamento.** O `expire-plans` carimba `downgraded_at`,
`previous_plan` e `overdue_subscription_id` ao cortar por inadimplência.

⚠️ **ARMADILHA DE ORDEM (achado meu, quero que você confira):** a ativação no webhook **limpa
esses três campos na mesma escrita** que ativa o plano. Se a decisão for tomada depois, a prova
já foi apagada. Hoje o webhook lê `previousProfile` **antes** do update — o sinal está
disponível ali, mas o desenho precisa capturá-lo explicitamente, e não por acidente.

**Ferramentas do Asaas que existem** (verificadas na documentação):
- `PUT /subscriptions/{id}` aceita `nextDueDate` e `updatePendingPayments` — já embrulhado em
  `updateSubscription()` em `lib/asaas.ts`.
- `DELETE /payments/{id}` remove cobrança não paga. **Não temos wrapper para isso** (só
  `refundPayment`, que é para cobrança já paga).
- Remover a assinatura remove junto as pendentes/vencidas — mas aqui **não** queremos removê-la.

⚠️ **AMBIGUIDADE NÃO RESOLVIDA:** a doc diz que `nextDueDate` *"altera apenas a próxima cobrança
ainda não gerada"* e que `updatePendingPayments: true` aplica alterações às pendentes já criadas
— mas o texto fala de **valor e forma de pagamento**, sem afirmar que move a **data de
vencimento**. Não sei se `updatePendingPayments` resolve a fatura de 20/09 ou se é preciso
`DELETE` explícito. **Isso precisa de smoke test antes de virar código.**

---

## 5. RISCOS QUE EU ENXERGO

1. **Receita adiada.** Mover a âncora empurra o faturamento. Com zero pagantes é irrelevante; em
   escala, muda previsão de caixa.
2. **Apagar fatura é destrutivo e irreversível.** Se o cliente ia pagar as duas, perdemos uma.
   Contra-argumento: cobrar por período sem serviço é pior que perder a cobrança.
3. **Reentrega do webhook.** `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` chegam para o mesmo
   pagamento, e há retries. Mover a âncora **precisa ser idempotente** — mover duas vezes
   empurraria o vencimento dois meses.
4. **Corrida com a cobrança automática.** Se o pagamento cair perto do dia 20, a fatura seguinte
   pode ser cobrada no mesmo instante em que decidimos removê-la.
5. **Concessão em excesso hoje.** `plan_expires_at` sai de `nextDueDate`, então o acesso é
   concedido **até o fim de uma fatura ainda não paga**. Se a de 20/09 falhar, o cliente tem
   acesso pago não quitado até a régua rodar de novo. Isso é comportamento ATUAL, não da
   proposta — mas o desenho novo mexe na mesma linha e deveria decidir sobre ele.
6. **NFS-e.** Toda cobrança confirmada emite nota automática; estorno cancela. Remover uma
   cobrança **não paga** não deveria tocar em nota, mas quero confirmação.

---

## 6. O QUE EU QUERO DE VOCÊ

1. **O diagnóstico se sustenta?** Em especial a leitura de que a âncora preservada, *depois de
   corte de serviço*, cobra por período não entregue.
2. **O híbrido é a escolha certa** para um SaaS mensal de cartão, ou você preservaria a âncora e
   resolveria por **crédito/proração** (creditar os dias sem acesso na próxima fatura) em vez de
   mover a data? Qual das duas envelhece melhor?
3. **A armadilha de ordem** (campos de rebaixamento limpos na mesma escrita da ativação) — como
   você a resolveria sem deixar o sinal depender de leitura acidental?
4. **Idempotência:** qual o marcador certo para garantir que a âncora se move **uma vez só** por
   reativação? Reusar o padrão `effects:{sub}:{plan}:{cycle}` que já existe, ou um próprio?
5. **A fatura órfã:** `updatePendingPayments` ou `DELETE /payments/{id}`? E qual o
   comportamento seguro se o DELETE falhar — abortar a reativação ou seguir e alertar?
6. **O item 5 dos riscos** (acesso concedido até fatura não paga) merece correção junto, ou é
   escopo separado?
7. Algo que eu **não** perguntei e deveria.

**Restrições:** só cartão (sem PIX/boleto, decisão travada por teste); mudanças de banco passam
pelo SQL Editor com o dono rodando; o projeto valoriza **falhar alto** em vez de degradar em
silêncio; e vale a Regra nº 1 da casa — **o repositório não descreve o banco**, catálogo é a
fonte da verdade.
