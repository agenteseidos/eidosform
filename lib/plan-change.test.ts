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

// Downgrade de TIER (plus→starter, mesmo ciclo) = downgrade honesto
const tierDown = computePlanChange({
  currentPlan: 'plus', currentCycle: 'MONTHLY', planExpiresAt: future,
  hasActiveSubscription: true, newPlan: 'starter', newCycle: 'MONTHLY',
})
assert(tierDown.action === 'downgrade_scheduled', 'plus→starter = downgrade_scheduled')

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

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
