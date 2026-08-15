import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

import {
  sendConfirmationTemplate, planLabel, brDate,
  notifyPlanoAtivado, notifyAssinaturaCancelada,
  CONFIRMATION_TEMPLATES,
} from './whatsapp-confirmations'
import { createAdminClient } from '@/lib/supabase/admin'
import { logError } from '@/lib/logger'

const mockAdmin = vi.mocked(createAdminClient)
const fetchMock = vi.fn()

function mockProfile(p: Record<string, unknown> | null) {
  mockAdmin.mockReturnValue({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: p }) }) }) }),
  } as never)
}

function graphOk() {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ messages: [{ id: 'wamid.TEST' }] }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  process.env.WHATSAPP_CLOUD_TOKEN = 'token-teste'
  process.env.WHATSAPP_CLOUD_PHONE_ID = '111222333'
  delete process.env.ELEN_OPTOUT_CHECK_URL
  // O espelho ao dono fica DESLIGADO por padrão nos testes antigos — eles contam chamadas de
  // fetch e o ping extra mudaria a contagem. O bloco próprio liga a env de propósito.
  delete process.env.ADMIN_ALERT_WHATSAPP
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('planLabel / brDate', () => {
  it('monta rótulos pt-BR com ciclo', () => {
    expect(planLabel('starter', 'MONTHLY')).toBe('Starter Mensal')
    expect(planLabel('plus', 'YEARLY')).toBe('Plus Anual')
    expect(planLabel('plus', null)).toBe('Plus')       // grant manual
    expect(planLabel('free', null)).toBe('Gratuito')
  })

  it('brDate formata em Brasília e rejeita lixo', () => {
    // fim do dia 29/08 BRT gravado como 30/08 02:59 UTC → exibe 29/08
    expect(brDate('2026-08-30T02:59:59+00:00')).toBe('29/08/2026')
    expect(brDate(null)).toBeNull()
    expect(brDate('não-é-data')).toBeNull()
  })
})

describe('sendConfirmationTemplate — nunca quebra a ação principal', () => {
  it('sem credenciais: pula com log, sem lançar', async () => {
    delete process.env.WHATSAPP_CLOUD_TOKEN
    const r = await sendConfirmationTemplate({ toPhone: '83999376704', template: 'x', bodyParams: [], context: 't' })
    expect(r).toEqual({ sent: false, skipped: 'no_credentials', desfecho: 'nao_tentado' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sem telefone (ex.: conta OAuth): pula em silêncio', async () => {
    const r = await sendConfirmationTemplate({ toPhone: null, template: 'x', bodyParams: [], context: 't' })
    expect(r).toEqual({ sent: false, skipped: 'no_phone', desfecho: 'nao_tentado' })
  })

  it('envia template com número normalizado (55 + dígitos) e params na ordem', async () => {
    graphOk()
    const r = await sendConfirmationTemplate({
      toPhone: '(83) 99937-6704',
      template: 'eidosform_plano_ativado',
      bodyParams: ['Sidney', 'Starter Mensal', '30/08/2026'],
      context: 'teste',
    })
    expect(r.sent).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v21.0/111222333/messages')
    const body = JSON.parse(init.body)
    expect(body.to).toBe('5583999376704')
    expect(body.template.name).toBe('eidosform_plano_ativado')
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text))
      .toEqual(['Sidney', 'Starter Mensal', '30/08/2026'])
  })

  it('template com URL dinâmica recebe somente o parâmetro do botão', async () => {
    graphOk()
    await sendConfirmationTemplate({
      toPhone: '83999376704',
      template: 'eidosform_cobranca_v1',
      bodyParams: ['Sidney', 'Plus Mensal', 'Faltam 4 dias.'],
      buttonUrlParam: 'token.assinado',
      context: 'dunning:1:p1',
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.template.components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Sidney' },
          { type: 'text', text: 'Plus Mensal' },
          { type: 'text', text: 'Faltam 4 dias.' },
        ],
      },
      {
        type: 'button', sub_type: 'url', index: '0',
        parameters: [{ type: 'text', text: 'token.assinado' }],
      },
    ])
  })

  it('erro do Graph (ex.: template ainda PENDING): loga alto e devolve send_failed', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'Template not approved', code: 132001 } }) })
    const r = await sendConfirmationTemplate({ toPhone: '83999376704', template: 'x', bodyParams: [], context: 't' })
    expect(r).toEqual({ sent: false, skipped: 'send_failed', desfecho: 'recusado' })
    expect(vi.mocked(logError)).toHaveBeenCalled()
  })

  it('exceção de rede: capturada, nunca propaga', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'))
    const r = await sendConfirmationTemplate({ toPhone: '83999376704', template: 'x', bodyParams: [], context: 't' })
    expect(r).toEqual({ sent: false, skipped: 'exception', desfecho: 'desconhecido' })
  })
})

