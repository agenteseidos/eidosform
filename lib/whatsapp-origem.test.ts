import { describe, it, expect } from 'vitest'
import { buildLeadData } from './integration-stubs'
import { buildMessage } from './whatsapp-template'
import { buildNotificationModel } from './notification-model'
import { buildNewResponseEmail } from './notification-content'

/**
 * {origem} no WhatsApp — paridade com o e-mail (pedido do Sidney, 2026-07-30).
 *
 * Os {utm_source}/{utm_campaign}/... individuais resolvem para string VAZIA
 * quando o lead chega sem UTM, deixando lixo do tipo "📍 Origem:  ·" em toda
 * notificação. O e-mail já resolvia isso escondendo a linha; o WhatsApp não
 * tinha equivalente. {origem} usa a MESMA função (`utmParts`) e a mesma linha
 * de self-hide de {meta_events}.
 */

const form = {
  id: 'f1',
  title: 'Pesquisa RCGT0826',
  user_id: 'u1',
  questions: [
    { id: 'q1', type: 'short_text', title: 'Qual seu nome:' },
    { id: 'q2', type: 'multiple_choice', title: 'Você possui cartão de crédito?' },
  ],
}
const responseData = { q1: 'Eliana Cristina', q2: 'Sim' }

const UTM_COMPLETA = {
  utm_source: 'manychat',
  utm_medium: 'organico',
  utm_campaign: 'rcgt0826',
  utm_term: 'termo',
  utm_content: 'criativo-a',
}

type Utm = Partial<typeof UTM_COMPLETA>

function lead(utm?: Utm) {
  return buildLeadData({
    formId: 'f1',
    responseId: 'r1',
    responseData,
    form: form as never,
    appUrl: 'https://eidosform.com.br',
    ...(utm ? { utm } : {}),
  } as never)
}

function email(utm?: Utm) {
  return buildNewResponseEmail(
    buildNotificationModel({
      responseId: 'r1',
      responseData,
      form: form as never,
      appUrl: 'https://eidosform.com.br',
      eventAt: '2026-07-30T22:13:00.000Z',
      ...(utm ? { utm } : {}),
    } as never)
  )
}

const TEMPLATE = ['🔔 Novo lead em {form_name}', '📍 Origem: {origem}', '🕒 {data}'].join('\n')

describe('{origem} no WhatsApp', () => {
  it('junta as UTMs presentes na ordem canônica, separadas por " · "', () => {
    expect(lead(UTM_COMPLETA).origem).toBe('manychat · organico · rcgt0826 · termo · criativo-a')
  })

  it('inclui só o que veio preenchido (não deixa buraco entre separadores)', () => {
    expect(lead({ utm_source: 'manychat', utm_campaign: 'rcgt0826' }).origem).toBe(
      'manychat · rcgt0826'
    )
  })

  it('APAGA a linha inteira quando o lead chegou sem UTM', () => {
    const msg = buildMessage(TEMPLATE, lead())
    expect(msg).not.toContain('Origem')
    expect(msg).not.toContain('·')
    // as outras linhas seguem intactas
    expect(msg).toContain('Novo lead em')
    expect(msg).toContain('🕒')
  })

  it('mantém a linha quando há ao menos uma UTM', () => {
    expect(buildMessage(TEMPLATE, lead({ utm_source: 'manychat' }))).toContain('📍 Origem: manychat')
  })

  it('não quebra os {utm_*} individuais que já existiam', () => {
    const l = lead(UTM_COMPLETA)
    expect(buildMessage('{utm_source}/{utm_campaign}', l)).toBe('manychat/rcgt0826')
  })

  it('PARIDADE: WhatsApp e e-mail mostram exatamente a mesma origem', () => {
    const origemWpp = String(lead(UTM_COMPLETA).origem)
    const corpoEmail = email(UTM_COMPLETA).text
    expect(corpoEmail).toContain(`Origem: ${origemWpp}`)
  })

  it('PARIDADE: sem UTM, os DOIS omitem a origem', () => {
    expect(buildMessage(TEMPLATE, lead())).not.toContain('Origem')
    expect(email().text).not.toContain('Origem')
  })
})
