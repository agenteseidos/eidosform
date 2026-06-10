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
}))
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
  return { GET: route.GET, asaas, act, lock, supa, resend }
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
    const mods = await load()
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
})
