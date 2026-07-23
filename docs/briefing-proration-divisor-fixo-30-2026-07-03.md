# Briefing técnico — Proration com divisor fixo de 30 dias (EidosForm × Asaas)

> **Para análise do Codex.** Objetivo: parecer sobre um achado na lógica de proration —
> o crédito proporcional usa um divisor FIXO de 30 dias, mas o período pago real do Asaas é
> mês-calendário (28-31 dias), causando distorção nos DOIS sentidos (vaza receita em meses de
> 31 dias; **cobra o cliente a mais em fevereiro**). Queremos: (1) validação/refutação da
> mecânica e da severidade; (2) parecer sobre a correção proposta e as armadilhas a evitar;
> (3) recomendação final (corrigir vs aceitar como trade-off) e prioridade.
>
> **NÃO é da feature de "cartão morto" implementada hoje** — é lógica de proration pré-existente
> (`lib/proration.ts`), que TODA troca de plano (com token vivo ou via fallback) sempre usou.
> Estado do produto: em produção, **zero clientes pagantes reais** ainda (contexto pra calibrar
> prioridade). Este achado já passou por uma revisão adversarial interna (Claude) — os números
> abaixo são dela; pedimos ao Codex uma segunda opinião independente.

Repo: `/home/sidney/eidosform` (HEAD atual). Preços: `PLAN_PRICES` em `lib/asaas.ts` — Starter
R$49/mês, Plus R$127/mês, Professional R$257/mês (anual: 348 / 1.164 / 2.364).

---

## 1. Como o problema apareceu

Teste E2E real (2026-07-03): cliente comprou **Starter (R$49)** e, no MESMO dia, ao fazer
upgrade para Plus, o preview mostrou **crédito de R$50,63** — maior que os R$49 pagos. Bateu
com `round(49/30 × 31, 2) = 50,63`.

---

## 2. Mecânica confirmada (a raiz do desvio)

### 2.1 O crédito usa divisor FIXO de 30/365
`lib/proration.ts`:
- `DAYS_IN_MONTH = 30`, `DAYS_IN_YEAR = 365`, `getDaysInCycle` (linhas 13-18).
- `calculateProrationCredit` (linhas 92-108): `credit = (price / totalDays) × remainingDays`,
  com `totalDays` = 30 (MONTHLY) / 365 (YEARLY), FIXO.
- `remainingPaidDays` (linhas 47-51): conta dias-calendário **inteiros** (BRT) de hoje até
  `plan_expires_at` (via `brtDateOnly`, `Math.round`).
- `calculateUpgradePrice` (linhas 121-139): `finalPrice = max(0, originalPrice − credit)`.

### 2.2 Mas o período pago real é mês-calendário do Asaas
`lib/billing-activation.ts`:
- `plan_expires_at` é gravado a partir do `nextDueDate` **REAL** do Asaas — `expiryFromNextDueDate`
  (linhas 40-46, fim-do-dia 23:59:59 BRT) — no passo (4a), linhas 240-245.
- Na **primeira compra** via checkout hospedado, a sub recorrente nasce com `nextDueDate = hoje`
  (`lib/asaas.ts:183-203`, `chargeTypes: ['RECURRENT']`), e após o 1º pagamento o Asaas **avança
  o `nextDueDate` por mês-calendário** (ex.: 3/jul → 3/ago = **31 dias**). Logo `remainingPaidDays`
  no dia da compra ≈ 31, não 30.
- O divisor 30 então **não "casa com o provider"** (como o comentário alega): o Asaas fatura por
  mês-calendário de 28-31 dias.

### 2.3 O que é IMUNE / o que NÃO vaza (importante para não "consertar" errado)
- **Subs criadas por `executePlanSwitch`** nascem com `nextDueDate = nextDueDateAfterFullCycle`
  (`lib/plan-switch.ts:67-71`, hoje **+30/+365 fixo**) ou `coverageDays` (saldo-vira-tempo). Nesses
  casos o `plan_expires_at` é construído com a MESMA régua-30 com que depois é consumido →
  prorateamento **exato**, sem desvio. O desvio vem SÓ do período do Asaas (checkout hospedado +
  renovações).
