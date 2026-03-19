/**
 * app/api/webhooks/asaas/route.ts — Webhooks do Asaas
 * Eventos: PAYMENT_CONFIRMED, PAYMENT_OVERDUE, SUBSCRIPTION_DELETED
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPlanActivated, sendPlanCancelled } from '@/lib/resend'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Mapa de valor de assinatura → nome do plano
const VALUE_TO_PLAN: Record<number, string> = {
  49: 'starter',
  127: 'plus',
  257: 'professional',
  470.4: 'starter',   // yearly
  1219.2: 'plus',
  2467.2: 'professional',
}

function detectPlan(value: number): string {
  return VALUE_TO_PLAN[value] ?? 'starter'
}

async function getUserByCustomerId(asaasCustomerId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name, plan')
    .eq('asaas_customer_id', asaasCustomerId)
    .single()
  return data
}

export async function POST(req: NextRequest) {
  // Validação do token Asaas
  // Asaas pode enviar o token via header 'asaas-access-token' ou query param 'accessToken'
  const headerToken = req.headers.get('asaas-access-token')
  const url = new URL(req.url)
  const queryToken = url.searchParams.get('accessToken')
  const token = headerToken || queryToken

  if (process.env.ASAAS_WEBHOOK_TOKEN && token !== process.env.ASAAS_WEBHOOK_TOKEN) {
    console.warn('[asaas-webhook] Token mismatch. Header:', headerToken, 'Query:', queryToken)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { event, payment, subscription } = body

  console.log('[asaas-webhook]', event, body)

  try {
    switch (event) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED': {
        // Ativar/renovar plano
        const customerId = payment?.customer
        if (!customerId) break

        const user = await getUserByCustomerId(customerId)
        if (!user) break

        const plan = detectPlan(payment.value)

        await supabase
          .from('profiles')
          .update({
            plan,
            plan_status: 'active',
            plan_expires_at: null, // renovação contínua
            limit_alert_sent: false, // reset alerta
            asaas_subscription_id: payment.subscription ?? user.plan,
          })
          .eq('id', user.id)

        await sendPlanActivated({ to: user.email, name: user.full_name ?? 'usuário', plan }).catch(console.error)
        break
      }

      case 'PAYMENT_OVERDUE': {
        // Downgrade warning — não muda plano ainda, apenas flag
        const customerId = payment?.customer
        if (!customerId) break

        await supabase
          .from('profiles')
          .update({ plan_status: 'overdue' })
          .eq('asaas_customer_id', customerId)
        break
      }

      case 'SUBSCRIPTION_DELETED': {
        // Voltar para Free
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
          })
          .eq('id', user.id)

        await sendPlanCancelled({ to: user.email, name: user.full_name ?? 'usuário', plan: oldPlan }).catch(console.error)
        break
      }

      default:
        // Evento não tratado — retorna 200 assim mesmo
        break
    }
  } catch (err) {
    console.error('[asaas-webhook] Erro ao processar evento:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
