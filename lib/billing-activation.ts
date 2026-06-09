/**
 * lib/billing-activation.ts
 * Helpers compartilhados de ativação/expiração de plano usados pelo polling
 * (app/api/checkout/status) e pelo reprocessador de webhooks (lib/asaas-reprocess).
 * Mantém o payload de update em um lugar só para não divergir.
 */
import { PLANS, handleUpgrade } from '@/lib/plan-limits'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PLAN_PRICES,
  cancelSubscription,
  getSubscription,
  reconcileActiveSubscriptions,
  updateSubscription,
  extractCardToken,
} from '@/lib/asaas'
import { log, logError } from '@/lib/logger'

export type BillingCycle = 'MONTHLY' | 'YEARLY'

/** Expiração estimada (now + ciclo). Fallback SEGURO quando não há um nextDueDate real
 *  do Asaas confiável (nunca expira no passado/hoje). */
export function calculateExpiryDate(cycle: BillingCycle): string {
  const now = new Date()
  if (cycle === 'YEARLY') now.setFullYear(now.getFullYear() + 1)
  else now.setDate(now.getDate() + 30)
  return now.toISOString()
}

/**
 * Expiração a partir do `nextDueDate` REAL do Asaas (YYYY-MM-DD): fim do dia (23:59:59) em
 * horário de Brasília (UTC-3), em ISO UTC. Garante acesso durante TODO o dia da próxima
 * cobrança no fuso do cliente — corrige o bug do `T00:00:00Z` (que em BRT cai na véspera à
 * noite, cortando acesso cedo). (P2-7, audit Codex 2026-06-07.)
 *
 * GUARDA DE SEGURANÇA: retorna null se a data for inválida OU NÃO for estritamente futura
 * (> agora). Assim o chamador NUNCA seta uma expiração no passado/hoje — se o Asaas ainda
 * não avançou o nextDueDate logo após o PAYMENT_CONFIRMED, cai no fallback now+ciclo.
 */
export function expiryFromNextDueDate(nextDueDate: string | null | undefined): string | null {
  if (!nextDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextDueDate)) return null
  const d = new Date(`${nextDueDate}T23:59:59-03:00`)
  if (Number.isNaN(d.getTime())) return null
  if (d.getTime() <= Date.now()) return null // nunca expira no passado/hoje
  return d.toISOString()
}

/** Payload de update do profile para ATIVAR um plano pago. */
export function buildActivePlanUpdate(params: {
  plan: string
  cycle: BillingCycle
  customerId?: string | null
  subscriptionId?: string | null
}) {
  const { plan, cycle, customerId, subscriptionId } = params
  const planConfig = PLANS[plan as keyof typeof PLANS]
  return {
    plan,
    plan_cycle: cycle,
    plan_status: 'active',
    plan_expires_at: calculateExpiryDate(cycle),
    limit_alert_sent: false,
    responses_limit: planConfig?.maxResponses ?? 100,
    responses_used: 0,
    ...(customerId ? { asaas_customer_id: customerId } : {}),
    ...(subscriptionId !== undefined ? { asaas_subscription_id: subscriptionId } : {}),
  }
}

/**
 * Reivindica ATOMICAMENTE os "efeitos de ativação" (e-mail "plano ativado" + handleUpgrade)
 * para uma assinatura+plano+ciclo, via insert com unique constraint em asaas_webhook_events.
 * Retorna true só para o PRIMEIRO chamador — os demais (PAYMENT_CONFIRMED+RECEIVED do mesmo
 * pagamento; webhook × polling concorrentes) recebem false e PULAM os efeitos. Dedup durável
 * e atômico (não depende de ler o profile já-atualizado). (#3, audit 2026-06-08.)
 *
 * Falha NÃO-conflito (DB transitório) → retorna true (melhor um e-mail duplicado do que pular
 * o e-mail de uma ativação legítima).
 */
export async function claimActivationEffects(
  db: SupabaseClient,
  subscriptionId: string,
  plan: string,
  cycle: string,
): Promise<boolean> {
  const eventId = `effects:${subscriptionId}:${plan}:${cycle}`
  const { error } = await (db as unknown as {
    from: (t: string) => { insert: (v: unknown) => Promise<{ error: { code?: string } | null }> }
  })
    .from('asaas_webhook_events')
    .insert({ event_id: eventId, event: 'ACTIVATION_EFFECTS', status: 'processed' })
  if (!error) return true
  if (error.code === '23505') return false // já reivindicado por outro evento/caminho
  // Erro transitório (não-conflito): procede (não pular e-mail legítimo).
  log('[billing] claimActivationEffects: erro não-conflito ao reivindicar — procede', { eventId, code: error.code })
  return true
}

