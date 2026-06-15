import { describe, it, expect, vi, beforeEach } from 'vitest'

// Contrato do executor do redesenho (2026-06-10): cancelar+recriar via token.
// Invariantes testadas:
//  - sub nova é criada SEMPRE no preço CHEIO (nunca prorateado)
//  - CAS pré-voo: profile mudou → aborta SEM tocar no Asaas
//  - CAS de commit: perdeu a corrida → cancela a sub recém-criada (sem cobrança fantasma)
//  - sucesso: profile trocado, reconcile mantém SÓ a nova, checkout 'paid' gravado
//  - backstop: idempotente (já aplicado → noop), sem token → throw (ação manual)

const asaasMocks = vi.hoisted(() => ({
  createSubscriptionWithToken: vi.fn(async () => ({ id: 'sub_new' })),
  cancelSubscription: vi.fn(async () => ({ deleted: true, id: 'sub_new' })),
  reconcileActiveSubscriptions: vi.fn(async () => ({ kept: 'sub_new', cancelled: ['sub_old'], ambiguous: [] })),
  getPaymentById: vi.fn(async () => ({ ok: true, payment: { id: 'pay_x', status: 'CONFIRMED' } })),
  refundPayment: vi.fn(async () => ({ id: 'pay_x', status: 'REFUNDED' })),
}))

vi.mock('@/lib/asaas', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/asaas')>()
  return { ...orig, ...asaasMocks }
})
vi.mock('@/lib/billing-lock', () => ({
  acquireLock: vi.fn(async () => true),
  releaseLock: vi.fn(async () => undefined),
}))
vi.mock('@/lib/resend', () => ({ sendBillingOpsAlert: vi.fn(async () => undefined) }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))
vi.mock('@/lib/plan-limits', () => ({
  handleUpgrade: vi.fn(async () => ({ unpausedCount: 0 })),
  handleDowngrade: vi.fn(async () => ({ pausedCount: 1 })),
}))

import { executePlanSwitch, runPlanChangeBackstop, fullPriceOf, nextDueDateAfterFullCycle } from './plan-switch'
import { acquireLock } from '@/lib/billing-lock'

// ── Supabase fake configurável ────────────────────────────────────────────────
const state: {
  profileRow: Record<string, unknown> | null
  recoveryRow: Record<string, unknown> | null
  updateRows: Array<{ id: string }>
  calls: Array<{ table: string; op: string; payload?: unknown }>
} = { profileRow: null, recoveryRow: null, updateRows: [], calls: [] }

