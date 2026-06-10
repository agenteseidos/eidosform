/**
 * lib/plan-switch.ts — EXECUTOR único do redesenho de mudança de plano (2026-06-10).
 *
 * Modelo: NUNCA editar valor de assinatura (Asaas prod → `400 invalid_value` em sub-cartão
 * já paga). Toda mudança de plano/ciclo é "cancelar + recriar via creditCardToken":
 *   1. cria a assinatura NOVA no preço CHEIO com o token salvo, `nextDueDate` = quando a
 *      próxima cobrança recorrente deve ocorrer (fim do ciclo pago pelo avulso, ou a data
 *      de cobertura do saldo quando o crédito vira tempo);
 *   2. troca o profile de forma ATÔMICA (CAS no asaas_subscription_id — concorrência perde);
 *   3. aplica limites de forms (downgrade pausa excedentes, com retry + DLQ FORMLIMIT);
 *   4. reconcileActiveSubscriptions cancela a sub ANTIGA (e qualquer órfã), mantendo a nova.
 *
 * Reusado por: checkout (Caminho D, reativação canceling, upgrade/downgrade pago) e pelo
 * BACKSTOP do webhook (avulso `kind:planchange` confirmado com troca ainda não aplicada).
 *
 * ⚠️ LOCK: este executor NÃO adquire lock — o CHAMADOR deve segurar `planchange:{profileId}`
 * (lib/billing-lock) em volta de toda a operação (inclusive a cobrança avulsa, se houver).
 * O lock não é reentrante; adquirir aqui dentro causaria deadlock no fluxo pago.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSubscriptionWithToken, cancelSubscription, reconcileActiveSubscriptions, buildExternalReference, PLAN_PRICES, type BillingCycle } from '@/lib/asaas'
import { expiryFromNextDueDate } from '@/lib/billing-activation'
import { acquireLock, releaseLock } from '@/lib/billing-lock'
import { PLANS } from '@/lib/plan-definitions'
import { PLAN_ORDER, type PlanId } from '@/lib/plans'
import { log, logError } from '@/lib/logger'
import { sendBillingOpsAlert } from '@/lib/resend'

export interface PlanSwitchParams {
  /** Client service-role (escritas de billing não passam pela RLS do usuário). */
  db: SupabaseClient
  profileId: string
  customerId: string
  cardToken: string
  /**
   * CAS: o asaas_subscription_id que o profile TINHA quando a decisão foi tomada
   * (null p/ canceling/reativação). Se o profile mudou nesse meio-tempo, abortamos
   * sem tocar em nada — outro fluxo venceu.
   */
  expectedOldSubscriptionId: string | null
  plan: PlanId
  cycle: BillingCycle
  /** YYYY-MM-DD — primeira cobrança RECORRENTE da assinatura nova (preço cheio). */
  nextDueDate: string
  /** Origem (telemetria + checkout_id estável p/ overlay/recuperação). */
  reason: 'upgrade_paid' | 'credit_covered' | 'reactivate' | 'webhook_backstop'
  isPlanDowngrade: boolean
  proration?: { credit: number; originalPrice: number; finalPrice: number } | null
}

export type PlanSwitchResult =
  | { ok: true; newSubscriptionId: string }
  | { ok: false; status: number; error: string; code: string }

/** Preço CHEIO do plano/ciclo (a sub nova é SEMPRE criada neste valor). */
export function fullPriceOf(plan: PlanId, cycle: BillingCycle): number {
  const p = PLAN_PRICES[plan as keyof typeof PLAN_PRICES]
  if (!p) return 0
  return cycle === 'YEARLY' ? p.yearly : p.monthly
}

/**
 * YYYY-MM-DD de hoje + 1 ciclo (30/365 dias — mesmas constantes da proration, que casa
 * com o ciclo de cobrança do Asaas). É o nextDueDate do upgrade PAGO: o avulso comprou
 * um ciclo cheio do plano novo começando agora.
 */
export function nextDueDateAfterFullCycle(cycle: BillingCycle, from = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + (cycle === 'YEARLY' ? 365 : 30))
  return d.toISOString().split('T')[0]
}

/**
 * P1-5 (Codex): no DOWNGRADE, pausar os forms excedentes é crítico. Retry imediato e,
 * persistindo a falha, DLQ FORMLIMIT (reprocessável) + alerta — nunca silencioso.
 */