export interface FinalizeActivationResult {
  /** true se pulou tudo (sem newSub ou profile já aponta outra sub — fluxo concorrente venceu). */
  skipped: boolean
  cancelledPrevious: boolean
  /** A sub estava num valor != preço cheio (proration-checkout) e precisava de correção. */
  recurringValueNeeded: boolean
  /** A correção do valor recorrente está OK (true também quando não era necessária). */
  recurringValueFixed: boolean
}

/**
 * Finaliza a ativação DEPOIS de o profile já ter sido persistido com o novo plano/sub.
 * Garante NO MÁXIMO 1 assinatura ACTIVE por cliente e corrige o valor RECORRENTE para o
 * preço cheio. É a MESMA rotina nos 3 caminhos de ativação (webhook, polling, reprocesso)
 * — extraída para eliminar a divergência que existia (P1-1/P1-2, audit Codex 2026-06-07):
 * antes, só o webhook cancelava a sub anterior e corrigia o valor recorrente.
 *
 * Idempotente. Recebe um client SERVICE-ROLE (`db`). Operações:
 *  1. Re-lê o profile: só age se ele AINDA aponta para `newSubscriptionId` (se outro fluxo
 *     concorrente já trocou a sub vigente, não faz nada — evita reconcile atrasado cancelar
 *     a sub vencedora).
 *  2. Cancela explicitamente a sub anterior (resolve duplicata do MESMO DIA, que o reconcile
 *     por `dateCreated` date-only não distingue). Best-effort.
 *  3. Reconcile (cancela só órfãs mais antigas que a keep). Best-effort.
 *  4. Corrige o valor recorrente para o preço cheio. Lê a sub primeiro: se já está no preço
 *     cheio (1ª compra / Caminho D), NÃO faz nada (`needed=false`). Se está num valor
 *     diferente (proration-checkout) e a correção falha, retorna `recurringValueFixed=false`
 *     — o chamador decide DLQ/retry (NÃO pode subcobrar na renovação silenciosamente).
 */
