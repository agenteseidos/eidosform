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
import { createCheckout, createCustomer, updateSubscription, reconcileActiveSubscriptions, updateCustomer, buildExternalReference, createSubscriptionWithToken, cancelSubscription, alignPendingPaymentsDueDate, PLAN_PRICES, type BillingCycle } from '@/lib/asaas'
import { BILLING_FIELD_LABELS, getBillingProfileForUser, getMissingBillingFields, toAsaasCustomerPayload } from '@/lib/billing-profile'
import { PLAN_ORDER, getEffectivePlan, type PlanId } from '@/lib/plans'
import { computePlanChange } from '@/lib/plan-change'
import { expiryFromNextDueDate } from '@/lib/billing-activation'
import { acquireLock, releaseLock } from '@/lib/billing-lock'
import { checkLaunchScope } from '@/lib/billing-launch-guard'
import { log, logError, logWarn } from '@/lib/logger'
import { sendBillingOpsAlert } from '@/lib/resend'

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

/**
 * P1-5 (Codex): no DOWNGRADE, pausar os forms excedentes é crítico. Se handleDowngrade falhar,
 * enfileira DLQ `formlimit:{profileId}` (event FORMLIMIT) — o reprocessador re-roda
 * handleDowngrade(plano-alvo) — e dispara alerta operacional. NÃO silencioso.
 */
