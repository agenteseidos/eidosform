import { describe, it, expect } from 'vitest'
import { formatAnswerValue, NON_ANSWER_QUESTION_TYPES } from './answer-format'

describe('formatAnswerValue', () => {
  it('nunca emite [object Object] para NENHUM shape', () => {
    const shapes: unknown[] = [
      { name: 'a.pdf', url: 'https://x/a.pdf', size: 1, type: 'application/pdf' },
      { cep: '58000-000', rua: 'Rua X', numero: '10', complemento: '', bairro: 'Centro', cidade: 'JP', estado: 'PB' },
      { event_uri: 'https://api.calendly.com/scheduled_events/abc' },
      { qualquer: 'coisa', aninhado: { a: 1 } },
      [{ name: 'b.png', url: 'https://x/b.png' }],
    ]
    for (const s of shapes) {
      const out = formatAnswerValue(s)
      expect(out).not.toContain('[object Object]')
      expect(out.length).toBeGreaterThan(0)
    }
  })

  it('file_upload: 📎 nome + url no whatsapp; nome (url) no export', () => {
    const f = { name: 'contrato.pdf', url: 'https://cdn/x.pdf', size: 123, type: 'application/pdf' }
    expect(formatAnswerValue(f, { sink: 'whatsapp' })).toBe('📎 contrato.pdf\nhttps://cdn/x.pdf')
    expect(formatAnswerValue(f, { sink: 'export' })).toBe('contrato.pdf (https://cdn/x.pdf)')
  })

  it('file sem nome usa a url; array de arquivos = um por linha no whatsapp', () => {
    expect(formatAnswerValue({ url: 'https://cdn/x.pdf', size: 1 })).toBe('📎 https://cdn/x.pdf')
    const arr = [{ name: 'a.pdf', url: 'u1', size: 1 }, { name: 'b.pdf', url: 'u2', size: 2 }]
    expect(formatAnswerValue(arr, { sink: 'whatsapp' })).toBe('📎 a.pdf\nu1\n📎 b.pdf\nu2')
  })

  it('address: linha legível, partes ausentes omitidas', () => {
    expect(formatAnswerValue({
      cep: '58000-000', rua: 'Av. Epitácio', numero: '100', complemento: 'Sala 2',
      bairro: 'Tambaú', cidade: 'João Pessoa', estado: 'PB',
    })).toBe('Av. Epitácio, 100 - Sala 2, Tambaú, João Pessoa/PB, CEP 58000-000')
    expect(formatAnswerValue({ rua: 'Rua Só', cidade: 'JP' })).toBe('Rua Só, JP')
  })

  it('calendly whatsapp: URI de API é OMITIDA (não é link clicável — só o ✅)', () => {
    // api.calendly.com = endpoint autenticado; abrir no navegador dá "Unauthenticated".
    // No WhatsApp NÃO pode aparecer (link quebrado engana o vendedor).
    expect(formatAnswerValue('https://api.calendly.com/scheduled_events/xyz'))
      .toBe('✅ Agendamento realizado')
    expect(formatAnswerValue({ event_uri: 'https://api.calendly.com/scheduled_events/abc' }))
      .toBe('✅ Agendamento realizado')
    expect(formatAnswerValue('scheduled')).toBe('✅ Agendamento realizado')
    // string comum NÃO vira agendamento
    expect(formatAnswerValue('texto normal')).toBe('texto normal')
  })

  it('calendly whatsapp: página VIEWÁVEL (não-api) mantém o link', () => {
    expect(formatAnswerValue('https://calendly.com/fulano/30min'))
      .toBe('✅ Agendamento realizado\nhttps://calendly.com/fulano/30min')
  })

  it('calendly export: mantém a URI (mesmo de API) como rastro', () => {
    expect(formatAnswerValue({ event_uri: 'https://api.calendly.com/e/1', invitee_uri: 'https://api.calendly.com/i/2' }, { sink: 'export' }))
      .toBe('Agendamento realizado (https://api.calendly.com/e/1)')
    expect(formatAnswerValue('scheduled', { sink: 'export' })).toBe('Agendamento realizado')
  })

  it('primitivos e arrays simples preservam comportamento', () => {
    expect(formatAnswerValue('  oi  ')).toBe('oi')
    expect(formatAnswerValue(7)).toBe('7')
    expect(formatAnswerValue(true)).toBe('Sim')
    expect(formatAnswerValue(['a', 'b'])).toBe('a, b')
    expect(formatAnswerValue(null)).toBe('')
    expect(formatAnswerValue(undefined)).toBe('')
  })

  it('objeto desconhecido vira chave: valor', () => {
    expect(formatAnswerValue({ plano: 'plus', ciclo: 'anual' })).toBe('plano: plus, ciclo: anual')
  })

  it('html/content blocks são marcados como não-resposta', () => {
    expect(NON_ANSWER_QUESTION_TYPES.has('html_block')).toBe(true)
    expect(NON_ANSWER_QUESTION_TYPES.has('content_block')).toBe(true)
    expect(NON_ANSWER_QUESTION_TYPES.has('short_text')).toBe(false)
  })
})
