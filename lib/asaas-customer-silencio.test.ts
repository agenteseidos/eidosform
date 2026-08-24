import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * TODO customer do EidosForm nasce (e é reusado) com `notificationDisabled: true`.
 *
 * O que isto tranca (parecer independente + auditoria de 24/08/2026): o Asaas cria notificações
 * PRÓPRIAS de vencimento/atraso para o cliente por padrão — e-mail e SMS com a cara DELES e a
 * página de fatura DELES (que oferece débito). Nossa comunicação de cobrança é a régua D-01; o
 * canal paralelo do Asaas duplica tudo sem nossa marca e fura o funil. A auditoria achou o
 * customer real do Sidney com as notificações LIGADAS durante o teste da régua: o desligamento
 * por lote (`disableCustomerNotifications`) é não-bloqueante e não cobre quem não repassa pelo
 * checkout. O interruptor de RAIZ é o campo do customer — e este teste garante que ele viaja
 * na CRIAÇÃO e no REUSO.
 */
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

const chamadas: Array<{ url: string; body: Record<string, unknown> | null }> = []

beforeEach(() => {
  chamadas.length = 0
  process.env.ASAAS_API_KEY = 'chave-de-teste'
  vi.spyOn(globalThis, 'fetch').mockImplementation(((url: string, init?: RequestInit) => {
    chamadas.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    const corpo = String(url).includes('/customers?email=')
      ? (String(url).includes('existente') ? { totalCount: 1, data: [{ id: 'cus_1', name: 'X', email: 'existente@x.com' }] } : { totalCount: 0, data: [] })
      : { id: 'cus_novo', name: 'X', email: 'x@x.com' }
    return Promise.resolve(new Response(JSON.stringify(corpo), { status: 200 }))
  }) as never)
})
afterEach(() => vi.restoreAllMocks())

describe('createCustomer — silêncio de raiz', () => {
  it('customer NOVO nasce com notificationDisabled: true', async () => {
    const { createCustomer } = await import('./asaas')
    await createCustomer({ name: 'Fulana', email: 'nova@x.com' })
    const post = chamadas.find((c) => c.url.endsWith('/customers') && c.body)
    expect(post?.body?.notificationDisabled).toBe(true)
  })

  it('customer REUSADO recebe notificationDisabled: true no update', async () => {
    const { createCustomer } = await import('./asaas')
    await createCustomer({ name: 'Fulana', email: 'existente@x.com' })
    const put = chamadas.find((c) => c.url.includes('/customers/cus_1'))
    expect(put?.body?.notificationDisabled).toBe(true)
  })

  it('o silêncio não sobrescreve os demais dados do payload', async () => {
    const { createCustomer } = await import('./asaas')
    await createCustomer({ name: 'Fulana', email: 'nova@x.com', cpfCnpj: '12345678900' })
    const post = chamadas.find((c) => c.url.endsWith('/customers') && c.body)
    expect(post?.body?.name).toBe('Fulana')
    expect(post?.body?.cpfCnpj).toBe('12345678900')
  })
})
