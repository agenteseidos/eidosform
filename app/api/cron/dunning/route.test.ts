/**
 * D-01 · o cron da régua — o que se prova aqui é a PARIDADE DE CHECAGEM entre os canais.
 *
 * Instrução do Sidney: "tudo que ocorre de checagem com os e-mails antes do envio tem que
 * ocorrer nas mensagens também". A garantia é estrutural — a decisão mora no motor, antes de
 * qualquer canal — e estes testes travam isso: quem não passa no motor não recebe NEM e-mail
 * NEM WhatsApp.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      async json() { return data },
    }),
  },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

const asaasMocks = vi.hoisted(() => ({
  hasOverduePaymentForSubscription: vi.fn(),
  getLinkPagamentoVencido: vi.fn(async (): Promise<{ ok: boolean; url: string | null; dueDate: string | null }> => ({ ok: true, url: 'https://fatura/x', dueDate: '2026-08-10' })),
}))
vi.mock('@/lib/asaas', async (orig) => ({ ...(await orig<object>()), ...asaasMocks }))

const resendMocks = vi.hoisted(() => ({
  sendDunningEmail: vi.fn(async (_p: { to: string; assunto: string; paragrafos: string[]; ctaLabel: string; ctaUrl: string | null }) => ({ id: 'e1' })),
  sendBillingOpsAlert: vi.fn(async () => ({})),
}))
vi.mock('@/lib/resend', () => resendMocks)
vi.mock('@/lib/billing-ops-whatsapp', () => ({ notifyBillingOpsWhatsApp: vi.fn(async () => ({ sent: true })) }))

const wppMocks = vi.hoisted(() => ({ sendConfirmationTemplate: vi.fn(async () => ({ sent: true })) }))
vi.mock('@/lib/whatsapp-confirmations', () => ({
  ...wppMocks,
  planLabel: (p?: string | null, c?: string | null) => `${p ?? '?'} ${c ?? ''}`.trim(),
}))

import { GET } from './route'
import { createClient } from '@supabase/supabase-js'

const mockCreate = vi.mocked(createClient)
/** Requisição com a hora BRT fixada — a régua só age na janela do estágio. */
const reqNaHora = (hora: number) => ({
  url: `https://x/api/cron/dunning?hora=${hora}`,
  headers: { get: (k: string) => (k === 'authorization' ? 'Bearer segredo' : null) },
}) as never
const REQ = reqNaHora(9)

const PAGANTE = {
  id: 'u1', email: 'cliente@x.com', full_name: 'Julia Souza', phone: '5583999110173',
  plan: 'plus', plan_status: 'active', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_1',
}

/** Banco falso: lista de candidatos + marcador de idempotência controlável. */
function makeDb(candidatos: unknown[], marcadorJaExiste = false) {
  const inserts: unknown[] = []
  return {
    inserts,
    db: {
      from: () => ({
        select: () => {
          const chain: Record<string, unknown> = {
            not: () => chain, eq: () => chain, limit: async () => ({ data: candidatos, error: null }),
          }
          return chain
        },
        insert: async (v: unknown) => {
          inserts.push(v)
          return { error: marcadorJaExiste ? { code: '23505' } : null }
        },
      }),
    },
  }
}

/** Vencida há N dias (o motor conta em dias inteiros BRT). */
const vencidaHa = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  process.env.CRON_SECRET = 'segredo'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave'
  delete process.env.DUNNING_WHATSAPP_ENABLED
  asaasMocks.getLinkPagamentoVencido.mockResolvedValue({ ok: true, url: 'https://fatura/x', dueDate: '2026-08-10' })
})

describe('autenticação', () => {
  it('sem o segredo do cron: 401 sem tocar o banco', async () => {
    const res = await GET({ url: 'https://x/api/cron/dunning', headers: { get: () => null } } as never)
    expect(res.status).toBe(401)
  })
})

describe('🛡️ paridade: quem não passa no motor não recebe NENHUM canal', () => {
  it('cliente que PAGOU não recebe e-mail nem WhatsApp', async () => {
    process.env.DUNNING_WHATSAPP_ENABLED = 'true'
    const req = reqNaHora(9)
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: false, oldestDueDate: null, ok: true })

    const body = await (await GET(req)).json() as { avisados: number }

    expect(body.avisados).toBe(0)
    expect(resendMocks.sendDunningEmail).not.toHaveBeenCalled()
    expect(wppMocks.sendConfirmationTemplate).not.toHaveBeenCalled()
  })

  it('consulta ao gateway FALHOU → nenhum canal dispara', async () => {
    process.env.DUNNING_WHATSAPP_ENABLED = 'true'
    const req = reqNaHora(9)
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: false, oldestDueDate: null, ok: false })

    await GET(req)

    expect(resendMocks.sendDunningEmail).not.toHaveBeenCalled()
    expect(wppMocks.sendConfirmationTemplate).not.toHaveBeenCalled()
  })

  it('inadimplente na hora certa recebe os DOIS canais', async () => {
    process.env.DUNNING_WHATSAPP_ENABLED = 'true'
    const req = reqNaHora(9) // estágio 0 = 9h
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })

    const body = await (await GET(req)).json() as { avisados: number }

    expect(body.avisados).toBe(1)
    expect(resendMocks.sendDunningEmail).toHaveBeenCalledTimes(1)
    expect(wppMocks.sendConfirmationTemplate).toHaveBeenCalledTimes(1)
  })
})

