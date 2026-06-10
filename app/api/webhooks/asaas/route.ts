/**
 * app/api/webhooks/asaas/route.ts — Webhooks do Asaas
 * Eventos: PAYMENT_CONFIRMED, PAYMENT_OVERDUE, SUBSCRIPTION_DELETED
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPlanActivated, sendPlanCancelled, sendBillingOpsAlert } from '@/lib/resend'
import { PLANS, PlanName, handleDowngrade, handleUpgrade } from '@/lib/plan-limits'
import { PLAN_PRICES, getSubscription, parseExternalReference, cancelSubscription } from '@/lib/asaas'
import { finalizeActivation, claimActivationEffects, isExpectedFullPrice } from '@/lib/billing-activation'
import { logError, logWarn, log } from '@/lib/logger'
import { verifyAsaasSignature, verifyAsaasAccessToken } from '@/lib/webhook-hmac'
import { logWebhookEvent } from '@/lib/webhook-logger'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * HARDENING (2026-06-09): o webhook rejeitando eventos por auth (401) NÃO pode ser silencioso —
 * foi o que mascarou o incidente (URL/token errados → eventos morriam sem ninguém saber).
 * Dispara alerta operacional, mas com RATE-LIMIT de 1 por janela de 10 min (via marker
 * insert-do-nothing em asaas_webhook_events) p/ não virar storm/DoS num retry do Asaas.
 */
async function alertWebhookAuthFailure(reason: string, ctx: Record<string, string | number | boolean | null>) {
  try {
    const db = getSupabase()
    const bucket = Math.floor(Date.now() / 600_000) // janela de 10 minutos
    const { error } = await db.from('asaas_webhook_events').insert({
      event_id: `webhook-401-alert:${bucket}`,
      event: 'WEBHOOK_AUTH_401',
      status: 'processed',
      error: reason,
      processed_at: new Date().toISOString(),
    })
    if (error) return // conflito = já alertou nesta janela de 10 min
    await sendBillingOpsAlert({
      subject: '🚨 Webhook Asaas REJEITANDO eventos por auth (401) — verifique URL/token JÁ',
      lines: {
        motivo: reason,
        ...ctx,
        ambiente: process.env.ASAAS_ENVIRONMENT ?? '?',
        secretConfigured: String(!!(process.env.ASAAS_WEBHOOK_SECRET ?? process.env.ASAAS_WEBHOOK_TOKEN)),
        dica: 'Cheque: (1) URL do webhook = domínio canônico (sem redirect 301/302), (2) hasAuthToken=true na config Asaas, (3) o ASAAS_WEBHOOK_SECRET na Vercel sem \\n/espaço no fim.',
        quando: new Date().toISOString(),
      },
    }).catch(() => {})
  } catch { /* best-effort: nunca quebra o handler */ }
}

function detectPlanAndCycle(value: number): { plan: string; cycle: 'MONTHLY' | 'YEARLY' } | null {
  for (const [plan, prices] of Object.entries(PLAN_PRICES)) {
    if (value === prices.yearly) return { plan, cycle: 'YEARLY' }
    if (value === prices.monthly) return { plan, cycle: 'MONTHLY' }
  }
  return null
}

/**
 * Fallback for prorated payments where the value doesn't match PLAN_PRICES.
 * Queries the subscription on Asaas and parses plan/cycle from its description
 * or value. Format produced by createCheckout: "EidosForm — Plano <plan> (Mensal|Anual)".
 */
