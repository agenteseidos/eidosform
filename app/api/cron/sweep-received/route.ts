import { NextRequest, NextResponse } from 'next/server'
import { listStaleReceivedEvents, reprocessEvent, type ReprocessResult } from '@/lib/asaas-reprocess'
import { sendBillingOpsAlert } from '@/lib/resend'
import { log, logError } from '@/lib/logger'

/**
 * GET /api/cron/sweep-received — recupera eventos de dinheiro presos em 'received' (P1, 2026-06-15).
 *
 * O handler do webhook (app/api/webhooks/asaas) pode MORRER (timeout 30s / OOM) ENTRE o insert da
 * idempotência (status='received') e a promoção p/ 'processed'/'failed'. Nesse caso o evento fica
 * ETERNAMENTE 'received': o retry do Asaas vê 'duplicate' e dá noop, e o DLQ (listFailedEvents, só
 * 'failed') nunca o pega — um PAYMENT_CONFIRMED/RECEIVED fica pago-sem-ativar e invisível.
 *
 * Este sweep pega os 'received' ANTIGOS (>10 min, p/ não tocar handler ainda vivo) e os reprocessa
 * pelo MESMO caminho do DLQ (reprocessEvent → reconcile), promovendo a 'processed'. reprocessEvent é
 * idempotente (noop em 'processed'; reconcile confere ACTIVE no Asaas + guard de preço-cheio + dedup
 * de efeitos), então um race com o próprio handler que acabou de promover vira noop. Protegido por CRON_SECRET.
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const stale = await listStaleReceivedEvents(50)
    const results: ReprocessResult[] = []
    for (const e of stale) {
      results.push(await reprocessEvent(e.event_id))
    }
    const recovered = results.filter((r) => r.ok && r.action !== 'noop').length
    const errors = results.filter((r) => !r.ok).length

    if (recovered > 0 || errors > 0) {
      await sendBillingOpsAlert({
        subject: `🩺 Sweep de 'received' órfãos — ${recovered} recuperados, ${errors} erros`,
        lines: {
          escaneados: stale.length,
          recuperados: recovered,
          erros: errors,
          detalhes: results.map((r) => `${r.eventId}:${r.action}`).slice(0, 15).join(' | '),
        },
      }).catch((e) => logError('[cron/sweep-received] alerta falhou', e))
    }

    log('[cron/sweep-received] varredura concluída', { scanned: stale.length, recovered, errors })
    return NextResponse.json({ ok: true, scanned: stale.length, recovered, errors })
  } catch (err) {
    logError('[cron/sweep-received] erro na varredura', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