async function applyFormLimits(db: SupabaseClient, profileId: string, plan: PlanId, isDowngrade: boolean, newSubId: string, tag: string) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return
  const pl = await import('@/lib/plan-limits')
  if (!isDowngrade) {
    try {
      const up = await pl.handleUpgrade(profileId, serviceKey)
      log(`${tag}: upgrade de limites aplicado`, { profileId, unpausedForms: up.unpausedCount })
    } catch (e) {
      // Upgrade de limites é best-effort (gates de plano efetivo protegem o acesso).
      logError(`${tag}: handleUpgrade falhou (best-effort)`, e, { profileId })
    }
    return
  }
  let applied = false
  for (let attempt = 1; !applied && attempt <= 2; attempt++) {
    try {
      const dg = await pl.handleDowngrade(profileId, serviceKey, plan)
      log(`${tag}: downgrade — forms excedentes pausados`, { profileId, pausedForms: dg.pausedCount, targetPlan: plan, attempt })
      applied = true
    } catch (e) {
      logError(`${tag}: handleDowngrade falhou (tentativa ${attempt}/2)`, e, { profileId, targetPlan: plan })
    }
  }
  if (!applied) {
    try {
      await (db as unknown as { from: (t: string) => { upsert: (v: unknown, o: unknown) => Promise<unknown> } })
        .from('asaas_webhook_events')
        .upsert({
          event_id: `formlimit:${profileId}`,
          event: 'FORMLIMIT',
          status: 'failed',
          error: 'handleDowngrade falhou — re-aplicar limites de forms do plano-alvo',
          attempts: 0,
          subscription_id: newSubId,
          last_attempt_at: new Date().toISOString(),
        }, { onConflict: 'event_id' })
    } catch { /* best-effort */ }
    await sendBillingOpsAlert({
      subject: 'Plan switch: falha ao pausar forms excedentes — DLQ FORMLIMIT (reprocessar)',
      lines: { profileId, newSubId, targetPlan: plan },
    }).catch(() => {})
  }
}

