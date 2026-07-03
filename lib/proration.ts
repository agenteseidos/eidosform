/**
 * lib/proration.ts — Cálculo de prorateamento para upgrade de planos
 */

import { PLAN_PRICES } from '@/lib/asaas'
import { PLAN_ORDER, type PlanId } from '@/lib/plans'
import { logWarn } from '@/lib/logger'

export type BillingCycle = 'MONTHLY' | 'YEARLY'

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

function getPlanPrice(plan: PlanId, cycle: BillingCycle): number {
  const prices = PLAN_PRICES[plan as keyof typeof PLAN_PRICES]
  if (!prices) return 0
  return cycle === 'YEARLY' ? prices.yearly : prices.monthly
}

function getPlanIndex(plan: PlanId): number {
  return PLAN_ORDER.indexOf(plan)
}

// Convenção de fuso do billing: UTC-3 fixo (mesma de expiryFromNextDueDate em
// billing-activation.ts — a expiração é gravada como fim-de-dia 23:59:59-03:00).
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000

/** Meia-noite UTC do dia-calendário BRT em que `d` cai (p/ aritmética de dias inteiros). */
function brtDateOnly(d: Date): number {
  const shifted = new Date(d.getTime() - BRT_OFFSET_MS)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
}

/**
 * Dias PAGOS restantes, em dias de calendário INTEIROS (BRT), de hoje até plan_expires_at.
 * É a régua única do modelo "dias pagos são o ativo" (decisão Sidney 2026-06-10): contar
 * dias inteiros de data-a-data elimina a fração do fim-de-dia (23:59:59) que, no modelo
 * antigo (diferença em ms ÷ 24h), inflava o crédito a cada conversão e motivou o teto.
 * Expirado/inválido → 0.
 */
export function remainingPaidDays(planExpiresAt: string): number {
  const exp = new Date(planExpiresAt)
  if (Number.isNaN(exp.getTime()) || exp.getTime() <= Date.now()) return 0
  return Math.max(0, Math.round((brtDateOnly(exp) - brtDateOnly(new Date())) / 86400000))
}

/** YYYY-MM-DD = hoje (dia-calendário BRT) + N dias. Par do remainingPaidDays: hoje +
 * remainingPaidDays(exp) devolve exatamente o dia de `exp` — ida-e-volta sem deriva. */
export function addDaysToTodayBRT(days: number): string {
  return new Date(brtDateOnly(new Date()) + days * 86400000).toISOString().split('T')[0]
}

export interface ProrationCreditParams {
  currentPlan: PlanId
  currentCycle: BillingCycle
  planExpiresAt: string // ISO date string
  /** Denominador de valoração (proration_basis_days do profile). null/undefined → fallback
   *  30/365 nominal (com log). Ver resolveBasisDays. */
  basisDays?: number | null
}

export interface UpgradePriceParams {
  currentPlan: PlanId
  currentCycle: BillingCycle
  planExpiresAt: string
  newPlan: PlanId
  newCycle: BillingCycle
  /** Base de valoração do plano ATUAL (repassada a calculateProrationCredit). */
  basisDays?: number | null
}

export interface ProrationResult {
  credit: number
  newPrice: number
  originalPrice: number
  finalPrice: number
}

/**
 * Calcula o crédito proporcional dos dias restantes do plano atual.
 * Fórmula: crédito = diária do plano × dias INTEIROS restantes (remainingPaidDays).
 *
 * SEM teto de dinheiro (decisão Sidney 2026-06-10, substitui o teto de 2026-06-09): dias
 * restantes > 1 ciclo são LEGÍTIMOS — o próprio "saldo vira tempo" os cria (ex.: downgrade
 * Plus→Starter empurra a cobrança 2+ meses). O teto min(crédito, preço) clipava esse saldo
 * pago (perda real p/ o cliente, vista no teste de produção de 2026-06-10: 78 dias → 30).
 * O empilhamento que o teto combatia vinha da FRAÇÃO do fim-de-dia na contagem em ms; a
 * contagem em dias inteiros (remainingPaidDays) mata a deriva na raiz — e a reativação de
 * mesmo plano+ciclo nem converte (identidade exata em plan-change.ts).
 */
