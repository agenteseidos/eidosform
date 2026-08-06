import { describe, it, expect } from 'vitest'
import { cloneQuestionDeep, countQuestionReferences, removeQuestionAndReferences, countAnswerSetReferences, removeAnswerSetReferences } from './question-integrity'
import { evaluateJumpRules } from './form-logic-engine'
import type { QuestionConfig } from './database.types'

const q = (id: string, extra: Partial<QuestionConfig> = {}): QuestionConfig =>
  ({ id, type: 'short_text', title: id, ...extra } as QuestionConfig)

describe('cloneQuestionDeep', () => {
  const source = q('orig', {
    type: 'yes_no',
    required: true,
    options: ['Sim', 'Não'],
    jumpRules: [
      { id: 'r1', condition: { questionId: 'orig', operator: 'equals', value: 'Sim' }, action: { type: 'jump', targetQuestionId: 'other' } },
      { id: 'r2', condition: { questionId: 'outra-base', operator: 'equals', value: 'x' }, action: { type: 'submit' } },
    ],
    pixelEvents: [
      { id: 'p1', condition: { operator: 'equals', value: 'Sim' }, event: { name: 'Lead' } },
    ] as QuestionConfig['pixelEvents'],
  })

  it('gera IDs novos para a pergunta e para cada regra', () => {
    const clone = cloneQuestionDeep(source)
    expect(clone.id).not.toBe(source.id)
    expect(clone.jumpRules![0].id).not.toBe('r1')
    expect(clone.jumpRules![1].id).not.toBe('r2')
    expect(clone.pixelEvents![0].id).not.toBe('p1')
  })

  it('re-aponta condições que liam a própria pergunta para o ID novo', () => {
    const clone = cloneQuestionDeep(source)
    expect(clone.jumpRules![0].condition.questionId).toBe(clone.id)
    // condição baseada em OUTRA pergunta permanece intacta
    expect(clone.jumpRules![1].condition.questionId).toBe('outra-base')
  })

  it('a cópia avalia a PRÓPRIA resposta, não a da original (bug da auditoria)', () => {
    const clone = cloneQuestionDeep(source)
    // original respondeu "Sim", cópia respondeu "Não" → cópia NÃO deve saltar
    const answers = { [source.id]: 'Sim', [clone.id]: 'Não' }
    expect(evaluateJumpRules(clone.jumpRules!, answers)).toBeNull()
    // cópia respondeu "Sim" → salta
    const answers2 = { [source.id]: 'Não', [clone.id]: 'Sim' }
    expect(evaluateJumpRules(clone.jumpRules!, answers2)).toEqual({ type: 'jump', targetQuestionId: 'other' })
  })

  it('é cópia profunda: mutar a cópia não afeta a original', () => {
    const clone = cloneQuestionDeep(source)
    clone.options!.push('Talvez')
    clone.jumpRules![0].condition.value = 'MUDOU'
    expect(source.options).toEqual(['Sim', 'Não'])
    expect(source.jumpRules![0].condition.value).toBe('Sim')
  })
})

describe('countQuestionReferences / removeQuestionAndReferences', () => {
  const questions: QuestionConfig[] = [
    q('a', { jumpRules: [
      { id: 'r1', condition: { questionId: 'a', operator: 'equals', value: 'x' }, action: { type: 'jump', targetQuestionId: 'c' } },
      { id: 'r2', condition: { questionId: 'a', operator: 'equals', value: 'y' }, action: { type: 'jump', targetQuestionId: 'b' } },
    ] }),
    q('b', { conditionalLogic: { conjunction: 'and', rules: [
      { questionId: 'c', operator: 'equals', value: 'sim' },
    ] } }),
    q('c'),
    q('d', { conditionalLogic: { conjunction: 'or', rules: [
      { questionId: 'c', operator: 'equals', value: '1' },
      { questionId: 'a', operator: 'equals', value: '2' },
    ] } }),
  ]

  it('conta saltos com destino nela e condições de exibição que dependem dela', () => {
    const refs = countQuestionReferences(questions, 'c')
    expect(refs.jumpTargets).toBe(1)
    expect(refs.visibilityConditions).toBe(2)
    expect(refs.total).toBe(3)
  })

  it('não conta as regras da própria pergunta', () => {
    expect(countQuestionReferences(questions, 'a').jumpConditions).toBe(0)
  })

  it('remove a pergunta e limpa saltos que apontavam para ela', () => {
    const next = removeQuestionAndReferences(questions, 'c')
    expect(next.find(x => x.id === 'c')).toBeUndefined()
    const a = next.find(x => x.id === 'a')!
    expect(a.jumpRules).toHaveLength(1)
    expect(a.jumpRules![0].id).toBe('r2')
  })

  it('limpa condição de exibição: grupo vazio → sem condição; grupo parcial → mantém o resto', () => {
    const next = removeQuestionAndReferences(questions, 'c')
    const b = next.find(x => x.id === 'b')!
    expect(b.conditionalLogic).toBeUndefined()
    const d = next.find(x => x.id === 'd')!
    const rules = (d.conditionalLogic as { rules: { questionId: string }[] }).rules
    expect(rules).toHaveLength(1)
    expect(rules[0].questionId).toBe('a')
  })

  it('não altera perguntas sem referência à excluída', () => {
    const next = removeQuestionAndReferences(questions, 'c')
    expect(next.find(x => x.id === 'a')!.title).toBe('a')
  })
})

describe('answerSetEvents: contagem e limpeza na exclusão', () => {
  const events = [
    { id: 'e1', name: 'LeadQualificado', match: 'all' as const, conditions: [
      { questionId: 'a', condition: { operator: 'equals' as const, value: 'sim' } },
      { questionId: 'b', condition: { operator: 'equals' as const, value: '10' } },
    ] },
    { id: 'e2', name: 'SoDaPerguntaA', match: 'at_least' as const, minMatches: 1, conditions: [
      { questionId: 'a', condition: { operator: 'equals' as const, value: 'x' } },
    ] },
  ]

  it('conta condições que leem a pergunta', () => {
    expect(countAnswerSetReferences(events, 'a')).toBe(2)
    expect(countAnswerSetReferences(events, 'b')).toBe(1)
    expect(countAnswerSetReferences(events, 'zzz')).toBe(0)
    expect(countAnswerSetReferences(undefined, 'a')).toBe(0)
  })

  it('remove condições órfãs e derruba evento que fica sem condição', () => {
    const next = removeAnswerSetReferences(events, 'a')!
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe('e1')
    expect(next[0].conditions).toHaveLength(1)
    expect(next[0].conditions[0].questionId).toBe('b')
  })

  it('re-clampa minMatches ao novo total de condições', () => {
    const ev = [{ id: 'e3', name: 'Dois', match: 'at_least' as const, minMatches: 2, conditions: [
      { questionId: 'a', condition: { operator: 'equals' as const, value: '1' } },
      { questionId: 'b', condition: { operator: 'equals' as const, value: '2' } },
    ] }]
    const next = removeAnswerSetReferences(ev, 'a')!
    expect(next[0].minMatches).toBe(1)
  })

  it('devolve undefined quando não sobra evento', () => {
    expect(removeAnswerSetReferences([events[1]], 'a')).toBeUndefined()
    expect(removeAnswerSetReferences(undefined, 'a')).toBeUndefined()
  })
})
