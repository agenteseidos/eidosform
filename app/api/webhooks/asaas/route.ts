/**
 * app/api/webhooks/asaas/route.ts — Webhooks do Asaas
 * Eventos: PAYMENT_CONFIRMED, PAYMENT_OVERDUE, SUBSCRIPTION_DELETED
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPlanActivated, sendPlanCancelled } from '@/lib/resend'
import { PLANS, PlanName } from '@/lib/plan-limits'
import { logError, logWarn, log } from '@/lib/logger'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const VALUE_TO_PLAN: Record<number, string> = {
  49: 'starter',
  127: 'plus',
  257: 'professional',
  470.4: 'starter',      // R$39,20/mês × 12
  1219.2: 'plus',         // R$101,60/mês × 12
  2467.2: 'professional', // R$205,60/mês × 12
}

function detectPlan(value: number): string {
  return VALUE_TO_PLAN[value] ?? 'starter'
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
        if (!user) break

        const plan = detectPlan(payment.value)
        const planConfig = PLANS[plan as PlanName]

        await supabase
          .from('profiles')
          .update({
            plan,
            plan_status: 'active',
            plan_expires_at: null,
            limit_alert_sent: false,
            responses_limit: planConfig?.maxResponses ?? 100,
            responses_used: 0,
            asaas_subscription_id: payment.subscription ?? user.plan,
          })
          .eq('id', user.id)

        await sendPlanActivated({ to: user.email, name: user.full_name ?? 'usuário', plan }).catch((err) => logError('Failed to send plan activation email', err))
        break
      }

      case 'PAYMENT_OVERDUE': {
        const customerId = payment?.customer
        if (!customerId) break

        await supabase
          .from('profiles')
          .update({ plan_status: 'overdue' })
          .eq('asaas_customer_id', customerId)
        break
      }

      case 'SUBSCRIPTION_DELETED': {
        const customerId = subscription?.customer
        if (!customerId) break

        const user = await getUserByCustomerId(customerId)
        if (!user) break

        const oldPlan = user.plan ?? 'starter'

        await supabase
          .from('profiles')
          .update({
            plan: 'free',
            plan_status: 'cancelled',
            asaas_subscription_id: null,
            limit_alert_sent: false,
            responses_limit: PLANS.free.maxResponses,
            responses_used: 0,
          })
          .eq('id', user.id)

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