async function resolvePlanFromAsaasSubscription(subscriptionId: string): Promise<{ plan: string; cycle: 'MONTHLY' | 'YEARLY' } | null> {
  try {
    const sub = await getSubscription(subscriptionId)
    const desc = String(sub?.description ?? '')
    const cycleRaw = String(sub?.cycle ?? '').toUpperCase()
    const cycle: 'MONTHLY' | 'YEARLY' = cycleRaw === 'YEARLY' ? 'YEARLY' : 'MONTHLY'

    const match = desc.match(/Plano\s+([a-zA-Z]+)/)
    const planFromDesc = match?.[1]?.toLowerCase()
    if (planFromDesc && planFromDesc in PLAN_PRICES) {
      return { plan: planFromDesc, cycle }
    }

    if (typeof sub?.value === 'number') {
      const detected = detectPlanAndCycle(sub.value)
      if (detected) return detected
    }
    return null
  } catch (err) {
    logWarn('[asaas-webhook] resolvePlanFromAsaasSubscription failed', { subscriptionId, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

function calculateExpiryDate(cycle: 'MONTHLY' | 'YEARLY'): string {
  const now = new Date()
  if (cycle === 'YEARLY') {
    now.setFullYear(now.getFullYear() + 1)
  } else {
    now.setDate(now.getDate() + 30)
  }
  return now.toISOString()
}

type ResolvedCheckoutLink = {
  id: string
  profile_id: string
  plan: string
  cycle: string
  checkout_id: string
  asaas_customer_id: string | null
  asaas_subscription_id: string | null
  status: string
  created_at: string
}

type ResolvedUser = {
  id: string
  email: string
  full_name: string | null
  plan: string | null
}

async function getProfileById(profileId: string) {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name, plan')
    .eq('id', profileId)
    .single()

  return data as ResolvedUser | null
}

async function resolveBillingContext(params: {
  customerId?: string
  subscriptionId?: string | null
  externalReference?: string | null
  /** Plano/ciclo REALMENTE pagos — derivados do VALOR da assinatura paga pelo handler.
   *  Fonte primária de desambiguação (o Asaas NÃO persiste nosso externalReference no
   *  checkout hospedado — confirmado no smoke 2026-06-08). */
  intentPlan?: string | null
  intentCycle?: string | null
}) {
  const supabase = getSupabase()
  const { customerId, subscriptionId, externalReference, intentPlan, intentCycle } = params
  const COLS = 'id, profile_id, plan, cycle, checkout_id, asaas_customer_id, asaas_subscription_id, status, created_at'
  // Intenção do que foi pago: prioriza intentPlan/intentCycle (valor da sub); externalReference
  // fica como fallback legado (não confiável no hosted checkout). O DONO sai do customer
  // (1 customer ↔ 1 profile), então não é ambíguo — só o checkout/plano precisa de cuidado.
  const parsed = parseExternalReference(externalReference)
  const refProfileId = parsed.profileId
  const wantPlan = intentPlan ?? parsed.plan
  const wantCycle = intentCycle ?? parsed.cycle
  const ACTIVEISH = ['pending', 'paid'] // ignora cancelled/recovering na resolução

  let checkoutLink: ResolvedCheckoutLink | null = null

  // (1) Por subscription — sinal mais forte quando a sub já está vinculada à linha.
  if (subscriptionId) {
    const { data } = await supabase
      .from('billing_checkouts')
      .select(COLS)
      .eq('asaas_subscription_id', subscriptionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) checkoutLink = data as ResolvedCheckoutLink
  }

  // (2) Por INTENÇÃO EXATA (customer + plano + ciclo realmente pagos): casa a linha do
  //     checkout correspondente ao que foi pago, mesmo com vários pendentes do mesmo
  //     customer (o usuário pode ter pago um link antigo). Match exato → não pega o errado.
  if (!checkoutLink && customerId && wantPlan && wantCycle) {
    const { data } = await supabase
      .from('billing_checkouts')
      .select(COLS)
      .eq('asaas_customer_id', customerId)
      .eq('plan', wantPlan)
      .eq('cycle', wantCycle)
      .in('status', ACTIVEISH)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) checkoutLink = data as ResolvedCheckoutLink
  }

  // (3) Fallback por customer — linha ATIVA mais recente. Ambiguidade só conta entre
  //     candidatos ATIVOS (cancelled/recovering não entram). Mesmo ambíguo, a ATIVAÇÃO
  //     continua determinística (plan/cycle vem do valor da sub no handler); aqui o risco
  //     é só de bookkeeping, por isso só logamos.
  if (!checkoutLink && customerId) {
    const { data: candidates } = await supabase
      .from('billing_checkouts')
      .select(COLS)
      .eq('asaas_customer_id', customerId)
      .in('status', ACTIVEISH)
      .order('created_at', { ascending: false })
      .limit(5)

    const rows = (candidates ?? []) as ResolvedCheckoutLink[]
    if (rows.length > 1) {
      const distinct = new Set(rows.map((r) => `${r.plan}:${r.cycle}`))
      if (distinct.size > 1) {
        logWarn('[asaas-webhook] resolveBillingContext AMBÍGUO — múltiplos checkouts ATIVOS do customer com planos diferentes; bookkeeping pode pegar o errado (ativação segue determinística pelo valor da sub)', {
          customerId,
          subscriptionId: subscriptionId ?? null,
          candidates: rows.map((r) => ({ plan: r.plan, cycle: r.cycle, status: r.status, created_at: r.created_at })),
        })
      }
    }
    if (rows[0]) checkoutLink = rows[0]
  }

  let user: ResolvedUser | null = null

  if (refProfileId) {
    user = await getProfileById(refProfileId)
  }

  if (!user && checkoutLink?.profile_id) {
    user = await getProfileById(checkoutLink.profile_id)
  }

  if (!user && customerId) {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, full_name, plan')
      .eq('asaas_customer_id', customerId)
      .single()

    user = (data as ResolvedUser | null) ?? null
  }

  return {
    user,
    checkoutLink,
  }
}

async function updateCheckoutLink(params: {
  customerId?: string
  subscriptionId?: string | null
  externalReference?: string | null
  /** Linha já resolvida pelo chamador — atualiza EXATAMENTE ela, sem re-resolver. */
  checkoutLinkId?: string | null
  event: string
  status: string
  billingType?: string
}) {
  const supabase = getSupabase()
  const { customerId, subscriptionId, externalReference, checkoutLinkId, event, status, billingType } = params

  // P1 round 4 (audit Codex 2026-06-07): NÃO re-resolver quando o chamador já tem a linha
  // certa (resolvida pela intent do externalReference). Re-resolver aqui sem a intent podia
  // cair no fallback por customer/latest e marcar o checkout ERRADO como pago — e aí o
  // reprocessador por subscriptionId reativaria plano/ciclo errado. Quando checkoutLinkId
  // não vem, resolve pela MESMA intent (externalReference).
  let targetId = checkoutLinkId ?? null
  let existingCustomer: string | null = null
  let existingSub: string | null = null
  if (!targetId) {
    const { checkoutLink } = await resolveBillingContext({ customerId, subscriptionId, externalReference })
    if (!checkoutLink) {
      logWarn('[asaas-webhook] Checkout link not found for update', { customerId, subscriptionId, event, status })
      return
    }
    targetId = checkoutLink.id
    existingCustomer = checkoutLink.asaas_customer_id ?? null
    existingSub = checkoutLink.asaas_subscription_id ?? null
  }

  const updatePayload: Record<string, unknown> = { status, last_event: event }
  if (billingType) updatePayload.payment_method = billingType
  const newCustomer = customerId ?? existingCustomer
  const newSub = subscriptionId ?? existingSub
  if (newCustomer != null) updatePayload.asaas_customer_id = newCustomer
  if (newSub != null) updatePayload.asaas_subscription_id = newSub

  const { error: ckUpdateError } = await supabase
    .from('billing_checkouts')
    .update(updatePayload)
    .eq('id', targetId)

  // Não-bloqueante: billing_checkouts é bookkeeping secundário. O estado de verdade
  // do plano é o profile (já checado com throw nos handlers). Só logar.
  if (ckUpdateError) {
    logError('[asaas-webhook] Falha ao atualizar billing_checkouts (não-bloqueante)', ckUpdateError, { checkoutId: targetId, event, status })
  }
}

interface AsaasPayment {
  id?: string
  customer?: string
  value: number
  subscription?: string
  externalReference?: string
  /** YYYY-MM-DD — data da cobrança. Usada p/ distinguir renovação de entrega tardia (P2-c). */
  dueDate?: string
}

interface AsaasSubscription {
  customer?: string
  id?: string
  externalReference?: string
}

interface AsaasWebhookBody {
  id?: string
  event: string
  payment?: AsaasPayment
  subscription?: AsaasSubscription
}

type IdempotencyResult = 'fresh' | 'duplicate' | 'error'

/**
 * Check idempotency atomically — duplicate inserts fail the unique constraint.
 * Returns:
 *  - 'fresh'     → first time we see this event, proceed
 *  - 'duplicate' → unique violation, already processed
 *  - 'error'     → unexpected DB error; caller should fail closed (5xx) so Asaas retries
 */
async function checkAndMarkIdempotent(
  eventId: string,
  event: string,
  keys?: { customerId?: string | null; subscriptionId?: string | null }
): Promise<IdempotencyResult> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('asaas_webhook_events')
    .insert({
      event_id: eventId,
      event,
      // 'received' (não o default 'processed'): se a função morrer no meio (timeout 30s),
      // o evento NÃO some como "processado" — fica visível como received-órfão p/ ops/
      // backstop. O final feliz do handler promove p/ 'processed'. (P2-a, audit 2026-06-09.)
      status: 'received',
      customer_id: keys?.customerId ?? null,
      subscription_id: keys?.subscriptionId ?? null,
    })

  if (!error) return 'fresh'
  if (error.code === '23505') return 'duplicate'
  logError('[asaas-webhook] Idempotency check DB error (failing closed)', { eventId, error: error.message })
  return 'error'
}

export async function POST(req: NextRequest) {
  // Read raw body text first (needed for HMAC verification)
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Failed to read body' }, { status: 400 })
  }

  // ASAAS_WEBHOOK_TOKEN remains as legacy fallback; prefer ASAAS_WEBHOOK_SECRET going forward.
  const webhookToken = (process.env.ASAAS_WEBHOOK_SECRET ?? process.env.ASAAS_WEBHOOK_TOKEN)?.trim()
  if (process.env.ASAAS_WEBHOOK_TOKEN && !process.env.ASAAS_WEBHOOK_SECRET) {
    logWarn('[asaas-webhook] Using deprecated ASAAS_WEBHOOK_TOKEN — migrate to ASAAS_WEBHOOK_SECRET')
  }
  const hmacHeader = req.headers.get('asaas-signature')
  // O healthcheck (scripts/webhook-healthcheck.mjs) testa os caminhos de 401 de propósito —
  // marca com este header p/ NÃO disparar o alerta operacional (evita falso alarme). Eventos
  // reais do Asaas nunca mandam isso.
  const isHealthcheckProbe = req.headers.get('x-healthcheck-probe') === '1'

  if (!webhookToken) {
    // Critical config issue, but respond 401 (not 500) so Asaas does not enter
    // an exponential retry storm against an endpoint that will never succeed.
    logError('[asaas-webhook] ASAAS_WEBHOOK_SECRET or ASAAS_WEBHOOK_TOKEN not configured')
    if (!isHealthcheckProbe) await alertWebhookAuthFailure('ASAAS_WEBHOOK_SECRET/TOKEN não configurado no ambiente', {
      host: req.headers.get('host'), xForwardedHost: req.headers.get('x-forwarded-host'),
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Autenticação: aceita DOIS mecanismos.
  //  1. asaas-access-token — mecanismo NATIVO do Asaas: o authToken configurado
  //     no webhook é enviado nesse header e comparado por igualdade. É o que o
  //     Asaas realmente manda. Sem isto, todo webhook real toma 401 e o Asaas
  //     entra em retry storm (consumiu a cota de 30k req do sandbox).
  //  2. asaas-signature — HMAC-SHA256 do payload (esquema custom). Mantido por
  //     compatibilidade/defesa, mas o Asaas padrão NÃO assina o payload.
  const accessTokenHeader = req.headers.get('asaas-access-token')
  const hmacMatch = !!(hmacHeader && verifyAsaasSignature(rawBody, hmacHeader, webhookToken))
  const tokenMatch = verifyAsaasAccessToken(accessTokenHeader, webhookToken)

  if (!hmacMatch && !tokenMatch) {
    logWarn('[asaas-webhook] Auth failed', {
      hasHmacHeader: !!hmacHeader,
      hasAccessTokenHeader: !!accessTokenHeader,
      tokenPrefix: webhookToken.slice(0, 8),
    })
    if (!isHealthcheckProbe) await alertWebhookAuthFailure('token asaas-access-token (ou HMAC) não bateu com o secret', {
      hasAccessTokenHeader: !!accessTokenHeader,
      hasHmacHeader: !!hmacHeader,
      host: req.headers.get('host'), xForwardedHost: req.headers.get('x-forwarded-host'),
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: AsaasWebhookBody
  try {
    body = JSON.parse(rawBody) as AsaasWebhookBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { event, payment, subscription } = body

  // Idempotency: body.id quando presente. Chave SINTÉTICA de fallback inclui payment.id e
  // dueDate (P2-d, audit 2026-06-09): sem eles, a renovação do mês seguinte do MESMO sub
  // gerava a MESMA chave do mês anterior → 'duplicate' → renovação silenciosamente ignorada.
  const eventId = body.id ?? [
    event,
    payment?.customer ?? subscription?.customer ?? '',
    payment?.subscription ?? subscription?.id ?? '',
    payment?.id ?? '',
    payment?.dueDate ?? '',
  ].join(':')

  const idempotencyResult = await checkAndMarkIdempotent(eventId, event, {
    customerId: payment?.customer ?? subscription?.customer ?? null,
    subscriptionId: payment?.subscription ?? subscription?.id ?? null,
  })
  if (idempotencyResult === 'duplicate') {
    log('[asaas-webhook] Duplicate event ignored (idempotent)', { eventId, event })
    return NextResponse.json({ received: true, duplicate: true })
  }
  if (idempotencyResult === 'error') {
    return NextResponse.json({ error: 'Idempotency store unavailable' }, { status: 503 })
  }

  const supabase = getSupabase()

  log('[asaas-webhook] Event received', { event, eventId })
  await logWebhookEvent({ event, status: 'received', profile_id: undefined })

  try {
    switch (event) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED': {
        const customerId = payment?.customer
        if (!customerId) break

        // Fluxo de assinatura: TODO pagamento recorrente carrega payment.subscription.
        // Sem ela, não dá pra cancelar/reconciliar/corrigir a sub depois — ativar seria
        // criar um estado órfão. Manda pra DLQ (throw → failed) p/ revisão. (P2c round 3.)
        if (!payment?.subscription) {
          throw new Error(`PAYMENT_CONFIRMED/RECEIVED sem payment.subscription (customer ${customerId}) — não ativa; enviado p/ DLQ`)
        }

        // FONTE DA VERDADE = a ASSINATURA PAGA. O Asaas NÃO persiste o nosso externalReference
        // no checkout hospedado (smoke 2026-06-08: payment.externalReference e
        // subscription.externalReference vêm null). Então lemos value+cycle da própria
        // assinatura e mapeamos pro plano (preços são únicos → determinístico). Isso
        // desambigua checkouts concorrentes E cobre renovações (que não têm checkout record).
        // Em proration-checkout o value é prorateado (não mapeia) → cai no checkout record.
        let subValue: number | null = null
        let subCycle: string | null = null
        // Distingue "li a sub e o valor é X" de "NÃO consegui ler" (rede/5xx). O guard de
        // preço-cheio trata os dois de formas OPOSTAS: prorateado = bloqueio manual;
        // falha de leitura = transitório → DLQ retry-ável. (P1, audit 2026-06-09.)
        let subReadFailed = false
        try {
          const s = (await getSubscription(payment.subscription)) as { value?: number; cycle?: string }
          subValue = typeof s?.value === 'number' ? s.value : null
          subCycle = s?.cycle ?? null
        } catch (e) {
          subReadFailed = true
          logError('[asaas-webhook] falha ao ler a assinatura paga (segue p/ fallbacks)', e, { subscription: payment.subscription })
        }
        let paid = subValue != null ? detectPlanAndCycle(subValue) : null
        // Proration-checkout: o value da sub é prorateado (não mapeia pra um preço cheio) →
        // `paid` fica null. Resolve então pela DESCRIÇÃO da própria assinatura ("Plano X
        // (Anual)" + cycle), que carrega o PLANO-ALVO — determinístico, ANTES do checkout
        // record. Fecha o P1 de dois proration-checkouts concorrentes. (Codex 2026-06-08.)
        if (!paid) {
          paid = await resolvePlanFromAsaasSubscription(payment.subscription)
          if (paid) log('[asaas-webhook] plan/cycle da DESCRIÇÃO da assinatura (proration)', { subscription: payment.subscription, resolved: paid })
        }
        log('[asaas-webhook] assinatura paga', { subscription: payment.subscription, subValue, subCycle, resolved: paid })

        const { user, checkoutLink } = await resolveBillingContext({
          customerId,
          subscriptionId: payment.subscription,
          externalReference: payment?.externalReference ?? null,
          intentPlan: paid?.plan ?? null,
          intentCycle: paid?.cycle ?? null,
        })
        if (!user) {
          // EVENTO DE DINHEIRO não morre como 'processed' (P2-a, audit 2026-06-09): user não
          // resolvido pode ser erro transitório de DB (single() devolve null em falha). Lança
          // → DLQ → o reprocessador re-resolve por customer/subscription e ativa. Antes, o
          // break marcava processed e o pagamento ficava perdido (sem retry do Asaas: 200 +
          // idempotência fariam o retry virar 'duplicate').
          throw new Error(`PAYMENT_CONFIRMED/RECEIVED sem profile resolvido (customer ${customerId}, sub ${payment.subscription}) — DLQ/retry`)
        }

        // "Checkout mais recente vence": se já existe um checkout PAGO mais NOVO que este
        // evento para o mesmo profile, este é um webhook fora de ordem chegando atrasado.
        // NÃO sobrescrever o plano (senão rebaixaria o usuário pro plano antigo). O evento
        // segue marcado como processado (idempotência) — só pulamos a ativação.
        if (checkoutLink?.profile_id && checkoutLink?.created_at) {
          const { data: newerPaid } = await supabase
            .from('billing_checkouts')
            .select('id')
            .eq('profile_id', checkoutLink.profile_id)
            .eq('status', 'paid')
            .gt('created_at', checkoutLink.created_at)
            .limit(1)
            .maybeSingle()
          if (newerPaid) {
            log('[asaas-webhook] Evento ignorado — checkout mais recente já venceu (entrega fora de ordem)', {
              userId: user.id,
              eventCheckoutId: checkoutLink.id,
              eventCheckoutCreatedAt: checkoutLink.created_at,
            })
            // P0 round 5 (audit Codex 2026-06-07): pagar um checkout ANTIGO depois de já ter
            // pago um mais NOVO cria uma assinatura nova (subA) que NÃO é a vigente do profile.
            // O reconcile NÃO a cancela (subA é mais nova que a keep → tratada como ambígua),
            // então ficariam 2 subs ACTIVE = cobrança dupla recorrente. Cancela a órfã
            // explicitamente (não ativa A nem mexe no profile), marca o checkout como
            // superseded e loga ALTO (a 1ª cobrança de A já ocorreu → avaliar refund manual).
            // Guarda: só cancela se NÃO for a sub vigente (nunca derruba o plano ativo).
            if (payment.subscription) {
              const { data: vigente } = await supabase
                .from('profiles')
                .select('asaas_subscription_id')
                .eq('id', user.id)
                .single()
              const vigenteSub = (vigente as { asaas_subscription_id?: string | null } | null)?.asaas_subscription_id ?? null
              if (payment.subscription !== vigenteSub) {
                try {
                  await cancelSubscription(payment.subscription)
                  logError('[asaas-webhook] CRÍTICO: checkout antigo pago após um mais novo — assinatura órfã CANCELADA p/ evitar cobrança dupla (avaliar refund manual da 1ª cobrança)', undefined, {
                    userId: user.id,
                    orphanSubscriptionId: payment.subscription,
                    activeSubscriptionId: vigenteSub,
                    supersededCheckoutId: checkoutLink.id,
                  })
                  await sendBillingOpsAlert({
                    subject: 'Checkout antigo pago após um mais novo — sub órfã cancelada (AVALIAR REFUND da 1ª cobrança)',
                    lines: { userId: user.id, orphanSubscriptionId: payment.subscription, activeSubscriptionId: vigenteSub, customerId },
                  }).catch(() => {})
                } catch (err) {
                  logError('[asaas-webhook] Falha ao cancelar assinatura órfã do checkout antigo (revisar manual)', err, {
                    userId: user.id,
                    orphanSubscriptionId: payment.subscription,
                  })
                  await sendBillingOpsAlert({
                    subject: 'FALHA ao cancelar sub órfã do checkout antigo — RISCO DE COBRANÇA DUPLA, cancelar manualmente no Asaas',
                    lines: { userId: user.id, orphanSubscriptionId: payment.subscription, activeSubscriptionId: vigenteSub, customerId, error: err instanceof Error ? err.message : String(err) },
                  }).catch(() => {})
                }
                await supabase
                  .from('billing_checkouts')
                  .update({ status: 'cancelled', last_event: 'SUPERSEDED_BY_NEWER' })
                  .eq('id', checkoutLink.id)
              }
            }
            break
          }
        }

        // Fonte da verdade pra plan/cycle, em ordem de confiabilidade:
        //  1. INTENÇÃO no externalReference — legado; o Asaas não persiste no hosted checkout,
        //     então quase sempre vazio. Mantido caso volte a funcionar / Caminho D via PUT.
        //  2. ASSINATURA PAGA (`paid`) — fonte determinística: valor cheio→plano (1:1) OU, em
        //     proration (valor prorateado), a DESCRIÇÃO da sub (plano-alvo). Desambigua
        //     concorrência e cobre renovações. (Pivô 2026-06-08 + fix proration Codex.)
        //  3. checkout record (linha casada) — só se a sub não resolver de jeito nenhum.
        //  4. detecção por valor do pagamento / metadados do Asaas — último recurso.
        const intent = parseExternalReference(payment?.externalReference)
        let plan: string
        let cycle: 'MONTHLY' | 'YEARLY'
        if (intent.plan && intent.cycle) {
          plan = intent.plan
          cycle = intent.cycle as 'MONTHLY' | 'YEARLY'
          log('[asaas-webhook] Using plan/cycle from externalReference intent (autoritativo)', { plan, cycle })
        } else if (paid) {
          plan = paid.plan
          cycle = paid.cycle
          log('[asaas-webhook] Using plan/cycle from paid subscription (valor cheio ou descrição/proration)', { plan, cycle, subValue })
        } else if (checkoutLink?.plan && checkoutLink?.cycle) {
          plan = checkoutLink.plan
          cycle = checkoutLink.cycle as 'MONTHLY' | 'YEARLY'
          log('[asaas-webhook] Using plan/cycle from checkout record (proration/fallback)', { plan, cycle })
        } else {
          const detected = detectPlanAndCycle(payment.value)
          if (detected) {
            plan = detected.plan
            cycle = detected.cycle
          } else if (payment?.subscription) {
            const fromAsaas = await resolvePlanFromAsaasSubscription(payment.subscription)
            if (!fromAsaas) {
              logError('[asaas-webhook] Unmapped payment value and no Asaas resolution, no plan activated', { value: payment.value, customerId, subscriptionId: payment.subscription })
              break
            }
            plan = fromAsaas.plan
            cycle = fromAsaas.cycle
            log('[asaas-webhook] Plan resolved from Asaas subscription metadata', { plan, cycle, subscriptionId: payment.subscription })
          } else {
            logError('[asaas-webhook] Unmapped payment value, no plan activated', { value: payment.value, customerId })
            break
          }
        }
        const planConfig = PLANS[plan as PlanName]
        const planExpiresAt = calculateExpiryDate(cycle)

        // GUARD de preço-cheio (Codex 2026-06-09): só ativa se PROVAR que o valor recorrente da sub
        // é o preço CHEIO. Se o value é prorateado (!= cheio) OU não foi possível ler (subValue
        // ausente), NÃO ativar — o Asaas prod bloqueia corrigir o valor recorrente → desconto
        // eterno. Conservador (igual polling/backstop): sem prova de valor cheio → alerta + DLQ.
        if (!isExpectedFullPrice(subValue, plan, cycle)) {
          // TRANSITÓRIO ≠ PRORATEADO (P1, audit 2026-06-09): se o valor NÃO foi lido (falha de
          // rede/5xx no getSubscription), isto NÃO é prova de proration — é falta de prova.
          // Lança → catch marca o evento 'failed' (DLQ) → o reprocessador relê a sub e ativa
          // se for preço cheio. Antes, o break marcava 'processed' e uma compra legítima com
          // um soluço de rede ficava paga-sem-ativar dependendo de ação manual.
          if (subReadFailed || subValue == null) {
            throw new Error(`GUARD preço-cheio: não foi possível LER o valor da sub ${payment.subscription} (transitório) — DLQ/retry`)
          }
          // Li o valor e ele NÃO é o preço cheio → prorateado de verdade → bloqueio manual
          // (o Asaas prod não deixa corrigir o valor recorrente → seria desconto eterno).
          logError('[asaas-webhook] GUARD preço-cheio: sub NÃO ativada (value prorateado, sem prova de preço cheio) — manual', undefined, { userId: user.id, subscriptionId: payment.subscription ?? null, subValue, plan, cycle })
          await sendBillingOpsAlert({ subject: 'Webhook: sub NÃO ativada (valor recorrente prorateado != cheio) — revisar manual', lines: { userId: user.id, subscriptionId: payment.subscription ?? null, subValue: subValue ?? null, plan, cycle } }).catch(() => {})
          await (supabase as unknown as { from: (t: string) => { upsert: (v: unknown, o: unknown) => Promise<unknown> } })
            .from('asaas_webhook_events')
            .upsert({ event_id: `prorated-blocked:${payment.subscription}`, event: 'PRORATED_BLOCKED', status: 'failed', error: `sub prorateada R$${subValue} != cheio (${plan}/${cycle}) — não ativada`, subscription_id: payment.subscription ?? null, customer_id: customerId, last_attempt_at: new Date().toISOString() }, { onConflict: 'event_id' }).catch(() => {})
          break
        }

        log('[asaas-webhook] Activating plan', { userId: user.id, plan, cycle, expiresAt: planExpiresAt })

        // Capture the subscription currently linked to the profile before replacing it.
        // This is the explicit "old subscription" signal needed to cancel same-day plan
        // changes, where Asaas dateCreated has day-level granularity and reconcile alone
        // intentionally treats same-day duplicates as ambiguous.
        // (P2-c) plan/status/cycle/expiry também: detectam re-entrega de evento p/ um
        // profile JÁ ativo na mesma sub (RECEIVED tardio da liquidação do cartão, ~D+32).
        const { data: previousProfile } = await supabase
          .from('profiles')
          .select('asaas_subscription_id, plan, plan_status, plan_cycle, plan_expires_at')
          .eq('id', user.id)
          .single()
        const previousSubId = previousProfile?.asaas_subscription_id ?? null

        // #7 (audit 2026-06-08): RE-CHECK "checkout mais recente vence" imediatamente antes de
        // ativar. Reduz a race entre eventos concorrentes: se um checkout MAIS NOVO já foi pago
        // (commitado) entre a 1ª checagem e aqui, este evento é o mais antigo → NÃO sobrescreve
        // o plano. O fluxo do checkout mais novo (que venceu) cuida da ativação e o reconcile
        // dele cancela esta sub órfã (mais antiga que a keep). Não há deadlock: só o evento mais
        // antigo encontra um "mais novo pago".
        if (checkoutLink?.profile_id && checkoutLink?.created_at) {
          const { data: newerPaid2 } = await supabase
            .from('billing_checkouts')
            .select('id')
            .eq('profile_id', checkoutLink.profile_id)
            .eq('status', 'paid')
            .gt('created_at', checkoutLink.created_at)
            .limit(1)
            .maybeSingle()
          if (newerPaid2) {
            log('[asaas-webhook] Re-check: checkout mais recente já venceu antes da ativação — pulando (o fluxo mais novo ativa e reconcilia)', {
              userId: user.id, eventCheckoutId: checkoutLink.id,
            })
            break
          }
        }

        // (P2-c, audit 2026-06-09) Profile JÁ ativo no MESMO plano+ciclo+sub: este evento é
        // re-entrega — ou a RENOVAÇÃO do ciclo (CONFIRMED da nova cobrança), ou o RECEIVED
        // TARDIO da liquidação do cartão (~D+32, pagamento do ciclo ANTERIOR). A renovação
        // DEVE resetar a cota (novo ciclo); o RECEIVED tardio NÃO pode zerar responses_used
        // no meio do ciclo vigente. Distinção pelo dueDate do pagamento: cobrança do período
        // CORRENTE tem dueDate > (expiração − 1 ciclo); pagamento do ciclo anterior fica
        // atrás dessa linha. Sem dueDate/expiry legíveis → assume renovação (comportamento
        // anterior, conservador p/ não quebrar a virada de ciclo).
        const alreadyActiveSamePlan =
          previousProfile?.plan === plan &&
          previousProfile?.plan_status === 'active' &&
          previousProfile?.plan_cycle === cycle &&
          previousSubId === payment.subscription
        let skipProfileUpdate = false
        if (alreadyActiveSamePlan) {
          const dueMs = payment.dueDate ? Date.parse(`${payment.dueDate}T00:00:00-03:00`) : NaN
          const expMs = previousProfile?.plan_expires_at ? Date.parse(previousProfile.plan_expires_at) : NaN
          const cycleMs = (cycle === 'YEARLY' ? 365 : 30) * 86_400_000
          const isCurrentPeriodPayment = Number.isNaN(dueMs) || Number.isNaN(expMs)
            ? true
            : dueMs > expMs - cycleMs
          skipProfileUpdate = !isCurrentPeriodPayment
          if (skipProfileUpdate) {
            log('[asaas-webhook] Re-entrega tardia p/ profile já ativo (mesma sub/plano/ciclo) — NÃO reseta cota nem mexe na expiração; segue p/ finalize', {
              userId: user.id, subscriptionId: payment.subscription, dueDate: payment.dueDate ?? null, planExpiresAt: previousProfile?.plan_expires_at ?? null,
            })
          }
        }

        if (!skipProfileUpdate) {
          const { data: activatedRows, error: activateError } = await supabase
            .from('profiles')
            .update({
              plan,
              plan_cycle: cycle,
              plan_status: 'active',
              plan_expires_at: planExpiresAt,
              limit_alert_sent: false,
              responses_limit: planConfig?.maxResponses ?? 100,
              responses_used: 0,
              asaas_customer_id: customerId,
              ...(payment.subscription ? { asaas_subscription_id: payment.subscription } : {}),
            })
            .eq('id', user.id)
            .select('id')

          // Se a ativação NÃO persistiu, abortar ANTES de cancelar sub antiga,
          // rodar handleUpgrade ou mandar e-mail. O throw cai no catch → evento
          // marcado 'failed' (DLQ) p/ reprocesso manual. Nunca confirmar venda fantasma.
          if (activateError || !activatedRows || activatedRows.length !== 1) {
            throw new Error(`Falha ao ativar plano no profile (rows=${activatedRows?.length ?? 0}): ${activateError?.message ?? 'sem erro DB'}`)
          }
        }

        const billingType = (body as unknown as Record<string, unknown>).billingType as string | undefined

        await updateCheckoutLink({
          customerId,
          subscriptionId: payment.subscription ?? null,
          // Linha JÁ resolvida pela intent — marca exatamente ela como paga (P1 round 4).
          checkoutLinkId: checkoutLink?.id ?? null,
          externalReference: payment?.externalReference ?? null,
          event,
          status: 'paid',
          billingType,
        })

        // Efeitos de ativação (e-mail + despause) reivindicados ATOMICAMENTE pela chave
        // effects:{sub}:{plan}:{cycle} (#1/#3/#4, audit 2026-06-08). O marker SUBSTITUI o
        // antigo isPlanTransition: a chave é IDÊNTICA numa renovação (mesma sub/plano/ciclo)
        // → já reivindicada no 1º pagamento → renovação pula; e numa transição (plano/ciclo/
        // sub novo) a chave é nova → reivindica e dispara. Garante e-mail+handleUpgrade UMA
        // vez entre CONFIRMED/RECEIVED e webhook×polling. E-mail ANTES do despause: se o
        // handleUpgrade lançar (forms não despausados) → DLQ → o reprocessador completa o
        // despause, e o e-mail (já enviado) não é reenviado.
        if (await claimActivationEffects(supabase, payment.subscription, plan, cycle)) {
          await sendPlanActivated({ to: user.email, name: user.full_name ?? 'usuário', plan }).catch((err) => logError('Failed to send plan activation email', err))
          const upgrade = await handleUpgrade(user.id, process.env.SUPABASE_SERVICE_ROLE_KEY!)
          log('[asaas-webhook] Upgrade processed', { userId: user.id, unpausedForms: upgrade.unpausedCount })
        } else {
          log('[asaas-webhook] Efeitos de ativação já reivindicados (renovação/duplicata/polling) — pulando', { userId: user.id, plan, cycle, subscriptionId: payment.subscription })
        }

        // Finaliza ativação: cancel-previous + reconcile + correção de valor recorrente.
        // MESMA rotina do polling e do reprocessador (helper compartilhado finalizeActivation),
        // eliminando a divergência que existia (P1-1/P1-2, audit Codex 2026-06-07).
        const fin = await finalizeActivation({
          db: supabase,
          userId: user.id,
          customerId: customerId ?? null,
          newSubscriptionId: payment.subscription ?? null,
          previousSubscriptionId: previousSubId,
          plan,
          cycle,
          source: 'webhook',
        })
        // Correção de valor recorrente necessária mas falhou → DLQ (throw → catch marca
        // 'failed' → reprocessador retenta). NUNCA deixar a renovação subcobrar em silêncio.
        if (fin.recurringValueNeeded && !fin.recurringValueFixed) {
          await sendBillingOpsAlert({
            subject: 'Correção de valor recorrente PENDENTE — risco de subcobrança na renovação (DLQ vai retentar)',
            lines: { userId: user.id, subscriptionId: payment.subscription, plan, cycle, customerId },
          }).catch(() => {})
          throw new Error(`Correção de valor recorrente pendente (sub ${payment.subscription}) — enviado p/ DLQ/retry`)
        }
        break
      }

      case 'PAYMENT_OVERDUE': {
        const customerId = payment?.customer
        if (!customerId) break

        const { user } = await resolveBillingContext({
          customerId,
          subscriptionId: payment?.subscription ?? null,
          externalReference: payment?.externalReference ?? null,
        })
        if (!user) {
          logWarn('[asaas-webhook] User not found for overdue payment context', {
            customerId,
            subscriptionId: payment?.subscription ?? null,
          })
          break
        }

        // Guard: compare payment.subscription with profile's active subscription BEFORE downgrade
        const overdueSubId = payment?.subscription ?? null
        const { data: overdueProfile } = await supabase
          .from('profiles')
          .select('asaas_subscription_id, plan')
          .eq('id', user.id)
          .single()

        if (overdueProfile?.plan === 'free') {
          log('[asaas-webhook] PAYMENT_OVERDUE ignored — user already on free plan', { userId: user.id, subscriptionId: overdueSubId })
          break
        }

        // Match ESTRITO (igual a DELETED/REFUND): só rebaixa se o evento TEM subscription
        // E ela é EXATAMENTE a assinatura ativa do profile. Sem subscription (overdueSubId
        // null) NÃO rebaixa por customer-fallback — um overdue antigo/ambíguo sem sub
        // derrubaria um usuário que já tem outra assinatura ativa (P1-3, audit Codex 2026-06-07).
        if (!overdueSubId || overdueProfile?.asaas_subscription_id !== overdueSubId) {
          log('[asaas-webhook] PAYMENT_OVERDUE ignorado — sem subscription ou não é a assinatura ativa do profile', {
            userId: user.id,
            eventSubscriptionId: overdueSubId,
            activeSubscriptionId: overdueProfile?.asaas_subscription_id ?? null,
          })
          break
        }

        log('[asaas-webhook] Payment overdue, reverting to free', { userId: user.id, customerId })

        const { data: overdueRows, error: overdueError } = await supabase
          .from('profiles')
          .update({
            plan: 'free',
            plan_status: 'overdue',
            plan_expires_at: null,
            limit_alert_sent: false,
            responses_limit: PLANS.free.maxResponses,
            responses_used: 0,
          })
          .eq('id', user.id)
          .select('id')

        if (overdueError || !overdueRows || overdueRows.length !== 1) {
          throw new Error(`Falha ao reverter plano (overdue) (rows=${overdueRows?.length ?? 0}): ${overdueError?.message ?? 'sem erro DB'}`)
        }

        await updateCheckoutLink({
          customerId,
          subscriptionId: payment?.subscription ?? null,
          externalReference: payment?.externalReference ?? null,
          event,
          status: 'overdue',
        })

        const downgrade = await handleDowngrade(user.id, process.env.SUPABASE_SERVICE_ROLE_KEY!)
        log('[asaas-webhook] Downgrade processed', { userId: user.id, pausedForms: downgrade.pausedCount })

        break
      }

      case 'SUBSCRIPTION_DELETED': {
        const customerId = subscription?.customer
        if (!customerId) break

        const { user } = await resolveBillingContext({
          customerId,
          subscriptionId: subscription?.id ?? null,
          externalReference: subscription?.externalReference ?? null,
        })
        if (!user) {
          logWarn('[asaas-webhook] User not found for deleted subscription context', {
            customerId,
            subscriptionId: subscription?.id ?? null,
          })
          break
        }

        // Guard: only apply downgrade if the deleted subscription is the profile's active one
        const deletedSubId = subscription?.id ?? null
        const { data: deletedProfile } = await supabase
          .from('profiles')
          .select('asaas_subscription_id, plan, plan_status, plan_expires_at')
          .eq('id', user.id)
          .single()

        if (deletedProfile?.plan === 'free') {
          log('[asaas-webhook] SUBSCRIPTION_DELETED ignored — user already on free plan', { userId: user.id, subscriptionId: deletedSubId })
          break
        }

        // Match ESTRITO: só reverte se a sub deletada for EXATAMENTE a assinatura ativa
        // do profile. Se o profile não tem sub (null) ou tem outra, é uma sub antiga/
        // fantasma (ex.: cancelada durante um upgrade) — derrubar aqui rebaixaria o
        // usuário por engano (bug do downgrade-fantasma).
        if (!deletedSubId || deletedProfile?.asaas_subscription_id !== deletedSubId) {
          log('[asaas-webhook] SUBSCRIPTION_DELETED ignorado — não é a assinatura ativa do profile', {
            userId: user.id,
            eventSubscriptionId: deletedSubId,
            activeSubscriptionId: deletedProfile?.asaas_subscription_id ?? null,
          })
          break
        }

        // Cancelamento iniciado pelo USUÁRIO (plan_status='canceling') com período ainda
        // vigente: mantém o acesso até plan_expires_at (promessa "até o fim do período").
        // Só desvincula a sub; a reversão p/ free acontece na expiração (lib/plan-features).
        // NÃO rebaixa nem pausa forms agora. (P1, audit Codex 2026-06-08.)
        if (
          deletedProfile?.plan_status === 'canceling' &&
          deletedProfile?.plan_expires_at &&
          new Date(deletedProfile.plan_expires_at).getTime() > Date.now()
        ) {
          const { error: softErr } = await supabase
            .from('profiles')
            .update({ asaas_subscription_id: null })
            .eq('id', user.id)
          if (softErr) logError('[asaas-webhook] SUBSCRIPTION_DELETED (canceling) — falha ao desvincular sub', softErr, { userId: user.id })
          await updateCheckoutLink({ customerId, subscriptionId: subscription?.id ?? null, externalReference: subscription?.externalReference ?? null, event, status: 'cancelled' })
          log('[asaas-webhook] SUBSCRIPTION_DELETED — cancelamento do usuário; acesso mantido até o fim do período', { userId: user.id, expiresAt: deletedProfile.plan_expires_at })
          await sendPlanCancelled({ to: user.email, name: user.full_name ?? 'usuário', plan: user.plan ?? 'starter' }).catch((err) => logError('Failed to send plan cancellation email', err))
          break
        }

        const oldPlan = user.plan ?? 'starter'

        log('[asaas-webhook] Subscription deleted, reverting to free', { userId: user.id, customerId })

        const { data: cancelledRows, error: cancelledError } = await supabase
          .from('profiles')
          .update({
            plan: 'free',
            plan_status: 'cancelled',
            plan_expires_at: null,
            asaas_subscription_id: null,
            limit_alert_sent: false,
            responses_limit: PLANS.free.maxResponses,
            responses_used: 0,
          })
          .eq('id', user.id)
          .select('id')

        if (cancelledError || !cancelledRows || cancelledRows.length !== 1) {
          throw new Error(`Falha ao reverter plano (cancelled) (rows=${cancelledRows?.length ?? 0}): ${cancelledError?.message ?? 'sem erro DB'}`)
        }

        await updateCheckoutLink({
          customerId,
          subscriptionId: subscription?.id ?? null,
          externalReference: subscription?.externalReference ?? null,
          event,
          status: 'cancelled',
        })

        const downgrade = await handleDowngrade(user.id, process.env.SUPABASE_SERVICE_ROLE_KEY!)
        log('[asaas-webhook] Downgrade processed', { userId: user.id, pausedForms: downgrade.pausedCount })

        await sendPlanCancelled({ to: user.email, name: user.full_name ?? 'usuário', plan: oldPlan }).catch((err) => logError('Failed to send plan cancellation email', err))
        break
      }

      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_DELETED':
      case 'PAYMENT_CHARGEBACK_REQUESTED':
      case 'PAYMENT_CHARGEBACK_DISPUTE':
      case 'SUBSCRIPTION_INACTIVATED': {
        const customerId = payment?.customer ?? subscription?.customer
        const subscriptionId = payment?.subscription ?? subscription?.id ?? null
        if (!customerId) break

        const { user } = await resolveBillingContext({
          customerId,
          subscriptionId,
          externalReference: payment?.externalReference ?? subscription?.externalReference ?? null,
        })
        if (!user) {
          logWarn('[asaas-webhook] User not found for refund/chargeback context', { customerId, subscriptionId, event })
          break
        }

        // Guard: only act if event is for the user's active subscription
        const { data: refundProfile } = await supabase
          .from('profiles')
          .select('asaas_subscription_id, plan')
          .eq('id', user.id)
          .single()

        if (refundProfile?.plan === 'free') {
          log('[asaas-webhook] Refund/chargeback ignored — user already on free', { userId: user.id, event })
          break
        }

        // Match ESTRITO: só age se o evento for da assinatura ATIVA do profile. Sub
        // antiga/fantasma (cancelada num upgrade — ex.: SUBSCRIPTION_INACTIVATED) ou
        // profile sem sub (null) → não derruba o usuário.
        if (!subscriptionId || refundProfile?.asaas_subscription_id !== subscriptionId) {
          log('[asaas-webhook] Refund/chargeback/inactivated ignorado — não é a assinatura ativa do profile', {
            userId: user.id,
            eventSubscriptionId: subscriptionId,
            activeSubscriptionId: refundProfile?.asaas_subscription_id ?? null,
            event,
          })
          break
        }

        // #6 (decisão Sidney 2026-06-08): REFUND/DELETE NÃO derruba acesso automaticamente —
        // não dá pra provar "refund TOTAL do pagamento vigente" pelo payload básico, e um
        // refund parcial não deveria cancelar a assinatura. Vai p/ ALERTA operacional + log
        // (revisão manual), mantendo o acesso. Já CHARGEBACK e SUBSCRIPTION_INACTIVATED
        // rebaixam imediatamente (match estrito acima protege contra sub fantasma).
        if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_DELETED') {
          logError('[asaas-webhook] REFUND/PAYMENT_DELETED — acesso MANTIDO; revisar manualmente (refund total → cancelar manual; parcial → manter)', undefined, {
            userId: user.id, subscriptionId, event, value: payment?.value ?? null,
          })
          const refundValueFmt = `R$${Number(payment?.value ?? 0).toFixed(2)}`
          await sendBillingOpsAlert({
            subject: `⚠️ Estorno de ${refundValueFmt} — a ASSINATURA CONTINUA ATIVA (cancele se o cliente está saindo)`,
            lines: {
              '🔴 ATENÇÃO': 'O estorno devolveu o dinheiro, mas NÃO cancelou a assinatura — ela vai COBRAR DE NOVO no próximo ciclo.',
              'AÇÃO se o cliente está SAINDO': 'Cancele a assinatura no painel Asaas (ou peça o cancelamento no app) para parar cobranças futuras.',
              'AÇÃO se foi CORTESIA (mês grátis)': 'Não faça nada — a assinatura segue ativa e o cliente continua.',
              cliente: user.email,
              plano: refundProfile?.plan ?? null,
              valorEstornado: refundValueFmt,
              assinatura: subscriptionId,
              evento: event,
              customerId,
            },
          }).catch(() => {})
          break
        }

        const newStatus = (event === 'PAYMENT_CHARGEBACK_REQUESTED' || event === 'PAYMENT_CHARGEBACK_DISPUTE') ? 'chargeback' : 'cancelled'
        const oldPlan = user.plan ?? 'starter'

        log('[asaas-webhook] Chargeback/inactivated — reverting to free', { userId: user.id, customerId, event, newStatus })

        const { data: refundRows, error: refundError } = await supabase
          .from('profiles')
          .update({
            plan: 'free',
            plan_status: newStatus,
            plan_expires_at: null,
            asaas_subscription_id: null,
            limit_alert_sent: false,
            responses_limit: PLANS.free.maxResponses,
            responses_used: 0,
          })
          .eq('id', user.id)
          .select('id')

        if (refundError || !refundRows || refundRows.length !== 1) {
          throw new Error(`Falha ao reverter plano (${newStatus}) (rows=${refundRows?.length ?? 0}): ${refundError?.message ?? 'sem erro DB'}`)
        }

        await updateCheckoutLink({
          customerId,
          subscriptionId,
          externalReference: payment?.externalReference ?? subscription?.externalReference ?? null,
          event,
          status: newStatus,
        })

        const downgrade = await handleDowngrade(user.id, process.env.SUPABASE_SERVICE_ROLE_KEY!)
        log('[asaas-webhook] Downgrade processed (chargeback/inactivated)', { userId: user.id, pausedForms: downgrade.pausedCount, event })

        await sendPlanCancelled({ to: user.email, name: user.full_name ?? 'usuário', plan: oldPlan })
          .catch((err) => logError('Failed to send chargeback/inactivation notification email', err))
        break
      }

      case 'PAYMENT_UPDATED':
        // Informational — Asaas notifies value/dueDate changes. No action required.
        log('[asaas-webhook] PAYMENT_UPDATED received (informational)', { eventId })
        break

      default:
        logWarn('[asaas-webhook] Unknown event type — ignoring', { event })
        break
    }
  } catch (err) {
    // Retornamos 200 (não 500) intencionalmente: o evento já passou idempotency e
    // foi gravado em asaas_webhook_events. Retornar 5xx fazia o Asaas retentar o
    // evento dezenas/centenas de vezes, gerando retry storm (consumiu 30k requisições
    // do sandbox em 05-11/05/2026 quando um payment OVERDUE ficou em loop).
    // Erros de processamento são logados via logWebhookEvent pra reprocessamento manual,
    // mas a entrega é confirmada pro Asaas. Falhas de infra de pré-processamento
    // (idempotencyResult === 'error') seguem retornando 503 ANTES desse catch.
    logError('[asaas-webhook] Erro ao processar (retornando 200 pra evitar retry storm):', err)
    await logWebhookEvent({
      event,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })

    // DLQ: marca o evento como 'failed' para reprocesso manual (endpoint admin).
    // NÃO guarda payload (evita PII) — o reprocessador reconcilia contra o Asaas
    // usando customer_id/subscription_id. Mantém 200 (anti retry-storm); a
    // recuperação é interna, não depende de retry do Asaas.
    try {
      await supabase
        .from('asaas_webhook_events')
        .update({
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          attempts: 1,
          customer_id: payment?.customer ?? subscription?.customer ?? null,
          subscription_id: payment?.subscription ?? subscription?.id ?? null,
          last_attempt_at: new Date().toISOString(),
        })
        .eq('event_id', eventId)
    } catch (markErr) {
      logError('[asaas-webhook] Falha ao marcar evento como failed (DLQ)', markErr, { eventId })
    }

    return NextResponse.json({ received: true, processed: false, error: 'Logged for manual reprocess' })
  }

  // Promove o registro de idempotência 'received' → 'processed' (só o desta rota; o filtro
  // por status evita clobber de markers/locks e do 'failed' setado no catch). Best-effort:
  // se falhar, o evento fica como received-órfão (visível), nunca como falso-processed.
  try {
    await supabase
      .from('asaas_webhook_events')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('event_id', eventId)
      .eq('status', 'received')
  } catch { /* best-effort */ }

  await logWebhookEvent({ event, status: 'processed' })
  return NextResponse.json({ received: true })
}
