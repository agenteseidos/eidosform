/**
 * Testes de lib/proration.ts — Proration & Billing (suíte Vitest determinística).
 *
 * Relógio FIXO (vi.useFakeTimers + setSystemTime): remainingPaidDays lê Date.now(), então
 * a base temporal precisa ser estável. Usamos meia-tarde BRT (12:00-03:00) para que
 * `daysFromNow(N)` caia exatamente no mesmo horário N dias à frente → diferença de dias
 * INTEIROS previsível.
 *
 * Cobre:
 *  - isUpgrade (todas as combinações)
 *  - calculateProrationCredit / calculateUpgradePrice (base null = fallback 30/365 = números
 *    IDÊNTICOS ao comportamento pré-mudança; behavior-preserving) + com base explícita
 *  - saldo-vira-tempo (calculateCreditCoverageDays — inalterado)
 *  - computeProrationBasisDays (período REAL: 31/30/28/365/366, stale, derivação, fora de banda)
 *  - casos do plano: (a) mês 31d, (b) fev 28/29, (c) anual 365/366, (d) round-trip 158d base 30,
 *    (e) cobertura 78/158 base 30, + fallback null→30/365.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import {
  calculateProrationCredit,
  calculateUpgradePrice,
  calculateCreditCoverageDays,
  remainingPaidDays,
  addDaysToTodayBRT,
  isUpgrade,
  computeProrationBasisDays,
} from './proration'

// Relógio fixo: meia-tarde BRT.
const FIXED_NOW = new Date('2026-03-15T12:00:00-03:00')

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})
afterAll(() => {
  vi.useRealTimers()
})

// Helper: data ISO N dias a partir de "agora" (relógio fixo).
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

const approx = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps

// ============================================================
// 1. isUpgrade
// ============================================================
describe('isUpgrade', () => {
  it('detecta upgrades', () => {
    expect(isUpgrade('starter', 'plus')).toBe(true)
    expect(isUpgrade('starter', 'professional')).toBe(true)
    expect(isUpgrade('plus', 'professional')).toBe(true)
    expect(isUpgrade('free', 'starter')).toBe(true)
    expect(isUpgrade('free', 'plus')).toBe(true)
    expect(isUpgrade('free', 'professional')).toBe(true)
  })
  it('não trata downgrade/igual como upgrade', () => {
    expect(isUpgrade('plus', 'starter')).toBe(false)
    expect(isUpgrade('professional', 'plus')).toBe(false)
    expect(isUpgrade('professional', 'starter')).toBe(false)
    expect(isUpgrade('starter', 'starter')).toBe(false)
    expect(isUpgrade('plus', 'plus')).toBe(false)
    expect(isUpgrade('professional', 'professional')).toBe(false)
    expect(isUpgrade('free', 'free')).toBe(false)
  })
})

// ============================================================
// 2. calculateProrationCredit — base null (fallback 30/365) = comportamento atual
// ============================================================
describe('calculateProrationCredit (base null → fallback 30/365, behavior-preserving)', () => {
  it('15 dias starter mensal = R$24.50', () => {
    const c = calculateProrationCredit({ currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(15) })
    expect(approx(c, 24.5)).toBe(true)
  })
  it('182 dias plus anual ≈ R$580.41', () => {
    const c = calculateProrationCredit({ currentPlan: 'plus', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(182) })
    expect(approx(c, 580.41)).toBe(true)
  })
  it('plano expirado = 0', () => {
    expect(calculateProrationCredit({ currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(-5) })).toBe(0)
  })
  it('0 dias restantes = 0', () => {
    expect(calculateProrationCredit({ currentPlan: 'plus', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(0) })).toBe(0)
  })
  it('1 dia professional mensal ≈ R$8.57', () => {
    const c = calculateProrationCredit({ currentPlan: 'professional', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(1) })
    expect(approx(c, 8.57)).toBe(true)
  })
  it('360 dias starter anual ≈ R$343.23', () => {
    const c = calculateProrationCredit({ currentPlan: 'starter', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(360) })
    expect(approx(c, 343.23)).toBe(true)
  })
  it('SEM teto: 35 dias starter mensal = R$57.17 (dias reais)', () => {
    const c = calculateProrationCredit({ currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(35) })
    expect(approx(c, 57.17)).toBe(true)
  })
  it('SEM teto: 400 dias plus anual = R$1275.62', () => {
    const c = calculateProrationCredit({ currentPlan: 'plus', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(400) })
    expect(approx(c, 1275.62)).toBe(true)
  })
  it('30 dias starter mensal ≈ R$49 sem estourar', () => {
    const c = calculateProrationCredit({ currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(30) })
    expect(c).toBeLessThanOrEqual(49.0)
    expect(c).toBeGreaterThanOrEqual(48.5)
  })
  it('free = 0', () => {
    expect(calculateProrationCredit({ currentPlan: 'free', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(15) })).toBe(0)
  })
})

// ============================================================
// 2b. calculateProrationCredit — com BASE EXPLÍCITA (período real)
// ============================================================
describe('calculateProrationCredit (base explícita = período REAL do Asaas)', () => {
  // (a) mês de 31 dias: base 31, 31 dias restantes → crédito = preço EXATO (nunca supera o pago).
  it('(a) mês 31d: base=31 + 31 dias → R$49.00 (não R$50.63 do fallback 30)', () => {
    const real = calculateProrationCredit({ currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(31), basisDays: 31 })
    expect(real).toBe(49)
    // Documenta a distorção que a base corrige: base null (30) super-credita.
    const nominal = calculateProrationCredit({ currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(31), basisDays: null })
    expect(approx(nominal, 50.63)).toBe(true)
    expect(real).toBeLessThanOrEqual(49)
    expect(nominal).toBeGreaterThan(49)
  })
  it('(a) mês 31d Professional: base=31 + 31 dias → R$257 exato (fallback daria R$265.57)', () => {
    const real = calculateProrationCredit({ currentPlan: 'professional', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(31), basisDays: 31 })
    expect(real).toBe(257)
    const nominal = calculateProrationCredit({ currentPlan: 'professional', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(31), basisDays: null })
    expect(nominal).toBeGreaterThan(257) // super-credita → empresa perde
  })
  // (b) fevereiro 28: base 28, 28 dias → crédito = preço (sem sub-crédito = sem sobrecobrança).
  it('(b) fev 28d: base=28 + 28 dias → R$257 (fallback 30 SUB-creditaria → cobra o cliente a mais)', () => {
    const real = calculateProrationCredit({ currentPlan: 'professional', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(28), basisDays: 28 })
    expect(real).toBe(257)
    const nominal = calculateProrationCredit({ currentPlan: 'professional', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(28), basisDays: null })
    expect(nominal).toBeLessThan(257) // base 30 sub-credita → cliente pagaria a mais no upgrade
    expect(approx(257 - nominal, 17.13, 0.05)).toBe(true) // dano confirmado no briefing (~R$17,13)
  })
  // (b) fevereiro bissexto 29 dias.
  it('(b) fev 29d (bissexto): base=29 + 29 dias → R$257 exato', () => {
    const real = calculateProrationCredit({ currentPlan: 'professional', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(29), basisDays: 29 })
    expect(real).toBe(257)
  })
  it('base explícita 30 == fallback null (identidade da régua nominal)', () => {
    const withBase = calculateProrationCredit({ currentPlan: 'plus', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(15), basisDays: 30 })
    const nullBase = calculateProrationCredit({ currentPlan: 'plus', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(15), basisDays: null })
    expect(withBase).toBe(nullBase)
  })
})

// ============================================================
// 3. remainingPaidDays / addDaysToTodayBRT — régua de dias inteiros
// ============================================================
describe('remainingPaidDays / addDaysToTodayBRT', () => {
  it('conta dias inteiros', () => {
    expect(remainingPaidDays(daysFromNow(78))).toBe(78)
    expect(remainingPaidDays(daysFromNow(1))).toBe(1)
    expect(remainingPaidDays(daysFromNow(0))).toBe(0)
    expect(remainingPaidDays(daysFromNow(-5))).toBe(0)
    expect(remainingPaidDays('data-invalida')).toBe(0)
  })
  it('ida-e-volta: hoje + dias restantes = dia exato da expiração', () => {
    const brtDateOf = (ms: number) => new Date(ms - 3 * 3600 * 1000).toISOString().split('T')[0]
    const target78 = Date.now() + 78 * 24 * 3600 * 1000
    expect(addDaysToTodayBRT(remainingPaidDays(daysFromNow(78)))).toBe(brtDateOf(target78))
  })
})

// ============================================================
// 4. calculateCreditCoverageDays — saldo-vira-tempo (INALTERADO, nominal 30/365)
// ============================================================
describe('calculateCreditCoverageDays (nominal 30/365 — invariante do round-trip)', () => {
  it('(e) 1 ciclo exato mensal = 30 dias', () => {
    expect(calculateCreditCoverageDays(257, 257, 'MONTHLY')).toBe(30)
  })
  it('fração usa ceil (favorece o cliente)', () => {
    expect(calculateCreditCoverageDays(100, 257, 'MONTHLY')).toBe(12)
    expect(calculateCreditCoverageDays(1164, 257, 'MONTHLY')).toBe(136)
  })
  it('guardas: crédito/preço ≤ 0 → 0', () => {
    expect(calculateCreditCoverageDays(0, 257, 'MONTHLY')).toBe(0)
    expect(calculateCreditCoverageDays(100, 0, 'MONTHLY')).toBe(0)
  })
  it('anual: 1 ciclo exato = 365 dias', () => {
    expect(calculateCreditCoverageDays(2364, 2364, 'YEARLY')).toBe(365)
  })
  it('epsilon do ceil: conta exata com ruído de float não ganha +1 dia', () => {
    expect(calculateCreditCoverageDays(58.8, 49, 'MONTHLY')).toBe(36)
  })
  // (e) cobertura 78 e 158 dias com base 30 (a diária nominal do saldo-vira-tempo).
  it('(e) coverage de crédito grande: R$127 em Starter → 78 dias; R$257 em Starter → 158 dias', () => {
    // Plus mensal R$127 vira tempo de Starter (R$49): ceil(127*30/49) = ceil(77.75) = 78.
    expect(calculateCreditCoverageDays(127, 49, 'MONTHLY')).toBe(78)
    // Professional mensal R$257 vira tempo de Starter: ceil(257*30/49 - eps) = ceil(157.35) = 158.
    expect(calculateCreditCoverageDays(257, 49, 'MONTHLY')).toBe(158)
  })
})

// ============================================================
// 5. (d) round-trip Pro→Starter: crédito R$257 → 158 dias (base 30) → volta ≈ R$257.
//    Assert-negativo: se a base virasse 158 (a ARMADILHA), a volta daria só R$49.
// ============================================================
describe('(d) round-trip Pro→Starter (base de saldo-vira-tempo = 30, NUNCA coverageDays)', () => {
  it('R$257 → 158 dias (base 30) → credit(Starter,158d,base 30) ≈ R$257 (não perde saldo)', () => {
    const proCredit = 257 // Professional mensal cheio
    const coverage = calculateCreditCoverageDays(proCredit, 49, 'MONTHLY')
    expect(coverage).toBe(158)
    const back = calculateProrationCredit({ currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(coverage), basisDays: 30 })
    expect(approx(back, 258.07, 0.02)).toBe(true) // 49/30×158 = 258.07 ≈ 257 (ceil concede ≤1 dia; converge)
    expect(back).toBeGreaterThanOrEqual(257)
  })
  it('ARMADILHA travada: base=158 (duração) daria só R$49 → cliente perderia R$208', () => {
    const trap = calculateProrationCredit({ currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(158), basisDays: 158 })
    expect(trap).toBe(49) // exatamente o bug que a régua-30 evita
  })
})

// ============================================================
// 6. calculateUpgradePrice — cenários preservados (base null = números atuais)
// ============================================================
describe('calculateUpgradePrice (base null → behavior-preserving)', () => {
  it('S→P anual (360 dias)', () => {
    const r = calculateUpgradePrice({ currentPlan: 'starter', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(360), newPlan: 'plus', newCycle: 'YEARLY' })
    expect(approx(r.credit, 343.23)).toBe(true)
    expect(approx(r.originalPrice, 1164)).toBe(true)
    expect(approx(r.finalPrice, 820.77)).toBe(true)
  })
  it('P→Pro anual (365 dias)', () => {
    const r = calculateUpgradePrice({ currentPlan: 'plus', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(365), newPlan: 'professional', newCycle: 'YEARLY' })
    expect(approx(r.credit, 1164)).toBe(true)
    expect(approx(r.finalPrice, 1200)).toBe(true)
  })
  it('mensal clássico starter(15d)→plus', () => {
    const r = calculateUpgradePrice({ currentPlan: 'starter', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(15), newPlan: 'plus', newCycle: 'MONTHLY' })
    expect(approx(r.credit, 24.5)).toBe(true)
    expect(approx(r.finalPrice, 102.5)).toBe(true)
    expect(r.newPrice).toBe(r.originalPrice)
  })
  it('downgrade Pro→Starter anual: crédito cobre tudo → finalPrice 0', () => {
    const r = calculateUpgradePrice({ currentPlan: 'professional', currentCycle: 'YEARLY', planExpiresAt: daysFromNow(365), newPlan: 'starter', newCycle: 'YEARLY' })
    expect(r.credit).toBeGreaterThan(0)
    expect(r.finalPrice).toBe(0)
  })
  it('repassa basisDays ao crédito do plano atual', () => {
    // Pro mensal com 28 dias restantes, base 28 → crédito cheio R$257 cobre Starter (finalPrice 0).
    const r = calculateUpgradePrice({ currentPlan: 'professional', currentCycle: 'MONTHLY', planExpiresAt: daysFromNow(28), newPlan: 'starter', newCycle: 'MONTHLY', basisDays: 28 })
    expect(r.credit).toBe(257)
  })
})

// ============================================================
// 7. (c/f) computeProrationBasisDays — período REAL, derivação e guarda-sã
// ============================================================
describe('computeProrationBasisDays (período real do Asaas)', () => {
  it('(f) renovação mensal: jul→ago = 31 dias', () => {
    expect(computeProrationBasisDays('MONTHLY', '2026-08-03', '2026-07-03')).toBe(31)
  })
  it('(f) renovação mensal: abr→mai = 30 dias', () => {
    expect(computeProrationBasisDays('MONTHLY', '2026-05-01', '2026-04-01')).toBe(30)
  })
  it('(f) renovação mensal cobrindo fevereiro: fev→mar = 28 dias', () => {
    expect(computeProrationBasisDays('MONTHLY', '2026-03-01', '2026-02-01')).toBe(28)
  })
  it('(f) fevereiro bissexto: fev→mar 2028 = 29 dias', () => {
    expect(computeProrationBasisDays('MONTHLY', '2028-03-01', '2028-02-01')).toBe(29)
  })
  it('(c) anual: 2026→2027 = 365 dias', () => {
    expect(computeProrationBasisDays('YEARLY', '2027-03-15', '2026-03-15')).toBe(365)
  })
  it('(c) anual atravessando 29/fev bissexto = 366 dias', () => {
    // 2027-06-01 → 2028-06-01 inclui 29/fev/2028 → 366 dias.
    expect(computeProrationBasisDays('YEARLY', '2028-06-01', '2027-06-01')).toBe(366)
  })
  it('(f) só nextDueDate → deriva o início por −1 ciclo CALENDÁRIO', () => {
    // nextDueDate 03/mar sem paymentDueDate → início 03/fev → base 28 (não +30).
    expect(computeProrationBasisDays('MONTHLY', '2026-03-03')).toBe(28)
    expect(computeProrationBasisDays('MONTHLY', '2026-08-03')).toBe(31)
  })
  it('(f) nextDueDate stale (≤ início): deriva o fim por +1 ciclo CALENDÁRIO', () => {
    // Asaas ainda não avançou: nextDueDate == paymentDueDate → fim = início + 1 mês.
    expect(computeProrationBasisDays('MONTHLY', '2026-07-03', '2026-07-03')).toBe(31)
    // nextDueDate anterior ao pagamento → também deriva +1 ciclo.
    expect(computeProrationBasisDays('MONTHLY', '2026-06-15', '2026-07-03')).toBe(31)
  })
  it('(f) fora da banda sã → null (nextDueDate corrompido não infla a base)', () => {
    expect(computeProrationBasisDays('MONTHLY', '2027-01-01', '2026-07-03')).toBeNull() // ~182 dias
    expect(computeProrationBasisDays('YEARLY', '2026-08-03', '2026-07-03')).toBeNull() // ~31 dias p/ anual
  })
  it('datas ausentes/inválidas → null', () => {
    expect(computeProrationBasisDays('MONTHLY', null, null)).toBeNull()
    expect(computeProrationBasisDays('MONTHLY', undefined)).toBeNull()
    expect(computeProrationBasisDays('MONTHLY', 'lixo', 'nada')).toBeNull()
    expect(computeProrationBasisDays('MONTHLY', '2026-13-40')).toBeNull() // data fora do calendário
  })
  it('aceita nextDueDate em ISO completo (sufixo de hora)', () => {
    expect(computeProrationBasisDays('MONTHLY', '2026-08-03T00:00:00.000Z', '2026-07-03')).toBe(31)
  })
})
