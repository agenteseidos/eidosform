/**
 * POST /api/checkout/[plan]?cycle=monthly|yearly
 * Inicia checkout hospedado do Asaas.
 * Cria/obtém customer e salva asaas_customer_id no profile.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { createCheckout, createCustomer, updateCustomer, buildExternalReference, buildPlanChangeReference, createPaymentWithToken, refundPayment, getPaymentById, findPaymentByExternalReference, PLAN_PRICES, type BillingCycle } from '@/lib/asaas'
import { BILLING_FIELD_LABELS, getBillingProfileForUser, getMissingBillingFields, toAsaasCustomerPayload } from '@/lib/billing-profile'
import { PLAN_ORDER, getEffectivePlan, type PlanId } from '@/lib/plans'
import { computePlanChange, decidePlanChangeAttempt, type PlanChangeRecoveryRow } from '@/lib/plan-change'
import { addDaysToTodayBRT } from '@/lib/proration'
import { executePlanSwitch, nextDueDateAfterFullCycle } from '@/lib/plan-switch'
import { acquireLock, releaseLock } from '@/lib/billing-lock'
import { checkLaunchScope, isCardFallbackEnabled } from '@/lib/billing-launch-guard'
import { openCardFallbackCheckout, type CardFallbackResult } from '@/lib/card-fallback'
import { log, logError } from '@/lib/logger'
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
 * Allowlist do origin (P3, audit 2026-06-09): o header vem do cliente — sem validar,
 * qualquer origin spoofado viraria successUrl/cancelUrl do checkout. Só aceita o
 * canônico/app; senão cai no NEXT_PUBLIC_APP_URL. Compartilhado pela 1ª compra e pelo
 * fallback de cartão morto (sessão DETACHED) — 2026-07-03.
 */
function resolveCallbackOrigin(req: NextRequest): string {
  const requestOrigin = req.headers.get('origin')
  const allowedOrigins = new Set(
    [process.env.NEXT_PUBLIC_APP_URL, 'https://eidosform.com.br', 'https://www.eidosform.com.br'].filter(Boolean)
  )
  return (requestOrigin && allowedOrigins.has(requestOrigin))
    ? requestOrigin
    : (process.env.NEXT_PUBLIC_APP_URL ?? '')
}

/**
 * Mapeia o resultado do openCardFallbackCheckout p/ a resposta HTTP do fallback de cartão
 * morto (2026-07-03). Sucesso → 200 status 'card_fallback' + URL da sessão DETACHED da
 * diferença (o front mostra o interstitial e redireciona); falha → status/código do lib.
 */
