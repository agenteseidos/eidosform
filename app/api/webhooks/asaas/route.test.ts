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
// Trava de ativação (varredura 10/08/2026): livre por padrão; os testes dela ocupam de propósito.
const lockMocks = vi.hoisted(() => ({
  acquireLock: vi.fn(async (): Promise<string | null> => 'tok-test'),
  releaseLock: vi.fn(async () => undefined),
}))
vi.mock('@/lib/billing-lock', () => lockMocks)
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
    const out = { profileId: null as string | null, plan: null as string | null, cycle: null as string | null, kind: null as string | null, attempt: null as string | null }
    if (!ref) return out
    for (const part of ref.split('|')) {
      const [k, v] = [part.slice(0, part.indexOf(':')), part.slice(part.indexOf(':') + 1)]
      if (k === 'profile') out.profileId = v
      else if (k === 'plan') out.plan = v
      else if (k === 'cycle') out.cycle = v
      else if (k === 'kind') out.kind = v
      else if (k === 'attempt') out.attempt = v
    }
    return out
  },
}))
// runPlanChangeBackstop e runCardFallbackBackstop mockados: os testes de correlação controlam o
// retorno (o comportamento interno deles é coberto em lib/plan-switch.test.ts).
vi.mock('@/lib/plan-switch', () => ({
  runPlanChangeBackstop: vi.fn(),
  runCardFallbackBackstop: vi.fn(),
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
vi.mock('@/lib/nfse', () => ({
  emitirNotaParaPagamento: vi.fn().mockResolvedValue('scheduled'),
  cancelarNotasDoPagamento: vi.fn().mockResolvedValue('cancelled'),
}))

import { POST } from './route'
import { createClient } from '@supabase/supabase-js'
import { getSubscription } from '@/lib/asaas'
import { finalizeActivation, claimActivationEffects } from '@/lib/billing-activation'
import { handleDowngrade, handleUpgrade } from '@/lib/plan-limits'
import { sendBillingOpsAlert, sendPlanActivated } from '@/lib/resend'
import { runPlanChangeBackstop, runCardFallbackBackstop } from '@/lib/plan-switch'

const mockCardFallback = vi.mocked(runCardFallbackBackstop)
const mockPlanChange = vi.mocked(runPlanChangeBackstop)

const mockCreateClient = vi.mocked(createClient)
const mockGetSubscription = vi.mocked(getSubscription)
const mockFinalize = vi.mocked(finalizeActivation)
const mockClaim = vi.mocked(claimActivationEffects)
const mockHandleUpgrade = vi.mocked(handleUpgrade)
const mockHandleDowngrade = vi.mocked(handleDowngrade)
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

  it('pagamento após corte repara formulários mesmo com comunicação já reivindicada', async () => {
    const results = baseResults()
    results.profiles = [
      { data: USER_ROW, error: null },
      { data: { asaas_subscription_id: null, plan: 'free', plan_status: 'expired', plan_cycle: 'MONTHLY' }, error: null },
      { data: [{ id: 'user-1' }], error: null },
    ]
    const { db } = makeRecordingDb(results)
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ value: 49, cycle: 'MONTHLY' } as never)
    mockClaim.mockResolvedValue(false) // consumido na primeira compra da mesma assinatura

    await POST(makeReq({ ...CONFIRMED_BODY, id: 'evt_recovery' }))

    expect(mockPlanActivated).not.toHaveBeenCalled()
    expect(mockHandleUpgrade).toHaveBeenCalledTimes(1)
    expect(mockHandleUpgrade).toHaveBeenCalledWith('user-1', 'service-key')
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

  // ── Fallback de cartão morto (2026-07-03): correlação no webhook + blindagem P1-C ──

  // Teste 22 — avulso DETACHED (sem subscription) com checkoutSession → runCardFallbackBackstop.
  it('PAYMENT_CONFIRMED sem subscription COM checkoutSession → runCardFallbackBackstop invocado, 200 processed, SEM throw', async () => {
    const { db, calls } = makeRecordingDb({ asaas_webhook_events: [{ error: null }] })
    mockCreateClient.mockReturnValue(db as never)
    mockCardFallback.mockResolvedValue('switched')

    const body = { id: 'evt_fb', event: 'PAYMENT_CONFIRMED', payment: { customer: 'cus_1', value: 78, id: 'pay_fb', checkoutSession: 'chk_1' } }
    const res = await POST(makeReq(body))
    const out = await res.json() as { received: boolean; processed?: boolean }

    expect(mockCardFallback).toHaveBeenCalledWith(expect.anything(), {
      customerId: 'cus_1', paymentId: 'pay_fb', checkoutSessionId: 'chk_1', source: 'webhook',
    })
    expect(out.received).toBe(true)
    expect(out.processed).toBeUndefined() // break → fluxo normal (não DLQ)
    const dlq = calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'update'
      && (c.args[0] as { status?: string })?.status === 'failed')
    expect(dlq).toBeUndefined()
  })

  // Teste 23 — sem match → mantém o throw→DLQ (regressão do avulso desconhecido).
  it('sem subscription e no_match (avulso desconhecido) → continua lançando → DLQ failed', async () => {
    const { db, calls } = makeRecordingDb({ asaas_webhook_events: [{ error: null }] })
    mockCreateClient.mockReturnValue(db as never)
    mockCardFallback.mockResolvedValue('no_match')

    const body = { id: 'evt_fb2', event: 'PAYMENT_CONFIRMED', payment: { customer: 'cus_1', value: 78, id: 'pay_fb2' } }
    const res = await POST(makeReq(body))
    const out = await res.json() as { processed?: boolean }

    expect(mockCardFallback).toHaveBeenCalled()
    expect(out.processed).toBe(false)
    const dlq = calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'update'
      && (c.args[0] as { status?: string })?.status === 'failed')
    expect(dlq).toBeTruthy()
  })

  // Teste 24 — branch kind:planchange intocado: runPlanChangeBackstop roda, card fallback NÃO.
  it('avulso kind:planchange → runPlanChangeBackstop (regressão), runCardFallbackBackstop NÃO chamado', async () => {
    const { db } = makeRecordingDb({ asaas_webhook_events: [{ error: null }] })
    mockCreateClient.mockReturnValue(db as never)
    mockPlanChange.mockResolvedValue('switched')

    const body = { id: 'evt_pc', event: 'PAYMENT_CONFIRMED', payment: { customer: 'cus_1', value: 78, id: 'pay_pc', externalReference: 'profile:user-1|plan:plus|cycle:MONTHLY|kind:planchange|attempt:att1' } }
    const res = await POST(makeReq(body))
    expect((await res.json() as { received: boolean }).received).toBe(true)

    expect(mockPlanChange).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ profileId: 'user-1', plan: 'plus', cycle: 'MONTHLY', paymentId: 'pay_pc' }))
    expect(mockCardFallback).not.toHaveBeenCalled()
  })

  // Teste 25 — 🛡️ P1-C: PAYMENT_OVERDUE re-resolve por customer NÃO casa a linha do fallback
  // (o .neq('payment_method','plan_switch_fallback') é aplicado no resolveBillingContext E no
  // re-resolve do updateCheckoutLink). Sem isso, a linha do fallback (pending) seria marcada 'overdue'.
  it('🛡️ P1-C: PAYMENT_OVERDUE aplica .neq(payment_method, plan_switch_fallback) no resolve E no re-resolve', async () => {
    const { db, calls } = makeRecordingDb({
      asaas_webhook_events: [{ error: null }],
      billing_checkouts: [
        { data: null, error: null },   // resolveBillingContext opção (1) por subscription → nada
        { data: CK_ROW, error: null }, // resolveBillingContext opção (3) por customer (com .neq)
        { data: null, error: null },   // updateCheckoutLink re-resolve opção (1) por subscription
        { data: CK_ROW, error: null }, // updateCheckoutLink re-resolve opção (3) por customer (com .neq)
        { error: null },               // update do checkout p/ overdue
      ],
      profiles: [
        { data: USER_ROW, error: null }, // getProfileById (resolve inicial)
        { data: { asaas_subscription_id: 'sub_1', plan: 'starter', plan_status: 'active', plan_expires_at: null }, error: null },
      ],
    })
    mockCreateClient.mockReturnValue(db as never)

    const body = { id: 'evt_overdue_fb', event: 'PAYMENT_OVERDUE', payment: { customer: 'cus_1', value: 49, subscription: 'sub_1' } }
    const res = await POST(makeReq(body))
    expect((await res.json() as { received: boolean }).received).toBe(true)

    const neqCalls = calls.filter((c) => c.table === 'billing_checkouts' && c.method === 'neq'
      && JSON.stringify(c.args) === JSON.stringify(['payment_method', 'plan_switch_fallback']))
    // 1 no resolveBillingContext inicial (opção 3) + 1 no re-resolve do updateCheckoutLink (opção 3).
    expect(neqCalls.length).toBeGreaterThanOrEqual(2)
    // Regressão principal: o webhook NÃO rebaixa mais na hora.
    const downgrade = calls.find((c) => c.table === 'profiles' && c.method === 'update'
      && (c.args[0] as { plan?: string })?.plan === 'free')
    expect(downgrade).toBeUndefined()
  })
})

