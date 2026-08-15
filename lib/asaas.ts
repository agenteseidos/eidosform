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
    // Corpo do erro VIAJA na exceção (achado #6, teste 05/08): sem isso o motivo
    // real da recusa morria no console da Vercel e o diagnóstico ficava cego.
    throw new Error(`Asaas API error ${res.status}: ${JSON.stringify(data.errors ?? data).slice(0, 300)}`)
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
  if (existing.totalCount > 0) {
    const found = existing.data[0]
    // Achado #4 (teste 05/08): reuso por e-mail devolvia o customer com dados
    // VELHOS (nome/CPF/telefone de outra época) ignorando o que o cliente
    // digitou no modal — compra por CNPJ saía como pessoa física. Atualiza
    // SEMPRE no reuso; falha não bloqueia (dados velhos = comportamento antigo).
    try {
      await updateCustomer(found.id, payload)
    } catch (err) {
      logWarn('[asaas] update do customer reusado falhou — segue com dados antigos', { customerId: found.id, err: String(err) })
    }
    return found
  }
  return asaasFetch('/customers', { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * Desliga as notificações do Asaas voltadas ao CLIENTE (e-mail/SMS/WhatsApp/voz)
 * — decisão Sidney 05/08: todo evento já tem canal PRÓPRIO espelhado (WhatsApp +
 * e-mail); o Asaas duplicava tudo. A emissão de NOTA FISCAL (módulo fiscal) NÃO
 * passa por estes eventos — permanece intacta. Notificações pro PROVEDOR (nós)
 * não são tocadas. Idempotente; falha é log, nunca bloqueia checkout.
 */
export async function disableCustomerNotifications(customerId: string): Promise<{ ok: boolean; disabled: number }> {
  try {
    const list = await asaasFetch(`/customers/${customerId}/notifications`)
    const items = (list?.data ?? []) as Array<{
      id: string
      emailEnabledForCustomer?: boolean
      smsEnabledForCustomer?: boolean
      whatsappEnabledForCustomer?: boolean
      phoneCallEnabledForCustomer?: boolean
    }>
    const toUpdate = items.filter((n) =>
      n.emailEnabledForCustomer || n.smsEnabledForCustomer || n.whatsappEnabledForCustomer || n.phoneCallEnabledForCustomer)
    if (!toUpdate.length) return { ok: true, disabled: 0 }
    await asaasFetch('/notifications/batch', {
      method: 'PUT',
      body: JSON.stringify({
        customer: customerId,
        notifications: toUpdate.map((n) => ({
          id: n.id,
          emailEnabledForCustomer: false,
          smsEnabledForCustomer: false,
          whatsappEnabledForCustomer: false,
          phoneCallEnabledForCustomer: false,
        })),
      }),
    })
    return { ok: true, disabled: toUpdate.length }
  } catch (err) {
    logWarn('[asaas] disableCustomerNotifications falhou (não bloqueante)', { customerId, err: String(err) })
    return { ok: false, disabled: 0 }
  }
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

/**
 * externalReference do PAGAMENTO AVULSO de mudança de plano (redesenho cancelar+recriar,
 * 2026-06-10). O marcador de kind permite ao webhook distinguir este avulso de um pagamento
 * de assinatura — é o gatilho do BACKSTOP que completa a troca se o fluxo síncrono morrer
 * entre cobrar e recriar a sub. Pagamentos criados via API persistem o externalReference
 * (ao contrário do hosted checkout — smoke 2026-06-08).
 *
 * ⚠️ Chaves `p`/`c`/`k`/`a` são NAMESPACE RESERVADO deste formato (parecer Codex 05/08):
 * nenhum outro produtor de externalReference deve reutilizá-las.
 *
 * 🔴 ACHADO #6 REAL do teste de compra (05/08): o formato longo
 * `profile:<uuid>|plan:X|cycle:Y|kind:planchange|attempt:<uuid36>` chegava a
 * ~130 chars e o Asaas RECUSAVA com `invalid_externalReference` (400) — todo
 * upgrade pago falhava sem criar cobrança. O maior ref comprovadamente aceito
 * em produção tinha 84 chars (junho, sem o sufixo attempt do P0-A).
 *
 * Formato COMPACTO: `p:<uuid>|plan:<plan>|c:M|k:pc|a:<hex12>` — pior caso
 * (professional) = 80 chars, abaixo do teto provado (100 aceito na sonda de
 * 05/08; 84 = maior aceito historicamente). O attempt entra TRUNCADO em
 * 12 hex do UUID da tentativa (parecer Codex: em money-path, 12 > 8 — colisão
 * de aniversário ~1:8,6k em mil tentativas com 8 vira desprezível com 12):
 * determinístico por tentativa (mesmo attemptId re-gera o MESMO ref no retry —
 * dedupe P0-A preservado). O parser lê AMBOS os formatos (junho segue legível).
 */
export function buildPlanChangeReference(profileId: string, plan: string, cycle: string, attemptId?: string): string {
  const c = cycle === 'YEARLY' ? 'Y' : 'M'
  let ref = `p:${profileId}|plan:${plan}|c:${c}|k:pc`
  if (attemptId) ref += `|a:${attemptId.replace(/-/g, '').slice(0, 12)}`
  return ref
}

/** Faz o parse de um externalReference (formatos legado E compacto; ausentes → null). */
export function parseExternalReference(ref?: string | null): { profileId: string | null; plan: string | null; cycle: string | null; kind: string | null; attempt: string | null } {
  const out = { profileId: null as string | null, plan: null as string | null, cycle: null as string | null, kind: null as string | null, attempt: null as string | null }
  if (!ref) return out
  for (const part of ref.split('|')) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    const k = part.slice(0, idx)
    const v = part.slice(idx + 1)
    if ((k === 'profile' || k === 'p') && /^[0-9a-fA-F-]{36}$/.test(v)) out.profileId = v
    // plan só é aceito se for um plano CONHECIDO (evita persistir plano inválido caso o
    // campo venha truncado/editado → cairia em erro de DB). (P3 round 4, Codex 2026-06-07.)
    else if (k === 'plan' && v && Object.prototype.hasOwnProperty.call(PLAN_PRICES, v)) out.plan = v
    else if (k === 'cycle' && (v === 'MONTHLY' || v === 'YEARLY')) out.cycle = v
    else if (k === 'c' && (v === 'M' || v === 'Y')) out.cycle = v === 'M' ? 'MONTHLY' : 'YEARLY'
    // kind restrito a valores conhecidos — 'pc' é o compacto de 'planchange'.
    else if (k === 'kind' && v === 'planchange') out.kind = v
    else if (k === 'k' && v === 'pc') out.kind = 'planchange'
    // attempt (P0-A 2026-06-15): nonce por TENTATIVA de troca — o backstop só aplica o avulso se
    // este attempt casar com a tentativa atual da linha de recuperação (anti reuso/fora-de-ordem).
    // No compacto ('a') o nonce é o PREFIXO de 8 hex do attemptId — comparações downstream
    // devem usar attemptMatches() abaixo, nunca igualdade direta com o UUID cheio.
    else if ((k === 'attempt' || k === 'a') && v) out.attempt = v
  }
  return out
}

/**
 * Compara o attempt de um ref (possivelmente TRUNCADO em 8 hex no formato compacto)
 * com o attemptId completo da linha de recuperação.
 */
export function attemptMatches(refAttempt: string | null | undefined, fullAttemptId: string | null | undefined): boolean {
  if (!refAttempt || !fullAttemptId) return false
  if (refAttempt === fullAttemptId) return true // formato legado (UUID completo)
  // Compacto: prefixo hex do UUID sem hífens. Aceita ≥8 (histórico 8, atual 12) —
  // nunca menos, senão um prefixo curto casaria com qualquer tentativa.
  if (refAttempt.length < 8) return false
  return fullAttemptId.replace(/-/g, '').startsWith(refAttempt)
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

/**
 * Cria checkout hospedado de PAGAMENTO ÚNICO (chargeTypes DETACHED) — fallback de cartão morto
 * (2026-07-03): quando o token salvo falhou/não existe, cobra só a DIFERENÇA prorateada da troca
 * de plano numa sessão hospedada; o cartão novo digitado vira token reutilizável no pagamento
 * (smoke de produção 2026-07-03: GET /payments/{id} do avulso pago devolve
 * creditCard.creditCardToken preenchido E o campo checkoutSession com o id exato da sessão —
 * gate 2 verde; a correlação com a tentativa de troca é pelo ID DA SESSÃO, salvo em
 * billing_checkouts.asaas_checkout_session_id ANTES de entregar a URL).
 * NÃO reusa o createCheckout acima de propósito: o payload DETACHED não tem bloco `subscription`,
 * e parametrizar/misturar os dois convidaria regressão na 1ª compra.
 * ⚠️ Valor mínimo de cobrança do gateway = R$5 (smoke 2026-07-03: 400 invalid_object abaixo disso).
 */
export async function createDetachedCheckout(params: {
  customerId: string
  value: number
  /** ≤30 chars (limite de item do Asaas — truncado defensivamente aqui). */
  name: string
  description: string
  successUrl: string
  cancelUrl: string
  expiredUrl: string
  /** Defensivo: o Asaas NÃO persiste externalReference no checkout hospedado (smoke 2026-06-08). */
  externalReference?: string
  /** Default 60 (janela menor = menos drift de proration na sessão viva). */
  minutesToExpire?: number
}): Promise<{ id: string; url: string }> {
  const { customerId, value, name, description, successUrl, cancelUrl, expiredUrl, externalReference, minutesToExpire } = params

  log('[asaas] createDetachedCheckout payload', { value, customerId })

  // Shape validada no smoke de produção 2026-07-03 → 200 { id, status:'ACTIVE', link }.
  const payload = {
    customer: customerId,
    billingTypes: ['CREDIT_CARD'],
    chargeTypes: ['DETACHED'],
    ...(externalReference ? { externalReference } : {}),
    items: [{
      name: name.slice(0, 30),
      description,
      quantity: 1,
      value,
    }],
    callback: {
      successUrl,
      cancelUrl,
      expiredUrl,
    },
    minutesToExpire: minutesToExpire ?? 60,
  }

  const data = await asaasFetch('/checkouts', { method: 'POST', body: JSON.stringify(payload) })
  // A resposta já traz a URL pronta (campo link, formato /checkoutSession/show/{id} — smoke
  // 2026-07-03), mas montamos a partir do id espelhando o createCheckout acima: mesma origem
  // sandbox/produção e um único ponto de verdade do formato.
  const checkoutUrl = `${getAsaasCheckoutOrigin()}/checkoutSession/show?id=${data.id}`
  return { id: data.id, url: checkoutUrl }
}

/** Resumo de assinatura retornado pela listagem do Asaas (campos usados pelo app). */
export interface AsaasSubscriptionSummary {
  id: string
  status: string
  value: number
  cycle?: string
  description?: string
  dateCreated?: string
}

/**
 * Lista assinaturas ATIVAS de cartão de um customer (até 100).
 * ⚠️ Retorna o ARRAY direto (já desembrulha o envelope `{ data: [...] }` da API).
 * NÃO acessar `.data` no retorno — fazer isso silenciosamente produz `[]` (P0, audit 2026-06-09:
 * os dois crons de reconcile faziam exatamente isso e viraram no-ops).
 */
export async function getCustomerSubscriptions(customerId: string): Promise<AsaasSubscriptionSummary[]> {
  const data = await asaasFetch(`/subscriptions?customer=${encodeURIComponent(customerId)}&status=ACTIVE&billingType=CREDIT_CARD&limit=100`)
  return data.data ?? []
}

/**
 * Cria assinatura recorrente reutilizando o creditCardToken JÁ existente do cliente (tokenização
 * por cliente — o token substitui os dados completos do cartão). Com nextDueDate FUTURO, a 1ª
 * cobrança só ocorre nessa data (não cobra agora). Usado na REATIVAÇÃO pós-cancelamento quando o
 * saldo cobre o novo plano (a sub foi deletada no cancelamento, então recriamos). (#2b, 2026-06-08.)
 */
export async function createSubscriptionWithToken(params: {
  customerId: string
  value: number
  cycle: BillingCycle
  nextDueDate: string
  creditCardToken: string
  description: string
  externalReference?: string
  /** IP do CLIENTE (antifraude Asaas). Sem ele, a análise vê o IP do datacenter
   *  da Vercel e pode recusar a transação na porta (achado #6, teste 05/08). */
  remoteIp?: string
}): Promise<{ id: string }> {
  const { customerId, value, cycle, nextDueDate, creditCardToken, description, externalReference, remoteIp } = params
  const payload = {
    customer: customerId,
    billingType: 'CREDIT_CARD',
    value,
    nextDueDate,
    cycle,
    description,
    creditCardToken,
    ...(externalReference ? { externalReference } : {}),
    ...(remoteIp ? { remoteIp } : {}),
  }
  const data = await asaasFetch('/subscriptions', { method: 'POST', body: JSON.stringify(payload) })
  return { id: data.id }
}

/**
 * Cobra um PAGAMENTO AVULSO (não-assinatura) no cartão salvo via creditCardToken.
 * Usado pela mudança de plano (redesenho 2026-06-10): a DIFERENÇA prorateada é cobrada
 * como avulso; a assinatura nova é criada à parte no preço CHEIO (nunca editamos valor
 * de sub — `400 invalid_value` em produção). dueDate=hoje → cobrança imediata no cartão.
 * Retorna id+status (CONFIRMED/RECEIVED = pago; PENDING = aguardar webhook).
 */
export async function createPaymentWithToken(params: {
  customerId: string
  value: number
  creditCardToken: string
  description: string
  externalReference: string
  /** IP do CLIENTE (antifraude Asaas) — ver nota em createSubscriptionWithToken. */
  remoteIp?: string
}): Promise<{ id: string; status: string }> {
  const { customerId, value, creditCardToken, description, externalReference, remoteIp } = params
  const payload = {
    customer: customerId,
    billingType: 'CREDIT_CARD',
    value,
    dueDate: new Date().toISOString().split('T')[0],
    description,
    creditCardToken,
    externalReference,
    ...(remoteIp ? { remoteIp } : {}),
  }
  const data = await asaasFetch('/payments', { method: 'POST', body: JSON.stringify(payload) })
  return { id: data.id, status: String(data.status ?? '') }
}

/**
 * Estorna um pagamento. FAIL-CLOSED da mudança de plano: se o avulso foi cobrado mas a
 * recriação da assinatura falhou definitivamente, devolvemos o dinheiro — nunca ficar
 * com cobrança sem o plano correspondente.
 */
export async function refundPayment(paymentId: string): Promise<{ id: string; status: string }> {
  const data = await asaasFetch(`/payments/${paymentId}/refund`, { method: 'POST', body: JSON.stringify({}) })
  return { id: data.id ?? paymentId, status: String(data.status ?? '') }
}

/**
 * Busca um pagamento por id. `ok:false` = consulta FALHOU (rede/5xx → o chamador NÃO deve cobrar
 * de novo); `payment:null` = não existe (404). Usado pela idempotência da troca de plano (P0-A).
 */
export async function getPaymentById(paymentId: string): Promise<{ ok: boolean; payment: { id: string; status: string } | null }> {
  try {
    const data = await asaasFetch(`/payments/${encodeURIComponent(paymentId)}`)
    if (!data?.id) return { ok: true, payment: null }
    return { ok: true, payment: { id: String(data.id), status: String(data.status ?? '') } }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/error 404/i.test(msg)) return { ok: true, payment: null } // não existe → definitivo
    logError('[asaas] getPaymentById: consulta falhou (ok=false)', err, { paymentId })
    return { ok: false, payment: null }
  }
}

/**
 * Busca um pagamento por id COM os campos usados pelo fallback de cartão morto (2026-07-03):
 * `customer` e `checkoutSession` (identidade forte da correlação — o payment de sessão DETACHED
 * paga devolve o id exato da sessão, smoke de produção 2026-07-03) e `creditCardToken` (via
 * extractCardToken — o avulso DETACHED pago devolve creditCard.creditCardToken reutilizável,
 * gate 2 verde no smoke). O backstop SEMPRE consulta este GET fresco: o payload do webhook é só
 * dica de correlação, nunca fonte de verdade. Mesma semântica do getPaymentById: `ok:false` =
 * consulta FALHOU (rede/5xx → o chamador não deve agir); `payment:null` = não existe (404).
 * `value` é coerção Number() (NaN se ausente — o consumidor valida antes de comparar dinheiro).
 */
export async function getPaymentWithCard(paymentId: string): Promise<{
  ok: boolean
  payment: {
    id: string
    status: string
    value: number
    customer: string
    checkoutSession: string | null
    creditCardToken: string | null
  } | null
}> {
  try {
    const data = await asaasFetch(`/payments/${encodeURIComponent(paymentId)}`)
    if (!data?.id) return { ok: true, payment: null }
    return {
      ok: true,
      payment: {
        id: String(data.id),
        status: String(data.status ?? ''),
        value: Number(data.value),
        customer: String(data.customer ?? ''),
        checkoutSession: data.checkoutSession ? String(data.checkoutSession) : null,
        creditCardToken: extractCardToken(data),
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/error 404/i.test(msg)) return { ok: true, payment: null } // não existe → definitivo
    logError('[asaas] getPaymentWithCard: consulta falhou (ok=false)', err, { paymentId })
    return { ok: false, payment: null }
  }
}

/**
 * Busca o avulso (pagamento) NÃO-estornado mais recente com este externalReference. Usado pela
 * idempotência da troca de plano (P0-A) p/ não cobrar em dobro num retry quando o payment.id ainda
 * não foi salvo. `ok:false` = consulta FALHOU (NÃO cobrar de novo); `payment:null` = não achou.
 */
export async function findPaymentByExternalReference(externalReference: string): Promise<{ ok: boolean; payment: { id: string; status: string } | null }> {
  try {
    const data = await asaasFetch(`/payments?externalReference=${encodeURIComponent(externalReference)}&limit=20`)
    const pays: Array<{ id?: string; status?: string; dateCreated?: string }> = data?.data ?? []
    // SEM filtro de recência (audit 2026-06-15): o externalReference já é ÚNICO por tentativa (inclui
    // |attempt:{nonce}), então QUALQUER avulso retornado é desta tentativa e deve ser reutilizado —
    // mesmo num retry tardio (>24h, ou avulso que ficou PENDING e o cliente só voltou no dia seguinte).
    // Um corte temporal aqui só causaria dano: esconderia o avulso da própria tentativa quando o
    // asaas_payment_id não foi persistido → o POST cobraria DE NOVO a mesma diferença (cobrança dupla).
    const usable = pays
      .filter((p) => p.status === 'CONFIRMED' || p.status === 'RECEIVED' || p.status === 'PENDING')
      .sort((a, b) => String(b.dateCreated ?? '').localeCompare(String(a.dateCreated ?? '')))
    const top = usable[0]
    if (!top?.id) return { ok: true, payment: null }
    return { ok: true, payment: { id: String(top.id), status: String(top.status ?? '') } }
  } catch (err) {
    logError('[asaas] findPaymentByExternalReference: consulta falhou (ok=false)', err, { externalReference })
    return { ok: false, payment: null }
  }
}

/**
 * Busca o pagamento utilizável (CONFIRMED/RECEIVED/PENDING) mais recente de uma SESSÃO de
 * checkout DETACHED — fallback de cartão morto (2026-07-03). Usado pelo cron de reconcile como
 * backstop de webhook perdido/falho. `ok:false` = consulta FALHOU (o chamador NÃO deve agir
 * neste tick); `payment:null` = não achou.
 *
 * 🛡️ (P0-b) VALIDAÇÃO CLIENT-SIDE OBRIGATÓRIA: descarta todo payment cujo `checkoutSession` não
 * seja EXATAMENTE o id pedido. Motivo: APIs REST (Asaas incluso) costumam IGNORAR query params
 * desconhecidos e devolver a listagem GERAL da conta — sem este filtro local, o cron poderia
 * casar o pagamento de OUTRO cliente e o backstop estornaria uma renovação legítima. O smoke de
 * produção 2026-07-03 confirmou que `GET /payments?checkoutSession=` filtra corretamente E que
 * id inexistente devolve lista VAZIA (totalCount 0) — mesmo assim o filtro fica: defesa em
 * profundidade contra mudança de comportamento da API.
 */
export async function findPaymentByCheckoutSession(checkoutSessionId: string): Promise<{ ok: boolean; payment: { id: string; status: string } | null }> {
  try {
    const data = await asaasFetch(`/payments?checkoutSession=${encodeURIComponent(checkoutSessionId)}&limit=10`)
    const pays: Array<{ id?: string; status?: string; checkoutSession?: string; dateCreated?: string }> = data?.data ?? []
    const usable = pays
      // 🛡️ P0-b: só payments da PRÓPRIA sessão. Payment SEM checkoutSession também é descartado
      // (seria um pagamento comum de assinatura vazando por uma listagem geral).
      .filter((p) => p.checkoutSession === checkoutSessionId)
      .filter((p) => p.status === 'CONFIRMED' || p.status === 'RECEIVED' || p.status === 'PENDING')
      .sort((a, b) => String(b.dateCreated ?? '').localeCompare(String(a.dateCreated ?? '')))
    const top = usable[0]
    if (!top?.id) return { ok: true, payment: null }
    return { ok: true, payment: { id: String(top.id), status: String(top.status ?? '') } }
  } catch (err) {
    logError('[asaas] findPaymentByCheckoutSession: consulta falhou (ok=false)', err, { checkoutSessionId })
    return { ok: false, payment: null }
  }
}

/**
 * Alinha o dueDate dos pagamentos PENDING de uma assinatura ao novo nextDueDate. Necessário no
 * Caminho D: ao editar a sub (updateSubscription), o Asaas atualiza o VALOR dos pagamentos
 * pendentes mas MANTÉM a data do que já foi gerado — então um pagamento antigo cobraria ANTES da
 * data de cobertura do saldo. Move cada pendente p/ a data correta. Best-effort. (bugfix 2026-06-08.)
 */
/**
 * Retorna o dueDate do pagamento PENDING mais ANTIGO de uma assinatura (a próxima cobrança que o
 * cliente ainda NÃO pagou = a data até onde ele tem acesso pago). Usado no cancelamento como
 * fonte da expiração — é correto tanto p/ sub com 1ª cobrança futura (credit-time/reativação: o
 * pendente é a data de cobertura real) quanto p/ renovação paga (o pendente é a próxima cobrança).
 * Evita o `subscription.nextDueDate` INFLADO (próximo ciclo) das subs deferidas. (P0, Codex.)
 */
/**
 * Há pagamento CONFIRMED/RECEIVED para esta assinatura? Usado pelo BACKSTOP (cron) p/ confirmar
 * que o dinheiro entrou ANTES de ativar (não basta a sub estar ACTIVE). `ok:false` = consulta
 * falhou (o backstop deve ser conservador e NÃO ativar nesse tick).
 */
/**
 * Existe pagamento confirmado nesta assinatura?
 *
 * ⚠️ `desdeISO` NÃO é enfeite. Sem ele, esta função responde "sim" por um pagamento de QUALQUER
 * época — o próprio lote 1 diagnosticou isso ao escrever o 1D.2 ("assinante veterano inadimplente
 * passaria") e criou um helper separado para o `expire-plans`, mas deixou os outros chamadores com
 * a versão sem recorte. O caso concreto: alguém pagou em janeiro, parou em março, a assinatura
 * segue `ACTIVE` no Asaas (lá o status da assinatura é independente do status da cobrança) e um
 * checkout abandonado libera o plano hoje por causa do pagamento de janeiro.
 *
 * Quem decide "posso ativar ESTE checkout?" deve passar a data do checkout: só um pagamento feito
 * a partir dali justifica a ativação. Sem o parâmetro o comportamento antigo é preservado, para
 * não mudar em silêncio o chamador do painel administrativo, onde a pergunta é outra ("esta pessoa
 * já pagou alguma vez?").
 */
export async function hasConfirmedPaymentForSubscription(
  subscriptionId: string,
  desdeISO?: string,
): Promise<{ confirmed: boolean; ok: boolean }> {
  try {
    const data = await asaasFetch(`/payments?subscription=${encodeURIComponent(subscriptionId)}&limit=20`)
    const pays: Array<{ status?: string; dateCreated?: string; confirmedDate?: string; paymentDate?: string }> = data?.data ?? []
    const pago = (p: { status?: string }) =>
      p.status === 'CONFIRMED' || p.status === 'RECEIVED' || p.status === 'RECEIVED_IN_CASH'

    if (!desdeISO) return { confirmed: pays.some(pago), ok: true }

    const corte = new Date(desdeISO).getTime()
    if (Number.isNaN(corte)) {
      // Data de corte inválida: NÃO afrouxar para "qualquer época" — seria voltar ao defeito por
      // um erro de quem chamou. Trata como consulta inconclusiva; o chamador não ativa nada.
      logError('[asaas] hasConfirmedPaymentForSubscription: desdeISO inválido (ok=false)', undefined, { subscriptionId, desdeISO })
      return { confirmed: false, ok: false }
    }

    const confirmed = pays.some((p) => {
      if (!pago(p)) return false
      // Qualquer uma das datas serve como prova de recência; o Asaas não preenche todas sempre.
      const datas = [p.confirmedDate, p.paymentDate, p.dateCreated]
        .map((d) => (d ? new Date(d).getTime() : NaN))
        .filter((t) => !Number.isNaN(t))
      // Pagamento confirmado SEM data nenhuma não conta: sem prova de recência, não ativa.
      if (datas.length === 0) return false
      return Math.max(...datas) >= corte
    })
    return { confirmed, ok: true }
  } catch (err) {
    logError('[asaas] hasConfirmedPaymentForSubscription: consulta falhou (ok=false)', err, { subscriptionId })
    return { confirmed: false, ok: false }
  }
}

export async function getEarliestPendingDueDate(subscriptionId: string): Promise<{ dueDate: string | null; ok: boolean }> {
  try {
    // PAGINA TODOS os pendentes (o mais antigo pode estar além dos 100 primeiros) e tira o min.
    // (P0-2, Codex 2026-06-08.) `ok:false` distingue "listagem falhou" de "sem pendente" — o
    // chamador NÃO deve confiar no nextDueDate inflado quando a listagem falhou.
    const dates: string[] = []
    let offset = 0
    for (;;) {
      const data = await asaasFetch(`/payments?subscription=${encodeURIComponent(subscriptionId)}&status=PENDING&limit=100&offset=${offset}`)
      const pays: Array<{ dueDate?: string }> = data?.data ?? []
      for (const p of pays) if (typeof p.dueDate === 'string' && p.dueDate) dates.push(p.dueDate)
      if (!data?.hasMore || pays.length === 0 || offset >= 2000) break
      offset += 100
    }
    dates.sort()
    return { dueDate: dates[0] ?? null, ok: true }
  } catch (err) {
    logError('[asaas] getEarliestPendingDueDate: listagem falhou (ok=false)', err, { subscriptionId })
    return { dueDate: null, ok: false }
  }
}

/**
 * Cobranças PENDENTES de uma assinatura, com id e vencimento (Fase 4 do painel:
 * a caracterização de 05/08 provou que cobrança JÁ EMITIDA se move
 * INDIVIDUALMENTE — a sub só controla a geração futura).
 */
/**
 * Esta assinatura tem cobrança VENCIDA (OVERDUE)? (auditoria 2026-08, lote 1D.)
 *
 * No Asaas o status da ASSINATURA é independente do status da COBRANÇA: um cartão recusado
 * mantém a sub `ACTIVE` gerando faturas OVERDUE. Quem decide acesso olhando só `status==='ACTIVE'`
 * concede acesso pago indefinidamente sem receita.
 *
 * `hasConfirmedPaymentForSubscription` NÃO serve aqui: ela acha qualquer pagamento confirmado,
 * inclusive de ciclos antigos — um assinante veterano inadimplente passaria.
 * `getPendingPaymentsBySubscription` também não: filtra `status=PENDING`, que exclui OVERDUE.
 *
 * `ok:false` = consulta falhou → o chamador deve ser CONSERVADOR (não derrubar pagante por
 * falha de rede), seguindo o mesmo contrato dos helpers vizinhos.
 */
export async function hasOverduePaymentForSubscription(subscriptionId: string): Promise<{ overdue: boolean; oldestDueDate: string | null; ok: boolean }> {
  try {
    const data = await asaasFetch(`/payments?subscription=${encodeURIComponent(subscriptionId)}&status=OVERDUE&limit=20`)
    const pays: Array<{ dueDate?: string }> = data?.data ?? []
    const dates = pays.map((p) => p.dueDate).filter((d): d is string => typeof d === 'string' && d.length > 0).sort()
    return { overdue: pays.length > 0, oldestDueDate: dates[0] ?? null, ok: true }
  } catch (err) {
    logError('[asaas] hasOverduePaymentForSubscription: consulta falhou (ok=false)', err, { subscriptionId })
    return { overdue: false, oldestDueDate: null, ok: false }
  }
}

/**
 * Link de pagamento da cobrança VENCIDA mais antiga — o botão "Regularizar meu pagamento" da
 * régua de cobrança (D-01, 11/08/2026).
 *
 * A página de fatura do gateway resolve as duas necessidades do Sidney ("trocar o cartão" e
 * "lançar o pagamento") sem construirmos tela nenhuma. O e-mail nunca cita o gateway — o
 * cliente só vê o botão.
 *
 * ⚠️ ESTE COMENTÁRIO JÁ MENTIU (corrigido 15/08): dizia que a página "aceita cartão, Pix e
 * boleto". Não há evidência disso e o EidosForm **só vende por CARTÃO** ([[decisions]]).
 * Verificado na API: 100% das nossas cobranças nascem `billingType=CREDIT_CARD`, e o gateway
 * monta a página pelo tipo da cobrança. A afirmação errada aqui foi a semente de uma proposta
 * de teste em Pix — o Sidney barrou. O que a página realmente renderiza só será CONFIRMADO no
 * teste com fatura vencida real; até lá, não afirmar.
 *
 * ⚠️ `null` é um desfecho ESPERADO, não erro: gateway fora do ar, cobrança sem URL, sem vencida.
 * Quem chama tem de ter um caminho sem link (a régua troca o botão por "responda este e-mail")
 * — um botão quebrado numa cobrança é pior que nenhum botão.
 */
export async function getLinkPagamentoVencido(subscriptionId: string): Promise<{ ok: boolean; url: string | null; dueDate: string | null }> {
  try {
    const data = await asaasFetch(`/payments?subscription=${encodeURIComponent(subscriptionId)}&status=OVERDUE&limit=20`)
    const pays: Array<{ dueDate?: string; invoiceUrl?: string; bankSlipUrl?: string }> = data?.data ?? []
    // Mais ANTIGA primeiro: é a que trava a renovação; pagar ela é o que regulariza a conta.
    const ordenadas = pays
      .filter((p) => typeof p.dueDate === 'string' && p.dueDate)
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    const alvo = ordenadas.find((p) => p.invoiceUrl || p.bankSlipUrl)
    if (!alvo) return { ok: true, url: null, dueDate: ordenadas[0]?.dueDate ?? null }
    // invoiceUrl é a página completa (cartão + Pix + boleto); bankSlipUrl só o boleto.
    return { ok: true, url: alvo.invoiceUrl ?? alvo.bankSlipUrl ?? null, dueDate: alvo.dueDate ?? null }
  } catch (err) {
    logWarn('[asaas] getLinkPagamentoVencido falhou', { subscriptionId, err: String(err).slice(0, 120) })
    return { ok: false, url: null, dueDate: null }
  }
}

export async function getPendingPaymentsBySubscription(subscriptionId: string): Promise<{ ok: boolean; payments: Array<{ id: string; dueDate: string; value: number }> }> {
  try {
    const data = await asaasFetch(`/payments?subscription=${encodeURIComponent(subscriptionId)}&status=PENDING&limit=20`)
    const payments = (data?.data ?? []).map((p: { id: string; dueDate: string; value: number }) => ({ id: p.id, dueDate: p.dueDate, value: p.value }))
    return { ok: true, payments }
  } catch (err) {
    logWarn('[asaas] getPendingPaymentsBySubscription falhou', { subscriptionId, err: String(err) })
    return { ok: false, payments: [] }
  }
}

/** Move o vencimento de UMA cobrança emitida (a alavanca certa — caracterização 05/08). */
export async function updatePaymentDueDate(paymentId: string, dueDate: string): Promise<{ id: string; dueDate: string }> {
  const data = await asaasFetch(`/payments/${paymentId}`, {
    method: 'PUT',
    body: JSON.stringify({ dueDate }),
  })
  return { id: data.id ?? paymentId, dueDate: data.dueDate ?? dueDate }
}

export async function alignPendingPaymentsDueDate(subscriptionId: string, dueDate: string): Promise<{ moved: number; failed: number }> {
  // FASE 1 — COLETA todos os IDs pendentes desalinhados SEM mutar (pagina estável; mutar durante a
  // paginação por offset faria a próxima página pular pendentes, se a API ordenar por dueDate).
  // (P0-1, Codex 2026-06-08.)
  const toMove: string[] = []
  let offset = 0
  for (;;) {
    const data = await asaasFetch(`/payments?subscription=${encodeURIComponent(subscriptionId)}&status=PENDING&limit=100&offset=${offset}`)
    const pays: Array<{ id?: string; dueDate?: string }> = data?.data ?? []
    for (const p of pays) if (p?.id && p.dueDate !== dueDate) toMove.push(p.id)
    if (!data?.hasMore || pays.length === 0 || offset >= 2000) break
    offset += 100
  }
  // FASE 2 — move cada um.
  let moved = 0
  let failed = 0
  for (const id of toMove) {
    try {
      await asaasFetch(`/payments/${id}`, { method: 'PUT', body: JSON.stringify({ dueDate }) })
      moved++
    } catch (err) {
      failed++
      logError('[asaas] alignPendingPaymentsDueDate: falha ao mover pagamento pendente', err, { paymentId: id, subscriptionId, dueDate })
    }
  }
  return { moved, failed }
}

/**
 * Extrai o creditCardToken de uma assinatura (campo creditCard.creditCardToken da resposta do
 * Asaas), p/ guardar no perfil e reutilizar na reativação. Retorna null se ausente. (#2b)
 */
export function extractCardToken(subscription: unknown): string | null {
  const cc = (subscription as { creditCard?: { creditCardToken?: string } } | null)?.creditCard
  return cc?.creditCardToken ?? null
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

/**
 * Troca o cartão de uma assinatura para um token JÁ tokenizado
 * (PUT /v3/subscriptions/{id}/creditCard). Não cobra nada no ato; cobranças pendentes e
 * futuras passam a usar o cartão novo (doc Asaas). Usado pelo alinhamento pós-pagamento
 * (D-01, 13/08/2026): a página de fatura aceita cartão NOVO, mas o gateway NÃO propaga o
 * cartão novo para a assinatura — existe endpoint próprio exatamente porque a troca não é
 * automática. Sem o alinhamento, o ciclo seguinte cobraria o cartão antigo (morto) e a
 * régua de cobrança dispararia todo mês.
 */
export async function updateSubscriptionCreditCard(subscriptionId: string, creditCardToken: string): Promise<{ id: string }> {
  const data = await asaasFetch(`/subscriptions/${subscriptionId}/creditCard`, {
    method: 'PUT',
    body: JSON.stringify({ creditCardToken }),
  })
  // Invalida o cache (30s): a próxima leitura precisa VER o cartão novo — o próprio
  // alinhamento usa a leitura da sub p/ decidir se ainda há divergência (idempotência).
  subscriptionCache.delete(subscriptionId)
  return { id: data?.id ?? subscriptionId }
}

/**
 * creditCardToken do PAGAMENTO (GET /v3/payments/{id}) — o cartão que efetivamente PAGOU.
 * Usado pelo reprocessador da DLQ, que não guarda payload de webhook (PII) e por isso
 * precisa reler o payment fresco. Best-effort: null em Pix/boleto, payment sem cartão ou
 * falha de rede (quem chama trata null como "sem alinhamento", nunca como erro).
 */
export async function getPaymentCardToken(paymentId: string): Promise<string | null> {
  try {
    const data = await asaasFetch(`/payments/${paymentId}`)
    return (data as { creditCard?: { creditCardToken?: string } } | null)?.creditCard?.creditCardToken ?? null
  } catch (err) {
    logWarn('[asaas] getPaymentCardToken falhou (segue sem alinhamento)', { paymentId, err: String(err).slice(0, 120) })
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// NFS-e (notas fiscais de serviço) — wrappers finos; a política mora em lib/nfse.ts.

export type AsaasInvoiceStatus =
  | 'SCHEDULED' | 'SYNCHRONIZED' | 'AUTHORIZED'
  | 'PROCESSING_CANCELLATION' | 'CANCELED' | 'CANCELLATION_DENIED' | 'ERROR'

export interface AsaasInvoiceSummary {
  id: string
  status: AsaasInvoiceStatus
  payment?: string | null
  value?: number
  number?: string | null
}

/** Lista as notas vinculadas a uma cobrança (GET /v3/invoices?payment=). */
export async function listInvoicesByPayment(paymentId: string): Promise<AsaasInvoiceSummary[]> {
  const data = await asaasFetch(`/invoices?payment=${encodeURIComponent(paymentId)}&limit=100`)
  const rows: AsaasInvoiceSummary[] = data.data ?? []
  // Cinto e suspensório: se a API ignorar o filtro (param desconhecido em versão
  // futura), o filtro client-side impede agir sobre nota de OUTRA cobrança.
  return rows.filter((inv) => !inv.payment || inv.payment === paymentId)
}

/**
 * Agenda a emissão de uma NFS-e vinculada a uma cobrança (POST /v3/invoices).
 * A emissão em si é assíncrona no Asaas (SCHEDULED → SYNCHRONIZED → AUTHORIZED/ERROR).
 */
export async function scheduleInvoiceForPayment(params: {
  paymentId: string
  value: number
  effectiveDate: string // YYYY-MM-DD
  serviceDescription: string
  observations: string
  municipalServiceId: string
  municipalServiceName: string
  externalReference: string
  taxes: { retainIss: boolean; iss: number; pis: number; cofins: number; csll: number; inss: number; ir: number }
}): Promise<{ id: string; status: string }> {
  const data = await asaasFetch('/invoices', {
    method: 'POST',
    body: JSON.stringify({
      payment: params.paymentId,
      serviceDescription: params.serviceDescription,
      observations: params.observations,
      value: params.value,
      deductions: 0,
      effectiveDate: params.effectiveDate,
      externalReference: params.externalReference,
      municipalServiceId: params.municipalServiceId,
      municipalServiceName: params.municipalServiceName,
      // NÃO usar updatePayment: a nota nunca deve mexer no valor da cobrança.
      taxes: params.taxes,
    }),
  })
  return { id: data.id, status: data.status }
}

/** Cancela uma NFS-e (POST /v3/invoices/{id}/cancel). Gratuito; sujeito a prazo municipal. */
export async function cancelInvoice(invoiceId: string): Promise<{ id: string; status: string }> {
  const data = await asaasFetch(`/invoices/${encodeURIComponent(invoiceId)}/cancel`, { method: 'POST' })
  return { id: data.id, status: data.status }
}
