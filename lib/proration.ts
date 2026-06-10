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
  const { currentPlan, currentCycle, planExpiresAt } = params

  const price = getPlanPrice(currentPlan, currentCycle)
  if (price === 0) return 0

  const totalDays = getDaysInCycle(currentCycle)
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
  // no máximo ~1 dia a mais de cobertura POR CONVERSÃO de plano, nunca a menos. (Audit
  // Codex 2026-06-07.) O epsilon evita que ruído de float (36.000000000000007) vire
  // +1 dia espúrio quando a conta fecha exata — pré-requisito da ida-e-volta estável
  // do modelo sem teto.
  return Math.ceil((credit * daysInCycle) / newPlanPrice - 1e-9)
}