export async function finalizeActivation(params: {
  db: SupabaseClient
  userId: string
  customerId: string | null
  newSubscriptionId: string | null
  previousSubscriptionId?: string | null
  plan: string
  cycle: BillingCycle
  source: 'webhook' | 'polling' | 'reprocess' | 'backstop'
}): Promise<FinalizeActivationResult> {
  const { db, userId, customerId, newSubscriptionId, previousSubscriptionId, plan, cycle, source } = params
  const tag = `[${source}] finalizeActivation`
  const noop: FinalizeActivationResult = { skipped: true, cancelledPrevious: false, recurringValueNeeded: false, recurringValueFixed: true }

  if (!newSubscriptionId) return noop

  // (1) Re-leitura: só age se o profile AINDA aponta pra essa sub.
  const { data: fresh } = await db.from('profiles').select('asaas_subscription_id').eq('id', userId).single()
  const freshSub = (fresh as { asaas_subscription_id?: string | null } | null)?.asaas_subscription_id ?? null
  if (freshSub !== newSubscriptionId) {
    log(`${tag} pulado — profile já aponta outra sub (fluxo concorrente venceu)`, { userId, newSubscriptionId, profileSub: freshSub })
    return noop
  }

  // (2) Cancel explícito da sub anterior (duplicata MESMO-DIA).
  let cancelledPrevious = false
  if (previousSubscriptionId && previousSubscriptionId !== newSubscriptionId) {
    try {
      const { data: latest } = await db.from('profiles').select('asaas_subscription_id').eq('id', userId).single()
      if ((latest as { asaas_subscription_id?: string | null } | null)?.asaas_subscription_id === newSubscriptionId) {
        await cancelSubscription(previousSubscriptionId)
        cancelledPrevious = true
        log(`${tag}: sub anterior cancelada explicitamente`, { userId, oldSubscriptionId: previousSubscriptionId, newSubscriptionId })
      } else {
        log(`${tag}: cancel da sub anterior pulado — profile mudou durante a conciliação`, { userId, oldSubscriptionId: previousSubscriptionId, newSubscriptionId })
      }
    } catch (err) {
      logError(`${tag}: falha ao cancelar sub anterior (não-bloqueante)`, err, { userId, oldSubscriptionId: previousSubscriptionId, newSubscriptionId })
    }
  }

  // (3) Reconcile (best-effort).
  const recon = await reconcileActiveSubscriptions(customerId, newSubscriptionId)
  if (recon.cancelled.length || recon.ambiguous.length) {
    log(`${tag}: reconcile`, { userId, kept: recon.kept, cancelled: recon.cancelled, ambiguous: recon.ambiguous })
  }

  // (4) Lê a sub UMA vez (cacheada) e (4a) corrige a expiração pelo nextDueDate real e
  //     (4b) corrige o valor recorrente pro preço cheio.
  const fullPrice = cycle === 'YEARLY'
    ? PLAN_PRICES[plan as keyof typeof PLAN_PRICES]?.yearly
    : PLAN_PRICES[plan as keyof typeof PLAN_PRICES]?.monthly
  let recurringValueNeeded = false
  let recurringValueFixed = true
  try {
    const sub = (await getSubscription(newSubscriptionId)) as { value?: number; nextDueDate?: string; creditCard?: { creditCardToken?: string } }

    // (4a-token) Captura o creditCardToken (tokenização por cliente) p/ permitir RECRIAR a
    // assinatura na reativação pós-cancelamento (a sub é deletada no cancel) sem pedir o cartão
    // de novo. Best-effort, não-bloqueante. (#2b, 2026-06-08.)
    const cardToken = extractCardToken(sub)
    if (cardToken) {
      const { error: tokErr } = await db.from('profiles').update({ asaas_card_token: cardToken }).eq('id', userId)
      if (tokErr) logError(`${tag}: falha ao salvar card token (não-bloqueante)`, tokErr, { userId })
      else log(`${tag}: card token capturado`, { userId, newSubscriptionId })
    }

    // (4a) Expiração a partir do nextDueDate REAL do Asaas (fim do dia BRT), com guarda de
    //      futuro: só ajusta se a data for > agora (senão mantém o now+ciclo seguro posto
    //      pelo buildActivePlanUpdate — nunca expira hoje). Best-effort, não-bloqueante. (P2-7)
    const realExpiry = expiryFromNextDueDate(sub?.nextDueDate)
    if (realExpiry) {
      const { error: expErr } = await db.from('profiles').update({ plan_expires_at: realExpiry }).eq('id', userId)
      if (expErr) logError(`${tag}: falha ao ajustar expiração pelo nextDueDate real (não-bloqueante)`, expErr, { userId, newSubscriptionId })
      else log(`${tag}: expiração ajustada pelo nextDueDate real`, { userId, newSubscriptionId, plan_expires_at: realExpiry })
    }

    // (4b) Valor recorrente → preço cheio (só se diferir; proration-checkout cria prorateado).
    if (fullPrice && fullPrice > 0) {
      const currentValue = typeof sub?.value === 'number' ? sub.value : null
      if (currentValue === null || Math.abs(currentValue - fullPrice) > 0.001) {
        recurringValueNeeded = true
        await updateSubscription(newSubscriptionId, { value: fullPrice, updatePendingPayments: false })
        recurringValueFixed = true
        log(`${tag}: valor recorrente ajustado pro preço cheio`, { userId, subscriptionId: newSubscriptionId, from: currentValue, to: fullPrice })
      }
    }
  } catch (err) {
    // Falha ao ler/ajustar a sub. Se havia correção de valor a fazer, sinaliza DLQ/retry
    // (conservador). A expiração fica no fallback seguro (now+ciclo) — não-crítico.
    if (fullPrice && fullPrice > 0) {
      recurringValueNeeded = true
      recurringValueFixed = false
    }
    logError(`${tag}: falha ao ler/ajustar a assinatura (sinaliza DLQ/retry se havia valor pendente)`, err, { userId, subscriptionId: newSubscriptionId })
  }

  return { skipped: false, cancelledPrevious, recurringValueNeeded, recurringValueFixed }
}

/** Payload de update do profile para REVERTER para o plano free. */
export function buildFreePlanUpdate(newStatus: 'overdue' | 'cancelled' | 'chargeback' | 'refunded') {
  return {
    plan: 'free',
    plan_status: newStatus,
    plan_expires_at: null,
    asaas_subscription_id: null,
    limit_alert_sent: false,
    responses_limit: PLANS.free.maxResponses,
    responses_used: 0,
  }
}

export interface ActivatePaidResult {
  activated: boolean
  alreadyActive: boolean
  recurringValueNeeded: boolean
  recurringValueFixed: boolean
  error?: string
}

