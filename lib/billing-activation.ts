/**
 * lib/billing-activation.ts
 * Helpers compartilhados de ativação/expiração de plano usados pelo polling
 * (app/api/checkout/status) e pelo reprocessador de webhooks (lib/asaas-reprocess).
 * Mantém o payload de update em um lugar só para não divergir.
 */
import { PLANS } from '@/lib/plan-limits'

export type BillingCycle = 'MONTHLY' | 'YEARLY'

/** Expiração estimada (now + ciclo). Fallback enquanto não usamos o nextDueDate real do Asaas. */
export function calculateExpiryDate(cycle: BillingCycle): string {
  const now = new Date()
  if (cycle === 'YEARLY') now.setFullYear(now.getFullYear() + 1)
  else now.setDate(now.getDate() + 30)
  return now.toISOString()
}

/** Payload de update do profile para ATIVAR um plano pago. */
export function buildActivePlanUpdate(params: {
  plan: string
  cycle: BillingCycle
  customerId?: string | null
  subscriptionId?: string | null
}) {
  const { plan, cycle, customerId, subscriptionId } = params
  const planConfig = PLANS[plan as keyof typeof PLANS]
  return {
    plan,
    plan_cycle: cycle,
    plan_status: 'active',
    plan_expires_at: calculateExpiryDate(cycle),
    limit_alert_sent: false,
    responses_limit: planConfig?.maxResponses ?? 100,
    responses_used: 0,
    ...(customerId ? { asaas_customer_id: customerId } : {}),
    ...(subscriptionId !== undefined ? { asaas_subscription_id: subscriptionId } : {}),
  }
}

/** Payload de update do profile para REVERTER para o plano free. */
export function buildFreePlanUpdate(newStatus: 'overdue' | 'cancelled' | 'chargeback' | 'refunded') {
  return {
    plan: 'free',
    plan_status: newStatus,
    plan_expires_at: null,
    asaas_subscription_id: null,
    limit_alert_sent: false,
    responses_limit: PLANS.free.maxResponses,
    responses_used: 0,
  }
}
