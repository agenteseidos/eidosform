import { describe, it, expect } from 'vitest'
import { buildLeadData } from './integration-stubs'

const form = {
  id: 'f', title: 'Form', user_id: 'u',
  questions: [
    { id: 'nome', type: 'short_text', title: 'Qual seu nome?' },
    { id: 'empresa', type: 'short_text', title: 'Telefone da empresa' },
    { id: 'end', type: 'address', title: 'Endereço' },
  ],
}

describe('buildLeadData — identidade e precedência (bug real 23/07)', () => {
  it('telefone da CAMPANHA (url_params) vence "telefone da empresa" (fuzzy)', () => {
    const lead = buildLeadData({
      formId: 'f', responseId: 'r', appUrl: 'https://x', form,
      urlParams: { nome: 'maria fernanda', telefone: '5511988887777', email: 'maria@x.com' },
      responseData: { nome: '', empresa: '8332221100' },
    })
    expect(lead.phone).toBe('5511988887777')      // NÃO 8332221100
    expect(lead.nome).toBe('Maria')               // veio da URL
    expect(lead.email).toBe('maria@x.com')
  })

  it('mas uma pergunta de tipo phone REAL respondida vence a URL', () => {
    const lead = buildLeadData({
      formId: 'f', responseId: 'r', appUrl: 'https://x',
      form: { ...form, questions: [{ id: 'tel', type: 'phone', title: 'Seu WhatsApp?' }] },
      urlParams: { telefone: '5511988887777' },
      responseData: { tel: '5583912345678' },
    })
    expect(lead.phone).toBe('5583912345678')      // o que o lead digitou
  })

  it('P2-4: segunda pergunta do MESMO tipo é usada quando a primeira veio vazia', () => {
    // Antes: `.find()` parava na primeira pergunta tipo phone mesmo VAZIA e o
    // telefone que o lead realmente preencheu era ignorado.
    const lead = buildLeadData({
      formId: 'f', responseId: 'r', appUrl: 'https://x',
      form: { id: 'f', title: 'F', user_id: 'u', questions: [
        { id: 'tel1', type: 'phone', title: 'Telefone fixo (opcional)' },
        { id: 'tel2', type: 'phone', title: 'Seu WhatsApp?' },
      ] },
      responseData: { tel1: '   ', tel2: '5583999376704' },
    })
    expect(lead.phone).toBe('5583999376704')
  })

  it('title reservado não sobrescreve o phone canônico (spread de mappedAnswers primeiro)', () => {
    const lead = buildLeadData({
      formId: 'f', responseId: 'r', appUrl: 'https://x',
      form: { id: 'f', title: 'F', user_id: 'u', questions: [
        { id: 'x', type: 'short_text', title: 'phone' }, // título colide com a chave canônica
        { id: 'tel', type: 'phone', title: 'Seu WhatsApp?' },
      ] },
      responseData: { x: 'LIXO', tel: '5583999999999' },
    })
    expect(lead.phone).toBe('5583999999999')
  })
})