/**
 * activatePaidSubscription — rotina ÚNICA de ativação de uma assinatura PAGA, IDEMPOTENTE.
 * Usada pelo BACKSTOP (cron reconcile-checkouts) p/ recuperar "pagamento confirmado mas o app NÃO
 * ativou" (o buraco do incidente 2026-06-09: webhook fora do ar + navegador fechado). Modelada na
 * rotina PROVADA do polling (persistPlanFromAsaas): update profile + checkout paid + handleUpgrade
 * + finalizeActivation. (Consolidar polling/webhook nesta função é follow-up recomendado pelo Codex.)
 *
 * Idempotente: se o profile já está no plano+ciclo+sub corretos, retorna alreadyActive sem mutar.
 * O CALLER deve envolver em lock (acquireLock) p/ evitar corrida com webhook/polling.
 * NUNCA marca sucesso silencioso quando a correção de valor recorrente falha (retorna
 * recurringValueFixed=false → o caller alerta + registra DLQ).
 */
export async function activatePaidSubscription(params: {
  db: SupabaseClient
  userId: string
  customerId: string | null
  subscriptionId: string
  plan: string
  cycle: BillingCycle
  checkoutId?: string | null
  previousSubscriptionId?: string | null
  source: 'webhook' | 'polling' | 'reprocess' | 'backstop'
  currentProfile?: { plan?: string | null; plan_status?: string | null; plan_cycle?: string | null; asaas_subscription_id?: string | null } | null
}): Promise<ActivatePaidResult> {
  const { db, userId, customerId, subscriptionId, plan, cycle, checkoutId, source } = params
  const tag = `[${source}] activatePaidSubscription`

  let cur = params.currentProfile ?? null
  if (cur === null) {
    const { data } = await db.from('profiles').select('plan, plan_status, plan_cycle, asaas_subscription_id').eq('id', userId).single()
    cur = (data as typeof cur) ?? null
  }
  const previousSubId = params.previousSubscriptionId ?? cur?.asaas_subscription_id ?? null

  // IDEMPOTENTE: já ativo no plano+ciclo+sub corretos → noop.
  if (cur?.plan === plan && cur?.plan_status === 'active' && cur?.plan_cycle === cycle && cur?.asaas_subscription_id === subscriptionId) {
    return { activated: false, alreadyActive: true, recurringValueNeeded: false, recurringValueFixed: true }
  }

  // 1) persiste o plano (service-role) — só conta como ativado se gravar 1 linha.
  const { data: rows, error: upErr } = await db
    .from('profiles')
    .update(buildActivePlanUpdate({ plan, cycle, customerId, subscriptionId }) as never)
    .eq('id', userId)
    .select('id')
  if (upErr || !rows || (rows as unknown[]).length !== 1) {
    logError(`${tag}: falha ao persistir plano (0 linhas/erro)`, upErr, { userId, subscriptionId, rows: (rows as unknown[] | null)?.length ?? 0 })
    return { activated: false, alreadyActive: false, recurringValueNeeded: false, recurringValueFixed: true, error: 'persist_failed' }
  }

  // 2) checkout → paid.
  if (checkoutId) {
    const { error: ckErr } = await db.from('billing_checkouts').update({ asaas_subscription_id: subscriptionId, status: 'paid', last_event: 'BACKSTOP_CONFIRMED' } as never).eq('id', checkoutId)
    if (ckErr) logError(`${tag}: falha ao marcar checkout paid (não-bloqueante)`, ckErr, { checkoutId })
  }

  // 3) handleUpgrade (despausa forms) — não-bloqueante.
  try {
    const sk = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (sk) await handleUpgrade(userId, sk)
  } catch (e) {
    log(`${tag}: handleUpgrade falhou (não-bloqueante)`, { error: e instanceof Error ? e.message : String(e) })
  }

  // 4) finalizeActivation: cancel-previous + reconcile + correção de valor recorrente.
  const fin = await finalizeActivation({ db, userId, customerId, newSubscriptionId: subscriptionId, previousSubscriptionId: previousSubId, plan, cycle, source })

  log(`${tag}: ativado`, { userId, subscriptionId, plan, cycle, recurringValueNeeded: fin.recurringValueNeeded, recurringValueFixed: fin.recurringValueFixed })
  return { activated: true, alreadyActive: false, recurringValueNeeded: fin.recurringValueNeeded, recurringValueFixed: fin.recurringValueFixed }
}
