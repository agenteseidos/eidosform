/**
 * emitirEventoElen (Pacote B) — eventId determinístico, assinatura, retry e desistência.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

import { emitirEventoElen } from './elen-eventos'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  process.env.ELEN_EVENTO_URL = 'https://elen.example/interno/evento-conta'
  process.env.ELEN_EVENTO_SECRET = 'segredo-teste'
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ELEN_EVENTO_URL
  delete process.env.ELEN_EVENTO_SECRET
})

describe('emitirEventoElen', () => {
  it('sucesso: POST assinado com eventId determinístico por (evento, wamid)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    const r = await emitirEventoElen({ evento: 'alterado', telefone: '(83) 98831-9814', wamid: 'wamid.X', detalhe: 'Starter → Plus' })
    expect(r.sent).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://elen.example/interno/evento-conta')
    const headers = init.headers as Record<string, string>
    expect(headers['x-elen-event-id']).toMatch(/^[0-9a-f]{64}$/)
    expect(headers['x-elen-signature']).toMatch(/^[0-9a-f]{64}$/)
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ evento: 'alterado', telefone: '5583988319814', wamid: 'wamid.X', detalhe: 'Starter → Plus' })
    // Determinismo: mesma dupla (evento, wamid) → MESMO eventId (retry do emissor deduplica no receptor)
    await emitirEventoElen({ evento: 'alterado', telefone: '5583988319814', wamid: 'wamid.X' })
    const h2 = fetchMock.mock.calls[1][1].headers as Record<string, string>
    expect(h2['x-elen-event-id']).toBe(headers['x-elen-event-id'])
  })

  it('5xx: retry até suceder (3 tentativas no total)', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
    const r = await emitirEventoElen({ evento: 'ativado', telefone: '5583988319814', wamid: 'wamid.Y' })
    expect(r.sent).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 15000)

  it('4xx definitivo (422): desiste na primeira, sem retry', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422 })
    const r = await emitirEventoElen({ evento: 'cadastro', telefone: '5583988319814', wamid: 'wamid.Z' })
    expect(r).toEqual({ sent: false, skipped: 'http_422' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sem config → skip silencioso; sem telefone/wamid → skip', async () => {
    delete process.env.ELEN_EVENTO_URL
    expect(await emitirEventoElen({ evento: 'acesso', telefone: '5583988319814', wamid: 'w' })).toEqual({ sent: false, skipped: 'no_config' })
    process.env.ELEN_EVENTO_URL = 'https://elen.example/x'
    expect((await emitirEventoElen({ evento: 'acesso', telefone: '123', wamid: 'w' })).skipped).toBe('no_phone_or_wamid')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
