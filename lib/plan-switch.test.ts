import { describe, it, expect, vi, beforeEach } from 'vitest'

// Contrato do executor do redesenho (2026-06-10): cancelar+recriar via token.
// Invariantes testadas:
//  - sub nova é criada SEMPRE no preço CHEIO (nunca prorateado)
//  - CAS pré-voo: profile mudou → aborta SEM tocar no Asaas
//  - CAS de commit: perdeu a corrida → cancela a sub recém-criada (sem cobrança fantasma)
//  - sucesso: profile trocado, reconcile mantém SÓ a nova, checkout 'paid' gravado
//  - backstop: idempotente (já aplicado → noop), sem token → throw (ação manual)
//
// runCardFallbackBackstop (fallback de cartão morto, 2026-07-03) — invariantes de dinheiro:
//  - 🛡️ (P0) identidade FORTE (customer + sessão): customer/sessão divergente NUNCA auto-estorna
//    (alerta + throw → DLQ manual) — o dinheiro de outra origem jamais é estornado às cegas.
//  - 🛡️ (P1-A) o token do cartão NOVO só entra no profile DEPOIS do executePlanSwitch ok; switch
//    falhou → throw com asaas_card_token INTOCADO (anti cobrança dupla no retry do usuário).
//  - 🛡️ (P1-C) status da linha fora de {pending,paid,cancelled} = terminal fail-closed → estorno.
//  - 🛡️ (P2) final_price null/NaN → alerta + throw (NUNCA estorno por coerção NUMERIC ruim).
//  - anti-desconto-eterno: a sub nova nasce em fullPriceOf(plan,cycle), nunca no valor do avulso.

