import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { createServerClient, checkRateLimitAsync } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  checkRateLimitAsync: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({ createServerClient }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimitAsync }))
vi.mock('@/lib/resend', () => ({ sendBillingOpsAlert: vi.fn(async () => undefined) }))

import { POST } from './route'

type Row = {
  id: string
  plan: string | null
  plan_status: string | null
  plan_cycle: string | null
  plan_expires_at: string | null
}

const activePlus: Row = {
  id: 'profile-1',
  plan: 'plus',
  plan_status: 'active',
  plan_cycle: 'MONTHLY',
  plan_expires_at: '2099-01-01T00:00:00.000Z',
}

function supabase({
  profiles = [],
  snapshots = [],
  profileError = null,
}: {
  profiles?: Row[]
  snapshots?: { profile_id: string }[]
  profileError?: { code: string } | null
}) {
  return {
    from(table: string) {
      let ids: string[] | null = null
      const query = {
        select() { return query },
        eq() { return query },
        in(_column: string, values: string[]) { ids = values; return query },
        limit() {
          if (table === 'profiles') {
            return Promise.resolve({
              data: ids ? profiles.filter((row) => ids!.includes(row.id)) : profiles,
              error: profileError,
            })
          }
          if (table === 'billing_checkouts') {
            return Promise.resolve({ data: snapshots, error: null })
          }
          return Promise.resolve({ data: [], error: null })
        },
        insert() { return Promise.resolve({ error: null }) },
      }
      return query
    },
  }
}

function request(target: Record<string, unknown> = {
  type: 'plan_at_least',
  plan: 'plus',
  cycle: null,
}) {
  return new NextRequest('http://localhost/api/internal/conversion/check', {
    method: 'POST',
    headers: {
      authorization: 'Bearer dedicated-secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ phone: '(83) 99696-6457', target }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FOLLOWUP_CONVERSION_SECRET = 'dedicated-secret'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
  checkRateLimitAsync.mockResolvedValue({ allowed: true, resetIn: 0 })
})

describe('POST /api/internal/conversion/check', () => {
  it('responde converted com corpo mínimo para tier suficiente', async () => {
    createServerClient.mockReturnValue(supabase({ profiles: [activePlus] }))
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, decision: 'converted' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('responde not_converted quando não há match de telefone', async () => {
    createServerClient.mockReturnValue(supabase({ profiles: [] }))
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, decision: 'not_converted' })
  })

  it('responde unknown para cobrança problemática ou match ambíguo', async () => {
    createServerClient.mockReturnValue(supabase({
      profiles: [{ ...activePlus, plan_status: 'overdue' }],
    }))
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, decision: 'unknown' })
  })

  it('falha fechado quando um telefone compartilhado excede o teto defensivo', async () => {
    createServerClient.mockReturnValue(supabase({
      profiles: Array.from({ length: 21 }, (_, index) => ({
        ...activePlus,
        id: `profile-${index}`,
        plan: 'starter',
      })),
    }))
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, decision: 'unknown' })
  })

  it('falha fechado e não expõe detalhes no erro de banco', async () => {
    createServerClient.mockReturnValue(supabase({
      profileError: { code: 'db_test_error' },
    }))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(request())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, decision: 'unknown' })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('5583')
    consoleError.mockRestore()
  })

  it('recusa segredo diferente sem consultar o banco', async () => {
    createServerClient.mockReturnValue(supabase({ profiles: [activePlus] }))
    const req = request()
    req.headers.set('authorization', 'Bearer outro')
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, decision: 'unknown' })
  })
})
