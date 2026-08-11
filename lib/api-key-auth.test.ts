/**
 * api-key-auth — a API key nunca vira chave de rate limit em texto claro (E01-S1-002,
 * fechado na triagem do D-07 em 11/08/2026).
 *
 * A tabela de rate limit persiste a chave como texto legível. Usar a API key crua ali a
 * reintroduzia em claro no banco — o mesmo segredo que o resto do sistema só trata hasheado.
 * O teste verifica o ARGUMENTO passado ao rate limit (a lição do reconcile: verificar o efeito
 * deixa a regressão silenciosa passar).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimitAsync: vi.fn(async () => ({ allowed: true, resetIn: 0 })) }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

import { authenticateApiKey } from './api-key-auth'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const mockSb = vi.mocked(createServerClient)
const mockRate = vi.mocked(checkRateLimitAsync)

const API_KEY = 'ek_live_chave-super-secreta-0123456789'

function dbComDono() {
  return {
    // a RPC verify_api_key_hash resolve o dono; depois o select busca a expiração
    rpc: () => ({ single: async () => ({ data: { id: 'u1', plan: 'professional' }, error: null }) }),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { plan: 'professional', plan_expires_at: null },
            error: null,
          }),
        }),
      }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_API_SECRET = 'segredo-interno'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave'
  mockSb.mockReturnValue(dbComDono() as never)
})

describe('rate limit da API key', () => {
  it('🛡️ a chave do rate limit é HMAC — a API key CRUA nunca aparece', async () => {
    const req = { headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${API_KEY}` : null) } }
    await authenticateApiKey(req as never)

    expect(mockRate).toHaveBeenCalled()
    const chaveUsada = String(mockRate.mock.calls[0][0])
    expect(chaveUsada).not.toContain(API_KEY)
    expect(chaveUsada).toMatch(/^apikey:[0-9a-f]{32}$/)
  })

  it('a mesma API key sempre gera a MESMA chave (o balde não se fragmenta)', async () => {
    const req = { headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${API_KEY}` : null) } }
    await authenticateApiKey(req as never)
    await authenticateApiKey(req as never)
    expect(mockRate.mock.calls[0][0]).toBe(mockRate.mock.calls[1][0])
  })
})
