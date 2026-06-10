/**
 * lib/asaas-reprocess.ts
 * Reprocessamento manual (DLQ) de webhooks do Asaas que falharam ao processar.
 *
 * Estratégia: DIRIGIDO PELO TIPO DO EVENTO (espelha o switch do webhook), NÃO por
 * status puro. Eventos de ATIVAÇÃO (PAYMENT_CONFIRMED/RECEIVED) só ativam após
 * CONFIRMAR `status=ACTIVE` no Asaas; eventos de REVERSÃO (overdue/deleted/refund/
 * chargeback/inactivated) revertem p/ free. Assim um evento de ativação NUNCA reverte
 * (Codex ponto 1 — profile 'free' pode ser justamente o sintoma do bug que impediu a
 * ativação, então 'free' não bloqueia ativar) e um overdue/refund nunca reativa.
 * NÃO replica o payload (não é guardado, p/ evitar PII): usa só customer_id/
 * subscription_id p/ achar o profile. Idempotente. Disparado pelo endpoint admin
 * (app/api/admin/asaas/reprocess).
 *
 * Erro ao ler a assinatura: 404 = definitivo (assinatura não existe → 'NOT_FOUND');
 * 5xx/rede = transitório → RELANÇA (mantém 'failed' p/ retry), NUNCA assume inativo
 * (evita rebaixar um pagante por falha de rede).
 *
 * Limitação aceita nesta rodada (enxuto): refund/chargeback é tratado como reversão
 * → reverte p/ free (com guards de já-free e mismatch de assinatura). Bordas raras
 * (ex.: refund parcial com sub ainda ACTIVE que deveria manter acesso) ficam para
 * tratamento MANUAL — o evento permanece visível na lista de failed/dead do admin.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSubscription, resolvePlanCycleFromSubscription, alignPendingPaymentsDueDate } from '@/lib/asaas'
import { handleUpgrade, handleDowngrade } from '@/lib/plan-limits'
import { buildActivePlanUpdate, buildFreePlanUpdate, finalizeActivation, isExpectedFullPrice, type BillingCycle } from '@/lib/billing-activation'
import { sendPlanActivated, sendPlanCancelled } from '@/lib/resend'
import { log, logError } from '@/lib/logger'

const MAX_ATTEMPTS = 5

// Espelha o switch do webhook (app/api/webhooks/asaas/route.ts).
const ACTIVATION_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])
// #2 (audit 2026-06-08): REFUND/DELETE NÃO estão aqui — o webhook não rebaixa nesses eventos
// (refund parcial/ambíguo não deve cancelar; vai p/ alerta manual). O reprocessador espelha:
// PAYMENT_REFUNDED/PAYMENT_DELETED viram noop (não revertem). Só estes rebaixam:
const REVERSION_EVENTS = new Set([
  'PAYMENT_OVERDUE',
  'SUBSCRIPTION_DELETED',
  'SUBSCRIPTION_INACTIVATED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
])
const REFUND_NOOP_EVENTS = new Set(['PAYMENT_REFUNDED', 'PAYMENT_DELETED'])

/**
 * Lê o status da assinatura no Asaas. Distingue 404 (definitivo → 'NOT_FOUND') de
 * erro transitório (5xx/rede → RELANÇA, p/ o evento continuar 'failed' e ser
 * retentado, em vez de assumir inativo e rebaixar um pagante).
 */
