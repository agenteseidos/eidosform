import { describe, it, expect } from 'vitest'
import {
  getAnswerEvent, setAnswerEvent, unhandledPixelRules,
  getBlockEvent, setBlockEvent, defaultEvent,
} from './pixel-branching'
import type { PixelEventRule } from '@/types/pixel-events'
import type { QuestionConfig } from './database.types'

const yesno = (id: string): QuestionConfig =>
  ({ id, type: 'yes_no', title: id, required: true } as QuestionConfig)

describe('pixel-branching — perguntas de escolha', () => {
  it('sem regra → resposta não dispara evento', () => {
    expect(getAnswerEvent([], 'Sim')).toBeNull()
  })

  it('definir evento cria a regra; ler de volta devolve o evento', () => {
    const q = yesno('q1')
    const rules = setAnswerEvent([], q, 'Sim', { type: 'standard', name: 'Lead' })
    expect(rules).toHaveLength(1)
    expect(rules[0].condition).toMatchObject({ operator: 'equals', value: 'Sim' })
    expect(getAnswerEvent(rules, 'Sim')).toEqual({ type: 'standard', name: 'Lead' })
    expect(getAnswerEvent(rules, 'Não')).toBeNull()
  })

  it('atualizar o evento de uma resposta não duplica', () => {
    const q = yesno('q1')
    let rules = setAnswerEvent([], q, 'Sim', { type: 'standard', name: 'Lead' })
    rules = setAnswerEvent(rules, q, 'Sim', { type: 'standard', name: 'Purchase', value: 200, currency: 'BRL' })
    expect(rules).toHaveLength(1)
    expect(getAnswerEvent(rules, 'Sim')).toMatchObject({ name: 'Purchase', value: 200 })
  })

  it('definir "nenhum evento" remove a regra', () => {
    const q = yesno('q1')
    let rules = setAnswerEvent([], q, 'Sim', { type: 'standard', name: 'Lead' })
    rules = setAnswerEvent(rules, q, 'Sim', null)
    expect(rules).toHaveLength(0)
  })

  it('checkboxes usa operador "contains"', () => {
    const cb = { id: 'c', type: 'checkboxes', title: 'c', required: true, options: ['X'] } as QuestionConfig
    const rules = setAnswerEvent([], cb, 'X', defaultEvent())
    expect(rules[0].condition.operator).toBe('contains')
  })

  it('unhandledPixelRules detecta regras sem opção correspondente', () => {
    const q = { id: 'q', type: 'dropdown', title: 'q', required: true, options: ['A'] } as QuestionConfig
    const rules: PixelEventRule[] = [
      { id: 'r1', condition: { operator: 'equals', value: 'A' }, event: { type: 'standard', name: 'Lead' } },
      { id: 'r2', condition: { operator: 'equals', value: 'SUMIU' }, event: { type: 'standard', name: 'Lead' } },
    ]
    expect(unhandledPixelRules(rules, q).map(r => r.id)).toEqual(['r2'])
  })
})

describe('pixel-branching — blocos de conteúdo', () => {
  it('evento único do bloco', () => {
    expect(getBlockEvent([])).toBeNull()
    const rules = setBlockEvent([], { type: 'standard', name: 'CompleteRegistration' })
    expect(rules).toHaveLength(1)
    expect(getBlockEvent(rules)?.name).toBe('CompleteRegistration')
    expect(setBlockEvent(rules, null)).toEqual([])
  })
})
