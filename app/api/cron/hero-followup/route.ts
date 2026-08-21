import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { isValidBearerSecret } from '@/lib/bearer-auth'
import { processarFollowups, recuperarLeasesHero } from '@/lib/hero-demo/followup-worker'
import { log } from '@/lib/logger'

/**
 * GET /api/cron/hero-followup — entrega o follow-up do hero da landing (D-10).
 *
 * Roda no crontab da VPS (a conta Vercel é Hobby: sem cron sub-diário). A cadência precisa ser
 * mais fina que a da régua porque o compromisso é "30 minutos": a cada 15 min o atraso máximo
 * fica em 30-45, que é o que foi prometido.
 */
export async function GET(req: NextRequest) {
  if (!isValidBearerSecret(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = createServiceRoleClient()
  const leases = await recuperarLeasesHero(db)
  const contagem = await processarFollowups(db)
  log('[cron/hero-followup] rodada', { leases, ...contagem })
  return NextResponse.json({ ok: true, leasesRecuperados: leases, ...contagem })
}
