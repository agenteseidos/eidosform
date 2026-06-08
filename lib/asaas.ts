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
import { log, logWarn, logError } from '@/lib/logger'
import { sendBillingOpsAlert } from '@/lib/resend'

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

/** Mapeia o VALOR cheio de uma assinatura para o plano/ciclo (preços únicos → 1:1). */
export function detectPlanAndCycleFromValue(value: number): { plan: string; cycle: BillingCycle } | null {
  for (const [plan, prices] of Object.entries(PLAN_PRICES)) {
    if (value === prices.yearly) return { plan, cycle: 'YEARLY' }
    if (value === prices.monthly) return { plan, cycle: 'MONTHLY' }
  }
  return null
}

/**
 * Resolve plano/ciclo a partir do objeto da ASSINATURA paga (fonte da verdade): valor cheio
 * → plano (1:1); senão a `description` ("Plano X (...)") → plano-alvo (proration). Usado pelo
 * webhook e pelo reprocessador pra não depender do billing_checkouts. (Pivô 2026-06-08.)
 */
export function resolvePlanCycleFromSubscription(
  sub: { value?: number; cycle?: string; description?: string } | null | undefined
): { plan: string; cycle: BillingCycle } | null {
  if (!sub) return null
  const cycle: BillingCycle = String(sub.cycle ?? '').toUpperCase() === 'YEARLY' ? 'YEARLY' : 'MONTHLY'
  if (typeof sub.value === 'number') {
    const byValue = detectPlanAndCycleFromValue(sub.value)
    if (byValue) return byValue
  }
  const m = String(sub.description ?? '').match(/Plano\s+([a-zA-Z]+)/)
  const planFromDesc = m?.[1]?.toLowerCase()
  if (planFromDesc && Object.prototype.hasOwnProperty.call(PLAN_PRICES, planFromDesc)) {
    return { plan: planFromDesc, cycle }
  }
  return null
}

/**
 * externalReference no formato `profile:{uuid}|plan:{plan}|cycle:{cycle}`.
 * ⚠️ ATENÇÃO (smoke sandbox 2026-06-08): o Asaas NÃO persiste o externalReference quando a
 * assinatura é criada via CHECKOUT HOSPEDADO — nem na assinatura nem nos eventos PAYMENT_*
 * (ambos vêm null). Por isso o webhook NÃO depende mais disto: resolve plan/cycle pela
 * própria ASSINATURA PAGA (valor cheio→plano, ou descrição em proration). Mantido como
 * fallback legado e porque o Caminho D seta via PUT direto na sub (que pode persistir).
 */
export function buildExternalReference(profileId: string, plan?: string, cycle?: string): string {
  let ref = `profile:${profileId}`
  if (plan) ref += `|plan:${plan}`
  if (cycle) ref += `|cycle:${cycle}`
  return ref
}

