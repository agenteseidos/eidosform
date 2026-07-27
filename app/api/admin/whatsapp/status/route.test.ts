import { describe, it, expect, vi, beforeEach } from 'vitest'

// A rota exige admin; aqui o foco é a TRADUÇÃO do payload da VPS, não a auth.
vi.mock('@/lib/admin-auth', () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, user: { id: 'u1', email: 'a@b.com' } })),
}))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }))
vi.mock('@/lib/whatsapp-client', () => ({
  getWhatsappUrl: (p: string) => `http://vps${p}`,
  getWhatsappAuthHeaders: () => ({ Authorization: 'Bearer x' }),
}))

import { GET } from './route'

/** Resposta realista da VPS, com os campos que o painel consome. */
function respostaDaVps(extra: Record<string, unknown> = {}) {
  return {
    authenticated: true,
    connected: true,
    phoneNumber: '+55 83 9696-6457',
    primaryTransport: 'wuzapi',
    fallbackTransport: 'wacli',
    activeTransport: 'wuzapi',
    activeSince: '2026-07-27T14:00:00.000Z',
    fallbackActive: false,
    fallbackReason: null,
    fallbackIncident: null,
    transports: {
      wacli: { authenticated: true, connected: true, phoneNumber: '+55 83 9696-6457', available: true, error: null },
      wuzapi: { authenticated: true, connected: true, phoneNumber: '+55 83 9696-6457', available: true, error: null },
    },
    volume: { today: 39, average7Days: 39.7, coverageDays: 4, elevated: false },
    sendsByTransport: { wacli: 5, wuzapi: 15, fallback: 2, legacy: 291 },
    daily: {
      '2026-07-26': { total: 49, wacli: 0, wuzapi: 0, fallback: 0, legacy: 49, failed: 0 },
      '2026-07-27': { total: 39, wacli: 5, wuzapi: 15, fallback: 2, legacy: 13, failed: 4 },
    },
    transportAttributionSince: '2026-07-27T14:32:17.241Z',
    ...extra,
  }
}

function mockFetch(payload: unknown, ok = true) {
  global.fetch = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 502,
    json: async () => payload,
  })) as unknown as typeof fetch
}

const req = () => new Request('http://localhost/api/admin/whatsapp/status') as never

describe('proxy de status do admin — a lista branca não pode engolir campo', () => {
  beforeEach(() => vi.clearAllMocks())

  it('REGRESSÃO: preserva `daily`, que sumia e zerava "Envios por motor"', async () => {
    // Em 27/07 a tela mostrou "Envios hoje 39" e "Envios por motor 0" ao mesmo
    // tempo: a VPS mandava `daily`, mas esta rota reconstrói campo a campo e o
    // campo novo não tinha sido incluído. Sumiu sem erro nenhum.
    mockFetch(respostaDaVps())
    const body = await (await GET(req())).json()

    expect(body.daily).toBeDefined()
    expect(Object.keys(body.daily)).toEqual(['2026-07-26', '2026-07-27'])
    expect(body.daily['2026-07-27']).toEqual({
      total: 39, wacli: 5, wuzapi: 15, fallback: 2, legacy: 13, failed: 4,
    })
    expect(body.transportAttributionSince).toBe('2026-07-27T14:32:17.241Z')
  })

  it('o total do dia bate com o volume — os dois números vêm da mesma fonte', async () => {
    mockFetch(respostaDaVps())
    const body = await (await GET(req())).json()
    const hoje = body.daily['2026-07-27']
    expect(hoje.total).toBe(body.volume.today)
  })

  it('descarta chave que não é data e normaliza contador inválido', async () => {
    mockFetch(respostaDaVps({
      daily: {
        'não-é-data': { total: 999 },
        '2026-07-27': { total: 'lixo', wuzapi: null },
      },
    }))
    const body = await (await GET(req())).json()
    expect(Object.keys(body.daily)).toEqual(['2026-07-27'])
    expect(body.daily['2026-07-27']).toEqual({
      total: 0, wacli: 0, wuzapi: 0, fallback: 0, legacy: 0, failed: 0,
    })
  })

  it('VPS fora devolve `daily` vazio em vez de indefinido (a tela itera nele)', async () => {
    mockFetch(null, false)
    const body = await (await GET(req())).json()
    expect(body.daily).toEqual({})
    expect(body.transportAttributionSince).toBeNull()
  })
})
