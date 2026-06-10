import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getCustomerSubscriptions, hasConfirmedPaymentForSubscription, detectPlanAndCycleFromValue, type AsaasSubscriptionSummary } from '@/lib/asaas'
import { activatePaidSubscription, isExpectedFullPrice, type BillingCycle } from '@/lib/billing-activation'
import { acquireLock, releaseLock } from '@/lib/billing-lock'
import { sendBillingOpsAlert } from '@/lib/resend'
import { log, logError } from '@/lib/logger'

/**
 * GET /api/cron/reconcile-checkouts — BACKSTOP de ativação (cron Vercel, ~a cada 10 min).
 *
 * HARDENING pós-incidente 2026-06-09: recupera "pagamento CONFIRMADO mas o app NÃO ativou" — o
 * buraco do incidente (webhook fora do ar + navegador fechado → checkout fica `pending` p/ sempre).
 * NÃO depende de webhook nem de polling do navegador. Protegido por CRON_SECRET.
 *
 * MODO SEGURO: por padrão é ALERT-ONLY (detecta + alerta, NÃO muta). Setar BILLING_RECONCILE_ACTIONS=true
 * na Vercel p/ habilitar a ativação automática (depois do Codex auditar). Fail-closed.
 *
 * Para cada billing_checkouts pending (5min–24h, com customer):
 *  - acha a sub ACTIVE do customer (a do checkout, ou casa por plano/ciclo/valor; ambíguo → alerta);
 *  - confirma pagamento CONFIRMED/RECEIVED (senão pula — não confirmado ainda);
 *  - se o profile não está ativado p/ essa sub → ATIVA (activatePaidSubscription) ou alerta;
 *  - se a correção de valor recorrente falhar → alerta (nunca subcobrar em silêncio).
 */
