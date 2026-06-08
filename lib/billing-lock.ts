import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Lock leve por chave para serializar operações de billing concorrentes, usando a tabela
 * existente asaas_webhook_events (event_id UNIQUE) — sem migration. (#4, audit 2026-06-08.)
 *  - acquireLock: insert único; se a chave já existe, TENTA tomar SÓ se estiver STALE (>2min)
 *    via UPDATE CONDICIONAL atômico (eq(event_id) + lt(processed_at, cutoff)) — dois requests
 *    lendo stail NÃO tomam ambos (só quem o update afetar 1 linha vence).
 *  - releaseLock: delete (best-effort).
 */
const STALE_MS = 120_000

type LockTbl = {
  insert: (v: unknown) => Promise<{ error: { code?: string } | null }>
  update: (v: unknown) => {
    eq: (k: string, val: string) => {
      lt: (k: string, val: string) => { select: (c: string) => Promise<{ data: unknown[] | null }> }
    }
  }
  delete: () => { eq: (k: string, val: string) => Promise<{ error: unknown }> }
}

function tbl(db: SupabaseClient): LockTbl {
  return (db as unknown as { from: (t: string) => LockTbl }).from('asaas_webhook_events')
}

/** Retorna true se adquiriu o lock (novo ou take-over atômico de lock stale). */
export async function acquireLock(db: SupabaseClient, key: string): Promise<boolean> {
  const eventId = `lock:${key}`
  const { error } = await tbl(db).insert({ event_id: eventId, event: 'BILLING_LOCK', status: 'processing' })
  if (!error) return true
  if (error.code !== '23505') return false // erro inesperado → não assume o lock
  // Conflito: só toma se estiver STALE, de forma ATÔMICA (update condicional por processed_at).
  const staleCutoff = new Date(Date.now() - STALE_MS).toISOString()
  const { data } = await tbl(db)
    .update({ processed_at: new Date().toISOString() })
    .eq('event_id', eventId)
    .lt('processed_at', staleCutoff)
    .select('event_id')
  return Array.isArray(data) && data.length > 0
}

export async function releaseLock(db: SupabaseClient, key: string): Promise<void> {
  try {
    await tbl(db).delete().eq('event_id', `lock:${key}`)
  } catch {
    /* best-effort: lock stale será retomado por outro acquire */
  }
}