/** Faz o parse de um externalReference no formato acima (campos ausentes → null). */
export function parseExternalReference(ref?: string | null): { profileId: string | null; plan: string | null; cycle: string | null } {
  const out = { profileId: null as string | null, plan: null as string | null, cycle: null as string | null }
  if (!ref) return out
  for (const part of ref.split('|')) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    const k = part.slice(0, idx)
    const v = part.slice(idx + 1)
    if (k === 'profile' && /^[0-9a-fA-F-]{36}$/.test(v)) out.profileId = v
    // plan só é aceito se for um plano CONHECIDO (evita persistir plano inválido caso o
    // campo venha truncado/editado → cairia em erro de DB). (P3 round 4, Codex 2026-06-07.)
    else if (k === 'plan' && v && Object.prototype.hasOwnProperty.call(PLAN_PRICES, v)) out.plan = v
    else if (k === 'cycle' && (v === 'MONTHLY' || v === 'YEARLY')) out.cycle = v
  }
  return out
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
  /** `profile:{id}|plan:..|cycle:..` — ⚠️ o Asaas NÃO persiste isto no checkout hospedado
   *  (smoke 2026-06-08). Enviado mesmo assim (inofensivo) por defesa/futuro; o webhook
   *  resolve plan/cycle pela assinatura paga, não por aqui. */
  externalReference?: string
}): Promise<{ id: string; url: string }> {
  const { plan, cycle, successUrl, cancelUrl, expiredUrl, customerId, customValue, externalReference } = params
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
    // externalReference no topo e na subscription. ⚠️ Na prática o Asaas IGNORA isto no
    // checkout hospedado (smoke 2026-06-08: vem null na sub e no pagamento). Enviado por
    // defesa/futuro; o webhook resolve plan/cycle pela assinatura paga (valor/descrição).
    ...(externalReference ? { externalReference } : {}),
    subscription: {
      value: price,
      nextDueDate: nextDueDate.toISOString().split('T')[0],
      cycle,
      description: itemDescription,
      ...(externalReference ? { externalReference } : {}),
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

/** Lista assinaturas ATIVAS de cartão de um customer (até 100). */
export async function getCustomerSubscriptions(customerId: string) {
  const data = await asaasFetch(`/subscriptions?customer=${encodeURIComponent(customerId)}&status=ACTIVE&billingType=CREDIT_CARD&limit=100`)
  return data.data ?? []
}

/** Cancela assinatura */
export async function cancelSubscription(subscriptionId: string): Promise<{ deleted: boolean; id: string }> {
  const res = await asaasFetch(`/subscriptions/${subscriptionId}`, { method: 'DELETE' })
  // Invalida o cache de getSubscription (30s): após o DELETE, leituras stale como ACTIVE
  // poderiam re-ativar a sub (polling) ou estender acesso indevidamente. (#3, audit 2026-06-08.)
  subscriptionCache.delete(subscriptionId)
  return res
}

/**
 * Garante NO MÁXIMO 1 assinatura ACTIVE de cartão por cliente: cancela todas as
 * assinaturas ACTIVE (CREDIT_CARD) do cliente EXCETO keepSubscriptionId.
 * Idempotente e NÃO-BLOQUEANTE (erros logados, não lançados — nunca deve travar a
 * ativação do plano). Chamar SEMPRE depois de persistir o novo plano/sub no profile.
 * Os cancelamentos disparam SUBSCRIPTION_DELETED; o handler do webhook tem match
 * estrito (só rebaixa se for a sub vigente do profile), então as órfãs não derrubam
 * o usuário.
 */
export async function reconcileActiveSubscriptions(
  customerId: string | null | undefined,
  keepSubscriptionId: string | null,
): Promise<{ cancelled: string[]; kept: string | null; ambiguous: string[] }> {
  const cancelled: string[] = []
  const ambiguous: string[] = []

  // GUARDA CRÍTICA: sem keep, NÃO cancela nada (senão cancelaria TODAS as assinaturas
  // do cliente). Idem sem customerId.
  if (!customerId || !keepSubscriptionId) {
    if (customerId && !keepSubscriptionId) {
      logWarn('[asaas] reconcile: keepSubscriptionId nulo — não cancela nada (proteção)', { customerId })
    }
    return { cancelled, kept: keepSubscriptionId, ambiguous }
  }

  try {
    // Paginação: a listagem do Asaas é paginada (até 100/página). Acumula todas as
    // páginas — legado/retry storm pode ter criado >100 subs. Backstop em 2000.
    const subs: Array<{ id?: string; dateCreated?: string; value?: number }> = []
    let offset = 0
    for (;;) {
      const data = await asaasFetch(`/subscriptions?customer=${encodeURIComponent(customerId)}&status=ACTIVE&billingType=CREDIT_CARD&limit=100&offset=${offset}`)
      const page: Array<{ id?: string; dateCreated?: string; value?: number }> = data?.data ?? []
      subs.push(...page)
      if (!data?.hasMore || page.length === 0 || offset >= 2000) break
      offset += 100
    }

    // Só cancela órfãs MAIS ANTIGAS que a keep (a keep é a assinatura vigente/mais nova).
    // Assim, se houver dois checkouts concorrentes, nunca cancelamos a sub mais nova de
    // outro fluxo. Data indeterminada (da keep ou da candidata) → NÃO cancela (ambígua).
    const keepSub = subs.find((s) => s.id === keepSubscriptionId)
    const keepDate = keepSub?.dateCreated ? new Date(keepSub.dateCreated).getTime() : null
    const keepValue = typeof keepSub?.value === 'number' ? keepSub.value : null
    if (keepDate === null) {
      logWarn('[asaas] reconcile: dateCreated da keep indeterminada — não cancela nada (conservador)', { customerId, keepSubscriptionId })
      return { cancelled, kept: keepSubscriptionId, ambiguous }
    }

    for (const sub of subs) {
      if (!sub?.id || sub.id === keepSubscriptionId) continue
      const subDate = sub.dateCreated ? new Date(sub.dateCreated).getTime() : null
      if (subDate === null || subDate >= keepDate) {
        // Mais nova/igual à keep ou data indeterminada → AMBÍGUA por data.
        // #8 (audit 2026-06-08): mas se for DUPLICATA do MESMO plano (mesmo `value` que a
        // keep), é claramente órfã e SEGURA de cancelar — duas subs do mesmo plano nunca
        // devem coexistir (= cobrança dupla). Valor DIFERENTE = plano diferente (possível
        // upgrade concorrente legítimo) → mantém ambígua (não cancela).
        const subValue = typeof sub.value === 'number' ? sub.value : null
        if (keepValue !== null && subValue !== null && Math.abs(subValue - keepValue) <= 0.001) {
          try {
            await cancelSubscription(sub.id)
            cancelled.push(sub.id)
            log('[asaas] reconcile: duplicata mesmo-dia/MESMO-VALOR cancelada (#8)', { customerId, keepSubscriptionId, cancelledSubId: sub.id, value: subValue })
            // #6 (audit 2026-06-08): alerta operacional — a 1ª cobrança da sub duplicada já
            // pode ter ocorrido; avaliar refund manual (cancelar a sub só impede a recorrência).
            await sendBillingOpsAlert({
              subject: 'Duplicata de assinatura (mesmo plano/dia) cancelada — avaliar refund da 1ª cobrança',
              lines: { customerId, keepSubscriptionId, cancelledDuplicateSubId: sub.id, value: subValue },
            }).catch(() => {})
          } catch (err) {
            logError('[asaas] reconcile: falha ao cancelar duplicata mesmo-valor (segue)', err, { customerId, subId: sub.id })
          }
          continue
        }
        ambiguous.push(sub.id)
        logWarn('[asaas] reconcile: sub NÃO cancelada (mais nova/valor diferente/ambígua que a keep)', { customerId, keepSubscriptionId, subId: sub.id })
        continue
      }
      try {
        await cancelSubscription(sub.id)
        cancelled.push(sub.id)
        log('[asaas] reconcile: órfã antiga cancelada', { customerId, keepSubscriptionId, cancelledSubId: sub.id })
      } catch (err) {
        // Idempotente: já deletada/erro pontual → loga e segue (não derruba a ativação).
        logError('[asaas] reconcile: falha ao cancelar órfã (segue)', err, { customerId, subId: sub.id })
      }
    }
  } catch (err) {
    logError('[asaas] reconcile: falha ao listar assinaturas do cliente (não-bloqueante)', err, { customerId })
  }
  return { cancelled, kept: keepSubscriptionId, ambiguous }
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