// ── NFS-e automática (2026-08-05): ganchos de emissão e cancelamento no webhook ──
import { emitirNotaParaPagamento, cancelarNotasDoPagamento } from '@/lib/nfse'
const mockEmitirNota = vi.mocked(emitirNotaParaPagamento)
const mockCancelarNotas = vi.mocked(cancelarNotasDoPagamento)

/** agendar() cai no fallback void (o mock de next/server não tem after) — flush de microtasks. */
async function flushAgendadas() {
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r))
}

describe('POST /api/webhooks/asaas — ganchos de NFS-e', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ASAAS_WEBHOOK_TOKEN = 'whsec-test'
    mockEmitirNota.mockResolvedValue('scheduled')
    mockCancelarNotas.mockResolvedValue('cancelled')
  })

  it('PAYMENT_CONFIRMED de AVULSO (planchange) agenda emissão — o gancho fica ANTES do branching', async () => {
    const { db } = makeRecordingDb({ asaas_webhook_events: [{ error: null }] })
    mockCreateClient.mockReturnValue(db as never)
    mockPlanChange.mockResolvedValue('switched' as never)

    const body = { id: 'evt_nf1', event: 'PAYMENT_CONFIRMED', payment: { customer: 'cus_1', value: 78, id: 'pay_nf1', externalReference: 'profile:user-1|plan:plus|cycle:MONTHLY|kind:planchange|attempt:att1' } }
    await POST(makeReq(body))
    await flushAgendadas()

    expect(mockEmitirNota).toHaveBeenCalledWith({ paymentId: 'pay_nf1', value: 78 })
  })

  it('PAYMENT_RECEIVED também dispara emissão (dedupe por cobrança mora no módulo nfse)', async () => {
    const { db } = makeRecordingDb(baseResults())
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ value: 49, cycle: 'MONTHLY' } as never)
    mockClaim.mockResolvedValue('claimed' as never)
    mockFinalize.mockResolvedValue({ ok: true } as never)

    const body = { id: 'evt_nf2', event: 'PAYMENT_RECEIVED', payment: { customer: 'cus_1', value: 49, id: 'pay_nf2', subscription: 'sub_1' } }
    await POST(makeReq(body))
    await flushAgendadas()

    expect(mockEmitirNota).toHaveBeenCalledWith({ paymentId: 'pay_nf2', value: 49 })
  })

  it('PAYMENT_CONFIRMED sem payment.id ou sem value numérico NÃO agenda emissão', async () => {
    const { db } = makeRecordingDb({ asaas_webhook_events: [{ error: null }] })
    mockCreateClient.mockReturnValue(db as never)
    mockCardFallback.mockResolvedValue('switched' as never)

    const body = { id: 'evt_nf3', event: 'PAYMENT_CONFIRMED', payment: { customer: 'cus_1', checkoutSession: 'chk_1' } }
    await POST(makeReq(body))
    await flushAgendadas()

    expect(mockEmitirNota).not.toHaveBeenCalled()
  })

  it('PAYMENT_REFUNDED agenda cancelamento da nota MESMO sem customer no payload', async () => {
    const { db } = makeRecordingDb({ asaas_webhook_events: [{ error: null }] })
    mockCreateClient.mockReturnValue(db as never)

    const body = { id: 'evt_nf4', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_nf4', value: 49 } }
    await POST(makeReq(body))
    await flushAgendadas()

    expect(mockCancelarNotas).toHaveBeenCalledWith({ paymentId: 'pay_nf4', motivo: 'PAYMENT_REFUNDED' })
  })

  it('PAYMENT_CHARGEBACK_REQUESTED agenda cancelamento (não espera o desfecho da disputa)', async () => {
    const { db } = makeRecordingDb({ asaas_webhook_events: [{ error: null }] })
    mockCreateClient.mockReturnValue(db as never)

    const body = { id: 'evt_nf5', event: 'PAYMENT_CHARGEBACK_REQUESTED', payment: { id: 'pay_nf5', value: 49 } }
    await POST(makeReq(body))
    await flushAgendadas()

    expect(mockCancelarNotas).toHaveBeenCalledWith({ paymentId: 'pay_nf5', motivo: 'PAYMENT_CHARGEBACK_REQUESTED' })
  })

  it('SUBSCRIPTION_INACTIVATED NÃO cancela nota (sem payment; evento de sub, não de dinheiro)', async () => {
    const { db } = makeRecordingDb({ asaas_webhook_events: [{ error: null }] })
    mockCreateClient.mockReturnValue(db as never)

    const body = { id: 'evt_nf6', event: 'SUBSCRIPTION_INACTIVATED', subscription: { id: 'sub_x', customer: 'cus_1' } }
    await POST(makeReq(body))
    await flushAgendadas()

    expect(mockCancelarNotas).not.toHaveBeenCalled()
  })
})