export async function executePlanSwitch(params: PlanSwitchParams): Promise<PlanSwitchResult> {
  const { db, profileId, customerId, cardToken, expectedOldSubscriptionId, plan, cycle, nextDueDate, reason, isPlanDowngrade, proration } = params
  const tag = `[plan-switch:${reason}]`

  // CAS pré-voo: o profile ainda está no estado em que a decisão foi tomada?
  const { data: casRow } = await db
    .from('profiles')
    .select('asaas_subscription_id')
    .eq('id', profileId)
    .single()
  const currentSub = (casRow as { asaas_subscription_id?: string | null } | null)?.asaas_subscription_id ?? null
  if (currentSub !== expectedOldSubscriptionId) {
    log(`${tag}: CAS pré-voo divergiu — outro fluxo mexeu na assinatura; abortando sem tocar no Asaas`, {
      profileId, expected: expectedOldSubscriptionId, got: currentSub,
    })
    return { ok: false, status: 409, error: 'Sua assinatura mudou enquanto processávamos. Recarregue a página e tente novamente.', code: 'CAS_PRECHECK' }
  }

  // 1) Cria a sub NOVA no preço CHEIO via token. Se falhar aqui, nada mudou (fail-closed).
  const fullPrice = fullPriceOf(plan, cycle)
  if (!fullPrice) return { ok: false, status: 400, error: 'Plano inválido', code: 'INVALID_PLAN' }
  let newSub: { id: string }
  try {
    newSub = await createSubscriptionWithToken({
      customerId,
      value: fullPrice,
      cycle,
      nextDueDate,
      creditCardToken: cardToken,
      description: `EidosForm — Plano ${plan} (${cycle === 'MONTHLY' ? 'Mensal' : 'Anual'})`,
      externalReference: buildExternalReference(profileId, plan, cycle),
    })
  } catch (err) {
    logError(`${tag}: falha ao criar a assinatura nova via token — nada foi alterado`, err, { profileId, plan, cycle })
    return { ok: false, status: 502, error: 'Não foi possível alterar sua assinatura agora. Tente novamente.', code: 'CREATE_SUB_FAILED' }
  }

  // 2) Troca ATÔMICA do profile (CAS no asaas_subscription_id). Perdeu a corrida → cancela
  //    a sub recém-criada (não deixar cobrança fantasma) e aborta.
  const planConfig = PLANS[plan]
  const expiry = expiryFromNextDueDate(nextDueDate) ?? new Date(`${nextDueDate}T00:00:00.000Z`).toISOString()
  let q = db
    .from('profiles')
    .update({
      plan,
      plan_cycle: cycle,
      plan_status: 'active',
      plan_expires_at: expiry,
      asaas_subscription_id: newSub.id,
      responses_limit: planConfig?.maxResponses ?? 100,
      responses_used: 0,
      limit_alert_sent: false,
    })
    .eq('id', profileId)
  q = expectedOldSubscriptionId === null
    ? q.is('asaas_subscription_id', null)
    : q.eq('asaas_subscription_id', expectedOldSubscriptionId)
  const { data: rows, error: upErr } = await q.select('id')
  if (upErr || !rows || rows.length !== 1) {
    logError(`${tag}: CAS falhou/profile não persistiu — cancelando a sub nova p/ não cobrar fantasma`, upErr, {
      profileId, newSub: newSub.id, rows: rows?.length ?? 0,
    })
    await cancelSubscription(newSub.id).catch((e) => {
      logError(`${tag}: CRÍTICO — não conseguiu cancelar a sub fantasma (cancelar MANUALMENTE no Asaas)`, e, { profileId, newSub: newSub.id })
    })
    return { ok: false, status: 409, error: 'Não foi possível concluir agora. Recarregue e tente novamente.', code: 'CAS_COMMIT' }
  }

  // 3) Limites de forms (downgrade pausa excedentes — crítico, com DLQ).
  await applyFormLimits(db, profileId, plan, isPlanDowngrade, newSub.id, tag)

  // 4a) Cancela a sub ANTIGA **explicitamente** (P0-1, revisão adversarial 2026-06-10):
  //     o reconcile NÃO cancela sub de MESMO DIA com VALOR diferente (ambígua por design —
  //     dateCreated do Asaas tem granularidade de dia), e TODA troca de plano same-day cai
  //     exatamente nesse caso → ficariam 2 subs ACTIVE = cobrança dupla em ~30d. Aqui é
  //     seguro cancelar sem ambiguidade: o CAS provou que o profile apontava p/ ela e agora
  //     aponta p/ a nova. Retry 1x; persistindo, DLQ CANCEL_OLDSUB + alerta (money-path,
  //     nunca silencioso) — espelha o cancel explícito do finalizeActivation.
  if (expectedOldSubscriptionId && expectedOldSubscriptionId !== newSub.id) {
    let oldCancelled = false
    for (let attempt = 1; !oldCancelled && attempt <= 2; attempt++) {
      try {
        await cancelSubscription(expectedOldSubscriptionId)
        oldCancelled = true
        log(`${tag}: sub antiga cancelada explicitamente`, { profileId, oldSub: expectedOldSubscriptionId, newSub: newSub.id, attempt })
      } catch (e) {
        // Pode falhar porque a sub JÁ estava cancelada (o cancel lança em já-deletada) —
        // o reprocessador do CANCEL_OLDSUB confere o status real e dá noop se não-ACTIVE.
        logError(`${tag}: falha ao cancelar a sub antiga (tentativa ${attempt}/2)`, e, { profileId, oldSub: expectedOldSubscriptionId })
      }
    }
    if (!oldCancelled) {
      try {
        await (db as unknown as { from: (t: string) => { upsert: (v: unknown, o: unknown) => Promise<unknown> } })
          .from('asaas_webhook_events')
          .upsert({
            event_id: `cancel-oldsub:${expectedOldSubscriptionId}`,
            event: 'CANCEL_OLDSUB',
            status: 'failed',
            error: 'sub antiga não cancelada após troca de plano — cancelar p/ evitar cobrança dupla',
            attempts: 0,
            subscription_id: expectedOldSubscriptionId,
            customer_id: customerId,
            last_attempt_at: new Date().toISOString(),
          }, { onConflict: 'event_id' })
      } catch { /* best-effort */ }
      await sendBillingOpsAlert({
        subject: 'Troca de plano: sub ANTIGA não cancelada — risco de cobrança dupla (DLQ CANCEL_OLDSUB)',
        lines: { profileId, oldSubscriptionId: expectedOldSubscriptionId, newSubscriptionId: newSub.id, plan, cycle },
      }).catch(() => {})
    }
  }

  // 4b) Reconcile: varre órfãs restantes, mantendo SÓ a nova.
  const recon = await reconcileActiveSubscriptions(customerId, newSub.id)
  if (recon.cancelled.length || recon.ambiguous.length) {
    log(`${tag}: reconcile pós-troca`, { profileId, kept: recon.kept, cancelled: recon.cancelled, ambiguous: recon.ambiguous })
  }

  // 5) Auditoria/overlay: marca um checkout 'paid' p/ o /status e o overlay de sucesso.
  const { error: ckErr } = await (db as unknown as { from: (t: string) => { upsert: (v: unknown, o: unknown) => Promise<{ error: unknown }> } })
    .from('billing_checkouts')
    .upsert({
      profile_id: profileId,
      checkout_id: `planswitch-${profileId}-${newSub.id}`,
      asaas_customer_id: customerId,
      asaas_subscription_id: newSub.id,
      plan,
      cycle,
      status: 'paid',
      last_event: `PLAN_SWITCH_${reason.toUpperCase()}`,
      payment_method: 'plan_switch_token',
      ...(proration ? {
        original_price: proration.originalPrice,
        proration_credit: proration.credit,
        final_price: proration.finalPrice,
      } : {}),
    }, { onConflict: 'checkout_id' })
  if (ckErr) logError(`${tag}: falha ao gravar checkout paid (overlay pode mostrar estado antigo)`, ckErr, { profileId })

  log(`${tag}: plano trocado via cancelar+recriar`, { profileId, plan, cycle, newSub: newSub.id, nextDueDate, oldSub: expectedOldSubscriptionId })
  return { ok: true, newSubscriptionId: newSub.id }
}

