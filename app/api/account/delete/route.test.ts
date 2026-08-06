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
// O rate limit (3 tentativas/15min por usuário) NÃO estava mockado: usava a implementação real,
// cujo contador acumulava entre os testes deste arquivo. Isso tornava a suíte dependente da ORDEM
// e do NÚMERO de casos — a partir do 4º teste tudo devolvia 429. Mockado como "sempre permite";
// o comportamento do limitador é coberto pelos testes de `lib/rate-limit`. (Auditoria 2026-08.)
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 3 })),
}))

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
  profileError = null as unknown,
} = {}) {
  // `maybeSingle` (não `single`): perfil ausente deve devolver data:null SEM erro — senão o
  // fail-closed da leitura (lote 1D) bloquearia a deleção de quem nunca teve assinatura.
  const maybeSingle = vi.fn().mockResolvedValue({ data: profile, error: profileError })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
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

  it('FAIL-CLOSED: falha no Asaas (≠404) aborta a deleção (502, não deleta)', async () => {
    const supabase = makeSupabase({
      profile: { asaas_subscription_id: 'sub_123', plan_status: 'active' },
    })
    const adminSupabase = makeAdminSupabase()
    mockCreateClient.mockResolvedValue(supabase as never)
    mockCreateAdminClient.mockReturnValue(adminSupabase as never)
    const asaasError = new Error('Asaas API error 500')
    mockCancelSubscription.mockRejectedValue(asaasError)

    const res = await POST()

    // NÃO deleta a conta — evita cobrança órfã.
    expect(res.status).toBe(502)
    expect(adminSupabase._mocks.deleteUser).not.toHaveBeenCalled()
    expect(mockLogError).toHaveBeenCalledWith(
      'Asaas cancel on delete FAILED — abortando deleção (fail-closed)',
      asaasError,
      expect.objectContaining({ subscriptionId: 'sub_123' }),
    )
  })

  it('FAIL-CLOSED NA LEITURA: erro ao ler o profile aborta a deleção (503, não deleta, não cancela)', async () => {
    // Auditoria 2026-08, lote 1D. Antes o erro da leitura era descartado: `profile` ficava
    // indefinido, o bloco de cancelamento era PULADO e a conta era deletada com a assinatura
    // seguindo ACTIVE no Asaas — cobrando alguém que já não existe, sem estado p/ reconciliar.
    const readError = { message: 'connection terminated', code: '57P01' }
    const supabase = makeSupabase({
      profile: { asaas_subscription_id: 'sub_123', plan_status: 'active' },
      profileError: readError,
    })
    const adminSupabase = makeAdminSupabase()
    mockCreateClient.mockResolvedValue(supabase as never)
    mockCreateAdminClient.mockReturnValue(adminSupabase as never)

    const res = await POST()

    expect(res.status).toBe(503)
    expect(adminSupabase._mocks.deleteUser).not.toHaveBeenCalled()
    // Não pode nem tentar cancelar: não sabemos se há assinatura.
    expect(mockCancelSubscription).not.toHaveBeenCalled()
  })

  it('perfil ausente (sem linha) NÃO bloqueia: nada a cancelar, deleta normalmente', async () => {
    // Complemento do teste acima: `maybeSingle` devolve data:null SEM erro quando não há linha.
    // Se usássemos `single` (que erra com PGRST116), o fail-closed barraria quem nunca assinou.
    const supabase = makeSupabase({ profile: null })
    const adminSupabase = makeAdminSupabase()
    mockCreateClient.mockResolvedValue(supabase as never)
    mockCreateAdminClient.mockReturnValue(adminSupabase as never)

    const res = await POST()

    expect(res.status).toBe(200)
    expect(mockCancelSubscription).not.toHaveBeenCalled()
    expect(adminSupabase._mocks.deleteUser).toHaveBeenCalled()
  })

  it('404 no Asaas (sub já removida) é idempotente — prossegue e deleta', async () => {
    const supabase = makeSupabase({
      profile: { asaas_subscription_id: 'sub_123', plan_status: 'active' },
    })
    const adminSupabase = makeAdminSupabase()
    mockCreateClient.mockResolvedValue(supabase as never)
    mockCreateAdminClient.mockReturnValue(adminSupabase as never)
    mockCancelSubscription.mockRejectedValue(new Error('Asaas API error 404'))

    const res = await POST()

    expect(res.status).toBe(200)
    expect(adminSupabase._mocks.deleteUser).toHaveBeenCalledWith('user-1')
  })
})