function cardFallbackResponse(
  fb: CardFallbackResult,
  ctx: {
    reason: 'CHARGE_FAILED' | 'CARD_TOKEN_REQUIRED'
    proration: { credit: number; originalPrice: number; finalPrice: number }
    plan: string
    cycle: string
  }
): NextResponse {
  if (!fb.ok) {
    return NextResponse.json({ error: fb.error, code: fb.code }, { status: fb.status })
  }
  return NextResponse.json({
    status: 'card_fallback',
    checkoutUrl: fb.checkoutUrl,
    checkoutId: fb.checkoutId,
    value: ctx.proration.finalPrice,
    reason: ctx.reason,
    proration: ctx.proration,
    plan: ctx.plan,
    cycle: ctx.cycle,
  })
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

  // KILL-SWITCH (OFF por padrão desde 2026-06-10): com BILLING_MVP_ONLY=true volta ao modo
  // restrito de emergência (só primeira compra mensal; mudança de plano → 409).
  // Plano EFETIVO (P2-b, audit 2026-06-09): plano pago já EXPIRADO conta como 'free' — sem isto,
  // um cliente vencido que o cron diário ainda não reverteu tomava 409 ao tentar COMPRAR de novo
  // (perda de venda por até 24h).
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // REDESENHO 2026-06-10 (docs/redesenho-upgrade-downgrade.md): mudança de plano/ciclo
  // NUNCA edita assinatura (Asaas prod → 400 invalid_value em sub-cartão já paga).
  // Modelo único: cancelar + recriar a sub no preço CHEIO via creditCardToken
  // (lib/plan-switch.ts), p/ upgrade, downgrade, troca de ciclo e reativação:
  //  - credit_covered (saldo cobre tudo, COM ou SEM sub ativa): sub nova com
  //    nextDueDate = data de cobertura do saldo ("saldo vira tempo") — R$0 agora.
  //  - checkout com proration (diferença a pagar): cobra a DIFERENÇA como pagamento
  //    AVULSO no token; confirmado, troca a sub (ciclo novo começa hoje; recorrência
  //    em +1 ciclo). Se o processo morrer entre cobrar e trocar, o webhook completa
  //    (backstop via kind:planchange no externalReference do avulso).
  // Sem token salvo (assinante pré-tokenização): mensagem honesta — nunca cobra errado.
  // ═══════════════════════════════════════════════════════════════════════════════
  const isTokenPlanChange =
    change.action === 'credit_covered' ||
    (change.action === 'checkout' && !!proration && (Boolean(profile.asaasSubscriptionId) || hasPaidPeriodRemaining))

  if (isTokenPlanChange && proration) {
    const token = profile.asaasCardToken
    const customerId = profile.asaasCustomerId
    const sSupa = getServiceSupabase() ?? supabase

    if (!token || !customerId) {
      // Pré-tokenização (sem token salvo) não tem como recriar a sub sem pedir o cartão.
      // credit_covered mantém a mensagem honesta antiga; mudança paga orienta o suporte.
      if (change.action === 'credit_covered') {
        const expiresFmt = profile.plan_expires_at
          ? new Date(profile.plan_expires_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : null
        return NextResponse.json({
          message: expiresFmt
            ? `Seu saldo atual já cobre este plano. Você mantém o acesso até ${expiresFmt} — para concluir a troca agora, fale com o suporte.`
            : 'Seu saldo atual já cobre este plano. Para concluir a troca agora, fale com o suporte.',
          coveredByCredit: true,
          action: 'covered_no_charge',
        })
      }
      // ── FALLBACK DE CARTÃO MORTO — Site 1: token AUSENTE (2026-07-03) ──
      // Mudança PAGA (change.action === 'checkout' por construção: credit_covered retornou
      // acima) sem token salvo. Sem customerId não há como abrir sessão (anomalia — mantém
      // o 409); flag OFF idem (comportamento atual byte a byte). Flag ON + customer: NÃO
      // retorna — segue pro lock com token null e o Caso 2 abre a sessão DETACHED da
      // diferença em vez de cobrar por token.
      if (!customerId || !isCardFallbackEnabled()) {
        return NextResponse.json(
          { error: 'Sua assinatura foi criada antes da troca automática de planos. Fale com o suporte para concluir a mudança sem custo extra.', code: 'CARD_TOKEN_REQUIRED' },
          { status: 409 }
        )
      }
    }

    // LOCK por profile em volta de TODA a operação (inclusive a cobrança avulsa) — o
    // executor não adquire lock (não-reentrante). 2º POST simultâneo → 409.
    const lockKey = `planchange:${profile.profileId}`
    if (!(await acquireLock(sSupa, lockKey))) {
      return NextResponse.json(
        { error: 'Já estamos processando uma alteração da sua assinatura. Aguarde um instante e tente novamente.' },
        { status: 409 }
      )
    }
    try {
      // ── Caso 1: saldo cobre tudo (Caminho D novo + reativação canceling) — R$0 agora ──
      if (change.action === 'credit_covered') {
        let coverageNextDue = change.nextChargeDate
        if (!coverageNextDue) {
          // Defensivo: computePlanChange sempre define p/ credit_covered.
          coverageNextDue = addDaysToTodayBRT(change.creditCoverageDays ?? 1)
        }
        const result = await executePlanSwitch({
          db: sSupa,
          profileId: profile.profileId,
          customerId,
          // token nunca é null aqui: credit_covered sem token retornou no early-return
          // (covered_no_charge) — só a mudança PAGA (Caso 2/fallback) passa com token null.
          cardToken: token!,
          expectedOldSubscriptionId: profile.asaasSubscriptionId ?? null,
          plan: plan as PlanId,
          cycle,
          nextDueDate: coverageNextDue,
          reason: profile.asaasSubscriptionId ? 'credit_covered' : 'reactivate',
          isPlanDowngrade: change.isPlanDowngrade,
          proration,
        })
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: result.status })
        }
        log('[checkout] Troca coberta pelo saldo — sub recriada via token, sem cobrança agora', {
          userId: profile.profileId, plan, cycle, newSub: result.newSubscriptionId, nextChargeDate: coverageNextDue,
        })
        return NextResponse.json({
          status: 'success',
          coveredByCredit: true,
          reactivated: !profile.asaasSubscriptionId,
          creditCoverageDays: change.creditCoverageDays,
          nextChargeDate: coverageNextDue,
          proration,
        })
      }

      // ── Caso 2: mudança PAGA — avulso da diferença no token + troca ──
      // Linha de recuperação ANTES de cobrar: se o processo morrer depois da cobrança,
      // o webhook (backstop) e a auditoria têm o mapa da intenção.
      const recoveryCheckoutId = `planchange-pay-${profile.profileId}`

      // ── P0-A (2026-06-15): IDEMPOTÊNCIA por TENTATIVA (não por alvo) ──
      // A linha 'recovering' (`planchange-pay-{profile}`) é REUSADA entre trocas do mesmo perfil.
      // Cada tentativa ganha um attemptId único que entra no externalReference do avulso — assim uma
      // troca pro MESMO plano feita antes (já concluída) NUNCA é confundida com esta (evita retomar um
      // avulso velho e PULAR a cobrança nova). Só uma tentativa EM ANDAMENTO da mesma troca (mesmo
      // plan+cycle, status recovering/pending) é continuada → reaproveita attemptId + payment id.
      const { data: prevRow } = await sSupa
        .from('billing_checkouts')
        .select('plan, cycle, status, asaas_payment_id, planchange_attempt_id')
        .eq('checkout_id', recoveryCheckoutId)
        .maybeSingle()
      const { attemptId, savedPaymentId } = decidePlanChangeAttempt(prevRow as PlanChangeRecoveryRow | null, plan, cycle, randomUUID())
      const planChangeRef = `${buildPlanChangeReference(profile.profileId, plan, cycle)}|attempt:${attemptId}`

      // ── FALLBACK DE CARTÃO MORTO — Site 1: token AUSENTE (2026-07-03) ──
      // Chegou aqui sem token (flag ON + customer presente, ver guard antes do lock): não há
      // o que cobrar por token — abre a sessão DETACHED hospedada da diferença. O upsert do
      // openCardFallbackCheckout grava a linha 'pending'/'plan_switch_fallback' ANTES da
      // sessão (fail-closed); a conclusão fica com o backstop (webhook/DLQ/cron).
      if (!token) {
        const fb = await openCardFallbackCheckout(sSupa, {
          profileId: profile.profileId,
          customerId,
          currentSubscriptionId: profile.asaasSubscriptionId ?? null,
          plan: plan as PlanId,
          cycle,
          attemptId,
          proration,
          origin: resolveCallbackOrigin(req),
          reason: 'CARD_TOKEN_REQUIRED',
        })
        return cardFallbackResponse(fb, { reason: 'CARD_TOKEN_REQUIRED', proration, plan, cycle })
      }

      const { error: recErr } = await sSupa
        .from('billing_checkouts')
        .upsert({
          profile_id: profile.profileId,
          checkout_id: recoveryCheckoutId,
          asaas_customer_id: customerId,
          asaas_subscription_id: profile.asaasSubscriptionId ?? null,
          asaas_payment_id: savedPaymentId, // tentativa nova → null (não herda avulso de outra troca)
          planchange_attempt_id: attemptId,
          plan,
          cycle,
          status: 'recovering',
          last_event: 'PLAN_CHANGE_PAID_PENDING',
          payment_method: 'plan_switch_token',
          original_price: proration.originalPrice,
          proration_credit: proration.credit,
          final_price: proration.finalPrice,
          // Retomada via token NÃO herda session id de fallback abandonado: com null, um
          // pagamento tardio da sessão velha cai em session-mismatch → manual (🛡️ P0).
          asaas_checkout_session_id: null,
        }, { onConflict: 'checkout_id' })
      if (recErr) {
        logError('[checkout] Mudança paga — falha ao gravar linha de recuperação; abortando ANTES de cobrar', recErr, { userId: profile.profileId })
        return NextResponse.json({ error: 'Não foi possível alterar sua assinatura agora. Tente novamente.' }, { status: 500 })
      }

      // Se há avulso DESTA tentativa, RETOMAR em vez de cobrar de novo. Primário: asaas_payment_id da
      // mesma tentativa (getPaymentById); fallback: externalReference (único por tentativa via attemptId).
      // Consulta que FALHA → aborta sem cobrar (fail-closed: não cobrar duplicado > conveniência).
      let payment: { id: string; status: string } | null = null
      const lookup = savedPaymentId
        ? await getPaymentById(savedPaymentId)
        : await findPaymentByExternalReference(planChangeRef)
      if (!lookup.ok) {
        logError('[checkout] P0-A: consulta de avulso existente FALHOU; abortando p/ não cobrar duplicado', undefined, { userId: profile.profileId, savedPaymentId })
        return NextResponse.json({ error: 'Não foi possível confirmar o estado do pagamento agora. Tente novamente em instantes.' }, { status: 503 })
      }
      const existing = lookup.payment
      if (existing && (existing.status === 'CONFIRMED' || existing.status === 'RECEIVED')) {
        // Já pago num retry anterior — RETOMA a troca (executePlanSwitch é idempotente via CAS), sem recobrar.
        payment = existing
        await sSupa.from('billing_checkouts').update({ asaas_payment_id: existing.id, last_event: `PLAN_CHANGE_RESUMED_PAID:${existing.id}` }).eq('checkout_id', recoveryCheckoutId)
        log('[checkout] P0-A: avulso já CONFIRMED/RECEIVED — retomando sem cobrar de novo', { userId: profile.profileId, paymentId: existing.id })
      } else if (existing && existing.status === 'PENDING') {
        // Já cobrado, aguardando confirmação — não cobra de novo; o webhook (backstop) completa a troca.
        await sSupa.from('billing_checkouts').update({ status: 'pending', asaas_payment_id: existing.id, last_event: `PLAN_CHANGE_AWAITING_PAYMENT:${existing.id}` }).eq('checkout_id', recoveryCheckoutId)
        log('[checkout] P0-A: avulso já PENDING — webhook completará a troca', { userId: profile.profileId, paymentId: existing.id })
        return NextResponse.json({ status: 'success', processing: true, proration })
      }

      if (!payment) {
        let created: { id: string; status: string }
        try {
          created = await createPaymentWithToken({
            customerId,
            value: proration.finalPrice,
            creditCardToken: token,
            description: `EidosForm — Mudança para Plano ${plan} (${cycle === 'MONTHLY' ? 'Mensal' : 'Anual'}) — diferença prorateada`,
            externalReference: planChangeRef,
          })
        } catch (err) {
          // O throw pode ser FALSO-NEGATIVO (rede caiu DEPOIS de o Asaas criar a cobrança). Antes de
          // declarar falha, confere se o avulso DESTA tentativa existe (externalReference único) — se
          // existir, NÃO cobra de novo (evita cobrança em dobro no retry ambíguo).
          const recheck = await findPaymentByExternalReference(planChangeRef)
          if (recheck.ok && recheck.payment) {
            created = recheck.payment
            log('[checkout] P0-A: createPayment lançou mas o avulso desta tentativa EXISTE — seguindo sem recobrar', { userId: profile.profileId, paymentId: recheck.payment.id })
          } else if (recheck.ok) {
            // recheck OK e NÃO achou → cobrança genuinamente não criada → falha limpa.
            logError('[checkout] Mudança paga — cobrança avulsa FALHOU (avulso não criado)', err, { userId: profile.profileId, plan, cycle, value: proration.finalPrice })
            // ── FALLBACK DE CARTÃO MORTO — Site 2: token MORTO/recusado (2026-07-03) ──
            // Em vez do 402 sem saída, abre a sessão DETACHED hospedada p/ pagar a diferença
            // com OUTRO cartão (mesmo attemptId; o upsert do fallback re-grava a linha como
            // 'pending'/'plan_switch_fallback' + session id). Flag OFF → 402 atual intocado.
            if (isCardFallbackEnabled()) {
              const fb = await openCardFallbackCheckout(sSupa, {
                profileId: profile.profileId,
                customerId,
                currentSubscriptionId: profile.asaasSubscriptionId ?? null,
                plan: plan as PlanId,
                cycle,
                attemptId,
                proration,
                origin: resolveCallbackOrigin(req),
                reason: 'CHARGE_FAILED',
              })
              return cardFallbackResponse(fb, { reason: 'CHARGE_FAILED', proration, plan, cycle })
            }
            await sSupa.from('billing_checkouts').update({ status: 'cancelled', last_event: 'PLAN_CHANGE_CHARGE_FAILED' }).eq('checkout_id', recoveryCheckoutId)
            return NextResponse.json(
              { error: 'Não conseguimos cobrar no seu cartão salvo. Verifique o cartão nas configurações ou fale com o suporte.', code: 'CHARGE_FAILED' },
              { status: 402 }
            )
          } else {
            // NÃO deu p/ verificar se a cobrança caiu (rede). NÃO marca terminal: deixa a tentativa EM
            // ANDAMENTO p/ um retry (mesmo attemptId) reconferir o avulso e não cobrar em dobro.
            logError('[checkout] Mudança paga — cobrança lançou E recheck falhou; mantendo tentativa p/ retry', err, { userId: profile.profileId, plan, cycle })
            return NextResponse.json({ error: 'Não foi possível confirmar a cobrança agora. Tente novamente em instantes.' }, { status: 503 })
          }
        }
        // Persiste o id IMEDIATAMENTE — fecha a janela "crashou entre cobrar e trocar". Se o UPDATE
        // falhar, NÃO bloqueia: o fallback por externalReference (único por tentativa) recupera no retry.
        const { error: payIdErr } = await sSupa.from('billing_checkouts').update({ asaas_payment_id: created.id }).eq('checkout_id', recoveryCheckoutId)
        if (payIdErr) {
          logError('[checkout] P0-A: falha ao persistir asaas_payment_id (fallback por externalReference cobre o retry)', payIdErr, { userId: profile.profileId, paymentId: created.id })
        }
        payment = created
      }

      const paidNow = payment.status === 'CONFIRMED' || payment.status === 'RECEIVED'
      if (!paidNow) {
        // PENDING (raro em cartão+token): o webhook PAYMENT_CONFIRMED do avulso completa
        // a troca (backstop kind:planchange). O overlay de /billing acompanha pelo status.
        await sSupa.from('billing_checkouts').update({ status: 'pending', last_event: `PLAN_CHANGE_AWAITING_PAYMENT:${payment.id}` }).eq('checkout_id', recoveryCheckoutId)
        log('[checkout] Mudança paga — avulso PENDING; webhook completará a troca', { userId: profile.profileId, paymentId: payment.id, plan, cycle })
        return NextResponse.json({ status: 'success', processing: true, proration })
      }

      const nextDueDate = nextDueDateAfterFullCycle(cycle)
      const result = await executePlanSwitch({
        db: sSupa,
        profileId: profile.profileId,
        customerId,
        cardToken: token,
        expectedOldSubscriptionId: profile.asaasSubscriptionId ?? null,
        plan: plan as PlanId,
        cycle,
        nextDueDate,
        reason: 'upgrade_paid',
        isPlanDowngrade: change.isPlanDowngrade,
        proration,
      })
      if (!result.ok) {
        // FAIL-CLOSED: cobramos e a troca não concluiu → ESTORNA o avulso. Nunca ficar
        // com dinheiro sem o plano correspondente.
        try {
          await refundPayment(payment.id)
          await sSupa.from('billing_checkouts').update({ status: 'cancelled', last_event: `PLAN_CHANGE_REFUNDED:${payment.id}` }).eq('checkout_id', recoveryCheckoutId)
          logError('[checkout] Mudança paga — troca falhou após cobrança; avulso ESTORNADO', undefined, { userId: profile.profileId, paymentId: payment.id, code: result.code })
        } catch (refErr) {
          // Dinheiro cobrado, troca falhou E estorno falhou → CRÍTICO: alerta + DLQ p/ ação manual.
          logError('[checkout] CRÍTICO: avulso cobrado, troca E estorno falharam — intervenção manual', refErr, { userId: profile.profileId, paymentId: payment.id })
          await (sSupa as unknown as { from: (t: string) => { upsert: (v: unknown, o: unknown) => Promise<unknown> } })
            .from('asaas_webhook_events')
            .upsert({
              event_id: `planchange-refund:${payment.id}`,
              event: 'PLANCHANGE_REFUND',
              status: 'failed',
              error: 'avulso cobrado; troca e estorno falharam — estornar/concluir manualmente',
              attempts: 0,
              customer_id: customerId,
              last_attempt_at: new Date().toISOString(),
            }, { onConflict: 'event_id' }).catch(() => {})
          await sendBillingOpsAlert({
            subject: 'CRÍTICO billing: avulso de mudança de plano cobrado SEM troca e SEM estorno',
            lines: { userId: profile.profileId, paymentId: payment.id, plan, cycle, value: proration.finalPrice },
          }).catch(() => {})
        }
        return NextResponse.json(
          { error: 'Não foi possível concluir a mudança de plano. A cobrança foi estornada — tente novamente em instantes.' },
          { status: result.status }
        )
      }

      await sSupa.from('billing_checkouts').update({ status: 'paid', last_event: `PLAN_CHANGE_PAID:${payment.id}` }).eq('checkout_id', recoveryCheckoutId)
      log('[checkout] Mudança de plano PAGA concluída (avulso + cancelar/recriar via token)', {
        userId: profile.profileId, plan, cycle, paymentId: payment.id, newSub: result.newSubscriptionId, nextDueDate,
      })
      return NextResponse.json({ status: 'success', changed: true, nextChargeDate: nextDueDate, proration })
    } finally {
      await releaseLock(sSupa, lockKey)
    }
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
    const price = basePrice
    // Origin validado pela allowlist (hoistado p/ resolveCallbackOrigin — compartilhado
    // com o fallback de cartão morto).
    const origin = resolveCallbackOrigin(req)
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
      externalReference: buildExternalReference(profile.profileId, plan, cycle),
    })
    log('[checkout] Checkout hospedado criado', { plan, cycle, value: price, flow: 'checkout', checkoutId: checkout.id, profileId: profile.profileId })

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
    })
  } catch (err) {
    logError('[checkout] Erro ao processar checkout', err)
    const message = err instanceof Error ? err.message : 'Erro interno ao processar checkout'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
