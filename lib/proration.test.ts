/**
 * Tests lógicos para lib/proration.ts
 * Execute: npx tsx lib/proration.test.ts
 */

import { calculateProrationCredit, calculateUpgradePrice, isUpgrade } from './proration'

let passed = 0
let failed = 0

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`✅ ${name}`)
    passed++
  } else {
    console.log(`❌ ${name}`)
    failed++
  }
}

function approx(a: number, b: number, epsilon = 0.01): boolean {
  return Math.abs(a - b) < epsilon
}

// --- isUpgrade ---
assert(isUpgrade('starter', 'plus'), 'starter → plus is upgrade')
assert(isUpgrade('starter', 'professional'), 'starter → professional is upgrade')
assert(isUpgrade('plus', 'professional'), 'plus → professional is upgrade')
assert(!isUpgrade('plus', 'starter'), 'plus → starter is NOT upgrade')
assert(!isUpgrade('professional', 'plus'), 'professional → plus is NOT upgrade')
assert(!isUpgrade('starter', 'starter'), 'same plan is NOT upgrade')

// --- calculateProrationCredit ---
// Plano starter mensal R$49, 15 dias restantes de 30
const now = new Date()
const expires15d = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000)

const credit15 = calculateProrationCredit({
  currentPlan: 'starter',
  currentCycle: 'MONTHLY',
  planExpiresAt: expires15d.toISOString(),
})
assert(approx(credit15, 24.5), `15 dias starter mensal = R$24.50 (got ${credit15})`)

// Plano plus anual R$1164, 182 dias restantes de 365
const expires182d = new Date(now.getTime() + 182 * 24 * 60 * 60 * 1000)
const credit182 = calculateProrationCredit({
  currentPlan: 'plus',
  currentCycle: 'YEARLY',
  planExpiresAt: expires182d.toISOString(),
})
assert(approx(credit182, 580.41), `182 dias plus anual ≈ R$580.41 (got ${credit182})`)

// Plano expirado = 0 crédito
const expired = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
const creditExpired = calculateProrationCredit({
  currentPlan: 'starter',
  currentCycle: 'MONTHLY',
  planExpiresAt: expired.toISOString(),
})
assert(creditExpired === 0, 'Plano expirado = crédito 0')

// --- calculateUpgradePrice ---
// Starter mensal (15 dias restantes) → Plus mensal
const upgrade = calculateUpgradePrice({
  currentPlan: 'starter',
  currentCycle: 'MONTHLY',
  planExpiresAt: expires15d.toISOString(),
  newPlan: 'plus',
  newCycle: 'MONTHLY',
})
assert(approx(upgrade.credit, 24.5), `Upgrade credit ≈ R$24.50 (got ${upgrade.credit})`)
assert(approx(upgrade.originalPrice, 127), `Upgrade originalPrice = R$127 (got ${upgrade.originalPrice})`)
assert(approx(upgrade.finalPrice, 102.5), `Upgrade finalPrice ≈ R$102.50 (got ${upgrade.finalPrice})`)
assert(approx(upgrade.newPrice, 127), `Upgrade newPrice = R$127`)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
