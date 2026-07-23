# Plano de implementação — Correção da proration (divisor real por `proration_basis_days`)

> **Status:** APROVADO para implementação. Fonte da verdade = parecer do Codex 2026-07-03
> (cruzado/aprovado pelo Claude) + briefing `docs/briefing-proration-divisor-fixo-30-2026-07-03.md`.
> **Toca DINHEIRO real (Asaas live).** Testes red→green, zero regressão dos invariantes.
> **PROIBIDO neste trabalho:** `git push`, tocar em `.env*`, rodar contra produção
> (Supabase/Asaas/Vercel), `git add -A`. Migrations rodam MANUALMENTE no Supabase.

---

## 0. Modelo mental (a régua) — ler antes de tudo

`proration_basis_days` é o **denominador de valoração** dos dias restantes do plano VIGENTE:

```
credit = planPrice / proration_basis_days × remainingPaidDays(plan_expires_at)
```

É a resposta a **"quantos dias UM preço-cheio do plano compra"**, NÃO "quantos dias faltam
até a próxima cobrança". Os dois divergem no downgrade/saldo-vira-tempo:

- **Período REAL do Asaas** (1ª compra / renovação): um preço-cheio cobre o mês-calendário
  inteiro → base = tamanho real do período (28–31 / 365–366).
- **Sub criada por nós** (`executePlanSwitch`, incl. saldo-vira-tempo): um preço-cheio cobre
  UM ciclo NOMINAL; os dias extras vêm de saldo excedente valorado à diária nominal → base =
  **30 (MONTHLY) / 365 (YEARLY)**, NUNCA o `coverageDays`.

**Armadilha confirmada (não repetir):** Pro→Starter credita R$257 → 158 dias de Starter
(base 30). Se a base virasse 158, uma troca imediata daria `49/158×158 = R$49` → cliente
PERDE R$208. Por isso, para saldo-vira-tempo a base é 30/365, não a duração da cobertura.

**Invariante de round-trip:** com base 30, `credit(Starter,158d) = 49/30×158 = R$258,03 ≈ R$257`
(o `ceil` do coverage concede ≤1 dia/conversão a favor do cliente; converge, não empilha).

---

## 1. Migration (rodar MANUALMENTE no Supabase — aditiva, idempotente, SEM backfill)

**Arquivo:** `supabase/migrations/20260703_profiles_proration_basis_days.sql`

```sql
-- proration_basis_days: RÉGUA DE VALORAÇÃO (denominador) dos dias restantes do plano
-- vigente. credit = planPrice / proration_basis_days × remainingPaidDays.
-- NÃO é "duração até a próxima cobrança" (essa armadilha faz o downgrade perder saldo):
-- é quantos dias UM preço-cheio compra. Período REAL do Asaas na 1ª compra/renovação
-- (28-31/365-366); 30/365 nominal quando a sub é criada por nós (executePlanSwitch,
-- incl. saldo-vira-tempo). NULLABLE: legado (base ausente) cai no fallback 30/365 no
-- código, COM log. Sem backfill comercial (zero clientes pagantes reais; a conta E2E
-- foi resetada p/ free). smallint: 28..366 cabe folgado.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS proration_basis_days smallint;

COMMENT ON COLUMN profiles.proration_basis_days IS
  'Denominador de valoração da proration: dias que UM preço-cheio do plano vigente compra. Período real do Asaas (1a compra/renovacao) ou 30/365 nominal (executePlanSwitch/saldo-vira-tempo). NULL = legado -> fallback 30/365 no codigo, com log. NAO usar coverageDays.';

-- Auditoria (opcional, mas barata e útil p/ conferir a base gravada):
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS billing_period_start_on date;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS billing_period_end_on date;

COMMENT ON COLUMN profiles.billing_period_start_on IS
  'Auditoria: inicio do periodo pago corrente (payment.dueDate) usado p/ derivar proration_basis_days.';
COMMENT ON COLUMN profiles.billing_period_end_on IS
  'Auditoria: fim do periodo pago corrente (subscription.nextDueDate) usado p/ derivar proration_basis_days.';
```

**Sem backfill comercial** (não há cliente pagante real; a conta E2E já é free). Legado =
`NULL` → fallback 30/365 no código (com log). Espelha o padrão de
`20260701_profiles_annual_started_at.sql` e `20260608_profiles_asaas_card_token.sql`.

### `lib/database.types.ts` — profiles.Row
Adicionar após `annual_started_at: string | null` (linha ~185), espelhando o padrão de
`annual_started_at` (que só existe em `Row`; escritas passam por client destipado/`as never`):
```ts
          proration_basis_days: number | null
          billing_period_start_on: string | null
          billing_period_end_on: string | null
```
`Insert`/`Update`: opcional (mirror `annual_started_at`, que é só-`Row`). Adicionar como
`?: number | null` / `?: string | null` se o typecheck exigir.

