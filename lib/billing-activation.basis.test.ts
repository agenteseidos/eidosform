/**
 * lib/billing-activation.basis.test.ts — Commit C (proration): a RÉGUA de valoração
 * (proration_basis_days) é gravada na 1ª compra e em TODA renovação, e LIMPA nos payloads
 * de free. Casos do plano (§8):
 *  (f) renovação 31→30→28: finalizeActivation grava a base REAL (dueDate → nextDueDate).
 *  (g) evento tardio (writeBasis:false): o update NÃO inclui proration_basis_days.
 *  (h) todos os caminhos gravam/limpam: buildActivePlanUpdate/buildFreePlanUpdate limpam.
 *
 * `computeProrationBasisDays` (o helper puro) é testado à parte em lib/proration.test.ts.
 * Aqui o foco é o WRITER (finalizeActivation) + os payloads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// @/lib/asaas: mantém PLAN_PRICES real (p/ o guard de valor cheio) e stuba a rede.
vi.mock('@/lib/asaas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asaas')>()
  return {
    ...actual,
    getSubscription: vi.fn(),
    cancelSubscription: vi.fn(async () => ({ deleted: true })),
    reconcileActiveSubscriptions: vi.fn(async () => ({ kept: 'sub_new', cancelled: [], ambiguous: [] })),
    updateSubscription: vi.fn(async () => ({ ok: true })),
    extractCardToken: vi.fn(() => null),
  }
})
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))
vi.mock('@/lib/plan-limits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plan-limits')>()
  return { ...actual, handleUpgrade: vi.fn(async () => ({ unpausedCount: 0 })) }
})

import { finalizeActivation, buildActivePlanUpdate, buildFreePlanUpdate } from './billing-activation'
import { getSubscription } from '@/lib/asaas'

const USER = '22222222-2222-4222-8222-222222222222'
const SUB = 'sub_new'

// Fake Supabase que CAPTURA os payloads dos updates em `profiles`.
type Upd = Record<string, unknown>
function makeDb(profileUpdates: Upd[]) {
  return {
    from(table: string) {
      const b: Record<string, unknown> & { _op: string; _payload?: unknown; _single?: boolean } = { _op: 'select' }
      const chain = () => b
      b.select = chain; b.eq = chain; b.is = chain
      b.single = () => { b._single = true; return b }
      b.update = (p: unknown) => { b._op = 'update'; b._payload = p; return b }
      b.then = (resolve: (r: unknown) => unknown) => {
        let res: unknown = { data: null, error: null }
        if (table === 'profiles' && b._op === 'select') {
          // re-leitura: o profile AINDA aponta pra sub nova (não pula o finalize).
          res = { data: { asaas_subscription_id: SUB }, error: null }
        } else if (table === 'profiles' && b._op === 'update') {
          profileUpdates.push(b._payload as Upd)
          res = { data: [{ id: USER }], error: null }
        }
        return Promise.resolve(res).then(resolve)
      }
      return b
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient
}

/** Acha o update de expiração+base (o único que carrega plan_expires_at). */
function expiryUpdate(updates: Upd[]): Upd | undefined {
  return updates.find((u) => 'plan_expires_at' in u)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Relógio FIXO: os nextDueDate de 2026-2028 precisam ser FUTUROS (expiryFromNextDueDate
  // guarda contra data no passado, senão pula o bloco 4a e não grava base).
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('finalizeActivation — grava proration_basis_days REAL (1ª compra / renovação)', () => {
  // starter monthly = R$49 (preço cheio → sem correção de valor recorrente).
  function subValueFull() {
    return { value: 49.0 }
  }

  it('(f) 1ª compra / renovação jul→ago = base 31', async () => {
    vi.mocked(getSubscription).mockResolvedValue({ ...subValueFull(), nextDueDate: '2026-08-03' } as never)
    const updates: Upd[] = []
    await finalizeActivation({
      db: makeDb(updates), userId: USER, customerId: 'cus_1', newSubscriptionId: SUB,
      plan: 'starter', cycle: 'MONTHLY', source: 'webhook',
      paymentDueDate: '2026-07-03',
    })
    const u = expiryUpdate(updates)!
    expect(u.proration_basis_days).toBe(31)
    expect(u.billing_period_start_on).toBe('2026-07-03')
    expect(u.billing_period_end_on).toBe('2026-08-03')
  })

  it('(f) renovação abr→mai = base 30', async () => {
    vi.mocked(getSubscription).mockResolvedValue({ ...subValueFull(), nextDueDate: '2026-05-01' } as never)
    const updates: Upd[] = []
    await finalizeActivation({
      db: makeDb(updates), userId: USER, customerId: 'cus_1', newSubscriptionId: SUB,
      plan: 'starter', cycle: 'MONTHLY', source: 'webhook',
      paymentDueDate: '2026-04-01',
    })
    expect(expiryUpdate(updates)!.proration_basis_days).toBe(30)
  })

  it('(f) renovação cobrindo fevereiro fev→mar = base 28 (NÃO 30 — sem sobrecobrança)', async () => {
    vi.mocked(getSubscription).mockResolvedValue({ ...subValueFull(), nextDueDate: '2026-03-01' } as never)
    const updates: Upd[] = []
    await finalizeActivation({
      db: makeDb(updates), userId: USER, customerId: 'cus_1', newSubscriptionId: SUB,
      plan: 'starter', cycle: 'MONTHLY', source: 'webhook',
      paymentDueDate: '2026-02-01',
    })
    expect(expiryUpdate(updates)!.proration_basis_days).toBe(28)
  })

  it('(f) polling/reprocess SEM paymentDueDate: deriva o início por mês-CALENDÁRIO (mar→ base 28)', async () => {
    vi.mocked(getSubscription).mockResolvedValue({ ...subValueFull(), nextDueDate: '2026-03-03' } as never)
    const updates: Upd[] = []
    await finalizeActivation({
      db: makeDb(updates), userId: USER, customerId: 'cus_1', newSubscriptionId: SUB,
      plan: 'starter', cycle: 'MONTHLY', source: 'polling',
      // sem paymentDueDate → deriva início = 2026-02-03 (nextDueDate − 1 mês calendário) → 28 dias
    })
    const u = expiryUpdate(updates)!
    expect(u.proration_basis_days).toBe(28)
    // sem paymentDueDate → billing_period_start_on NÃO é gravado (só o fim).
    expect(u.billing_period_start_on).toBeUndefined()
    expect(u.billing_period_end_on).toBe('2026-03-03')
  })

  it('(f) nextDueDate corrompido (fora da banda sã) → NÃO grava base, mas ajusta a expiração', async () => {
    // ~182 dias fora de [27,32] → computeProrationBasisDays devolve null.
    vi.mocked(getSubscription).mockResolvedValue({ ...subValueFull(), nextDueDate: '2026-07-01' } as never)
    const updates: Upd[] = []
    await finalizeActivation({
      db: makeDb(updates), userId: USER, customerId: 'cus_1', newSubscriptionId: SUB,
      plan: 'starter', cycle: 'MONTHLY', source: 'webhook',
      paymentDueDate: '2026-01-01',
    })
    const u = expiryUpdate(updates)!
    expect(u).toHaveProperty('plan_expires_at')
    expect(u).not.toHaveProperty('proration_basis_days') // fallback 30/365 no read + log
  })
})

describe('finalizeActivation — guard de evento tardio (writeBasis:false NÃO reescreve a base)', () => {
  it('(g) RECEIVED tardio: update ajusta expiração mas NÃO grava proration_basis_days', async () => {
    vi.mocked(getSubscription).mockResolvedValue({ value: 49.0, nextDueDate: '2026-08-03' } as never)
    const updates: Upd[] = []
    await finalizeActivation({
      db: makeDb(updates), userId: USER, customerId: 'cus_1', newSubscriptionId: SUB,
      plan: 'starter', cycle: 'MONTHLY', source: 'webhook',
      paymentDueDate: '2026-07-03',
      writeBasis: false, // ← evento do ciclo ANTERIOR: NÃO sobrescreve a base vigente
    })
    const u = expiryUpdate(updates)!
    expect(u).toHaveProperty('plan_expires_at')
    expect(u).not.toHaveProperty('proration_basis_days')
    expect(u).not.toHaveProperty('billing_period_start_on')
    expect(u).not.toHaveProperty('billing_period_end_on')
  })
})

describe('(h) payloads limpam/gravam a base', () => {
  it('buildActivePlanUpdate limpa a base do plano anterior (finalize preenche a real depois)', () => {
    const p = buildActivePlanUpdate({ plan: 'starter', cycle: 'MONTHLY' })
    expect(p).toHaveProperty('proration_basis_days', null)
    expect(p).toHaveProperty('billing_period_start_on', null)
    expect(p).toHaveProperty('billing_period_end_on', null)
  })

  it.each(['overdue', 'cancelled', 'chargeback', 'refunded'] as const)(
    'buildFreePlanUpdate (%s) LIMPA a base (caso 5)',
    (status) => {
      const p = buildFreePlanUpdate(status)
      expect(p).toHaveProperty('proration_basis_days', null)
      expect(p).toHaveProperty('billing_period_start_on', null)
      expect(p).toHaveProperty('billing_period_end_on', null)
    }
  )
})