export function calculateProrationCredit(params: ProrationCreditParams): number {
  const { currentPlan, currentCycle, planExpiresAt, basisDays } = params

  const price = getPlanPrice(currentPlan, currentCycle)
  if (price === 0) return 0

  // Denominador = base explícita (período REAL do Asaas / nominal dos switches) quando
  // presente; senão fallback 30/365 nominal (com log). Antes: getDaysInCycle FIXO.
  const totalDays = resolveBasisDays(basisDays, currentCycle)
  const remainingDays = remainingPaidDays(planExpiresAt)
  if (remainingDays <= 0) return 0

  const credit = (price / totalDays) * remainingDays

  // Arredondamento monetário via centavos: ×100 → round (inteiro seguro) →
  // ÷100. Uma única operação por cálculo (não acumula erro de float entre
  // chamadas) e o resultado vai ao Asaas já com 2 casas exatas.
  return Math.round(credit * 100) / 100
}

/**
 * Verifica se a mudança é um upgrade (plano de maior valor).
 */
export function isUpgrade(currentPlan: PlanId, newPlan: PlanId): boolean {
  return getPlanIndex(newPlan) > getPlanIndex(currentPlan)
}

/**
 * Calcula o preço de upgrade com prorateamento.
 * Retorna crédito, preço original do novo plano, e preço final.
 */
export function calculateUpgradePrice(params: UpgradePriceParams): ProrationResult {
  const { currentPlan, currentCycle, planExpiresAt, newPlan, newCycle, basisDays } = params

  const credit = calculateProrationCredit({
    currentPlan,
    currentCycle,
    planExpiresAt,
    basisDays,
  })

  const originalPrice = getPlanPrice(newPlan, newCycle)
  const finalPrice = Math.max(0, Math.round((originalPrice - credit) * 100) / 100)

  return {
    credit,
    newPrice: originalPrice,
    originalPrice,
    finalPrice,
  }
}

/**
 * "Saldo em tempo": quando o crédito cobre todo o novo plano (finalPrice <= 0),
 * calcula por quantos DIAS o crédito cobre o novo plano. Usado para empurrar o
 * `nextDueDate` da assinatura — a próxima cobrança só ocorre depois que o crédito
 * "vale". Ex.: crédito R$1.164 em Professional mensal R$257 → ~136 dias.
 */
export function calculateCreditCoverageDays(credit: number, newPlanPrice: number, newCycle: BillingCycle): number {
  if (newPlanPrice <= 0 || credit <= 0) return 0
  const daysInCycle = getDaysInCycle(newCycle)
  // ceil (não round): "saldo em tempo" do cliente. Arredondar pra baixo encurtaria o
  // crédito por fração de dia (cobra o cliente cedo demais); ceil favorece o cliente —
  // no máximo ~1 dia a mais de cobertura POR CONVERSÃO de plano, nunca a menos. (Audit
  // Codex 2026-06-07.) O epsilon evita que ruído de float (36.000000000000007) vire
  // +1 dia espúrio quando a conta fecha exata — pré-requisito da ida-e-volta estável
  // do modelo sem teto.
  return Math.ceil((credit * daysInCycle) / newPlanPrice - 1e-9)
}

/** Parse 'YYYY-MM-DD' (ou ISO com sufixo) → meia-noite UTC (ms). null se inválido. */
function parseYmd(s: string | null | undefined): number | null {
  if (!s || typeof s !== 'string') return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const t = Date.UTC(y, mo - 1, d)
  const dt = new Date(t)
  // Rejeita datas fora do calendário (ex.: mês 13, dia 32 que o Date "corrige").
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return t
}

/** ms UTC + N ciclos CALENDÁRIO (mês/ano; NUNCA +30/365). Clampa o dia ao fim do mês-alvo
 *  (espelha o clamp do Asaas: 31/jan +1mês → 28/fev). */
function calendarShift(ms: number, cycle: BillingCycle, sign: 1 | -1): number {
  const dt = new Date(ms)
  const y = dt.getUTCFullYear(), m = dt.getUTCMonth(), d = dt.getUTCDate()
  if (cycle === 'YEARLY') {
    // 29/fev + N anos → clampa p/ 28/fev em ano não-bissexto.
    const targetY = y + sign
    const lastDay = new Date(Date.UTC(targetY, m + 1, 0)).getUTCDate()
    return Date.UTC(targetY, m, Math.min(d, lastDay))
  }
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
