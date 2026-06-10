/**
 * Testes do cron reconcile-subscriptions (P0, audit 2026-06-09).
 * Regressão coberta: getCustomerSubscriptions retorna o ARRAY direto — o cron lia `.data`
 * do retorno, obtinha [] e reportava "clean" p/ sempre (no-op silencioso). Estes testes
 * falham se alguém reintroduzir o acesso `.data`.
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
vi.mock('@/lib/asaas', () => ({ getCustomerSubscriptions: vi.fn(), cancelSubscription: vi.fn() }))
vi.mock('@/lib/billing-lock', () => ({ acquireLock: vi.fn(), releaseLock: vi.fn() }))
vi.mock('@/lib/resend', () => ({ sendBillingOpsAlert: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

// Builder de query chain do Supabase: qualquer método encadeado devolve o próprio chain,
// e o chain é "thenable" resolvendo o resultado informado (cobre select/eq/neq/.../limit).
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

/** db.from(table) consome uma fila de resultados POR TABELA (último item repete). */
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
  const lock = await import('@/lib/billing-lock')
  const supa = await import('@supabase/supabase-js')
  const resend = await import('@/lib/resend')
  return { GET: route.GET, asaas, lock, supa, resend }
}

const PROFILE = { id: 'user-1', asaas_customer_id: 'cus_1', asaas_subscription_id: 'sub_keep' }
// Duas ACTIVE: a keep (vigente, mais nova) + uma órfã MAIS ANTIGA de mesmo valor.
const TWO_ACTIVE = [
  { id: 'sub_keep', status: 'ACTIVE', value: 49, dateCreated: '2026-06-09 10:00:00' },
  { id: 'sub_orfa', status: 'ACTIVE', value: 49, dateCreated: '2026-06-01 10:00:00' },
]

describe('GET /api/cron/reconcile-subscriptions', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllEnvs())

  it('retorna 401 sem o CRON_SECRET correto', async () => {
    const { GET } = await load()
    const res = await GET({ headers: { get: () => null } } as never)
    expect(res.status).toBe(401)
  })

  it('DETECTA 2 subs ACTIVE em alert-only (não reporta clean) — regressão do no-op', async () => {
    // Desde 2026-06-10 a ação é ON por padrão; alert-only agora exige =false explícito.
    const { GET, asaas, lock, supa, resend } = await load({ BILLING_RECONCILE_SUBSCRIPTIONS_ACTIONS: 'false' })
    vi.mocked(lock.acquireLock).mockResolvedValue(true)
    // Contrato real da lib: ARRAY direto (não { data: [...] }).
    vi.mocked(asaas.getCustomerSubscriptions).mockResolvedValue(TWO_ACTIVE as never)
    vi.mocked(supa.createClient).mockReturnValue(makeDb({ profiles: [{ data: [PROFILE], error: null }] }) as never)

    const res = await GET(REQ)
    const body = await res.json() as { clean: number; alerted: number; cancelled: number }

    expect(body.clean).toBe(0) // pré-fix: clean=1 (bug — `.data` de array = undefined → [])
    expect(body.alerted).toBeGreaterThanOrEqual(1)
    expect(body.cancelled).toBe(0) // alert-only não cancela
    expect(vi.mocked(asaas.cancelSubscription)).not.toHaveBeenCalled()
    expect(vi.mocked(resend.sendBillingOpsAlert)).toHaveBeenCalled()
  })

  it('com ACTIONS ligado, cancela a órfã mais antiga e mantém a keep', async () => {
    const { GET, asaas, lock, supa } = await load({ BILLING_RECONCILE_SUBSCRIPTIONS_ACTIONS: 'true' })
    vi.mocked(lock.acquireLock).mockResolvedValue(true)
    vi.mocked(asaas.getCustomerSubscriptions).mockResolvedValue(TWO_ACTIVE as never)
    vi.mocked(asaas.cancelSubscription).mockResolvedValue({ deleted: true, id: 'sub_orfa' } as never)
    vi.mocked(supa.createClient).mockReturnValue(makeDb({
      profiles: [{ data: [PROFILE], error: null }],
      asaas_webhook_events: [{ error: null }],
    }) as never)

    const res = await GET(REQ)
    const body = await res.json() as { cancelled: number }

    expect(vi.mocked(asaas.cancelSubscription)).toHaveBeenCalledWith('sub_orfa')
    expect(vi.mocked(asaas.cancelSubscription)).not.toHaveBeenCalledWith('sub_keep')
    expect(body.cancelled).toBe(1)
  })

  it('1 sub ACTIVE → clean, sem alerta e sem cancelamento', async () => {
    const { GET, asaas, lock, supa, resend } = await load()
    vi.mocked(lock.acquireLock).mockResolvedValue(true)
    vi.mocked(asaas.getCustomerSubscriptions).mockResolvedValue([TWO_ACTIVE[0]] as never)
    vi.mocked(supa.createClient).mockReturnValue(makeDb({ profiles: [{ data: [PROFILE], error: null }] }) as never)

    const res = await GET(REQ)
    const body = await res.json() as { clean: number; alerted: number }

    expect(body.clean).toBe(1)
    expect(body.alerted).toBe(0)
    expect(vi.mocked(asaas.cancelSubscription)).not.toHaveBeenCalled()
    expect(vi.mocked(resend.sendBillingOpsAlert)).not.toHaveBeenCalled()
  })

  it('profile que não aponta p/ nenhuma ACTIVE → ambíguo: alerta, não cancela', async () => {
    const { GET, asaas, lock, supa } = await load({ BILLING_RECONCILE_SUBSCRIPTIONS_ACTIONS: 'true' })
    vi.mocked(lock.acquireLock).mockResolvedValue(true)
    vi.mocked(asaas.getCustomerSubscriptions).mockResolvedValue(TWO_ACTIVE as never)
    vi.mocked(supa.createClient).mockReturnValue(makeDb({
      profiles: [{ data: [{ ...PROFILE, asaas_subscription_id: 'sub_outra' }], error: null }],
    }) as never)

    const res = await GET(REQ)
    const body = await res.json() as { cancelled: number; alerted: number }

    expect(body.cancelled).toBe(0)
    expect(body.alerted).toBeGreaterThanOrEqual(1)
    expect(vi.mocked(asaas.cancelSubscription)).not.toHaveBeenCalled()
  })
})
