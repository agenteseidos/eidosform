import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      async json() { return data },
    }),
  },
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimitAsync: vi.fn() }))

import { POST } from './route'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const mockCreateClient = vi.mocked(createClient)
const mockRateLimit = vi.mocked(checkRateLimitAsync)

const signUp = vi.fn()

function makeReq(body: Record<string, unknown>) {
  return {
    json: async () => body,
    headers: { get: () => '203.0.113.10' },
  } as unknown as Parameters<typeof POST>[0]
}

const VALID = {
  email: 'Novo@Exemplo.com ',
  password: 'senhaforte123',
  fullName: 'Fulano de Tal',
  phone: '(83) 99937-6704',
}

beforeEach(() => {
  vi.clearAllMocks()
  signUp.mockResolvedValue({ error: null })
  mockRateLimit.mockResolvedValue({ allowed: true, resetIn: 0 } as never)
  mockCreateClient.mockResolvedValue({ auth: { signUp } } as never)
})

describe('POST /api/auth/signup — telefone obrigatório', () => {
  it('recusa cadastro sem telefone e NÃO chama o Supabase', async () => {
    const res = await POST(makeReq({ ...VALID, phone: '' }))
    expect(res.status).toBe(400)
    expect(signUp).not.toHaveBeenCalled()
  })

  it('recusa telefone curto demais (menos de 10 dígitos)', async () => {
    const res = await POST(makeReq({ ...VALID, phone: '(83) 9993' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Telefone/i)
    expect(signUp).not.toHaveBeenCalled()
  })

  it('recusa telefone longo demais (mais de 15 dígitos)', async () => {
    const res = await POST(makeReq({ ...VALID, phone: '1234567890123456' }))
    expect(res.status).toBe(400)
    expect(signUp).not.toHaveBeenCalled()
  })

  it('recusa quando o nome continua faltando (regra antiga preservada)', async () => {
    const res = await POST(makeReq({ ...VALID, fullName: '' }))
    expect(res.status).toBe(400)
    expect(signUp).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/signup — normalização e propagação', () => {
  it('grava o telefone em dígitos com DDI 55 no metadata, junto do nome', async () => {
    const res = await POST(makeReq(VALID))
    expect(res.status).toBe(201)
    expect(signUp).toHaveBeenCalledTimes(1)
    const arg = signUp.mock.calls[0][0]
    expect(arg.email).toBe('novo@exemplo.com')
    expect(arg.options.data).toEqual({
      full_name: 'Fulano de Tal',
      phone: '5583999376704',
    })
    expect(mockRateLimit).toHaveBeenCalledTimes(3)
    expect(mockRateLimit.mock.calls[0][0]).toMatch(/^signup:email:[a-f0-9]{24}$/)
  })

  it('número já com DDI passa intacto (não ganha um 55 a mais)', async () => {
    await POST(makeReq({ ...VALID, phone: '+55 83 99937-6704' }))
    expect(signUp.mock.calls[0][0].options.data.phone).toBe('5583999376704')
  })

  it('número internacional preserva o próprio DDI', async () => {
    await POST(makeReq({ ...VALID, phone: '+351912345678' }))
    expect(signUp.mock.calls[0][0].options.data.phone).toBe('351912345678')
  })

  it('e-mail duplicado continua devolvendo 201 genérico (anti-enumeração)', async () => {
    signUp.mockResolvedValue({ error: { message: 'User already registered' } })
    const res = await POST(makeReq(VALID))
    expect(res.status).toBe(201)
    expect((await res.json()).success).toBe(true)
  })

  it('valida o telefone ANTES de gastar o rate limit', async () => {
    await POST(makeReq({ ...VALID, phone: '123' }))
    expect(mockRateLimit).not.toHaveBeenCalled()
  })
})
