import { describe, it, expect } from 'vitest'
import { getVisibleQuestions, getNextQuestionId, buildQuestionPath, evaluateJumpRules, isQuestionVisible, normalizeConditional } from './form-logic-engine'
import type { QuestionConfig, ConditionalGroup } from './database.types'

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

describe('regras incompletas (questionId/targetQuestionId vazios)', () => {
  it('condição condicional sem pergunta-base é ignorada (pergunta visível)', () => {
    const questions = [
      q('a', { conditionalLogic: { questionId: '', operator: 'equals', value: '' } }),
      q('b', { conditionalLogic: { questionId: '', operator: 'not_equals', value: 'x' } }),
    ]
    expect(getVisibleQuestions(questions, {}).map(x => x.id)).toEqual(['a', 'b'])
  })

  it('regra de salto sem pergunta-base na condição é ignorada', () => {
    const action = evaluateJumpRules(
      [{ id: 'r', condition: { questionId: '', operator: 'is_empty', value: '' },
         action: { type: 'jump', targetQuestionId: 'x' } }],
      {},
    )
    expect(action).toBeNull()
  })

  it('regra de salto sem destino é ignorada', () => {
    const action = evaluateJumpRules(
      [{ id: 'r', condition: { questionId: 'a', operator: 'equals', value: 'sim' },
         action: { type: 'jump', targetQuestionId: '' } }],
      { a: 'sim' },
    )
    expect(action).toBeNull()
  })

  it('regra de salto submit sem destino continua válida', () => {
    const action = evaluateJumpRules(
      [{ id: 'r', condition: { questionId: 'a', operator: 'is_empty', value: '' },
         action: { type: 'submit' } }],
      {},
    )
    expect(action).toEqual({ type: 'submit' })
  })
})

// Grupo de regras (formato novo) com conjunção E/OU.
const group = (conjunction: 'and' | 'or', rules: ConditionalGroup['rules']): ConditionalGroup =>
  ({ conjunction, rules })

describe('condições múltiplas (grupo E/OU)', () => {
  const ans = { idade: '30', plano: 'pro' }

  it('T1 — E: todas verdadeiras → visível', () => {
    const alvo = q('alvo', { conditionalLogic: group('and', [
      { questionId: 'idade', operator: 'greater_than', value: '18' },
      { questionId: 'plano', operator: 'equals', value: 'pro' },
    ]) })
    expect(isQuestionVisible(alvo, ans)).toBe(true)
  })

  it('T2 — E: uma verdadeira + uma falsa → oculto', () => {
    const alvo = q('alvo', { conditionalLogic: group('and', [
      { questionId: 'idade', operator: 'greater_than', value: '18' },
      { questionId: 'plano', operator: 'equals', value: 'free' },
    ]) })
    expect(isQuestionVisible(alvo, ans)).toBe(false)
  })

  it('T3 — OU: uma verdadeira + uma falsa → visível', () => {
    const alvo = q('alvo', { conditionalLogic: group('or', [
      { questionId: 'idade', operator: 'less_than', value: '18' },
      { questionId: 'plano', operator: 'equals', value: 'pro' },
    ]) })
    expect(isQuestionVisible(alvo, ans)).toBe(true)
  })

  it('T4 — OU: todas falsas → oculto', () => {
    const alvo = q('alvo', { conditionalLogic: group('or', [
      { questionId: 'idade', operator: 'less_than', value: '18' },
      { questionId: 'plano', operator: 'equals', value: 'free' },
    ]) })
    expect(isQuestionVisible(alvo, ans)).toBe(false)
  })

  it('T5 — regra incompleta ignorada num grupo E válido', () => {
    // a regra sem questionId não conta; sobra só a válida (verdadeira) → visível
    const alvo = q('alvo', { conditionalLogic: group('and', [
      { questionId: '', operator: 'equals', value: 'x' },
      { questionId: 'plano', operator: 'equals', value: 'pro' },
    ]) })
    expect(isQuestionVisible(alvo, ans)).toBe(true)
    // e se a única válida for falsa → oculto
    const alvo2 = q('alvo2', { conditionalLogic: group('and', [
      { questionId: '', operator: 'equals', value: 'x' },
      { questionId: 'plano', operator: 'equals', value: 'free' },
    ]) })
    expect(isQuestionVisible(alvo2, ans)).toBe(false)
  })

  it('T6 — todas as regras incompletas → visível', () => {
    const alvo = q('alvo', { conditionalLogic: group('and', [
      { questionId: '', operator: 'equals', value: 'x' },
      { questionId: '', operator: 'not_equals', value: 'y' },
    ]) })
    expect(isQuestionVisible(alvo, ans)).toBe(true)
    // grupo vazio também é visível
    expect(isQuestionVisible(q('vazio', { conditionalLogic: group('and', []) }), ans)).toBe(true)
  })

  it('T7 — retrocompat: regra única legada idêntica ao baseline', () => {
    const legada = q('legada', { conditionalLogic: { questionId: 'plano', operator: 'equals', value: 'pro' } })
    expect(isQuestionVisible(legada, ans)).toBe(true)
    expect(isQuestionVisible(legada, { plano: 'free' })).toBe(false)
    // o getVisibleQuestions também segue funcionando com o formato legado
    expect(getVisibleQuestions([legada], ans).map(x => x.id)).toEqual(['legada'])
    expect(getVisibleQuestions([legada], { plano: 'free' }).map(x => x.id)).toEqual([])
  })
})

