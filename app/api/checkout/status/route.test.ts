/**
 * Polling do checkout — a PRIMEIRA suíte desta rota (E03-S0-001, 11/08/2026).
 *
 * O buraco que ela tranca: no Asaas o status da ASSINATURA é independente do status da
 * COBRANÇA — uma sub pode estar ACTIVE com a primeira cobrança pendente ou recusada. O polling
 * tratava ACTIVE como "pagou" e entregava o plano; expire-plans e reconcile-checkouts já exigiam
 * prova de dinheiro desde o lote 1, e o polling era a porta que faltava. Plano entregue sem
 * cobrança paga só seria percebido ~30 dias depois, na expiração.
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
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimitAsync: vi.fn(async () => ({ allowed: true, resetIn: 0 })) }))
vi.mock('@/lib/plan-limits', () => ({
  // PLANS é consumido pelo buildActivePlanUpdate REAL — sem ele a ativação explode e o erro
  // some no catch do fallback (custou 20 min de debug neste harness).
  PLANS: {
    free: { maxResponses: 100 }, starter: { maxResponses: 1000 },
    plus: { maxResponses: 5000 }, professional: { maxResponses: 15000 },
  },
  handleUpgrade: vi.fn(async () => ({ unpausedCount: 0 })),
}))
vi.mock('@/lib/resend', () => ({ sendBillingOpsAlert: vi.fn(async () => ({})) }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))
const lockMocks = vi.hoisted(() => ({
  acquireLock: vi.fn(async (): Promise<string | null> => 'tok-test'),
  releaseLock: vi.fn(async () => undefined),
}))
vi.mock('@/lib/billing-lock', () => lockMocks)
vi.mock('@/lib/billing-activation', async (orig) => {
  const real = await orig<typeof import('@/lib/billing-activation')>()
  return {
    ...real,
    finalizeActivation: vi.fn(async () => ({ skipped: false, cancelledPrevious: false, recurringValueNeeded: false, recurringValueFixed: true })),
  }
})
const asaasMocks = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  getCustomerSubscriptions: vi.fn(async () => []),
  hasConfirmedPaymentForSubscription: vi.fn(),
}))
vi.mock('@/lib/asaas', async (orig) => {
  const real = await orig<typeof import('@/lib/asaas')>()
  return { ...real, ...asaasMocks } // isExpectedFullPrice REAL — preços de produção
})

import { GET } from './route'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const mockServer = vi.mocked(createClient)
const mockAdmin = vi.mocked(createAdminClient)

const PERFIL_FREE = { plan: 'free', plan_status: null, plan_cycle: null, asaas_customer_id: 'cus_1', asaas_subscription_id: null }
const CHECKOUT = {
  id: 'ck1', status: 'pending', last_event: null,
  created_at: '2026-08-11T12:00:00.000Z', updated_at: '2026-08-11T12:00:00.000Z',
  asaas_subscription_id: 'sub_1', asaas_customer_id: 'cus_1',
  plan: 'starter', cycle: 'MONTHLY', payment_method: null,
}

function makeServerDb(perfil: unknown, checkout: unknown) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    from: (tabela: string) => ({
      select: () => {
        const chain: Record<string, unknown> = {
          eq: () => chain, neq: () => chain, order: () => chain,
          limit: () => chain,
          single: async () => ({ data: tabela === 'profiles' ? perfil : checkout, error: null }),
          maybeSingle: async () => ({ data: tabela === 'profiles' ? perfil : checkout, error: null }),
        }
        return chain
      },
    }),
  }
}

/** admin gravador: registra updates para provar o que foi (ou não foi) persistido. */
function makeAdminDb() {
  const updates: Array<{ table: string; payload: unknown }> = []
  const db = {
    from: (table: string) => ({
      update: (payload: unknown) => {
        updates.push({ table, payload })
        // O chain inteiro é "thenable": a rota faz `await ...update().eq().select('id')` e
        // espera { data: ARRAY }. Qualquer elo pode ser o último antes do await.
        const chain: Record<string, unknown> = {
          eq: () => chain,
          select: () => chain,
          then: (res: (v: unknown) => void) => res({ data: [{ id: 'u1' }], error: null }),
        }
        return chain
      },
      select: () => {
        const chain: Record<string, unknown> = {
          eq: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: null }),
        }
        return chain
      },
      upsert: async () => ({ error: null }),
    }),
  }
  return { db, updates }
}

beforeEach(() => {
  vi.clearAllMocks()
  lockMocks.acquireLock.mockResolvedValue('tok-test')
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave'
})