async function enqueueFormLimitDLQ(db: ReturnType<typeof getServiceSupabase>, profileId: string, subscriptionId: string | null) {
  try {
    await (db as unknown as { from: (t: string) => { upsert: (v: unknown, o: unknown) => Promise<unknown> } })
      .from('asaas_webhook_events')
      .upsert({
        event_id: `formlimit:${profileId}`,
        event: 'FORMLIMIT',
        status: 'failed',
        error: 'handleDowngrade falhou — re-aplicar limites de forms do plano-alvo',
        attempts: 0,
        subscription_id: subscriptionId,
        last_attempt_at: new Date().toISOString(),
      }, { onConflict: 'event_id' })
  } catch { /* best-effort */ }
  await sendBillingOpsAlert({
    subject: 'Downgrade: falha ao pausar forms excedentes — DLQ FORMLIMIT (reprocessar)',
    lines: { profileId, subscriptionId },
  }).catch(() => {})
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ plan: string }> }
) {
  const { plan } = await params
  const cycle = ((req.nextUrl.searchParams.get('cycle') ?? 'monthly').toUpperCase()) as BillingCycle
  // P2 (Codex): o frontend envia a `action` que o PREVIEW mostrou. Se o recálculo no POST
  // (new Date() avançou — virada UTC etc.) der uma action DIFERENTE (ex.: credit_covered↔checkout,
  // R$0↔cobra), abortamos com 409 p/ o usuário revisar — em vez de cobrar algo que ele não viu.
  let expectedAction: string | null = null
  try { expectedAction = ((await req.json()) as { expectedAction?: string })?.expectedAction ?? null } catch { /* sem body */ }

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

  // TRAVA DE SEGURANÇA (P0, Codex 2026-06-09): bloqueia mudança de plano/ciclo p/ pagante e
  // planos/ciclo não-liberados no escopo atual (fluxos que editam valor de sub quebram em prod).
  // Plano EFETIVO (P2-b, audit 2026-06-09): plano pago já EXPIRADO conta como 'free' — sem isto,
  // um cliente vencido que o cron diário ainda não reverteu tomava 409 ao tentar COMPRAR de novo
  // (perda de venda por até 24h). Pagante vigente (inclui canceling com período restante) segue
  // bloqueado p/ mudança de plano enquanto BILLING_MVP_ONLY estiver ON.
  const effectiveCurrentPlan = getEffectivePlan({ plan: profile.plan, plan_expires_at: profile.plan_expires_at })
  const launchBlock = checkLaunchScope({ currentPlan: effectiveCurrentPlan, targetPlan: plan, cycle })
  if (launchBlock) return NextResponse.json(launchBlock.body, { status: launchBlock.status })

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
  // CANCELING: cancelou mas ainda tem período pago (plano≠free, expiração futura, SEM sub) →
  // o saldo restante vira crédito pra reassinar. (#2, Sidney 2026-06-08.)
  const hasPaidPeriodRemaining =
    !profile.asaasSubscriptionId &&
    profile.plan !== 'free' &&
    !!profile.plan_expires_at &&
    new Date(profile.plan_expires_at).getTime() > Date.now()

  const change = computePlanChange({
    currentPlan: profile.plan as PlanId,
    // plan_cycle CRU (string | null), idêntico ao preview — NÃO forçar 'MONTHLY' aqui.
    // Forçar divergia do preview p/ perfil pago legado com plan_cycle=null (P2-6, audit
    // Codex 2026-06-07): preview via null→cycle change, POST via MONTHLY→sem proration.
    currentCycle: profile.plan_cycle,
    planExpiresAt: profile.plan_expires_at ?? null,
    hasActiveSubscription: Boolean(profile.asaasSubscriptionId),
    hasPaidPeriodRemaining,
    newPlan: plan as PlanId,
    newCycle: cycle,
  })

  // P2 (Codex): se o recálculo divergiu do que o usuário confirmou no preview (action mudou),
  // aborta p/ ele revisar — evita cobrar R$X quando ele viu R$0 (ou vice-versa) na virada do dia.
  if (expectedAction && change.action !== expectedAction) {
    return NextResponse.json(
      { error: 'O valor desta mudança foi recalculado. Revise o resumo atualizado antes de confirmar.', code: 'QUOTE_CHANGED' },
      { status: 409 }
    )
  }

  // Downgrade: o sistema ainda NÃO agenda troca de plano (feature dedicada futura —
  // scheduled_plan_changes). Mensagem HONESTA (opção C, decisão Sidney 2026-06-08): orienta
  // a CANCELAR a assinatura (mantém acesso até o fim do período pago) e assinar o plano menor
  // depois. Não promete agendamento que não existe nem cobra/altera nada aqui.
  if (change.action === 'downgrade_scheduled') {
    return NextResponse.json({
      message: 'Para reduzir de plano, cancele sua assinatura atual nas configurações de cobrança. Você mantém o acesso até o fim do período já pago e, depois disso, pode assinar o plano menor.',
      isDowngrade: true,
      action: 'cancel_then_resubscribe',
    })
  }

  const proration = change.proration

  // CANCELING + saldo cobre TODO o novo plano: não há sub p/ editar (foi deletada no cancelamento).
  // #2b — REATIVAÇÃO via token: recria a assinatura com o creditCardToken salvo + nextDueDate =
  // data de cobertura do saldo → NÃO cobra agora, troca o plano de verdade. Sem token (legado/
  // captura falhou) → mensagem honesta (A), sem cobrar errado.
  if (change.action === 'credit_covered' && !profile.asaasSubscriptionId) {
    const token = profile.asaasCardToken
    const coverageNextDue = change.nextChargeDate // YYYY-MM-DD (saldo em tempo)
    if (token && profile.asaasCustomerId && coverageNextDue && proration) {
      const sSupa = getServiceSupabase() ?? supabase
      // P1 (Codex): LOCK por profile — 2 POSTs simultâneos no canceling não podem criar 2 subs.
      const reactLockKey = `planchange:${profile.profileId}`
      if (!(await acquireLock(sSupa, reactLockKey))) {
        return NextResponse.json(
          { error: 'Já estamos processando uma alteração da sua assinatura. Aguarde um instante e tente novamente.' },
          { status: 409 }
        )
      }
      try {
        // CAS: aborta se outro fluxo já vinculou uma sub (não está mais "sem sub").
        const { data: casRow } = await sSupa.from('profiles').select('asaas_subscription_id').eq('id', profile.profileId).single()
        if ((casRow as { asaas_subscription_id?: string | null } | null)?.asaas_subscription_id) {
          return NextResponse.json({ error: 'Sua assinatura já foi reativada. Recarregue a página.' }, { status: 409 })
        }
        const newSub = await createSubscriptionWithToken({
          customerId: profile.asaasCustomerId,
          value: proration.originalPrice, // preço CHEIO do novo plano (recorrente)
          cycle,
          nextDueDate: coverageNextDue,
          creditCardToken: token,
          description: `EidosForm — Plano ${plan} (${cycle === 'MONTHLY' ? 'Mensal' : 'Anual'})`,
          externalReference: buildExternalReference(profile.profileId, plan, cycle),
        })
        const planConfig = (await import('@/lib/plan-definitions')).PLANS[plan as PlanId]
        const expiry = expiryFromNextDueDate(coverageNextDue) ?? new Date(`${coverageNextDue}T00:00:00.000Z`).toISOString()
        // CAS ATÔMICO no banco: só vincula se asaas_subscription_id AINDA é null (ninguém venceu).
        const { data: rows, error: upErr } = await sSupa
          .from('profiles')
          .update({
            plan: plan as PlanId,
            plan_cycle: cycle,
            plan_status: 'active',
            plan_expires_at: expiry,
            asaas_subscription_id: newSub.id,
            responses_limit: planConfig?.maxResponses ?? 100,
            responses_used: 0,
            limit_alert_sent: false,
          })
          .eq('id', profile.profileId)
          .is('asaas_subscription_id', null)
          .select('id')
        if (upErr || !rows || rows.length !== 1) {
          // Outro fluxo venceu (CAS=0 linhas) OU erro → cancela a sub nova p/ NÃO cobrar fantasma.
          logError('[checkout] Reativação: CAS falhou/profile não persistiu — cancelando a sub nova', upErr, { userId: profile.profileId, newSub: newSub.id, rows: rows?.length ?? 0 })
          await cancelSubscription(newSub.id).catch(() => {})
          return NextResponse.json({ error: 'Não foi possível reativar agora. Recarregue e tente novamente.' }, { status: 409 })
        }
        // P1 (Codex): aplica os LIMITES DE FORMS do plano-alvo (pausa excedentes se for downgrade;
        // despausa se ilimitado). Sem isto, Plus canceling → Starter deixava forms acima do limite.
        try {
          const sk = process.env.SUPABASE_SERVICE_ROLE_KEY
          if (sk) {
            const fl = await (await import('@/lib/plan-limits')).handleDowngrade(profile.profileId, sk, plan as PlanId)
            log('[checkout] Reativação — limites de forms do plano-alvo aplicados', { userId: profile.profileId, pausedForms: fl.pausedCount, targetPlan: plan })
          }
        } catch (e) {
          // P1-5 (Codex): falha de pausa é CRÍTICA no downgrade → DLQ FORMLIMIT (reprocessável) + alerta.
          logError('[checkout] Reativação — handleDowngrade falhou; enfileirando FORMLIMIT', e, { userId: profile.profileId, targetPlan: plan })
          await enqueueFormLimitDLQ(sSupa, profile.profileId, newSub.id)
        }
        await reconcileActiveSubscriptions(profile.asaasCustomerId, newSub.id)
        // Marca um checkout 'paid' p/ o overlay de sucesso casar (senão pega o último cancelado).
        const { error: ckErr } = await (sSupa as unknown as { from: (t: string) => { upsert: (v: unknown, o: unknown) => Promise<{ error: unknown }> } })
          .from('billing_checkouts')
          .upsert({
            profile_id: profile.profileId,
            checkout_id: `reactivate-${profile.profileId}-${newSub.id}`,
            asaas_customer_id: profile.asaasCustomerId,
            asaas_subscription_id: newSub.id,
            plan,
            cycle,
            status: 'paid',
            last_event: 'REACTIVATE_COVERED',
            payment_method: 'reactivate_credit_time',
          }, { onConflict: 'checkout_id' })
        if (ckErr) logError('[checkout] Reativação — falha ao gravar checkout paid (overlay pode mostrar estado antigo)', ckErr, { userId: profile.profileId })
        log('[checkout] Reativação via token — plano trocado SEM cobrança agora', { userId: profile.profileId, plan, cycle, newSub: newSub.id, nextDueDate: coverageNextDue })
        return NextResponse.json({ status: 'success', coveredByCredit: true, reactivated: true, nextChargeDate: coverageNextDue, proration })
      } catch (err) {
        logError('[checkout] Reativação via token falhou — caindo na mensagem (sem cobrar)', err, { userId: profile.profileId, plan, cycle })
        // segue p/ a mensagem (não cobra errado)
      } finally {
        await releaseLock(sSupa, reactLockKey)
      }
    }
    const expiresFmt = profile.plan_expires_at
      ? new Date(profile.plan_expires_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : null
    return NextResponse.json({
      message: expiresFmt
        ? `Seu saldo atual já cobre este plano. Você mantém o acesso até ${expiresFmt} — a reativação automática estará disponível em breve.`
        : 'Seu saldo atual já cobre este plano. A reativação automática estará disponível em breve.',
      coveredByCredit: true,
      action: 'covered_no_charge',
    })
  }

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

    const sSupa = getServiceSupabase() ?? supabase

    // CAS (#4, audit 2026-06-08): re-lê o profile IMEDIATAMENTE antes de tocar no Asaas e
    // aborta se a sub/plano/ciclo divergirem do que computePlanChange assumiu. Evita que 2
    // POSTs simultâneos (duplo-clique / 2 abas) editem a MESMA assinatura cruzando plano/valor.
    const { data: casRow } = await sSupa
      .from('profiles')
      .select('asaas_subscription_id, plan, plan_cycle')
      .eq('id', profile.profileId)
      .single()
    const cas = casRow as { asaas_subscription_id?: string | null; plan?: string | null; plan_cycle?: string | null } | null
    if (
      !cas ||
      cas.asaas_subscription_id !== profile.asaasSubscriptionId ||
      cas.plan !== profile.plan ||
      (cas.plan_cycle ?? null) !== (profile.plan_cycle ?? null)
    ) {
      logWarn('[checkout] Caminho D — estado do profile mudou desde a decisão (CAS); abortando p/ evitar troca concorrente', {
        userId: profile.profileId,
        expectedSub: profile.asaasSubscriptionId,
        gotSub: cas?.asaas_subscription_id ?? null,
      })
      return NextResponse.json(
        { error: 'Sua assinatura mudou enquanto processávamos. Recarregue a página e tente novamente.' },
        { status: 409 }
      )
    }

    // LOCK leve do Caminho D (#4, audit 2026-06-08): serializa a operação por profile
    // (lib/billing-lock — insert-do-nothing + take-over ATÔMICO de lock stale). 2º POST
    // simultâneo → 409. Liberado (releaseLock) antes de cada saída do Caminho D.
    const lockKey = `planchange:${profile.profileId}`
    if (!(await acquireLock(sSupa, lockKey))) {
      return NextResponse.json(
        { error: 'Já estamos processando uma alteração da sua assinatura. Aguarde um instante e tente novamente.' },
        { status: 409 }
      )
    }

    // 1) RECUPERAÇÃO ANTES do PUT (P2a round 3, audit Codex 2026-06-07): grava em
    //    billing_checkouts o estado INTENCIONADO (sub → NOVO plano/ciclo) e CHECA o erro.
    //    Se falhar, aborta SEM tocar no Asaas — garante que, se o PUT acontecer, o mapa de
    //    recuperação pro reprocessador JÁ existe. status='pending' até confirmar o profile
    //    (não dá falso-sucesso no /status). checkout_id estável (por sub) p/ o flip→'paid'.
    const recoveryCheckoutId = `plan-change-${profile.profileId}-${profile.asaasSubscriptionId}`
    const { error: recErr } = await sSupa
      .from('billing_checkouts')
      .upsert({
        profile_id: profile.profileId,
        checkout_id: recoveryCheckoutId,
        asaas_customer_id: profile.asaasCustomerId ?? null,
        asaas_subscription_id: profile.asaasSubscriptionId,
        plan,
        cycle,
        // status='recovering' (não 'pending'): o /api/checkout/status IGNORA essa linha
        // interna, então durante a janela antes do PUT ela não pode fazer o polling ativar
        // o novo plano cedo (vendo a sub atual como ACTIVE). (P2 round 4, Codex 2026-06-07.)
        status: 'recovering',
        last_event: 'PLAN_CHANGE_CREDIT_TIME_PENDING',
        payment_method: 'proration_credit_time',
        original_price: proration.originalPrice,
        proration_credit: proration.credit,
        final_price: 0,
      }, { onConflict: 'checkout_id' })
    if (recErr) {
      logError('[checkout] Caminho D — falha ao gravar linha de recuperação; abortando ANTES de tocar no Asaas', recErr, {
        userId: profile.profileId,
        subscriptionId: profile.asaasSubscriptionId,
      })
      await releaseLock(sSupa, lockKey)
      return NextResponse.json(
        { error: 'Não foi possível alterar sua assinatura agora. Tente novamente.' },
        { status: 500 }
      )
    }

    // 2) Editar a assinatura no Asaas (PUT). Se falhar, reverter a linha de recuperação
    //    (a sub NÃO mudou) e abortar SEM alterar o profile.
    try {
      await updateSubscription(profile.asaasSubscriptionId, {
        value: proration.originalPrice,
        cycle,
        nextDueDate,
        description: `EidosForm — Plano ${plan} (${cycle === 'MONTHLY' ? 'Mensal' : 'Anual'})`,
        externalReference: buildExternalReference(profile.profileId, plan, cycle),
        updatePendingPayments: true,
      })
    } catch (err) {
      logError('[checkout] Caminho D — falha ao editar assinatura no Asaas; abortando sem alterar plano', err, {
        userId: profile.profileId,
        subscriptionId: profile.asaasSubscriptionId,
      })
      await sSupa
        .from('billing_checkouts')
        .update({ status: 'cancelled', last_event: 'PLAN_CHANGE_PUT_FAILED' })
        .eq('checkout_id', recoveryCheckoutId)
      await releaseLock(sSupa, lockKey)
      return NextResponse.json(
        { error: 'Não foi possível alterar sua assinatura agora. Tente novamente.' },
        { status: 502 }
      )
    }

    // 2b) Alinhar a data dos pagamentos PENDING ao nextDueDate. O updateSubscription move o
    //     nextDueDate da assinatura mas mantém a data dos pagamentos já gerados → sem isto, um
    //     pagamento antigo cobraria ANTES do fim da cobertura do saldo. (P0, Codex 2026-06-08:)
    //     se NÃO alinhar tudo, é money-path → alerta operacional + registro p/ reprocesso (NÃO
    //     silencioso). A troca de plano em si está OK; só a data da cobrança precisa de correção.
    const align = await alignPendingPaymentsDueDate(profile.asaasSubscriptionId, nextDueDate).catch((e) => {
      logError('[checkout] Caminho D — alinhamento de pagamentos LANÇOU', e, { userId: profile.profileId })
      return { moved: 0, failed: -1 }
    })
    if (align.failed !== 0) {
      logError('[checkout] Caminho D — pagamentos pendentes NÃO totalmente alinhados (risco de cobrança cedo)', undefined, { userId: profile.profileId, subscriptionId: profile.asaasSubscriptionId, nextDueDate, moved: align.moved, failed: align.failed })
      await sendBillingOpsAlert({
        subject: 'Caminho D: pagamento pendente NÃO alinhado — risco de cobrança antes do fim do crédito',
        lines: { userId: profile.profileId, subscriptionId: profile.asaasSubscriptionId, nextDueDate, moved: align.moved, failed: align.failed },
      }).catch(() => {})
      await (sSupa as unknown as { from: (t: string) => { upsert: (v: unknown, o: unknown) => Promise<unknown> } })
        .from('asaas_webhook_events')
        .upsert({
          event_id: `align-pending:${profile.asaasSubscriptionId}`,
          event: 'ALIGN_PENDING',
          status: 'failed',
          error: 'pagamentos pendentes não alinhados ao nextDueDate (risco de cobrança cedo)',
          attempts: 0,
          subscription_id: profile.asaasSubscriptionId,
          last_attempt_at: new Date().toISOString(),
        }, { onConflict: 'event_id' }).catch(() => {})
    } else if (align.moved) {
      log('[checkout] Caminho D — pagamentos pendentes movidos p/ nextDueDate', { userId: profile.profileId, moved: align.moved, nextDueDate })
    }

    // 3) Atualizar o profile pro novo plano, MANTENDO o asaas_subscription_id.
    //    plan_expires_at = nextDueDate: acesso garantido durante o período coberto
    //    pelo crédito; cada cobrança futura estende via webhook PAYMENT_CONFIRMED.
    const planConfig = (await import('@/lib/plan-definitions')).PLANS[plan as PlanId]
    const { data: dRows, error: dErr } = await sSupa
      .from('profiles')
      .update({
        plan: plan as PlanId,
        plan_cycle: cycle,
        plan_status: 'active',
        // Fim do dia BRT do nextDueDate (não T00:00:00Z, que em BRT cortaria acesso na
        // véspera à noite). Fallback p/ o ISO cru se a conversão falhar. (P2-7)
        plan_expires_at: expiryFromNextDueDate(nextDueDate) ?? nextDue.toISOString(),
        responses_limit: planConfig?.maxResponses ?? 100,
        responses_used: 0,
        limit_alert_sent: false,
        // asaas_subscription_id MANTIDO — a assinatura é a mesma, só foi editada.
      })
      .eq('id', profile.profileId)
      .select('id')

    if (dErr || !dRows || dRows.length !== 1) {
      // A assinatura JÁ foi editada; só o profile não persistiu. Enfileira DLQ: o
      // reprocessador acha o mapeamento sub→novo-plano (gravado no passo 2) e reconcilia
      // o profile. NÃO deixar a divergência sub↔profile silenciosa. (P1-4)
      logError('[checkout] Caminho D — assinatura editada mas falha ao atualizar profile (enfileirando recuperação)', dErr, {
        userId: profile.profileId,
        rows: dRows?.length ?? 0,
      })
      try {
        // asaas_webhook_events fora do database.types.ts (DLQ via migration) → cast.
        await (sSupa as unknown as { from: (t: string) => { upsert: (v: unknown, o: unknown) => Promise<unknown> } })
          .from('asaas_webhook_events')
          .upsert({
            event_id: `planchange-recover:${profile.asaasSubscriptionId}`,
            event: 'PAYMENT_CONFIRMED',
            status: 'failed',
            error: 'Caminho D: sub editada mas profile não persistiu — reconciliar profile',
            attempts: 0,
            customer_id: profile.asaasCustomerId ?? null,
            subscription_id: profile.asaasSubscriptionId,
            last_attempt_at: new Date().toISOString(),
          }, { onConflict: 'event_id' })
      } catch (qErr) {
        logError('[checkout] Caminho D — falha ao enfileirar recuperação na DLQ', qErr, { userId: profile.profileId })
      }
      await releaseLock(sSupa, lockKey)
      return NextResponse.json(
        { error: 'Sua assinatura foi alterada, mas houve um erro ao atualizar o plano. Atualize a página em instantes.' },
        { status: 500 }
      )
    }

    // 4) Reconciliar limites de forms: DOWNGRADE pausa os excedentes (handleDowngrade); upgrade
    //    despausa (handleUpgrade). Best-effort (os gates de plano efetivo já protegem mesmo se
    //    falhar). (downgrade liberado — decisão Sidney 2026-06-08.)
    try {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (serviceKey) {
        const pl = await import('@/lib/plan-limits')
        if (change.isPlanDowngrade) {
          // P1 (Codex): passa o PLANO-ALVO — handleDowngrade aplica o limite do alvo (Starter=100,
          // Plus/Pro=ilimitado→nada), não o de free(3). Sem isto, Pro→Plus pausava quase tudo.
          const dg = await pl.handleDowngrade(profile.profileId, serviceKey, plan as PlanId)
          log('[checkout] Caminho D — DOWNGRADE: forms excedentes pausados', { userId: profile.profileId, pausedForms: dg.pausedCount, targetPlan: plan })
        } else {
          const up = await pl.handleUpgrade(profile.profileId, serviceKey)
          log('[checkout] Caminho D — upgrade processado', { userId: profile.profileId, unpausedForms: up.unpausedCount })
        }
      }
    } catch (err) {
      logError('[checkout] handleUpgrade/Downgrade falhou (Caminho D)', err, { userId: profile.profileId })
      // P1-5 (Codex): se era DOWNGRADE, a pausa de forms é crítica → DLQ FORMLIMIT + alerta.
      if (change.isPlanDowngrade) await enqueueFormLimitDLQ(sSupa, profile.profileId, profile.asaasSubscriptionId)
    }

    // Reconciliar: limpa assinaturas órfãs do cliente, MANTENDO a editada (a sub
    // é a mesma; aqui só garantimos que não sobrou nenhuma órfã de fluxos antigos).
    const reconD = await reconcileActiveSubscriptions(profile.asaasCustomerId ?? null, profile.asaasSubscriptionId)
    if (reconD.cancelled.length) {
      log('[checkout] Caminho D — assinaturas órfãs canceladas (reconcile)', { userId: profile.profileId, kept: reconD.kept, cancelled: reconD.cancelled })
    }

    // 5) Confirma a auditoria: profile persistiu → flip da MESMA linha pra 'paid'.
    await sSupa
      .from('billing_checkouts')
      .update({ status: 'paid', last_event: 'PLAN_CHANGE_CREDIT_TIME' })
      .eq('checkout_id', recoveryCheckoutId)

    await releaseLock(sSupa, lockKey)
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
    // Allowlist do origin (P3, audit 2026-06-09): o header vem do cliente — sem validar,
    // qualquer origin spoofado viraria successUrl/cancelUrl do checkout. Só aceita o
    // canônico/app; senão cai no NEXT_PUBLIC_APP_URL.
    const requestOrigin = req.headers.get('origin')
    const allowedOrigins = new Set(
      [process.env.NEXT_PUBLIC_APP_URL, 'https://eidosform.com.br', 'https://www.eidosform.com.br'].filter(Boolean)
    )
    const origin = (requestOrigin && allowedOrigins.has(requestOrigin))
      ? requestOrigin
      : (process.env.NEXT_PUBLIC_APP_URL ?? '')
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
      externalReference: buildExternalReference(profile.profileId, plan, cycle),
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