describe('notify* — busca o perfil e monta os params', () => {
  it('plano ativado usa primeiro nome, rótulo com ciclo e data BRT da expiração', async () => {
    mockProfile({ phone: '5583999376704', full_name: 'Sidney Crystian', plan: 'starter', plan_cycle: 'MONTHLY', plan_expires_at: '2026-08-30T02:59:59+00:00' })
    graphOk()
    const r = await notifyPlanoAtivado('user-1')
    expect(r.sent).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.template.name).toBe(CONFIRMATION_TEMPLATES.planoAtivado)
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text))
      .toEqual(['Sidney', 'Starter Mensal', '29/08/2026'])
  })

  it('cancelamento aceita accessUntil custom ("hoje" do admin)', async () => {
    mockProfile({ phone: '5583999376704', full_name: 'Sidney', plan: 'free', plan_cycle: null, plan_expires_at: null })
    graphOk()
    const r = await notifyAssinaturaCancelada('user-1', { planLabel: 'Plus', accessUntil: 'hoje' })
    expect(r.sent).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text))
      .toEqual(['Sidney', 'Plus', 'hoje'])
  })

  it('perfil inexistente: pula sem lançar', async () => {
    mockProfile(null)
    const r = await notifyPlanoAtivado('ghost')
    expect(r).toEqual({ sent: false, skipped: 'no_profile', desfecho: 'nao_tentado' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('templates _v2 (mesa 2026-08-03)', () => {
  it('TODAS as constantes apontam pros _v2 com botão — NUNCA regredir pros v1', () => {
    for (const [key, name] of Object.entries(CONFIRMATION_TEMPLATES)) {
      expect(name, `CONFIRMATION_TEMPLATES.${key}`).toMatch(/_v2$/)
    }
  })
})

describe('saudação institucional (lote 05/08)', () => {
  it('nome de PESSOA → primeiro nome; EMPRESA → neutro; vazio → neutro', async () => {
    const { firstName } = await import('./whatsapp-confirmations')
    expect(firstName('Sidney Crystian Medeiros')).toBe('Sidney')
    expect(firstName('Instituto Eidos')).toBe('tudo bem')
    expect(firstName('Clínica Vida Plena')).toBe('tudo bem')
    expect(firstName('Agência Grilo')).toBe('tudo bem')
    expect(firstName('')).toBe('tudo bem')
    expect(firstName(null)).toBe('tudo bem')
  })
})

/**
 * Espelho de billing no WHATSAPP DO DONO (decisão Sidney 11/08/2026).
 *
 * "Quero receber uma mensagem sempre que houver alguma alteração de pagamento — compra,
 * upgrade, downgrade, cancelamento." O aviso sai pelo serviço da VPS (o mesmo canal dos avisos
 * de lead), ANTES da confirmação ao cliente — e o teste central é exatamente este: cliente sem
 * telefone, em opt-out ou com template pendente na Meta NÃO PODE calar o aviso do dono.
 */
describe('espelho de billing ao dono (ADMIN_ALERT_WHATSAPP)', () => {
  beforeEach(() => {
    process.env.ADMIN_ALERT_WHATSAPP = '5583999999999'
    process.env.WHATSAPP_API_KEY = 'chave-vps-teste'
  })
  afterEach(() => {
    delete process.env.ADMIN_ALERT_WHATSAPP
    delete process.env.WHATSAPP_API_KEY
  })

  const chamadaVps = () =>
    fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/whatsapp/send'))

  it('cliente SEM telefone não cala o aviso do dono', async () => {
    mockProfile({ phone: null, full_name: 'Julia', email: 'julia@x.com', plan: 'plus', plan_cycle: 'MONTHLY', plan_expires_at: '2026-09-10T12:00:00.000Z' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

    const r = await notifyPlanoAtivado('p1')

    expect(r.skipped).toBe('no_phone') // a confirmação ao CLIENTE pulou…
    const vps = chamadaVps()          // …mas o DONO recebeu
    expect(vps).toBeTruthy()
    const body = JSON.parse((vps![1] as RequestInit).body as string)
    expect(body.to).toBe('5583999999999')
    expect(body.message).toContain('julia@x.com')
    expect(body.message).toContain('ATIVADO')
    expect(body.idempotencyKey).toContain('ops-billing:ativado:p1')
  })

  it('cancelamento também pinga o dono, com plano e data de acesso', async () => {
    mockProfile({ phone: null, full_name: 'Caio', email: 'caio@x.com', plan: 'starter', plan_cycle: 'MONTHLY', plan_expires_at: '2026-09-01T12:00:00.000Z' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

    await notifyAssinaturaCancelada('p2', { planLabel: 'Starter Mensal' })

    const body = JSON.parse((chamadaVps()![1] as RequestInit).body as string)
    expect(body.message).toContain('CANCELADA')
    expect(body.message).toContain('caio@x.com')
    expect(body.message).toContain('Starter Mensal')
  })

  it('sem a env, o espelho pula em silêncio e a confirmação ao cliente segue normal', async () => {
    delete process.env.ADMIN_ALERT_WHATSAPP
    mockProfile({ phone: '5583911112222', full_name: 'Ana', email: 'ana@x.com', plan: 'plus', plan_cycle: 'MONTHLY', plan_expires_at: '2026-09-10T12:00:00.000Z' })
    graphOk()

    const r = await notifyPlanoAtivado('p3')

    expect(r.sent).toBe(true)
    expect(chamadaVps()).toBeFalsy() // nenhuma chamada à VPS
  })

  it('VPS fora do ar NUNCA derruba a confirmação ao cliente', async () => {
    mockProfile({ phone: '5583911112222', full_name: 'Ana', email: 'ana@x.com', plan: 'plus', plan_cycle: 'MONTHLY', plan_expires_at: '2026-09-10T12:00:00.000Z' })
    fetchMock
      .mockRejectedValueOnce(new Error('VPS caiu'))                                 // ops ping
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'wamid.OK' }] }) }) // Graph

    const r = await notifyPlanoAtivado('p4')

    expect(r.sent).toBe(true)
  })
})

describe('🛡️ desfecho: "não saiu" e "não sei se saiu" são coisas DIFERENTES (15/08)', () => {
  it('timeout devolve desconhecido, NUNCA recusado — é o que impede o reenvio automático', async () => {
    // Antes os dois voltavam como {sent:false} indistinguíveis, e o cron tratava timeout como
    // recusa: a linha voltava para a fila e a MESMA cobrança saía de novo 10 min depois.
    process.env.WHATSAPP_CLOUD_TOKEN = 'tok'
    process.env.WHATSAPP_CLOUD_PHONE_ID = '123'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network timeout') }))

    const r = await sendConfirmationTemplate({
      toPhone: '5583999999999', template: 't', bodyParams: ['a'], context: 'c',
    })

    expect(r.desfecho).toBe('desconhecido')
    expect(r.desfecho).not.toBe('recusado')
  })

  it('entrega devolve o WAMID — sem ele não há como conferir depois se a mensagem saiu', async () => {
    process.env.WHATSAPP_CLOUD_TOKEN = 'tok'
    process.env.WHATSAPP_CLOUD_PHONE_ID = '123'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.ABC123' }] }),
    })))

    const r = await sendConfirmationTemplate({
      toPhone: '5583999999999', template: 't', bodyParams: ['a'], context: 'c',
    })

    expect(r.desfecho).toBe('entregue')
    expect(r.wamid).toBe('wamid.ABC123')
  })
})
