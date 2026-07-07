import { describe, it, expect } from 'vitest'
import { matchesCondition, evaluateAnswerSetEvents, sanitizeAnswerSetEvents, isRecordableMetaEvent } from './pixel-events'
import type { AnswerSetEvent, PixelEventCondition } from '@/types/pixel-events'

const cond = (operator: PixelEventCondition['operator'], value = ''): PixelEventCondition =>
  ({ operator, value })

describe('matchesCondition — escalares', () => {
  it('equals é case-insensitive', () => {
    expect(matchesCondition('Sim', cond('equals', 'sim'))).toBe(true)
    expect(matchesCondition('Não', cond('equals', 'sim'))).toBe(false)
  })

  it('one_of casa contra lista separada por |', () => {
    expect(matchesCondition('B', cond('one_of', 'a|b|c'))).toBe(true)
    expect(matchesCondition('d', cond('one_of', 'a|b|c'))).toBe(false)
    expect(matchesCondition('a, b', cond('one_of', 'a|b'))).toBe(false)
  })

  it('is_empty/is_not_empty com resposta ausente', () => {
    expect(matchesCondition(undefined, cond('is_empty'))).toBe(true)
    expect(matchesCondition(undefined, cond('is_not_empty'))).toBe(false)
  })

  it('resposta ausente satisfaz operadores negativos (proteção contra pergunta apagada fica no avaliador de conjunto)', () => {
    expect(matchesCondition(undefined, cond('not_equals', 'x'))).toBe(true)
    expect(matchesCondition(undefined, cond('not_contains', 'x'))).toBe(true)
    expect(matchesCondition(undefined, cond('not_one_of', 'x|y'))).toBe(true)
  })
})

describe('matchesCondition — arrays (checkboxes)', () => {
  it('one_of casa se ALGUMA opção marcada está na lista (bug do join corrigido)', () => {
    expect(matchesCondition(['Opção A', 'Opção B'], cond('one_of', 'opção a|opção c'))).toBe(true)
    expect(matchesCondition(['Opção B', 'Opção D'], cond('one_of', 'opção a|opção c'))).toBe(false)
  })

  it('equals casa se alguma opção marcada é igual ao valor', () => {
    expect(matchesCondition(['X', 'Y'], cond('equals', 'x'))).toBe(true)
    expect(matchesCondition(['X', 'Y'], cond('equals', 'z'))).toBe(false)
    expect(matchesCondition(['X'], cond('equals', 'x'))).toBe(true) // seleção única preservada
  })

  it('contains casa elemento a elemento (comportamento do editor por pergunta preservado)', () => {
    expect(matchesCondition(['Opção A', 'Opção B'], cond('contains', 'opção a'))).toBe(true)
    expect(matchesCondition(['Opção B'], cond('contains', 'opção a'))).toBe(false)
  })

  it('negativos são a negação exata: "não marcou X"', () => {
    expect(matchesCondition(['X', 'Y'], cond('not_equals', 'x'))).toBe(false)
    expect(matchesCondition(['Y'], cond('not_equals', 'x'))).toBe(true)
    expect(matchesCondition(['X', 'Y'], cond('not_one_of', 'x|z'))).toBe(false)
    expect(matchesCondition(['Y', 'W'], cond('not_one_of', 'x|z'))).toBe(true)
  })

  it('is_empty considera array vazio ou só de vazios', () => {
    expect(matchesCondition([], cond('is_empty'))).toBe(true)
    expect(matchesCondition([''], cond('is_empty'))).toBe(true)
    expect(matchesCondition(['X'], cond('is_empty'))).toBe(false)
    expect(matchesCondition(['X'], cond('is_not_empty'))).toBe(true)
  })
})

// ── evaluateAnswerSetEvents ──────────────────────────────────────────────────

const QIDS = new Set(['q1', 'q2', 'q3'])

const event = (overrides: Partial<AnswerSetEvent>): AnswerSetEvent => ({
  id: 'ev1',
  name: 'LeadQualificado',
  match: 'all',
  conditions: [],
  ...overrides,
})

