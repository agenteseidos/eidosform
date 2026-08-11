/**
 * Testes do reprocessador DLQ — guard de preço-cheio na ativação (P1, audit 2026-06-09).
 * O retry da DLQ não pode ser porta dos fundos: sub prorateada NUNCA ativa automaticamente;
 * valor ilegível = transitório (mantém failed p/ retry); preço cheio ativa.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/asaas', () => ({
  PLAN_PRICES: {
    starter: { monthly: 49.0, yearly: 348.0 },
    plus: { monthly: 127.0, yearly: 1164.0 },
    professional: { monthly: 257.0, yearly: 2364.0 },
  },
  getSubscription: vi.fn(),
  hasOverduePaymentForSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  reconcileActiveSubscriptions: vi.fn(),
  updateSubscription: vi.fn(),
  extractCardToken: () => null,
  alignPendingPaymentsDueDate: vi.fn(),
  // Igual à real: 49→starter/MONTHLY etc.; valor prorateado não mapeia → null.
  resolvePlanCycleFromSubscription: (sub: { value?: number; cycle?: string } | null) => {
    if (sub?.value === 49) return { plan: 'starter', cycle: 'MONTHLY' }
    return null
  },
}))
vi.mock('@/lib/billing-activation', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/billing-activation')>()
  return { ...orig, finalizeActivation: vi.fn() }
})
vi.mock('@/lib/plan-limits', () => ({
  // PLANS é usado pelo buildActivePlanUpdate REAL (billing-activation via importOriginal).
  PLANS: {
    free: { maxResponses: 100 },
    starter: { maxResponses: 1000 },
    plus: { maxResponses: 5000 },
    professional: { maxResponses: 15000 },
  },
  handleUpgrade: vi.fn(),
  handleDowngrade: vi.fn(),
}))
vi.mock('@/lib/resend', () => ({ sendPlanActivated: vi.fn(), sendPlanCancelled: vi.fn() }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))
vi.mock('@/lib/whatsapp-confirmations', () => ({
  notifyPlanoAtivado: vi.fn(async () => ({ sent: true })),
  notifyAssinaturaCancelada: vi.fn(async () => ({ sent: true })),
  planLabel: (p?: string | null) => p ?? 'x',
}))

import { reprocessEvent } from './asaas-reprocess'
import { createClient } from '@supabase/supabase-js'
import { getSubscription, hasOverduePaymentForSubscription } from '@/lib/asaas'
import { finalizeActivation } from '@/lib/billing-activation'
import { handleUpgrade } from '@/lib/plan-limits'
import { sendPlanActivated, sendPlanCancelled } from '@/lib/resend'

const mockCreateClient = vi.mocked(createClient)
const mockGetSubscription = vi.mocked(getSubscription)
const mockFinalize = vi.mocked(finalizeActivation)
const mockHandleUpgrade = vi.mocked(handleUpgrade)

type DbCall = { table: string; method: string; args: unknown[] }
function makeRecordingDb(results: Record<string, unknown[]>) {
  const calls: DbCall[] = []
  function chain(table: string, result: unknown) {
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string | symbol) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            Promise.resolve(result).then(resolve, reject)
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: String(prop), args })
          return proxy
        }
      },
    }) as never
    return proxy
  }
  const from = vi.fn((table: string) => {
    const q = results[table] ?? [{ data: null, error: null }]
    const result = q.length > 1 ? q.shift() : q[0]
    return chain(table, result)
  })
  return { db: { from }, calls }
}

const FAILED_ROW = {
  event_id: 'e1', event: 'PAYMENT_CONFIRMED', customer_id: 'cus_1', subscription_id: 'sub_1',
  attempts: 0, error: 'x', last_attempt_at: null, status: 'failed',
}
const CK_ROW = { id: 'ck1', profile_id: 'user-1', plan: 'starter', cycle: 'MONTHLY' }
const PROFILE_ROW = { id: 'user-1', email: 'u@x.com', full_name: 'U', plan: 'free', asaas_subscription_id: null }

describe('reprocessEvent — guard de preço-cheio na ativação', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
    mockFinalize.mockResolvedValue({ skipped: false, cancelledPrevious: false, recurringValueNeeded: false, recurringValueFixed: true })
    mockHandleUpgrade.mockResolvedValue({ unpausedCount: 0 })
    vi.mocked(sendPlanActivated).mockResolvedValue(undefined as never)
    vi.mocked(sendPlanCancelled).mockResolvedValue(undefined as never)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('sub PRORATEADA → NÃO ativa; relança e mantém failed (attempts+1)', async () => {
    const { db, calls } = makeRecordingDb({
      asaas_webhook_events: [{ data: FAILED_ROW, error: null }, { error: null }],
      billing_checkouts: [{ data: CK_ROW, error: null }],
      profiles: [{ data: PROFILE_ROW, error: null }],
    })
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ status: 'ACTIVE', value: 33.5, cycle: 'MONTHLY' } as never)

    const result = await reprocessEvent('e1')

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/prorateada/i)
    const activation = calls.find((c) => c.table === 'profiles' && c.method === 'update')
    expect(activation).toBeUndefined()
    const failMark = calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'update'
      && (c.args[0] as { status?: string })?.status === 'failed')
    expect(failMark).toBeTruthy()
    expect((failMark!.args[0] as { attempts: number }).attempts).toBe(1)
  })

  it('valor ILEGÍVEL (sem value na sub) → transitório: NÃO ativa, mantém failed p/ retry', async () => {
    const { db, calls } = makeRecordingDb({
      asaas_webhook_events: [{ data: FAILED_ROW, error: null }, { error: null }],
      billing_checkouts: [{ data: CK_ROW, error: null }],
      profiles: [{ data: PROFILE_ROW, error: null }],
    })
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ status: 'ACTIVE' } as never)

    const result = await reprocessEvent('e1')

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/transitório/i)
    expect(calls.find((c) => c.table === 'profiles' && c.method === 'update')).toBeUndefined()
  })

  it('preço CHEIO (R$49 starter mensal) → ativa normalmente', async () => {
    const { db, calls } = makeRecordingDb({
      asaas_webhook_events: [{ data: FAILED_ROW, error: null }, { error: null }],
      billing_checkouts: [{ data: CK_ROW, error: null }, { error: null }],
      profiles: [{ data: PROFILE_ROW, error: null }, { data: [{ id: 'user-1' }], error: null }],
    })
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ status: 'ACTIVE', value: 49, cycle: 'MONTHLY' } as never)

    const result = await reprocessEvent('e1')

    expect(result.ok).toBe(true)
    expect(result.action).toBe('activated')
    const activation = calls.find((c) => c.table === 'profiles' && c.method === 'update')
    expect(activation).toBeTruthy()
    expect((activation!.args[0] as { plan: string }).plan).toBe('starter')
    expect(mockFinalize).toHaveBeenCalled()
  })
})

/**
 * Reversão via reprocesso — o estado ATUAL manda, não a foto velha (varredura 10-11/08/2026).
 *
 * O reprocesso roda horas ou DIAS depois do evento. Um PAYMENT_OVERDUE que falhou no webhook e
 * foi PAGO no dia seguinte continuava na fila como ordem de rebaixamento: as guardas antigas só
 * olhavam o nosso banco (já-free, sub trocada) e nenhuma perguntava ao Asaas como o cliente está
 * HOJE. Pagante em dia era rebaixado por uma foto velha.
 */
