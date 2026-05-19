import { describe, it, expect } from 'vitest'
import { getVisibleQuestions, getNextQuestionId, buildQuestionPath } from './form-logic-engine'
import type { QuestionConfig } from './database.types'

// Cenário: pergunta-alvo de um salto só fica visível por causa da resposta
// recém-dada (bug do salto que caía na lista de visíveis defasada).
const q = (id: string, extra: Partial<QuestionConfig> = {}): QuestionConfig =>
  ({ id, type: 'short_text', title: id, ...extra } as QuestionConfig)

describe('getVisibleQuestions', () => {
  it('revela pergunta condicional assim que a resposta-gatilho existe', () => {
    const questions = [
      q('gatilho'),
      q('alvo', { conditionalLogic: { questionId: 'gatilho', operator: 'equals', value: 'sim' } }),
    ]
    expect(getVisibleQuestions(questions, {}).map(x => x.id)).toEqual(['gatilho'])
    expect(getVisibleQuestions(questions, { gatilho: 'sim' }).map(x => x.id)).toEqual(['gatilho', 'alvo'])
  })
})

describe('salto para pergunta condicional', () => {
  const questions = [
    q('start', {
      jumpRules: [
        { id: 'r1', condition: { questionId: 'start', operator: 'equals', value: 'pular' },
          action: { type: 'jump', targetQuestionId: 'alvo' } },
      ],
    }),
    q('meio'),
    q('alvo', { conditionalLogic: { questionId: 'start', operator: 'equals', value: 'pular' } }),
  ]

  it('o alvo do salto está visível quando avaliado com a resposta-gatilho', () => {
    // contrato do qual o fix em form-player.tsx depende: a visibilidade
    // precisa ser recalculada COM a resposta nova antes de localizar o alvo.
    const answers = { start: 'pular' }
    const visible = getVisibleQuestions(questions, answers)
    expect(visible.find(x => x.id === 'alvo')).toBeDefined()
  })

  it('buildQuestionPath roteia start -> alvo, pulando "meio"', () => {
    expect(buildQuestionPath(questions, { start: 'pular' })).toEqual(['start', 'alvo'])
  })

  it('sem a resposta-gatilho o fluxo segue sequencial', () => {
    expect(getNextQuestionId('start', getVisibleQuestions(questions, {}), {})).toBe('meio')
  })
})
