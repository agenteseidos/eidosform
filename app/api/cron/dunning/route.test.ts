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
  sendDunningEmail: vi.fn(async (_p: { to: string; assunto: string; paragrafos: string[]; ctaLabel: string; ctaUrl: string | null; idempotencyKey: string }) => ({ id: 'e1' })),
  sendBillingOpsAlert: vi.fn(async () => ({})),
}))
vi.mock('@/lib/resend', () => resendMocks)
vi.mock('@/lib/billing-ops-whatsapp', () => ({ notifyBillingOpsWhatsApp: vi.fn(async () => ({ sent: true })) }))

const outboxMocks = vi.hoisted(() => ({
  reserveDunningDelivery: vi.fn(),
  finishDunningDelivery: vi.fn(async () => undefined),
  listRecoverableDunningKeys: vi.fn(async () => new Set<string>()),
}))
vi.mock('@/lib/dunning-outbox', () => ({
  ...outboxMocks,
  buildDunningDeliveryKey: ({ profileId, stage, day, channel }: { profileId: string; stage: number; day: string; channel: string }) =>
    `dunning:${profileId}:${stage}:${day}:${channel}`,
}))

const wppMocks = vi.hoisted(() => ({ sendConfirmationTemplate: vi.fn(async (_p?: {
  toPhone: string; template: string; bodyParams: string[]; buttonUrlParam?: string | null; context: string
}) => ({ sent: true })) }))
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
const PAGANTE = {
  id: 'u1', email: 'cliente@x.com', full_name: 'Julia Souza', phone: '5583999110173',
  plan: 'plus', plan_status: 'active', plan_cycle: 'MONTHLY', asaas_subscription_id: 'sub_1',
}

/** Banco falso: a outbox é mockada à parte; aqui só entra a lista de candidatos. */
function makeDb(candidatos: unknown[]) {
  return {
    db: {
      from: () => ({
        select: () => {
          const chain: Record<string, unknown> = {
            not: () => chain, or: () => chain, eq: () => chain, limit: async () => ({ data: candidatos, error: null }),
          }
          return chain
        },
      }),
    },
  }
}

