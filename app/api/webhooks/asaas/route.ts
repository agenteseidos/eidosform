/**
 * app/api/webhooks/asaas/route.ts — Webhooks do Asaas
 * Eventos: PAYMENT_CONFIRMED, PAYMENT_OVERDUE, SUBSCRIPTION_DELETED
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPlanActivated, sendPlanCancelled } from '@/lib/resend'
import { PLANS, PlanName, handleDowngrade, handleUpgrade } from '@/lib/plan-limits'
import { PLAN_PRICES, cancelSubscription } from '@/lib/asaas'
import { logError, logWarn, log } from '@/lib/logger'
import { verifyAsaasSignature } from '@/lib/webhook-hmac'
import { logWebhookEvent } from '@/lib/webhook-logger'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function detectPlanAndCycle(value: number): { plan: string; cycle: 'MONTHLY' | 'YEARLY' } {
  for (const [plan, prices] of Object.entries(PLAN_PRICES)) {
    if (value === prices.yearly) return { plan, cycle: 'YEARLY' }
    if (value === prices.monthly) return { plan, cycle: 'MONTHLY' }
  }

  // P1-J: No heuristic fallback — if value doesn't match any known plan price,
  // default to starter instead of guessing from description (fragile/unreliable)
  logWarn('[asaas-webhook] Unmapped payment value, defaulting to starter', { value })
  return { plan: 'starter', cycle: 'MONTHLY' }
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

  await supabase
    .from('billing_checkouts')
    .update({
      asaas_customer_id: customerId ?? checkoutLink.asaas_customer_id,
      asaas_subscription_id: subscriptionId ?? checkoutLink.asaas_subscription_id,
      status,
      last_event: event,
      ...(billingType ? { payment_method: billingType } : {}),
    })
    .eq('id', checkoutLink.id)
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
  event: string
  payment?: AsaasPayment
  subscription?: AsaasSubscription
}

export async function POST(req: NextRequest) {
  // Read raw body text first (needed for HMAC verification)
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Failed to read body' }, { status: 400 })
  }

  // P2-C: Only accept token via header (asaas-access-token or access_token), not query param
  const webhookToken = (process.env.ASAAS_WEBHOOK_SECRET ?? process.env.ASAAS_WEBHOOK_TOKEN)?.trim()
  const accessTokenHeader = req.headers.get('asaas-access-token') ?? req.headers.get('access_token')
  const hmacHeader = req.headers.get('asaas-signature')

  if (!webhookToken) {
    logError('[asaas-webhook] ASAAS_WEBHOOK_SECRET or ASAAS_WEBHOOK_TOKEN not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const tokenMatch = accessTokenHeader === webhookToken
  const hmacMatch = !!(hmacHeader && verifyAsaasSignature(rawBody, hmacHeader, webhookToken))

  if (!tokenMatch && !hmacMatch) {
    logWarn('[asaas-webhook] Auth failed', {
      hasHeader: !!accessTokenHeader,
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
  const supabase = getSupabase()

  log('[asaas-webhook] Event received', { event })
  await logWebhookEvent({ event, status: 'received', payload: body })

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
          const detected = detectPlanAndCycle(
            payment.value
          )
          plan = detected.plan
          cycle = detected.cycle
        }
        const planConfig = PLANS[plan as PlanName]
        const planExpiresAt = calculateExpiryDate(cycle)

        log('[asaas-webhook] Activating plan', { userId: user.id, plan, cycle, expiresAt: planExpiresAt })

        await supabase
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

        const billingType = (body as unknown as Record<string, unknown>).billingType as string | undefined

        await updateCheckoutLink({
          customerId,
          subscriptionId: payment.subscription ?? null,
          event,
          status: 'paid',
          billingType,
        })

        // Cancel old subscription if user had a different one (upgrade scenario)
        // The new subscription is already confirmed, so it's safe to cancel the old one.
        try {
          const { data: existingProfile } = await supabase
            .from('profiles')
            .select('asaas_subscription_id, plan')
            .eq('id', user.id)
            .single()

          const oldSubId = existingProfile?.asaas_subscription_id
          if (oldSubId && oldSubId !== payment.subscription && existingProfile?.plan !== 'free') {
            await cancelSubscription(oldSubId)
            log('[asaas-webhook] Old subscription cancelled after upgrade confirmation', { oldSubscriptionId: oldSubId, newSubscriptionId: payment.subscription })
          }
        } catch (err) {
          logError('[asaas-webhook] Failed to cancel old subscription (non-blocking)', err)
        }

        const upgrade = await handleUpgrade(user.id, process.env.SUPABASE_SERVICE_ROLE_KEY!)
        log('[asaas-webhook] Upgrade processed', { userId: user.id, unpausedForms: upgrade.unpausedCount })

        await sendPlanActivated({ to: user.email, name: user.full_name ?? 'usuário', plan }).catch((err) => logError('Failed to send plan activation email', err))
        break
      }

      case 'PAYMENT_OVERDUE': {
        const customerId = payment?.customer
        if (!customerId) break

        const { user, checkoutLink } = await resolveBillingContext({
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

        // Guard: only apply downgrade if the event belongs to the profile's active subscription
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

        await supabase
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

        if (deletedSubId && deletedProfile?.asaas_subscription_id && deletedSubId !== deletedProfile.asaas_subscription_id) {
          log('[asaas-webhook] SUBSCRIPTION_DELETED ignored — subscription mismatch (old/ghost subscription)', {
            userId: user.id,
            eventSubscriptionId: deletedSubId,
            activeSubscriptionId: deletedProfile.asaas_subscription_id,
          })
          break
        }

        const oldPlan = user.plan ?? 'starter'

        log('[asaas-webhook] Subscription deleted, reverting to free', { userId: user.id, customerId })

        await supabase
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

      default:
        break
    }
  } catch (err) {
    logError('[asaas-webhook] Erro ao processar evento:', err)
    await logWebhookEvent({
      event,
      status: 'error',
      payload: body,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  await logWebhookEvent({ event, status: 'processed', payload: body })
  return NextResponse.json({ received: true })
}