- **"Saldo vira tempo"** (`calculateCreditCoverageDays`, `lib/proration.ts:147-157`):
  `days = credit × 30 / price`, depois reconsumido a `price/30`. É **round-trip exato** por
  construção (o `ceil − 1e-9` concede ≤1 dia/conversão a favor do cliente). **Não vaza e não
  empilha sem limite.** Qualquer correção precisa preservar isso.
- **Reativação de MESMO plano+ciclo** (`lib/plan-change.ts:86,116-119`): usa `remainingPaidDays`
  DIRETO (não divide por 30) → imune ao desvio.

---

## 3. Severidade — distorção nos DOIS sentidos (revisão adversarial interna)

O divisor-30 super-avalia o dia em meses de 31 dias (crédito estica → **empresa perde**) e
**sub-avalia** o dia em fevereiro (28 dias) (crédito encolhe → **cliente paga a mais**). Por
transação, `dia 0` (troca no mesmo dia da compra), pior caso:

| Plano | Leak máx — mês 31 dias (empresa perde) | **Dano ao cliente — fev 28 dias (cliente perde)** |
|---|---|---|
| Starter R$49 | R$1,63 | R$3,27 |
| Plus R$127 | R$4,23 | R$8,47 |
| Professional R$257 | R$8,57 | **R$17,13** |

- Assimetria: leak limitado a `(31−30)/30 = 3,3%`; dano limitado a `(30−28)/30 = 6,67%` (fev
  comum; ano bissexto volta a 3,3%).
- Variante em "tempo": **downgrade** Professional→Starter em fevereiro rende ~147 dias de Starter
  em vez de ~158 → cliente **perde ~11 dias (~R$18)** de plano.
- Anual quase não vaza (divisor 365 ≤ 365/366 real; ≤ ~R$6,48 em ano bissexto).
- **Bounded e não acumula** (é por-transação; o saldo-vira-tempo é exato).
- **Fluxos afetados:** upgrade pago, troca de ciclo mensal→anual, downgrade/credit_covered.
  **Imune:** reativação de mesmo plano+ciclo.

> ⚠️ **O caso que eleva a prioridade** é o **dano ao cliente em fevereiro** (cobrar a mais /
> devolver menos tempo) — risco de confiança/consumidor, mais grave que o leak de receita.
> Uma análise preliminar minha havia dito "sempre a favor do cliente" — **estava ERRADA**; é
> assimétrico.

---

## 4. Comentário atual no código está auto-contraditório

`lib/proration.ts:10-12` diz: *"Calendar variations (28-31 day months, leap years) cause
cents-level rounding differences — accepted trade-off for predictable proration matching the
provider."* Dois problemas: (1) **magnitude** — em Professional dá R$8,57 (leak) a R$17,13
(dano), reais e não centavos; (2) a premissa **"matching the provider" é falsa** — o divisor-30
é justamente o que NÃO casa com o Asaas (que fatura por mês-calendário).

---

## 5. Padrão de mercado (pesquisado, com fontes)

Os principais provedores de billing prorateiam pelo **tamanho REAL do período**, não por 30 fixo:
- **Stripe** — prorateia **por segundo**, usando início/fim reais do período de cobrança
  (fórmula = duração do serviço ÷ duração real do período). Ref: docs.stripe.com/billing/subscriptions/prorations
- **Chargebee** — modo *day-based* usa **dias reais do termo** (a própria doc exemplifica
  31/jan→28/fev = **28 dias**, diária = valor ÷ 28); modo *millisecond-based* é exato. Ref:
  chargebee.com/docs/2.0/subscriptions/articles-and-faq/proration-calculation-logic.html

Ou seja: o "30 fixo" é convenção **30/360 de finanças** (day-count de juros), não prática de
billing SaaS. Com o período real, o crédito é naturalmente limitado ao que foi pago (nunca >
nem <), zerando os dois lados da distorção.

---

## 6. Correção proposta (para o Codex avaliar/refinar)

**Ideia:** dividir pelo comprimento **real** do período pago, não por 30/365 fixo.

Como não persistimos o início do período, o mínimo seria **gravar `plan_period_days`
(ou `plan_started_at`) em TODA ativação** e calcular `dailyRate = price / periodDays`
(fallback 30/365 se ausente). Efeito: zera o leak E o dano de fevereiro simultaneamente, e
torna a proration do Asaas **exata** (aí sim "matching the provider").

