/**
 * lib/billing-activation.card-align.test.ts — (4a-align, D-01 13/08/2026)
 * INVARIANTE: a assinatura cobra o cartão que pagou por ÚLTIMO.
 *
 * Cenário-alvo: cartão da sub morreu → cobrança OVERDUE → régua D-01 → cliente paga a
 * fatura com cartão NOVO na página do gateway. O gateway NÃO propaga o cartão novo para
 * a assinatura (endpoint próprio PUT /subscriptions/{id}/creditCard existe exatamente por
 * isso) — sem o alinhamento, o ciclo seguinte cobraria o cartão MORTO e a régua
 * dispararia todo mês.
 *
 * Casos:
 *  (a) cartão novo pagou → PUT chamado + asaas_card_token gravado com o token NOVO
 *  (b) renovação normal (mesmo cartão) → PUT NÃO chamado (idempotência natural)
 *  (c) Pix/boleto (sem token no payment) → PUT NÃO chamado
 *  (d) PUT falha → ativação NÃO quebra + ALERTA ops + token gravado segue o da SUB
 *      (o estado real: o alinhamento falhou, a sub ainda cobra o cartão antigo)
 *  (e) sub SEM cartão + payment com token → alinha (cobre sub órfã de cartão)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// @/lib/asaas: PLAN_PRICES e extractCardToken REAIS (o extract é o leitor do cenário);
// rede toda stubada.
vi.mock('@/lib/asaas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asaas')>()
  return {
    ...actual,
    getSubscription: vi.fn(),
    cancelSubscription: vi.fn(async () => ({ deleted: true })),
    reconcileActiveSubscriptions: vi.fn(async () => ({ kept: 'sub_new', cancelled: [], ambiguous: [] })),
    updateSubscription: vi.fn(async () => ({ ok: true })),
    updateSubscriptionCreditCard: vi.fn(async () => ({ id: 'sub_new' })),
  }
})
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))
vi.mock('@/lib/plan-limits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plan-limits')>()
  return { ...actual, handleUpgrade: vi.fn(async () => ({ unpausedCount: 0 })) }
})
vi.mock('@/lib/resend', () => ({ sendBillingOpsAlert: vi.fn(async () => ({})) }))

import { finalizeActivation } from './billing-activation'
import { getSubscription, updateSubscriptionCreditCard } from '@/lib/asaas'
import { sendBillingOpsAlert } from '@/lib/resend'

const USER = '33333333-3333-4333-8333-333333333333'
const SUB = 'sub_new'
const TOKEN_SUB = 'tok_cartao_antigo'
const TOKEN_PAGO = 'tok_cartao_novo'

// Fake Supabase que CAPTURA os payloads dos updates em `profiles` (mesmo desenho do
// teste de basis).
type Upd = Record<string, unknown>
function makeDb(profileUpdates: Upd[]) {
  return {
    from(table: string) {
      const b: Record<string, unknown> & { _op: string; _payload?: unknown } = { _op: 'select' }
      const chain = () => b
      b.select = chain; b.eq = chain; b.is = chain
      b.single = () => b
      b.update = (p: unknown) => { b._op = 'update'; b._payload = p; return b }
      b.then = (resolve: (r: unknown) => unknown) => {
        let res: unknown = { data: null, error: null }
        if (table === 'profiles' && b._op === 'select') {
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

/** O update que grava o token (o único payload com asaas_card_token). */
function tokenUpdate(updates: Upd[]): Upd | undefined {
  return updates.find((u) => 'asaas_card_token' in u)
}

function subComCartao(token: string | null) {
  // starter mensal R$49 = preço cheio (não dispara correção de valor recorrente)
  return { value: 49.0, nextDueDate: '2026-09-13', ...(token ? { creditCard: { creditCardToken: token } } : {}) }
}

async function finalize(db: import('@supabase/supabase-js').SupabaseClient, paymentCardToken: string | null | undefined) {
  return finalizeActivation({
    db, userId: USER, customerId: 'cus_1', newSubscriptionId: SUB,
    plan: 'starter', cycle: 'MONTHLY', source: 'webhook',
    paymentDueDate: '2026-08-13', paymentCardToken,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-13T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('finalizeActivation (4a-align) — a sub cobra o cartão que pagou por último', () => {
  it('(a) cartão NOVO pagou a fatura → sub alinhada + token NOVO gravado no profile', async () => {
    vi.mocked(getSubscription).mockResolvedValue(subComCartao(TOKEN_SUB) as never)
    const updates: Upd[] = []
    await finalize(makeDb(updates), TOKEN_PAGO)
    expect(updateSubscriptionCreditCard).toHaveBeenCalledExactlyOnceWith(SUB, TOKEN_PAGO)
    // O plan-switch recria subs por profiles.asaas_card_token — tem de ser o cartão NOVO.
    expect(tokenUpdate(updates)?.asaas_card_token).toBe(TOKEN_PAGO)
  })

  it('(b) renovação normal (mesmo cartão) → NÃO chama o PUT (idempotência natural)', async () => {
    vi.mocked(getSubscription).mockResolvedValue(subComCartao(TOKEN_SUB) as never)
    const updates: Upd[] = []
    await finalize(makeDb(updates), TOKEN_SUB)
    expect(updateSubscriptionCreditCard).not.toHaveBeenCalled()
    expect(tokenUpdate(updates)?.asaas_card_token).toBe(TOKEN_SUB)
  })

  it('(c) Pix/boleto (payment sem cartão) → NÃO chama o PUT, captura atual preservada', async () => {
    vi.mocked(getSubscription).mockResolvedValue(subComCartao(TOKEN_SUB) as never)
    const updates: Upd[] = []
    await finalize(makeDb(updates), null)
    expect(updateSubscriptionCreditCard).not.toHaveBeenCalled()
    expect(tokenUpdate(updates)?.asaas_card_token).toBe(TOKEN_SUB)
  })

  it('(d) PUT falha → ativação NÃO quebra, ALERTA ops sai, token gravado = o da SUB (estado real)', async () => {
    vi.mocked(getSubscription).mockResolvedValue(subComCartao(TOKEN_SUB) as never)
    vi.mocked(updateSubscriptionCreditCard).mockRejectedValueOnce(new Error('asaas 500'))
    const updates: Upd[] = []
    const fin = await finalize(makeDb(updates), TOKEN_PAGO)
    expect(fin.skipped).toBeFalsy() // o finalize seguiu — alinhamento nunca bloqueia ativação
    expect(sendBillingOpsAlert).toHaveBeenCalledOnce()
    // Falhou o alinhamento → a sub AINDA cobra o antigo; gravar o novo mentiria pro plan-switch.
    expect(tokenUpdate(updates)?.asaas_card_token).toBe(TOKEN_SUB)
  })

  it('(e) sub SEM cartão + payment com token → alinha e grava o novo', async () => {
    vi.mocked(getSubscription).mockResolvedValue(subComCartao(null) as never)
    const updates: Upd[] = []
    await finalize(makeDb(updates), TOKEN_PAGO)
    expect(updateSubscriptionCreditCard).toHaveBeenCalledExactlyOnceWith(SUB, TOKEN_PAGO)
    expect(tokenUpdate(updates)?.asaas_card_token).toBe(TOKEN_PAGO)
  })
})
