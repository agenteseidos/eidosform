/**
 * Lock de billing com dono.
 *
 * O defeito que este teste tranca: até 28/08/2026 o release apagava a linha PELA CHAVE.
 * A adquiria, demorava além do lease, B tomava o lock vencido, A terminava e apagava o lock
 * de B — e um terceiro entrava junto com B. Agora o release só apaga se o token bater.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { acquireLock, releaseLock, heartbeatLock, holdsLock } from './billing-lock'
import type { SupabaseClient } from '@supabase/supabase-js'

type Linha = { lock_key: string; owner_token: string; lease_until: string; updated_at?: string }

/** Fake mínimo da tabela billing_locks: tudo encadeia e o objeto é "thenable". */
function fakeDb(estado: Map<string, Linha>) {
  let filtros: { col: string; op: string; val: string }[] = []
  let pendente: Partial<Linha> | null = null
  let modo: 'update' | 'delete' | 'select' = 'select'

  const casa = (l: Linha) => filtros.every((f) => {
    const v = (l as unknown as Record<string, string>)[f.col]
    if (f.op === 'eq') return v === f.val
    if (f.op === 'lt') return v < f.val
    if (f.op === 'gt') return v > f.val
    return false
  })

  const executa = () => {
    const atingidas = [...estado.values()].filter(casa)
    if (modo === 'update') for (const l of atingidas) estado.set(l.lock_key, { ...l, ...pendente })
    if (modo === 'delete') for (const l of atingidas) estado.delete(l.lock_key)
    return { data: atingidas.map((l) => ({ lock_key: l.lock_key })), error: null }
  }

  const api: Record<string, unknown> = {
    insert(valores: Linha) {
      if (estado.has(valores.lock_key)) return Promise.resolve({ error: { code: '23505' } })
      estado.set(valores.lock_key, valores)
      return Promise.resolve({ error: null })
    },
    update(valores: Partial<Linha>) { modo = 'update'; pendente = valores; return api },
    delete() { modo = 'delete'; return api },
    select() { return api },
    eq(col: string, val: string) { filtros.push({ col, op: 'eq', val }); return api },
    lt(col: string, val: string) { filtros.push({ col, op: 'lt', val }); return api },
    gt(col: string, val: string) { filtros.push({ col, op: 'gt', val }); return api },
    limit() { return Promise.resolve(executa()) },
    then(resolve: (v: unknown) => void) { resolve(executa()); return Promise.resolve(executa()) },
  }
  return { from: () => { filtros = []; pendente = null; modo = 'select'; return api } } as unknown as SupabaseClient
}

describe('billing-lock com dono', () => {
  let estado: Map<string, Linha>
  let db: SupabaseClient
  beforeEach(() => { estado = new Map(); db = fakeDb(estado); vi.useRealTimers() })

  it('quem adquire recebe um token; o segundo não entra', async () => {
    const a = await acquireLock(db, 'activation:p1')
    expect(a).toBeTypeOf('string')
    const b = await acquireLock(db, 'activation:p1')
    expect(b).toBeNull()
  })

  it('lease VENCIDO pode ser tomado — e só depois de vencer', async () => {
    estado.set('activation:p1', {
      lock_key: 'activation:p1', owner_token: 'antigo',
      lease_until: new Date(Date.now() - 1000).toISOString(),
    })
    const novo = await acquireLock(db, 'activation:p1')
    expect(novo).toBeTypeOf('string')
    expect(estado.get('activation:p1')!.owner_token).toBe(novo)
  })

  it('🔒 A não apaga o lock que B assumiu (o defeito de origem)', async () => {
    const tokenA = await acquireLock(db, 'activation:p1')
    // lease de A vence e B assume
    estado.set('activation:p1', { ...estado.get('activation:p1')!, lease_until: new Date(Date.now() - 1).toISOString() })
    const tokenB = await acquireLock(db, 'activation:p1')
    expect(tokenB).not.toBe(tokenA)

    await releaseLock(db, 'activation:p1', tokenA)   // A termina e tenta liberar
    expect(estado.has('activation:p1')).toBe(true)   // o lock de B continua de pé
    expect(estado.get('activation:p1')!.owner_token).toBe(tokenB)

    await releaseLock(db, 'activation:p1', tokenB)   // B libera o que é dele
    expect(estado.has('activation:p1')).toBe(false)
  })

  it('heartbeat estende para o dono e recusa quem perdeu a posse', async () => {
    const tokenA = await acquireLock(db, 'activation:p1')
    expect(await heartbeatLock(db, 'activation:p1', tokenA!)).toBe(true)
    const antes = estado.get('activation:p1')!.lease_until

    // B toma o lock (simulando lease vencido)
    estado.set('activation:p1', { ...estado.get('activation:p1')!, owner_token: 'de-B' })
    expect(await heartbeatLock(db, 'activation:p1', tokenA!)).toBe(false)
    expect(estado.get('activation:p1')!.lease_until).not.toBe(undefined)
    expect(antes).toBeTypeOf('string')
  })

  it('holdsLock é o fencing: só o dono com lease vivo passa', async () => {
    const tokenA = await acquireLock(db, 'activation:p1')
    expect(await holdsLock(db, 'activation:p1', tokenA!)).toBe(true)
    expect(await holdsLock(db, 'activation:p1', 'token-de-outro')).toBe(false)

    estado.set('activation:p1', { ...estado.get('activation:p1')!, lease_until: new Date(Date.now() - 1000).toISOString() })
    expect(await holdsLock(db, 'activation:p1', tokenA!)).toBe(false)  // lease vencido não vale
  })
})
