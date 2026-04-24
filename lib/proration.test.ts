/**
 * Testes lógicos para lib/proration.ts — Proration & Billing
 * Execute: npx tsx lib/proration.test.ts
 *
 * Cenários cobertos:
 * 1. isUpgrade — todas as combinações de planos
 * 2. calculateProrationCredit — vários tempos restantes
 * 3. calculateUpgradePrice — upgrades anuais, retroativo, downgrade, troca de ciclo
 * 4. Edge cases — crédito cobre plano inteiro, 0 dias restantes, plano expirado
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

// Helper: data N dias a partir de agora
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

// ============================================================
// 1. isUpgrade — todas as combinações
// ============================================================
console.log('\n=== isUpgrade ===')

assert(isUpgrade('starter', 'plus'), 'starter → plus is upgrade')
assert(isUpgrade('starter', 'professional'), 'starter → professional is upgrade')
assert(isUpgrade('plus', 'professional'), 'plus → professional is upgrade')
assert(isUpgrade('free', 'starter'), 'free → starter is upgrade')
assert(isUpgrade('free', 'plus'), 'free → plus is upgrade')
assert(isUpgrade('free', 'professional'), 'free → professional is upgrade')

assert(!isUpgrade('plus', 'starter'), 'plus → starter is NOT upgrade (downgrade)')
assert(!isUpgrade('professional', 'plus'), 'professional → plus is NOT upgrade (downgrade)')
assert(!isUpgrade('professional', 'starter'), 'professional → starter is NOT upgrade (downgrade)')
assert(!isUpgrade('starter', 'starter'), 'same plan is NOT upgrade')
assert(!isUpgrade('plus', 'plus'), 'same plan is NOT upgrade')
assert(!isUpgrade('professional', 'professional'), 'same plan is NOT upgrade')
assert(!isUpgrade('free', 'free'), 'free → free is NOT upgrade')

// ============================================================
// 2. calculateProrationCredit
// ============================================================
console.log('\n=== calculateProrationCredit ===')

// Starter mensal R$49, 15 dias restantes de 30
const credit15 = calculateProrationCredit({
  currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(15),
})
assert(approx(credit15, 24.5), `15 dias starter mensal = R$24.50 (got ${credit15})`)

// Plus anual R$1164, 182 dias (meio ano) restantes de 365
const credit182 = calculateProrationCredit({
  currentPlan: 'plus', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(182),
})
assert(approx(credit182, 580.41), `182 dias plus anual ≈ R$580.41 (got ${credit182})`)

// Plano expirado = 0 crédito
const creditExpired = calculateProrationCredit({
  currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(-5),
})
assert(creditExpired === 0, 'Plano expirado = crédito 0')

// 0 dias restantes (expira agora) = 0 crédito
const credit0 = calculateProrationCredit({
  currentPlan: 'plus', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(0),
})
assert(credit0 === 0, '0 dias restantes = crédito 0')

// 1 dia restante
const credit1 = calculateProrationCredit({
  currentPlan: 'professional', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(1),
})
assert(approx(credit1, 8.57), `1 dia professional mensal ≈ R$8.57 (got ${credit1})`)

// Plano anual quase cheio (360 dias restantes)
const credit360 = calculateProrationCredit({
  currentPlan: 'starter', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(360),
})
assert(approx(credit360, 343.23), `360 dias starter anual ≈ R$343.23 (got ${credit360})`)

// ============================================================
// 3. calculateUpgradePrice — cenários de upgrade anual
// ============================================================
console.log('\n=== calculateUpgradePrice: upgrades anuais ===')

// 3a. starter yearly → plus yearly com ~ano cheio restante (360 dias)
const starterToPlusAnnual = calculateUpgradePrice({
  currentPlan: 'starter', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(360),
  newPlan: 'plus', newCycle: 'YEARLY',
})
assert(approx(starterToPlusAnnual.credit, 343.23), `S→P anual credit ≈ R$343.23 (got ${starterToPlusAnnual.credit})`)
assert(approx(starterToPlusAnnual.originalPrice, 1164), `S→P anual newPrice = R$1164 (got ${starterToPlusAnnual.originalPrice})`)
assert(approx(starterToPlusAnnual.finalPrice, 820.77), `S→P anual finalPrice ≈ R$820.77 (got ${starterToPlusAnnual.finalPrice})`)
assert(starterToPlusAnnual.finalPrice > 0, 'S→P anual finalPrice > 0')
assert(starterToPlusAnnual.finalPrice < starterToPlusAnnual.originalPrice, 'S→P anual tem desconto')

// 3b. starter yearly → professional yearly
const starterToProAnnual = calculateUpgradePrice({
  currentPlan: 'starter', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(365),
  newPlan: 'professional', newCycle: 'YEARLY',
})
assert(approx(starterToProAnnual.credit, 348), `S→Pro anual credit = R$348 (got ${starterToProAnnual.credit})`)
assert(approx(starterToProAnnual.originalPrice, 2364), `S→Pro anual newPrice = R$2364 (got ${starterToProAnnual.originalPrice})`)
assert(approx(starterToProAnnual.finalPrice, 2016), `S→Pro anual finalPrice = R$2016 (got ${starterToProAnnual.finalPrice})`)

// 3c. plus yearly → professional yearly (365 dias restantes)
const plusToProAnnual = calculateUpgradePrice({
  currentPlan: 'plus', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(365),
  newPlan: 'professional', newCycle: 'YEARLY',
})
assert(approx(plusToProAnnual.credit, 1164), `P→Pro anual credit = R$1164 (got ${plusToProAnnual.credit})`)
assert(approx(plusToProAnnual.originalPrice, 2364), `P→Pro anual newPrice = R$2364 (got ${plusToProAnnual.originalPrice})`)
assert(approx(plusToProAnnual.finalPrice, 1200), `P→Pro anual finalPrice = R$1200 (got ${plusToProAnnual.finalPrice})`)

// ============================================================
// 4. Cenário retroativo com poucos dias restantes
// ============================================================
console.log('\n=== Retroativo: poucos dias restantes ===')

// starter yearly com 5 dias restantes → plus yearly
const retro5d = calculateUpgradePrice({
  currentPlan: 'starter', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(5),
  newPlan: 'plus', newCycle: 'YEARLY',
})
assert(approx(retro5d.credit, 4.77), `Retro 5d credit ≈ R$4.77 (got ${retro5d.credit})`)
assert(approx(retro5d.finalPrice, 1159.23), `Retro 5d finalPrice ≈ R$1159.23 (got ${retro5d.finalPrice})`)
assert(retro5d.credit < 10, 'Retro 5d crédito é pequeno')

// plus yearly com 3 dias restantes → professional yearly
const retro3d = calculateUpgradePrice({
  currentPlan: 'plus', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(3),
  newPlan: 'professional', newCycle: 'YEARLY',
})
assert(approx(retro3d.credit, 9.57), `Retro 3d credit ≈ R$9.57 (got ${retro3d.credit})`)
assert(approx(retro3d.finalPrice, 2354.43), `Retro 3d finalPrice ≈ R$2354.43 (got ${retro3d.finalPrice})`)

// ============================================================
// 5. Mesmo plano com ciclo diferente (mensal → anual)
// ============================================================
console.log('\n=== Troca de ciclo: mensal → anual ===')

// Starter mensal (15 dias restantes) → Starter anual
const starterCycleChange = calculateUpgradePrice({
  currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(15),
  newPlan: 'starter', newCycle: 'YEARLY',
})
assert(approx(starterCycleChange.credit, 24.5), `S mensal→anual credit ≈ R$24.50 (got ${starterCycleChange.credit})`)
assert(approx(starterCycleChange.originalPrice, 348), `S mensal→anual originalPrice = R$348 (got ${starterCycleChange.originalPrice})`)
assert(approx(starterCycleChange.finalPrice, 323.5), `S mensal→anual finalPrice ≈ R$323.50 (got ${starterCycleChange.finalPrice})`)

// Plus mensal (20 dias restantes) → Plus anual
const plusCycleChange = calculateUpgradePrice({
  currentPlan: 'plus', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(20),
  newPlan: 'plus', newCycle: 'YEARLY',
})
assert(approx(plusCycleChange.credit, 84.67), `P mensal→anual credit ≈ R$84.67 (got ${plusCycleChange.credit})`)
assert(approx(plusCycleChange.originalPrice, 1164), `P mensal→anual originalPrice = R$1164 (got ${plusCycleChange.originalPrice})`)
assert(approx(plusCycleChange.finalPrice, 1079.33), `P mensal→anual finalPrice ≈ R$1079.33 (got ${plusCycleChange.finalPrice})`)

// ============================================================
// 6. Downgrade bloqueado — isUpgrade retorna false
// ============================================================
console.log('\n=== Downgrade: isUpgrade bloqueia ===')

assert(!isUpgrade('professional', 'starter'), 'professional → starter bloqueado')
assert(!isUpgrade('professional', 'plus'), 'professional → plus bloqueado')
assert(!isUpgrade('plus', 'starter'), 'plus → starter bloqueado')
assert(!isUpgrade('professional', 'free'), 'professional → free bloqueado')

// calcularUpgradePrice NÃO bloqueia downgrade internamente — valida que o cálculo existe
// mas o checkout deve checar isUpgrade antes de chamar
const downgradeCalc = calculateUpgradePrice({
  currentPlan: 'professional', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(365),
  newPlan: 'starter', newCycle: 'YEARLY',
})
// Crédito do plano mais caro pode ser maior que o plano mais barato → finalPrice = 0
assert(downgradeCalc.credit > 0, 'Downgrade calc: crédito > 0')
assert(downgradeCalc.finalPrice >= 0, 'Downgrade calc: finalPrice >= 0 (nunca negativo)')
assert(approx(downgradeCalc.finalPrice, 0), 'Downgrade calc: finalPrice = 0 (crédito cobre tudo)')

// ============================================================
// 7. Edge cases
// ============================================================
console.log('\n=== Edge cases ===')

// Crédito cobre o plano inteiro → finalPrice = 0
const coveredByCredit = calculateUpgradePrice({
  currentPlan: 'professional', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(365),
  newPlan: 'starter', newCycle: 'MONTHLY',
})
assert(approx(coveredByCredit.finalPrice, 0), 'Crédito cobre tudo: finalPrice = 0')

// Upgrade mensal clássico: starter mensal (15d) → plus mensal
const monthlyUpgrade = calculateUpgradePrice({
  currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(15),
  newPlan: 'plus', newCycle: 'MONTHLY',
})
assert(approx(monthlyUpgrade.credit, 24.5), `Mensal upgrade credit ≈ R$24.50 (got ${monthlyUpgrade.credit})`)
assert(approx(monthlyUpgrade.originalPrice, 127), `Mensal upgrade newPrice = R$127 (got ${monthlyUpgrade.originalPrice})`)
assert(approx(monthlyUpgrade.finalPrice, 102.5), `Mensal upgrade finalPrice ≈ R$102.50 (got ${monthlyUpgrade.finalPrice})`)

// newPrice e originalPrice são sempre iguais (alias intencional no código)
assert(monthlyUpgrade.newPrice === monthlyUpgrade.originalPrice, 'newPrice === originalPrice (alias)')

// Plano free = preço 0, crédito 0
const freeCredit = calculateProrationCredit({
  currentPlan: 'free', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(15),
})
assert(freeCredit === 0, 'Free plan = crédito 0')

// ============================================================
// Resultado
// ============================================================
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
