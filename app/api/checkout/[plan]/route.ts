/**
 * POST /api/checkout/[plan]?cycle=monthly|yearly
 * Inicia checkout hospedado do Asaas.
 * Cria/obtém customer e salva asaas_customer_id no profile.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { createCheckout, createCustomer, updateSubscription, reconcileActiveSubscriptions, updateCustomer, PLAN_PRICES, type BillingCycle } from '@/lib/asaas'
import { BILLING_FIELD_LABELS, getBillingProfileForUser, getMissingBillingFields, toAsaasCustomerPayload } from '@/lib/billing-profile'
import { PLAN_ORDER, type PlanId } from '@/lib/plans'
import { computePlanChange } from '@/lib/plan-change'
import { log, logError } from '@/lib/logger'

function hashCustomerPayload(payload: Record<string, unknown>): string {
  const normalized = JSON.stringify(payload, Object.keys(payload).sort())
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32)
}

/**
 * Service-role client for writes that the user's RLS context cannot perform
 * (e.g. updating profile.asaas_customer_id, inserting billing_checkouts).
 * Falls back to null if SUPABASE_SERVICE_ROLE_KEY is missing — caller should
 * check and log if so.
 */
function getServiceSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

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

  // Decisão centralizada em computePlanChange — a MESMA função pura usada pelo endpoint
  // de PREVIEW (GET .../preview) que alimenta a tela de confirmação. Single source of
  // truth: o que o usuário confirma na tela é exatamente o que é executado aqui.
  const change = computePlanChange({
    currentPlan: profile.plan as PlanId,
    currentCycle: (profile.plan_cycle ?? 'MONTHLY') as BillingCycle,
    planExpiresAt: profile.plan_expires_at ?? null,
    hasActiveSubscription: Boolean(profile.asaasSubscriptionId),
    newPlan: plan as PlanId,
    newCycle: cycle,
  })

  // Downgrade: não aplica proration, cancela ao final do período
  if (change.action === 'downgrade_scheduled') {
    return NextResponse.json({
      message: 'Downgrades são processados ao final do período atual.',
      isDowngrade: true,
    })
  }

  const proration = change.proration
  let checkoutValue: number | undefined

  if (proration) {
    log('[checkout] Proration calculada', {
      currentPlan: profile.plan,
      newPlan: plan,
      credit: proration.credit,
      originalPrice: proration.originalPrice,
      finalPrice: proration.finalPrice,
    })
  }

  // CAMINHO D: o crédito cobre todo o novo plano. Em vez de CANCELAR a assinatura
  // (perdendo a recorrência — bug antigo), EDITAMOS a assinatura existente para o
  // novo plano e empurramos a próxima cobrança (nextDueDate) pelo tempo que o
  // crédito cobre ("saldo em tempo"). A assinatura segue ACTIVE e recorrente;
  // depois do nextDueDate a cobrança volta ao normal. Não cancela, não pede cartão.
  if (change.action === 'credit_covered' && proration && profile.asaasSubscriptionId) {
    const coverageDays = change.creditCoverageDays ?? 1
    // nextDueDate vem de change.nextChargeDate — a MESMA fonte do preview — eliminando a
    // última divergência preview×POST perto da virada do dia. plan_expires_at é derivado
    // do mesmo valor (00:00 UTC do dia da cobrança), mantendo Asaas e profile coerentes.
    // Fallback defensivo (recalcula) só se nextChargeDate vier nulo (não ocorre p/ credit_covered).
    let nextDueDate = change.nextChargeDate
    if (!nextDueDate) {
      const d = new Date()
      d.setDate(d.getDate() + coverageDays)
      nextDueDate = d.toISOString().split('T')[0]
    }
    const nextDue = new Date(`${nextDueDate}T00:00:00.000Z`)

    log('[checkout] Caminho D — crédito cobre o novo plano; editando assinatura existente', {
      userId: profile.profileId,
      subscriptionId: profile.asaasSubscriptionId,
      newPlan: plan,
      newCycle: cycle,
      credit: proration.credit,
      coverageDays,
      nextDueDate,
    })

    // 1) Editar a assinatura no Asaas (PUT). Se falhar, abortar SEM alterar o
    //    profile — mantém a conta consistente com o plano atual.
    try {
      await updateSubscription(profile.asaasSubscriptionId, {
        value: proration.originalPrice,
        cycle,
        nextDueDate,
        description: `EidosForm — Plano ${plan} (${cycle === 'MONTHLY' ? 'Mensal' : 'Anual'})`,
        externalReference: `profile:${profile.profileId}`,
        updatePendingPayments: true,
      })
    } catch (err) {
      logError('[checkout] Caminho D — falha ao editar assinatura no Asaas; abortando sem alterar plano', err, {
        userId: profile.profileId,
        subscriptionId: profile.asaasSubscriptionId,
      })
      return NextResponse.json(
        { error: 'Não foi possível alterar sua assinatura agora. Tente novamente.' },
        { status: 502 }
      )
    }

    // 2) Atualizar o profile pro novo plano, MANTENDO o asaas_subscription_id.
    //    plan_expires_at = nextDueDate: acesso garantido durante o período coberto
    //    pelo crédito; cada cobrança futura estende via webhook PAYMENT_CONFIRMED.
    const planConfig = (await import('@/lib/plan-definitions')).PLANS[plan as PlanId]
    const sSupa = getServiceSupabase() ?? supabase
    const { data: dRows, error: dErr } = await sSupa
      .from('profiles')
      .update({
        plan: plan as PlanId,
        plan_cycle: cycle,
        plan_status: 'active',
        plan_expires_at: nextDue.toISOString(),
        responses_limit: planConfig?.maxResponses ?? 100,
        responses_used: 0,
        limit_alert_sent: false,
        // asaas_subscription_id MANTIDO — a assinatura é a mesma, só foi editada.
      })
      .eq('id', profile.profileId)
      .select('id')

    if (dErr || !dRows || dRows.length !== 1) {
      // A assinatura já foi editada; só o profile não persistiu. Estado recuperável
      // (polling/webhook reconciliam). Logar alto e devolver erro suave.
      logError('[checkout] Caminho D — assinatura editada mas falha ao atualizar profile (reconciliar)', dErr, {
        userId: profile.profileId,
        rows: dRows?.length ?? 0,
      })
      return NextResponse.json(
        { error: 'Sua assinatura foi alterada, mas houve um erro ao atualizar o plano. Atualize a página em instantes.' },
        { status: 500 }
      )
    }

    // 3) Processar upgrade (despausar forms, etc.)
    try {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (serviceKey) {
        const upgrade = await (await import('@/lib/plan-limits')).handleUpgrade(profile.profileId, serviceKey)
        log('[checkout] Caminho D — upgrade processado', { userId: profile.profileId, unpausedForms: upgrade.unpausedCount })
      }
    } catch (err) {
      logError('[checkout] handleUpgrade falhou (Caminho D)', err)
    }

    // Reconciliar: limpa assinaturas órfãs do cliente, MANTENDO a editada (a sub
    // é a mesma; aqui só garantimos que não sobrou nenhuma órfã de fluxos antigos).
    const reconD = await reconcileActiveSubscriptions(profile.asaasCustomerId ?? null, profile.asaasSubscriptionId)
    if (reconD.cancelled.length) {
      log('[checkout] Caminho D — assinaturas órfãs canceladas (reconcile)', { userId: profile.profileId, kept: reconD.kept, cancelled: reconD.cancelled })
    }

    // 4) Auditoria em billing_checkouts (mantém asaas_subscription_id)
    await sSupa
      .from('billing_checkouts')
      .upsert({
        profile_id: profile.profileId,
        checkout_id: `plan-change-${Date.now()}`,
        asaas_customer_id: profile.asaasCustomerId ?? null,
        asaas_subscription_id: profile.asaasSubscriptionId,
        plan,
        cycle,
        status: 'paid',
        last_event: 'PLAN_CHANGE_CREDIT_TIME',
        payment_method: 'proration_credit_time',
        original_price: proration.originalPrice,
        proration_credit: proration.credit,
        final_price: 0,
      }, { onConflict: 'checkout_id' })

    return NextResponse.json({
      status: 'success',
      coveredByCredit: true,
      creditCoverageDays: coverageDays,
      nextChargeDate: nextDueDate,
      proration,
    })
  }

  // Proration-checkout: crédito NÃO cobre tudo → cobra a diferença agora (customValue).
  // O webhook depois corrige o valor recorrente da assinatura pro preço cheio.
  if (proration) {
    checkoutValue = proration.finalPrice
  }

  try {
    // NÃO cancelar assinatura anterior aqui.
    // O cancelamento é feito no webhook (PAYMENT_CONFIRMED/PAYMENT_RECEIVED)
    // para evitar que o usuário perca o plano se abandonar o checkout.
    // Ver P0 #1 — handoff de auditoria Zéfa.

    // Criar ou obter customer no Asaas sempre alinhado ao perfil logado.
    // Escritas no profile (asaas_customer_id, asaas_customer_payload_hash) usam
    // service_role porque RLS do user logado não cobre essas colunas.
    const customerPayload = toAsaasCustomerPayload(profile)
    const customerPayloadHash = hashCustomerPayload(customerPayload as unknown as Record<string, unknown>)
    const serviceSupabase = getServiceSupabase()
    if (!serviceSupabase) {
      logError('[checkout] SUPABASE_SERVICE_ROLE_KEY não configurada — escritas server-side vão falhar')
    }

    let customerId = profile.asaasCustomerId
    if (!customerId) {
      log('[checkout] Criando customer no Asaas', { email: profile.email, profileId: profile.profileId })
      const customer = await createCustomer(customerPayload)
      customerId = customer.id

      const { error: profileUpdateError } = await (serviceSupabase ?? supabase)
        .from('profiles')
        .update({ asaas_customer_id: customerId, asaas_customer_payload_hash: customerPayloadHash } as never)
        .eq('id', profile.profileId)

      if (profileUpdateError) {
        logError('[checkout] Falhou ao salvar asaas_customer_id no profile', profileUpdateError, { userId: profile.profileId, customerId })
      } else {
        log('[checkout] asaas_customer_id salvo no profile', { userId: profile.profileId, customerId })
      }
    } else {
      const { data: hashRow } = await (serviceSupabase ?? supabase)
        .from('profiles')
        .select('asaas_customer_payload_hash' as never)
        .eq('id', profile.profileId)
        .single<{ asaas_customer_payload_hash: string | null }>()

      if (hashRow?.asaas_customer_payload_hash !== customerPayloadHash) {
        await updateCustomer(customerId, customerPayload)
        const { error: hashUpdateError } = await (serviceSupabase ?? supabase)
          .from('profiles')
          .update({ asaas_customer_payload_hash: customerPayloadHash } as never)
          .eq('id', profile.profileId)
        if (hashUpdateError) {
          logError('[checkout] Falhou ao atualizar asaas_customer_payload_hash', hashUpdateError, { userId: profile.profileId })
        }
        log('[checkout] Customer do Asaas atualizado (dados mudaram)', { userId: profile.profileId, customerId })
      } else {
        log('[checkout] Customer do Asaas — payload inalterado, skip updateCustomer', { userId: profile.profileId, customerId })
      }
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

    // Insert billing_checkouts via service_role (RLS de cookie do user não cobre).
    const ckSupa = serviceSupabase ?? supabase
    const { error: ckInsertError } = await ckSupa
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

    if (ckInsertError) {
      logError('[checkout] Falhou ao inserir billing_checkouts', ckInsertError, { checkoutId: checkout.id, profileId: profile.profileId })
    }

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