**Por que preserva o que importa:**
- Subs de switch teriam `periodDays` = o offset que nós mesmos setamos (30 / coverageDays) →
  continuam auto-consistentes (round-trip do saldo-vira-tempo intacto).
- A deriva/empilhamento que motivou as constantes fixas vinha da **fração em ms** na contagem
  antiga (`Δms÷24h`), já morta por `remainingPaidDays` (dias inteiros). Dividir por um período
  em dias-inteiros **não** reintroduz essa fração.
- Ativação que esquecer de gravar `periodDays` → fallback 30 = comportamento atual (sem
  regressão dura).

**Armadilhas a EVITAR (reintroduzem bugs já removidos):**
- `min(crédito, preço)` — clipa o saldo legítimo > 1 ciclo do downgrade (o bug 78→30 dias que já
  foi removido em 2026-06-10).
- `clamp(remainingDays ≤ 30)` — quebra o "saldo vira tempo".

---

## 7. Perguntas específicas para o Codex

1. **Validação/refutação da mecânica e severidade:** a distorção bidirecional está correta? O
   caso de **dano ao cliente em fevereiro** (cobrar a mais / devolver menos tempo) é real e
   reproduzível? Algum caso que a revisão interna não viu (maior magnitude, ou empilhamento que
   acumule)?
2. **A correção proposta (divisor = período real via `plan_period_days`/`plan_started_at`) é
   correta e completa?** Preserva o round-trip do saldo-vira-tempo? Cobre os 4 fluxos (upgrade,
   troca de ciclo, downgrade/credit_covered, reativação)?
3. **Onde e como persistir `periodDays`** de forma robusta: em qual(is) ponto(s) de ativação
   (`billing-activation.ts` passo 4a, e a criação de sub via token)? Como derivar para profiles
   **legados** já ativos (backfill/migration, ou fallback 30 aceitável)?
4. **Edge cases:** anual (365 vs 366), ano bissexto, o caminho `credit_covered`, reativação de
   mesmo plano+ciclo, downgrade-vira-tempo, e a interação com o `nextDueDate` que o Asaas avança
   por mês-calendário nas RENOVAÇÕES (não só na 1ª compra).
5. **Existe alternativa mais simples e igualmente correta?** Há algum motivo legítimo para manter
   o 30 fixo (ex.: casar com outra parte do sistema que também assume 30)?
6. **Prioridade/severidade:** dado que hoje há **zero clientes pagantes reais**, o caso de
   sobrecobrança de até ~R$17 justifica corrigir antes de abrir vendas, ou é aceitável lançar com
   isto anotado e corrigir depois? No mínimo, o comentário auto-contraditório
   (`proration.ts:10-12`) deve ser corrigido já?

---

## 8. Arquivos/pontos relevantes

- `lib/proration.ts` — `getDaysInCycle` (13-18), `remainingPaidDays` (47-51),
  `calculateProrationCredit` (92-108), `calculateUpgradePrice` (121-139),
  `calculateCreditCoverageDays` (147-157), comentário (10-12).
- `lib/billing-activation.ts` — `calculateExpiryDate` (23-28, fallback now+ciclo),
  `expiryFromNextDueDate` (40-46), passo 4a que grava `plan_expires_at` pelo nextDueDate real
  (240-245).
- `lib/plan-switch.ts` — `nextDueDateAfterFullCycle` (67-71, hoje+30/365 fixo).
- `lib/plan-change.ts` — `computePlanChange` (fonte única da decisão), reativação mesmo
  plano+ciclo imune (86,116-119), coverageDays no downgrade (151).
- `lib/asaas.ts` — criação da sub no checkout hospedado (183-203, nextDueDate=hoje, RECURRENT),
  `PLAN_PRICES`.
- `app/api/checkout/[plan]/route.ts` — usa `computePlanChange` (176) e repassa `proration` ao
  `executePlanSwitch`.

## 9. Restrições não-funcionais
- Toca em **dinheiro** → qualquer mudança precisa de testes red→green e não pode regredir os
  invariantes já cobertos (`lib/proration.test.ts` se existir; senão criar).
- A régua de **dias inteiros** (`remainingPaidDays`) é intencional (mata a deriva de fração de
  ms) — não voltar a contar em ms.
- Migrations rodam MANUALMENTE no Supabase (não há CI de migration).
