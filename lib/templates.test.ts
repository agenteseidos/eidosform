import { describe, it, expect } from 'vitest'
import { templates, getTemplateById, buildTemplateQuestions } from './templates'
import { questionTypes } from './questions'

const VALID_TYPES = new Set(questionTypes.map((qt) => qt.type))

describe('getTemplateById', () => {
  it('retorna o template pelo id', () => {
    const t = getTemplateById('lead-capture')
    expect(t?.name).toBe('Captura de Leads')
  })

  it('retorna undefined para id desconhecido', () => {
    expect(getTemplateById('nao-existe')).toBeUndefined()
  })
})

describe('buildTemplateQuestions', () => {
  it('preserva a quantidade de perguntas do template', () => {
    for (const template of templates) {
      const built = buildTemplateQuestions(template)
      expect(built).toHaveLength(template.questions.length)
    }
  })

  it('nunca emite um tipo inválido — todo tipo existe no schema real', () => {
    for (const template of templates) {
      for (const q of buildTemplateQuestions(template)) {
        expect(VALID_TYPES.has(q.type)).toBe(true)
      }
    }
  })

  it('mapeia multiple_choice → dropdown preservando as opções', () => {
    for (const template of templates) {
      const built = buildTemplateQuestions(template)
      template.questions.forEach((src, i) => {
        if (src.type === 'multiple_choice') {
          expect(built[i].type).toBe('dropdown')
          expect(built[i].options).toEqual(src.options)
        }
      })
    }
  })

  it('mapeia min/max do template para minValue/maxValue (inclui NPS 0–10)', () => {
    const nps = getTemplateById('nps')!
    const built = buildTemplateQuestions(nps)
    const rating = built[0]
    expect(rating.type).toBe('rating')
    expect(rating.minValue).toBe(0)
    expect(rating.maxValue).toBe(10)
  })

  it('gera ids únicos e não-vazios em cada chamada', () => {
    const built = buildTemplateQuestions(getTemplateById('briefing-agencia')!)
    const ids = built.map((q) => q.id)
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('regenera ids a cada chamada (sem reuso entre formulários)', () => {
    const a = buildTemplateQuestions(getTemplateById('contato')!)
    const b = buildTemplateQuestions(getTemplateById('contato')!)
    a.forEach((qa, i) => expect(qa.id).not.toBe(b[i].id))
  })

  it('preserva título e obrigatoriedade', () => {
    const t = getTemplateById('contato')!
    const built = buildTemplateQuestions(t)
    t.questions.forEach((src, i) => {
      expect(built[i].title).toBe(src.title)
      expect(built[i].required).toBe(src.required)
    })
  })
})
