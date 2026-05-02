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
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/asaas', () => ({ cancelSubscription: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logError: vi.fn(), log: vi.fn(), logWarn: vi.fn() }))

import { POST } from './route'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cancelSubscription } from '@/lib/asaas'
import { logError } from '@/lib/logger'

const mockCreateClient = vi.mocked(createClient)
const mockCreateAdminClient = vi.mocked(createAdminClient)
const mockCancelSubscription = vi.mocked(cancelSubscription)
const mockLogError = vi.mocked(logError)

type Profile = {
  asaas_subscription_id: string | null
  plan_status: string | null
}

function makeSupabase({
  user = { id: 'user-1' } as { id: string } | null,
  profile = null as Profile | null,
} = {}) {
  const single = vi.fn().mockResolvedValue({ data: profile })
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from,
  }
}

function makeAdminSupabase({ deleteUserError = null as unknown } = {}) {
  const deleteEq = vi.fn().mockResolvedValue({ error: null })
  const deleteMethod = vi.fn().mockReturnValue({ eq: deleteEq })
  const from = vi.fn().mockReturnValue({ delete: deleteMethod })

  const deleteUser = vi.fn().mockResolvedValue({ error: deleteUserError })

  return {
    from,
    auth: { admin: { deleteUser } },
    _mocks: { from, deleteMethod, deleteEq, deleteUser },
  }
}

describe('POST /api/account/delete', () => {
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

  it('retorna 200 e executa cleanup completo em caso de sucesso', async () => {
    const supabase = makeSupabase({
      profile: { asaas_subscription_id: 'sub_123', plan_status: 'active' },
    })
    const adminSupabase = makeAdminSupabase()
    mockCreateClient.mockResolvedValue(supabase as never)
    mockCreateAdminClient.mockReturnValue(adminSupabase as never)
    mockCancelSubscription.mockResolvedValue({ deleted: true, id: 'sub_123' })

    const res = await POST()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
    // whatsapp_settings deletado antes do auth user
    expect(adminSupabase._mocks.from).toHaveBeenCalledWith('form_whatsapp_settings')
    expect(adminSupabase._mocks.deleteMethod).toHaveBeenCalled()
    expect(adminSupabase._mocks.deleteUser).toHaveBeenCalledWith('user-1')
  })

  it('falha no Asaas não bloqueia a deleção da conta (best-effort)', async () => {
    const supabase = makeSupabase({
      profile: { asaas_subscription_id: 'sub_123', plan_status: 'active' },
    })
    const adminSupabase = makeAdminSupabase()
    mockCreateClient.mockResolvedValue(supabase as never)
    mockCreateAdminClient.mockReturnValue(adminSupabase as never)
    const asaasError = new Error('Asaas indisponível')
    mockCancelSubscription.mockRejectedValue(asaasError)

    const res = await POST()

    // Deleção prossegue mesmo com falha no Asaas
    expect(res.status).toBe(200)
    expect(adminSupabase._mocks.deleteUser).toHaveBeenCalledWith('user-1')
    expect(mockLogError).toHaveBeenCalledWith(
      'Asaas cancel on delete failed',
      asaasError,
      expect.objectContaining({ subscriptionId: 'sub_123' }),
    )
  })
})
