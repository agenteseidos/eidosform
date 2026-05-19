import { describe, it, expect } from 'vitest'
import {
  DEST_NEXT, DEST_SUBMIT, isChoiceType, answerOptions,
  getAnswerDestination, setAnswerDestination, unhandledRules,
  getBlockDestination, setBlockDestination,
} from './branching'
import type { JumpRule } from './jump-logic'
import type { QuestionConfig } from './database.types'

const yesno = (id: string): QuestionConfig =>
  ({ id, type: 'yes_no', title: id, required: true } as QuestionConfig)
const dropdown = (id: string, options: string[]): QuestionConfig =>
  ({ id, type: 'dropdown', title: id, required: true, options } as QuestionConfig)

describe('branching — perguntas de escolha', () => {
  it('isChoiceType / answerOptions', () => {
    expect(isChoiceType('yes_no')).toBe(true)
    expect(isChoiceType('short_text')).toBe(false)
    expect(answerOptions(yesno('q'))).toEqual(['Sim', 'Não'])
    expect(answerOptions(dropdown('q', ['A', 'B']))).toEqual(['A', 'B'])
  })

  it('sem regra → destino é "próxima pergunta"', () => {
    expect(getAnswerDestination([], 'Sim')).toBe(DEST_NEXT)
  })

  it('definir destino cria a regra; ler de volta devolve o destino', () => {
    const q = yesno('q1')
    let rules: JumpRule[] = []
    rules = setAnswerDestination(rules, q, 'Não', 'q9')
    expect(rules).toHaveLength(1)
    expect(getAnswerDestination(rules, 'Não')).toBe('q9')
    expect(getAnswerDestination(rules, 'Sim')).toBe(DEST_NEXT)
    expect(rules[0].condition).toMatchObject({ questionId: 'q1', operator: 'equals', value: 'Não' })
    expect(rules[0].action).toEqual({ type: 'jump', targetQuestionId: 'q9' })
  })

  it('destino "encerrar" vira ação submit', () => {
    const rules = setAnswerDestination([], yesno('q1'), 'Sim', DEST_SUBMIT)
    expect(rules[0].action).toEqual({ type: 'submit' })
    expect(getAnswerDestination(rules, 'Sim')).toBe(DEST_SUBMIT)
  })

  it('mudar destino atualiza a regra existente (não duplica)', () => {
    const q = yesno('q1')
    let rules = setAnswerDestination([], q, 'Sim', 'qA')
    rules = setAnswerDestination(rules, q, 'Sim', 'qB')
    expect(rules).toHaveLength(1)
    expect(getAnswerDestination(rules, 'Sim')).toBe('qB')
  })

  it('voltar para "próxima pergunta" remove a regra', () => {
    const q = yesno('q1')
    let rules = setAnswerDestination([], q, 'Sim', 'qA')
    rules = setAnswerDestination(rules, q, 'Sim', DEST_NEXT)
    expect(rules).toHaveLength(0)
  })

  it('checkboxes usa operador "contains"', () => {
    const cb = { id: 'c', type: 'checkboxes', title: 'c', required: true, options: ['X'] } as QuestionConfig
    const rules = setAnswerDestination([], cb, 'X', 'qZ')
    expect(rules[0].condition.operator).toBe('contains')
  })

  it('unhandledRules detecta regras sem opção correspondente', () => {
    const q = dropdown('q', ['A', 'B'])
    const rules: JumpRule[] = [
      { id: 'r1', condition: { questionId: 'q', operator: 'equals', value: 'A' }, action: { type: 'submit' } },
      { id: 'r2', condition: { questionId: 'q', operator: 'equals', value: 'ANTIGO' }, action: { type: 'submit' } },
    ]
    expect(unhandledRules(rules, q).map(r => r.id)).toEqual(['r2'])
  })
})

describe('branching — blocos de conteúdo', () => {
  const block = { id: 'b1', type: 'content_block', title: '', required: false } as QuestionConfig

  it('sem regra → próxima', () => {
    expect(getBlockDestination([])).toBe(DEST_NEXT)
  })
  it('definir encerrar cria regra única is_empty → submit', () => {
    const rules = setBlockDestination([], block, DEST_SUBMIT)
    expect(rules).toHaveLength(1)
    expect(rules[0].condition.operator).toBe('is_empty')
    expect(rules[0].action).toEqual({ type: 'submit' })
    expect(getBlockDestination(rules)).toBe(DEST_SUBMIT)
  })
  it('voltar para próxima limpa as regras', () => {
    const rules = setBlockDestination(setBlockDestination([], block, DEST_SUBMIT), block, DEST_NEXT)
    expect(rules).toEqual([])
  })
})
