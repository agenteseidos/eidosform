/**
 * lib/proration.ts — Cálculo de prorateamento para upgrade de planos
 */

import { PLAN_PRICES } from '@/lib/asaas'
import { PLAN_ORDER, type PlanId } from '@/lib/plans'

export type BillingCycle = 'MONTHLY' | 'YEARLY'

// Fixed at 30/365 to match Asaas's billing cycle (MONTHLY = 30 days, YEARLY = 365).
// Calendar variations (28-31 day months, leap years) cause cents-level rounding
// differences — accepted trade-off for predictable proration matching the provider.
const DAYS_IN_MONTH = 30
const DAYS_IN_YEAR = 365

function getDaysInCycle(cycle: BillingCycle): number {
  return cycle === 'YEARLY' ? DAYS_IN_YEAR : DAYS_IN_MONTH
}

function getPlanPrice(plan: PlanId, cycle: BillingCycle): number {
  const prices = PLAN_PRICES[plan as keyof typeof PLAN_PRICES]
  if (!prices) return 0
  return cycle === 'YEARLY' ? prices.yearly : prices.monthly
}

function getPlanIndex(plan: PlanId): number {
  return PLAN_ORDER.indexOf(plan)
}

export interface ProrationCreditParams {
  currentPlan: PlanId
  currentCycle: BillingCycle
  planExpiresAt: string // ISO date string
}

export interface UpgradePriceParams {
  currentPlan: PlanId
  currentCycle: BillingCycle
  planExpiresAt: string
  newPlan: PlanId
  newCycle: BillingCycle
}

export interface ProrationResult {
  credit: number
  newPrice: number
  originalPrice: number
  finalPrice: number
}

/**
 * Calcula o crédito proporcional dos dias restantes do plano atual.
 * Fórmula: crédito = (valor_plano / dias_totais) × dias_restantes
 */
export function calculateProrationCredit(params: ProrationCreditParams): number {
  const { currentPlan, currentCycle, planExpiresAt } = params

  const price = getPlanPrice(currentPlan, currentCycle)
  if (price === 0) return 0

  const totalDays = getDaysInCycle(currentCycle)
  const now = new Date()
  const expiresAt = new Date(planExpiresAt)

  // Se já expirou, sem crédito
  if (expiresAt <= now) return 0

  const remainingMs = expiresAt.getTime() - now.getTime()
  const remainingDays = remainingMs / (1000 * 60 * 60 * 24)

  const credit = (price / totalDays) * remainingDays

  // Arredonda para 2 casas decimais
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
  const { currentPlan, currentCycle, planExpiresAt, newPlan, newCycle } = params

  const credit = calculateProrationCredit({
    currentPlan,
    currentCycle,
    planExpiresAt,
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
  // no máximo ~1 dia a mais de cobertura, nunca a menos. (Audit Codex 2026-06-07.)
  return Math.ceil((credit * daysInCycle) / newPlanPrice)
}
