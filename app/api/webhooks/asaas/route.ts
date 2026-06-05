/**
 * app/api/webhooks/asaas/route.ts — Webhooks do Asaas
 * Eventos: PAYMENT_CONFIRMED, PAYMENT_OVERDUE, SUBSCRIPTION_DELETED
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPlanActivated, sendPlanCancelled } from '@/lib/resend'
import { PLANS, PlanName, handleDowngrade, handleUpgrade } from '@/lib/plan-limits'
import { PLAN_PRICES, reconcileActiveSubscriptions, getSubscription } from '@/lib/asaas'
import { logError, logWarn, log } from '@/lib/logger'
import { verifyAsaasSignature, verifyAsaasAccessToken } from '@/lib/webhook-hmac'
import { logWebhookEvent } from '@/lib/webhook-logger'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
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
}) {
  const supabase = getSupabase()
  const { customerId, subscriptionId } = params

  let checkoutLink: ResolvedCheckoutLink | null = null

  if (subscriptionId) {
    const { data } = await supabase
      .from('billing_checkouts')
      .select('id, profile_id, plan, cycle, checkout_id, asaas_customer_id, asaas_subscription_id, status, created_at')
      .eq('asaas_subscription_id', subscriptionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) checkoutLink = data as ResolvedCheckoutLink
  }

  if (!checkoutLink && customerId) {
    const { data } = await supabase
      .from('billing_checkouts')
      .select('id, profile_id, plan, cycle, checkout_id, asaas_customer_id, asaas_subscription_id, status, created_at')
      .eq('asaas_customer_id', customerId)
      .or(subscriptionId ? `asaas_subscription_id.eq.${subscriptionId},asaas_subscription_id.is.null` : 'asaas_subscription_id.is.null')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) checkoutLink = data as ResolvedCheckoutLink
  }

  let user: ResolvedUser | null = null

  if (checkoutLink?.profile_id) {
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
  event: string
  status: string
  billingType?: string
}) {
  const supabase = getSupabase()
  const { customerId, subscriptionId, event, status, billingType } = params
  const { checkoutLink } = await resolveBillingContext({ customerId, subscriptionId })

  if (!checkoutLink) {
    logWarn('[asaas-webhook] Checkout link not found for update', { customerId, subscriptionId, event, status })
    return
  }

  const { error: ckUpdateError } = await supabase
    .from('billing_checkouts')
    .update({
      asaas_customer_id: customerId ?? checkoutLink.asaas_customer_id,
      asaas_subscription_id: subscriptionId ?? checkoutLink.asaas_subscription_id,
      status,
      last_event: event,
      ...(billingType ? { payment_method: billingType } : {}),
    })
    .eq('id', checkoutLink.id)

  // Não-bloqueante: billing_checkouts é bookkeeping secundário. O estado de verdade
  // do plano é o profile (já checado com throw nos handlers). Só logar.
  if (ckUpdateError) {
    logError('[asaas-webhook] Falha ao atualizar billing_checkouts (não-bloqueante)', ckUpdateError, { checkoutId: checkoutLink.id, event, status })
  }
}

interface AsaasPayment {
  customer?: string
  value: number
  subscription?: string
}

interface AsaasSubscription {
  customer?: string
  id?: string
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

  if (!webhookToken) {
    // Critical config issue, but respond 401 (not 500) so Asaas does not enter
    // an exponential retry storm against an endpoint that will never succeed.
    logError('[asaas-webhook] ASAAS_WEBHOOK_SECRET or ASAAS_WEBHOOK_TOKEN not configured')
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: AsaasWebhookBody
  try {
    body = JSON.parse(rawBody) as AsaasWebhookBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { event, payment, subscription } = body

  // Idempotency: use body.id if present, else hash of (event + customerId + subscriptionId)
  const eventId = body.id ?? `${event}:${payment?.customer ?? subscription?.customer ?? ''}:${payment?.subscription ?? subscription?.id ?? ''}`

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

        const { user, checkoutLink } = await resolveBillingContext({
          customerId,
          subscriptionId: payment?.subscription ?? null,
        })
        if (!user) {
          logWarn('[asaas-webhook] User not found for payment context', {
            customerId,
            subscriptionId: payment?.subscription ?? null,
          })
          break
        }

        // Prefer plan/cycle from checkout record (handles prorated values)
        let plan: string
        let cycle: 'MONTHLY' | 'YEARLY'
        if (checkoutLink?.plan && checkoutLink?.cycle) {
          plan = checkoutLink.plan
          cycle = checkoutLink.cycle as 'MONTHLY' | 'YEARLY'
          log('[asaas-webhook] Using plan/cycle from checkout record', { plan, cycle })
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

        log('[asaas-webhook] Activating plan', { userId: user.id, plan, cycle, expiresAt: planExpiresAt })

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
            asaas_subscription_id: payment.subscription ?? null,
          })
          .eq('id', user.id)
          .select('id')

        // Se a ativação NÃO persistiu, abortar ANTES de cancelar sub antiga,
        // rodar handleUpgrade ou mandar e-mail. O throw cai no catch → evento
        // marcado 'failed' (DLQ) p/ reprocesso manual. Nunca confirmar venda fantasma.
        if (activateError || !activatedRows || activatedRows.length !== 1) {
          throw new Error(`Falha ao ativar plano no profile (rows=${activatedRows?.length ?? 0}): ${activateError?.message ?? 'sem erro DB'}`)
        }

        const billingType = (body as unknown as Record<string, unknown>).billingType as string | undefined

        await updateCheckoutLink({
          customerId,
          subscriptionId: payment.subscription ?? null,
          event,
          status: 'paid',
          billingType,
        })

        // Reconciliar: garante no máximo 1 assinatura ACTIVE por cliente (cancela as
        // órfãs ≠ a nova). Subsume o cancel único antigo. Roda APÓS o profile ter sido
        // persistido com a nova sub (o throw acima garante). Não-bloqueante.
        const recon = await reconcileActiveSubscriptions(customerId, payment.subscription ?? null)
        if (recon.cancelled.length) {
          log('[asaas-webhook] Assinaturas órfãs canceladas (reconcile)', { userId: user.id, kept: recon.kept, cancelled: recon.cancelled })
        }

        const upgrade = await handleUpgrade(user.id, process.env.SUPABASE_SERVICE_ROLE_KEY!)
        log('[asaas-webhook] Upgrade processed', { userId: user.id, unpausedForms: upgrade.unpausedCount })

        await sendPlanActivated({ to: user.email, name: user.full_name ?? 'usuário', plan }).catch((err) => logError('Failed to send plan activation email', err))
        break
      }

      case 'PAYMENT_OVERDUE': {
        const customerId = payment?.customer
        if (!customerId) break

        const { user } = await resolveBillingContext({
          customerId,
          subscriptionId: payment?.subscription ?? null,
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

        if (overdueSubId && overdueProfile?.asaas_subscription_id && overdueSubId !== overdueProfile.asaas_subscription_id) {
          log('[asaas-webhook] PAYMENT_OVERDUE ignored — subscription mismatch (old/ghost subscription)', {
            userId: user.id,
            eventSubscriptionId: overdueSubId,
            activeSubscriptionId: overdueProfile.asaas_subscription_id,
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
          .select('asaas_subscription_id, plan')
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

        const { user } = await resolveBillingContext({ customerId, subscriptionId })
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

        const newStatus = event === 'PAYMENT_CHARGEBACK_REQUESTED' || event === 'PAYMENT_CHARGEBACK_DISPUTE' ? 'chargeback' : 'refunded'
        const oldPlan = user.plan ?? 'starter'

        log('[asaas-webhook] Refund/chargeback — reverting to free', { userId: user.id, customerId, event, newStatus })

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
          event,
          status: newStatus,
        })

        const downgrade = await handleDowngrade(user.id, process.env.SUPABASE_SERVICE_ROLE_KEY!)
        log('[asaas-webhook] Downgrade processed (refund/chargeback)', { userId: user.id, pausedForms: downgrade.pausedCount, event })

        await sendPlanCancelled({ to: user.email, name: user.full_name ?? 'usuário', plan: oldPlan })
          .catch((err) => logError('Failed to send refund/chargeback notification email', err))
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

  await logWebhookEvent({ event, status: 'processed' })
  return NextResponse.json({ received: true })
}