---

## 2. `lib/proration.ts` — read side (assinaturas novas + helper + fallback com log)

### 2.1 Remover o comentário falso e tornar `getDaysInCycle` a régua NOMINAL/fallback
Remover as linhas 10-12 (o comentário auto-contraditório "cents-level"/"matching the
provider" — factualmente FALSO). Substituir o bloco 10-18 por:

```ts
import { logWarn } from '@/lib/logger'
// ...
// Régua NOMINAL do ciclo (30/365). Usada em DOIS lugares:
//  (1) fallback do denominador de proration quando proration_basis_days é NULL (legado);
//  (2) conversão saldo-vira-tempo (calculateCreditCoverageDays) — a diária nominal do
//      plano-alvo, base da ida-e-volta estável.
// NÃO "casa com o provider": o Asaas fatura por mês-calendário (28-31). O casamento real
// com o provider vem de proration_basis_days (período REAL), não daqui.
const DAYS_IN_MONTH = 30
const DAYS_IN_YEAR = 365

function getDaysInCycle(cycle: BillingCycle): number {
  return cycle === 'YEARLY' ? DAYS_IN_YEAR : DAYS_IN_MONTH
}

/** Resolve o denominador de valoração: base explícita quando presente (≥1), senão a régua
 *  nominal 30/365 — logando (visibilidade: um caminho de ativação NOVO que esqueceu de
 *  gravar apareceria aqui num cliente recém-ativado, não só legado). */
function resolveBasisDays(basisDays: number | null | undefined, cycle: BillingCycle): number {
  if (typeof basisDays === 'number' && basisDays >= 1) return basisDays
  logWarn('[proration] proration_basis_days ausente — fallback nominal 30/365', { cycle, basisDays: basisDays ?? null })
  return getDaysInCycle(cycle)
}
```
> Nota de commit: o comentário falso é reescrito AQUI (commit A) porque A já reescreve esse
> bloco por completo (mudança de semântica) — deixar um comentário factualmente falso num
> commit enviado seria pior. (O spec listava a remoção em C; agrupada em A por necessidade.)

### 2.2 `calculateProrationCredit` — recebe a base
`ProrationCreditParams` e `UpgradePriceParams`: adicionar `basisDays?: number | null`.

```ts
export function calculateProrationCredit(params: ProrationCreditParams): number {
  const { currentPlan, currentCycle, planExpiresAt, basisDays } = params
  const price = getPlanPrice(currentPlan, currentCycle)
  if (price === 0) return 0
  const totalDays = resolveBasisDays(basisDays, currentCycle)   // <-- era getDaysInCycle(currentCycle)
  const remainingDays = remainingPaidDays(planExpiresAt)
  if (remainingDays <= 0) return 0
  const credit = (price / totalDays) * remainingDays
  return Math.round(credit * 100) / 100
}
```

### 2.3 `calculateUpgradePrice` — repassa a base
```ts
const credit = calculateProrationCredit({ currentPlan, currentCycle, planExpiresAt, basisDays })
```
(`basisDays` desestruturado de `params`.)

### 2.4 `calculateCreditCoverageDays` — **NÃO MUDAR**
Continua usando `getDaysInCycle(newCycle)` (diária NOMINAL do plano-alvo). É o par do saldo
gravado com base 30/365 → round-trip exato. Mudar aqui quebraria o invariante.

### 2.5 Helper novo: `computeProrationBasisDays` (período REAL — caso 1)
Pura, testável, exportada de `lib/proration.ts` (usada por `finalizeActivation`):

```ts
/** Parse 'YYYY-MM-DD' → meia-noite UTC (ms). null se inválido. */
function parseYmd(s: string | null | undefined): number | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d)
  return Number.isNaN(t) ? null : t
}

/** ms UTC + N ciclos CALENDÁRIO (mês/ano; NUNCA +30/365). Clampa o dia ao fim do mês-alvo
 *  (espelha o clamp do Asaas: 31/jan +1mês → 28/fev). */
function calendarShift(ms: number, cycle: BillingCycle, sign: 1 | -1): number {
  const dt = new Date(ms)
  const y = dt.getUTCFullYear(), m = dt.getUTCMonth(), d = dt.getUTCDate()
  if (cycle === 'YEARLY') return Date.UTC(y + sign, m, d)
  const targetM = m + sign
  const lastDay = new Date(Date.UTC(y, targetM + 1, 0)).getUTCDate() // dia 0 do mês seguinte
  return Date.UTC(y, targetM, Math.min(d, lastDay))
}

/**
 * Base de valoração REAL do período pago corrente, em dias-calendário INTEIROS: do
 * vencimento da cobrança corrente (payment.dueDate) ao PRÓXIMO (subscription.nextDueDate).
 * Usada na 1ª compra e em TODA renovação. Retorna null quando não dá pra computar com
 * segurança (o chamador cai no fallback 30/365 + log).
 *  - Início: paymentDueDate quando presente/coerente; senão nextDueDate − 1 ciclo CALENDÁRIO.
 *  - Fim: nextDueDate; se o Asaas ainda NÃO avançou (nextDueDate ≤ início), deriva
 *    início + 1 ciclo CALENDÁRIO (NUNCA +30/365).
 *  - Guarda sã: fora de [27,32] (MONTHLY) / [359,372] (YEARLY) → null (protege contra
 *    nextDueDate corrompido inflar a base e sub-creditar o cliente).
 */
export function computeProrationBasisDays(
  cycle: BillingCycle,
  nextDueDate: string | null | undefined,
  paymentDueDate?: string | null,
): number | null {
  let start = parseYmd(paymentDueDate)
  let end = parseYmd(nextDueDate)
  if (start === null && end === null) return null
  if (start !== null && end === null) end = calendarShift(start, cycle, 1)
  else if (start === null && end !== null) start = calendarShift(end, cycle, -1)
  else if (start !== null && end !== null && end <= start) end = calendarShift(start, cycle, 1)
  const basis = Math.round(((end as number) - (start as number)) / 86_400_000)
  const [min, max] = cycle === 'YEARLY' ? [359, 372] : [27, 32]
  if (!Number.isFinite(basis) || basis < min || basis > max) return null
  return basis
}
```

---

## 3. `lib/plan-change.ts` — computePlanChange LÊ a base do profile

`PlanChangeInput`: adicionar `prorationBasisDays?: number | null`.
`computePlanChange`: desestruturar `prorationBasisDays` e repassá-lo nos DOIS
`calculateUpgradePrice` (linhas ~102 e ~137):
```ts
const r = calculateUpgradePrice({
  currentPlan: currentPlan as PlanId,
  currentCycle: (currentCycle ?? 'MONTHLY') as BillingCycle,
  planExpiresAt,
  newPlan,
  newCycle,
  basisDays: prorationBasisDays,   // <-- base do plano ATUAL
})
```
> `calculateCreditCoverageDays` (linhas 119/151) NÃO recebe base — continua nominal.
> Reativação de mesmo plano+ciclo (linhas 116-119) já usa `remainingPaidDays` direto
> (identidade por dias) — **imune, manter intacto**.

**Callers de `computePlanChange` (passar a base do profile):**
- `app/api/checkout/[plan]/route.ts:176` → `prorationBasisDays: profile.prorationBasisDays`
- `app/api/checkout/[plan]/preview/route.ts:61` → `prorationBasisDays: profile.prorationBasisDays`

## 3.1 `lib/billing-profile.ts` — carregar a coluna
- `BillingProfile` (linha ~25): adicionar `prorationBasisDays: number | null`.
- `mapProfileRowToBillingProfile` (linha ~88): adicionar
  `prorationBasisDays: typeof profile.proration_basis_days === 'number' ? profile.proration_basis_days : null,`
- `getBillingProfileForUser` `.select(...)` (linha 127): incluir `, proration_basis_days`.
  > ⚠️ **ORDEM DE DEPLOY (ACHADO da revisão):** este `select` passa a pedir a coluna nova. Se o
  > código do commit A chegar à PRODUÇÃO **antes** de a migration ter criado a coluna, o PostgREST
  > devolve erro → `profile` vira `null` → checkout/preview quebram ("Perfil não encontrado") p/
  > TODO usuário. Como o repo faz auto-deploy no `git push origin main`, a migration TEM que rodar
  > no Supabase **antes** de o commit A ser publicado. Ver checklist §10 (passo reordenado).

---

## 4. Os 5 caminhos de ESCRITA da base (arquivo:função:linha + valor)

| # | Caminho | Onde gravar | Valor |
|---|---|---|---|
| 1 | **1ª compra + RENOVAÇÃO do Asaas** | `lib/billing-activation.ts` `finalizeActivation`, passo 4a (~240-245) — roda em webhook, polling, reprocess e backstop | `computeProrationBasisDays(cycle, sub.nextDueDate, paymentDueDate)` (REAL) |
| 2 | **`executePlanSwitch` pago** (upgrade_paid) | `lib/plan-switch.ts` `executePlanSwitch`, update do profile (~165-176) | `30 (MONTHLY) / 365 (YEARLY)` |
| 3 | **credit_covered / saldo-vira-tempo** | mesmo update de `executePlanSwitch` (reasons `credit_covered`/`reactivate` p/ plano ≠) | `30/365` do PLANO-ALVO (NUNCA coverageDays) |
| 4 | **Reativação MESMO plano+ciclo** | checkout route Caso 1 → passa base ao `executePlanSwitch` | **PRESERVA** `profile.prorationBasisDays` (não recalcula) |
| 5 | **Mudança para free** | `buildFreePlanUpdate` + 3 reverts inline do webhook + **2 reverts inline fora do webhook** (`cron/expire-plans`, `plan-features`) | `null` (limpa) |
| 6 | **RENOVAÇÃO tardia fora do webhook** (fallback quando o webhook não rodou) | `cron/expire-plans` EXTEND + `plan-features` EXTEND | **recomputa** `computeProrationBasisDays` (derivado de `nextDueDate`) |

> **Achados da revisão adversarial (2026-07-03) incorporados aqui:** os caminhos 5 e 6 tinham
> BURACOS na versão anterior deste plano. (a) Havia DOIS reverts-p/-free inline FORA do webhook
> (`cron/expire-plans:88-102` e `plan-features:93-104`) que setam `plan:'free'`/`plan_expires_at:null`
> mas NÃO usam `buildFreePlanUpdate` → deixariam a base velha (money-neutral porque free→preço 0,
> mas viola a regra 5 "free limpa a base"). (b) Havia DUAS RENOVAÇÕES tardias fora do webhook
> (`cron/expire-plans:64` e `plan-features:53`, o fallback "sub ACTIVE mas expiração local vencida")
> que ESTENDEM `plan_expires_at` sem recomputar a base → o divisor velho persistiria e a distorção
> que este projeto mata reapareceria (bounded, só no modo webhook-fora-do-ar + troca mid-ciclo).
> Ver §4.F.

### 4.A — `finalizeActivation` (caso 1) — `lib/billing-activation.ts`
Assinatura (linha 160-169): adicionar 2 params:
```ts
paymentDueDate?: string | null   // dueDate da cobrança corrente (webhook tem; polling/reprocess não → deriva)
writeBasis?: boolean             // default true; webhook passa !skipProfileUpdate (guard RECEIVED tardio)
```
No passo 4a (substituir o bloco 240-245):
```ts
const realExpiry = expiryFromNextDueDate(sub?.nextDueDate)
if (realExpiry) {
  const update: Record<string, unknown> = { plan_expires_at: realExpiry }
  if (writeBasis !== false) {
    const basisDays = computeProrationBasisDays(cycle, sub?.nextDueDate, paymentDueDate)
    if (basisDays !== null) {
      update.proration_basis_days = basisDays
      update.billing_period_end_on = sub?.nextDueDate ?? null
      if (paymentDueDate) update.billing_period_start_on = paymentDueDate
    } else {
      logWarn(`${tag}: proration_basis_days não computável — mantém fallback 30/365`, { userId, nextDueDate: sub?.nextDueDate ?? null, paymentDueDate: paymentDueDate ?? null })
    }
  }
  const { error: expErr } = await db.from('profiles').update(update).eq('id', userId)
  if (expErr) logError(`${tag}: falha ao ajustar expiração/base (não-bloqueante)`, expErr, { userId, newSubscriptionId })
  else log(`${tag}: expiração+base ajustadas pelo período real`, { userId, newSubscriptionId, plan_expires_at: realExpiry, proration_basis_days: update.proration_basis_days ?? null })
}
```
Importar `computeProrationBasisDays` de `@/lib/proration` e (se ainda não) `logWarn`.
**Por que aqui:** é a MESMA rotina que já lê a sub e grava `plan_expires_at` pelo
`nextDueDate` real nos 4 caminhos de sub-do-Asaas (webhook 827 / polling 219 / reprocess 326
/ backstop `activatePaidSubscription` 372). Se `basisDays===null` (leitura falhou / fora da
banda sã), a base fica no valor de "limpeza" (`null`, ver 4.C) → read cai no fallback 30/365,
**consistente** com o fallback `now+ciclo` do próprio `plan_expires_at`.

**Idempotência da base:** para o RECEIVED tardio, `sub.nextDueDate` já reflete o período
CORRENTE → recomputar daria a MESMA base vigente. Ainda assim, o webhook passa
`writeBasis:false` no skip (guard explícito), atendendo o spec "evento tardio NÃO sobrescreve".

### 4.B — Callers de `finalizeActivation`
- **Webhook** (`app/api/webhooks/asaas/route.ts:827`): adicionar
  `paymentDueDate: payment?.dueDate ?? null,` e `writeBasis: !skipProfileUpdate,`.
- **Webhook inline update** (766-783): adicionar `proration_basis_days: null,` (limpa antes do
  finalize preencher; no skip a inline não roda e o finalize não sobrescreve → base vigente
  intacta).
- **Polling** (`app/api/checkout/status/route.ts:219`): usa `buildActivePlanUpdate` (que já
  limpa a base, ver 4.C) + `finalizeActivation` sem `paymentDueDate` → deriva de `nextDueDate`.
  Sem mudança de assinatura além do que 4.C dá. (Polling só finaliza em transição real; para
  renovação já-ativa ele dá short-circuit no `already active`, linha 135 → não recomputa.)
- **Reprocess** (`lib/asaas-reprocess.ts:326`): idem polling (usa `buildActivePlanUpdate`).
- **Backstop** `activatePaidSubscription` (`lib/billing-activation.ts:372`): idem (usa
  `buildActivePlanUpdate`).

### 4.C — `buildActivePlanUpdate` + `buildFreePlanUpdate` (limpeza + caso 5)
- `buildActivePlanUpdate` (retorno, linha 57-71): adicionar `proration_basis_days: null,`
  (limpa a base do plano anterior; o `finalizeActivation` preenche a real logo depois).
- `buildFreePlanUpdate` (retorno, linha 272-281): adicionar `proration_basis_days: null,`
  (caso 5). E `billing_period_start_on: null, billing_period_end_on: null,` (auditoria).
- **Webhook reverts inline** (3 pontos): PAYMENT_OVERDUE (~915-923), SUBSCRIPTION_DELETED
  (~1014-1022), refund/chargeback/inactivated (~1124-1132) → adicionar `proration_basis_days: null,`
  em cada `update({...})` que já seta `plan_expires_at: null`.
- **Reverts inline FORA do webhook** (2 pontos — ACHADO da revisão; NÃO usam `buildFreePlanUpdate`):
  - `app/api/cron/expire-plans/route.ts` revert (~88-102, o `update({ plan:'free', … })` do
    `shouldRevert`) → adicionar `proration_basis_days: null,` (+ `billing_period_start_on: null,
    billing_period_end_on: null,`).
  - `app/api/user/plan-features/route.ts` revert on-expiry (~93-104, `update({ plan:'free', … })`)
    → idem.
  > Impacto: money-neutral (plano free → `getPlanPrice=0` → crédito 0 seja qual for a base), mas a
  > regra 5 exige limpar e o caso (h) do teste checa "todos os caminhos p/ free limpam". `reprocess`
  > já usa `buildFreePlanUpdate('cancelled')` (lib/asaas-reprocess.ts:377) → coberto pelo item acima.
- **Reverts que devem PRESERVAR a base (NÃO limpar — nota anti-regressão):**
  - `app/api/subscription/cancel/route.ts:91` (soft-cancel: `plan_status:'canceling'` + refresca
    `plan_expires_at`, MANTÉM o plano/tier) → **NÃO** tocar em `proration_basis_days`. A base do
    plano ainda-vigente tem que sobreviver ao cancelamento p/ o `credit_covered`/reativação
    (canceling, §4.E) valorar os dias restantes com a régua REAL, não com o fallback 30. O revert
    dele (linha ~110, restaura `prevStatus`/`prevExpires`) idem — não mexer na base.
  - `app/api/admin/users/[id]/plan/route.ts` (override manual do admin: seta `plan`/`plan_expires_at`
    SEM base) → aceitável: base fica null → read cai no fallback 30/365 COM log. Ação rara e manual;
    não vale ramificar. (Se quiser precisão, o admin pode setar a base no mesmo update — opcional.)

### 4.D — `executePlanSwitch` (casos 2, 3, 4) — `lib/plan-switch.ts`
`PlanSwitchParams` (interface ~29-49): adicionar
```ts
/** Denominador de valoração da sub NOVA. undefined → 30/365 nominal (upgrade_paid,
 *  credit_covered p/ plano ≠, backstops). Reativação MESMO plano+ciclo → base VIGENTE
 *  preservada (o chamador passa profile.prorationBasisDays). null → grava null (legado). */
prorationBasisDays?: number | null
```
No corpo (antes do update, ~140): 
```ts
const basisDays = params.prorationBasisDays !== undefined
  ? params.prorationBasisDays
  : (cycle === 'YEARLY' ? 365 : 30)
```
No update do profile (adicionar dentro do objeto ~165-176):
```ts
      proration_basis_days: basisDays,
```
> **Regra 2/3 automática:** todos os callers que NÃO passam `prorationBasisDays` (upgrade_paid
> no checkout, `runPlanChangeBackstop:413`, `runCardFallbackBackstop:677`) caem no default
> 30/365 — exatamente o exigido. Nenhuma mudança nesses backstops.

### 4.E — Checkout route Caso 1 (credit_covered / reativação) — casos 3 e 4
`app/api/checkout/[plan]/route.ts`, dentro do `if (change.action === 'credit_covered')`
(~274-294). Antes do `executePlanSwitch`, computar:
```ts
const samePlanCycle = profile.plan === plan && (profile.plan_cycle ?? 'MONTHLY') === cycle
const basisForSwitch = samePlanCycle
  ? profile.prorationBasisDays            // caso 4: PRESERVA a base vigente (identidade)
  : (cycle === 'YEARLY' ? 365 : 30)       // caso 3: 30/365 do plano-alvo (NUNCA coverageDays)
```
e passar `prorationBasisDays: basisForSwitch,` no `executePlanSwitch`.
> `samePlanCycle` só é atingível com `hasActiveSubscription=false` (com sub ativa e mesmo
> plano+ciclo → `already_subscribed` antes). É o exato caso de reativação-identidade (rule 4).

**Caso 2 (upgrade_paid)** do checkout (~470-482): NÃO passar `prorationBasisDays` → default
30/365. (Correto.)

### 4.F — RENOVAÇÃO tardia FORA do webhook (caso 6 — ACHADO da revisão adversarial)
Dois caminhos ESTENDEM `plan_expires_at` numa renovação atrasada quando a sub está `ACTIVE` no
Asaas mas a expiração local venceu (o webhook não chegou). Hoje eles corrigem só a expiração;
precisam recomputar a base JUNTO, senão o divisor velho persiste e a distorção reaparece
(bounded, mas é exatamente o bug que o projeto mata):

- `app/api/cron/expire-plans/route.ts:63-64` — bloco `sub.status === 'ACTIVE'`:
  ```ts
  const next = expiryFromNextDueDate(sub?.nextDueDate) ?? calculateExpiryDate((p.plan_cycle ?? 'MONTHLY') as BillingCycle)
  const basisRenew = computeProrationBasisDays((p.plan_cycle ?? 'MONTHLY') as BillingCycle, sub?.nextDueDate)
  const upd: Record<string, unknown> = { plan_expires_at: next }
  if (basisRenew !== null) { upd.proration_basis_days = basisRenew; upd.billing_period_end_on = sub?.nextDueDate ?? null }
  await admin.from('profiles').update(upd).eq('id', p.id)
  ```
- `app/api/user/plan-features/route.ts:50-53` — bloco espelho (`sub ACTIVE` na expiração):
  mesma recomputação (`profile.plan_cycle`, `sub.nextDueDate`) no `update`.

`computeProrationBasisDays` sem `paymentDueDate` DERIVA o início por `calendarShift(nextDueDate, −1
ciclo)` (§2.5) → período REAL (ex.: `nextDueDate=03/mar` → início 03/fev → base 28). `null` (fora
de banda / `nextDueDate` inválido) → NÃO grava base (fica no valor vigente/fallback + log),
consistente com o fallback `calculateExpiryDate` do próprio `plan_expires_at`. Importar
`computeProrationBasisDays` de `@/lib/proration` nos dois arquivos.
> Estes caminhos são o fallback do webhook-fora-do-ar; a renovação normal recalcula a base no
> webhook (§4.A/§5). Sem esta correção, a afirmação "a base é recalculada em TODA renovação"
> (§5) seria FALSA na renovação degradada. Vai no **commit C** (junto dos writers de renovação).

---

## 5. Lógica de RENOVAÇÃO (webhook/polling/reprocess) + guard de evento tardio

- **Ponto natural:** `finalizeActivation` passo 4a (§4.A) — recomputa a base em TODA renovação
  usando `payment.dueDate` (início) e `subscription.nextDueDate` (fim). Polling/reprocess
  gravam o MESMO valor (derivam o início por mês/ano-CALENDÁRIO a partir de `nextDueDate`
  quando não têm `payment.dueDate`).
- **Guard RECEIVED tardio** (`route.ts:728-764`): a distinção renovação × liquidação tardia
  (~D+32) já existe via `dueDate`/`plan_expires_at` (`skipProfileUpdate`). O webhook passa
  `writeBasis: !skipProfileUpdate` → o evento tardio **NÃO sobrescreve** a base vigente.
- **`nextDueDate` ainda não avançou** (Asaas lento pós-CONFIRMED): `computeProrationBasisDays`
  deriva o fim por `calendarShift(+1 ciclo)` — **NUNCA +30/365** — e a guarda-sã rejeita
  valores fora de banda → fallback 30/365 logado (nunca uma base absurda).
- **Reprocessamento / polling** são idempotentes: recomputar dá o mesmo período corrente.

---

## 6. Helper de dias reais
`computeProrationBasisDays(cycle, nextDueDate, paymentDueDate?)` — §2.5. Único ponto de
verdade da conta `dueDate → nextDueDate` (com clamp calendário e guarda-sã). Testado à parte.

---

## 7. Divisão em 3 commits

### Commit A — core + read + migration + types + testes behavior-preserving
**BEHAVIOR-PRESERVING:** enquanto nenhum writer grava a base, todo read tem `basisDays` nulo
→ fallback 30/365 → números IDÊNTICOS aos de hoje. Verde, zero mudança em produção.
- `supabase/migrations/20260703_profiles_proration_basis_days.sql` (§1)
- `lib/database.types.ts` (§1)
- `lib/proration.ts` (§2: comentário reescrito, `basisDays`+`resolveBasisDays`+log,
  `computeProrationBasisDays`)
- `lib/plan-change.ts` (§3: `PlanChangeInput.prorationBasisDays` + repasse)
- `lib/billing-profile.ts` (§3.1: carrega/expõe `prorationBasisDays`)
- `app/api/checkout/[plan]/route.ts:176` e `preview/route.ts:61` (passam a base ao
  computePlanChange)
- **Testes:** converter `lib/proration.test.ts` p/ Vitest determinístico (relógio fixo) e
  REMOVER da exclusão em `vitest.config.ts`; casos (a),(b),(c),(d parcial round-trip),(e), +
  unit de `computeProrationBasisDays` (f), + fallback null→30/365 (mesmo número + log).

### Commit B — writers dos switches (casos 2, 3, 4)
- `lib/plan-switch.ts` (§4.D: `PlanSwitchParams.prorationBasisDays` + grava no update)
- `app/api/checkout/[plan]/route.ts` Caso 1 (§4.E: `basisForSwitch` preserve/30-365) e
  confirmação do Caso 2 (default)
- **Testes:** `lib/plan-switch.test.ts` (já existe) — asserção de que o update do profile
  inclui `proration_basis_days` = 30/365 (upgrade_paid/credit_covered p/ plano ≠) e =
  base vigente (reativação mesmo plano+ciclo). Round-trip (caso d completo) e cobertura
  78/158 mantendo base 30 (caso e) em `proration.test.ts`.

### Commit C — writers de compra/renovação + free (casos 1, 5, 6)
- `lib/billing-activation.ts` (§4.A `finalizeActivation` compute+write+`paymentDueDate`+
  `writeBasis`; §4.C `buildActivePlanUpdate`/`buildFreePlanUpdate` limpam a base)
- `app/api/webhooks/asaas/route.ts` (§4.B: passa `payment.dueDate` + `writeBasis`; inline
  update limpa; 3 reverts limpam)
- `app/api/cron/expire-plans/route.ts` (§4.C revert limpa a base; §4.F EXTEND recomputa a base)
- `app/api/user/plan-features/route.ts` (§4.C revert limpa a base; §4.F EXTEND recomputa a base)
- **Testes:** `lib/billing-activation.basis.test.ts` (novo, mock de `@/lib/asaas`) —
  renovação 31→30→28 (caso f no writer), evento tardio `writeBasis:false` NÃO grava base
  (caso g), payloads de todos os caminhos incluem/limpam a base (caso h); ajustar
  `billing-activation.annual.test.ts` se assertar shape exato.

> O comentário auto-contraditório (`proration.ts:10-12`) é corrigido no **commit A** (A já
> reescreve o bloco). Registrado como desvio consciente do "C: remove comentário".

---

## 8. Lista completa de testes (casos a–h) e onde colocar

Todos em **Vitest** com **relógio FIXO** (`vi.useFakeTimers()` + `vi.setSystemTime(new
Date('2026-02-01T12:00:00-03:00'))` e variações), pois `remainingPaidDays` usa `Date.now()`.

| Caso | Descrição | Arquivo |
|---|---|---|
| a | mês 31d: `credit(base 31, 31d rest.) = R$49,00` ≤ pago (com base null daria R$50,63 — documentar) | `lib/proration.test.ts` |
| b | fevereiro 28 e 29: `base=28`→sem sobrecobrança; `base=29` bissexto | `lib/proration.test.ts` |
| c | anual 365 e 366 (`computeProrationBasisDays` YEARLY 365/366) | `lib/proration.test.ts` |
| d | Pro→Starter: credit R$257 → coverage 158 (base 30) → volta `credit(Starter,158d,base 30)=R$258,03≈257`; e ASSERT que base=158 daria R$49 (a armadilha) | `lib/proration.test.ts` |
| e | cobertura 78 e 158 dias com base 30 (`calculateCreditCoverageDays` inalterado) | `lib/proration.test.ts` |
| f | `computeProrationBasisDays`: renovação 31→30→28 (jul→ago 31, abr→mai 30, jan→fev 28); stale nextDueDate → deriva; sem paymentDueDate → deriva; fora de banda → null | `lib/proration.test.ts` (unit) + `lib/billing-activation.basis.test.ts` (writer) |
| g | evento tardio: `finalizeActivation` com `writeBasis:false` → update SEM `proration_basis_days` | `lib/billing-activation.basis.test.ts` (mock `@/lib/asaas`) |
| h | todos os caminhos gravam/limpam: `buildActivePlanUpdate` tem `proration_basis_days:null`; `buildFreePlanUpdate` idem; `executePlanSwitch` grava 30/365 (default) e base vigente (preserve); `finalizeActivation` grava a base real; **reverts inline p/ free (cron/expire-plans, plan-features) limpam; EXTEND (§4.F) recomputa** | `lib/billing-activation.basis.test.ts` + `lib/plan-switch.test.ts` |

`lib/proration.test.ts`: converter de script (`assert`/`process.exit`) para
`describe/it/expect` e TIRAR da lista `exclude` em `vitest.config.ts` (linha 11). Preservar
TODOS os asserts numéricos atuais que continuam válidos (eles rodam com base explícita agora).

---

## 9. Riscos e como cada invariante de dinheiro é preservado

- **Round-trip (saldo-vira-tempo):** `calculateCreditCoverageDays` intacto (nominal 30/365) +
  base gravada 30/365 nos switches (casos 2/3) → ida-e-volta converge, `ceil` concede ≤1
  dia/conversão a favor do cliente. **Caso d** trava isso.
- **Sem sobrecobrança (fevereiro):** base = período REAL (28) → `credit(base 28, 28d) = full`,
  nunca sub-credita. Sem correção, base 30 sub-creditava (dano até R$17,13 em Pro). **Casos a/b.**
- **Sem vazamento (mês 31d):** base = 31 → `credit ≤ pago`. **Caso a.**
- **Armadilha do divisor=duração:** base de saldo-vira-tempo é 30/365, NUNCA `coverageDays`
  (senão Pro→Starter perderia R$208). **Caso d** assert-negativo.
- **Fallback seguro:** base null (legado / leitura falhou / fora de banda) → 30/365 = exatamente
  o comportamento atual, e o `plan_expires_at` cai no mesmo `now+ciclo` → consistentes. Com LOG
  p/ não mascarar um writer novo esquecido. **Caso h (fallback).**
- **Evento tardio não corrompe:** `writeBasis:false` no RECEIVED tardio (mesmo guard já
  existente do `plan_expires_at`). **Caso g.**
- **Reativação-identidade não deriva:** mesmo plano+ciclo PRESERVA a base vigente (não vira 30);
  os dias já eram identidade via `remainingPaidDays`. **Caso h (preserve).**
- **`nextDueDate` não avançado / corrompido:** derivação por CALENDÁRIO + guarda-sã → nunca
  +30/365 nem base absurda. **Caso f.**
- **Regressão zero no commit A:** base nula em todo lugar → números idênticos aos do script de
  teste atual (que vira suíte Vitest e continua verde).
- **Concorrência:** a base é escrita nos MESMOS updates atômicos/CAS que já governam
  `plan_expires_at`/`asaas_subscription_id` — herda os guards de CAS e "checkout mais novo
  vence" sem nova superfície de corrida.

---

## 10. Checklist de execução
> ⚠️ **A migration precede o DEPLOY do commit A** (não só o merge): o `select` de
> `getBillingProfileForUser` (§3.1) passa a pedir `proration_basis_days` — publicar o código
> antes da coluna existir quebra checkout/preview p/ todos. Ordem segura em produção:
1. Commit A (migration + core read + types + suíte Vitest verde, behavior-preserving). Commits
   ficam LOCAIS (proibido `git push`).
2. **Rodar a migration MANUALMENTE no Supabase (aditiva, nullable; sem downtime) ANTES de
   qualquer publicação do código do commit A.** Só então o código do A pode ir a produção.
3. Commit B (switch writers + testes).
4. Commit C (compra/renovação/free writers + testes — inclui §4.C reverts extra, §4.F renovação
   fora do webhook).
5. `npm run lint` e `npx vitest run` (suítes de billing verdes) a cada commit. NÃO `git push`.
6. Todos os commits terminam com:
   `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
