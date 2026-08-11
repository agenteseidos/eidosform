/**
 * D-05 · o dreno da fila — o que se prova aqui é o DESENHO DE REFERÊNCIA.
 *
 * A fila guarda form_id/response_id/role e nada mais; o e-mail é remontado do banco a cada
 * tentativa. Isso compra três garantias que estes testes travam:
 *  · resposta APAGADA → reenvio pulado (exclusão respeitada sem rotina de expurgo);
 *  · destinatário DESLIGADO depois da falha → reenvio pulado (vale a config de hoje);
 *  · e-mail de notificação TROCADO → reenvio vai para o endereço NOVO.
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
vi.mock('@/lib/billing-ops-whatsapp', () => ({ notifyBillingOpsWhatsApp: vi.fn(async () => ({ sent: true })) }))

const filaMocks = vi.hoisted(() => ({
  lerPendentes: vi.fn(),
  marcarEnviado: vi.fn(async () => undefined),
  marcarTentativaFalha: vi.fn(async (): Promise<'reagendado' | 'morto'> => 'reagendado'),
  descartarSemAlvo: vi.fn(async () => undefined),
}))
vi.mock('@/lib/email-retry-queue', () => filaMocks)

const envioMocks = vi.hoisted(() => ({ sendNewResponseEmails: vi.fn(async () => [{ role: 'owner' }]) }))
vi.mock('@/lib/notification-email', async (orig) => {
  const real = await orig<typeof import('@/lib/notification-email')>()
  return { ...real, ...envioMocks } // resolveEmailRecipients REAL — é a regra sob teste
})

import { GET } from './route'
import { createClient } from '@supabase/supabase-js'
import { notifyBillingOpsWhatsApp } from '@/lib/billing-ops-whatsapp'

const mockCreate = vi.mocked(createClient)
const mockWpp = vi.mocked(notifyBillingOpsWhatsApp)

const ITEM = {
  id: 'q1', kind: 'new-response', form_id: 'f1', response_id: 'r1',
  role: 'owner' as const, attempts: 0, first_failed_at: new Date().toISOString(),
}

/** Banco falso: devolve por tabela o que o teste mandar. */
function makeDb(t: { resposta?: unknown; form?: unknown; dono?: unknown }) {
  return {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: tabela === 'responses' ? (t.resposta ?? null)
              : tabela === 'forms' ? (t.form ?? null)
              : (t.dono ?? null),
          }),
        }),
      }),
    }),
  }
}

const RESPOSTA = { id: 'r1', answers: { q: 'v' }, submitted_at: '2026-08-11T10:00:00Z' }
const FORM = {
  id: 'f1', title: 'Contato', user_id: 'u1', questions: [],
  notify_email: null, notify_email_enabled: false, notify_owner_enabled: true,
}
const DONO = { email: 'dono@cliente.com' }
const REQ = { headers: { get: (k: string) => (k === 'authorization' ? 'Bearer segredo' : null) } } as never

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'segredo'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave'
  filaMocks.marcarTentativaFalha.mockResolvedValue('reagendado')
  envioMocks.sendNewResponseEmails.mockResolvedValue([{ role: 'owner' }] as never)
})

describe('dreno — autenticação', () => {
  it('sem o segredo do cron: 401 e nem lê a fila', async () => {
    const res = await GET({ headers: { get: () => null } } as never)
    expect(res.status).toBe(401)
    expect(filaMocks.lerPendentes).not.toHaveBeenCalled()
  })
})

describe('dreno — o caminho feliz', () => {
  it('remonta do banco e reenvia; item vira enviado', async () => {
    filaMocks.lerPendentes.mockResolvedValue([ITEM])
    mockCreate.mockReturnValue(makeDb({ resposta: RESPOSTA, form: FORM, dono: DONO }) as never)

    const body = await (await GET(REQ)).json() as { enviados: number }

    expect(body.enviados).toBe(1)
    expect(filaMocks.marcarEnviado).toHaveBeenCalledWith('q1')
    // o destinatário saiu do banco AGORA, não da fila
    const [{ recipients }] = envioMocks.sendNewResponseEmails.mock.calls[0] as unknown as [{ recipients: Array<{ email: string }> }]
    expect(recipients[0].email).toBe('dono@cliente.com')
  })

  it('🛡️ e-mail do dono TROCADO depois da falha → reenvio vai para o endereço NOVO', async () => {
    // É o que o desenho de referência compra: a fila não lembra endereço nenhum.
    filaMocks.lerPendentes.mockResolvedValue([ITEM])
    mockCreate.mockReturnValue(makeDb({ resposta: RESPOSTA, form: FORM, dono: { email: 'novo@cliente.com' } }) as never)

    await GET(REQ)

    const [{ recipients }] = envioMocks.sendNewResponseEmails.mock.calls[0] as unknown as [{ recipients: Array<{ email: string }> }]
    expect(recipients[0].email).toBe('novo@cliente.com')
  })
})

