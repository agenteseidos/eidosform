/**
 * lib/plan-change.ts — Lógica PURA de decisão de troca de plano (sem efeito colateral).
 * Usada tanto pelo PREVIEW (GET /api/checkout/[plan]/preview) quanto pela EXECUÇÃO
 * (POST /api/checkout/[plan]), para os dois NUNCA divergirem (o que o usuário confirma
 * é o que é executado). Recebe só dados do profile + plano/ciclo desejados.
 */
import { calculateUpgradePrice, calculateCreditCoverageDays, remainingPaidDays, addDaysToTodayBRT, isUpgrade, type BillingCycle } from '@/lib/proration'
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
  /** Base de valoração (proration_basis_days) do plano ATUAL do profile — denominador dos
   *  dias restantes. undefined/null → fallback 30/365 nominal (legado, com log). */
  prorationBasisDays?: number | null
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
  isPlanDowngrade: boolean
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
  const { currentPlan, currentCycle, planExpiresAt, hasActiveSubscription, hasPaidPeriodRemaining = false, prorationBasisDays, newPlan, newCycle } = input

  const isCycleChange = currentPlan === newPlan && currentCycle !== newCycle
  // Downgrade de CICLO (anual→mensal do mesmo plano) é tratado como DOWNGRADE honesto, não
  // como proration/Caminho D — antes ele editava a assinatura silenciosamente p/ mensal,
  // divergindo da promessa do produto. Mensal→anual segue como upgrade de ciclo (proration).
  // (#5, decisão Sidney 2026-06-08.)
  const isCycleDowngrade = isCycleChange && currentCycle === 'YEARLY' && newCycle === 'MONTHLY'
  const isPlanUpgrade = currentPlan !== newPlan && isUpgrade(currentPlan as PlanId, newPlan)
  // Downgrade de TIER (ex.: Plus→Starter) agora é LIBERADO (decisão Sidney 2026-06-08): aplica
  // proration (o saldo do plano atual vira tempo do plano menor) e flui pelo Caminho D, como um
  // upgrade. O usuário perde os recursos do plano superior NA HORA (pixels, webhooks, marca
  // d'água, forms acima do limite pausam) — por isso a UI exige dupla-confirmação + aviso.
  const isTierDowngrade = currentPlan !== newPlan && !isPlanUpgrade
  const shouldApplyProration = (isCycleChange && !isCycleDowngrade) || isPlanUpgrade || isTierDowngrade

  const base = {
    currentPlan,
    currentCycle,
    newPlan,
    newCycle,
    isPlanUpgrade,
    isPlanDowngrade: isTierDowngrade,
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

  // Downgrade de CICLO (anual→mensal do MESMO plano) segue como mensagem honesta — mid-annual→
  // mensal não faz sentido financeiro (já pagou o ano); agendamento fica no backlog. O downgrade
  // de TIER NÃO é mais interceptado aqui: flui pela proration/Caminho D abaixo (liberado).
  if (hasActiveSubscription && isCycleDowngrade) {
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
      basisDays: prorationBasisDays, // base do plano ATUAL
    })
    const prorationC = { credit: r.credit, originalPrice: r.originalPrice, finalPrice: r.finalPrice }
    if (prorationC.finalPrice <= 0) {
      // Saldo cobre TODO o novo plano. Criar a sub sem cobrar exige token/reactivate (a sub foi
      // deletada no cancelamento) — a EXECUÇÃO trata esse caso à parte. Aqui só sinaliza coberto.
      // REATIVAÇÃO do MESMO plano+ciclo: identidade exata — os dias pagos restantes são a
      // cobertura, sem converter tempo→crédito→tempo (cancelar+reativar N vezes não move a
      // data um dia sequer). Modelo "dias pagos são o ativo" (Sidney 2026-06-10).
      const samePlanCycle = currentPlan === newPlan && (currentCycle ?? 'MONTHLY') === newCycle
      const coverageDays = samePlanCycle
        ? Math.max(1, remainingPaidDays(planExpiresAt))
        : Math.max(1, calculateCreditCoverageDays(prorationC.credit, prorationC.originalPrice, newCycle))
      return {
        ...base,
        action: 'credit_covered',
        shouldApplyProration: true,
        proration: prorationC,
        amountDueNow: 0,
        coveredByCredit: true,
        creditCoverageDays: coverageDays,
        nextChargeDate: addDaysToTodayBRT(coverageDays),
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
      basisDays: prorationBasisDays, // base do plano ATUAL
    })
    proration = { credit: r.credit, originalPrice: r.originalPrice, finalPrice: r.finalPrice }
  }

  // Crédito cobre todo o novo plano → sub recriada via token, sem cobrança agora.
  // (Mesmo plano+ciclo com sub ativa já retornou 'already_subscribed' acima, então aqui é
  // sempre conversão entre planos/ciclos diferentes — coverage via crédito.)
  if (proration && proration.finalPrice <= 0) {
    const coverageDays = Math.max(1, calculateCreditCoverageDays(proration.credit, proration.originalPrice, newCycle))
    return {
      ...base,
      action: 'credit_covered',
      proration,
      amountDueNow: 0,
      coveredByCredit: true,
      creditCoverageDays: coverageDays,
      nextChargeDate: addDaysToTodayBRT(coverageDays),
    }
  }

  // Checkout normal: paga a diferença (proration) OU o preço cheio (primeira compra)
  const amountDueNow = proration ? proration.finalPrice : fullPrice(newPlan, newCycle)
  return { ...base, action: 'checkout', proration, amountDueNow }
}

export interface PlanChangeRecoveryRow {
  plan?: string | null
  cycle?: string | null
  status?: string | null
  asaas_payment_id?: string | null
  planchange_attempt_id?: string | null
}

/**
 * P0-A (2026-06-15): decide se o POST atual CONTINUA uma tentativa de troca EM ANDAMENTO ou inicia
 * uma tentativa NOVA. A linha de recuperação (`planchange-pay-{profile}`) é reusada entre trocas do
 * mesmo perfil, então identificar por ALVO (plan+cycle) não basta — duas trocas pro mesmo plano em
 * momentos diferentes colidem. A identidade correta é a TENTATIVA (attemptId), que entra no
 * externalReference do avulso.
 *
 * - Continuação (mesmo plan+cycle E status ainda não-terminal: recovering/pending E com attemptId):
 *   reaproveita o attemptId + asaas_payment_id → um retry acha o MESMO avulso e NÃO cobra de novo.
 * - Tentativa nova (sem linha, ou alvo diferente, ou status terminal 'paid'/'cancelled'): attemptId
 *   FRESCO e payment id zerado → uma troca anterior já concluída (com outro attemptId) nunca é
 *   confundida com esta (fecha o vazamento de receita do reuso de avulso antigo).
 */
export function decidePlanChangeAttempt(
  prev: PlanChangeRecoveryRow | null,
  plan: string,
  cycle: string,
  freshAttemptId: string,
): { attemptId: string; savedPaymentId: string | null } {
  const inFlight =
    !!prev &&
    prev.plan === plan &&
    prev.cycle === cycle &&
    (prev.status === 'recovering' || prev.status === 'pending') &&
    !!prev.planchange_attempt_id
  if (inFlight) {
    return { attemptId: prev.planchange_attempt_id as string, savedPaymentId: prev.asaas_payment_id ?? null }
  }
  return { attemptId: freshAttemptId, savedPaymentId: null }
}
