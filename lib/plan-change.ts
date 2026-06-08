/**
 * lib/plan-change.ts — Lógica PURA de decisão de troca de plano (sem efeito colateral).
 * Usada tanto pelo PREVIEW (GET /api/checkout/[plan]/preview) quanto pela EXECUÇÃO
 * (POST /api/checkout/[plan]), para os dois NUNCA divergirem (o que o usuário confirma
 * é o que é executado). Recebe só dados do profile + plano/ciclo desejados.
 */
import { calculateUpgradePrice, calculateCreditCoverageDays, isUpgrade, type BillingCycle } from '@/lib/proration'
import { PLAN_PRICES } from '@/lib/asaas'
import { type PlanId } from '@/lib/plans'

export type PlanChangeAction = 'already_subscribed' | 'downgrade_scheduled' | 'credit_covered' | 'checkout'

export interface PlanChangeInput {
  currentPlan: string
  currentCycle: string | null
  planExpiresAt: string | null
  hasActiveSubscription: boolean
  /**
   * true quando o usuário CANCELOU mas ainda tem período pago restante (plano≠free, expiração
   * futura, SEM assinatura ativa no Asaas). Nesse caso o saldo do período restante vira crédito
   * pra reassinar QUALQUER plano — sempre via checkout (cria sub nova). (#2, Sidney 2026-06-08.)
   */
  hasPaidPeriodRemaining?: boolean
  newPlan: PlanId
  newCycle: BillingCycle
}

export interface PlanChangeResult {
  action: PlanChangeAction
  currentPlan: string
  currentCycle: string | null
  newPlan: string
  newCycle: BillingCycle
  isPlanUpgrade: boolean
  isCycleChange: boolean
  shouldApplyProration: boolean
  proration: { credit: number; originalPrice: number; finalPrice: number } | null
  /** Valor cobrado AGORA (0 quando coberto por crédito). */
  amountDueNow: number
  coveredByCredit: boolean
  creditCoverageDays: number | null
  /** YYYY-MM-DD — quando coveredByCredit, a data da próxima cobrança (forecast). */
  nextChargeDate: string | null
}

function fullPrice(plan: PlanId, cycle: BillingCycle): number {
  const p = PLAN_PRICES[plan as keyof typeof PLAN_PRICES]
  if (!p) return 0
  return cycle === 'YEARLY' ? p.yearly : p.monthly
}

export function computePlanChange(input: PlanChangeInput): PlanChangeResult {
  const { currentPlan, currentCycle, planExpiresAt, hasActiveSubscription, hasPaidPeriodRemaining = false, newPlan, newCycle } = input

  const isCycleChange = currentPlan === newPlan && currentCycle !== newCycle
  // Downgrade de CICLO (anual→mensal do mesmo plano) é tratado como DOWNGRADE honesto, não
  // como proration/Caminho D — antes ele editava a assinatura silenciosamente p/ mensal,
  // divergindo da promessa do produto. Mensal→anual segue como upgrade de ciclo (proration).
  // (#5, decisão Sidney 2026-06-08.)
  const isCycleDowngrade = isCycleChange && currentCycle === 'YEARLY' && newCycle === 'MONTHLY'
  const isPlanUpgrade = currentPlan !== newPlan && isUpgrade(currentPlan as PlanId, newPlan)
  const shouldApplyProration = (isCycleChange && !isCycleDowngrade) || isPlanUpgrade

  const base = {
    currentPlan,
    currentCycle,
    newPlan,
    newCycle,
    isPlanUpgrade,
    isCycleChange,
    shouldApplyProration,
    proration: null as PlanChangeResult['proration'],
    amountDueNow: 0,
    coveredByCredit: false,
    creditCoverageDays: null as number | null,
    nextChargeDate: null as string | null,
  }

  // Já assinante exatamente do mesmo plano+ciclo
  if (hasActiveSubscription && currentPlan === newPlan && currentCycle === newCycle) {
    return { ...base, action: 'already_subscribed' }
  }

  // Downgrade → mensagem honesta (cancelar e reassinar): tier menor OU ciclo anual→mensal.
  if (hasActiveSubscription && ((currentPlan !== newPlan && !isPlanUpgrade) || isCycleDowngrade)) {
    return { ...base, action: 'downgrade_scheduled' }
  }

  // CANCELING — cancelou mas ainda tem período pago restante (sem sub ativa, mas COM saldo).
  // O crédito do período restante aplica a QUALQUER plano novo; SEMPRE via checkout (cria sub
  // nova — não há sub p/ editar, então não há Caminho D aqui). (#2, decisão Sidney 2026-06-08.)
  if (!hasActiveSubscription && hasPaidPeriodRemaining && planExpiresAt) {
    const r = calculateUpgradePrice({
      currentPlan: currentPlan as PlanId,
      currentCycle: (currentCycle ?? 'MONTHLY') as BillingCycle,
      planExpiresAt,
      newPlan,
      newCycle,
    })
    const prorationC = { credit: r.credit, originalPrice: r.originalPrice, finalPrice: r.finalPrice }
    if (prorationC.finalPrice <= 0) {
      // Saldo cobre TODO o novo plano. Criar a sub sem cobrar exige token/reactivate (a sub foi
      // deletada no cancelamento) — a EXECUÇÃO trata esse caso à parte. Aqui só sinaliza coberto.
      const coverageDays = Math.max(1, calculateCreditCoverageDays(prorationC.credit, prorationC.originalPrice, newCycle))
      const nextDue = new Date()
      nextDue.setDate(nextDue.getDate() + coverageDays)
      return {
        ...base,
        action: 'credit_covered',
        shouldApplyProration: true,
        proration: prorationC,
        amountDueNow: 0,
        coveredByCredit: true,
        creditCoverageDays: coverageDays,
        nextChargeDate: nextDue.toISOString().split('T')[0],
      }
    }
    return { ...base, action: 'checkout', shouldApplyProration: true, proration: prorationC, amountDueNow: prorationC.finalPrice }
  }

  // Proration (upgrade de tier OU troca de ciclo do mesmo plano)
  let proration: PlanChangeResult['proration'] = null
  if (hasActiveSubscription && shouldApplyProration && planExpiresAt) {
    const r = calculateUpgradePrice({
      currentPlan: currentPlan as PlanId,
      currentCycle: (currentCycle ?? 'MONTHLY') as BillingCycle,
      planExpiresAt,
      newPlan,
      newCycle,
    })
    proration = { credit: r.credit, originalPrice: r.originalPrice, finalPrice: r.finalPrice }
  }

  // Crédito cobre todo o novo plano → Caminho D (edita a assinatura, sem cobrança agora)
  if (proration && proration.finalPrice <= 0) {
    const coverageDays = Math.max(1, calculateCreditCoverageDays(proration.credit, proration.originalPrice, newCycle))
    const nextDue = new Date()
    nextDue.setDate(nextDue.getDate() + coverageDays)
    return {
      ...base,
      action: 'credit_covered',
      proration,
      amountDueNow: 0,
      coveredByCredit: true,
      creditCoverageDays: coverageDays,
      nextChargeDate: nextDue.toISOString().split('T')[0],
    }
  }

  // Checkout normal: paga a diferença (proration) OU o preço cheio (primeira compra)
  const amountDueNow = proration ? proration.finalPrice : fullPrice(newPlan, newCycle)
  return { ...base, action: 'checkout', proration, amountDueNow }
}
