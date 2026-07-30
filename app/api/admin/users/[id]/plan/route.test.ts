import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      async json() { return data },
    }),
  },
}))

vi.mock('@/lib/admin-auth', () => ({
  requireAdmin: vi.fn(),
  getAdminSupabase: vi.fn(),
}))
vi.mock('@/lib/asaas', () => ({ cancelSubscription: vi.fn() }))
vi.mock('@/lib/plan-limits', () => ({
  PLANS: {
    free: { maxResponses: 100 },
    starter: { maxResponses: 1000 },
    plus: { maxResponses: 5000 },
    professional: { maxResponses: 15000 },
  },
  handleDowngrade: vi.fn(async () => ({ pausedCount: 0 })),
  handleUpgrade: vi.fn(async () => ({ unpausedCount: 0 })),
}))
vi.mock('@/lib/admin-journal', () => ({ recordAdminAction: vi.fn(async () => undefined) }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

import { PATCH } from './route'
import { requireAdmin, getAdminSupabase } from '@/lib/admin-auth'
import { cancelSubscription } from '@/lib/asaas'
import { handleDowngrade, handleUpgrade } from '@/lib/plan-limits'
import { recordAdminAction } from '@/lib/admin-journal'

const mockRequireAdmin = vi.mocked(requireAdmin)
const mockGetAdminSupabase = vi.mocked(getAdminSupabase)
const mockCancelSubscription = vi.mocked(cancelSubscription)
const mockHandleDowngrade = vi.mocked(handleDowngrade)
const mockHandleUpgrade = vi.mocked(handleUpgrade)
const mockRecordAdminAction = vi.mocked(recordAdminAction)

type ProfileFixture = {
  id: string
  email: string | null
  plan: string | null
  plan_cycle: string | null
  plan_status: string | null
  plan_expires_at: string | null
  asaas_subscription_id: string | null
  lifetime_access: boolean | null
  responses_used: number | null
  responses_limit: number | null
}

function profileFixture(overrides: Partial<ProfileFixture> = {}): ProfileFixture {
  return {
    id: 'user-1',
    email: 'cliente@example.com',
    plan: 'starter',
    plan_cycle: null,
    plan_status: 'active',
    plan_expires_at: '2026-08-15T23:59:59.000Z',
    asaas_subscription_id: null,
    lifetime_access: false,
    responses_used: 900,
    responses_limit: 1000,
    ...overrides,
  }
}

/** Supabase fake: single() devolve o fixture; update captura o payload. */
function makeSupabase(profile: ProfileFixture) {
  const updates: Record<string, unknown>[] = []
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: profile, error: null }) }) }),
    update: (payload: Record<string, unknown>) => {
      updates.push(payload)
      return { eq: async () => ({ error: null }) }
    },
  }))
  return { client: { from }, updates }
}

function makeReq(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof PATCH>[0]
}

const params = { params: Promise.resolve({ id: 'user-1' }) }
const FUTURE = '2026-09-30'

beforeEach(() => {
  vi.clearAllMocks()
  // A rota só pausa/despausa forms quando a service key existe no ambiente.
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  mockRequireAdmin.mockResolvedValue({
    ok: true,
    user: { id: 'admin-1', email: 'admin@eidos.com' },
  } as never)
})

describe('PATCH /admin/users/[id]/plan — motivo obrigatório', () => {
  it('rejeita sem motivo (400) antes de tocar o banco', async () => {
    const { client } = makeSupabase(profileFixture())
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(makeReq({ plan: 'starter', expiresOn: FUTURE }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/motivo/i)
  })

  it('rejeita motivo curto demais', async () => {
    const { client } = makeSupabase(profileFixture())
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'ok' }), params)
    expect(res.status).toBe(400)
  })
})