const asaasMocks = vi.hoisted(() => ({
  createSubscriptionWithToken: vi.fn(async () => ({ id: 'sub_new' })),
  cancelSubscription: vi.fn(async () => ({ deleted: true, id: 'sub_new' })),
  reconcileActiveSubscriptions: vi.fn(async () => ({ kept: 'sub_new', cancelled: ['sub_old'], ambiguous: [] })),
  getPaymentById: vi.fn(async () => ({ ok: true, payment: { id: 'pay_x', status: 'CONFIRMED' } })),
  getPaymentWithCard: vi.fn(async () => ({ ok: true, payment: { id: 'pay_1', status: 'CONFIRMED', value: 102.5, customer: 'cus_1', checkoutSession: 'sess_1', creditCardToken: 'tok_NEW' } })),
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

import { executePlanSwitch, runPlanChangeBackstop, runCardFallbackBackstop, fullPriceOf, nextDueDateAfterFullCycle } from './plan-switch'
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

// ── Commit B (2026-07-03): a sub NOVA criada por nós grava proration_basis_days ──
// Regra: sub criada por executePlanSwitch = 1 preço-cheio cobre UM ciclo NOMINAL →
//  (2) upgrade_paid / (3) credit_covered p/ plano ≠ → 30 (MONTHLY) / 365 (YEARLY) [default]
//  (4) reativação MESMO plano+ciclo → base VIGENTE preservada (o chamador passa a base real)
// NUNCA coverageDays (armadilha do divisor: Pro→Starter 158d perderia R$208).
describe('executePlanSwitch — proration_basis_days na sub NOVA', () => {
  const profileUpdate = () =>
    state.calls.find(c => c.table === 'profiles' && c.op === 'update' && !!(c.payload as { plan?: string })?.plan)?.payload as
      Record<string, unknown> | undefined

  it('(2/3) MONTHLY sem base explícita (upgrade_paid/credit_covered p/ plano ≠) → grava 30', async () => {
    const r = await executePlanSwitch({ db: makeDb(), ...baseParams })
    expect(r.ok).toBe(true)
    expect(profileUpdate()!.proration_basis_days).toBe(30)
  })

  it('(2/3) YEARLY sem base explícita → grava 365', async () => {
    const r = await executePlanSwitch({ db: makeDb(), ...baseParams, cycle: 'YEARLY', nextDueDate: '2027-07-10' })
    expect(r.ok).toBe(true)
    expect(profileUpdate()!.proration_basis_days).toBe(365)
  })

  it('(4) reativação MESMO plano+ciclo: base VIGENTE preservada (78) → grava 78, NUNCA 30', async () => {
    state.profileRow = { asaas_subscription_id: null }
    const r = await executePlanSwitch({ db: makeDb(), ...baseParams, expectedOldSubscriptionId: null, reason: 'reactivate', prorationBasisDays: 78 })
    expect(r.ok).toBe(true)
    expect(profileUpdate()!.proration_basis_days).toBe(78)
  })

  it('base explícita null (legado) → grava null (read cai no fallback 30/365 com log)', async () => {
    const r = await executePlanSwitch({ db: makeDb(), ...baseParams, prorationBasisDays: null })
    expect(r.ok).toBe(true)
    expect(profileUpdate()!.proration_basis_days).toBeNull()
  })

  it('base explícita 0/negativa NÃO vira default: passa o valor (o read valida ≥1 e loga)', async () => {
    // undefined → default; 0 é um valor EXPLÍCITO → grava 0 (o resolveBasisDays do read trata).
    const r = await executePlanSwitch({ db: makeDb(), ...baseParams, prorationBasisDays: 0 })
    expect(r.ok).toBe(true)
    expect(profileUpdate()!.proration_basis_days).toBe(0)
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

describe('runCardFallbackBackstop (fallback de cartão morto)', () => {
  const SESSION = 'sess_1'
  // Linha de recuperação do fallback (billing_checkouts) e profile fora do alvo (starter→plus).
  function fallbackRow(over: Record<string, unknown> = {}) {
    return {
      profile_id: PROFILE_ID,
      checkout_id: `planchange-pay-${PROFILE_ID}`,
      status: 'pending',
      plan: 'plus',
      cycle: 'MONTHLY',
      payment_method: 'plan_switch_fallback',
      asaas_customer_id: 'cus_1',
      asaas_checkout_session_id: SESSION,
      asaas_payment_id: null,
      final_price: 102.5,
      ...over,
    }
  }
  function profileOffTarget(over: Record<string, unknown> = {}) {
    return { id: PROFILE_ID, plan: 'starter', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_old', asaas_customer_id: 'cus_1', asaas_card_token: 'tok_dead', ...over }
  }
  function pay(over: Record<string, unknown> = {}) {
    return { ok: true, payment: { id: 'pay_1', status: 'CONFIRMED', value: 102.5, customer: 'cus_1', checkoutSession: SESSION, creditCardToken: 'tok_NEW', ...over } }
  }
  const call = (over: Record<string, unknown> = {}) =>
    runCardFallbackBackstop(makeDb(), { customerId: 'cus_1', paymentId: 'pay_1', checkoutSessionId: SESSION, source: 'webhook', ...over })

  beforeEach(() => {
    state.profileRow = profileOffTarget()
    state.recoveryRow = fallbackRow()
    state.updateRows = [{ id: PROFILE_ID }]
    asaasMocks.getPaymentWithCard.mockResolvedValue(pay() as never)
  })

  // Teste 6 — happy path por session id + 🛡️ P1-A (token salvo SÓ depois do switch).
  it('happy: paga → sub NOVA no preço cheio via token NOVO, token salvo SÓ após o switch, linha paid', async () => {
    const r = await call()
    expect(r).toBe('switched')
    const args = (asaasMocks.createSubscriptionWithToken.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]
    expect(args.value).toBe(127)            // cheio (fullPriceOf plus/mensal), NÃO 102.5
    expect(args.creditCardToken).toBe('tok_NEW')
    expect(asaasMocks.refundPayment).not.toHaveBeenCalled()
    // 🛡️ P1-A: o UPDATE do token no profile vem DEPOIS do CAS-commit da troca (que carrega `plan`).
    const idxCommit = state.calls.findIndex(c => c.table === 'profiles' && c.op === 'update' && !!(c.payload as { plan?: string })?.plan)
    const idxToken = state.calls.findIndex(c => c.table === 'profiles' && c.op === 'update' && !!(c.payload as { asaas_card_token?: string })?.asaas_card_token)
    expect(idxCommit).toBeGreaterThanOrEqual(0)
    expect(idxToken).toBeGreaterThan(idxCommit)
    const paidRow = state.calls.find(c => c.table === 'billing_checkouts' && c.op === 'update' && (c.payload as { status?: string })?.status === 'paid')
    expect((paidRow!.payload as { last_event: string }).last_event).toMatch(/CARD_FALLBACK_PAID/)
  })

  // Teste 7 — correlação por CUSTOMER (payment sem checkoutSession).
  it('match por customer (payment sem checkoutSession) → conclui a troca', async () => {
    asaasMocks.getPaymentWithCard.mockResolvedValue(pay({ checkoutSession: null }) as never)
    const r = await call({ checkoutSessionId: null })
    expect(r).toBe('switched')
    expect(asaasMocks.createSubscriptionWithToken).toHaveBeenCalled()
    expect(asaasMocks.refundPayment).not.toHaveBeenCalled()
  })

  // Teste 8 — sem linha do fallback → no_match, NADA tocado.
  it('linha não é do fallback (payment_method ≠ plan_switch_fallback) → no_match, sem lock/estorno/switch', async () => {
    state.recoveryRow = fallbackRow({ payment_method: 'plan_switch_token' })
    const r = await call()
    expect(r).toBe('no_match')
    expect(vi.mocked(acquireLock)).not.toHaveBeenCalled()
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
    expect(asaasMocks.refundPayment).not.toHaveBeenCalled()
  })

  // Teste 9 — valor divergente (identidade forte) → estorna, sem aplicar.
  it('valor divergente (identidade forte) → estorno + linha cancelled + alerta, SEM executePlanSwitch', async () => {
    asaasMocks.getPaymentWithCard.mockResolvedValue(pay({ value: 200 }) as never)
    const r = await call()
    expect(r).toBe('refunded_value_mismatch')
    expect(asaasMocks.refundPayment).toHaveBeenCalled()
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
    const cancelled = state.calls.find(c => c.table === 'billing_checkouts' && c.op === 'update' && (c.payload as { status?: string })?.status === 'cancelled')
    expect((cancelled!.payload as { last_event: string }).last_event).toMatch(/CARD_FALLBACK_VALUE_MISMATCH/)
    const { sendBillingOpsAlert } = await import('@/lib/resend')
    expect(vi.mocked(sendBillingOpsAlert)).toHaveBeenCalled()
  })

  // Teste 10 — 🛡️ P0: CUSTOMER divergente → NUNCA estorna.
  it('🛡️ P0: customer divergente → NENHUM estorno, alerta + throw (DLQ manual)', async () => {
    asaasMocks.getPaymentWithCard.mockResolvedValue(pay({ customer: 'cus_OUTRO' }) as never)
    await expect(call()).rejects.toThrow(/CUSTOMER_MISMATCH/)
    expect(asaasMocks.refundPayment).not.toHaveBeenCalled()
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
    const { sendBillingOpsAlert } = await import('@/lib/resend')
    expect(vi.mocked(sendBillingOpsAlert)).toHaveBeenCalled()
  })

  // Teste 11 — 🛡️ P0: SESSÃO divergente → nem aplica nem estorna.
  it('🛡️ P0: payment.checkoutSession presente e ≠ linha → NEM aplica NEM estorna, alerta + throw', async () => {
    asaasMocks.getPaymentWithCard.mockResolvedValue(pay({ checkoutSession: 'sess_OUTRA' }) as never)
    await expect(call()).rejects.toThrow(/SESSION_MISMATCH/)
    expect(asaasMocks.refundPayment).not.toHaveBeenCalled()
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
    const { sendBillingOpsAlert } = await import('@/lib/resend')
    expect(vi.mocked(sendBillingOpsAlert)).toHaveBeenCalled()
  })

  // Teste 12 — linha paid: mesmo payment → already_applied (sem estorno); OUTRO payment → refunded_duplicate.
  it('linha paid com o MESMO payment → already_applied (sem estorno)', async () => {
    state.recoveryRow = fallbackRow({ status: 'paid', asaas_payment_id: 'pay_1' })
    const r = await call()
    expect(r).toBe('already_applied')
    expect(asaasMocks.refundPayment).not.toHaveBeenCalled()
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
  })

  it('linha paid com OUTRO payment (mesma sessão) → refunded_duplicate (estorna ESTE)', async () => {
    state.recoveryRow = fallbackRow({ status: 'paid', asaas_payment_id: 'pay_ANTIGO' })
    const r = await call()
    expect(r).toBe('refunded_duplicate')
    expect(asaasMocks.refundPayment).toHaveBeenCalled()
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
  })

  // Teste 13 — linha cancelled (expirada/abandonada) → refunded_superseded.
  it('linha cancelled (tentativa expirada) → refunded_superseded', async () => {
    state.recoveryRow = fallbackRow({ status: 'cancelled' })
    const r = await call()
    expect(r).toBe('refunded_superseded')
    expect(asaasMocks.refundPayment).toHaveBeenCalled()
  })

  // Teste 14 — 🛡️ P1-C: status fora do conjunto (overdue) → terminal fail-closed.
  it('🛡️ P1-C: linha status "overdue" (fora de {pending,paid,cancelled}) → terminal fail-closed → estorno + alerta', async () => {
    state.recoveryRow = fallbackRow({ status: 'overdue' })
    const r = await call()
    expect(r).toBe('refunded_superseded')
    expect(asaasMocks.refundPayment).toHaveBeenCalled()
    const { sendBillingOpsAlert } = await import('@/lib/resend')
    expect(vi.mocked(sendBillingOpsAlert)).toHaveBeenCalled()
  })

  // Teste 15 — payment REFUNDED → externally_refunded, sem switch.
  it('payment REFUNDED → externally_refunded, linha cancelled, SEM switch e SEM re-estorno', async () => {
    asaasMocks.getPaymentWithCard.mockResolvedValue(pay({ status: 'REFUNDED' }) as never)
    const r = await call()
    expect(r).toBe('externally_refunded')
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
    expect(asaasMocks.refundPayment).not.toHaveBeenCalled()
  })

  // Teste 16 — token ausente no payment → alerta + throw, profile intocado.
  it('token ausente no avulso pago → alerta + throw (DLQ), asaas_card_token INTOCADO', async () => {
    asaasMocks.getPaymentWithCard.mockResolvedValue(pay({ creditCardToken: null }) as never)
    await expect(call()).rejects.toThrow(/SEM creditCardToken/)
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
    const tokenSave = state.calls.find(c => c.table === 'profiles' && c.op === 'update' && !!(c.payload as { asaas_card_token?: string })?.asaas_card_token)
    expect(tokenSave).toBeUndefined()
  })

  // Teste 17 — 🛡️ P1-A: executePlanSwitch !ok → throw E token INTOCADO (anti cobrança dupla no retry).
  it('🛡️ P1-A: executePlanSwitch falha → throw E asaas_card_token NÃO é salvo (retry não recobra)', async () => {
    asaasMocks.createSubscriptionWithToken.mockRejectedValueOnce(new Error('asaas down'))
    await expect(call()).rejects.toThrow(/executePlanSwitch falhou/)
    const tokenSave = state.calls.find(c => c.table === 'profiles' && c.op === 'update' && !!(c.payload as { asaas_card_token?: string })?.asaas_card_token)
    expect(tokenSave).toBeUndefined()
    const paidRow = state.calls.find(c => c.table === 'billing_checkouts' && c.op === 'update' && (c.payload as { status?: string })?.status === 'paid')
    expect(paidRow).toBeUndefined()
  })

  // Teste 18 — 🛡️ P2: final_price null → alerta + throw (manual), sem estorno.
  it('🛡️ P2: final_price null → alerta + throw (manual), refundPayment NÃO chamado', async () => {
    state.recoveryRow = fallbackRow({ final_price: null })
    await expect(call()).rejects.toThrow(/final_price nulo\/NaN/)
    expect(asaasMocks.refundPayment).not.toHaveBeenCalled()
    expect(asaasMocks.createSubscriptionWithToken).not.toHaveBeenCalled()
  })

  // Teste 19 — lock ocupado → throw (retry via cron/reprocess).
  it('lock ocupado → throw p/ retry', async () => {
    vi.mocked(acquireLock).mockResolvedValueOnce(false)
    await expect(call()).rejects.toThrow(/lock ocupado/)
  })

  // Teste 20 — invariante anti-desconto-eterno: sub nova SEMPRE no fullPriceOf, nunca no valor do avulso.
  it('anti-desconto-eterno: createSubscriptionWithToken recebe fullPriceOf(plan,cycle), nunca o valor do avulso', async () => {
    state.recoveryRow = fallbackRow({ final_price: 50 })
    asaasMocks.getPaymentWithCard.mockResolvedValue(pay({ value: 50 }) as never)
    const r = await call()
    expect(r).toBe('switched')
    const args = (asaasMocks.createSubscriptionWithToken.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]
    expect(args.value).toBe(127) // fullPriceOf('plus','MONTHLY')
    expect(args.value).not.toBe(50)
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