/**
 * Estorno de cobrança AVULSA — avisar sempre, agir nunca (decisão Sidney 11/08/2026).
 *
 * Cobrança avulsa (a diferença prorateada de um upgrade) não tem assinatura, então todo
 * estorno/chargeback dela caía na peneira do "match estrito" e morria em silêncio: o dinheiro
 * voltava, o cliente ficava com o plano maior, e o dono só descobria no extrato do Asaas.
 * O estorno de MENSALIDADE sempre alertou; o de avulso, nunca.
 *
 * A decisão foi alertar SEM agir: estorno pode ser cortesia, parcial ou correção de cobrança
 * duplicada — rebaixar sozinho puniria cliente inocente (mesma razão da decisão de 08/06), e
 * desfazer upgrade no meio do ciclo é a família de cálculo que já clipou 78 dias pagos → 30.
 */
describe('POST /api/webhooks/asaas — estorno de AVULSO alerta, nunca age', () => {
  beforeEach(() => { vi.clearAllMocks() })

  /** payment sem subscription = avulso. Usuário resolvido pelo fallback por customer. */
  function dbAvulso() {
    return makeRecordingDb({
      asaas_webhook_events: [{ error: null }],
      billing_checkouts: [{ data: [], error: null }],           // resolve: sem checkout ativo
      profiles: [
        { data: USER_ROW, error: null },                         // fallback por asaas_customer_id
        { data: { asaas_subscription_id: 'sub_1', plan: 'plus' }, error: null }, // refundProfile
      ],
    })
  }

  it('PAYMENT_REFUNDED de avulso → alerta operacional, plano intacto, evento processado', async () => {
    const { db, calls } = dbAvulso()
    mockCreateClient.mockReturnValue(db as never)

    const body = { id: 'evt_av1', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_av', customer: 'cus_1', value: 78 } }
    const res = await POST(makeReq(body))

    expect(mockOpsAlert).toHaveBeenCalledTimes(1)
    expect(mockOpsAlert.mock.calls[0][0].subject).toContain('AVULSA')
    // agir nunca: nenhuma escrita em profiles (o plano do cliente não muda)
    expect(calls.some((c) => c.table === 'profiles' && c.method === 'update')).toBe(false)
    // e o evento não vai para DLQ — foi tratado, o humano decide o resto
    expect((await res.json() as { received?: boolean }).received).toBe(true)
    expect(calls.some((c) => c.table === 'asaas_webhook_events' && c.method === 'update'
      && (c.args[0] as { status?: string })?.status === 'failed')).toBe(false)
  })

  it('PAYMENT_CHARGEBACK_REQUESTED de avulso também alerta', async () => {
    const { db } = dbAvulso()
    mockCreateClient.mockReturnValue(db as never)

    await POST(makeReq({ id: 'evt_av2', event: 'PAYMENT_CHARGEBACK_REQUESTED', payment: { id: 'pay_av', customer: 'cus_1', value: 78 } }))

    expect(mockOpsAlert).toHaveBeenCalledTimes(1)
  })

  it('SUBSCRIPTION_INACTIVATED de sub antiga (todo upgrade gera um) NÃO alerta — seria ruído', async () => {
    // Alerta que dispara em toda troca de plano ensina a ignorar alertas. A peneira continua
    // silenciosa para o caso da sub antiga; só o avulso (payment sem subscription) avisa.
    const { db } = makeRecordingDb({
      asaas_webhook_events: [{ error: null }],
      billing_checkouts: [
        { data: null, error: null },                             // resolve por subscription: nada
        { data: [], error: null },                               // fallback por customer: nada
      ],
      profiles: [
        { data: USER_ROW, error: null },
        { data: { asaas_subscription_id: 'sub_1', plan: 'plus' }, error: null },
      ],
    })
    mockCreateClient.mockReturnValue(db as never)

    await POST(makeReq({ id: 'evt_av3', event: 'SUBSCRIPTION_INACTIVATED', subscription: { id: 'sub_old', customer: 'cus_1' } }))

    expect(mockOpsAlert).not.toHaveBeenCalled()
  })
})

/**
 * Evento de dinheiro com usuário não resolvido — os TRÊS ramos irmãos do PAYMENT_CONFIRMED.
 *
 * O DEFEITO (achado na varredura de 10/08/2026, a pedido do Sidney: "fechamos do lote zero ao 5
 * já? tem certeza?"). Em 2026-06-09 o ramo PAYMENT_CONFIRMED trocou `break` por `throw` justamente
 * porque "evento de dinheiro não pode morrer como processed". A correção nunca chegou aos irmãos:
 * PAYMENT_OVERDUE, SUBSCRIPTION_DELETED e REFUND/CHARGEBACK continuaram com `break`.
 *
 * Por que `break` é perda DEFINITIVA e não um adiamento: o fim do handler promove o evento a
 * 'processed', e o handler devolve 200 ao Asaas de propósito (anti retry-storm, depois do incidente
 * de 05-11/05/2026). Não existe segunda entrega. O aviso de que alguém parou de pagar, cancelou a
 * assinatura ou pediu estorno simplesmente evaporava — e a pessoa seguia no plano pago.
 *
 * É o mesmo padrão de "rotas gêmeas" do lote 2: a correção certa aplicada em um lugar e não nos
 * irmãos. Estes testes existem para que a próxima cópia não fique para trás.
 */
describe('POST /api/webhooks/asaas — evento de dinheiro sem dono vai para o DLQ, nunca some', () => {
  beforeEach(() => { vi.clearAllMocks() })

  /** profile ausente (ou erro transitório de DB) → resolveBillingContext devolve user null. */
  function semDono() {
    const results = baseResults()
    results.profiles = [{ data: null, error: null }]
    results.billing_checkouts = [
      { data: { ...CK_ROW, profile_id: 'user-1' }, error: null },
      { data: null, error: null },
    ]
    return makeRecordingDb(results)
  }

  const foiParaDLQ = (calls: Array<{ table: string; method: string; args: unknown[] }>) =>
    calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'update'
      && (c.args[0] as { status?: string })?.status === 'failed')

  it('PAYMENT_OVERDUE sem dono → DLQ (failed), não processed', async () => {
    // Sem isto: o aviso de "parou de pagar" some e a pessoa continua no plano pago de graça.
    const { db, calls } = semDono()
    mockCreateClient.mockReturnValue(db as never)

    const body = { id: 'evt_ov_sem_dono', event: 'PAYMENT_OVERDUE', payment: { customer: 'cus_1', value: 49, subscription: 'sub_1' } }
    const res = await POST(makeReq(body))

    expect((await res.json() as { processed?: boolean }).processed).toBe(false)
    expect(foiParaDLQ(calls)).toBeTruthy()
  })

  it('SUBSCRIPTION_DELETED sem dono → DLQ (failed), não processed', async () => {
    // Sem isto: a assinatura morre no Asaas e o plano pago continua valendo aqui dentro.
    const { db, calls } = semDono()
    mockCreateClient.mockReturnValue(db as never)

    const body = { id: 'evt_del_sem_dono', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1', customer: 'cus_1' } }
    const res = await POST(makeReq(body))

    expect((await res.json() as { processed?: boolean }).processed).toBe(false)
    expect(foiParaDLQ(calls)).toBeTruthy()
  })

  it('PAYMENT_REFUNDED sem dono → DLQ (failed), não processed', async () => {
    // Sem isto: dinheiro sai da conta e ninguém fica sabendo.
    const { db, calls } = semDono()
    mockCreateClient.mockReturnValue(db as never)

    const body = { id: 'evt_ref_sem_dono', event: 'PAYMENT_REFUNDED', payment: { customer: 'cus_1', value: 49, subscription: 'sub_1' } }
    const res = await POST(makeReq(body))

    expect((await res.json() as { processed?: boolean }).processed).toBe(false)
    expect(foiParaDLQ(calls)).toBeTruthy()
  })

  it('PAYMENT_CHARGEBACK_REQUESTED sem dono → DLQ (failed), não processed', async () => {
    const { db, calls } = semDono()
    mockCreateClient.mockReturnValue(db as never)

    const body = { id: 'evt_cb_sem_dono', event: 'PAYMENT_CHARGEBACK_REQUESTED', payment: { customer: 'cus_1', value: 49, subscription: 'sub_1' } }
    const res = await POST(makeReq(body))

    expect((await res.json() as { processed?: boolean }).processed).toBe(false)
    expect(foiParaDLQ(calls)).toBeTruthy()
  })
})

describe('POST /api/webhooks/asaas — PAYMENT_OVERDUE respeita a carência do expire-plans', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('registra overdue no checkout e mantém o acesso quando a assinatura ativa bate', async () => {
    const { db, calls } = makeRecordingDb({
      asaas_webhook_events: [{ error: null }],
      billing_checkouts: [
        { data: CK_ROW, error: null }, // resolveBillingContext
        { data: CK_ROW, error: null }, // updateCheckoutLink re-resolve
        { error: null },               // update do checkout p/ overdue
      ],
      profiles: [
        { data: USER_ROW, error: null }, // getProfileById
        { data: { asaas_subscription_id: 'sub_1', plan: 'starter', plan_status: 'active', plan_expires_at: null }, error: null },
      ],
    })
    mockCreateClient.mockReturnValue(db as never)

    const body = { id: 'evt_overdue_active', event: 'PAYMENT_OVERDUE', payment: { customer: 'cus_1', value: 49, subscription: 'sub_1' } }
    const res = await POST(makeReq(body))

    expect((await res.json() as { received: boolean }).received).toBe(true)
    const checkoutOverdue = calls.find((c) => c.table === 'billing_checkouts' && c.method === 'update'
      && (c.args[0] as { status?: string })?.status === 'overdue')
    expect(checkoutOverdue).toBeTruthy()
    const downgrade = calls.find((c) => c.table === 'profiles' && c.method === 'update'
      && (c.args[0] as { plan?: string })?.plan === 'free')
    expect(downgrade).toBeUndefined()
    expect(mockHandleDowngrade).not.toHaveBeenCalled()
  })
})