/** Vencida há N dias no mesmo calendário BRT do motor (não vira o dia às 21h de Recife). */
const vencidaHa = (n: number) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Date.now() - n * 86_400_000))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  process.env.CRON_SECRET = 'segredo'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave'
  process.env.PAYMENT_LINK_TOKEN_SECRET = 'segredo-token-teste'
  delete process.env.DUNNING_WHATSAPP_ENABLED
  asaasMocks.getLinkPagamentoVencido.mockResolvedValue({ ok: true, url: 'https://fatura/x', dueDate: '2026-08-10' })
  outboxMocks.reserveDunningDelivery.mockImplementation(async (_db, p: { profileId: string; stage: number; day: string; channel: 'email' | 'whatsapp' }) => ({
    key: `dunning:${p.profileId}:${p.stage}:${p.day}:${p.channel}`,
    leaseToken: `lease-${p.channel}`,
    channel: p.channel,
  }))
  outboxMocks.finishDunningDelivery.mockResolvedValue(undefined)
  outboxMocks.listRecoverableDunningKeys.mockResolvedValue(new Set())
  resendMocks.sendDunningEmail.mockResolvedValue({ id: 'e1' })
  wppMocks.sendConfirmationTemplate.mockResolvedValue({ sent: true })
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

  it('inadimplente recebe os DOIS canais — cada um na SUA hora (e-mail 9h, WhatsApp 15h)', async () => {
    process.env.DUNNING_WHATSAPP_ENABLED = 'true'
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })

    // 9h: janela do E-MAIL. O WhatsApp NÃO pode sair junto (era o comportamento antigo).
    const manha = await (await GET(reqNaHora(9))).json() as { avisados: number }
    expect(manha.avisados).toBe(1)
    expect(resendMocks.sendDunningEmail).toHaveBeenCalledTimes(1)
    expect(wppMocks.sendConfirmationTemplate).not.toHaveBeenCalled()

    // 15h: janela do WhatsApp. Agora ele sai — e o e-mail não é reenviado.
    const tarde = await (await GET(reqNaHora(15))).json() as { avisados: number }
    expect(tarde.avisados).toBe(1)
    expect(wppMocks.sendConfirmationTemplate).toHaveBeenCalledTimes(1)
    expect(resendMocks.sendDunningEmail).toHaveBeenCalledTimes(1)
  })

  it('pagou entre a decisão e a entrega → rechecagem final aborta todos os canais', async () => {
    process.env.DUNNING_WHATSAPP_ENABLED = 'true'
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription
      .mockResolvedValueOnce({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })
      .mockResolvedValueOnce({ overdue: false, oldestDueDate: null, ok: true })

    const body = await (await GET(reqNaHora(9))).json() as { avisados: number }

    expect(body.avisados).toBe(0)
    expect(asaasMocks.hasOverduePaymentForSubscription).toHaveBeenCalledTimes(2)
    expect(outboxMocks.reserveDunningDelivery).not.toHaveBeenCalled()
    expect(resendMocks.sendDunningEmail).not.toHaveBeenCalled()
    expect(wppMocks.sendConfirmationTemplate).not.toHaveBeenCalled()
  })

  it('rechecagem final falhou → fail-closed, sem reservar nem cobrar', async () => {
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription
      .mockResolvedValueOnce({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })
      .mockResolvedValueOnce({ overdue: false, oldestDueDate: null, ok: false })

    await GET(reqNaHora(9))

    expect(outboxMocks.reserveDunningDelivery).not.toHaveBeenCalled()
    expect(resendMocks.sendDunningEmail).not.toHaveBeenCalled()
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

  it('fora da hora original retoma uma entrega failed já existente, sem criar outra', async () => {
    const day = vencidaHa(0)
    const key = `dunning:u1:0:${day}:email`
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: day, ok: true })
    outboxMocks.listRecoverableDunningKeys.mockResolvedValue(new Set([key]))

    const body = await (await GET(reqNaHora(10))).json() as { avisados: number }

    expect(body.avisados).toBe(1)
    expect(outboxMocks.reserveDunningDelivery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      profileId: 'u1', channel: 'email', createIfMissing: false,
    }))
  })

  it('reserva recuperável NÃO dispara depois das 18h', async () => {
    const day = vencidaHa(0)
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: day, ok: true })
    outboxMocks.listRecoverableDunningKeys.mockResolvedValue(new Set([`dunning:u1:0:${day}:email`]))

    const body = await (await GET(reqNaHora(19))).json() as { avisados: number }

    expect(body.avisados).toBe(0)
    expect(outboxMocks.reserveDunningDelivery).not.toHaveBeenCalled()
  })
})

describe('idempotência do dia', () => {
  it('canal já reservado/entregue → não reenvia a mesma cobrança', async () => {
    const req = reqNaHora(9)
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })
    outboxMocks.reserveDunningDelivery.mockResolvedValue(null)

    const body = await (await GET(req)).json() as { avisados: number }

    expect(body.avisados).toBe(0)
    expect(resendMocks.sendDunningEmail).not.toHaveBeenCalled()
  })

  it('a chave é única por cliente + estágio + dia + canal e vai igual à Resend', async () => {
    const req = reqNaHora(9)
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })

    await GET(req)

    const reserva = outboxMocks.reserveDunningDelivery.mock.calls[0][1]
    expect(reserva).toMatchObject({ profileId: 'u1', stage: 0, channel: 'email' })
    expect(reserva.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(resendMocks.sendDunningEmail.mock.calls[0][0].idempotencyKey)
      .toBe(`dunning:u1:0:${reserva.day}:email`)
  })

  it('erro não-conflito ao reservar não é tratado como duplicata silenciosa', async () => {
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })
    outboxMocks.reserveDunningDelivery.mockRejectedValue(new Error('DB indisponível'))

    const body = await (await GET(reqNaHora(9))).json() as { falhas: number; avisados: number }

    expect(body.falhas).toBeGreaterThan(0)
    expect(body.avisados).toBe(0)
    expect(resendMocks.sendDunningEmail).not.toHaveBeenCalled()
  })

  it('retorno {error} da Resend marca failed e NÃO incrementa avisados', async () => {
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })
    resendMocks.sendDunningEmail.mockResolvedValue({ error: 'HTTP 503' } as never)

    const body = await (await GET(reqNaHora(9))).json() as { falhas: number; avisados: number }

    expect(body.avisados).toBe(0)
    expect(body.falhas).toBeGreaterThan(0)
    expect(outboxMocks.finishDunningDelivery).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ channel: 'email' }), 'failed',
      expect.objectContaining({ error: 'HTTP 503' }),
    )
  })

  it('aceite do e-mail marca accepted com o id do provedor', async () => {
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })

    const body = await (await GET(reqNaHora(9))).json() as { avisados: number }

    expect(body.avisados).toBe(1)
    expect(outboxMocks.finishDunningDelivery).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ channel: 'email' }), 'accepted',
      { providerMessageId: 'e1' },
    )
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

