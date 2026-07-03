/**
 * Testes do cron reconcile-checkouts / BACKSTOP (P0, audit 2026-06-09).
 * Regressão coberta: getCustomerSubscriptions retorna o ARRAY direto — o backstop lia
 * `.data` do retorno, obtinha [] e NUNCA encontrava a sub paga (skip silencioso), anulando
 * a rede de segurança do incidente 2026-06-09. Estes testes falham se isso voltar.
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
vi.mock('@/lib/asaas', () => ({
  getCustomerSubscriptions: vi.fn(),
  hasConfirmedPaymentForSubscription: vi.fn(),
  detectPlanAndCycleFromValue: vi.fn(),
  findPaymentByCheckoutSession: vi.fn(),
}))
vi.mock('@/lib/plan-switch', () => ({ runCardFallbackBackstop: vi.fn() }))
vi.mock('@/lib/billing-activation', () => ({
  activatePaidSubscription: vi.fn(),
  isExpectedFullPrice: vi.fn(),
}))
vi.mock('@/lib/billing-lock', () => ({ acquireLock: vi.fn(), releaseLock: vi.fn() }))
vi.mock('@/lib/resend', () => ({ sendBillingOpsAlert: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

function chainable(result: unknown) {
  const target: Record<string | symbol, unknown> = {}
  const proxy: Record<string, () => unknown> = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.resolve(result).then(resolve, reject)
      }
      return () => proxy
    },
  }) as never
  return proxy
}

function makeDb(handlers: Record<string, unknown[]>) {
  const from = vi.fn((table: string) => {
    const q = handlers[table] ?? [{ data: null, error: null }]
    const result = q.length > 1 ? q.shift() : q[0]
    return chainable(result)
  })
  return { from }
}

// Como makeDb, mas grava cada método encadeado (com args) — prova filtros do SELECT (ex. 🛡️ P1-D).
function makeMethodRecordingDb(handlers: Record<string, unknown[]>, calls: Array<{ table: string; method: string; args: unknown[] }>) {
  const from = vi.fn((table: string) => {
    const q = handlers[table] ?? [{ data: null, error: null }]
    const result = q.length > 1 ? q.shift() : q[0]
    const proxy: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject)
        }
        return (...args: unknown[]) => { calls.push({ table, method: String(prop), args }); return proxy }
      },
    })
    return proxy
  })
  return { from }
}

// Como makeDb, mas captura o PAYLOAD de cada .update() — prova o efeito da expiração (last_event).
function makeUpdateRecordingDb(handlers: Record<string, unknown[]>, updates: Array<{ table: string; payload: unknown }>) {
  const from = vi.fn((table: string) => {
    const q = handlers[table] ?? [{ data: null, error: null }]
    const result = q.length > 1 ? q.shift() : q[0]
    const proxy: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject)
        }
        if (prop === 'update') return (payload: unknown) => { updates.push({ table, payload }); return proxy }
        return () => proxy
      },
    })
    return proxy
  })
  return { from }
}

const minsAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString()

const REQ = { headers: { get: (k: string) => (k === 'authorization' ? 'Bearer test-secret' : null) } } as never

async function load(extraEnv: Record<string, string> = {}) {
  vi.resetModules()
  vi.stubEnv('CRON_SECRET', 'test-secret')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  for (const [k, v] of Object.entries(extraEnv)) vi.stubEnv(k, v)
  const route = await import('./route')
  const asaas = await import('@/lib/asaas')
  const act = await import('@/lib/billing-activation')
  const lock = await import('@/lib/billing-lock')
  const supa = await import('@supabase/supabase-js')
  const resend = await import('@/lib/resend')
  const ps = await import('@/lib/plan-switch')
  return { GET: route.GET, asaas, act, lock, supa, resend, ps }
}

const PENDING_CK = {
  id: 'ck1', profile_id: 'user-1', plan: 'starter', cycle: 'MONTHLY', status: 'pending',
  asaas_customer_id: 'cus_1', asaas_subscription_id: null, created_at: '2026-06-09T10:00:00Z',
}
const FREE_PROFILE = { id: 'user-1', plan: 'free', plan_status: null, plan_cycle: null, asaas_subscription_id: null }
// Contrato real da lib: ARRAY direto (não { data: [...] }).
const ACTIVE_SUB = [{ id: 'sub_1', status: 'ACTIVE', value: 49, cycle: 'MONTHLY' }]

function setupHappyPath(mods: Awaited<ReturnType<typeof load>>) {
  vi.mocked(mods.lock.acquireLock).mockResolvedValue(true)
  vi.mocked(mods.asaas.getCustomerSubscriptions).mockResolvedValue(ACTIVE_SUB as never)
  vi.mocked(mods.asaas.hasConfirmedPaymentForSubscription).mockResolvedValue({ confirmed: true, ok: true })
  vi.mocked(mods.act.isExpectedFullPrice).mockReturnValue(true)
  vi.mocked(mods.supa.createClient).mockReturnValue(makeDb({
    billing_checkouts: [
      { data: [PENDING_CK], error: null }, // listagem de pendings
      { data: [], error: null },           // check de checkout paid mais novo
    ],
    profiles: [{ data: FREE_PROFILE, error: null }],
  }) as never)
}

describe('GET /api/cron/reconcile-checkouts (backstop)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllEnvs())

  it('retorna 401 sem o CRON_SECRET correto', async () => {
    const { GET } = await load()
    const res = await GET({ headers: { get: () => null } } as never)
    expect(res.status).toBe(401)
  })

  it('DETECTA pago+ACTIVE sem ativação em alert-only (não skip) — regressão do no-op', async () => {
    // Desde 2026-06-10 a ação é ON por padrão; alert-only agora exige =false explícito.
    const mods = await load({ BILLING_RECONCILE_CHECKOUTS_ACTIONS: 'false' })
    setupHappyPath(mods)

    const res = await mods.GET(REQ)
    const body = await res.json() as { alerted: number; skipped: number; activated: number }

    // pré-fix: `.data` de array = undefined → active=[] → target=null → skipped=1, alerted=0
    expect(body.alerted).toBe(1)
    expect(body.skipped).toBe(0)
    expect(body.activated).toBe(0) // alert-only não muta
    expect(vi.mocked(mods.act.activatePaidSubscription)).not.toHaveBeenCalled()
    expect(vi.mocked(mods.resend.sendBillingOpsAlert)).toHaveBeenCalled()
  })

  it('com ACTIONS ligado, ativa via activatePaidSubscription', async () => {
    const mods = await load({ BILLING_RECONCILE_CHECKOUTS_ACTIONS: 'true' })
    setupHappyPath(mods)
    vi.mocked(mods.act.activatePaidSubscription).mockResolvedValue({
      activated: true, alreadyActive: false, recurringValueNeeded: false, recurringValueFixed: true,
    })

    const res = await mods.GET(REQ)
    const body = await res.json() as { activated: number }

    expect(vi.mocked(mods.act.activatePaidSubscription)).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', subscriptionId: 'sub_1', plan: 'starter', cycle: 'MONTHLY', source: 'backstop',
    }))
    expect(body.activated).toBe(1)
  })

  it('NÃO ativa sub prorateada (guard de preço-cheio) — alerta p/ manual', async () => {
    const mods = await load({ BILLING_RECONCILE_CHECKOUTS_ACTIONS: 'true' })
    setupHappyPath(mods)
    vi.mocked(mods.asaas.getCustomerSubscriptions).mockResolvedValue([{ ...ACTIVE_SUB[0], value: 33.5 }] as never)
    vi.mocked(mods.act.isExpectedFullPrice).mockReturnValue(false)

    const res = await mods.GET(REQ)
    const body = await res.json() as { alerted: number; activated: number }

    expect(body.activated).toBe(0)
    expect(body.alerted).toBe(1)
    expect(vi.mocked(mods.act.activatePaidSubscription)).not.toHaveBeenCalled()
  })

  it('pagamento ainda não confirmado → skip (sem alerta, sem ativação)', async () => {
    const mods = await load({ BILLING_RECONCILE_CHECKOUTS_ACTIONS: 'true' })
    setupHappyPath(mods)
    vi.mocked(mods.asaas.hasConfirmedPaymentForSubscription).mockResolvedValue({ confirmed: false, ok: true })

    const res = await mods.GET(REQ)
    const body = await res.json() as { skipped: number; activated: number; alerted: number }

    expect(body.skipped).toBe(1)
    expect(body.activated).toBe(0)
    expect(body.alerted).toBe(0)
  })

  it('profile em canceling → alerta e não ativa', async () => {
    const mods = await load({ BILLING_RECONCILE_CHECKOUTS_ACTIONS: 'true' })
    setupHappyPath(mods)
    vi.mocked(mods.supa.createClient).mockReturnValue(makeDb({
      billing_checkouts: [{ data: [PENDING_CK], error: null }, { data: [], error: null }],
      profiles: [{ data: { ...FREE_PROFILE, plan: 'starter', plan_status: 'canceling' }, error: null }],
    }) as never)

    const res = await mods.GET(REQ)
    const body = await res.json() as { alerted: number; activated: number }

    expect(body.activated).toBe(0)
    expect(body.alerted).toBe(1)
    expect(vi.mocked(mods.act.activatePaidSubscription)).not.toHaveBeenCalled()
  })

  // ── Fallback de cartão morto (2026-07-03), commit 5/5 ─────────────────────────────────────────
  const FB_ROW = {
    id: 'fb1', profile_id: 'user-9', asaas_customer_id: 'cus_9',
    asaas_checkout_session_id: 'sess_9', updated_at: minsAgo(20),
  }

  it('🛡️ (P1-D) passo EXISTENTE exclui a linha do fallback (.neq payment_method no SELECT)', async () => {
    // O mock não filtra de fato; provamos que o SELECT do passo existente CHAMA
    // .neq('payment_method','plan_switch_fallback') — o filtro é feito server-side em prod.
    const mods = await load({ BILLING_RECONCILE_CHECKOUTS_ACTIONS: 'true' })
    const calls: Array<{ table: string; method: string; args: unknown[] }> = []
    vi.mocked(mods.lock.acquireLock).mockResolvedValue(true)
    vi.mocked(mods.supa.createClient).mockReturnValue(makeMethodRecordingDb({
      billing_checkouts: [{ data: [], error: null }, { data: [], error: null }],
      profiles: [{ data: null, error: null }],
    }, calls) as never)

    await mods.GET(REQ)

    const hasNeq = calls.some((c) => c.table === 'billing_checkouts' && c.method === 'neq'
      && c.args[0] === 'payment_method' && c.args[1] === 'plan_switch_fallback')
    expect(hasNeq).toBe(true)
  })

  it('linha ≥15min com pagamento CONFIRMED → runCardFallbackBackstop (source reconcile)', async () => {
    const mods = await load({ BILLING_RECONCILE_CHECKOUTS_ACTIONS: 'true' })
    vi.mocked(mods.lock.acquireLock).mockResolvedValue(true)
    vi.mocked(mods.asaas.findPaymentByCheckoutSession).mockResolvedValue({ ok: true, payment: { id: 'pay_9', status: 'CONFIRMED' } })
    vi.mocked(mods.ps.runCardFallbackBackstop).mockResolvedValue('switched')
    vi.mocked(mods.supa.createClient).mockReturnValue(makeDb({
      billing_checkouts: [
        { data: [], error: null },        // passo existente (pendings) — vazio
        { data: [FB_ROW], error: null },  // passo novo (fallbacks pendentes)
      ],
      profiles: [{ data: null, error: null }],
    }) as never)

    const res = await mods.GET(REQ)
    const body = await res.json() as { fallbackBackstop: number; fallbackExpired: number }

    expect(vi.mocked(mods.ps.runCardFallbackBackstop)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ customerId: 'cus_9', paymentId: 'pay_9', checkoutSessionId: 'sess_9', source: 'reconcile' }),
    )
    expect(body.fallbackBackstop).toBe(1)
    expect(body.fallbackExpired).toBe(0)
  })

  it('🛡️ (P1-B) linha ≥15min e <90min SEM pagamento → intocada (não expira cedo, sem backstop)', async () => {
    const mods = await load({ BILLING_RECONCILE_CHECKOUTS_ACTIONS: 'true' })
    vi.mocked(mods.lock.acquireLock).mockResolvedValue(true)
    vi.mocked(mods.asaas.findPaymentByCheckoutSession).mockResolvedValue({ ok: true, payment: null })
    vi.mocked(mods.supa.createClient).mockReturnValue(makeDb({
      billing_checkouts: [
        { data: [], error: null },
        { data: [{ ...FB_ROW, updated_at: minsAgo(45) }], error: null },
      ],
      profiles: [{ data: null, error: null }],
    }) as never)

    const res = await mods.GET(REQ)
    const body = await res.json() as { fallbackExpired: number; fallbackBackstop: number }

    expect(vi.mocked(mods.ps.runCardFallbackBackstop)).not.toHaveBeenCalled()
    expect(body.fallbackExpired).toBe(0)
    expect(body.fallbackBackstop).toBe(0)
  })

  it('linha ≥90min sem pagamento → status cancelled + last_event CARD_FALLBACK_EXPIRED', async () => {
    const mods = await load({ BILLING_RECONCILE_CHECKOUTS_ACTIONS: 'true' })
    const updates: Array<{ table: string; payload: unknown }> = []
    vi.mocked(mods.lock.acquireLock).mockResolvedValue(true)
    vi.mocked(mods.asaas.findPaymentByCheckoutSession).mockResolvedValue({ ok: true, payment: null })
    vi.mocked(mods.supa.createClient).mockReturnValue(makeUpdateRecordingDb({
      billing_checkouts: [
        { data: [], error: null },
        { data: [{ ...FB_ROW, updated_at: minsAgo(120) }], error: null },
        { data: null, error: null }, // resposta do UPDATE
      ],
      profiles: [{ data: null, error: null }],
    }, updates) as never)

    const res = await mods.GET(REQ)
    const body = await res.json() as { fallbackExpired: number }

    expect(vi.mocked(mods.ps.runCardFallbackBackstop)).not.toHaveBeenCalled()
    expect(body.fallbackExpired).toBe(1)
    expect(updates).toContainEqual({
      table: 'billing_checkouts',
      payload: { status: 'cancelled', last_event: 'CARD_FALLBACK_EXPIRED' },
    })
  })
})
