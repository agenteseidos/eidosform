import { describe, it, expect } from 'vitest'
import { planAtLeast } from './plans'
import { questionTypeAllowed, filterQuestionsByPlan, QUESTION_TYPE_MIN_PLAN } from './questions'
import type { QuestionConfig } from './database.types'

describe('planAtLeast', () => {
  it('respeita a hierarquia free < starter < plus < professional', () => {
    expect(planAtLeast('free', 'starter')).toBe(false)
    expect(planAtLeast('starter', 'starter')).toBe(true)
    expect(planAtLeast('plus', 'starter')).toBe(true)
    expect(planAtLeast('professional', 'plus')).toBe(true)
    expect(planAtLeast('starter', 'plus')).toBe(false)
  })

  it('trata plano nulo/inválido como free', () => {
    expect(planAtLeast(null, 'starter')).toBe(false)
    expect(planAtLeast(undefined, 'starter')).toBe(false)
    expect(planAtLeast('lixo', 'starter')).toBe(false)
    expect(planAtLeast('STARTER', 'starter')).toBe(true) // normaliza caixa
  })
})

describe('questionTypeAllowed', () => {
  it('Calendly exige Starter+', () => {
    expect(questionTypeAllowed('calendly', 'free')).toBe(false)
    expect(questionTypeAllowed('calendly', 'starter')).toBe(true)
    expect(questionTypeAllowed('calendly', 'plus')).toBe(true)
  })

  it('html_block exige Plus+', () => {
    expect(questionTypeAllowed('html_block', 'free')).toBe(false)
    expect(questionTypeAllowed('html_block', 'starter')).toBe(false)
    expect(questionTypeAllowed('html_block', 'plus')).toBe(true)
    expect(questionTypeAllowed('html_block', 'professional')).toBe(true)
  })

  it('tipos não-gateados são livres em qualquer plano', () => {
    expect(questionTypeAllowed('short_text', 'free')).toBe(true)
    expect(questionTypeAllowed('content_block', 'free')).toBe(true)
    expect(questionTypeAllowed('cpf', 'free')).toBe(true)
  })

  it('o mapa de gating cobre só calendly e html_block', () => {
    expect(Object.keys(QUESTION_TYPE_MIN_PLAN).sort()).toEqual(['calendly', 'html_block'])
  })
})

describe('filterQuestionsByPlan', () => {
  const q = (id: string, type: QuestionConfig['type']): QuestionConfig =>
    ({ id, type, title: '', description: '', required: false } as QuestionConfig)

  const questions = [
    q('a', 'short_text'),
    q('b', 'calendly'),
    q('c', 'html_block'),
    q('d', 'email'),
  ]

  it('free perde calendly e html_block', () => {
    const out = filterQuestionsByPlan(questions, 'free').map(x => x.id)
    expect(out).toEqual(['a', 'd'])
  })

  it('starter mantém calendly mas perde html_block', () => {
    const out = filterQuestionsByPlan(questions, 'starter').map(x => x.id)
    expect(out).toEqual(['a', 'b', 'd'])
  })

  it('plus mantém tudo', () => {
    const out = filterQuestionsByPlan(questions, 'plus').map(x => x.id)
    expect(out).toEqual(['a', 'b', 'c', 'd'])
  })
})
