import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      async json() { return data },
    }),
  },
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/asaas', () => ({ cancelSubscription: vi.fn(), getSubscription: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logError: vi.fn(), log: vi.fn(), logWarn: vi.fn() }))

import { POST } from './route'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cancelSubscription, getSubscription } from '@/lib/asaas'
import { logError } from '@/lib/logger'

const mockCreateClient = vi.mocked(createClient)
const mockCreateServiceClient = vi.mocked(createServiceClient)
const mockCancelSubscription = vi.mocked(cancelSubscription)
const mockGetSubscription = vi.mocked(getSubscription)
const mockLogError = vi.mocked(logError)

type Profile = {
  asaas_subscription_id: string | null
  plan_expires_at: string | null
  plan_status: string | null
}

// Client do USUÁRIO: só lê o profile (select → eq → single).
function makeSupabase({
  user = { id: 'user-1' } as { id: string } | null,
  profile = null as Profile | null,
} = {}) {
  const single = vi.fn().mockResolvedValue({ data: profile })
  const selectEq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq: selectEq })
  const from = vi.fn().mockReturnValue({ select })
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }, from }
}

// Client SERVICE-ROLE: faz as escritas (update → eq → [select]).
// eqResult é ao mesmo tempo "awaitable" (update().eq() do rollback/expires_at) e tem
// .select() (update().eq().select('id') do mark canceling).
function makeServiceClient({ markRows = [{ id: 'user-1' }] as { id: string }[] } = {}) {
  const update = vi.fn()
  const eqResult = Object.assign(
    Promise.resolve({ error: null }),
    { select: vi.fn().mockResolvedValue({ data: markRows, error: null }) },
  )
  const eq = vi.fn().mockReturnValue(eqResult)
  update.mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ update })
  return { from, _mocks: { update, eq } }
}

describe('POST /api/subscription/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
    mockGetSubscription.mockResolvedValue({ nextDueDate: '2025-12-31' } as never)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('retorna 401 para usuário não autenticado', async () => {
    mockCreateClient.mockResolvedValue(makeSupabase({ user: null }) as never)
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('retorna 400 quando não há assinatura ativa (asaas_subscription_id nulo)', async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabase({ profile: { asaas_subscription_id: null, plan_expires_at: null, plan_status: 'free' } }) as never,
    )
    const res = await POST()
    expect(res.status).toBe(400)
  })

  it('retorna 409 quando assinatura já está sendo cancelada', async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabase({ profile: { asaas_subscription_id: 'sub_123', plan_expires_at: '2025-12-31', plan_status: 'canceling' } }) as never,
    )
    const res = await POST()
    expect(res.status).toBe(409)
  })

  it('retorna 200 e marca canceling via service-role no sucesso', async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabase({ profile: { asaas_subscription_id: 'sub_123', plan_expires_at: '2025-12-31', plan_status: 'active' } }) as never,
    )
    const service = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(service as never)
    mockCancelSubscription.mockResolvedValue({ deleted: true, id: 'sub_123' } as never)

    const res = await POST()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
    expect(service._mocks.update).toHaveBeenCalledWith({ plan_status: 'canceling' })
  })

  it('faz rollback do status e loga erro quando Asaas falha (≠404)', async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabase({ profile: { asaas_subscription_id: 'sub_123', plan_expires_at: '2025-12-31', plan_status: 'active' } }) as never,
    )
    const service = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(service as never)
    mockCancelSubscription.mockRejectedValue(new Error('Asaas timeout'))

    const res = await POST()

    expect(res.status).toBe(502)
    // update via service-role chamado duas vezes: 1. set canceling, 2. rollback para active
    expect(service._mocks.update).toHaveBeenNthCalledWith(1, { plan_status: 'canceling' })
    expect(service._mocks.update).toHaveBeenNthCalledWith(2, { plan_status: 'active' })
    expect(mockLogError).toHaveBeenCalledWith(
      'Asaas cancel failed',
      expect.any(Error),
      expect.objectContaining({ subscriptionId: 'sub_123' }),
    )
  })

  it('503 quando service-role env ausente (após os checks de profile)', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    mockCreateClient.mockResolvedValue(
      makeSupabase({ profile: { asaas_subscription_id: 'sub_123', plan_expires_at: '2025-12-31', plan_status: 'active' } }) as never,
    )
    const res = await POST()
    expect(res.status).toBe(503)
  })
})