function makeDb() {
  return {
    from(table: string) {
      const b: Record<string, unknown> & { _op: string; _payload?: unknown } = { _op: 'select' }
      const chain = () => b
      b.select = chain; b.eq = chain; b.is = chain; b.single = chain; b.maybeSingle = chain
      b.update = (p: unknown) => { b._op = 'update'; b._payload = p; return b }
      b.upsert = (p: unknown) => { b._op = 'upsert'; b._payload = p; return b }
      b.then = (resolve: (r: unknown) => unknown) => {
        state.calls.push({ table, op: b._op, payload: b._payload })
        let res: unknown = { data: null, error: null }
        if (table === 'profiles' && b._op === 'select') res = { data: state.profileRow, error: null }
        if (table === 'profiles' && b._op === 'update') res = { data: state.updateRows, error: null }
        if (b._op === 'upsert') res = { error: null }
        if (table === 'billing_checkouts' && b._op === 'select') res = { data: state.recoveryRow, error: null }
        if (table === 'billing_checkouts' && b._op === 'update') res = { error: null }
        return Promise.resolve(res).then(resolve)
      }
      return b
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient
}

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'

const baseParams = {
  profileId: PROFILE_ID,
  customerId: 'cus_1',
  cardToken: 'tok_1',
  expectedOldSubscriptionId: 'sub_old',
  plan: 'plus' as const,
  cycle: 'MONTHLY' as const,
  nextDueDate: '2026-07-10',
  reason: 'upgrade_paid' as const,
  isPlanDowngrade: false,
  proration: { credit: 24.5, originalPrice: 127, finalPrice: 102.5 },
}

beforeEach(() => {
  vi.clearAllMocks()
  state.profileRow = { asaas_subscription_id: 'sub_old' }
  state.recoveryRow = { planchange_attempt_id: 'att_default', status: 'recovering' }
  state.updateRows = [{ id: PROFILE_ID }]
  state.calls = []
})

describe('executePlanSwitch', () => {
  it('cria a sub nova no preço CHEIO (nunca prorateado) e troca o profile', async () => {
    const r = await executePlanSwitch({ db: makeDb(), ...baseParams })
    expect(r.ok).toBe(true)
    const callArgs = (asaasMocks.createSubscriptionWithToken.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]
    expect(callArgs.value).toBe(127) // cheio, NÃO 102.5
    expect(callArgs.creditCardToken).toBe('tok_1')
    expect(callArgs.nextDueDate).toBe('2026-07-10')
    // P0-1 (revisão 2026-06-10): a sub ANTIGA é cancelada EXPLICITAMENTE — o reconcile
    // não cancela sub same-day com valor diferente (ambígua), que é toda troca de plano.
    expect(asaasMocks.cancelSubscription).toHaveBeenCalledWith('sub_old')
    expect(asaasMocks.reconcileActiveSubscriptions).toHaveBeenCalledWith('cus_1', 'sub_new')
    // profile trocado + checkout paid de auditoria
    expect(state.calls.some(c => c.table === 'profiles' && c.op === 'update')).toBe(true)
    expect(state.calls.some(c => c.table === 'billing_checkouts' && c.op === 'upsert')).toBe(true)
  })

  it('CAS pré-voo: sub do profile mudou → aborta SEM criar nada no Asaas', async () => {
    state.profileRow = { asaas_subscription_id: 'sub_outra' }
    const r = await executePlanSwitch({ db: makeDb(), ...baseParams })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('CAS_PRECHECK')
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
  })

  it('CAS de commit falhou (0 linhas) → CANCELA a sub recém-criada (sem cobrança fantasma)', async () => {
    state.updateRows = [] // outro fluxo venceu a corrida
    const r = await executePlanSwitch({ db: makeDb(), ...baseParams })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('CAS_COMMIT')
    expect(asaasMocks.cancelSubscription).toHaveBeenCalledWith('sub_new')
  })

  it('falha ao criar a sub → fail-closed (nada mudou, erro 502)', async () => {
    asaasMocks.createSubscriptionWithToken.mockRejectedValueOnce(new Error('asaas down'))
    const r = await executePlanSwitch({ db: makeDb(), ...baseParams })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('CREATE_SUB_FAILED')
    expect(state.calls.some(c => c.table === 'profiles' && c.op === 'update')).toBe(false)
  })

  it('reativação (canceling): expectedOldSubscriptionId null funciona com .is(null) e NÃO cancela nada', async () => {
    state.profileRow = { asaas_subscription_id: null }
    const r = await executePlanSwitch({ db: makeDb(), ...baseParams, expectedOldSubscriptionId: null, reason: 'reactivate' })
    expect(r.ok).toBe(true)
    expect(asaasMocks.cancelSubscription).not.toHaveBeenCalled()
  })

  it('cancel da sub antiga falha 2x → troca CONCLUI, mas DLQ CANCEL_OLDSUB + alerta (anti cobrança dupla)', async () => {
    asaasMocks.cancelSubscription
      .mockRejectedValueOnce(new Error('asaas 500'))
      .mockRejectedValueOnce(new Error('asaas 500'))
    const r = await executePlanSwitch({ db: makeDb(), ...baseParams })
    expect(r.ok).toBe(true) // o plano do cliente troca mesmo assim (ele pagou)
    const dlq = state.calls.find(c => c.table === 'asaas_webhook_events' && c.op === 'upsert')
    expect(dlq).toBeTruthy()
    expect((dlq!.payload as { event: string }).event).toBe('CANCEL_OLDSUB')
    expect((dlq!.payload as { subscription_id: string }).subscription_id).toBe('sub_old')
    const { sendBillingOpsAlert } = await import('@/lib/resend')
    expect(vi.mocked(sendBillingOpsAlert)).toHaveBeenCalled()
  })
})

describe('runPlanChangeBackstop', () => {
  it('profile já no plano-alvo com sub → noop (idempotente)', async () => {
    state.profileRow = { plan: 'plus', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_x', asaas_customer_id: 'cus_1', asaas_card_token: 'tok_1' }
    const r = await runPlanChangeBackstop(makeDb(), { profileId: PROFILE_ID, plan: 'plus', cycle: 'MONTHLY', paymentId: 'pay_1', attempt: 'att_default', source: 'webhook' })
    expect(r).toBe('already_applied')
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
  })

  it('troca pendente → executa o switch e marca o checkout paid', async () => {
    state.profileRow = { plan: 'starter', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_old', asaas_customer_id: 'cus_1', asaas_card_token: 'tok_1' }
    const r = await runPlanChangeBackstop(makeDb(), { profileId: PROFILE_ID, plan: 'plus', cycle: 'MONTHLY', paymentId: 'pay_1', attempt: 'att_default', source: 'reprocess' })
    expect(r).toBe('switched')
    expect(asaasMocks.createSubscriptionWithToken).toHaveBeenCalled()
  })

  it('sem token → throw (avulso pago precisa de ação manual, nunca silencioso)', async () => {
    state.profileRow = { plan: 'starter', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_old', asaas_customer_id: 'cus_1', asaas_card_token: null }
    await expect(
      runPlanChangeBackstop(makeDb(), { profileId: PROFILE_ID, plan: 'plus', cycle: 'MONTHLY', paymentId: 'pay_1', attempt: 'att_default', source: 'webhook' })
    ).rejects.toThrow(/sem card token/)
  })

  it('lock ocupado (síncrono em andamento) → throw p/ retry', async () => {
    state.profileRow = { plan: 'starter', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_old', asaas_customer_id: 'cus_1', asaas_card_token: 'tok_1' }
    vi.mocked(acquireLock).mockResolvedValueOnce(false)
    await expect(
      runPlanChangeBackstop(makeDb(), { profileId: PROFILE_ID, plan: 'plus', cycle: 'MONTHLY', paymentId: 'pay_1', source: 'webhook' })
    ).rejects.toThrow(/lock ocupado/)
  })

  it('downgrade detectado pela ordem dos planos (Plus→Starter pausa forms)', async () => {
    state.profileRow = { plan: 'plus', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_old', asaas_customer_id: 'cus_1', asaas_card_token: 'tok_1' }
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk'
    const r = await runPlanChangeBackstop(makeDb(), { profileId: PROFILE_ID, plan: 'starter', cycle: 'MONTHLY', paymentId: 'pay_1', attempt: 'att_default', source: 'webhook' })
    expect(r).toBe('switched')
    const pl = await import('@/lib/plan-limits')
    expect(vi.mocked(pl.handleDowngrade)).toHaveBeenCalledWith(PROFILE_ID, 'srk', 'starter')
  })

  it('avulso de tentativa SUPERSEDED (attempt ≠ linha atual) → NÃO aplica, alerta (I2)', async () => {
    state.profileRow = { plan: 'starter', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_old', asaas_customer_id: 'cus_1', asaas_card_token: 'tok_1' }
    state.recoveryRow = { planchange_attempt_id: 'att_NOVA', status: 'recovering' }
    const r = await runPlanChangeBackstop(makeDb(), { profileId: PROFILE_ID, plan: 'plus', cycle: 'MONTHLY', paymentId: 'pay_velho', attempt: 'att_ANTIGA', source: 'reprocess' })
    expect(r).toBe('superseded')
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
    expect(asaasMocks.refundPayment).toHaveBeenCalled() // superseded → estorna automaticamente
    const { sendBillingOpsAlert } = await import('@/lib/resend')
    expect(vi.mocked(sendBillingOpsAlert)).toHaveBeenCalled()
  })

  it('REGRESSÃO Codex: POST síncrono concluiu (linha paid, profile NO alvo) + webhook do MESMO avulso → already_applied, NÃO estorna (I1/I3)', async () => {
    state.profileRow = { plan: 'plus', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_new', asaas_customer_id: 'cus_1', asaas_card_token: 'tok_1' }
    state.recoveryRow = { planchange_attempt_id: 'att_X', status: 'paid', plan: 'plus', cycle: 'MONTHLY' }
    const r = await runPlanChangeBackstop(makeDb(), { profileId: PROFILE_ID, plan: 'plus', cycle: 'MONTHLY', paymentId: 'pay_X', attempt: 'att_X', source: 'webhook' })
    expect(r).toBe('already_applied')
    expect(asaasMocks.refundPayment).not.toHaveBeenCalled()
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
  })

  it('mesma tentativa, linha já PAID mas profile saiu do alvo depois → noop, NÃO re-aplica NEM estorna (I1/I3)', async () => {
    state.profileRow = { plan: 'starter', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_old', asaas_customer_id: 'cus_1', asaas_card_token: 'tok_1' }
    state.recoveryRow = { planchange_attempt_id: 'att_X', status: 'paid' }
    const r = await runPlanChangeBackstop(makeDb(), { profileId: PROFILE_ID, plan: 'plus', cycle: 'MONTHLY', paymentId: 'pay_1', attempt: 'att_X', source: 'webhook' })
    expect(r).toBe('already_applied')
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
    expect(asaasMocks.refundPayment).not.toHaveBeenCalled()
  })

  it('avulso da tentativa ATUAL (attempt casa, in-flight) → executa o switch', async () => {
    state.profileRow = { plan: 'starter', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_old', asaas_customer_id: 'cus_1', asaas_card_token: 'tok_1' }
    state.recoveryRow = { planchange_attempt_id: 'att_X', status: 'recovering' }
    const r = await runPlanChangeBackstop(makeDb(), { profileId: PROFILE_ID, plan: 'plus', cycle: 'MONTHLY', paymentId: 'pay_1', attempt: 'att_X', source: 'webhook' })
    expect(r).toBe('switched')
    expect(asaasMocks.createSubscriptionWithToken).toHaveBeenCalled()
  })

  it('avulso LEGADO (sem attempt) sobre linha de tentativa NOVA (com attempt) → SUPERSEDED + estorna (I1)', async () => {
    state.profileRow = { plan: 'starter', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_old', asaas_customer_id: 'cus_1', asaas_card_token: 'tok_1' }
    state.recoveryRow = { planchange_attempt_id: 'att_B', status: 'recovering', plan: 'plus', cycle: 'MONTHLY' }
    const r = await runPlanChangeBackstop(makeDb(), { profileId: PROFILE_ID, plan: 'plus', cycle: 'MONTHLY', paymentId: 'pay_legado', source: 'webhook' })
    expect(r).toBe('superseded')
    expect(asaasMocks.refundPayment).toHaveBeenCalled()
  })

  it('avulso LEGADO (sem attempt) sobre linha TAMBÉM legada (sem attempt), mesmo alvo → aplica', async () => {
    state.profileRow = { plan: 'starter', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_old', asaas_customer_id: 'cus_1', asaas_card_token: 'tok_1' }
    state.recoveryRow = { planchange_attempt_id: null, status: 'recovering', plan: 'plus', cycle: 'MONTHLY' }
    const r = await runPlanChangeBackstop(makeDb(), { profileId: PROFILE_ID, plan: 'plus', cycle: 'MONTHLY', paymentId: 'pay_legado', source: 'webhook' })
    expect(r).toBe('switched')
  })
})

describe('helpers', () => {
  it('fullPriceOf devolve o preço cheio por ciclo', () => {
    expect(fullPriceOf('plus', 'MONTHLY')).toBe(127)
    expect(fullPriceOf('plus', 'YEARLY')).toBe(1164)
    expect(fullPriceOf('free' as never, 'MONTHLY')).toBe(0)
  })

  it('nextDueDateAfterFullCycle: +30 dias (mensal) / +365 (anual), formato YYYY-MM-DD', () => {
    const from = new Date('2026-06-10T12:00:00Z')
    expect(nextDueDateAfterFullCycle('MONTHLY', from)).toBe('2026-07-10')
    expect(nextDueDateAfterFullCycle('YEARLY', from)).toBe('2027-06-10')
  })
})