/**
 * BACKSTOP da mudança de plano PAGA: o checkout cobra o AVULSO da diferença e troca a
 * sub de forma síncrona. Se o processo morrer entre a cobrança e a troca (ou o avulso
 * confirmar async), isto completa a troca quando o PAYMENT_CONFIRMED do avulso chegar
 * (webhook) ou no retry da DLQ (reprocessador). IDEMPOTENTE: profile já no plano-alvo
 * com sub vinculada → noop. Falha transitória → throw (o chamador marca failed/retry).
 */
export async function runPlanChangeBackstop(db: SupabaseClient, params: {
  profileId: string
  plan: string
  cycle: BillingCycle
  /** Id do avulso (ou do evento DLQ no reprocesso) — só auditoria. */
  paymentId: string
  source: 'webhook' | 'reprocess'
}): Promise<'already_applied' | 'switched'> {
  const { profileId, plan, cycle, paymentId, source } = params
  const tag = `[planchange-backstop:${source}]`

  const { data: prof } = await db
    .from('profiles')
    .select('plan, plan_cycle, asaas_subscription_id, asaas_customer_id, asaas_card_token')
    .eq('id', profileId)
    .single()
  const p = prof as { plan?: string | null; plan_cycle?: string | null; asaas_subscription_id?: string | null; asaas_customer_id?: string | null; asaas_card_token?: string | null } | null
  if (!p) {
    throw new Error(`${tag} profile ${profileId} não encontrado — retry`)
  }

  // Caminho síncrono já aplicou a troca → nada a fazer (caso comum).
  if (p.plan === plan && (p.plan_cycle ?? 'MONTHLY') === cycle && p.asaas_subscription_id) {
    log(`${tag}: troca já aplicada pelo fluxo síncrono — backstop não necessário`, { profileId, plan, cycle, paymentId })
    return 'already_applied'
  }

  if (!p.asaas_card_token || !p.asaas_customer_id) {
    // Avulso pago e não há como recriar a sub — intervenção manual (estorno/conclusão).
    await sendBillingOpsAlert({
      subject: 'Backstop planchange: avulso pago mas SEM token/customer p/ concluir a troca — ação manual',
      lines: { profileId, plan, cycle, paymentId },
    }).catch(() => {})
    throw new Error(`${tag} avulso ${paymentId} pago mas profile ${profileId} sem card token/customer — ação manual`)
  }

  // O fluxo síncrono pode estar em andamento AGORA — lock ocupado = deixa o retry
  // re-checar depois (se o síncrono concluiu, o guard de idempotência acima resolve).
  const lockKey = `planchange:${profileId}`
  if (!(await acquireLock(db, lockKey))) {
    throw new Error(`${tag} lock ocupado (fluxo síncrono em andamento?) — retry`)
  }
  try {
    const targetIdx = PLAN_ORDER.indexOf(plan as PlanId)
    const currentIdx = PLAN_ORDER.indexOf((p.plan ?? 'free') as PlanId)
    const result = await executePlanSwitch({
      db,
      profileId,
      customerId: p.asaas_customer_id,
      cardToken: p.asaas_card_token,
      expectedOldSubscriptionId: p.asaas_subscription_id ?? null,
      plan: plan as PlanId,
      cycle,
      // Drift: se a DLQ reprocessar dias depois, o ciclo conta a partir de AGORA —
      // favorece o cliente (nunca encurta o que ele pagou). Logado p/ auditoria.
      nextDueDate: nextDueDateAfterFullCycle(cycle),
      reason: 'webhook_backstop',
      isPlanDowngrade: targetIdx >= 0 && currentIdx >= 0 && targetIdx < currentIdx,
    })
    if (!result.ok) {
      throw new Error(`${tag} executePlanSwitch falhou (${result.code}): ${result.error} — retry`)
    }
    await db
      .from('billing_checkouts')
      .update({ status: 'paid', last_event: `PLAN_CHANGE_PAID_BACKSTOP:${paymentId}` })
      .eq('checkout_id', `planchange-pay-${profileId}`)
    log(`${tag}: troca concluída pelo backstop`, { profileId, plan, cycle, paymentId, newSub: result.newSubscriptionId })
    return 'switched'
  } finally {
    await releaseLock(db, lockKey)
  }
}
