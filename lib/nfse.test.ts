/**
 * Testes de lib/nfse — NFS-e automática (decisão Sidney 2026-08-05).
 *
 * Foco de dinheiro/fiscal:
 * - Idempotência por COBRANÇA: CONFIRMED e RECEIVED do mesmo payment (cartão dispara os
 *   dois) não podem emitir duas notas; nota CANCELED conta como "já existe" (estorno
 *   entre os dois eventos não pode ressuscitar a nota).
 * - Nota anterior em ERROR (rejeição da prefeitura) permite retry.
 * - Falha de emissão/cancelamento NUNCA lança — vira alerta operacional (best-effort
 *   dentro de after() no webhook).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  listInvoicesByPayment: vi.fn(),
  scheduleInvoiceForPayment: vi.fn(),
  cancelInvoice: vi.fn(),
  sendBillingOpsAlert: vi.fn().mockResolvedValue({ id: 'email_1' }),
}))

vi.mock('@/lib/asaas', () => ({
  listInvoicesByPayment: mocks.listInvoicesByPayment,
  scheduleInvoiceForPayment: mocks.scheduleInvoiceForPayment,
  cancelInvoice: mocks.cancelInvoice,
}))
vi.mock('@/lib/resend', () => ({
  sendBillingOpsAlert: mocks.sendBillingOpsAlert,
}))

import { emitirNotaParaPagamento, cancelarNotasDoPagamento, nfseEnabled } from './nfse'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.NFSE_EMIT_ENABLED
})
afterEach(() => {
  delete process.env.NFSE_EMIT_ENABLED
})

describe('nfseEnabled (kill-switch)', () => {
  it('ligado por padrão; NFSE_EMIT_ENABLED=0 desliga', () => {
    expect(nfseEnabled()).toBe(true)
    process.env.NFSE_EMIT_ENABLED = '0'
    expect(nfseEnabled()).toBe(false)
  })
})

describe('emitirNotaParaPagamento', () => {
  it('agenda a nota com serviço municipal, taxes zerados e externalReference nfse:pay:', async () => {
    mocks.listInvoicesByPayment.mockResolvedValue([])
    mocks.scheduleInvoiceForPayment.mockResolvedValue({ id: 'inv_1', status: 'SCHEDULED' })

    const r = await emitirNotaParaPagamento({ paymentId: 'pay_123', value: 49 })

    expect(r).toBe('scheduled')
    expect(mocks.scheduleInvoiceForPayment).toHaveBeenCalledTimes(1)
    const args = mocks.scheduleInvoiceForPayment.mock.calls[0][0]
    expect(args.paymentId).toBe('pay_123')
    expect(args.value).toBe(49)
    expect(args.municipalServiceId).toBe('325850')
    expect(args.externalReference).toBe('nfse:pay:pay_123')
    expect(args.taxes).toEqual({ retainIss: false, iss: 0, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 })
    expect(args.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('idempotente: nota existente não-ERROR (inclui CANCELED) pula emissão', async () => {
    for (const status of ['SCHEDULED', 'AUTHORIZED', 'CANCELED', 'PROCESSING_CANCELLATION']) {
      mocks.listInvoicesByPayment.mockResolvedValue([{ id: 'inv_x', status, payment: 'pay_123' }])
      const r = await emitirNotaParaPagamento({ paymentId: 'pay_123', value: 49 })
      expect(r, `status ${status} deveria pular`).toBe('skipped')
    }
    expect(mocks.scheduleInvoiceForPayment).not.toHaveBeenCalled()
  })

  it('nota anterior em ERROR permite nova tentativa', async () => {
    mocks.listInvoicesByPayment.mockResolvedValue([{ id: 'inv_err', status: 'ERROR', payment: 'pay_123' }])
    mocks.scheduleInvoiceForPayment.mockResolvedValue({ id: 'inv_2', status: 'SCHEDULED' })

    const r = await emitirNotaParaPagamento({ paymentId: 'pay_123', value: 49 })

    expect(r).toBe('scheduled')
    expect(mocks.scheduleInvoiceForPayment).toHaveBeenCalledTimes(1)
  })

  it('kill-switch desligado → skipped sem tocar a API', async () => {
    process.env.NFSE_EMIT_ENABLED = '0'
    const r = await emitirNotaParaPagamento({ paymentId: 'pay_123', value: 49 })
    expect(r).toBe('skipped')
    expect(mocks.listInvoicesByPayment).not.toHaveBeenCalled()
  })

  it('valor inválido (0/negativo) → skipped', async () => {
    expect(await emitirNotaParaPagamento({ paymentId: 'pay_123', value: 0 })).toBe('skipped')
    expect(await emitirNotaParaPagamento({ paymentId: 'pay_123', value: -1 })).toBe('skipped')
    expect(mocks.listInvoicesByPayment).not.toHaveBeenCalled()
  })

  it('falha na API → failed + alerta operacional, sem lançar', async () => {
    mocks.listInvoicesByPayment.mockResolvedValue([])
    mocks.scheduleInvoiceForPayment.mockRejectedValue(new Error('Asaas API error 400: invalid'))

    const r = await emitirNotaParaPagamento({ paymentId: 'pay_123', value: 49, customerEmail: 'x@y.z' })

    expect(r).toBe('failed')
    expect(mocks.sendBillingOpsAlert).toHaveBeenCalledTimes(1)
    expect(mocks.sendBillingOpsAlert.mock.calls[0][0].subject).toContain('NFS-e NÃO agendada')
  })
})

describe('cancelarNotasDoPagamento', () => {
  it('cancela todas as notas canceláveis do pagamento', async () => {
    mocks.listInvoicesByPayment.mockResolvedValue([
      { id: 'inv_a', status: 'AUTHORIZED', payment: 'pay_9' },
      { id: 'inv_b', status: 'SCHEDULED', payment: 'pay_9' },
      { id: 'inv_c', status: 'CANCELED', payment: 'pay_9' },
    ])
    mocks.cancelInvoice.mockResolvedValue({ id: 'x', status: 'PROCESSING_CANCELLATION' })

    const r = await cancelarNotasDoPagamento({ paymentId: 'pay_9', motivo: 'PAYMENT_REFUNDED' })

    expect(r).toBe('cancelled')
    expect(mocks.cancelInvoice).toHaveBeenCalledTimes(2)
    expect(mocks.cancelInvoice).toHaveBeenCalledWith('inv_a')
    expect(mocks.cancelInvoice).toHaveBeenCalledWith('inv_b')
  })

  it('sem nota cancelável → noop, sem alerta', async () => {
    mocks.listInvoicesByPayment.mockResolvedValue([{ id: 'inv_c', status: 'CANCELED', payment: 'pay_9' }])
    const r = await cancelarNotasDoPagamento({ paymentId: 'pay_9', motivo: 'PAYMENT_REFUNDED' })
    expect(r).toBe('noop')
    expect(mocks.cancelInvoice).not.toHaveBeenCalled()
    expect(mocks.sendBillingOpsAlert).not.toHaveBeenCalled()
  })

  it('cancelamento negado/falho → failed + alerta com a nota problemática', async () => {
    mocks.listInvoicesByPayment.mockResolvedValue([{ id: 'inv_a', status: 'AUTHORIZED', payment: 'pay_9', number: '1013706' }])
    mocks.cancelInvoice.mockRejectedValue(new Error('Asaas API error 400: prazo vencido'))

    const r = await cancelarNotasDoPagamento({ paymentId: 'pay_9', motivo: 'PAYMENT_CHARGEBACK_REQUESTED' })

    expect(r).toBe('failed')
    expect(mocks.sendBillingOpsAlert).toHaveBeenCalledTimes(1)
    const alert = mocks.sendBillingOpsAlert.mock.calls[0][0]
    expect(alert.subject).toContain('Cancelamento de NFS-e FALHOU')
    expect(alert.lines.notas).toContain('1013706')
  })

  it('kill-switch desligado → noop sem tocar a API', async () => {
    process.env.NFSE_EMIT_ENABLED = '0'
    const r = await cancelarNotasDoPagamento({ paymentId: 'pay_9', motivo: 'PAYMENT_REFUNDED' })
    expect(r).toBe('noop')
    expect(mocks.listInvoicesByPayment).not.toHaveBeenCalled()
  })

  it('falha ao LISTAR notas → failed + alerta de estado desconhecido', async () => {
    mocks.listInvoicesByPayment.mockRejectedValue(new Error('rede'))
    const r = await cancelarNotasDoPagamento({ paymentId: 'pay_9', motivo: 'PAYMENT_REFUNDED' })
    expect(r).toBe('failed')
    expect(mocks.sendBillingOpsAlert).toHaveBeenCalledTimes(1)
  })
})
