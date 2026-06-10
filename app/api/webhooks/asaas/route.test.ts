/**
 * Testes do webhook Asaas — caminho PAYMENT_CONFIRMED (money-path).
 * Foco (P1, audit 2026-06-09): o guard de preço-cheio precisa distinguir
 *  - falha TRANSITÓRIA ao ler a sub  → throw → evento 'failed' (DLQ retry-ável)
 *  - valor lido e PRORATEADO        → bloqueio manual (PRORATED_BLOCKED) — sem retry
 *  - valor lido e CHEIO             → ativa normalmente
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      async json() { return data },
    }),
  },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/resend', () => ({
  sendPlanActivated: vi.fn(),
  sendPlanCancelled: vi.fn(),
  sendBillingOpsAlert: vi.fn(),
}))
vi.mock('@/lib/plan-limits', () => ({
  PLANS: {
    free: { maxResponses: 100 },
    starter: { maxResponses: 1000 },
    plus: { maxResponses: 5000 },
    professional: { maxResponses: 15000 },
  },
  handleDowngrade: vi.fn(),
  handleUpgrade: vi.fn(),
}))
vi.mock('@/lib/asaas', () => ({
  PLAN_PRICES: {
    starter: { monthly: 49.0, yearly: 348.0 },
    plus: { monthly: 127.0, yearly: 1164.0 },
    professional: { monthly: 257.0, yearly: 2364.0 },
  },
  getSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  reconcileActiveSubscriptions: vi.fn(),
  updateSubscription: vi.fn(),
  extractCardToken: () => null,
  parseExternalReference: (ref?: string | null) => {
    const out = { profileId: null as string | null, plan: null as string | null, cycle: null as string | null }
    if (!ref) return out
    for (const part of ref.split('|')) {
      const [k, v] = [part.slice(0, part.indexOf(':')), part.slice(part.indexOf(':') + 1)]
      if (k === 'profile') out.profileId = v
      else if (k === 'plan') out.plan = v
      else if (k === 'cycle') out.cycle = v
    }
    return out
  },
}))
// finalizeActivation/claimActivationEffects mockados; isExpectedFullPrice REAL (usa o
// PLAN_PRICES do mock de @/lib/asaas acima — preços de produção).
vi.mock('@/lib/billing-activation', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/billing-activation')>()
  return { ...orig, finalizeActivation: vi.fn(), claimActivationEffects: vi.fn() }
})
vi.mock('@/lib/webhook-hmac', () => ({
  verifyAsaasAccessToken: (header: string | null, token: string) => header === token,
  verifyAsaasSignature: () => false,
}))
vi.mock('@/lib/webhook-logger', () => ({ logWebhookEvent: vi.fn() }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

import { POST } from './route'
import { createClient } from '@supabase/supabase-js'
import { getSubscription } from '@/lib/asaas'
import { finalizeActivation, claimActivationEffects } from '@/lib/billing-activation'
import { handleUpgrade } from '@/lib/plan-limits'
import { sendBillingOpsAlert, sendPlanActivated } from '@/lib/resend'

const mockCreateClient = vi.mocked(createClient)
const mockGetSubscription = vi.mocked(getSubscription)
const mockFinalize = vi.mocked(finalizeActivation)
const mockClaim = vi.mocked(claimActivationEffects)
const mockHandleUpgrade = vi.mocked(handleUpgrade)
const mockOpsAlert = vi.mocked(sendBillingOpsAlert)
const mockPlanActivated = vi.mocked(sendPlanActivated)

// ── DB mock com GRAVAÇÃO de chamadas: cada método encadeado registra {table, method, args}
// e o chain é thenable resolvendo o resultado da fila POR TABELA (último repete).
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

function makeReq(body: unknown) {
  return {
    text: async () => JSON.stringify(body),
    headers: { get: (k: string) => (k === 'asaas-access-token' ? 'whsec-test' : null) },
  } as never
}

const CONFIRMED_BODY = {
  id: 'evt_1',
  event: 'PAYMENT_CONFIRMED',
  payment: { customer: 'cus_1', value: 49, subscription: 'sub_1' },
}
const CK_ROW = {
  id: 'ck1', profile_id: 'user-1', plan: 'starter', cycle: 'MONTHLY', checkout_id: 'co1',
  asaas_customer_id: 'cus_1', asaas_subscription_id: 'sub_1', status: 'pending',
  created_at: '2026-06-09T00:00:00Z',
}
const USER_ROW = { id: 'user-1', email: 'u@x.com', full_name: 'U', plan: 'free' }

function baseResults(): Record<string, unknown[]> {
  return {
    asaas_webhook_events: [{ error: null }],
    billing_checkouts: [
      { data: CK_ROW, error: null },   // resolveBillingContext por subscription
      { data: null, error: null },     // newerPaid (1ª checagem)
      { data: null, error: null },     // newerPaid2 (re-check pré-ativação)
      { error: null },                 // updateCheckoutLink
    ],
    profiles: [
      { data: USER_ROW, error: null },                          // getProfileById
      { data: { asaas_subscription_id: null }, error: null },   // previousProfile
      { data: [{ id: 'user-1' }], error: null },                // update de ativação
    ],
  }
}

describe('POST /api/webhooks/asaas — PAYMENT_CONFIRMED × guard de preço-cheio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ASAAS_WEBHOOK_SECRET', 'whsec-test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost')
    mockClaim.mockResolvedValue(true)
    mockFinalize.mockResolvedValue({ skipped: false, cancelledPrevious: false, recurringValueNeeded: false, recurringValueFixed: true })
    mockHandleUpgrade.mockResolvedValue({ unpausedCount: 0 })
    mockPlanActivated.mockResolvedValue(undefined as never)
    mockOpsAlert.mockResolvedValue(undefined as never)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('falha TRANSITÓRIA ao ler a sub → evento vai p/ DLQ (failed), NÃO vira PRORATED_BLOCKED', async () => {
    const { db, calls } = makeRecordingDb(baseResults())
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockRejectedValue(new Error('Asaas 503'))

    const res = await POST(makeReq(CONFIRMED_BODY))
    const body = await res.json() as { received: boolean; processed?: boolean }

    expect(body.received).toBe(true)
    expect(body.processed).toBe(false) // caiu no catch → DLQ
    // Evento marcado 'failed' p/ o reprocessador retentar.
    const dlqUpdate = calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'update'
      && (c.args[0] as { status?: string })?.status === 'failed')
    expect(dlqUpdate).toBeTruthy()
    // NÃO pode ter sido classificado como prorateado (pré-fix: era o que acontecia).
    const proratedUpsert = calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'upsert'
      && String((c.args[0] as { event_id?: string })?.event_id ?? '').startsWith('prorated-blocked'))
    expect(proratedUpsert).toBeUndefined()
    // E NÃO ativou o plano.
    const activation = calls.find((c) => c.table === 'profiles' && c.method === 'update'
      && (c.args[0] as { plan_status?: string })?.plan_status === 'active')
    expect(activation).toBeUndefined()
  })

  it('valor lido e PRORATEADO → bloqueio manual (PRORATED_BLOCKED), sem ativação, sem DLQ-retry', async () => {
    const { db, calls } = makeRecordingDb(baseResults())
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ value: 33.5, cycle: 'MONTHLY', description: '' } as never)

    const res = await POST(makeReq(CONFIRMED_BODY))
    const body = await res.json() as { received: boolean; processed?: boolean }

    expect(body.received).toBe(true)
    expect(body.processed).toBeUndefined() // break (não throw) → fluxo "processed"
    const proratedUpsert = calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'upsert'
      && String((c.args[0] as { event_id?: string })?.event_id ?? '').startsWith('prorated-blocked'))
    expect(proratedUpsert).toBeTruthy()
    expect(mockOpsAlert).toHaveBeenCalled()
    const activation = calls.find((c) => c.table === 'profiles' && c.method === 'update'
      && (c.args[0] as { plan_status?: string })?.plan_status === 'active')
    expect(activation).toBeUndefined()
  })

  it('valor lido e CHEIO (R$49 starter mensal) → ativa o plano e finaliza', async () => {
    const { db, calls } = makeRecordingDb(baseResults())
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ value: 49, cycle: 'MONTHLY' } as never)

    const res = await POST(makeReq(CONFIRMED_BODY))
    const body = await res.json() as { received: boolean }

    expect(body.received).toBe(true)
    const activation = calls.find((c) => c.table === 'profiles' && c.method === 'update'
      && (c.args[0] as { plan?: string; plan_status?: string })?.plan_status === 'active')
    expect(activation).toBeTruthy()
    expect((activation!.args[0] as { plan: string }).plan).toBe('starter')
    expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({ newSubscriptionId: 'sub_1', plan: 'starter', cycle: 'MONTHLY' }))
    expect(mockPlanActivated).toHaveBeenCalled()
  })

  // ── P2-a (audit 2026-06-09): eventos de dinheiro nunca morrem como 'processed' ──

  it('user não resolvido em PAYMENT_CONFIRMED → DLQ (failed), não processed', async () => {
    const results = baseResults()
    results.profiles = [{ data: null, error: null }] // profile não encontrado (ou erro de DB)
    results.billing_checkouts = [
      { data: { ...CK_ROW, profile_id: 'user-1' }, error: null },
      { data: null, error: null },
    ]
    const { db, calls } = makeRecordingDb(results)
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ value: 49, cycle: 'MONTHLY' } as never)

    const res = await POST(makeReq(CONFIRMED_BODY))
    const body = await res.json() as { processed?: boolean }

    expect(body.processed).toBe(false)
    const dlqUpdate = calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'update'
      && (c.args[0] as { status?: string })?.status === 'failed')
    expect(dlqUpdate).toBeTruthy()
  })

  it('idempotência insere como received e o final feliz promove p/ processed', async () => {
    const { db, calls } = makeRecordingDb(baseResults())
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ value: 49, cycle: 'MONTHLY' } as never)

    await POST(makeReq(CONFIRMED_BODY))

    const idemInsert = calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'insert'
      && (c.args[0] as { event_id?: string })?.event_id === 'evt_1')
    expect(idemInsert).toBeTruthy()
    expect((idemInsert!.args[0] as { status: string }).status).toBe('received')
    const promote = calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'update'
      && (c.args[0] as { status?: string })?.status === 'processed')
    expect(promote).toBeTruthy()
  })

  // ── P2-c (audit 2026-06-09): re-entrega p/ profile já ativo na mesma sub ──

  const DAY = 86_400_000
  const dateStr = (ms: number) => new Date(ms).toISOString().slice(0, 10)

  it('RENOVAÇÃO (cobrança do período corrente) reseta a cota normalmente', async () => {
    const now = Date.now()
    const results = baseResults()
    results.profiles = [
      { data: USER_ROW, error: null },
      // previousProfile: já ativo na MESMA sub; expira amanhã (virada de ciclo)
      { data: { asaas_subscription_id: 'sub_1', plan: 'starter', plan_status: 'active', plan_cycle: 'MONTHLY', plan_expires_at: new Date(now + 1 * DAY).toISOString() }, error: null },
      { data: [{ id: 'user-1' }], error: null }, // update de ativação
    ]
    const { db, calls } = makeRecordingDb(results)
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ value: 49, cycle: 'MONTHLY' } as never)

    const body = { ...CONFIRMED_BODY, id: 'evt_renewal', payment: { ...CONFIRMED_BODY.payment, dueDate: dateStr(now + 1 * DAY) } }
    await POST(makeReq(body))

    const activation = calls.find((c) => c.table === 'profiles' && c.method === 'update'
      && (c.args[0] as { plan_status?: string })?.plan_status === 'active')
    expect(activation).toBeTruthy()
    expect((activation!.args[0] as { responses_used: number }).responses_used).toBe(0)
  })

  it('RECEIVED TARDIO (pagamento do ciclo anterior, ~D+32) NÃO reseta a cota nem reescreve o profile', async () => {
    const now = Date.now()
    const results = baseResults()
    results.profiles = [
      { data: USER_ROW, error: null },
      // previousProfile: ciclo novo já ativo (expira em +28d); o pagamento é da cobrança de −32d
      { data: { asaas_subscription_id: 'sub_1', plan: 'starter', plan_status: 'active', plan_cycle: 'MONTHLY', plan_expires_at: new Date(now + 28 * DAY).toISOString() }, error: null },
    ]
    const { db, calls } = makeRecordingDb(results)
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ value: 49, cycle: 'MONTHLY' } as never)

    const body = { id: 'evt_late_received', event: 'PAYMENT_RECEIVED', payment: { ...CONFIRMED_BODY.payment, dueDate: dateStr(now - 32 * DAY) } }
    const res = await POST(makeReq(body))
    const out = await res.json() as { received: boolean; processed?: boolean }

    expect(out.received).toBe(true)
    expect(out.processed).toBeUndefined() // fluxo normal, não DLQ
    // Pré-fix: o update rodava e zerava responses_used no meio do ciclo vigente.
    const activation = calls.find((c) => c.table === 'profiles' && c.method === 'update'
      && (c.args[0] as { plan_status?: string })?.plan_status === 'active')
    expect(activation).toBeUndefined()
    // finalizeActivation ainda roda (estende expiração pelo nextDueDate real etc.).
    expect(mockFinalize).toHaveBeenCalled()
  })

  // ── P2-d (audit 2026-06-09): chave de idempotência fallback não colide entre renovações ──

  it('sem body.id, a chave sintética inclui payment.id/dueDate (renovações não colidem)', async () => {
    const { db, calls } = makeRecordingDb(baseResults())
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ value: 49, cycle: 'MONTHLY' } as never)

    const body = {
      event: 'PAYMENT_CONFIRMED', // sem body.id → fallback sintético
      payment: { ...CONFIRMED_BODY.payment, id: 'pay_77', dueDate: '2026-07-09' },
    }
    await POST(makeReq(body))

    const idemInsert = calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'insert'
      && String((c.args[0] as { event_id?: string })?.event_id ?? '').startsWith('PAYMENT_CONFIRMED:'))
    expect(idemInsert).toBeTruthy()
    const key = (idemInsert!.args[0] as { event_id: string }).event_id
    // Pré-fix a chave era 'PAYMENT_CONFIRMED:cus_1:sub_1' — idêntica em TODA renovação do sub.
    expect(key).toContain('pay_77')
    expect(key).toContain('2026-07-09')
  })

  // ── P3 (audit 2026-06-09): OVERDUE durante canceling com período pago vigente ──

  it('PAYMENT_OVERDUE em canceling com período vigente: desvincula a sub, NÃO rebaixa p/ free', async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString()
    const { db, calls } = makeRecordingDb({
      asaas_webhook_events: [{ error: null }],
      billing_checkouts: [
        { data: CK_ROW, error: null }, // resolveBillingContext
        { data: CK_ROW, error: null }, // updateCheckoutLink re-resolve
        { error: null },               // update do checkout p/ overdue
      ],
      profiles: [
        { data: USER_ROW, error: null }, // getProfileById
        { data: { asaas_subscription_id: 'sub_1', plan: 'starter', plan_status: 'canceling', plan_expires_at: future }, error: null },
        { error: null },                 // unlink da sub
      ],
    })
    mockCreateClient.mockReturnValue(db as never)

    const body = { id: 'evt_overdue', event: 'PAYMENT_OVERDUE', payment: { customer: 'cus_1', value: 49, subscription: 'sub_1' } }
    const res = await POST(makeReq(body))
    expect((await res.json() as { received: boolean }).received).toBe(true)

    // Desvinculou a sub…
    const unlink = calls.find((c) => c.table === 'profiles' && c.method === 'update'
      && (c.args[0] as { asaas_subscription_id?: string | null })?.asaas_subscription_id === null
      && !(c.args[0] as { plan?: string })?.plan)
    expect(unlink).toBeTruthy()
    // …e NÃO rebaixou p/ free (pré-fix: match estrito batia e revertia, tirando acesso pago).
    const downgrade = calls.find((c) => c.table === 'profiles' && c.method === 'update'
      && (c.args[0] as { plan?: string })?.plan === 'free')
    expect(downgrade).toBeUndefined()
  })
})
