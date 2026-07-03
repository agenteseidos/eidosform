import { describe, it, expect, vi, beforeEach } from 'vitest'

// Contrato da abertura da sessão do FALLBACK DE CARTÃO MORTO (2026-07-03).
// Invariantes testadas (fail-closed em cada degrau):
//  - a linha de recuperação é gravada ANTES de criar a sessão no Asaas
//  - o session id é persistido ANTES de a URL ser devolvida (correlação nunca fica cega)
//  - upsert falhou → 500 SEM tocar no Asaas; criação falhou → linha cancelled + 502;
//    update do session id falhou → 503 SEM devolver a URL
//  - finalPrice <= 0 → 400 sem nenhuma chamada ao Asaas (guard defensivo)

const asaasMocks = vi.hoisted(() => ({
  createDetachedCheckout: vi.fn(async () => ({
    id: 'chk_sess_1',
    url: 'https://asaas.example/checkoutSession/show?id=chk_sess_1',
  })),
}))

vi.mock('@/lib/asaas', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/asaas')>()
  return { ...orig, ...asaasMocks }
})
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

import { openCardFallbackCheckout } from './card-fallback'

// ── Supabase fake configurável (padrão do plan-switch.test.ts) ───────────────
const state: {
  upsertError: unknown
  updateError: unknown
  // Cada chamada registra quantas vezes o Asaas já tinha sido chamado — prova de ORDEM.
  calls: Array<{ table: string; op: string; payload?: unknown; asaasCallsBefore: number }>
} = { upsertError: null, updateError: null, calls: [] }

function makeDb() {
  return {
    from(table: string) {
      const b: Record<string, unknown> & { _op?: string; _payload?: unknown } = {}
      b.upsert = (p: unknown) => {
        state.calls.push({ table, op: 'upsert', payload: p, asaasCallsBefore: asaasMocks.createDetachedCheckout.mock.calls.length })
        return Promise.resolve({ error: state.upsertError })
      }
      b.update = (p: unknown) => { b._op = 'update'; b._payload = p; return b }
      b.eq = () => {
        state.calls.push({ table, op: b._op ?? 'eq', payload: b._payload, asaasCallsBefore: asaasMocks.createDetachedCheckout.mock.calls.length })
        return Promise.resolve({ error: state.updateError })
      }
      return b
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient
}

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'

const baseParams = {
  profileId: PROFILE_ID,
  customerId: 'cus_1',
  currentSubscriptionId: 'sub_old',
  plan: 'plus' as const,
  cycle: 'MONTHLY' as const,
  attemptId: 'att_1',
  proration: { credit: 24.5, originalPrice: 127, finalPrice: 102.5 },
  origin: 'https://eidosform.com.br',
  reason: 'CHARGE_FAILED' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  state.upsertError = null
  state.updateError = null
  state.calls = []
})

describe('openCardFallbackCheckout', () => {
  it('happy path: upsert ANTES da sessão, session id persistido ANTES do retorno, resposta com URL', async () => {
    const r = await openCardFallbackCheckout(makeDb(), baseParams)
    expect(r).toEqual({ ok: true, checkoutId: 'chk_sess_1', checkoutUrl: 'https://asaas.example/checkoutSession/show?id=chk_sess_1' })

    // ORDEM: a linha de recuperação foi gravada com o Asaas ainda em 0 chamadas.
    const upsert = state.calls.find((c) => c.op === 'upsert')
    expect(upsert).toBeTruthy()
    expect(upsert!.asaasCallsBefore).toBe(0)

    // Conteúdo da linha: pending + plan_switch_fallback, sub/payment/session NULL (≠ fluxo token).
    const row = upsert!.payload as Record<string, unknown>
    expect(row.checkout_id).toBe(`planchange-pay-${PROFILE_ID}`)
    expect(row.status).toBe('pending')
    expect(row.payment_method).toBe('plan_switch_fallback')
    expect(row.planchange_attempt_id).toBe('att_1')
    expect(row.asaas_subscription_id).toBeNull()
    expect(row.asaas_payment_id).toBeNull()
    expect(row.asaas_checkout_session_id).toBeNull()
    expect(row.last_event).toBe('CARD_FALLBACK_PENDING')
    expect(row.original_price).toBe(127)
    expect(row.proration_credit).toBe(24.5)
    expect(row.final_price).toBe(102.5)

    // Sessão criada com o valor da DIFERENÇA e callbacks do origin validado.
    const sess = (asaasMocks.createDetachedCheckout.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]
    expect(sess.customerId).toBe('cus_1')
    expect(sess.value).toBe(102.5)
    expect(sess.successUrl).toBe('https://eidosform.com.br/billing?checkout=success')
    expect(sess.cancelUrl).toBe('https://eidosform.com.br/billing?checkout=cancelled')
    expect(sess.expiredUrl).toBe('https://eidosform.com.br/billing?checkout=expired')

    // Session id persistido (update DEPOIS de criar a sessão, ANTES do retorno).
    const sessUpdate = state.calls.find((c) => c.op === 'update' && (c.payload as Record<string, unknown>)?.asaas_checkout_session_id === 'chk_sess_1')
    expect(sessUpdate).toBeTruthy()
    expect(sessUpdate!.asaasCallsBefore).toBe(1)
    expect((sessUpdate!.payload as Record<string, unknown>).last_event).toBe('CARD_FALLBACK_CHECKOUT_CREATED')
  })

  it('finalPrice <= 0 → 400, NENHUMA chamada ao Asaas nem ao banco (guard defensivo)', async () => {
    const r = await openCardFallbackCheckout(makeDb(), { ...baseParams, proration: { credit: 127, originalPrice: 127, finalPrice: 0 } })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.code).toBe('CARD_FALLBACK_INVALID_VALUE')
    }
    expect(asaasMocks.createDetachedCheckout).not.toHaveBeenCalled()
    expect(state.calls).toHaveLength(0)
  })

  it('upsert da linha falhou → 500 e createDetachedCheckout NÃO chamado (fail-closed)', async () => {
    state.upsertError = { message: 'db down' }
    const r = await openCardFallbackCheckout(makeDb(), baseParams)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(500)
      expect(r.code).toBe('CARD_FALLBACK_ROW_FAILED')
    }
    expect(asaasMocks.createDetachedCheckout).not.toHaveBeenCalled()
  })

  it('createDetachedCheckout lançou → linha cancelled CARD_FALLBACK_CREATE_FAILED + 502', async () => {
    asaasMocks.createDetachedCheckout.mockRejectedValueOnce(new Error('asaas 500'))
    const r = await openCardFallbackCheckout(makeDb(), baseParams)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(502)
      expect(r.code).toBe('CARD_FALLBACK_CREATE_FAILED')
    }
    const cancel = state.calls.find((c) => c.op === 'update')
    expect(cancel).toBeTruthy()
    expect(cancel!.payload).toEqual({ status: 'cancelled', last_event: 'CARD_FALLBACK_CREATE_FAILED' })
  })

  it('update do session id falhou → 503 e a URL NÃO é retornada (correlação nunca fica cega)', async () => {
    state.updateError = { message: 'db down' }
    const r = await openCardFallbackCheckout(makeDb(), baseParams)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(503)
      expect(r.code).toBe('CARD_FALLBACK_SESSION_SAVE_FAILED')
      expect('checkoutUrl' in r).toBe(false)
    }
    // A sessão FOI criada (órfã, expira sozinha) — mas nada dela vazou pro chamador.
    expect(asaasMocks.createDetachedCheckout).toHaveBeenCalledTimes(1)
  })
})
