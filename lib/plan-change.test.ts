/**
 * Testes de computePlanChange (lib/plan-change.ts) — decisão de mudança de plano.
 * Execute: npx tsx lib/plan-change.test.ts
 *
 * Foco: a decisão de ação (downgrade_scheduled vs proration/checkout), em especial o
 * DOWNGRADE DE CICLO anual→mensal tratado como downgrade honesto. (#5, Sidney 2026-06-08.)
 */
import { computePlanChange } from './plan-change'

let passed = 0
let failed = 0
function assert(cond: boolean, name: string) {
  if (cond) { console.log(`✅ ${name}`); passed++ }
  else { console.log(`❌ ${name}`); failed++ }
}

const future = new Date(Date.now() + 200 * 24 * 3600 * 1000).toISOString()

// #5 — anual→mensal (mesmo plano) = DOWNGRADE honesto (não edita a sub)
const cycleDown = computePlanChange({
  currentPlan: 'plus', currentCycle: 'YEARLY', planExpiresAt: future,
  hasActiveSubscription: true, newPlan: 'plus', newCycle: 'MONTHLY',
})
assert(cycleDown.action === 'downgrade_scheduled', 'anual→mensal mesmo plano = downgrade_scheduled')
assert(cycleDown.proration === null, 'downgrade de ciclo não calcula proration')

// mensal→anual (mesmo plano) = upgrade de ciclo (proration), NUNCA downgrade
const cycleUp = computePlanChange({
  currentPlan: 'plus', currentCycle: 'MONTHLY', planExpiresAt: future,
  hasActiveSubscription: true, newPlan: 'plus', newCycle: 'YEARLY',
})
assert(cycleUp.action !== 'downgrade_scheduled', 'mensal→anual NÃO é downgrade')
assert(cycleUp.shouldApplyProration === true, 'mensal→anual aplica proration (upgrade de ciclo)')

// Downgrade de TIER (plus→starter) agora é LIBERADO (não mais downgrade_scheduled): flui pela
// proration/Caminho D — o saldo do Plus vira tempo de Starter. (decisão Sidney 2026-06-08.)
const tierDown = computePlanChange({
  currentPlan: 'plus', currentCycle: 'MONTHLY', planExpiresAt: future,
  hasActiveSubscription: true, newPlan: 'starter', newCycle: 'MONTHLY',
})
assert(tierDown.action !== 'downgrade_scheduled', 'plus→starter NÃO é mais bloqueado (downgrade liberado)')
assert(tierDown.isPlanDowngrade === true, 'plus→starter é downgrade de tier (flag)')
assert(tierDown.action === 'credit_covered', 'plus→starter com saldo = credit_covered (Caminho D)')

// Downgrade de CICLO (anual→mensal MESMO plano) CONTINUA como mensagem honesta (não liberado)
const cycleDownStill = computePlanChange({
  currentPlan: 'plus', currentCycle: 'YEARLY', planExpiresAt: future,
  hasActiveSubscription: true, newPlan: 'plus', newCycle: 'MONTHLY',
})
assert(cycleDownStill.action === 'downgrade_scheduled', 'anual→mensal mesmo plano segue downgrade_scheduled')

// Upgrade de TIER (starter→plus) NÃO é downgrade
const tierUp = computePlanChange({
  currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: future,
  hasActiveSubscription: true, newPlan: 'plus', newCycle: 'MONTHLY',
})
assert(tierUp.action !== 'downgrade_scheduled', 'starter→plus NÃO é downgrade')
assert(tierUp.isPlanUpgrade === true, 'starter→plus é upgrade de tier')

// Já assinante exatamente do mesmo plano+ciclo
const same = computePlanChange({
  currentPlan: 'plus', currentCycle: 'MONTHLY', planExpiresAt: future,
  hasActiveSubscription: true, newPlan: 'plus', newCycle: 'MONTHLY',
})
assert(same.action === 'already_subscribed', 'mesmo plano+ciclo = already_subscribed')

// Primeira compra (sem sub ativa) = checkout, nunca downgrade
const firstBuy = computePlanChange({
  currentPlan: 'free', currentCycle: null, planExpiresAt: null,
  hasActiveSubscription: false, newPlan: 'starter', newCycle: 'MONTHLY',
})
assert(firstBuy.action === 'checkout', 'free→starter (1ª compra) = checkout')

// ── #2: CANCELING (sem sub ativa, mas COM saldo) ganha crédito do período restante ──
const future80 = new Date(Date.now() + 80 * 24 * 3600 * 1000).toISOString()
const future300 = new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString()

// Canceling Plus mensal (saldo ~80 dias) → reassinar Plus anual: crédito aplicado, paga a diferença
const cancelResub = computePlanChange({
  currentPlan: 'plus', currentCycle: 'MONTHLY', planExpiresAt: future80,
  hasActiveSubscription: false, hasPaidPeriodRemaining: true, newPlan: 'plus', newCycle: 'YEARLY',
})
assert(cancelResub.action === 'checkout', 'canceling Plus→Plus anual = checkout (proration)')
assert(!!cancelResub.proration && cancelResub.proration.credit > 0, 'canceling: crédito > 0 (saldo aplicado)')
assert(!!cancelResub.proration && cancelResub.proration.finalPrice < 1164, 'canceling: paga MENOS que o cheio (1164)')
assert(!!cancelResub.proration && cancelResub.proration.finalPrice === Math.round((1164 - cancelResub.proration.credit) * 100) / 100, 'canceling: finalPrice = cheio - crédito')

// MESMO cenário SEM o flag (free comum, sem saldo) = preço CHEIO, sem crédito
const noCredit = computePlanChange({
  currentPlan: 'plus', currentCycle: 'MONTHLY', planExpiresAt: future80,
  hasActiveSubscription: false, hasPaidPeriodRemaining: false, newPlan: 'plus', newCycle: 'YEARLY',
})
assert(noCredit.action === 'checkout' && noCredit.proration === null && noCredit.amountDueNow === 1164, 'sem saldo (flag false) = preço cheio, sem crédito')

// Canceling Professional anual (saldo grande) → reassinar Starter mensal: saldo COBRE tudo
const cancelCovered = computePlanChange({
  currentPlan: 'professional', currentCycle: 'YEARLY', planExpiresAt: future300,
  hasActiveSubscription: false, hasPaidPeriodRemaining: true, newPlan: 'starter', newCycle: 'MONTHLY',
})
assert(cancelCovered.action === 'credit_covered', 'canceling: saldo cobre tudo = credit_covered')
assert(cancelCovered.coveredByCredit === true && cancelCovered.amountDueNow === 0, 'canceling coberto: paga R$0 agora')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