describe('evaluateAnswerSetEvents', () => {
  const conditions = [
    { questionId: 'q1', condition: cond('equals', 'sim') },
    { questionId: 'q2', condition: cond('one_of', 'a|b') },
    { questionId: 'q3', condition: cond('greater_than', '5') },
  ]

  it('all: dispara só quando todas batem', () => {
    const ev = event({ conditions })
    expect(evaluateAnswerSetEvents([ev], { q1: 'Sim', q2: 'A', q3: 10 }, QIDS)).toEqual(['LeadQualificado'])
    expect(evaluateAnswerSetEvents([ev], { q1: 'Sim', q2: 'C', q3: 10 }, QIDS)).toEqual([])
  })

  it('at_least N: dispara com N ou mais', () => {
    const ev = event({ match: 'at_least', minMatches: 2, conditions })
    expect(evaluateAnswerSetEvents([ev], { q1: 'Sim', q2: 'A', q3: 1 }, QIDS)).toEqual(['LeadQualificado'])
    expect(evaluateAnswerSetEvents([ev], { q1: 'Sim', q2: 'C', q3: 1 }, QIDS)).toEqual([])
  })

  it('pergunta apagada NÃO conta, mesmo com operador negativo (falso positivo do Codex)', () => {
    const ev = event({
      match: 'at_least',
      minMatches: 2,
      conditions: [
        { questionId: 'q1', condition: cond('equals', 'sim') },
        { questionId: 'apagada', condition: cond('not_equals', 'x') },
      ],
    })
    // Sem o filtro de existência, not_equals em pergunta apagada bateria e dispararia.
    expect(evaluateAnswerSetEvents([ev], { q1: 'Sim' }, QIDS)).toEqual([])
  })

  it('pergunta existente sem resposta avalia normalmente (is_empty é legítimo)', () => {
    const ev = event({ conditions: [{ questionId: 'q1', condition: cond('is_empty') }] })
    expect(evaluateAnswerSetEvents([ev], {}, QIDS)).toEqual(['LeadQualificado'])
  })

  it('evento sem nome ou sem condições não dispara; nome é trimado', () => {
    expect(evaluateAnswerSetEvents([event({ name: '  ' , conditions })], { q1: 'Sim', q2: 'A', q3: 10 }, QIDS)).toEqual([])
    expect(evaluateAnswerSetEvents([event({ conditions: [] })], { q1: 'Sim' }, QIDS)).toEqual([])
    expect(evaluateAnswerSetEvents(
      [event({ name: '  Qualificado  ', conditions: [{ questionId: 'q1', condition: cond('equals', 'sim') }] })],
      { q1: 'Sim' }, QIDS,
    )).toEqual(['Qualificado'])
  })

  it('eventos homônimos satisfeitos no mesmo submit deduplicam', () => {
    const a = event({ id: 'a', conditions: [{ questionId: 'q1', condition: cond('equals', 'sim') }] })
    const b = event({ id: 'b', conditions: [{ questionId: 'q2', condition: cond('equals', 'a') }] })
    expect(evaluateAnswerSetEvents([a, b], { q1: 'Sim', q2: 'A' }, QIDS)).toEqual(['LeadQualificado'])
  })

  it('at_least sem minMatches exige todas; minMatches maior que as condições nunca dispara', () => {
    const semMin = event({ match: 'at_least', conditions })
    expect(evaluateAnswerSetEvents([semMin], { q1: 'Sim', q2: 'A', q3: 1 }, QIDS)).toEqual([])
    expect(evaluateAnswerSetEvents([semMin], { q1: 'Sim', q2: 'A', q3: 10 }, QIDS)).toEqual(['LeadQualificado'])
    const minAlto = event({ match: 'at_least', minMatches: 20, conditions })
    expect(evaluateAnswerSetEvents([minAlto], { q1: 'Sim', q2: 'A', q3: 10 }, QIDS)).toEqual([])
  })

  it('checkboxes com múltiplas opções marcadas casa via one_of (cenário-fim da feature)', () => {
    const ev = event({
      conditions: [{ questionId: 'q2', condition: cond('one_of', 'a|b') }],
    })
    expect(evaluateAnswerSetEvents([ev], { q2: ['C', 'B'] }, QIDS)).toEqual(['LeadQualificado'])
    expect(evaluateAnswerSetEvents([ev], { q2: ['C', 'D'] }, QIDS)).toEqual([])
  })

  it('sem config → nada dispara', () => {
    expect(evaluateAnswerSetEvents(undefined, { q1: 'Sim' }, QIDS)).toEqual([])
    expect(evaluateAnswerSetEvents([], { q1: 'Sim' }, QIDS)).toEqual([])
  })
})

describe('sanitizeAnswerSetEvents', () => {
  it('descarta rascunho sem nome ou sem condição válida; devolve undefined quando não sobra nada', () => {
    expect(sanitizeAnswerSetEvents([
      event({ name: '', conditions: [{ questionId: 'q1', condition: cond('equals', 'x') }] }),
      event({ name: 'Ok', conditions: [{ questionId: '', condition: cond('equals', 'x') }] }),
    ])).toBeUndefined()
    expect(sanitizeAnswerSetEvents(undefined)).toBeUndefined()
  })

  it('trima nome, remove condições sem pergunta e clampa minMatches', () => {
    const out = sanitizeAnswerSetEvents([
      event({
        name: ' Qualificado ',
        match: 'at_least',
        minMatches: 9,
        conditions: [
          { questionId: 'q1', condition: cond('equals', 'x') },
          { questionId: '', condition: cond('equals', 'y') },
          { questionId: 'q2', condition: cond('one_of', 'a|b') },
        ],
      }),
    ])
    expect(out).toHaveLength(1)
    expect(out![0].name).toBe('Qualificado')
    expect(out![0].conditions).toHaveLength(2)
    expect(out![0].minMatches).toBe(2)
  })

  it('match=all não carrega minMatches', () => {
    const out = sanitizeAnswerSetEvents([
      event({ minMatches: 3, conditions: [{ questionId: 'q1', condition: cond('equals', 'x') }] }),
    ])
    expect(out![0].minMatches).toBeUndefined()
    expect(out![0].match).toBe('all')
  })
})

describe('isRecordableMetaEvent (carimbo em responses.meta_events)', () => {
  it('padrão de conversão entra: Lead, Purchase, CompleteRegistration, InitiateCheckout', () => {
    for (const n of ['Lead', 'Purchase', 'CompleteRegistration', 'InitiateCheckout']) {
      expect(isRecordableMetaEvent(n)).toBe(true)
    }
  })

  it('padrão genérico/ruidoso fica de fora', () => {
    for (const n of ['PageView', 'ViewContent', 'Search', 'AddToCart', 'AddToWishlist', 'AddPaymentInfo']) {
      expect(isRecordableMetaEvent(n)).toBe(false)
    }
  })

  it('eventos personalizados sempre entram; vazio não', () => {
    expect(isRecordableMetaEvent('LeadQualificado')).toBe(true)
    expect(isRecordableMetaEvent('QualquerNome')).toBe(true)
    expect(isRecordableMetaEvent('')).toBe(false)
    expect(isRecordableMetaEvent('  ')).toBe(false)
  })
})
