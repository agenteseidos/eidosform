import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getSubscription } from '@/lib/asaas'
import { PLANS, handleDowngrade } from '@/lib/plan-limits'
import { expiryFromNextDueDate, calculateExpiryDate, type BillingCycle } from '@/lib/billing-activation'
import { log, logError, logWarn } from '@/lib/logger'

/**
 * GET /api/cron/expire-plans — CRON diário (Vercel).
 *
 * Reversão PERSISTIDA de planos expirados. Antes, a reversão (plano→free + pausar forms via
 * handleDowngrade) só rodava quando o usuário abria o dashboard (/api/user/plan-features) — um
 * churned que nunca mais logava deixava o DB divergente e forms não-pausados pra sempre.
 * (#2, audit 2026-06-08.) Protegido por CRON_SECRET (Vercel envia Authorization: Bearer <secret>).
 *
 * Lógica por profile expirado (plan != free AND plan_expires_at < now):
 *  - tem sub vinculada e ela está ACTIVE no Asaas → renovação atrasada: ESTENDE a expiração
 *    (nextDueDate real, fim-de-dia BRT; fallback now+ciclo). Não derruba pagante.
 *  - sub 404/não-ACTIVE, ou sem sub → REVERTE p/ free + handleDowngrade (pausa forms).
 *  - erro transitório ao consultar o Asaas → conservador: NÃO reverte agora (próximo tick).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    logError('[cron/expire-plans] SUPABASE service-role env ausente')
    return NextResponse.json({ error: 'Config indisponível' }, { status: 503 })
  }
  const admin = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const nowIso = new Date().toISOString()
  const { data: expired, error } = await admin
    .from('profiles')
    .select('id, plan, plan_cycle, plan_expires_at, asaas_subscription_id')
    .neq('plan', 'free')
    .lt('plan_expires_at', nowIso)
    .limit(500)

  if (error) {
    logError('[cron/expire-plans] query de expirados falhou', error)
    return NextResponse.json({ error: 'query falhou' }, { status: 500 })
  }

  let reverted = 0
  let extended = 0
  let skipped = 0

  for (const row of expired ?? []) {
    const p = row as { id: string; plan: string | null; plan_cycle: string | null; plan_expires_at: string | null; asaas_subscription_id: string | null }
    let shouldRevert = true

    if (p.asaas_subscription_id) {
      try {
        const sub = (await getSubscription(p.asaas_subscription_id)) as { status?: string; nextDueDate?: string }
        if (String(sub?.status ?? '').toUpperCase() === 'ACTIVE') {
          // Renovação atrasada — estende em vez de derrubar o pagante.
          const next = expiryFromNextDueDate(sub?.nextDueDate) ?? calculateExpiryDate((p.plan_cycle ?? 'MONTHLY') as BillingCycle)
          const { error: extErr } = await admin.from('profiles').update({ plan_expires_at: next }).eq('id', p.id)
          if (extErr) logError('[cron/expire-plans] falha ao estender', extErr, { profileId: p.id })
          else extended++
          shouldRevert = false
        }
        // status != ACTIVE → reverte abaixo
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!/error 404/i.test(msg)) {
          // transitório → não reverte agora (não derruba pagante por falha de rede)
          shouldRevert = false
          skipped++
          logWarn('[cron/expire-plans] Asaas transitório — adia reversão', { profileId: p.id, error: msg })
        }
        // 404 → sub não existe mais → reverte abaixo
      }
    }

    if (shouldRevert) {
      try {
        const { error: revErr } = await admin
          .from('profiles')
          .update({
            plan: 'free',
            plan_status: 'expired',
            plan_expires_at: null,
            asaas_subscription_id: null,
            limit_alert_sent: false,
            responses_limit: PLANS.free.maxResponses,
            responses_used: 0,
          })
          .eq('id', p.id)
        if (revErr) {
          logError('[cron/expire-plans] falha ao reverter profile', revErr, { profileId: p.id })
        } else {
          await handleDowngrade(p.id, key).catch((e) => logError('[cron/expire-plans] handleDowngrade falhou', e, { profileId: p.id }))
          reverted++
        }
      } catch (err) {
        logError('[cron/expire-plans] erro ao reverter', err, { profileId: p.id })
      }
    }
  }

  log('[cron/expire-plans] concluído', { total: expired?.length ?? 0, reverted, extended, skipped })
  return NextResponse.json({ ok: true, total: expired?.length ?? 0, reverted, extended, skipped })
}
