import { describe, it, expect } from 'vitest'
import { buildNotificationModel } from './notification-model'

const EVENT_AT = '2026-07-30T17:32:10.000Z'

const form = {
  id: 'f',
  title: 'Form',
  user_id: 'u',
  questions: [
    { id: 'nome', type: 'short_text', title: 'Qual seu nome?' },
    { id: 'empresa', type: 'short_text', title: 'Telefone da empresa' },
    { id: 'end', type: 'address', title: 'Endereço' },
  ],
}

const base = { formId: 'f', responseId: 'r', appUrl: 'https://x', eventAt: EVENT_AT }

describe('buildNotificationModel — identidade e precedência', () => {
  it('telefone da CAMPANHA (url_params) vence "telefone da empresa" (fuzzy)', () => {
    const m = buildNotificationModel({
      ...base, form,
      urlParams: { nome: 'maria fernanda', telefone: '5511988887777', email: 'maria@x.com' },
      responseData: { nome: '', empresa: '8332221100' },
    })
    expect(m.identity.phone).toBe('5511988887777') // NÃO 8332221100
    expect(m.identity.firstName).toBe('Maria')
    expect(m.identity.fullName).toBe('Maria Fernanda')
    expect(m.identity.email).toBe('maria@x.com')
  })

  it('pergunta de tipo phone REAL respondida vence a URL', () => {
    const m = buildNotificationModel({
      ...base,
      form: { ...form, questions: [{ id: 'tel', type: 'phone', title: 'Seu WhatsApp?' }] },
      urlParams: { telefone: '5511988887777' },
      responseData: { tel: '5583912345678' },
    })
    expect(m.identity.phone).toBe('5583912345678')
  })

  it('segunda pergunta do MESMO tipo é usada quando a primeira veio vazia (P2-4)', () => {
    const m = buildNotificationModel({
      ...base,
      form: { id: 'f', title: 'F', user_id: 'u', questions: [
        { id: 'tel1', type: 'phone', title: 'Telefone fixo (opcional)' },
        { id: 'tel2', type: 'phone', title: 'Seu WhatsApp?' },
      ] },
      responseData: { tel1: '   ', tel2: '5583999376704' },
    })
    expect(m.identity.phone).toBe('5583999376704')
  })

  it('sem nenhum nome: firstName é "Lead" e fullName não existe', () => {
    const m = buildNotificationModel({
      ...base,
      form: { id: 'f', title: 'F', user_id: 'u', questions: [{ id: 'x', type: 'long_text', title: 'Conta aí' }] },
      responseData: { x: 'oi' },
    })
    expect(m.identity.firstName).toBe('Lead')
    expect(m.identity.fullName).toBeUndefined()
  })
})

describe('buildNotificationModel — natureza neutra', () => {
  it('os pares NÃO carregam Markdown de WhatsApp nem emoji de canal', () => {
    const m = buildNotificationModel({
      ...base, form,
      responseData: {
        nome: 'maria',
        end: { rua: 'Rua A', numero: '10', cidade: 'JP', estado: 'PB' },
      },
    })
    const serialized = JSON.stringify(m.answers)
    expect(serialized).not.toContain('*')
    expect(serialized).not.toContain('📎')
    expect(serialized).not.toContain('✅')
    expect(m.answers.find((a) => a.question === 'Qual seu nome?')?.value).toBe('maria')
  })

  it('anexo vira texto legível — nunca [object Object]', () => {
    const m = buildNotificationModel({
      ...base,
      form: { id: 'f', title: 'F', user_id: 'u', questions: [{ id: 'arq', type: 'file_upload', title: 'Anexo' }] },
      responseData: { arq: { name: 'exame.pdf', url: 'https://cdn.x/exame.pdf' } },
    })
    expect(m.answers[0].value).toBe('exame.pdf (https://cdn.x/exame.pdf)')
    expect(m.answers[0].value).not.toContain('[object Object]')
  })

  it('blocos de conteúdo não são dados de lead e ficam fora', () => {
    const m = buildNotificationModel({
      ...base,
      form: { id: 'f', title: 'F', user_id: 'u', questions: [
        { id: 'bloco', type: 'html_block', title: 'Decorativo' },
        { id: 'q', type: 'short_text', title: 'Pergunta' },
      ] },
      responseData: { bloco: 'lixo', q: 'valor' },
    })
    expect(m.answers.map((a) => a.question)).toEqual(['Pergunta'])
  })

  it('usa o horário PERSISTIDO, sem tocar no relógio', () => {
    const m = buildNotificationModel({ ...base, form, responseData: {} })
    expect(m.response.eventAt).toBe(EVENT_AT)
  })

  it('conversionEvents descarta entradas vazias e preserva os nomes registrados', () => {
    const m = buildNotificationModel({
      ...base, form, responseData: {},
      metaEvents: ['Lead', '', '  ', 'LeadQualificado'],
    })
    expect(m.conversionEvents).toEqual(['Lead', 'LeadQualificado'])
  })

  it('utm só traz o que existe (permite self-hide no canal)', () => {
    const semUtm = buildNotificationModel({ ...base, form, responseData: {}, utm: null })
    expect(semUtm.utm).toEqual({})
    const comUtm = buildNotificationModel({
      ...base, form, responseData: {},
      utm: { utm_source: 'facebook', utm_medium: null, utm_campaign: '', utm_term: null, utm_content: null },
    })
    expect(comUtm.utm).toEqual({ source: 'facebook' })
  })
})
