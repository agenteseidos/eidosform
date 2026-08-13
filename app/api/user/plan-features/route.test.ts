import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}))

const state = vi.hoisted(() => ({
  profile: {
    plan: 'plus', plan_cycle: 'MONTHLY', plan_status: 'active',
    plan_expires_at: '2026-08-12T02:59:59.999Z', asaas_subscription_id: 'sub_1',
    responses_used: 7, responses_limit: 1000,
  },
  updates: [] as Array<{ payload: Record<string, unknown>; filters: Array<[string, unknown]> }>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: state.profile }) }) }) }),
  })),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        const call = { payload, filters: [] as Array<[string, unknown]> }
        state.updates.push(call)
        const chain = {
          eq: (key: string, value: unknown) => { call.filters.push([key, value]); return chain },
          select: async () => ({ data: [{ id: 'u1' }], error: null }),
        }
        return chain
      },
    }),
  })),
}))

const asaas = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  hasOverduePaymentForSubscription: vi.fn(),
}))
vi.mock('@/lib/asaas', () => asaas)
vi.mock('@/lib/plan-limits', async (orig) => ({
  ...(await orig<object>()),
  handleDowngrade: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  state.updates.length = 0
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-13T12:00:00Z'))
  asaas.getSubscription.mockResolvedValue({ status: 'ACTIVE', nextDueDate: '2026-09-13' })
  asaas.hasOverduePaymentForSubscription.mockResolvedValue({ ok: true, overdue: false, oldestDueDate: null })
})
describe('plan-features — expiração local com assinatura ACTIVE', () => {
  it('cobrança OVERDUE mantém a carência sem empurrar plan_expires_at', async () => {
    asaas.hasOverduePaymentForSubscription.mockResolvedValue({ ok: true, overdue: true, oldestDueDate: '2026-08-12' })

    const res = await GET()

    expect(res.status).toBe(200)
    expect(state.updates).toHaveLength(0)
  })

  it('consulta de OVERDUE inconclusiva não estende nem derruba', async () => {
    asaas.hasOverduePaymentForSubscription.mockResolvedValue({ ok: false, overdue: false, oldestDueDate: null })

    await GET()

    expect(state.updates).toHaveLength(0)
  })

  it('sem cobrança vencida estende com CAS sobre todo o snapshot financeiro', async () => {
    await GET()

    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].filters).toEqual([
      ['id', 'u1'],
      ['plan', 'plus'],
      ['plan_expires_at', '2026-08-12T02:59:59.999Z'],
      ['asaas_subscription_id', 'sub_1'],
    ])
  })
})