// Flag SEPARÁVEL (Codex): liga a ação do backstop independente do reconcile de subs (ativação tem
// risco maior → liga depois). Fallback p/ a flag global por compat. Fail-closed.
const ACTIONS_ON = (process.env.BILLING_RECONCILE_CHECKOUTS_ACTIONS ?? process.env.BILLING_RECONCILE_ACTIONS) === 'true'
const MAX_ITEMS = 30

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'Config indisponível' }, { status: 503 })
  const db = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const now = Date.now()
  const since = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const until = new Date(now - 5 * 60 * 1000).toISOString() // dá tempo do webhook/polling agir

  const { data: pendings, error } = await (db as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (a: string, b: string) => { gt: (a: string, b: string) => { lt: (a: string, b: string) => { order: (a: string, o: unknown) => { limit: (n: number) => Promise<{ data: PendingRow[] | null; error: unknown }> } } } } } }
  }).from('billing_checkouts').select('id, profile_id, plan, cycle, status, asaas_customer_id, asaas_subscription_id, created_at')
    .eq('status', 'pending').gt('created_at', since).lt('created_at', until)
    .order('created_at', { ascending: true }).limit(MAX_ITEMS)

  if (error) { logError('[cron/reconcile-checkouts] erro ao listar pendings', error); return NextResponse.json({ error: 'db' }, { status: 500 }) }

  const results = { scanned: pendings?.length ?? 0, activated: 0, alerted: 0, skipped: 0, actionsOn: ACTIONS_ON }
  const alerts: string[] = []

  for (const ck of pendings ?? []) {
    const customerId = ck.asaas_customer_id
    if (!customerId || !ck.profile_id) { results.skipped++; continue }
    const lockKey = `activation:${ck.profile_id}`
    if (!(await acquireLock(db, lockKey))) { results.skipped++; continue }
    try {
      // profile atual
      const { data: prof } = await db.from('profiles').select('id, plan, plan_status, plan_cycle, asaas_subscription_id').eq('id', ck.profile_id).single()
      const profile = prof as ProfileRow | null
      if (!profile) { results.skipped++; continue }
      // GUARD (Codex): profile em 'canceling' tem intenção de SAIR — não auto-ativar (revisar manual).
      if (profile.plan_status === 'canceling') {
        alerts.push(`checkout ${ck.id} (profile ${ck.profile_id}, customer ${customerId}): profile em 'canceling' — não auto-ativo`)
        results.alerted++
        continue
      }

      // resolve a sub ACTIVE do customer. getCustomerSubscriptions retorna o ARRAY direto
      // (P0, audit 2026-06-09: ler `.data` aqui produzia [] e o backstop virava no-op).
      const subsResp = await getCustomerSubscriptions(customerId).catch(() => null)
      const active = (subsResp ?? []).filter((s) => s.status === 'ACTIVE')
      let target: AsaasSubscriptionSummary | null = null
      if (ck.asaas_subscription_id) target = active.find((s) => s.id === ck.asaas_subscription_id) ?? null
      if (!target && active.length === 1) target = active[0]
      if (!target && active.length > 1) {
        // casa por plano/ciclo do checkout via valor
        const matches = active.filter((s) => { const d = detectPlanAndCycleFromValue(s.value); return d?.plan === ck.plan && d?.cycle === ck.cycle })
        if (matches.length === 1) target = matches[0]
      }
      if (!target) {
        // sem sub ACTIVE → pagamento provavelmente não confirmou ainda; ou ambíguo
        if (active.length > 1) { alerts.push(`checkout ${ck.id}: ${active.length} subs ACTIVE, ambíguo — não ativei`); results.alerted++ }
        else results.skipped++
        continue
      }

      // confirma pagamento (não basta ACTIVE)
      const pay = await hasConfirmedPaymentForSubscription(target.id)
      if (!pay.ok) { alerts.push(`checkout ${ck.id}: consulta de pagamento FALHOU (sub ${target.id}) — não ativei`); results.alerted++; continue }
      if (!pay.confirmed) { results.skipped++; continue } // não pago ainda

      // GUARD (Codex): só auto-ativar sub no PREÇO CHEIO. Valor prorateado (upgrade-proration) é
      // INSEGURO — o Asaas bloqueia corrigir o valor recorrente em prod → recriaria o desconto
      // eterno. Esses casos vão p/ alerta/manual, NUNCA auto-ativam.
      if (!isExpectedFullPrice(target.value, ck.plan, ck.cycle as BillingCycle)) {
        alerts.push(`checkout ${ck.id} (profile ${ck.profile_id}, customer ${customerId}): sub ${target.id} R$${target.value} != preço cheio (${ck.plan}/${ck.cycle}) — PRORATEADO/INSEGURO, NÃO auto-ativo (manual)`)
        results.alerted++
        continue
      }

      // GUARD (Codex): existe checkout PAID mais novo p/ o mesmo profile? então este pending foi
      // superseded → não ativar o antigo.
      const { data: newerPaid } = await db.from('billing_checkouts').select('id').eq('profile_id', ck.profile_id).eq('status', 'paid').gt('created_at', ck.created_at).limit(1)
      if (newerPaid && (newerPaid as unknown[]).length > 0) { results.skipped++; continue }

      // profile já ativado p/ essa sub?
      if (profile.plan === ck.plan && profile.plan_status === 'active' && profile.plan_cycle === ck.cycle && profile.asaas_subscription_id === target.id) {
        // já ok — só o checkout ficou pending; marca paid p/ não re-varrer
        if (ACTIONS_ON) await db.from('billing_checkouts').update({ status: 'paid', asaas_subscription_id: target.id, last_event: 'BACKSTOP_ALREADY_ACTIVE' } as never).eq('id', ck.id)
        results.skipped++
        continue
      }

      // DIVERGÊNCIA: pago e ACTIVE mas profile não ativado → o buraco do incidente
      if (!ACTIONS_ON) {
        alerts.push(`checkout ${ck.id} (profile ${ck.profile_id}, customer ${customerId}): pago+ACTIVE (sub ${target.id} R$${target.value}, ${ck.plan}/${ck.cycle}) mas profile NÃO ativado — [OBSERVE] não agi`)
        results.alerted++
        continue
      }

      const act = await activatePaidSubscription({
        db, userId: ck.profile_id, customerId, subscriptionId: target.id,
        plan: ck.plan, cycle: ck.cycle as BillingCycle, checkoutId: ck.id,
        previousSubscriptionId: profile.asaas_subscription_id, source: 'backstop', currentProfile: profile,
      })
      if (act.activated) {
        results.activated++
        log('[cron/reconcile-checkouts] BACKSTOP ativou', { checkoutId: ck.id, sub: target.id, plan: ck.plan })
        if (act.recurringValueNeeded && !act.recurringValueFixed) {
          alerts.push(`checkout ${ck.id}: ATIVADO mas valor recorrente NÃO corrigido (sub ${target.id}) — Asaas bloqueia? revisar`)
          results.alerted++
        }
      } else if (act.error) {
        alerts.push(`checkout ${ck.id}: falha ao ativar (${act.error})`)
        results.alerted++
      }
    } catch (e) {
      logError('[cron/reconcile-checkouts] erro no item', e, { checkoutId: ck.id })
      results.skipped++
    } finally {
      await releaseLock(db, lockKey)
    }
  }

  if (alerts.length) {
    const { actionsOn: _ao, ...rest } = results
    await sendBillingOpsAlert({
      subject: `🛟 Backstop de checkouts — ${results.activated} ativados, ${results.alerted} p/ revisar`,
      lines: { modo: ACTIONS_ON ? 'AÇÃO' : 'OBSERVE (alert-only)', ...rest, detalhes: alerts.slice(0, 15).join(' | ') },
    }).catch(() => {})
  }
  return NextResponse.json({ ok: true, ...results })
}

type PendingRow = { id: string; profile_id: string; plan: string; cycle: string; status: string; asaas_customer_id: string | null; asaas_subscription_id: string | null; created_at: string }
type ProfileRow = { id: string; plan: string | null; plan_status: string | null; plan_cycle: string | null; asaas_subscription_id: string | null }
