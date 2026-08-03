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
    expect(r).toEqual({ sent: false, skipped: 'no_credentials' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sem telefone (ex.: conta OAuth): pula em silêncio', async () => {
    const r = await sendConfirmationTemplate({ toPhone: null, template: 'x', bodyParams: [], context: 't' })
    expect(r).toEqual({ sent: false, skipped: 'no_phone' })
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

  it('erro do Graph (ex.: template ainda PENDING): loga alto e devolve send_failed', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'Template not approved', code: 132001 } }) })
    const r = await sendConfirmationTemplate({ toPhone: '83999376704', template: 'x', bodyParams: [], context: 't' })
    expect(r).toEqual({ sent: false, skipped: 'send_failed' })
    expect(vi.mocked(logError)).toHaveBeenCalled()
  })

  it('exceção de rede: capturada, nunca propaga', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'))
    const r = await sendConfirmationTemplate({ toPhone: '83999376704', template: 'x', bodyParams: [], context: 't' })
    expect(r).toEqual({ sent: false, skipped: 'exception' })
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
    expect(r).toEqual({ sent: false, skipped: 'no_profile' })
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
