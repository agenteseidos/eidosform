import { describe, it, expect } from 'vitest'
import {
  conferirContratoHero, recomendarPlano, HERO_FORM_ID, HERO_OWNER_ID, HERO_Q,
  HERO_OBJETIVOS, HERO_VOLUMES,
} from './config'

/**
 * O contrato do formulário do hero.
 *
 * POR QUE ELE EXISTE: a landing grava respostas usando IDs de pergunta pinados. Se alguém apagar,
 * recriar ou reordenar o formulário no painel, os IDs mudam — e sem esta trava a página passaria
 * a gravar **o nome no campo de e-mail**, em silêncio, até alguém abrir o painel e não entender
 * nada. O contrato falha ALTO e ANTES do visitante começar.
 */
const formOk = {
  id: HERO_FORM_ID,
  user_id: HERO_OWNER_ID,
  status: 'published',
  is_closed: false,
  paused: false,
  notify_owner_enabled: false,
  notify_email_enabled: false,
  google_sheets_enabled: false,
  pixels: null,
  questions: [
    { id: HERO_Q.nome, type: 'short_text', required: true },
    { id: HERO_Q.whatsapp, type: 'phone', required: true },
    { id: HERO_Q.email, type: 'email', required: true },
    { id: HERO_Q.objetivo, type: 'multiple_choice', required: true, options: [...HERO_OBJETIVOS] },
    { id: HERO_Q.volume, type: 'multiple_choice', required: true, options: [...HERO_VOLUMES] },
  ],
}

describe('conferirContratoHero', () => {
  it('aceita o formulário íntegro', () => {
    expect(conferirContratoHero(formOk)).toEqual({ ok: true })
  })

  it('recusa formulário ausente, de outro dono ou não publicado', () => {
    expect(conferirContratoHero(null).ok).toBe(false)
    expect(conferirContratoHero({ ...formOk, user_id: 'outro' }).ok).toBe(false)
    expect(conferirContratoHero({ ...formOk, status: 'draft' }).ok).toBe(false)
    expect(conferirContratoHero({ ...formOk, id: 'outro-id' }).ok).toBe(false)
  })

  it('recusa formulário fechado ou pausado', () => {
    expect(conferirContratoHero({ ...formOk, is_closed: true }).ok).toBe(false)
    expect(conferirContratoHero({ ...formOk, paused: true }).ok).toBe(false)
  })

  /** O defeito que o parecer independente pegou no seed: notificação LIGADA por omissão. */
  it('recusa se qualquer notificação estiver ligada — a demo não pode virar spam do dono', () => {
    expect(conferirContratoHero({ ...formOk, notify_owner_enabled: true }).ok).toBe(false)
    expect(conferirContratoHero({ ...formOk, notify_email_enabled: true }).ok).toBe(false)
    expect(conferirContratoHero({ ...formOk, google_sheets_enabled: true }).ok).toBe(false)
  })

  it('recusa se aparecer pixel nesta conta — a demo não gera CAPI de ninguém', () => {
    expect(conferirContratoHero({ ...formOk, pixels: { metaPixelId: '123456789012345' } }).ok).toBe(false)
  })

  /** ⚠️ O TESTE QUE MAIS IMPORTA: ordem trocada grava resposta no campo errado. */
  it('recusa perguntas reordenadas, com id trocado ou tipo divergente', () => {
    const invertido = { ...formOk, questions: [formOk.questions[1], formOk.questions[0], ...formOk.questions.slice(2)] }
    expect(conferirContratoHero(invertido).ok).toBe(false)

    const idTrocado = { ...formOk, questions: formOk.questions.map((q, i) => i === 2 ? { ...q, id: 'outro' } : q) }
    expect(conferirContratoHero(idTrocado).ok).toBe(false)

    const tipoTrocado = { ...formOk, questions: formOk.questions.map((q, i) => i === 1 ? { ...q, type: 'short_text' } : q) }
    expect(conferirContratoHero(tipoTrocado).ok).toBe(false)
  })

  it('recusa pergunta que deixou de ser obrigatória', () => {
    const solto = { ...formOk, questions: formOk.questions.map((q, i) => i === 0 ? { ...q, required: false } : q) }
    expect(conferirContratoHero(solto).ok).toBe(false)
  })

  it('recusa contagem de perguntas diferente', () => {
    expect(conferirContratoHero({ ...formOk, questions: formOk.questions.slice(0, 4) }).ok).toBe(false)
  })

  it('recusa opções alteradas — elas alimentam a recomendação de plano', () => {
    const opcoesTortas = {
      ...formOk,
      questions: formOk.questions.map((q, i) => i === 4 ? { ...q, options: ['Pouco', 'Muito'] } : q),
    }
    expect(conferirContratoHero(opcoesTortas).ok).toBe(false)
  })
})

describe('recomendarPlano', () => {
  /** ⚠️ REGRA DURA DO SIDNEY: nunca recomendar o Free. */
  it('NUNCA recomenda o plano Free, nem no menor volume', () => {
    for (const v of HERO_VOLUMES) {
      expect(recomendarPlano(v).plano).not.toMatch(/free/i)
    }
    expect(recomendarPlano('Até 100').plano).toBe('Starter')
  })

  it('mapeia cada volume ao plano que comporta', () => {
    expect(recomendarPlano('Até 1.000').plano).toBe('Starter')
    expect(recomendarPlano('Até 5.000').plano).toBe('Plus')
    expect(recomendarPlano('Mais de 5.000').plano).toBe('Professional')
  })

  it('volume desconhecido ou ausente cai num padrão seguro, nunca em Free', () => {
    for (const v of [null, undefined, '', 'lixo']) {
      expect(recomendarPlano(v).plano).not.toMatch(/free/i)
    }
  })
})