describe('🛡️ prova de pagamento — ACTIVE não é "pagou"', () => {
  it('sub ACTIVE com cobrança AINDA NÃO CONFIRMADA → pending, e NADA é gravado no profile', async () => {
    // O caso exato do achado: cartão em análise/recusado, sub já ACTIVE. Antes: plano entregue.
    mockServer.mockResolvedValue(makeServerDb(PERFIL_FREE, CHECKOUT) as never)
    const { db: admin, updates } = makeAdminDb()
    mockAdmin.mockReturnValue(admin as never)
    asaasMocks.getSubscription.mockResolvedValue({ status: 'ACTIVE', value: 49, nextDueDate: '2026-09-11' })
    asaasMocks.hasConfirmedPaymentForSubscription.mockResolvedValue({ confirmed: false, ok: true })

    const body = await (await GET()).json() as { status: string }

    expect(body.status).toBe('pending')
    expect(updates.filter((u) => u.table === 'profiles')).toHaveLength(0)
  })

  it('cobrança CONFIRMADA → ativa e persiste', async () => {
    mockServer.mockResolvedValue(makeServerDb(PERFIL_FREE, CHECKOUT) as never)
    const { db: admin, updates } = makeAdminDb()
    mockAdmin.mockReturnValue(admin as never)
    asaasMocks.getSubscription.mockResolvedValue({ status: 'ACTIVE', value: 49, nextDueDate: '2026-09-11' })
    asaasMocks.hasConfirmedPaymentForSubscription.mockResolvedValue({ confirmed: true, ok: true })

    const body = await (await GET()).json() as { status: string }

    expect(body.status).toBe('success')
    expect(updates.some((u) => u.table === 'profiles')).toBe(true)
  })

  it('🛡️ a consulta leva o CORTE de data do checkout — pagar "algum dia" não vale', async () => {
    // A mesma lição do reconcile: verificar o ARGUMENTO. Sem o corte, um veterano
    // inadimplente com pagamento antigo na mesma sub passaria.
    mockServer.mockResolvedValue(makeServerDb(PERFIL_FREE, CHECKOUT) as never)
    const { db: admin } = makeAdminDb()
    mockAdmin.mockReturnValue(admin as never)
    asaasMocks.getSubscription.mockResolvedValue({ status: 'ACTIVE', value: 49, nextDueDate: '2026-09-11' })
    asaasMocks.hasConfirmedPaymentForSubscription.mockResolvedValue({ confirmed: true, ok: true })

    await GET()

    const chamada = asaasMocks.hasConfirmedPaymentForSubscription.mock.calls[0]
    expect(chamada[0]).toBe('sub_1')
    expect(chamada[1]).toBe('2026-08-10T12:00:00.000Z') // created_at do checkout − 1 dia
  })

  it('consulta de pagamento FALHOU → pending (nunca decidir dinheiro sem dado)', async () => {
    mockServer.mockResolvedValue(makeServerDb(PERFIL_FREE, CHECKOUT) as never)
    const { db: admin, updates } = makeAdminDb()
    mockAdmin.mockReturnValue(admin as never)
    asaasMocks.getSubscription.mockResolvedValue({ status: 'ACTIVE', value: 49, nextDueDate: '2026-09-11' })
    asaasMocks.hasConfirmedPaymentForSubscription.mockResolvedValue({ confirmed: false, ok: false })

    const body = await (await GET()).json() as { status: string }

    expect(body.status).toBe('pending')
    expect(updates.filter((u) => u.table === 'profiles')).toHaveLength(0)
  })
})

describe('guardas que já existiam continuam de pé', () => {
  it('sub PRORATEADA (valor != preço cheio) não ativa, mesmo com pagamento confirmado', async () => {
    mockServer.mockResolvedValue(makeServerDb(PERFIL_FREE, CHECKOUT) as never)
    const { db: admin, updates } = makeAdminDb()
    mockAdmin.mockReturnValue(admin as never)
    asaasMocks.getSubscription.mockResolvedValue({ status: 'ACTIVE', value: 33.5, nextDueDate: '2026-09-11' })
    asaasMocks.hasConfirmedPaymentForSubscription.mockResolvedValue({ confirmed: true, ok: true })

    const body = await (await GET()).json() as { status: string }

    expect(body.status).toBe('pending')
    expect(updates.filter((u) => u.table === 'profiles')).toHaveLength(0)
  })

  it('usuário em CANCELING nunca é reativado pelo polling', async () => {
    mockServer.mockResolvedValue(makeServerDb(
      { ...PERFIL_FREE, plan: 'plus', plan_status: 'canceling' }, CHECKOUT,
    ) as never)

    const body = await (await GET()).json() as { status: string }

    expect(body.status).toBe('success') // mantém o acesso atual sem tocar no Asaas
    expect(asaasMocks.getSubscription).not.toHaveBeenCalled()
  })
})
