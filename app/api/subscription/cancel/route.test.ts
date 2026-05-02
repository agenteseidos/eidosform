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
vi.mock('@/lib/asaas', () => ({ cancelSubscription: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logError: vi.fn(), log: vi.fn(), logWarn: vi.fn() }))

import { POST } from './route'
import { createClient } from '@/lib/supabase/server'
import { cancelSubscription } from '@/lib/asaas'
import { logError } from '@/lib/logger'

const mockCreateClient = vi.mocked(createClient)
const mockCancelSubscription = vi.mocked(cancelSubscription)
const mockLogError = vi.mocked(logError)

type Profile = {
  asaas_subscription_id: string | null
  plan_expires_at: string | null
  plan_status: string | null
}

function makeSupabase({
  user = { id: 'user-1' } as { id: string } | null,
  profile = null as Profile | null,
  updateError = null as unknown,
} = {}) {
  const single = vi.fn().mockResolvedValue({ data: profile })
  const selectEq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq: selectEq })

  const updateEq = vi.fn().mockResolvedValue({ error: updateError })
  const update = vi.fn().mockReturnValue({ eq: updateEq })

  const from = vi.fn().mockReturnValue({ select, update })

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from,
    _mocks: { update, updateEq },
  }
}

describe('POST /api/subscription/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 401 para usuário não autenticado', async () => {
    const supabase = makeSupabase({ user: null })
    mockCreateClient.mockResolvedValue(supabase as never)

    const res = await POST()

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: expect.any(String) })
  })

  it('retorna 400 quando não há assinatura ativa (asaas_subscription_id nulo)', async () => {
    const supabase = makeSupabase({
      profile: { asaas_subscription_id: null, plan_expires_at: null, plan_status: 'free' },
    })
    mockCreateClient.mockResolvedValue(supabase as never)

    const res = await POST()

    expect(res.status).toBe(400)
  })

  it('retorna 409 quando assinatura já está sendo cancelada', async () => {
    const supabase = makeSupabase({
      profile: { asaas_subscription_id: 'sub_123', plan_expires_at: '2025-12-31', plan_status: 'canceling' },
    })
    mockCreateClient.mockResolvedValue(supabase as never)

    const res = await POST()

    expect(res.status).toBe(409)
  })

  it('retorna 200 e atualiza plan_status para canceling no sucesso', async () => {
    const supabase = makeSupabase({
      profile: { asaas_subscription_id: 'sub_123', plan_expires_at: '2025-12-31', plan_status: 'active' },
    })
    mockCreateClient.mockResolvedValue(supabase as never)
    mockCancelSubscription.mockResolvedValue({ deleted: true, id: 'sub_123' })

    const res = await POST()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
    expect(supabase._mocks.update).toHaveBeenCalledWith({ plan_status: 'canceling' })
  })

  it('faz rollback do status e loga erro quando Asaas falha', async () => {
    const supabase = makeSupabase({
      profile: { asaas_subscription_id: 'sub_123', plan_expires_at: '2025-12-31', plan_status: 'active' },
    })
    mockCreateClient.mockResolvedValue(supabase as never)
    const asaasError = new Error('Asaas timeout')
    mockCancelSubscription.mockRejectedValue(asaasError)

    const res = await POST()

    expect(res.status).toBe(502)
    // update chamado duas vezes: 1. set canceling, 2. rollback para active
    expect(supabase._mocks.update).toHaveBeenCalledTimes(2)
    expect(supabase._mocks.update).toHaveBeenNthCalledWith(1, { plan_status: 'canceling' })
    expect(supabase._mocks.update).toHaveBeenNthCalledWith(2, { plan_status: 'active' })
    expect(mockLogError).toHaveBeenCalledWith(
      'Asaas cancel failed',
      asaasError,
      expect.objectContaining({ subscriptionId: 'sub_123' }),
    )
  })
})
