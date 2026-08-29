/**
 * Cron da régua do trial — GET /api/cron/trial-followup
 *
 * Chamado de fora (systemd timer na VPS, a cada minuto) com o CRON_SECRET, no mesmo padrão dos
 * outros crons. O D0 promete "na hora", então a cadência é de minutos, não de horas.
 *
 * Executor ÚNICO por desenho: a régua reserva cada linha com lease no banco, então uma segunda
 * execução simultânea não pega a mesma entrega. O `flock` do timer é só a primeira barreira.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { isValidBearerSecret } from '@/lib/bearer-auth'
import { processarEntregasDevidas, recolherLeasesVencidos } from '@/lib/trial/regua'
import { logError } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isValidBearerSecret(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    logError('[cron/trial-followup] service-role ausente')
    return NextResponse.json({ error: 'Config indisponível' }, { status: 503 })
  }
  const db = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  // Antes de tudo: quem ficou preso em `reserved` (processo morreu antes de selar) volta para a
  // fila. É seguro porque nada foi enviado — o envio só acontece depois da selagem.
  const recolhidas = await recolherLeasesVencidos(db)
  const resultado = await processarEntregasDevidas(db, { limite: 20 })

  return NextResponse.json({ ok: true, leasesRecolhidos: recolhidas, ...resultado })
}
