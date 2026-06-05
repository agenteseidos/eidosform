/**
 * lib/asaas.ts — Integração com Asaas (assinaturas recorrentes)
 * Sprint Dia 4-5 — EidosForm
 */

function getAsaasBaseUrl() {
  return process.env.ASAAS_ENVIRONMENT === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3'
}

function getAsaasCheckoutOrigin() {
  return process.env.ASAAS_ENVIRONMENT === 'production'
    ? 'https://asaas.com'
    : 'https://sandbox.asaas.com'
}

const CHECKOUT_MINUTES_TO_EXPIRE = Number(process.env.ASAAS_CHECKOUT_MINUTES_TO_EXPIRE ?? 120)

// Planos e preços — yearly = preço anual real (sem desconto)
// Fonte de verdade: lib/plan-limits.ts
export const PLAN_PRICES = {
  starter: { monthly: 49.0, yearly: 348.0 },         // R$348/ano
  plus: { monthly: 127.0, yearly: 1164.0 },          // R$1.164/ano
  professional: { monthly: 257.0, yearly: 2364.0 },   // R$2.364/ano
} as const

import { PlanId } from '@/lib/plans'
import { log, logWarn } from '@/lib/logger'

/** @deprecated Use PlanId from lib/plans.ts */
export type PlanName = PlanId
export type BillingCycle = 'MONTHLY' | 'YEARLY'

export interface AsaasCustomerPayload {
  name: string
  email: string
  cpfCnpj?: string
  phone?: string
  mobilePhone?: string
  address?: string
  addressNumber?: string
  postalCode?: string
  province?: string
  city?: string
  state?: string
}

async function asaasFetch(path: string, options: RequestInit = {}) {
  const apiKey = (process.env.ASAAS_API_KEY ?? '').trim()
  if (!apiKey) {
    throw new Error('ASAAS_API_KEY não configurada')
  }
  const res = await fetch(`${getAsaasBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      access_token: apiKey,
      ...(options.headers ?? {}),
    },
  })
  const data = await res.json()
  if (!res.ok) {
    logWarn(`Asaas API error ${res.status}`, { errors: JSON.stringify(data.errors ?? data) })
    throw new Error(`Asaas API error ${res.status}`)
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

/** Cria checkout hospedado — retorna URL para redirecionamento */
export async function createCheckout(params: {
  plan: Exclude<PlanName, 'free'>
  cycle: BillingCycle
  successUrl: string
  cancelUrl: string
  expiredUrl: string
  customerId: string
  customValue?: number
}): Promise<{ id: string; url: string }> {
  const { plan, cycle, successUrl, cancelUrl, expiredUrl, customerId, customValue } = params
  const basePrice = cycle === 'MONTHLY' ? PLAN_PRICES[plan].monthly : PLAN_PRICES[plan].yearly
  const price = customValue !== undefined ? customValue : basePrice
  // nextDueDate = hoje força o Asaas a processar a primeira cobrança imediatamente
  // (FAQ oficial Asaas). Captura ainda não é síncrona <1s — webhook chega em segundos
  // a poucos minutos. Polling em /api/checkout/status cobre o gap.
  const nextDueDate = new Date()

  log('[asaas] createCheckout payload', { plan, cycle, value: price, customerId })

  const itemName = `Plano ${plan}`.slice(0, 30)
  const itemDescription = `EidosForm — Plano ${plan} (${cycle === 'MONTHLY' ? 'Mensal' : 'Anual'})`
  const payload = {
    customer: customerId,
    billingTypes: ['CREDIT_CARD'],
    chargeTypes: ['RECURRENT'],
    subscription: {
      value: price,
      nextDueDate: nextDueDate.toISOString().split('T')[0],
      cycle,
      description: itemDescription,
    },
    items: [{
      name: itemName,
      description: itemDescription,
      quantity: 1,
      value: price,
    }],
    callback: {
      successUrl,
      cancelUrl,
      expiredUrl,
    },
    minutesToExpire: CHECKOUT_MINUTES_TO_EXPIRE,
  }

  const data = await asaasFetch('/checkouts', { method: 'POST', body: JSON.stringify(payload) })
  const checkoutUrl = `${getAsaasCheckoutOrigin()}/checkoutSession/show?id=${data.id}`
  return { id: data.id, url: checkoutUrl }
}

/** Lista assinaturas de um customer */
export async function getCustomerSubscriptions(customerId: string) {
  const data = await asaasFetch(`/subscriptions?customer=${customerId}&limit=10`)
  return data.data ?? []
}

/** Cancela assinatura */
export async function cancelSubscription(subscriptionId: string): Promise<{ deleted: boolean; id: string }> {
  return asaasFetch(`/subscriptions/${subscriptionId}`, { method: 'DELETE' })
}

// Cache em memória do getSubscription pra mitigar consumo da cota do Asaas em
// rajadas (polling de /api/checkout/status + retries de webhook que caem no mesmo
// subscriptionId em poucos segundos). TTL curto (30s) garante que confirmações
// pós-webhook ainda chegam rápido. Cache é POR INSTÂNCIA serverless da Vercel —
// não é cache global, mas elimina o pior caso de N chamadas em sequência.
const SUBSCRIPTION_CACHE_TTL_MS = 30_000
const subscriptionCache = new Map<string, { data: unknown; expiresAt: number }>()

/** Busca assinatura (com cache de 30s em memória) */
export async function getSubscription(subscriptionId: string) {
  const now = Date.now()
  const cached = subscriptionCache.get(subscriptionId)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }
  const data = await asaasFetch(`/subscriptions/${subscriptionId}`)
  subscriptionCache.set(subscriptionId, { data, expiresAt: now + SUBSCRIPTION_CACHE_TTL_MS })
  // Limpeza oportunística pra evitar leak: remove entradas expiradas quando o cache cresce
  if (subscriptionCache.size > 100) {
    for (const [key, entry] of subscriptionCache) {
      if (entry.expiresAt <= now) subscriptionCache.delete(key)
    }
  }
  return data
}

/**
 * Edita uma assinatura existente (PUT /v3/subscriptions/{id}). Usado no "Caminho D"
 * de troca de plano quando o crédito de proration cobre todo o novo plano: muda
 * value/cycle/nextDueDate SEM cancelar a assinatura — mantém a recorrência e o cartão
 * salvo (não pede cartão de novo). Requer tokenização ATIVA na conta Asaas.
 * Invalida o cache de getSubscription para a próxima leitura ver o estado novo.
 */
export async function updateSubscription(
  subscriptionId: string,
  payload: {
    value?: number
    cycle?: BillingCycle
    nextDueDate?: string // formato YYYY-MM-DD
    description?: string
    externalReference?: string
    updatePendingPayments?: boolean
  }
): Promise<{ id: string; value: number; cycle: string; nextDueDate: string; status: string }> {
  const data = await asaasFetch(`/subscriptions/${subscriptionId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  subscriptionCache.delete(subscriptionId)
  return data
}
