import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getCustomerSubscriptions, cancelSubscription } from '@/lib/asaas'
import { acquireLock, releaseLock } from '@/lib/billing-lock'
import { sendBillingOpsAlert } from '@/lib/resend'
import { log, logError } from '@/lib/logger'

/**
 * GET /api/cron/reconcile-subscriptions — garante NO MÁXIMO 1 sub ACTIVE por cliente (cron, ~30min).
 *
 * HARDENING pós-incidente 2026-06-09 (ficaram 2 subs ACTIVE quando a ativação não rodou). Protegido
 * por CRON_SECRET. MODO SEGURO: alert-only por padrão (BILLING_RECONCILE_ACTIONS=true habilita o
 * cancelamento automático). Fail-closed.
 *
 * Critérios CONSERVADORES (Codex): só cancela a órfã quando é CLARO —
 *   - o profile aponta p/ outra sub ACTIVE (a "keep"), E
 *   - a candidata != keep, E
 *   - a candidata é MAIS ANTIGA que a keep (ou mesmo valor = duplicata).
 * Senão (profile sem sub / órfã mais nova / planos diferentes recentes / erro de leitura): ALERTA, não cancela.
 */
// Flag SEPARÁVEL (Codex): liga a ação do reconcile de subs primeiro (risco menor — corrige cobrança
// dupla, não ativa plano). Fallback p/ a flag global por compat. Fail-closed.
const ACTIONS_ON = (process.env.BILLING_RECONCILE_SUBSCRIPTIONS_ACTIONS ?? process.env.BILLING_RECONCILE_ACTIONS) === 'true'
const MAX_PROFILES = 50

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'Config indisponível' }, { status: 503 })
  const db = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: profs, error } = await db
    .from('profiles')
    .select('id, asaas_customer_id, asaas_subscription_id')
    .neq('plan', 'free')
    .not('asaas_customer_id', 'is', null)
    .limit(MAX_PROFILES)

  if (error) { logError('[cron/reconcile-subscriptions] erro ao listar profiles', error); return NextResponse.json({ error: 'db' }, { status: 500 }) }

  const results = { scanned: profs?.length ?? 0, cancelled: 0, alerted: 0, clean: 0, actionsOn: ACTIONS_ON }
  const alerts: string[] = []

  for (const p of (profs ?? []) as ProfileRow[]) {
    const customerId = p.asaas_customer_id
    if (!customerId) continue
    const lockKey = `activation:${p.id}` // mesmo lock da ativação — não mexer enquanto ativa
    if (!(await acquireLock(db, lockKey))) continue
    try {
      // getCustomerSubscriptions retorna o ARRAY direto (P0, audit 2026-06-09: ler `.data`
      // aqui produzia [] → o cron reportava "clean" p/ sempre e nunca detectava duplicatas).
      const resp = await getCustomerSubscriptions(customerId).catch(() => null)
      const active = (resp ?? []).filter((s) => s.status === 'ACTIVE')
      if (active.length <= 1) { results.clean++; continue }

      const keepId = p.asaas_subscription_id
      const keep = active.find((s) => s.id === keepId) ?? null

      // profile NÃO aponta p/ nenhuma das ACTIVE → ambíguo, NÃO cancela.
      if (!keep) {
        alerts.push(`profile ${p.id}: ${active.length} subs ACTIVE e profile aponta p/ '${keepId ?? '—'}' (não está entre as ACTIVE) — REVISAR manual`)
        results.alerted++
        continue
      }

      const keepCreated = Date.parse(keep.dateCreated ?? '') || 0
      for (const cand of active) {
        if (cand.id === keep.id) continue
        const candCreated = Date.parse(cand.dateCreated ?? '') || 0
        const olderThanKeep = keepCreated > 0 && candCreated > 0 && candCreated < keepCreated
        const sameValueDup = cand.value === keep.value
        const safeToCancel = olderThanKeep || sameValueDup
        if (!safeToCancel) {
          alerts.push(`profile ${p.id}: sub órfã ${cand.id} (R$${cand.value}) NÃO é claramente cancelável (mais nova/plano diferente) — REVISAR`)
          results.alerted++
          continue
        }
        if (!ACTIONS_ON) {
          alerts.push(`profile ${p.id}: [OBSERVE] cancelaria órfã ${cand.id} (R$${cand.value}, mais antiga/duplicata), keep=${keep.id}`)
          results.alerted++
          continue
        }
        try {
          await cancelSubscription(cand.id)
          results.cancelled++
          const motivo = olderThanKeep ? 'mais-antiga-que-keep' : 'mesmo-valor-duplicata'
          log('[cron/reconcile-subscriptions] órfã cancelada', { profileId: p.id, cancelled: cand.id, keep: keep.id, motivo })
          // AUDITORIA (Codex): registra o cancelamento automático com motivo.
          await (db as unknown as { from: (t: string) => { insert: (v: unknown) => Promise<unknown> } })
            .from('asaas_webhook_events')
            .insert({ event_id: `reconcile-cancel:${customerId}:${cand.id}`, event: 'RECONCILE_CANCEL', status: 'processed', error: `órfã cancelada (keep=${keep.id}, motivo=${motivo}, profile=${p.id})`, subscription_id: cand.id, last_attempt_at: new Date().toISOString() }).catch(() => {})
        } catch (e) {
          logError('[cron/reconcile-subscriptions] falha ao cancelar órfã', e, { profileId: p.id, sub: cand.id })
          alerts.push(`profile ${p.id}: falha ao cancelar órfã ${cand.id}`)
          results.alerted++
        }
      }
    } catch (e) {
      logError('[cron/reconcile-subscriptions] erro no profile', e, { profileId: p.id })
    } finally {
      await releaseLock(db, lockKey)
    }
  }

  if (alerts.length) {
    const { actionsOn: _ao, ...rest } = results
    await sendBillingOpsAlert({
      subject: `🔁 Reconcile de assinaturas — ${results.cancelled} órfãs canceladas, ${results.alerted} p/ revisar`,
      lines: { modo: ACTIONS_ON ? 'AÇÃO' : 'OBSERVE (alert-only)', ...rest, detalhes: alerts.slice(0, 15).join(' | ') },
    }).catch(() => {})
  }
  return NextResponse.json({ ok: true, ...results })
}

type ProfileRow = { id: string; asaas_customer_id: string | null; asaas_subscription_id: string | null }
