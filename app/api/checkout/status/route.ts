import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { getSubscription, getCustomerSubscriptions, reconcileActiveSubscriptions } from '@/lib/asaas'
import { handleUpgrade } from '@/lib/plan-limits'
import { buildActivePlanUpdate } from '@/lib/billing-activation'
import { log, logError } from '@/lib/logger'

/**
 * GET /api/checkout/status
 *
 * Returns the current checkout/payment status for the authenticated user.
 *
 * Resolution order:
 * 1. Local DB (profiles + billing_checkouts) — fast, always tried first
 * 2. Asaas fallback — queried when local status is still "pending" and we have
 *    an asaas_subscription_id. Covers the case where the webhook is delayed.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Rate limit checkout status polling (90 req/min per user). O endpoint tem fast-path
  // local (não bate no Asaas quando o profile já reflete o plano), então 90/min é
  // folgado e evita o overlay tomar 429 e ficar preso em "Aguardando" durante testes.
  const statusLimit = await checkRateLimitAsync(`checkout-status:${user.id}`, {
    maxAttempts: 90,
    windowMs: 60 * 1000,
  })
  if (!statusLimit.allowed) {
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente mais tarde.', retryAfter: Math.ceil(statusLimit.resetIn / 1000) },
      { status: 429, headers: { 'Retry-After': Math.ceil(statusLimit.resetIn / 1000).toString() } }
    )
  }

  const [{ data: profile }, { data: checkout }] = await Promise.all([
    supabase
      .from('profiles')
      .select('plan, plan_status, plan_cycle, asaas_customer_id')
      .eq('id', user.id)
      .single(),
    supabase
      .from('billing_checkouts')
      .select('id, status, last_event, updated_at, asaas_subscription_id, asaas_customer_id, plan, cycle')
      .eq('profile_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const plan = profile?.plan ?? 'free'
  const planStatus = profile?.plan_status ?? null
  const planCycle = profile?.plan_cycle ?? null

  // ── Fast path: o DB local já reflete o plano ATIVO deste checkout ──
  // Com checkout pendente, exigir que plano E ciclo batam — senão um upgrade
  // (starter→plus ou mensal→anual) retornaria 'success' no plano ANTIGO antes de
  // processar. Sem checkout, basta estar num plano pago ativo.
  if (plan !== 'free' && planStatus === 'active') {
    const matchesCheckout = !checkout || (checkout.plan === plan && checkout.cycle === planCycle)
    if (matchesCheckout) {
      return NextResponse.json({ status: 'success' })
    }
  }

  // ── Fast path: checkout record says paid ──
  if (checkout?.status === 'paid') {
    return NextResponse.json({ status: 'success' })
  }

  // ── Fast path: local DB says cancelled/overdue ──
  if (checkout?.status === 'cancelled') {
    return NextResponse.json({ status: 'cancelled' })
  }
  if (checkout?.status === 'overdue') {
    return NextResponse.json({ status: 'expired' })
  }

  // ── Slow path: still pending → ask Asaas directly ──
  const asaasSubId = checkout?.asaas_subscription_id
  const asaasCustomerId = checkout?.asaas_customer_id ?? profile?.asaas_customer_id
  const checkoutPlan = checkout?.plan ?? null
  const checkoutCycle = checkout?.cycle ?? null
  const checkoutId = checkout?.id ?? null

  // Helper: persiste o plano quando o Asaas confirma ACTIVE.
  // CRÍTICO: usa SERVICE-ROLE (createAdminClient). A RLS do usuário proíbe alterar
  // plan/plan_status/asaas_*/responses_* no profile, e billing_checkouts só tem
  // policy de SELECT pro usuário — gravar com o cliente de cookie afeta 0 linhas
  // silenciosamente (era o bug P0 que deixava o polling "confirmar" sem ativar).
  // Retorna true SOMENTE se realmente persistiu (1 linha). Idempotente.
  async function persistPlanFromAsaas(subscriptionId: string): Promise<boolean> {
    if (!checkoutPlan) return false

    // checkoutCycle (de billing_checkouts, salvo na criação do checkout) é a fonte
    // de verdade do ciclo. NÃO inferir do subValue (valores prorateados não batem).
    const cycle: 'MONTHLY' | 'YEARLY' = (checkoutCycle ?? 'MONTHLY') as 'MONTHLY' | 'YEARLY'

    // Skip se o profile já está com o plano E CICLO corretos ativos (webhook ou poll
    // anterior). Checar o CICLO também: num upgrade mensal→anual o tier é o mesmo,
    // então comparar só o plano pularia a atualização do ciclo (Bug B).
    if (profile?.plan === checkoutPlan && profile?.plan_status === 'active' && profile?.plan_cycle === cycle) {
      log('[checkout/status] Plan+cycle already active locally, skipping persist')
      return true
    }

    let admin: ReturnType<typeof createAdminClient>
    try {
      admin = createAdminClient()
    } catch (err) {
      logError('[checkout/status] SERVICE_ROLE indisponível — não foi possível ativar plano via polling', err, { userId: user!.id, subscriptionId })
      return false
    }

    log('[checkout/status] Persisting plan from Asaas polling (service-role)', {
      userId: user!.id,
      plan: checkoutPlan,
      cycle,
      subscriptionId,
    })

    const { data: updatedRows, error: updateError } = await admin
      .from('profiles')
      .update(buildActivePlanUpdate({
        plan: checkoutPlan,
        cycle,
        customerId: asaasCustomerId ?? profile?.asaas_customer_id ?? null,
        subscriptionId,
      }) as never)
      .eq('id', user!.id)
      .select('id')

    if (updateError || !updatedRows || updatedRows.length !== 1) {
      logError('[checkout/status] Falha ao persistir plano no profile (0 linhas/erro)', updateError, {
        userId: user!.id,
        subscriptionId,
        rows: updatedRows?.length ?? 0,
      })
      return false
    }

    if (checkoutId) {
      const { error: ckError } = await admin
        .from('billing_checkouts')
        .update({
          asaas_subscription_id: subscriptionId,
          status: 'paid',
          last_event: 'POLLING_CONFIRMED',
        } as never)
        .eq('id', checkoutId)
      if (ckError) {
        logError('[checkout/status] Falha ao atualizar billing_checkouts (não-bloqueante)', ckError, { checkoutId })
      }
    }

    // handleUpgrade SÓ depois de confirmar que o plano persistiu de verdade.
    try {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (serviceKey) {
        const upgrade = await handleUpgrade(user!.id, serviceKey)
        log('[checkout/status] Upgrade processed via polling', { userId: user!.id, unpausedForms: upgrade.unpausedCount })
      }
    } catch (err) {
      log('[checkout/status] handleUpgrade failed (non-blocking)', { error: err instanceof Error ? err.message : String(err) })
    }

    // Reconciliar: cancela assinaturas órfãs do cliente (≠ a recém-persistida). O
    // polling não cancelava nada antes — a sub antiga vazava quando a ativação vinha
    // por aqui (webhook atrasado). Não-bloqueante.
    const recon = await reconcileActiveSubscriptions(asaasCustomerId ?? profile?.asaas_customer_id ?? null, subscriptionId)
    if (recon.cancelled.length) {
      log('[checkout/status] Assinaturas órfãs canceladas (reconcile via polling)', { userId: user!.id, kept: recon.kept, cancelled: recon.cancelled })
    }

    return true
  }

  // 1. Try by subscription ID if available
  if (asaasSubId) {
    try {
      const sub = await getSubscription(asaasSubId)
      const asaasStatus = (sub.status as string)?.toUpperCase()

      if (asaasStatus === 'ACTIVE') {
        log('[checkout/status] Asaas fallback: subscription ACTIVE', { subId: asaasSubId })
        if (await persistPlanFromAsaas(asaasSubId)) {
          return NextResponse.json({ status: 'success' })
        }
        // ACTIVE no Asaas mas não persistiu localmente — NÃO mentir 'success'.
        // Mantém 'pending' (frontend segue polling; webhook/reprocesso podem cobrir).
        return NextResponse.json({ status: 'pending' })
      }

      if (asaasStatus === 'INACTIVE' || asaasStatus === 'EXPIRED' || asaasStatus === 'SUSPENDED') {
        log('[checkout/status] Asaas fallback: subscription not active', { subId: asaasSubId, asaasStatus })
        return NextResponse.json({ status: 'expired' })
      }

      log('[checkout/status] Asaas fallback: still pending', { subId: asaasSubId, asaasStatus })
    } catch (err) {
      log('[checkout/status] Asaas fallback failed, trying customer lookup', {
        subId: asaasSubId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 2. Try by customer ID — covers hosted checkout where subscription ID
  //    is only populated by the webhook (which may not have arrived yet).
  //    Filter by the plan we expect (from billing_checkouts) to avoid picking
  //    up unrelated active subscriptions.
  if (asaasCustomerId) {
    try {
      const subs = await getCustomerSubscriptions(asaasCustomerId) as Array<{ id: string; status: string; description?: string; dateCreated?: string; cycle?: string }>
      const activeSubs = (subs ?? []).filter((s) => (s.status as string)?.toUpperCase() === 'ACTIVE')

      const expectedPlan = checkoutPlan?.toLowerCase()
      const expectedCycle = (checkoutCycle ?? '').toUpperCase()
      // keepSubId robusto: preferir a sub que bate PLANO (descrição) E CICLO; depois só
      // plano; por último a mais recente. Importa porque o reconcile cancela TODAS as
      // outras — eleger a errada como "keep" cancelaria a certa.
      const byPlanAndCycle = (expectedPlan && expectedCycle)
        ? activeSubs.find((s) => (s.description ?? '').toLowerCase().includes(`plano ${expectedPlan}`) && (s.cycle ?? '').toUpperCase() === expectedCycle)
        : undefined
      const byPlan = expectedPlan
        ? activeSubs.find((s) => (s.description ?? '').toLowerCase().includes(`plano ${expectedPlan}`))
        : undefined

      const sortedByDate = [...activeSubs].sort((a, b) => {
        const ta = a.dateCreated ? new Date(a.dateCreated).getTime() : 0
        const tb = b.dateCreated ? new Date(b.dateCreated).getTime() : 0
        return tb - ta
      })

      const active = byPlanAndCycle ?? byPlan ?? sortedByDate[0]

      if (active) {
        log('[checkout/status] Asaas customer fallback: found ACTIVE subscription', {
          customerId: asaasCustomerId,
          subId: active.id,
          matchStrategy: byPlanAndCycle ? 'plan+cycle' : byPlan ? 'plan' : 'most_recent',
        })
        if (await persistPlanFromAsaas(active.id)) {
          return NextResponse.json({ status: 'success' })
        }
        return NextResponse.json({ status: 'pending' })
      }
      log('[checkout/status] Asaas customer fallback: no active subscription', { customerId: asaasCustomerId })
    } catch (err) {
      log('[checkout/status] Asaas customer fallback failed', {
        customerId: asaasCustomerId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ status: 'pending' })
}
