/**
 * DÍVIDA EM ABERTO — a fonte do aviso no painel e da limpeza da assinatura velha.
 *
 * O bug que estes testes travam (25/08/2026): quem foi rebaixado por falta de pagamento tem a
 * assinatura em `overdue_subscription_id`, NÃO em `asaas_subscription_id` (o expire-plans move
 * ao cortar). Quem olhar só o primeiro campo conclui "não há dívida" exatamente no caso em que
 * ela existe — e foi assim que o cancelamento da assinatura antiga deixava de acontecer,
 * permitindo DUAS subs ACTIVE no mesmo cliente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/asaas', () => ({ getLinkPagamentoVencido: vi.fn() }))
import { getLinkPagamentoVencido } from '@/lib/asaas'
import { consultarDividaPendente, assinaturaComDivida } from './divida-pendente'

const mock = vi.mocked(getLinkPagamentoVencido)
const COBRANCA = { ok: true, url: 'https://asaas.com/i/xyz', dueDate: '2026-08-20', value: 127, paymentId: 'pay_x' }

beforeEach(() => mock.mockReset())

describe('🛡️ achar a assinatura que carrega a dívida', () => {
  it('perfil REBAIXADO: a assinatura está em overdue_subscription_id', () => {
    expect(assinaturaComDivida({ asaas_subscription_id: null, overdue_subscription_id: 'sub_velha' })).toBe('sub_velha')
  })

  it('a de dívida tem PRECEDÊNCIA sobre a ativa — é ela que tem a fatura vencida', () => {
    expect(assinaturaComDivida({ asaas_subscription_id: 'sub_nova', overdue_subscription_id: 'sub_velha' })).toBe('sub_velha')
  })

  it('cliente normal, sem dívida: cai na assinatura ativa', () => {
    expect(assinaturaComDivida({ asaas_subscription_id: 'sub_a', overdue_subscription_id: null })).toBe('sub_a')
  })

  it('sem assinatura nenhuma → null, e nem chega a perguntar ao gateway', async () => {
    const d = await consultarDividaPendente({ asaas_subscription_id: null, overdue_subscription_id: null })
    expect(d.temDivida).toBe(false)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('🛡️ "não sei" NUNCA vira "não deve"', () => {
  it('leitura do gateway falhou → temDivida false MAS ok false', async () => {
    // Os dois consumidores tratam isto de formas OPOSTAS: o painel omite o aviso (melhor calar
    // que mentir), e a guarda do checkout deixa passar (não perder venda por falha de rede).
    mock.mockResolvedValue({ ok: false, url: null, dueDate: null, value: null, paymentId: null })
    const d = await consultarDividaPendente({ overdue_subscription_id: 'sub_velha' })
    expect(d).toMatchObject({ temDivida: false, ok: false, subscriptionId: 'sub_velha' })
  })

  it('gateway respondeu e não há vencida → temDivida false com ok true', async () => {
    mock.mockResolvedValue({ ok: true, url: null, dueDate: null, value: null, paymentId: null })
    const d = await consultarDividaPendente({ overdue_subscription_id: 'sub_velha' })
    expect(d).toMatchObject({ temDivida: false, ok: true })
  })
})

describe('🛡️ a dívida encontrada', () => {
  it('devolve valor, vencimento e link da fatura mais antiga', async () => {
    mock.mockResolvedValue(COBRANCA)
    const d = await consultarDividaPendente({ asaas_subscription_id: null, overdue_subscription_id: 'sub_velha' })
    expect(d).toEqual({
      temDivida: true, ok: true, subscriptionId: 'sub_velha',
      valor: 127, vencimento: '2026-08-20', url: 'https://asaas.com/i/xyz',
    })
    expect(mock).toHaveBeenCalledWith('sub_velha')
  })

  it('fatura SEM página de pagamento ainda conta como dívida, mas sem link', async () => {
    // O EidosForm não vende boleto: sem invoiceUrl o aviso aparece sem botão, em vez de levar a
    // lugar nenhum. Ver getLinkPagamentoVencido.
    mock.mockResolvedValue({ ...COBRANCA, url: null })
    const d = await consultarDividaPendente({ overdue_subscription_id: 'sub_velha' })
    expect(d.temDivida).toBe(true)
    expect(d.url).toBeNull()
  })
})

describe('🛡️ regressão: o webhook precisa enxergar a assinatura rebaixada', () => {
  it('a ativação lê overdue_subscription_id ao escolher a sub anterior a cancelar', async () => {
    // ERA `previousProfile?.asaas_subscription_id ?? null` — nulo em perfil rebaixado, então o
    // cancelamento da assinatura antiga recebia null e não fazia NADA: o cliente ficava com
    // duas subs ACTIVE até o reconcile passar (até 1h), com risco de cobrança dobrada.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '..', 'app', 'api', 'webhooks', 'asaas', 'route.ts'), 'utf-8')
    expect(src).toContain('previousProfile?.asaas_subscription_id ?? previousProfile?.overdue_subscription_id')
    // e o campo tem que estar no SELECT, senão vem undefined em silêncio
    expect(src).toMatch(/select\('asaas_subscription_id, overdue_subscription_id, plan/)
  })
})
