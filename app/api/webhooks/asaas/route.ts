/**
 * app/api/webhooks/asaas/route.ts — Webhooks do Asaas
 * Eventos: PAYMENT_CONFIRMED, PAYMENT_OVERDUE, SUBSCRIPTION_DELETED
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPlanActivated, sendPlanCancelled } from '@/lib/resend'
import { PLANS, PlanName, handleDowngrade, handleUpgrade } from '@/lib/plan-limits'
import { PLAN_PRICES } from '@/lib/asaas'
import { logError, logWarn, log } from '@/lib/logger'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Detecta plano E ciclo a partir do valor pago
function detectPlanAndCycle(value: number, description?: string): { plan: string; cycle: 'MONTHLY' | 'YEARLY' } {
  for (const [plan, prices] of Object.entries(PLAN_PRICES)) {
    if (value === prices.yearly) return { plan, cycle: 'YEARLY' }
    if (value === prices.monthly) return { plan, cycle: 'MONTHLY' }
  }

  // Fallback: inferir pela descrição do pagamento
  logWarn('[asaas-webhook] Unmapped payment value', { value, description })
  const desc = (description ?? '').toLowerCase()
  let plan = 'starter'
  if (desc.includes('professional') || desc.includes('profissional')) plan = 'professional'
  else if (desc.includes('plus')) plan = 'plus'

  // Assume mensal como fallback
  return { plan, cycle: 'MONTHLY' }
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

async function getUserByCustomerId(asaasCustomerId: string) {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name, plan')
    .eq('asaas_customer_id', asaasCustomerId)
    .single()
  return data
}

interface AsaasPayment {
  customer?: string
  value: number
  subscription?: string
}

interface AsaasSubscription {
  customer?: string
}

interface AsaasWebhookBody {
  event: string
  payment?: AsaasPayment
  subscription?: AsaasSubscription
}

export async function POST(req: NextRequest) {
  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN
  if (!expectedToken) {
    logError('[asaas-webhook] ASAAS_WEBHOOK_TOKEN not configured — rejecting all requests')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const headerToken = req.headers.get('asaas-access-token')
  const url = new URL(req.url)
  const queryToken = url.searchParams.get('accessToken')
  const token = headerToken || queryToken

  if (!token || token !== expectedToken) {
    logWarn('[asaas-webhook] Token mismatch')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: AsaasWebhookBody
  try {
    body = await req.json() as AsaasWebhookBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { event, payment, subscription } = body
  const supabase = getSupabase()

  log('[asaas-webhook] Event received', { event })

  try {
    switch (event) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED': {
        const customerId = payment?.customer
        if (!customerId) break

        const user = await getUserByCustomerId(customerId)
        if (!user) {
          logWarn('[asaas-webhook] User not found for customer', { customerId })
          break
        }

        const { plan, cycle } = detectPlanAndCycle(
          payment.value,
          (body as unknown as Record<string, unknown>).description as string | undefined
        )
        const planConfig = PLANS[plan as PlanName]
        const planExpiresAt = calculateExpiryDate(cycle)

        log('[asaas-webhook] Activating plan', { userId: user.id, plan, cycle, expiresAt: planExpiresAt })

        await supabase
          .from('profiles')
          .update({
            plan,
            plan_status: 'active',
            plan_expires_at: planExpiresAt,
            limit_alert_sent: false,
            responses_limit: planConfig?.maxResponses ?? 100,
            responses_used: 0,
            asaas_subscription_id: payment.subscription ?? null,
          })
          .eq('id', user.id)

        // Unpause all forms on upgrade
        const upgrade = await handleUpgrade(user.id)
        log('[asaas-webhook] Upgrade processed', { userId: user.id, unpausedForms: upgrade.unpausedCount })

        await sendPlanActivated({ to: user.email, name: user.full_name ?? 'usuário', plan }).catch((err) => logError('Failed to send plan activation email', err))
        break
      }

      case 'PAYMENT_OVERDUE': {
        const customerId = payment?.customer
        if (!customerId) break

        const user = await getUserByCustomerId(customerId)
        if (!user) break

        log('[asaas-webhook] Payment overdue — reverting to free', { userId: user.id, customerId })

        // Reverter para free e resetar limits
        await supabase
          .from('profiles')
          .update({
            plan: 'free',
            plan_status: 'overdue',
            limit_alert_sent: false,
            responses_limit: PLANS.free.maxResponses,
          })
          .eq('id', user.id)

        // Pause forms above free limit
        const downgrade = await handleDowngrade(user.id, process.env.SUPABASE_SERVICE_ROLE_KEY!)
        log('[asaas-webhook] Downgrade processed', { userId: user.id, pausedForms: downgrade.pausedCount })

        break
      }

      case 'SUBSCRIPTION_DELETED': {
        const customerId = subscription?.customer
        if (!customerId) break

        const user = await getUserByCustomerId(customerId)
        if (!user) break

        const oldPlan = user.plan ?? 'starter'

        log('[asaas-webhook] Subscription deleted — reverting to free', { userId: user.id, customerId })

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

        // Pause forms above free limit
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
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
