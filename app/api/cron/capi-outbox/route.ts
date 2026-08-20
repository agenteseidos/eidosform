import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { isValidBearerSecret } from '@/lib/bearer-auth'
import { processarFila, recuperarLeasesOrfaos } from '@/lib/capi-worker'
import { log } from '@/lib/logger'

/**
 * GET /api/cron/capi-outbox — a recuperação da fila de CAPI.
 *
 * A tentativa imediata (pós-submit) entrega a maioria em segundos. Este cron pega o resto:
 * falha passageira do Meta, timeout, lease órfão de processo que morreu no meio. Roda no
 * crontab da VPS junto dos outros (de hora em hora) — a conta Vercel é Hobby, sem cron
 * sub-diário (ver DEPLOY.md).
 *
 * O que ele NUNCA faz: gerar event_id novo. O id está na linha desde a criação — é isso que
 * torna a retentativa segura contra contagem dupla.
 */
export async function GET(req: NextRequest) {
  if (!isValidBearerSecret(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceRoleClient()
  const leases = await recuperarLeasesOrfaos(db)
  const contagem = await processarFila(db, { limite: 50 })

  log('[cron/capi-outbox] rodada', { leases, ...contagem })
  return NextResponse.json({ ok: true, leasesRecuperados: leases, ...contagem })
}
