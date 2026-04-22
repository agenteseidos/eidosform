/**
 * POST /api/checkout/[plan]?cycle=monthly|yearly
 * Inicia checkout real via Asaas: cria/reutiliza customer + assinatura.
 * Retorna paymentUrl (PIX/boleto) da Asaas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCustomer, createCheckout, cancelSubscription, PLAN_PRICES, type BillingCycle } from '@/lib/asaas'
import { PLAN_ORDER, type PlanId } from '@/lib/plans'
import { log, logError } from '@/lib/logger'

const VALID_PLANS = new Set<string>(PLAN_ORDER.filter((p) => p !== 'free'))
const VALID_CYCLES = new Set<string>(['MONTHLY', 'YEARLY'])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ plan: string }> }
) {
  const { plan } = await params
  const cycle = ((req.nextUrl.searchParams.get('cycle') ?? 'monthly').toUpperCase()) as BillingCycle
  try { await req.json() } catch { /* no body needed */ }

  if (!VALID_PLANS.has(plan)) {
    return NextResponse.json({ error: 'Plano inválido' }, { status: 400 })
  }
  if (!VALID_CYCLES.has(cycle)) {
    return NextResponse.json({ error: 'Ciclo inválido' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, asaas_customer_id, asaas_subscription_id, plan')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 })
  }

  if (!profile.email) {
    return NextResponse.json({ error: 'Email obrigatório para o checkout' }, { status: 400 })
  }

  // Se já tem assinatura ativa no plano escolhido, retorna info
  if (profile.asaas_subscription_id && profile.plan === plan) {
    return NextResponse.json({
      message: 'Você já possui este plano ativo',
      alreadySubscribed: true,
    })
  }

  try {
    // Cria ou reutiliza customer no Asaas
    let asaasCustomerId = profile.asaas_customer_id
    if (!asaasCustomerId) {
      log('[checkout] Criando customer Asaas', { email: profile.email })
      const customer = await createCustomer({
        name: profile.full_name ?? profile.email.split('@')[0],
        email: profile.email,
        cpfCnpj: undefined,
      })
      asaasCustomerId = customer.id

      await supabase
        .from('profiles')
        .update({ asaas_customer_id: asaasCustomerId })
        .eq('id', profile.id)
    }



    // Cancela assinatura anterior se existir
    if (profile.asaas_subscription_id && profile.plan !== plan) {
      try {
        const { cancelSubscription } = await import('@/lib/asaas')
        await cancelSubscription(profile.asaas_subscription_id)
        log('[checkout] Assinatura anterior cancelada', { oldSubscriptionId: profile.asaas_subscription_id })
        await supabase
          .from('profiles')
          .update({ asaas_subscription_id: null })
          .eq('id', profile.id)
      } catch (err) {
        logError('[checkout] Falha ao cancelar assinatura anterior', err)
        // Não bloqueia — continua criando a nova
      }
    }

    // Cria checkout hospedado do Asaas
    const price = cycle === 'MONTHLY'
      ? PLAN_PRICES[plan as keyof typeof PLAN_PRICES].monthly
      : PLAN_PRICES[plan as keyof typeof PLAN_PRICES].yearly
    const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? ''
    const successUrl = `${origin}/billing?checkout=success`
    log('[checkout] Criando checkout hospedado', { plan, cycle, value: price, customerId: asaasCustomerId })
    const checkout = await createCheckout({
      customerId: asaasCustomerId,
      plan: plan as Exclude<PlanId, 'free'>,
      cycle,
      successUrl,
    })
    log('[checkout] Checkout hospedado criado', { plan, cycle, value: price, flow: 'checkout', checkoutId: checkout.id })

    return NextResponse.json({
      checkoutId: checkout.id,
      checkoutUrl: checkout.url,
      plan,
      cycle,
      value: price,
    })
  } catch (err) {
    logError('[checkout] Erro ao processar checkout', err)
    const message = err instanceof Error ? err.message : 'Erro interno ao processar checkout'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
