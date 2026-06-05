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
import { getSubscription } from '@/lib/asaas'
import { handleUpgrade, handleDowngrade } from '@/lib/plan-limits'
import { buildActivePlanUpdate, buildFreePlanUpdate, type BillingCycle } from '@/lib/billing-activation'
import { sendPlanActivated, sendPlanCancelled } from '@/lib/resend'
import { log, logError } from '@/lib/logger'

const MAX_ATTEMPTS = 5

// Espelha o switch do webhook (app/api/webhooks/asaas/route.ts).
const ACTIVATION_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])
const REVERSION_EVENTS = new Set([
  'PAYMENT_OVERDUE',
  'SUBSCRIPTION_DELETED',
  'SUBSCRIPTION_INACTIVATED',
  'PAYMENT_REFUNDED',
  'PAYMENT_DELETED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
])

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
  if (!subscriptionId && !customerId) throw new Error('evento sem customer_id/subscription_id — não dá pra reconciliar')

  const checkout = await findCheckout(supabase, { customerId, subscriptionId })
  if (!checkout) throw new Error('billing_checkout não encontrado p/ as chaves do evento')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, plan, asaas_subscription_id')
    .eq('id', checkout.profile_id)
    .single()
  if (!profile) throw new Error('profile não encontrado')

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const ev = (row.event ?? '').toUpperCase()

  // ── EVENTO DE ATIVAÇÃO ──────────────────────────────────────────────
  // Só ativa após CONFIRMAR ACTIVE no Asaas. Sem subscriptionId ou não-ACTIVE → noop.
  // NUNCA reverte aqui (Codex ponto 1): profile 'free' pode ser o próprio sintoma do
  // bug que impediu a ativação, então 'free' NÃO bloqueia ativar.
  if (ACTIVATION_EVENTS.has(ev)) {
    if (!subscriptionId) return 'noop_activation_sem_subscription'
    const asaasStatus = await getAsaasStatus(subscriptionId) // relança em erro transitório → retry
    if (asaasStatus !== 'ACTIVE') return 'noop_activation_nao_active'

    const cycle = (checkout.cycle ?? 'MONTHLY') as BillingCycle
    const { data: actRows, error: actErr } = await supabase
      .from('profiles')
      .update(buildActivePlanUpdate({ plan: checkout.plan, cycle, customerId, subscriptionId }))
      .eq('id', profile.id)
      .select('id')
    if (actErr || !actRows || actRows.length !== 1) throw new Error(`ativar plano falhou (rows=${actRows?.length ?? 0}): ${actErr?.message ?? 'sem erro DB'}`)

    await supabase
      .from('billing_checkouts')
      .update({ status: 'paid', last_event: 'REPROCESS_CONFIRMED', asaas_subscription_id: subscriptionId })
      .eq('id', checkout.id)

    if (profile.plan === 'free' || profile.plan !== checkout.plan) {
      await handleUpgrade(profile.id, serviceKey)
      await sendPlanActivated({ to: profile.email, name: profile.full_name ?? 'usuário', plan: checkout.plan })
        .catch((e) => logError('[asaas-reprocess] email ativação falhou', e))
    }
    log('[asaas-reprocess] plano ativado via reprocesso', { profileId: profile.id, plan: checkout.plan })
    return 'activated'
  }

  // ── EVENTO DE REVERSÃO ──────────────────────────────────────────────
  // Eventos auto-descritivos de downgrade (overdue/deleted/refund/chargeback/
  // inactivated): revertem p/ free, espelhando o webhook. Guards: já-free e mismatch
  // de assinatura (não derrubar quem já re-assinou com OUTRA subscription).
  if (!REVERSION_EVENTS.has(ev)) {
    // Evento não-mapeado (ex.: PAYMENT_UPDATED) — não ativa nem reverte. Fica visível p/ manual.
    log('[asaas-reprocess] evento não-mapeado p/ reprocesso — noop', { event: ev, profileId: profile.id })
    return 'noop_evento_nao_mapeado'
  }
  if (profile.plan === 'free') return 'noop_already_free'
  if (subscriptionId && profile.asaas_subscription_id && profile.asaas_subscription_id !== subscriptionId) {
    return 'skip_subscription_mismatch'
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
