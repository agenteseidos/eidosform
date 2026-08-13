/**
 * D-01 · a rota /pagar — o destino do botão do WhatsApp.
 *
 * O que se prova aqui: o cliente que veio de uma cobrança NUNCA vê erro técnico. Qualquer
 * falha vira redirecionamento para o painel. E o link só abre para quem tem token válido —
 * a fatura mostra nome, valor e dados de cobrança.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    redirect: (url: string, status?: number) => ({ status: status ?? 307, headers: { get: (k: string) => (k === 'location' ? url : null) }, url }),
  },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }))
const asaasMocks = vi.hoisted(() => ({
  getLinkPagamentoVencido: vi.fn(async (): Promise<{ ok: boolean; url: string | null; dueDate: string | null }> =>
    ({ ok: true, url: 'https://cobranca/fatura-123', dueDate: '2026-08-10' })),
}))
vi.mock('@/lib/asaas', async (orig) => ({ ...(await orig<object>()), ...asaasMocks }))

import { GET } from './route'
import { createClient } from '@supabase/supabase-js'
import { signPaymentLinkToken } from '@/lib/payment-link-token'

const mockCreate = vi.mocked(createClient)
const PERFIL = '9f1c2a44-0f0e-4a1b-9c3d-1122334455aa'

function db(profile: unknown) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }),
  }
}
const chamar = (token: string) =>
  GET({} as never, { params: Promise.resolve({ token }) })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PAYMENT_LINK_TOKEN_SECRET = 'segredo-de-teste'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave'
  process.env.NEXT_PUBLIC_APP_URL = 'https://eidosform.com.br'
  asaasMocks.getLinkPagamentoVencido.mockResolvedValue({ ok: true, url: 'https://cobranca/fatura-123', dueDate: '2026-08-10' })
})

describe('caminho feliz', () => {
  it('token válido → 302 para a página de cobrança da fatura', async () => {
    mockCreate.mockReturnValue(db({ asaas_subscription_id: 'sub_1', plan: 'plus' }) as never)
    const res = await chamar(signPaymentLinkToken(PERFIL)!)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://cobranca/fatura-123')
  })

  it('302 e não 301 — o destino muda a cada cobrança e não pode ficar cacheado', async () => {
    mockCreate.mockReturnValue(db({ asaas_subscription_id: 'sub_1' }) as never)
    const res = await chamar(signPaymentLinkToken(PERFIL)!)
    expect(res.status).toBe(302)
  })

  it('depois do corte D+5, o link antigo usa a assinatura vencida preservada', async () => {
    mockCreate.mockReturnValue(db({
      asaas_subscription_id: null,
      overdue_subscription_id: 'sub_cortada',
      plan: 'free',
    }) as never)

    const res = await chamar(signPaymentLinkToken(PERFIL)!)

    expect(res.status).toBe(302)
    expect(asaasMocks.getLinkPagamentoVencido).toHaveBeenCalledWith('sub_cortada')
    expect(res.headers.get('location')).toBe('https://cobranca/fatura-123')
  })
})

describe('🛡️ o cliente nunca vê erro técnico', () => {
  it('token inválido → painel, sem vazar motivo técnico', async () => {
    const res = await chamar('token.falso')
    expect(res.headers.get('location')).toContain('/billing?cobranca=link_expirado')
  })

  it('perfil sem assinatura (já regularizou ou cancelou) → painel', async () => {
    mockCreate.mockReturnValue(db({ asaas_subscription_id: null }) as never)
    const res = await chamar(signPaymentLinkToken(PERFIL)!)
    expect(res.headers.get('location')).toContain('cobranca=sem_pendencia')
  })

  it('🛡️ PAGOU entre a mensagem e o clique → painel, não erro (é o caso feliz)', async () => {
    mockCreate.mockReturnValue(db({ asaas_subscription_id: 'sub_1' }) as never)
    asaasMocks.getLinkPagamentoVencido.mockResolvedValue({ ok: true, url: null, dueDate: null })
    const res = await chamar(signPaymentLinkToken(PERFIL)!)
    expect(res.headers.get('location')).toContain('cobranca=sem_pendencia')
  })

  it('gateway fora do ar → painel com aviso de indisponível', async () => {
    mockCreate.mockReturnValue(db({ asaas_subscription_id: 'sub_1' }) as never)
    asaasMocks.getLinkPagamentoVencido.mockResolvedValue({ ok: false, url: null, dueDate: null })
    const res = await chamar(signPaymentLinkToken(PERFIL)!)
    expect(res.headers.get('location')).toContain('cobranca=indisponivel')
  })

  it('exceção no meio → painel, nunca 500 na cara de quem ia pagar', async () => {
    mockCreate.mockImplementation(() => { throw new Error('banco caiu') })
    const res = await chamar(signPaymentLinkToken(PERFIL)!)
    expect(res.headers.get('location')).toContain('cobranca=indisponivel')
  })
})

describe('🛡️ o token é a única chave', () => {
  it('sem token válido, o banco NEM é consultado', async () => {
    await chamar('lixo')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
