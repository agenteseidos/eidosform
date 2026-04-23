/**
 * lib/proration.ts — Cálculo de prorateamento para upgrade de planos
 */

import { PLAN_PRICES } from '@/lib/asaas'
import { PLAN_ORDER, type PlanId } from '@/lib/plans'

export type BillingCycle = 'MONTHLY' | 'YEARLY'

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
