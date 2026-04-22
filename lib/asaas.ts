/**
 * lib/asaas.ts — Integração com Asaas (assinaturas recorrentes)
 * Sprint Dia 4-5 — EidosForm
 */

const ASAAS_BASE_URL =
  process.env.ASAAS_ENVIRONMENT === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3'

const ASAAS_API_KEY = process.env.ASAAS_API_KEY ?? ''

// Planos e preços — yearly = preço anual real (sem desconto)
// Fonte de verdade: lib/plan-limits.ts
export const PLAN_PRICES = {
  starter: { monthly: 49.0, yearly: 348.0 },         // R$348/ano
  plus: { monthly: 127.0, yearly: 1164.0 },          // R$1.164/ano
  professional: { monthly: 257.0, yearly: 2364.0 },   // R$2.364/ano
} as const

import { PlanId } from '@/lib/plans'
import { log } from '@/lib/logger'

/** @deprecated Use PlanId from lib/plans.ts */
export type PlanName = PlanId
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

/** Atualiza dados de um customer existente */
export async function updateCustomer(customerId: string, payload: Partial<AsaasCustomerPayload>): Promise<{ id: string }> {
  return asaasFetch(`/customers/${customerId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
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

/** Cria checkout hospedado — retorna URL para redirecionamento */
export async function createCheckout(params: {
  plan: Exclude<PlanName, 'free'>
  cycle: BillingCycle
  successUrl: string
}): Promise<{ id: string; url: string }> {
  const { plan, cycle, successUrl } = params
  const price = cycle === 'MONTHLY' ? PLAN_PRICES[plan].monthly : PLAN_PRICES[plan].yearly
  const nextDueDate = new Date()
  nextDueDate.setDate(nextDueDate.getDate() + 1)

  log('[asaas] createCheckout payload', { plan, cycle, value: price, customerMode: 'checkout-entry' })

  const planLabel = `EidosForm — Plano ${plan} (${cycle === 'MONTHLY' ? 'Mensal' : 'Anual'})`
  const payload = {
    billingTypes: ['PIX', 'BOLETO', 'CREDIT_CARD'],
    chargeTypes: ['RECURRENT'],
    subscription: {
      value: price,
      nextDueDate: nextDueDate.toISOString().split('T')[0],
      cycle,
      description: planLabel,
    },
    items: [{
      name: planLabel,
      description: planLabel,
      quantity: 1,
      value: price,
    }],
    callback: {
      successUrl,
      cancelUrl: successUrl,
      expiredUrl: successUrl,
    },
    minutesToExpire: 120,
  }

  const data = await asaasFetch('/checkouts', { method: 'POST', body: JSON.stringify(payload) })
  const checkoutUrl = process.env.ASAAS_ENVIRONMENT === 'production'
    ? `https://asaas.com/checkoutSession/show?id=${data.id}`
    : `https://sandbox.asaas.com/checkoutSession/show?id=${data.id}`
  return { id: data.id, url: checkoutUrl }
}

/** Cancela assinatura */
export async function cancelSubscription(subscriptionId: string): Promise<{ deleted: boolean; id: string }> {
  return asaasFetch(`/subscriptions/${subscriptionId}`, { method: 'DELETE' })
}

/** Busca assinatura */
export async function getSubscription(subscriptionId: string) {
  return asaasFetch(`/subscriptions/${subscriptionId}`)
}
