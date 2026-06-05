/**
 * GET  /api/admin/asaas/reprocess        → lista eventos de webhook com falha (DLQ)
 * POST /api/admin/asaas/reprocess        → reprocessa todos os failed
 * POST /api/admin/asaas/reprocess { eventId } → reprocessa um evento específico
 *
 * Protegido por ADMIN_EMAILS (requireAdmin). Reprocessamento manual enxuto —
 * sem cron por enquanto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { listFailedEvents, reprocessEvent, reprocessAllFailed } from '@/lib/asaas-reprocess'
import { logError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  try {
    const events = await listFailedEvents(100)
    return NextResponse.json({ events, count: events.length })
  } catch (err) {
    logError('[admin/asaas/reprocess] falha ao listar eventos', err)
    return NextResponse.json({ error: 'Falha ao listar eventos com erro' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  let body: { eventId?: string } = {}
  try { body = await req.json() } catch { /* corpo opcional */ }

  try {
    if (body.eventId) {
      const result = await reprocessEvent(body.eventId)
      return NextResponse.json({ result })
    }
    const results = await reprocessAllFailed(100)
    const recovered = results.filter((r) => r.ok).length
    return NextResponse.json({ results, total: results.length, recovered })
  } catch (err) {
    logError('[admin/asaas/reprocess] falha ao reprocessar', err)
    return NextResponse.json({ error: 'Falha ao reprocessar eventos' }, { status: 500 })
  }
}
