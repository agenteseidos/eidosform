import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getSubscription, hasOverduePaymentForSubscription } from '@/lib/asaas'
import { PLANS, handleDowngrade } from '@/lib/plan-limits'
import { expiryFromNextDueDate, calculateExpiryDate, type BillingCycle } from '@/lib/billing-activation'
import { computeProrationBasisDays } from '@/lib/proration'
import { log, logError, logWarn } from '@/lib/logger'
import { buildResponseQuotaPeriodReset } from '@/lib/response-quota'
import { isValidBearerSecret } from '@/lib/bearer-auth'

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
 *  - sub ACTIVE mas com cobrança OVERDUE → só estende se estiver DENTRO da carência; passou
 *    de OVERDUE_GRACE_DAYS, REVERTE. (auditoria 2026-08, lote 1D.)
 */

/**
 * Dias de tolerância após o vencimento antes de rebaixar. Decisão do Sidney (06/08): 5 dias.
 * Motivo: o Asaas retenta o cartão nos dias seguintes ao vencimento; derrubar no dia 1 pausaria
 * os formulários de um cliente que ia pagar. Acima disso, é acesso pago sem receita.
 */
const OVERDUE_GRACE_DAYS = 5

/** Dias inteiros decorridos desde `dateStr` (YYYY-MM-DD). `null` se a data for ilegível. */
function diasDesde(dateStr: string | null): number | null {
  if (!dateStr) return null
  const t = Date.parse(`${dateStr}T00:00:00-03:00`)
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86_400_000)
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  // D10 (lote 2-bis): comparação em tempo constante, via fonte única.
  if (!isValidBearerSecret(req.headers.get('authorization'), secret)) {
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
    .select('id, plan, plan_status, plan_cycle, plan_expires_at, asaas_subscription_id')
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
    const p = row as { id: string; plan: string | null; plan_status: string | null; plan_cycle: string | null; plan_expires_at: string | null; asaas_subscription_id: string | null }
    let shouldRevert = true

    if (p.asaas_subscription_id) {
      try {
        const sub = (await getSubscription(p.asaas_subscription_id)) as { status?: string; nextDueDate?: string }
        if (String(sub?.status ?? '').toUpperCase() === 'ACTIVE') {
          // PROVA DE PAGAMENTO antes de estender (auditoria 2026-08, lote 1D).
          // No Asaas o status da SUB é independente do status da COBRANÇA: cartão recusado
          // mantém `ACTIVE` emitindo faturas OVERDUE. Sem esta checagem, o período pago já
          // terminou (a linha só chega aqui com plan_expires_at vencido) e mesmo assim o
          // acesso era empurrado +1 ciclo A CADA EXECUÇÃO DIÁRIA — acesso pago vitalício
          // sem receita. O cron irmão (reconcile-checkouts) já exigia prova de dinheiro.
          const due = await hasOverduePaymentForSubscription(p.asaas_subscription_id)
          if (!due.ok) {
            // Consulta falhou → conservador: não estende E não derruba (mesma postura do
            // catch de erro transitório abaixo). Reavalia no próximo tick.
            shouldRevert = false
            skipped++
            logWarn('[cron/expire-plans] consulta de OVERDUE falhou — adia decisão', { profileId: p.id })
            continue
          }
          if (due.overdue) {
            // CARÊNCIA DE 5 DIAS (decisão Sidney, 06/08). O Asaas ainda retenta o cartão nos
            // dias seguintes ao vencimento; derrubar no primeiro dia pausaria os formulários de
            // um cliente que ia pagar. Dentro da carência: NÃO estende e NÃO derruba — fica
            // parado até a fatura ser paga (aí volta ao ramo de renovação) ou a carência vencer.
            // ⚠️ A carência é SILENCIOSA hoje: o cliente não é avisado do atraso nem do
            // rebaixamento iminente. A régua de cobrança (e-mail + WhatsApp) está registrada em
            // `docs/demandas-futuras.md` como D-01 — sem ela, o cliente descobre pelo produto.
            const diasVencido = diasDesde(due.oldestDueDate)
            if (diasVencido !== null && diasVencido < OVERDUE_GRACE_DAYS) {
              shouldRevert = false
              skipped++
              logWarn('[cron/expire-plans] cobrança VENCIDA dentro da carência — aguarda', {
                profileId: p.id, subscriptionId: p.asaas_subscription_id,
                oldestDueDate: due.oldestDueDate, diasVencido, carenciaDias: OVERDUE_GRACE_DAYS,
              })
              continue
            }
            // Fora da carência (ou data de vencimento ilegível → trata como fora, conservador
            // quanto à RECEITA: não conceder acesso indefinido por falta de dado).
            // `shouldRevert` continua true → cai na reversão normal lá embaixo (que pausa os
            // formulários primeiro e só então marca free). NÃO usar `throw` aqui: o catch
            // abaixo trata exceção como erro TRANSITÓRIO e faria justamente o contrário,
            // adiando a reversão para sempre.
            logWarn('[cron/expire-plans] cobrança VENCIDA além da carência — rebaixa', {
              profileId: p.id, subscriptionId: p.asaas_subscription_id,
              oldestDueDate: due.oldestDueDate, diasVencido, carenciaDias: OVERDUE_GRACE_DAYS,
            })
          } else {
          // Renovação atrasada — estende em vez de derrubar o pagante. Recomputa TAMBÉM a
          // régua de valoração (§4.F): este é o fallback do webhook-fora-do-ar; sem recomputar,
          // o divisor VELHO persistiria e a distorção que o projeto mata reapareceria. Sem
          // paymentDueDate → a base é derivada do nextDueDate por mês/ano-CALENDÁRIO (§2.5);
          // fora de banda / inválido → null → NÃO grava (fica no valor vigente/fallback + log).
          const cycleRenew = (p.plan_cycle ?? 'MONTHLY') as BillingCycle
          const next = expiryFromNextDueDate(sub?.nextDueDate) ?? calculateExpiryDate(cycleRenew)
          const basisRenew = computeProrationBasisDays(cycleRenew, sub?.nextDueDate)
          const upd: Record<string, unknown> = { plan_expires_at: next }
          if (basisRenew !== null) {
            upd.proration_basis_days = basisRenew
            upd.billing_period_end_on = sub?.nextDueDate ?? null
          }
          const { error: extErr } = await admin.from('profiles').update(upd).eq('id', p.id)
          if (extErr) logError('[cron/expire-plans] falha ao estender', extErr, { profileId: p.id })
          else extended++
          shouldRevert = false
          }
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
        // #1: PAUSA OS FORMS PRIMEIRO (handleDowngrade lança se falhar). Só DEPOIS marca free.
        // Se o downgrade falhar, NÃO marca free → o profile segue 'pago/expirado' e o próximo
        // tick do cron retenta (não some da query). Evita "free mas forms nunca pausados".
        await handleDowngrade(p.id, key)
        const { error: revErr } = await admin
          .from('profiles')
          .update({
            plan: 'free',
            // Usuário que CANCELOU e chegou ao fim do período termina como 'cancelled'
            // (não 'expired') — preserva a semântica/métrica de churn. (P3, audit 2026-06-09.)
            plan_status: p.plan_status === 'canceling' ? 'cancelled' : 'expired',
            plan_expires_at: null,
            asaas_subscription_id: null,
            annual_started_at: null,
            // free LIMPA a régua de valoração (caso 5) — este revert NÃO usa buildFreePlanUpdate.
            proration_basis_days: null,
            billing_period_start_on: null,
            billing_period_end_on: null,
            limit_alert_sent: false,
            responses_limit: PLANS.free.maxResponses,
            ...buildResponseQuotaPeriodReset(),
          })
          .eq('id', p.id)
        if (revErr) {
          logError('[cron/expire-plans] forms pausados mas falha ao marcar free (retenta no próximo tick)', revErr, { profileId: p.id })
        } else {
          reverted++
        }
      } catch (err) {
        // downgrade falhou (forms não pausados) → NÃO marca free → próximo tick retenta.
        skipped++
        logError('[cron/expire-plans] downgrade falhou; adiando reversão (retenta no próximo tick)', err, { profileId: p.id })
      }
    }
  }

  log('[cron/expire-plans] concluído', { total: expired?.length ?? 0, reverted, extended, skipped })
  return NextResponse.json({ ok: true, total: expired?.length ?? 0, reverted, extended, skipped })
}
