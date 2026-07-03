/**
 * Testes dos helpers de lib/asaas do FALLBACK DE CARTÃO MORTO (2026-07-03):
 * createDetachedCheckout, getPaymentWithCard e findPaymentByCheckoutSession.
 * Mocka o fetch global (asaasFetch usa fetch por baixo), padrão de asaas-payment-lookup.test.ts.
 *
 * Foco de dinheiro: 🛡️ P0-b — o filtro CLIENT-SIDE por checkoutSession é obrigatório. Se a API
 * um dia ignorar o query param e devolver a listagem geral da conta, o cron NUNCA pode casar
 * pagamento de outro cliente (o backstop estornaria uma renovação legítima).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDetachedCheckout, getPaymentWithCard, findPaymentByCheckoutSession } from './asaas'

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** Extrai URL e body JSON da única chamada feita ao fetch stubado (body {} em GET). */
function firstCall(fn: ReturnType<typeof vi.fn>): { url: string; body: Record<string, unknown> } {
  const [url, init] = fn.mock.calls[0] as [string, RequestInit | undefined]
  return { url, body: init?.body ? JSON.parse(String(init.body)) : {} }
}

beforeEach(() => {
  process.env.ASAAS_API_KEY = 'test-key'
  process.env.ASAAS_ENVIRONMENT = 'sandbox'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createDetachedCheckout (sessão de pagamento único do fallback)', () => {
  const baseParams = {
    customerId: 'cus_1',
    value: 78,
    name: 'Diferença de plano',
    description: 'EidosForm — diferença prorateada Starter→Plus',
    successUrl: 'https://app.test/billing?checkout=success',
    cancelUrl: 'https://app.test/billing?checkout=cancelled',
    expiredUrl: 'https://app.test/billing?checkout=expired',
  }

  it('payload DETACHED validado no smoke 2026-07-03: sem bloco subscription, item único, callback, expiração default 60', async () => {
    const fn = stubFetch(200, { id: 'chk_1', status: 'ACTIVE', link: 'https://sandbox.asaas.com/checkoutSession/show/chk_1' })
    const r = await createDetachedCheckout(baseParams)

    const { url, body } = firstCall(fn)
    expect(url).toMatch(/\/checkouts$/)
    expect(body.customer).toBe('cus_1')
    expect(body.billingTypes).toEqual(['CREDIT_CARD'])
    expect(body.chargeTypes).toEqual(['DETACHED'])
    // DETACHED NÃO tem bloco subscription — misturar com o createCheckout convidaria regressão na 1ª compra
    expect(body).not.toHaveProperty('subscription')
    expect(body.items).toEqual([{ name: 'Diferença de plano', description: baseParams.description, quantity: 1, value: 78 }])
    expect(body.callback).toEqual({
      successUrl: baseParams.successUrl,
      cancelUrl: baseParams.cancelUrl,
      expiredUrl: baseParams.expiredUrl,
    })
    expect(body.minutesToExpire).toBe(60)

    // Retorno espelha o createCheckout: URL montada a partir do id (não do campo link da resposta)
    expect(r).toEqual({ id: 'chk_1', url: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_1' })
  })

  it('params opcionais: name truncado a 30 chars (limite de item do Asaas), minutesToExpire e externalReference repassados', async () => {
    const fn = stubFetch(200, { id: 'chk_2', status: 'ACTIVE' })
    await createDetachedCheckout({
      ...baseParams,
      name: 'X'.repeat(40),
      minutesToExpire: 30,
      externalReference: 'profile:p|kind:planchange',
    })
    const { body } = firstCall(fn)
    expect((body.items as Array<{ name: string }>)[0].name).toHaveLength(30)
    expect(body.minutesToExpire).toBe(30)
    expect(body.externalReference).toBe('profile:p|kind:planchange')
  })
})

describe('getPaymentWithCard (GET fresco do backstop)', () => {
  it('avulso DETACHED pago devolve token e checkoutSession (gate 2 verde — smoke 2026-07-03)', async () => {
    stubFetch(200, {
      id: 'pay_1',
      status: 'CONFIRMED',
      value: 78,
      customer: 'cus_1',
      checkoutSession: 'chk_1',
      creditCard: { creditCardToken: 'tok_novo' },
    })
    const r = await getPaymentWithCard('pay_1')
    expect(r.ok).toBe(true)
    expect(r.payment).toEqual({
      id: 'pay_1',
      status: 'CONFIRMED',
      value: 78,
      customer: 'cus_1',
      checkoutSession: 'chk_1',
      creditCardToken: 'tok_novo',
    })
  })

  it('payment comum (sem creditCard nem checkoutSession) → campos null, sem lançar', async () => {
    stubFetch(200, { id: 'pay_2', status: 'RECEIVED', value: 49, customer: 'cus_2' })
    const r = await getPaymentWithCard('pay_2')
    expect(r.ok).toBe(true)
    expect(r.payment?.checkoutSession).toBeNull()
    expect(r.payment?.creditCardToken).toBeNull()
  })

  it('404 → não existe (ok:true, payment:null) — mesma semântica do getPaymentById', async () => {
    stubFetch(404, { errors: [{ description: 'not found' }] })
    const r = await getPaymentWithCard('pay_x')
    expect(r.ok).toBe(true)
    expect(r.payment).toBeNull()
  })

  it('5xx → consulta FALHOU (ok:false) — o backstop NÃO deve agir', async () => {
    stubFetch(500, { errors: [] })
    const r = await getPaymentWithCard('pay_1')
    expect(r.ok).toBe(false)
    expect(r.payment).toBeNull()
  })
})

describe('findPaymentByCheckoutSession (backstop do cron)', () => {
  it('payment CONFIRMED da própria sessão → retornado (filtro na URL + validação local)', async () => {
    const fn = stubFetch(200, { data: [{ id: 'pay_1', status: 'CONFIRMED', checkoutSession: 'chk_1' }] })
    const r = await findPaymentByCheckoutSession('chk_1')
    expect(firstCall(fn).url).toContain('/payments?checkoutSession=chk_1&limit=10')
    expect(r.ok).toBe(true)
    expect(r.payment).toEqual({ id: 'pay_1', status: 'CONFIRMED' })
  })

  it('🛡️ P0-b (teste 21): API devolve payments com checkoutSession DIFERENTE do pedido (filtro ignorado) → lista vazia', async () => {
    // Simula o modo de falha catastrófico: a API ignora o query param e devolve a listagem geral
    // da conta (payments de outras sessões E payments comuns sem checkoutSession). Sem o filtro
    // client-side, o cron casaria pagamento de OUTRO cliente → estorno de renovação legítima.
    stubFetch(200, {
      data: [
        { id: 'pay_outra_sessao', status: 'CONFIRMED', checkoutSession: 'chk_OUTRA' },
        { id: 'pay_assinatura_comum', status: 'RECEIVED' }, // sem checkoutSession
      ],
    })
    const r = await findPaymentByCheckoutSession('chk_1')
    expect(r.ok).toBe(true)
    expect(r.payment).toBeNull()
  })

  it('id inexistente → lista vazia → payment:null (smoke 2026-07-03: totalCount 0)', async () => {
    stubFetch(200, { data: [], totalCount: 0 })
    const r = await findPaymentByCheckoutSession('chk_inexistente')
    expect(r.ok).toBe(true)
    expect(r.payment).toBeNull()
  })

  it('só REFUNDED da própria sessão → null (estornado não é utilizável)', async () => {
    stubFetch(200, { data: [{ id: 'pay_r', status: 'REFUNDED', checkoutSession: 'chk_1' }] })
    const r = await findPaymentByCheckoutSession('chk_1')
    expect(r.ok).toBe(true)
    expect(r.payment).toBeNull()
  })

  it('5xx → ok:false (fail-closed: o cron não age neste tick)', async () => {
    stubFetch(500, {})
    const r = await findPaymentByCheckoutSession('chk_1')
    expect(r.ok).toBe(false)
    expect(r.payment).toBeNull()
  })
})