async function getAsaasStatus(subscriptionId: string): Promise<string> {
  try {
    const sub = await getSubscription(subscriptionId)
    return String((sub as { status?: string })?.status ?? 'UNKNOWN').toUpperCase()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/error 404/i.test(msg)) return 'NOT_FOUND' // assinatura não existe → definitivo
    throw new Error(`getSubscription transitório (mantém failed p/ retry): ${msg}`)
  }
}

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE service-role env ausente (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export interface FailedEvent {
  event_id: string
  event: string
  customer_id: string | null
  subscription_id: string | null
  attempts: number
  error: string | null
  last_attempt_at: string | null
}

export interface ReprocessResult {
  eventId: string
  ok: boolean
  action: string
  detail?: string
}

/** Lista eventos com status='failed' ainda reprocessáveis (attempts < MAX). */
export async function listFailedEvents(limit = 50): Promise<FailedEvent[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('asaas_webhook_events')
    .select('event_id, event, customer_id, subscription_id, attempts, error, last_attempt_at')
    .eq('status', 'failed')
    .lt('attempts', MAX_ATTEMPTS)
    .order('last_attempt_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`listFailedEvents: ${error.message}`)
  return (data ?? []) as FailedEvent[]
}

interface CheckoutRow {
  id: string
  profile_id: string
  plan: string
  cycle: string | null
}

async function findCheckout(
  supabase: SupabaseClient,
  keys: { customerId: string | null; subscriptionId: string | null }
): Promise<CheckoutRow | null> {
  const { customerId, subscriptionId } = keys
  if (subscriptionId) {
    const { data } = await supabase
      .from('billing_checkouts')
      .select('id, profile_id, plan, cycle')
      .eq('asaas_subscription_id', subscriptionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return data as CheckoutRow
  }
  if (customerId) {
    const { data } = await supabase
      .from('billing_checkouts')
      .select('id, profile_id, plan, cycle')
      .eq('asaas_customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return data as CheckoutRow
  }
  return null
}

/** Reconcilia o profile ao estado real do Asaas. Lança em falha (p/ marcar attempts). */
async function reconcile(supabase: SupabaseClient, row: FailedEvent): Promise<string> {
  const customerId = row.customer_id
  const subscriptionId = row.subscription_id
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const ev = (row.event ?? '').toUpperCase()

  // ── ALIGN_PENDING (DLQ do Caminho D, P0-1b Codex): alinha os pagamentos PENDING ao nextDueDate
  // ATUAL da assinatura (que já está correto após o PUT). Não precisa de checkout/profile.
  if (ev === 'ALIGN_PENDING') {
    if (!subscriptionId) return 'noop_align_sem_subscription'
    const subA = (await getSubscription(subscriptionId)) as { nextDueDate?: string }
    if (!subA?.nextDueDate) return 'noop_align_sem_nextduedate'
    const r = await alignPendingPaymentsDueDate(subscriptionId, subA.nextDueDate)
    if (r.failed > 0) throw new Error(`ALIGN_PENDING: ${r.failed} pagamentos ainda não alinhados — mantém failed p/ retry`)
    log('[asaas-reprocess] ALIGN_PENDING: pagamentos pendentes alinhados', { subscriptionId, moved: r.moved, nextDueDate: subA.nextDueDate })
    return 'aligned'
  }

  // ── FORMLIMIT (DLQ do downgrade, P1-5 Codex): re-aplica os limites de forms do PLANO ATUAL do
  // profile (que já é o plano-alvo após a troca). Acha o profile pela sub/customer.
  if (ev === 'FORMLIMIT') {
    const { data: prof } = subscriptionId
      ? await supabase.from('profiles').select('id, plan').eq('asaas_subscription_id', subscriptionId).maybeSingle()
      : await supabase.from('profiles').select('id, plan').eq('asaas_customer_id', customerId ?? '').maybeSingle()
    if (!prof) return 'noop_formlimit_profile_nao_encontrado'
    await handleDowngrade((prof as { id: string }).id, serviceKey, (prof as { plan: string }).plan as Parameters<typeof handleDowngrade>[2]) // lança se falhar → retry
    log('[asaas-reprocess] FORMLIMIT: limites de forms re-aplicados', { profileId: (prof as { id: string }).id, plan: (prof as { plan: string }).plan })
    return 'formlimit_reaplicado'
  }

  if (!subscriptionId && !customerId) throw new Error('evento sem customer_id/subscription_id — não dá pra reconciliar')

  const checkout = await findCheckout(supabase, { customerId, subscriptionId })
  if (!checkout) throw new Error('billing_checkout não encontrado p/ as chaves do evento')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, plan, asaas_subscription_id')
    .eq('id', checkout.profile_id)
    .single()
  if (!profile) throw new Error('profile não encontrado')

  // ── EVENTO DE ATIVAÇÃO ──────────────────────────────────────────────
  // Só ativa após CONFIRMAR ACTIVE no Asaas. Sem subscriptionId ou não-ACTIVE → noop.
  // NUNCA reverte aqui (Codex ponto 1): profile 'free' pode ser o próprio sintoma do
  // bug que impediu a ativação, então 'free' NÃO bloqueia ativar.
  if (ACTIVATION_EVENTS.has(ev)) {
    if (!subscriptionId) return 'noop_activation_sem_subscription'
    const asaasStatus = await getAsaasStatus(subscriptionId) // relança em erro transitório → retry
    if (asaasStatus !== 'ACTIVE') return 'noop_activation_nao_active'

    // Sub vigente ANTES desta ativação — pro finalizeActivation cancelar a anterior.
    const previousSubId = (profile as { asaas_subscription_id?: string | null }).asaas_subscription_id ?? null

    // Pivô (P2, audit Codex 2026-06-08): resolve plano/ciclo pela ASSINATURA paga
    // (valor/descrição), não confiando só no checkout record (pode estar errado/ausente).
    // getSubscription é cacheado (já foi chamado em getAsaasStatus). Fallback no checkout.
    let subData: { value?: number; cycle?: string; description?: string } | null = null
    try {
      subData = (await getSubscription(subscriptionId)) as { value?: number; cycle?: string; description?: string }
    } catch {
      // usa o checkout record como fallback
    }
    const resolved = resolvePlanCycleFromSubscription(subData)
    const plan = resolved?.plan ?? checkout.plan
    const cycle = (resolved?.cycle ?? checkout.cycle ?? 'MONTHLY') as BillingCycle

    // GUARD de preço-cheio (P1, audit 2026-06-09): o retry da DLQ NÃO pode ser porta dos
    // fundos — webhook/polling/backstop só ativam sub no preço CHEIO (Asaas prod bloqueia
    // corrigir o valor recorrente → sub prorateada ativada = desconto eterno). Sem valor
    // lido = transitório → relança (retry); valor lido != cheio = prorateado → relança com
    // mensagem explícita (vira 'dead' após MAX_ATTEMPTS e fica visível p/ revisão manual).
    const subVal = typeof subData?.value === 'number' ? subData.value : null
    if (subVal === null) {
      throw new Error(`não foi possível ler o valor da sub ${subscriptionId} (transitório) — mantém failed p/ retry`)
    }
    if (!isExpectedFullPrice(subVal, plan, cycle)) {
      throw new Error(`sub ${subscriptionId} prorateada (R$${subVal} != preço cheio ${plan}/${cycle}) — NÃO ativa automaticamente; revisar manual`)
    }

    const { data: actRows, error: actErr } = await supabase
      .from('profiles')
      .update(buildActivePlanUpdate({ plan, cycle, customerId, subscriptionId }))
      .eq('id', profile.id)
      .select('id')
    if (actErr || !actRows || actRows.length !== 1) throw new Error(`ativar plano falhou (rows=${actRows?.length ?? 0}): ${actErr?.message ?? 'sem erro DB'}`)

    await supabase
      .from('billing_checkouts')
      .update({ status: 'paid', last_event: 'REPROCESS_CONFIRMED', asaas_subscription_id: subscriptionId })
      .eq('id', checkout.id)

    // handleUpgrade SEMPRE (idempotente) — completa o despause mesmo quando o evento original
    // já reivindicou os efeitos no webhook mas FALHOU ao despausar (foi pra DLQ). Sem isto, um
    // profile já-ativo não teria os forms despausados na recuperação. (#2, audit 2026-06-08.)
    await handleUpgrade(profile.id, serviceKey)
    // E-mail só em transição (não reenvia em renovação/reprocesso de já-ativo).
    if (profile.plan === 'free' || profile.plan !== plan) {
      await sendPlanActivated({ to: profile.email, name: profile.full_name ?? 'usuário', plan })
        .catch((e) => logError('[asaas-reprocess] email ativação falhou', e))
    }

    // Finaliza ativação: cancel-previous + reconcile + correção de valor recorrente —
    // MESMA rotina do webhook e do polling (helper compartilhado). Antes, o reprocesso só
    // ativava (P1-1/P1-2 valiam aqui também) — audit Codex 2026-06-07.
    const fin = await finalizeActivation({
      db: supabase,
      userId: profile.id,
      customerId,
      newSubscriptionId: subscriptionId,
      previousSubscriptionId: previousSubId,
      plan,
      cycle,
      source: 'reprocess',
    })
    // Correção de valor recorrente necessária mas falhou → RELANÇA: mantém o evento 'failed'
    // (reprocessEvent incrementa attempts) p/ nova tentativa. NUNCA subcobrar na renovação.
    if (fin.recurringValueNeeded && !fin.recurringValueFixed) {
      throw new Error(`correção de valor recorrente pendente (sub ${subscriptionId}) — mantém failed p/ retry`)
    }
    log('[asaas-reprocess] plano ativado via reprocesso', { profileId: profile.id, plan })
    return 'activated'
  }

  // ── REFUND/DELETE: NÃO reverte (#2) — espelha o webhook (refund parcial/ambíguo não
  // cancela). Fica como noop p/ revisão manual; não derruba acesso.
  if (REFUND_NOOP_EVENTS.has(ev)) {
    log('[asaas-reprocess] refund/delete — acesso mantido, revisão manual (não reverte)', { event: ev, profileId: profile.id })
    return 'noop_refund_manual'
  }

  // ── EVENTO DE REVERSÃO ──────────────────────────────────────────────
  // Downgrade auto-descritivo (overdue/deleted/chargeback/inactivated): reverte p/ free,
  // espelhando o webhook. Guards: já-free e mismatch de assinatura (não derrubar quem já
  // re-assinou com OUTRA subscription).
  if (!REVERSION_EVENTS.has(ev)) {
    // Evento não-mapeado (ex.: PAYMENT_UPDATED) — não ativa nem reverte. Fica visível p/ manual.
    log('[asaas-reprocess] evento não-mapeado p/ reprocesso — noop', { event: ev, profileId: profile.id })
    return 'noop_evento_nao_mapeado'
  }
  // #1: se já está free mas o downgrade pode ter falhado ao PAUSAR forms numa tentativa
  // anterior (handleDowngrade agora lança), re-roda o downgrade (idempotente) p/ garantir a
  // pausa. Só então retorna noop.
  if (profile.plan === 'free') {
    await handleDowngrade(profile.id, serviceKey)
    return 'noop_already_free_repaused'
  }
  // Match ESTRITO (igual ao webhook): só reverte se o evento TEM subscription E ela é a
  // ativa do profile. Reversão sem subscriptionId NÃO derruba por customer-fallback —
  // fica como skip (revisão manual via lista do admin). (P1-3, audit Codex 2026-06-07.)
  if (!subscriptionId || profile.asaas_subscription_id !== subscriptionId) {
    return 'skip_subscription_mismatch_ou_sem_sub'
  }

  const { data: rows, error } = await supabase
    .from('profiles')
    .update(buildFreePlanUpdate('cancelled'))
    .eq('id', profile.id)
    .select('id')
  if (error || !rows || rows.length !== 1) throw new Error(`reverter p/ free falhou (rows=${rows?.length ?? 0}): ${error?.message ?? 'sem erro DB'}`)

  await supabase
    .from('billing_checkouts')
    .update({ status: 'cancelled', last_event: 'REPROCESS_REVERTED' })
    .eq('id', checkout.id)

  await handleDowngrade(profile.id, serviceKey)
  await sendPlanCancelled({ to: profile.email, name: profile.full_name ?? 'usuário', plan: profile.plan ?? 'starter' })
    .catch((e) => logError('[asaas-reprocess] email cancelamento falhou', e))
  log('[asaas-reprocess] plano revertido p/ free via reprocesso', { profileId: profile.id })
  return 'reverted_to_free'
}

/** Reprocessa um evento específico. Marca 'processed' em sucesso; incrementa attempts (ou 'dead') em falha. */
export async function reprocessEvent(eventId: string): Promise<ReprocessResult> {
  const supabase = getServiceClient()
  const { data: row, error } = await supabase
    .from('asaas_webhook_events')
    .select('event_id, event, customer_id, subscription_id, attempts, error, last_attempt_at, status')
    .eq('event_id', eventId)
    .maybeSingle()

  if (error || !row) return { eventId, ok: false, action: 'not_found', detail: 'evento não encontrado' }
  if ((row as { status?: string }).status === 'processed') return { eventId, ok: true, action: 'noop', detail: 'já processado' }

  try {
    const action = await reconcile(supabase, row as FailedEvent)
    await supabase
      .from('asaas_webhook_events')
      .update({ status: 'processed', last_attempt_at: new Date().toISOString() })
      .eq('event_id', eventId)
    return { eventId, ok: true, action }
  } catch (err) {
    const attempts = ((row as FailedEvent).attempts ?? 0) + 1
    const detail = err instanceof Error ? err.message : String(err)
    await supabase
      .from('asaas_webhook_events')
      .update({
        attempts,
        last_attempt_at: new Date().toISOString(),
        error: detail,
        status: attempts >= MAX_ATTEMPTS ? 'dead' : 'failed',
      })
      .eq('event_id', eventId)
    logError('[asaas-reprocess] falha ao reprocessar', err, { eventId, attempts })
    return { eventId, ok: false, action: 'error', detail }
  }
}

/** Reprocessa todos os eventos failed reprocessáveis (sequencial, p/ não estourar cota Asaas). */
export async function reprocessAllFailed(limit = 50): Promise<ReprocessResult[]> {
  const events = await listFailedEvents(limit)
  const results: ReprocessResult[] = []
  for (const e of events) {
    results.push(await reprocessEvent(e.event_id))
  }
  return results
}
