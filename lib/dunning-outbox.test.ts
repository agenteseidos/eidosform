import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildDunningDeliveryKey, finishDunningDelivery, listRecoverableDunningKeys, reserveDunningDelivery,
} from './dunning-outbox'

type UpdateResult = { data: unknown[] | null; error: { message?: string } | null }

function makeDb(params: {
  insertError?: { code?: string; message?: string } | null
  updateResults?: UpdateResult[]
} = {}) {
  const inserts: unknown[] = []
  const updates: { payload: unknown; filters: [string, string, string][] }[] = []
  const results = [...(params.updateResults ?? [])]
  const table = {
    insert: async (payload: unknown) => {
      inserts.push(payload)
      return { error: params.insertError ?? null }
    },
    update: (payload: unknown) => {
      const call = { payload, filters: [] as [string, string, string][] }
      updates.push(call)
      const query = {
        eq(column: string, value: string) { call.filters.push(['eq', column, value]); return query },
        lt(column: string, value: string) { call.filters.push(['lt', column, value]); return query },
        async select() { return results.shift() ?? { data: [], error: null } },
      }
      return query
    },
  }
  return { db: { from: () => table }, inserts, updates }
}

const params = { profileId: '11111111-1111-4111-8111-111111111111', stage: 2, day: '2026-08-13', channel: 'email' as const }

afterEach(() => vi.useRealTimers())

describe('dunning outbox — reserva por canal', () => {
  it('chave estável inclui perfil, estágio, dia e canal', () => {
    expect(buildDunningDeliveryKey(params)).toBe('dunning:11111111-1111-4111-8111-111111111111:2:2026-08-13:email')
  })

  it('insert novo nasce reserved e devolve o lease', async () => {
    const { db, inserts } = makeDb()
    const reservation = await reserveDunningDelivery(db as never, params)

    expect(reservation).toMatchObject({ key: buildDunningDeliveryKey(params), channel: 'email' })
    expect(inserts[0]).toMatchObject({
      idempotency_key: buildDunningDeliveryKey(params), status: 'reserved', channel: 'email',
    })
  })

  it('erro de insert diferente de 23505 é falha real, não duplicata', async () => {
    const { db, updates } = makeDb({ insertError: { code: '08006', message: 'connection lost' } })

    await expect(reserveDunningDelivery(db as never, params)).rejects.toThrow('08006')
    expect(updates).toHaveLength(0)
  })

  it('23505 retoma uma entrega failed por CAS', async () => {
    const { db, updates } = makeDb({
      insertError: { code: '23505' },
      updateResults: [{ data: [{ idempotency_key: 'x' }], error: null }],
    })

    const reservation = await reserveDunningDelivery(db as never, params)

    expect(reservation).not.toBeNull()
    expect(updates[0].filters).toContainEqual(['eq', 'status', 'failed'])
  })

  it('23505 toma uma reserva órfã somente depois do lease', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T15:00:00Z'))
    const { db, updates } = makeDb({
      insertError: { code: '23505' },
      updateResults: [
        { data: [], error: null },
        { data: [{ idempotency_key: 'x' }], error: null },
      ],
    })

    const reservation = await reserveDunningDelivery(db as never, params)

    expect(reservation).not.toBeNull()
    expect(updates[1].filters).toContainEqual(['eq', 'status', 'reserved'])
    expect(updates[1].filters).toContainEqual(['lt', 'leased_at', '2026-08-13T14:50:00.000Z'])
  })

  it('entrega concluída ou reserva ainda viva não é tomada', async () => {
    const { db } = makeDb({
      insertError: { code: '23505' },
      updateResults: [{ data: [], error: null }, { data: [], error: null }],
    })
    await expect(reserveDunningDelivery(db as never, params)).resolves.toBeNull()
  })

  it('fora da hora não cria linha nova, mas retoma failed existente', async () => {
    const { db, inserts, updates } = makeDb({
      updateResults: [{ data: [{ idempotency_key: 'x' }], error: null }],
    })

    const reservation = await reserveDunningDelivery(db as never, { ...params, createIfMissing: false })

    expect(inserts).toHaveLength(0)
    expect(reservation).not.toBeNull()
    expect(updates[0].filters).toContainEqual(['eq', 'status', 'failed'])
  })
})

describe('dunning outbox — finalização', () => {
  it('grava accepted somente se ainda possuir o lease', async () => {
    const { db, updates } = makeDb({ updateResults: [{ data: [{ idempotency_key: 'x' }], error: null }] })
    await finishDunningDelivery(db as never, {
      key: buildDunningDeliveryKey(params), leaseToken: 'lease-1', channel: 'email',
    }, 'accepted', { providerMessageId: 'email-1' })

    expect(updates[0].payload).toMatchObject({ status: 'accepted', provider_message_id: 'email-1' })
    expect(updates[0].filters).toContainEqual(['eq', 'lease_token', 'lease-1'])
  })

  it('worker que perdeu o lease não sobrescreve a nova reserva', async () => {
    const { db } = makeDb({ updateResults: [{ data: [], error: null }] })
    await expect(finishDunningDelivery(db as never, {
      key: buildDunningDeliveryKey(params), leaseToken: 'lease-velho', channel: 'email',
    }, 'failed')).rejects.toThrow('não pertence mais')
  })
})

describe('dunning outbox — descoberta de retries', () => {
  it('lista somente as chaves recuperáveis do dia', async () => {
    const filters: unknown[][] = []
    const query = {
      eq: (...args: unknown[]) => { filters.push(['eq', ...args]); return query },
      in: (...args: unknown[]) => { filters.push(['in', ...args]); return query },
      limit: async (...args: unknown[]) => {
        filters.push(['limit', ...args])
        return { data: [{ idempotency_key: 'dunning:p1:0:2026-08-13:email' }], error: null }
      },
    }
    const db = { from: () => ({ select: () => query }) }

    const keys = await listRecoverableDunningKeys(db as never, '2026-08-13')

    expect(keys).toEqual(new Set(['dunning:p1:0:2026-08-13:email']))
    expect(filters).toContainEqual(['eq', 'day', '2026-08-13'])
    expect(filters).toContainEqual(['in', 'status', ['failed', 'reserved']])
  })
})