describe('a rotação de horários é respeitada', () => {
  it('estágio 0 NÃO dispara às 17h (a janela dele é 9h)', async () => {
    const req = reqNaHora(17)
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })

    const body = await (await GET(req)).json() as { avisados: number }
    expect(body.avisados).toBe(0)
  })

  it('estágio 2 dispara às 17h', async () => {
    const req = reqNaHora(17)
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(2), ok: true })

    const body = await (await GET(req)).json() as { avisados: number }
    expect(body.avisados).toBe(1)
  })
})

describe('idempotência do dia', () => {
  it('marcador já existente → não reenvia a mesma cobrança', async () => {
    const req = reqNaHora(9)
    const { db } = makeDb([PAGANTE], true) // insert do marcador falha com 23505
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })

    const body = await (await GET(req)).json() as { avisados: number }

    expect(body.avisados).toBe(0)
    expect(resendMocks.sendDunningEmail).not.toHaveBeenCalled()
  })

  it('o marcador é único por cliente + estágio + dia', async () => {
    const req = reqNaHora(9)
    const { db, inserts } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })

    await GET(req)

    const id = (inserts[0] as { event_id: string }).event_id
    expect(id).toMatch(/^dunning:u1:0:\d{4}-\d{2}-\d{2}$/)
  })
})

describe('🛡️ detector do rebaixamento atrasado', () => {
  it('passou do prazo e segue pago → alerta operacional, sem cobrar o cliente', async () => {
    const req = reqNaHora(9)
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(9), ok: true })

    const body = await (await GET(req)).json() as { alertasRebaixamento: number; avisados: number }

    expect(body.alertasRebaixamento).toBe(1)
    expect(resendMocks.sendBillingOpsAlert).toHaveBeenCalled()
    expect(resendMocks.sendDunningEmail).not.toHaveBeenCalled() // não mente para o cliente
  })
})

describe('o link de pagamento', () => {
  it('🛡️ o botão aponta para a NOSSA rota — o cliente nunca vê o gateway', async () => {
    // Exigência do Sidney: ele comprou do Instituto Eidos. E é o que mantém o template do
    // WhatsApp aprovado para sempre — o destino vira código nosso.
    process.env.PAYMENT_LINK_TOKEN_SECRET = 'segredo-de-teste'
    process.env.NEXT_PUBLIC_APP_URL = 'https://eidosform.com.br'
    const req = reqNaHora(9)
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })

    await GET(req)

    const { ctaUrl } = resendMocks.sendDunningEmail.mock.calls[0][0]
    expect(ctaUrl).toMatch(/^https:\/\/eidosform\.com\.br\/pagar\//)
    expect(ctaUrl).not.toContain('cobranca')  // a URL da fatura nunca aparece
  })

  it('sem link disponível o e-mail ainda sai (botão vira convite a responder)', async () => {
    const req = reqNaHora(9)
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })
    asaasMocks.getLinkPagamentoVencido.mockResolvedValue({ ok: false, url: null, dueDate: null })

    const body = await (await GET(req)).json() as { avisados: number }

    expect(body.avisados).toBe(1)
    expect(resendMocks.sendDunningEmail.mock.calls[0][0] as unknown as { ctaUrl: string | null }).toMatchObject({ ctaUrl: null })
  })
})

describe('WhatsApp atrás da flag (2ª onda, aguardando a Meta)', () => {
  it('flag desligada → só e-mail', async () => {
    const req = reqNaHora(9)
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })

    await GET(req)

    expect(resendMocks.sendDunningEmail).toHaveBeenCalledTimes(1)
    expect(wppMocks.sendConfirmationTemplate).not.toHaveBeenCalled()
  })
})

describe('robustez', () => {
  it('um candidato que explode não derruba os outros', async () => {
    const req = reqNaHora(9)
    const { db } = makeDb([PAGANTE, { ...PAGANTE, id: 'u2', asaas_subscription_id: 'sub_2' }])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription
      .mockRejectedValueOnce(new Error('gateway piscou'))
      .mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })

    const body = await (await GET(req)).json() as { falhas: number; avisados: number }

    expect(body.falhas).toBe(1)
    expect(body.avisados).toBe(1)
  })
})

describe('🛡️ regressão: chamada SEM ?hora= (o jeito que o cron REAL chama)', () => {
  it('usa o relógio de Brasília — Number(null)=0 forçava meia-noite e emudecia a régua', async () => {
    // 12:00 UTC = 9h BRT → janela do estágio 0. O bug: sem ?hora=, Number(null) dava 0
    // (não NaN), o guard aceitava 0 como hora válida e NENHUM estágio dispara à 0h —
    // a régua inteira ficava muda em produção. (Pego no disparo de validação 13/08.)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T12:00:00Z'))
    try {
      const req = {
        url: 'https://x/api/cron/dunning',
        headers: { get: (k: string) => (k === 'authorization' ? 'Bearer segredo' : null) },
      } as never
      const { db } = makeDb([PAGANTE])
      mockCreate.mockReturnValue(db as never)
      asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })

      const body = await (await GET(req)).json() as { horaBRT: number; avisados: number }

      expect(body.horaBRT).toBe(9)  // hora REAL de Brasília, nunca o 0 do Number(null)
      expect(body.avisados).toBe(1) // e a régua FALA quando é a janela do estágio
    } finally {
      vi.useRealTimers()
    }
  })
})