describe('R7 — salto para alvo oculto por condição (T10/T11)', () => {
  const questions = [
    q('start', {
      jumpRules: [
        { id: 'r1', condition: { questionId: 'start', operator: 'equals', value: 'pular' },
          action: { type: 'jump', targetQuestionId: 'alvo' } },
      ],
    }),
    q('meio'),
    // 'alvo' só aparece se idade > 18; se não, está oculto
    q('alvo', { conditionalLogic: { questionId: 'idade', operator: 'greater_than', value: '18' } }),
    q('fim'),
  ]

  it('T10 — alvo oculto não entra no buildQuestionPath; segue sequencial', () => {
    // start manda pular pra "alvo", mas "alvo" está oculto (idade ausente) → o path
    // não pode incluir o alvo escondido; cai no próximo visível.
    const path = buildQuestionPath(questions, { start: 'pular' })
    expect(path).not.toContain('alvo')
    expect(path[0]).toBe('start')
  })

  it('T10b — quando o alvo está visível, o salto funciona normalmente', () => {
    const path = buildQuestionPath(questions, { start: 'pular', idade: '30' })
    expect(path).toContain('alvo')
  })

  it('T11 — não-regressão: lista completa, alvo existente → salta normal', () => {
    // getNextQuestionId com a lista inteira (não filtrada) e alvo presente: comportamento idêntico ao anterior
    const next = getNextQuestionId('start', questions, { start: 'pular', idade: '30' })
    expect(next).toBe('alvo')
  })

  it('T11b — alvo órfão/deletado cai no sequencial (antes retornava id inexistente)', () => {
    const orfas = [
      q('a', { jumpRules: [
        { id: 'r', condition: { questionId: 'a', operator: 'not_empty', value: '' },
          action: { type: 'jump', targetQuestionId: 'zzz' } }, // 'zzz' não existe
      ] }),
      q('b'),
    ]
    expect(getNextQuestionId('a', orfas, { a: 'x' })).toBe('b')
  })
})

describe('normalizeConditional (T8/T15)', () => {
  it('undefined/null → grupo vazio AND', () => {
    expect(normalizeConditional(undefined)).toEqual({ conjunction: 'and', rules: [] })
    expect(normalizeConditional(null)).toEqual({ conjunction: 'and', rules: [] })
  })

  it('regra única legada → grupo AND de 1 regra', () => {
    const r = { questionId: 'a', operator: 'equals' as const, value: 'x' }
    expect(normalizeConditional(r)).toEqual({ conjunction: 'and', rules: [r] })
  })

  it('grupo válido é preservado', () => {
    const g = group('or', [{ questionId: 'a', operator: 'equals', value: 'x' }])
    expect(normalizeConditional(g)).toEqual(g)
  })

  it('T15 — endurecimento: rules sem conjunction válida → AND; conjunção inválida → AND', () => {
    expect(normalizeConditional({ rules: [] } as unknown as ConditionalGroup).conjunction).toBe('and')
    const bad = { conjunction: 'xor', rules: [{ questionId: 'a', operator: 'equals', value: 'x' }] } as unknown as ConditionalGroup
    expect(normalizeConditional(bad).conjunction).toBe('and')
  })
})