describe('🛡️ estado preservado depois do corte D+5', () => {
  it('perfil free usa a assinatura e o plano anteriores para entregar o 6º aviso', async () => {
    const cortado = {
      ...PAGANTE,
      plan: 'free',
      plan_status: 'expired',
      plan_cycle: null,
      asaas_subscription_id: null,
      overdue_subscription_id: 'sub_cortada',
      previous_plan: 'plus',
      previous_plan_cycle: 'YEARLY',
      downgraded_at: new Date().toISOString(),
    }
    const { db } = makeDb([cortado])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(5), ok: true })

    const body = await (await GET(reqNaHora(9))).json() as { avisados: number }

    expect(body.avisados).toBe(1)
    expect(asaasMocks.hasOverduePaymentForSubscription).toHaveBeenCalledWith('sub_cortada')
    expect(asaasMocks.getLinkPagamentoVencido).toHaveBeenCalledWith('sub_cortada')
    const email = resendMocks.sendDunningEmail.mock.calls[0][0]
    expect(email.paragrafos.join(' ')).toContain('plus YEARLY')
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

  it('flag ligada usa o template genérico, texto do estágio e só o token no botão', async () => {
    process.env.DUNNING_WHATSAPP_ENABLED = 'true'
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })

    await GET(reqNaHora(15)) // janela do WhatsApp no D+0

    const envio = wppMocks.sendConfirmationTemplate.mock.calls[0][0]!
    expect(envio.template).toBe('eidosform_cobranca_v1')
    expect(envio.bodyParams).toHaveLength(3)
    expect(envio.bodyParams[2]).toContain('5 dias')
    expect(envio.buttonUrlParam).toEqual(expect.any(String))
    expect(envio.buttonUrlParam).not.toContain('https://')
    expect(envio.buttonUrlParam).not.toContain('/pagar/')
  })

  it('sem cobrança com link não gera token nem tenta template com botão incompleto', async () => {
    process.env.DUNNING_WHATSAPP_ENABLED = 'true'
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })
    asaasMocks.getLinkPagamentoVencido.mockResolvedValue({ ok: true, url: null, dueDate: null })

    await GET(reqNaHora(9))

    expect(wppMocks.sendConfirmationTemplate).not.toHaveBeenCalled()
    expect(outboxMocks.reserveDunningDelivery.mock.calls.map((call) => call[1].channel)).not.toContain('whatsapp')
  })

  it('{sent:false} marca o canal failed em vez de sumir no catch', async () => {
    process.env.DUNNING_WHATSAPP_ENABLED = 'true'
    const { db } = makeDb([PAGANTE])
    mockCreate.mockReturnValue(db as never)
    asaasMocks.hasOverduePaymentForSubscription.mockResolvedValue({ overdue: true, oldestDueDate: vencidaHa(0), ok: true })
    wppMocks.sendConfirmationTemplate.mockResolvedValue({ sent: false, skipped: 'send_failed' } as never)

    const body = await (await GET(reqNaHora(15))).json() as { falhas: number } // janela do WhatsApp

    expect(body.falhas).toBeGreaterThan(0)
    expect(outboxMocks.finishDunningDelivery).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ channel: 'whatsapp' }), 'failed',
      { error: 'send_failed' },
    )
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