/**
 * Trava de ativação no WEBHOOK (varredura 10/08/2026) — o quinto e último caminho a respeitá-la.
 *
 * Os crons de reconcile sempre seguraram `activation:{profileId}`; webhook, polling e
 * reprocessador entravam sem nada. Dois caminhos ativando o MESMO perfil ao mesmo tempo, cada um
 * com uma foto diferente do banco, é como nascem cobrança dupla e marker órfão.
 */
describe('POST /api/webhooks/asaas — trava de ativação', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lockMocks.acquireLock.mockResolvedValue('tok-test')
  })

  function setupAtivacao() {
    const results = baseResults()
    const { db, calls } = makeRecordingDb(results)
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ value: 49, cycle: 'MONTHLY' } as never)
    return { db, calls }
  }

  it('🛡️ lock OCUPADO → evento vai para o DLQ, nenhuma escrita em profiles', async () => {
    // Outro caminho está ativando este perfil agora. Lançar manda ao DLQ e o reprocessador
    // retenta DEPOIS que o outro terminar. Nada se perde; nada roda em dupla.
    lockMocks.acquireLock.mockResolvedValue(null)
    const { calls } = setupAtivacao()

    const res = await POST(makeReq(CONFIRMED_BODY))

    expect((await res.json() as { processed?: boolean }).processed).toBe(false)
    expect(calls.find((c) => c.table === 'profiles' && c.method === 'update')).toBeUndefined()
    expect(calls.find((c) => c.table === 'asaas_webhook_events' && c.method === 'update'
      && (c.args[0] as { status?: string })?.status === 'failed')).toBeTruthy()
  })

  it('adquire com a chave activation:{userId} e SOLTA no final feliz', async () => {
    setupAtivacao()

    await POST(makeReq(CONFIRMED_BODY))

    expect(lockMocks.acquireLock).toHaveBeenCalledWith(expect.anything(), 'activation:user-1')
    expect(lockMocks.releaseLock).toHaveBeenCalledWith(expect.anything(), 'activation:user-1', 'tok-test')
  })

  it('SOLTA o lock também quando o ramo falha no meio (throw → DLQ)', async () => {
    // Sem a soltura no catch, o retry deste mesmo evento esperaria os 2min do stale-takeover.
    const results = baseResults()
    results.profiles = [
      { data: USER_ROW, error: null },
      { data: { asaas_subscription_id: null }, error: null },
      { data: [], error: null }, // ativação persiste 0 linhas → throw
    ]
    const { db } = makeRecordingDb(results)
    mockCreateClient.mockReturnValue(db as never)
    mockGetSubscription.mockResolvedValue({ value: 49, cycle: 'MONTHLY' } as never)

    const res = await POST(makeReq(CONFIRMED_BODY))

    expect((await res.json() as { processed?: boolean }).processed).toBe(false)
    expect(lockMocks.releaseLock).toHaveBeenCalledWith(expect.anything(), 'activation:user-1', 'tok-test')
  })
})