describe('dreno — o que NÃO deve ser reenviado', () => {
  it('🛡️ resposta APAGADA → descartado sem tentar (a exclusão é respeitada)', async () => {
    // ⚠️ O form e o dono EXISTEM de propósito: com eles ausentes, quem descartava era a guarda
    // seguinte, e este teste passava mesmo com a guarda da resposta desligada (pego na sabotagem).
    filaMocks.lerPendentes.mockResolvedValue([ITEM])
    mockCreate.mockReturnValue(makeDb({ resposta: null, form: FORM, dono: DONO }) as never)

    const body = await (await GET(REQ)).json() as { descartados: number }

    expect(body.descartados).toBe(1)
    expect(envioMocks.sendNewResponseEmails).not.toHaveBeenCalled()
    expect(filaMocks.descartarSemAlvo).toHaveBeenCalled()
  })

  it('formulário apagado → descartado sem tentar', async () => {
    filaMocks.lerPendentes.mockResolvedValue([ITEM])
    mockCreate.mockReturnValue(makeDb({ resposta: RESPOSTA, form: null }) as never)

    const body = await (await GET(REQ)).json() as { descartados: number }
    expect(body.descartados).toBe(1)
    expect(envioMocks.sendNewResponseEmails).not.toHaveBeenCalled()
  })

  it('🛡️ dono DESLIGOU a notificação depois da falha → descartado (vale a config de hoje)', async () => {
    // Aqui sobra o outro destinatário (form_email), então o descarte só pode vir do filtro por
    // PAPEL — não de "não há destinatário nenhum".
    filaMocks.lerPendentes.mockResolvedValue([ITEM])
    mockCreate.mockReturnValue(makeDb({
      resposta: RESPOSTA,
      form: { ...FORM, notify_owner_enabled: false, notify_email: 'extra@cliente.com', notify_email_enabled: true },
      dono: DONO,
    }) as never)

    const body = await (await GET(REQ)).json() as { descartados: number }
    expect(body.descartados).toBe(1)
    expect(envioMocks.sendNewResponseEmails).not.toHaveBeenCalled()
  })

  it('🛡️ reenvia SÓ o papel que falhou — o outro destinatário não recebe cópia', async () => {
    // Sem o filtro por papel, quem já tinha recebido o e-mail na 1ª vez levaria uma cópia a cada
    // reenvio do outro. O item da fila é (resposta, papel), e o envio tem de respeitar isso.
    filaMocks.lerPendentes.mockResolvedValue([ITEM]) // role: 'owner'
    mockCreate.mockReturnValue(makeDb({
      resposta: RESPOSTA,
      form: { ...FORM, notify_email: 'extra@cliente.com', notify_email_enabled: true },
      dono: DONO,
    }) as never)

    await GET(REQ)

    const [{ recipients }] = envioMocks.sendNewResponseEmails.mock.calls[0] as unknown as [{ recipients: Array<{ email: string; role: string }> }]
    expect(recipients).toHaveLength(1)
    expect(recipients[0].role).toBe('owner')
    expect(recipients.map((r) => r.email)).not.toContain('extra@cliente.com')
  })
})

describe('dreno — falha e fim da janela', () => {
  it('nova falha dentro da janela → reagendado, sem avisar ninguém', async () => {
    filaMocks.lerPendentes.mockResolvedValue([ITEM])
    mockCreate.mockReturnValue(makeDb({ resposta: RESPOSTA, form: FORM, dono: DONO }) as never)
    envioMocks.sendNewResponseEmails.mockResolvedValue([{ role: 'owner', error: 'resend 503' }] as never)

    const body = await (await GET(REQ)).json() as { reagendados: number }

    expect(body.reagendados).toBe(1)
    expect(mockWpp).not.toHaveBeenCalled() // aviso a cada tentativa seria spam
  })

  it('🛡️ fim da janela de 48h → morto E avisa por WhatsApp, SEM dado do lead na mensagem', async () => {
    filaMocks.lerPendentes.mockResolvedValue([ITEM])
    mockCreate.mockReturnValue(makeDb({ resposta: RESPOSTA, form: FORM, dono: DONO }) as never)
    envioMocks.sendNewResponseEmails.mockResolvedValue([{ role: 'owner', error: 'resend 503' }] as never)
    filaMocks.marcarTentativaFalha.mockResolvedValue('morto')

    const body = await (await GET(REQ)).json() as { mortos: number }

    expect(body.mortos).toBe(1)
    expect(mockWpp).toHaveBeenCalledTimes(1)
    const texto = String(mockWpp.mock.calls[0][0])
    expect(texto).toContain('r1')                    // referência: sim
    expect(texto).not.toContain('dono@cliente.com')  // dado pessoal: não
    expect(texto).toMatch(/salvo no painel/i)        // o dono precisa saber que o lead não sumiu
  })

  it('um item que explode NÃO derruba o dreno — os outros seguem', async () => {
    filaMocks.lerPendentes.mockResolvedValue([ITEM, { ...ITEM, id: 'q2', response_id: 'r2' }])
    let n = 0
    mockCreate.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
        n++
        if (n === 1) throw new Error('banco piscou')
        return { data: n === 2 ? RESPOSTA : n === 3 ? FORM : DONO }
      } }) }) }),
    } as never)

    const body = await (await GET(REQ)).json() as { total: number; enviados: number; reagendados: number }

    expect(body.total).toBe(2)
    expect(body.enviados + body.reagendados).toBe(2) // nenhum item se perdeu
  })
})