describe('ajuste de data SEM troca de plano (bug A1 + reativação acidental)', () => {
  it('atualiza SÓ plan_expires_at — não zera cota, não força status, não chama handlers', async () => {
    const { client, updates } = makeSupabase(profileFixture({ plan_status: 'canceling' }))
    mockGetAdminSupabase.mockReturnValue(client as never)

    const res = await PATCH(
      makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'cortesia por atraso no suporte' }),
      params
    )
    expect(res.status).toBe(200)
    expect(updates).toHaveLength(1)
    const payload = updates[0]
    expect(Object.keys(payload)).toEqual(['plan_expires_at'])
    // O que o bug A1 fazia e NÃO pode voltar:
    expect(payload).not.toHaveProperty('responses_used')
    expect(payload).not.toHaveProperty('responses_limit')
    expect(payload).not.toHaveProperty('response_period_start_at')
    expect(payload).not.toHaveProperty('limit_alert_sent')
    expect(payload).not.toHaveProperty('plan_status') // preserva 'canceling'
    expect(mockHandleUpgrade).not.toHaveBeenCalled()
    expect(mockHandleDowngrade).not.toHaveBeenCalled()
  })

  it('converte expiresOn para fim do dia BRT no servidor', async () => {
    const { client, updates } = makeSupabase(profileFixture())
    mockGetAdminSupabase.mockReturnValue(client as never)
    await PATCH(makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'cortesia teste' }), params)
    // 2026-09-30 23:59:59 -03:00 === 2026-10-01T02:59:59Z
    expect(updates[0].plan_expires_at).toBe(new Date('2026-09-30T23:59:59-03:00').toISOString())
  })

  it('bloqueia ajuste de data de quem TEM sub Asaas (409, até a Fase 4)', async () => {
    const { client, updates } = makeSupabase(profileFixture({ asaas_subscription_id: 'sub_123' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'tentativa de cortesia' }),
      params
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/NÃO move a cobrança/i)
    expect(updates).toHaveLength(0)
  })

  it('rejeita remover a expiração de plano pago (grant eterno proibido)', async () => {
    const { client } = makeSupabase(profileFixture())
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'starter', expiresOn: null, reason: 'tentando grant eterno' }),
      params
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/vitalícia/i)
  })
})

describe('conta vitalícia', () => {
  it('409 no servidor — nunca sucesso otimista', async () => {
    const { client, updates } = makeSupabase(profileFixture({ lifetime_access: true, plan: 'professional' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'free', reason: 'tentando rebaixar a vitalícia' }),
      params
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/vitalício/i)
    expect(updates).toHaveLength(0)
    expect(mockCancelSubscription).not.toHaveBeenCalled()
  })
})

describe('troca de plano', () => {
  it('grant pago exige expiração explícita', async () => {
    const { client } = makeSupabase(profileFixture({ plan: 'free', plan_expires_at: null }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(makeReq({ plan: 'plus', reason: 'cortesia de lançamento' }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/expiração/i)
  })

  it('grant pago com data: reseta cota (troca REAL de plano) e chama handleUpgrade', async () => {
    const { client, updates } = makeSupabase(profileFixture({ plan: 'free', plan_expires_at: null }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'plus', expiresOn: FUTURE, reason: 'cortesia de lançamento' }),
      params
    )
    expect(res.status).toBe(200)
    const payload = updates[0]
    expect(payload.plan).toBe('plus')
    expect(payload.responses_limit).toBe(5000)
    expect(payload.responses_used).toBe(0)
    expect(payload.plan_status).toBe('active')
    expect(mockHandleUpgrade).toHaveBeenCalledTimes(1)
  })

  it('pago→pago com sub Asaas: 409 sem sugerir "mova para free primeiro"', async () => {
    const { client } = makeSupabase(profileFixture({ plan: 'starter', asaas_subscription_id: 'sub_123' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'plus', expiresOn: FUTURE, reason: 'upgrade manual indevido' }),
      params
    )
    expect(res.status).toBe(409)
    const msg = (await res.json()).error as string
    expect(msg).not.toMatch(/free primeiro/i)
    expect(msg).toMatch(/billing/i)
  })

  it('→free com sub: cancela no Asaas ANTES e segue fail-closed em falha', async () => {
    const { client, updates } = makeSupabase(profileFixture({ plan: 'plus', asaas_subscription_id: 'sub_123' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    mockCancelSubscription.mockRejectedValue(new Error('Asaas error 500'))
    const res = await PATCH(makeReq({ plan: 'free', reason: 'cliente pediu cancelamento' }), params)
    expect(res.status).toBe(502)
    expect(updates).toHaveLength(0) // nada gravado localmente
  })

  it('falha de handleDowngrade vira warning visível, não silêncio', async () => {
    const { client } = makeSupabase(profileFixture({ plan: 'plus', asaas_subscription_id: 'sub_123' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    mockCancelSubscription.mockResolvedValue({ deleted: true, id: 'sub_123' })
    mockHandleDowngrade.mockRejectedValue(new Error('pause failed'))
    const res = await PATCH(makeReq({ plan: 'free', reason: 'cliente pediu cancelamento' }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warnings).toHaveLength(1)
    expect(body.warnings[0]).toMatch(/pausa/i)
  })

  it('toda mutação bem-sucedida registra no journal com o motivo', async () => {
    const { client } = makeSupabase(profileFixture())
    mockGetAdminSupabase.mockReturnValue(client as never)
    await PATCH(makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'cortesia por atraso' }), params)
    expect(mockRecordAdminAction).toHaveBeenCalledTimes(1)
    const entry = mockRecordAdminAction.mock.calls[0][0]
    expect(entry.action).toBe('expiry_adjust')
    expect(entry.reason).toBe('cortesia por atraso')
    expect(entry.actorEmail).toBe('admin@eidos.com')
  })
})
