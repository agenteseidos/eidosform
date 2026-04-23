/**
 * POST /api/checkout/[plan]?cycle=monthly|yearly
 * Inicia checkout hospedado do Asaas.
 * Cria/obtém customer e salva asaas_customer_id no profile.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCheckout, createCustomer, cancelSubscription, updateCustomer, PLAN_PRICES, type BillingCycle } from '@/lib/asaas'
import { BILLING_FIELD_LABELS, getBillingProfileForUser, getMissingBillingFields, toAsaasCustomerPayload } from '@/lib/billing-profile'
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

  const profile = await getBillingProfileForUser(user.id, user.email)

  if (!profile) {
    return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 })
  }

  if (!profile.email) {
    return NextResponse.json({ error: 'Email obrigatório para o checkout' }, { status: 400 })
  }

  const missingFields = getMissingBillingFields(profile)
  if (missingFields.length > 0) {
    return NextResponse.json({
      error: 'Complete seus dados de cobrança antes de continuar.',
      code: 'MISSING_BILLING_FIELDS',
      missingFields,
      missingFieldLabels: missingFields.map((field) => BILLING_FIELD_LABELS[field]),
      settingsUrl: '/settings',
    }, { status: 400 })
  }

  // Se já tem assinatura ativa no plano escolhido, retorna info
  if (profile.asaasSubscriptionId && profile.plan === plan) {
    return NextResponse.json({
      message: 'Você já possui este plano ativo',
      alreadySubscribed: true,
    })
  }

  try {
    // Cancela assinatura anterior se existir
    if (profile.asaasSubscriptionId && profile.plan !== plan) {
      try {
        await cancelSubscription(profile.asaasSubscriptionId)
        log('[checkout] Assinatura anterior cancelada', { oldSubscriptionId: profile.asaasSubscriptionId })
        await supabase
          .from('profiles')
          .update({ asaas_subscription_id: null })
          .eq('id', profile.profileId)
      } catch (err) {
        logError('[checkout] Falha ao cancelar assinatura anterior', err)
        // Não bloqueia, continua criando a nova
      }
    }

    // Criar ou obter customer no Asaas sempre alinhado ao perfil logado
    let customerId = profile.asaasCustomerId
    if (!customerId) {
      log('[checkout] Criando customer no Asaas', { email: profile.email, profileId: profile.profileId })
      const customer = await createCustomer(toAsaasCustomerPayload(profile))
      customerId = customer.id

      await supabase
        .from('profiles')
        .update({ asaas_customer_id: customerId })
        .eq('id', profile.profileId)

      log('[checkout] asaas_customer_id salvo no profile', { userId: profile.profileId, customerId })
    } else {
      await updateCustomer(customerId, toAsaasCustomerPayload(profile))
      log('[checkout] Customer do Asaas atualizado a partir da conta logada', { userId: profile.profileId, customerId })
    }

    const price = cycle === 'MONTHLY'
      ? PLAN_PRICES[plan as keyof typeof PLAN_PRICES].monthly
      : PLAN_PRICES[plan as keyof typeof PLAN_PRICES].yearly
    const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? ''
    const successUrl = `${origin}/billing?checkout=success`
    const cancelUrl = `${origin}/billing?checkout=cancelled`
    const expiredUrl = `${origin}/billing?checkout=expired`
    log('[checkout] Criando checkout hospedado', { plan, cycle, value: price, customerId, profileId: profile.profileId })
    const checkout = await createCheckout({
      plan: plan as Exclude<PlanId, 'free'>,
      cycle,
      successUrl,
      cancelUrl,
      expiredUrl,
      customerId,
    })
    log('[checkout] Checkout hospedado criado', { plan, cycle, value: price, flow: 'checkout', checkoutId: checkout.id, profileId: profile.profileId })

    await supabase
      .from('billing_checkouts')
      .upsert({
        profile_id: profile.profileId,
        checkout_id: checkout.id,
        asaas_customer_id: customerId,
        plan,
        cycle,
        status: 'pending',
        last_event: 'CHECKOUT_CREATED',
        payment_method: null,
      }, { onConflict: 'checkout_id' })

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
