/**
 * POST /api/checkout/[plan]?cycle=monthly|yearly
 * Inicia checkout hospedado do Asaas.
 * Cria/obtém customer e salva asaas_customer_id no profile.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { createCheckout, createCustomer, cancelSubscription, updateCustomer, PLAN_PRICES, type BillingCycle } from '@/lib/asaas'
import { BILLING_FIELD_LABELS, getBillingProfileForUser, getMissingBillingFields, toAsaasCustomerPayload } from '@/lib/billing-profile'
import { PLAN_ORDER, type PlanId } from '@/lib/plans'
import { calculateUpgradePrice, isUpgrade } from '@/lib/proration'
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
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Rate limit checkout creation (10 req/min per user)
  const checkoutLimit = await checkRateLimitAsync(`checkout-create:${user.id}`, {
    maxAttempts: 10,
    windowMs: 60 * 1000,
  })
  if (!checkoutLimit.allowed) {
    return NextResponse.json(
      { error: 'Muitas tentativas de checkout. Tente novamente mais tarde.', retryAfter: Math.ceil(checkoutLimit.resetIn / 1000) },
      { status: 429, headers: { 'Retry-After': Math.ceil(checkoutLimit.resetIn / 1000).toString() } }
    )
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
  if (profile.asaasSubscriptionId && profile.plan === plan && profile.plan_cycle === cycle) {
    return NextResponse.json({
      message: 'Você já possui este plano ativo neste ciclo',
      alreadySubscribed: true,
    })
  }

  const isCycleChange = profile.plan === plan && profile.plan_cycle !== cycle
  const isPlanUpgrade = profile.plan !== plan && isUpgrade(profile.plan as PlanId, plan as PlanId)
  const shouldApplyProration = isCycleChange || isPlanUpgrade

  // Downgrade: não aplica proration, cancela ao final do período
  if (profile.asaasSubscriptionId && profile.plan !== plan && !isPlanUpgrade) {
    return NextResponse.json({
      message: 'Downgrades são processados ao final do período atual.',
      isDowngrade: true,
    })
  }

  // Calcular proration para upgrade ou troca de ciclo do mesmo plano
  let proration: { credit: number; newPrice: number; originalPrice: number; finalPrice: number } | null = null
  let checkoutValue: number | undefined

  if (profile.asaasSubscriptionId && shouldApplyProration) {
    const { data: planData } = await supabase
      .from('profiles')
      .select('plan_expires_at')
      .eq('id', profile.profileId)
      .single()

    if (planData?.plan_expires_at) {
      const currentCycle = (profile.plan_cycle ?? 'MONTHLY') as BillingCycle

      proration = calculateUpgradePrice({
        currentPlan: profile.plan as PlanId,
        currentCycle,
        planExpiresAt: planData.plan_expires_at,
        newPlan: plan as PlanId,
        newCycle: cycle,
      })

      log('[checkout] Proration calculada', {
        currentPlan: profile.plan,
        newPlan: plan,
        credit: proration.credit,
        originalPrice: proration.originalPrice,
        finalPrice: proration.finalPrice,
      })

      // Se crédito cobre o novo plano, ativar diretamente no backend
      if (proration.finalPrice <= 0) {
        log('[checkout] Crédito cobre o novo plano, ativando diretamente', {
          userId: profile.profileId,
          credit: proration.credit,
          newPlan: plan,
        })

        // Calcular nova expiração baseada no ciclo do novo plano
        const now = new Date()
        if (cycle === 'YEARLY') now.setFullYear(now.getFullYear() + 1)
        else now.setDate(now.getDate() + 30)

        const planConfig = (await import('@/lib/plan-definitions')).PLANS[plan as PlanId]

        // Atualizar profile com o novo plano
        await supabase
          .from('profiles')
          .update({
            plan: plan as PlanId,
            plan_status: 'active',
            plan_expires_at: now.toISOString(),
            responses_limit: planConfig?.maxResponses ?? 100,
            responses_used: 0,
            limit_alert_sent: false,
          })
          .eq('id', profile.profileId)

        // Cancelar assinatura antiga no Asaas (seguro: upgrade garantido pelo crédito)
        if (profile.asaasSubscriptionId) {
          try {
            await cancelSubscription(profile.asaasSubscriptionId)
            log('[checkout] Assinatura anterior cancelada (proration credit)', { oldSubscriptionId: profile.asaasSubscriptionId })
            await supabase
              .from('profiles')
              .update({ asaas_subscription_id: null })
              .eq('id', profile.profileId)
          } catch (err) {
            logError('[checkout] Falha ao cancelar assinatura antiga (proration)', err)
          }
        }

        // Processar upgrade (unpause forms, etc.)
        try {
          const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
          if (serviceKey) {
            const upgrade = await (await import('@/lib/plan-limits')).handleUpgrade(profile.profileId, serviceKey)
            log('[checkout] Upgrade processado via proration credit', { userId: profile.profileId, unpausedForms: upgrade.unpausedCount })
          }
        } catch (err) {
          logError('[checkout] handleUpgrade falhou (proration credit)', err)
        }

        // Registrar checkout como pago
        await supabase
          .from('billing_checkouts')
          .upsert({
            profile_id: profile.profileId,
            checkout_id: `proration-${Date.now()}`,
            asaas_customer_id: profile.asaasCustomerId ?? null,
            plan,
            cycle,
            status: 'paid',
            last_event: 'PRORATION_CREDIT_COVERED',
            payment_method: 'proration_credit',
            original_price: proration.originalPrice,
            proration_credit: proration.credit,
            final_price: 0,
          }, { onConflict: 'checkout_id' })

        return NextResponse.json({
          status: 'success',
          coveredByCredit: true,
          proration,
        })
      }

      checkoutValue = proration.finalPrice
    }
  }

  try {
    // NÃO cancelar assinatura anterior aqui.
    // O cancelamento é feito no webhook (PAYMENT_CONFIRMED/PAYMENT_RECEIVED)
    // para evitar que o usuário perca o plano se abandonar o checkout.
    // Ver P0 #1 — handoff de auditoria Zéfa.

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

    const basePrice = cycle === 'MONTHLY'
      ? PLAN_PRICES[plan as keyof typeof PLAN_PRICES].monthly
      : PLAN_PRICES[plan as keyof typeof PLAN_PRICES].yearly
    const price = checkoutValue ?? basePrice
    const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? ''
    const successUrl = `${origin}/billing?checkout=success`
    const cancelUrl = `${origin}/billing?checkout=cancelled`
    const expiredUrl = `${origin}/billing?checkout=expired`
    log('[checkout] Criando checkout hospedado', { plan, cycle, value: price, customerId, profileId: profile.profileId, isProrated: !!checkoutValue })
    const checkout = await createCheckout({
      plan: plan as Exclude<PlanId, 'free'>,
      cycle,
      successUrl,
      cancelUrl,
      expiredUrl,
      customerId,
      ...(checkoutValue ? { customValue: checkoutValue } : {}),
    })
    log('[checkout] Checkout hospedado criado', { plan, cycle, value: price, flow: checkoutValue ? 'prorated_checkout' : 'checkout', checkoutId: checkout.id, profileId: profile.profileId })

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
        ...(proration ? {
          original_price: proration.originalPrice,
          proration_credit: proration.credit,
          final_price: proration.finalPrice,
        } : {}),
      }, { onConflict: 'checkout_id' })

    return NextResponse.json({
      checkoutId: checkout.id,
      checkoutUrl: checkout.url,
      plan,
      cycle,
      value: price,
      ...(proration ? { proration } : {}),
    })
  } catch (err) {
    logError('[checkout] Erro ao processar checkout', err)
    const message = err instanceof Error ? err.message : 'Erro interno ao processar checkout'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
