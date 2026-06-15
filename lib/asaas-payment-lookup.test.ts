import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getPaymentById, findPaymentByExternalReference } from './asaas'

// Mocka o fetch global (asaasFetch usa fetch por baixo). Foco: a LÓGICA de idempotência do P0-A —
// distinguir "consulta falhou" (ok:false → NÃO cobrar de novo) de "não existe" (payment:null).
function stubFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
}

beforeEach(() => {
  process.env.ASAAS_API_KEY = 'test-key'
  process.env.ASAAS_ENVIRONMENT = 'sandbox'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getPaymentById (P0-A idempotência)', () => {
  it('existe → retorna {id,status} com ok:true', async () => {
    stubFetch(200, { id: 'pay_1', status: 'CONFIRMED' })
    const r = await getPaymentById('pay_1')
    expect(r.ok).toBe(true)
    expect(r.payment).toEqual({ id: 'pay_1', status: 'CONFIRMED' })
  })

  it('404 → não existe (ok:true, payment:null)', async () => {
    stubFetch(404, { errors: [{ description: 'not found' }] })
    const r = await getPaymentById('pay_x')
    expect(r.ok).toBe(true)
    expect(r.payment).toBeNull()
  })

  it('5xx → consulta FALHOU (ok:false) — chamador NÃO deve cobrar de novo', async () => {
    stubFetch(500, { errors: [] })
    const r = await getPaymentById('pay_1')
    expect(r.ok).toBe(false)
    expect(r.payment).toBeNull()
  })
})

describe('findPaymentByExternalReference (P0-A idempotência)', () => {
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

  it('retorna o avulso utilizável mais RECENTE (CONFIRMED/RECEIVED/PENDING)', async () => {
    stubFetch(200, {
      data: [
        { id: 'pay_old', status: 'CONFIRMED', dateCreated: iso(5 * 60_000) }, // 5 min
        { id: 'pay_new', status: 'PENDING', dateCreated: iso(60_000) }, // 1 min (mais recente)
      ],
    })
    const r = await findPaymentByExternalReference('profile:p|plan:plus|cycle:MONTHLY|kind:planchange')
    expect(r.ok).toBe(true)
    expect(r.payment?.id).toBe('pay_new')
  })

  it('ignora avulso ANTIGO (>24h) do mesmo externalReference → null (cobra a troca nova)', async () => {
    stubFetch(200, { data: [{ id: 'pay_velho', status: 'CONFIRMED', dateCreated: iso(48 * 3600_000) }] })
    const r = await findPaymentByExternalReference('ref')
    expect(r.ok).toBe(true)
    expect(r.payment).toBeNull()
  })

  it('lista vazia → payment:null', async () => {
    stubFetch(200, { data: [] })
    const r = await findPaymentByExternalReference('ref')
    expect(r.ok).toBe(true)
    expect(r.payment).toBeNull()
  })

  it('só REFUNDED → null (não reutiliza avulso estornado)', async () => {
    stubFetch(200, { data: [{ id: 'pay_r', status: 'REFUNDED', dateCreated: iso(60_000) }] })
    const r = await findPaymentByExternalReference('ref')
    expect(r.ok).toBe(true)
    expect(r.payment).toBeNull()
  })

  it('5xx → ok:false (fail-closed: NÃO cobrar de novo)', async () => {
    stubFetch(500, {})
    const r = await findPaymentByExternalReference('ref')
    expect(r.ok).toBe(false)
    expect(r.payment).toBeNull()
  })
})
