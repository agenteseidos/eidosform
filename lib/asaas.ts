/**
 * lib/asaas.ts — Integração com Asaas (assinaturas recorrentes)
 * Sprint Dia 4-5 — EidosForm
 */

const ASAAS_BASE_URL =
  process.env.ASAAS_ENVIRONMENT === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3'

const ASAAS_API_KEY = process.env.ASAAS_API_KEY ?? ''

// Planos e preços
export const PLAN_PRICES = {
  starter: { monthly: 49.0, yearly: 470.4 },  // 20% off no anual
  plus: { monthly: 127.0, yearly: 1219.2 },
  professional: { monthly: 257.0, yearly: 2467.2 },
} as const

export type PlanName = 'free' | 'starter' | 'plus' | 'professional'
export type BillingCycle = 'MONTHLY' | 'YEARLY'

interface AsaasCustomerPayload {
  name: string
  email: string
  cpfCnpj?: string
  phone?: string
}

interface AsaasSubscriptionPayload {
  customer: string
  billingType: 'BOLETO' | 'CREDIT_CARD' | 'PIX'
  value: number
  nextDueDate: string
  cycle: BillingCycle
  description: string
}

async function asaasFetch(path: string, options: RequestInit = {}) {
  if (!ASAAS_API_KEY) {
    throw new Error('ASAAS_API_KEY não configurada')
  }
  const res = await fetch(`${ASAAS_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      access_token: ASAAS_API_KEY,
      ...(options.headers ?? {}),
    },
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Asaas API error ${res.status}: ${JSON.stringify(data.errors ?? data)}`)
  }
  return data
}

/** Cria ou retorna customer existente pelo email */
export async function createCustomer(payload: AsaasCustomerPayload): Promise<{ id: string; name: string; email: string }> {
  const existing = await asaasFetch(`/customers?email=${encodeURIComponent(payload.email)}`)
  if (existing.totalCount > 0) return existing.data[0]
  return asaasFetch('/customers', { method: 'POST', body: JSON.stringify(payload) })
}

/** Cria assinatura recorrente */
export async function createSubscription(params: {
  customerId: string
  plan: Exclude<PlanName, 'free'>
  cycle: BillingCycle
  billingType?: 'BOLETO' | 'CREDIT_CARD' | 'PIX'
}): Promise<{ id: string; status: string; value: number }> {
  const { customerId, plan, cycle, billingType = 'PIX' } = params
  const price = cycle === 'MONTHLY' ? PLAN_PRICES[plan].monthly : PLAN_PRICES[plan].yearly
  const nextDueDate = new Date()
  nextDueDate.setDate(nextDueDate.getDate() + 1)
  const payload: AsaasSubscriptionPayload = {
    customer: customerId,
    billingType,
    value: price,
    nextDueDate: nextDueDate.toISOString().split('T')[0],
    cycle,
    description: `EidosForm — Plano ${plan} (${cycle === 'MONTHLY' ? 'Mensal' : 'Anual'})`,
  }
  return asaasFetch('/subscriptions', { method: 'POST', body: JSON.stringify(payload) })
}

/** Cancela assinatura */
export async function cancelSubscription(subscriptionId: string): Promise<{ deleted: boolean; id: string }> {
  return asaasFetch(`/subscriptions/${subscriptionId}`, { method: 'DELETE' })
}

/** Busca assinatura */
export async function getSubscription(subscriptionId: string) {
  return asaasFetch(`/subscriptions/${subscriptionId}`)
}