describe('reprocessEvent — reversão consulta o estado atual antes de derrubar', () => {
  const OVERDUE_ROW = { ...FAILED_ROW, event: 'PAYMENT_OVERDUE' }
  const PAGANTE = { id: 'user-1', email: 'u@x.com', full_name: 'U', plan: 'plus', asaas_subscription_id: 'sub_1' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
    vi.mocked(sendPlanCancelled).mockResolvedValue(undefined as never)
  })
  afterEach(() => vi.unstubAllEnvs())

  function dbReversao() {
    return makeRecordingDb({
      asaas_webhook_events: [{ data: OVERDUE_ROW, error: null }, { error: null }],
      billing_checkouts: [{ data: CK_ROW, error: null }, { error: null }],
      profiles: [{ data: PAGANTE, error: null }, { data: [{ id: 'user-1' }], error: null }],
    })
  }
  const mockOverdue = vi.mocked(hasOverduePaymentForSubscription)

  it('🛡️ cliente PAGOU depois do evento (sub ativa, zero vencidos) → NÃO reverte', async () => {
    const { db, calls } = dbReversao()
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ status: 'ACTIVE' } as never)
    mockOverdue.mockResolvedValue({ overdue: false, oldestDueDate: null, ok: true })

    const result = await reprocessEvent('e1')

    expect(result.ok).toBe(true)
    expect(result.action).toBe('skip_evento_obsoleto_cliente_em_dia')
    expect(calls.find((c) => c.table === 'profiles' && c.method === 'update')).toBeUndefined()
  })

  it('sub ativa mas COM cobrança vencida → o evento ainda vale, reverte', async () => {
    const { db, calls } = dbReversao()
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ status: 'ACTIVE' } as never)
    mockOverdue.mockResolvedValue({ overdue: true, oldestDueDate: '2026-08-01', ok: true })

    const result = await reprocessEvent('e1')

    expect(result.ok).toBe(true)
    expect(result.action).toBe('reverted_to_free')
    const rev = calls.find((c) => c.table === 'profiles' && c.method === 'update')
    expect((rev!.args[0] as { plan: string }).plan).toBe('free')
  })

  it('sub NÃO existe mais no Asaas (404) → reverte normalmente', async () => {
    const { db, calls } = dbReversao()
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockRejectedValue(new Error('Asaas error 404: not found'))

    const result = await reprocessEvent('e1')

    expect(result.ok).toBe(true)
    expect(result.action).toBe('reverted_to_free')
    expect(calls.find((c) => c.table === 'profiles' && c.method === 'update')).toBeTruthy()
  })

  it('consulta de vencidos FALHOU → não decide: mantém failed p/ retry, nada gravado', async () => {
    const { db, calls } = dbReversao()
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ status: 'ACTIVE' } as never)
    mockOverdue.mockResolvedValue({ overdue: false, oldestDueDate: null, ok: false })

    const result = await reprocessEvent('e1')

    expect(result.ok).toBe(false)
    expect(calls.find((c) => c.table === 'profiles' && c.method === 'update')).toBeUndefined()
    const failMark = calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'update'
      && (c.args[0] as { status?: string })?.status === 'failed')
    expect(failMark).toBeTruthy()
  })
})
