/**
 * POST /api/internal/contact-inbound — a porta por onde a Elen abastece a ficha.
 *
 * O que está trancado: fail-closed sem segredo (503), token errado (401, timing-safe),
 * telefone validado, opt-out que só LIGA (inbound comum nunca desliga), e carimbo com
 * sanidade de relógio.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      async json() { return data },
    }),
  },
}))
vi.mock('@/lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), log: vi.fn() }))

const upsert = vi.hoisted(() => vi.fn(async () => ({ error: null })))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: () => ({ from: () => ({ upsert }) }),
}))

import { POST } from './route'

const SEGREDO = 'segredo-de-teste-com-tamanho-bom'

function req(body: unknown, token?: string) {
  return {
    headers: { get: (k: string) => (k === 'authorization' && token ? `Bearer ${token}` : null) },
    json: async () => body,
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ELEN_OPTOUT_SECRET = SEGREDO
})

describe('contact-inbound', () => {
  it('sem segredo configurado, a porta nem existe (503)', async () => {
    delete process.env.ELEN_OPTOUT_SECRET
    expect((await POST(req({ phone: '5583988319814' }, 'x'))).status).toBe(503)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('token errado ou ausente: 401, sem tocar no banco', async () => {
    expect((await POST(req({ phone: '5583988319814' }))).status).toBe(401)
    expect((await POST(req({ phone: '5583988319814' }, 'errado'))).status).toBe(401)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('telefone inválido: 400', async () => {
    for (const ruim of ['abc', '123', '', null]) {
      expect((await POST(req({ phone: ruim }, SEGREDO))).status).toBe(400)
    }
    expect(upsert).not.toHaveBeenCalled()
  })

  it('inbound comum grava o carimbo e NÃO mexe no opt-out', async () => {
    const r = await POST(req({ phone: '55 (83) 98831-9814', ts: Date.now() }, SEGREDO))
    expect(r.status).toBe(200)
    const linha = upsert.mock.calls[0][0] as Record<string, unknown>
    expect(linha.phone).toBe('5583988319814')
    expect(linha.last_inbound_at).toBeTruthy()
    // ⚠️ inbound comum NUNCA desliga opt-out: quem pediu PARE continua fora das automações.
    expect('opted_out' in linha).toBe(false)
  })

  it('opt-out LIGA a flag junto do carimbo', async () => {
    await POST(req({ phone: '5583988319814', optedOut: true }, SEGREDO))
    const linha = upsert.mock.calls[0][0] as Record<string, unknown>
    expect(linha.opted_out).toBe(true)
    expect(linha.opted_out_at).toBeTruthy()
  })

  it('carimbo com relógio absurdo cai para o agora do servidor', async () => {
    const r = await POST(req({ phone: '5583988319814', ts: 999 }, SEGREDO))
    expect(r.status).toBe(200)
    const linha = upsert.mock.calls[0][0] as Record<string, unknown>
    const ts = Date.parse(String(linha.last_inbound_at))
    expect(Math.abs(Date.now() - ts)).toBeLessThan(10_000)
  })
})
