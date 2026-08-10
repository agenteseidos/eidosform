import { describe, it, expect, vi } from 'vitest'
import { matchesCondition, evaluateAnswerSetEvents, sanitizeAnswerSetEvents, isRecordableMetaEvent, buildGoogleAdsSendTo, fireGoogleAdsConversion } from './pixel-events'
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

/**
 * Conversão do Google Ads (2026-08).
 *
 * O campo "Rótulo de conversão" existia no construtor, o cliente preenchia, e NADA nunca disparou:
 * não havia um único `gtag('event','conversion')` no projeto inteiro. A página injeta
 * `gtag('config','AW-XXX')`, que registra uma VISITA — nunca uma conversão. Dado morto de ponta a
 * ponta, com a documentação interna afirmando que estava "✅ Completo".
 *
 * As regexes aqui são de CORREÇÃO, não de contenção: o rótulo viaja como ARGUMENTO de função
 * (`gtag('event','conversion',{send_to})`), que é dado e não código-fonte. O risco real de um
 * `send_to` malformado é a conversão falhar CALADA no Google — o mesmo tipo de silêncio que este
 * código veio consertar.
 */
describe('buildGoogleAdsSendTo', () => {
  it('monta o send_to quando ID e rótulo são válidos', () => {
    expect(buildGoogleAdsSendTo('AW-123456789', 'AbC-D_efGhIj')).toBe('AW-123456789/AbC-D_efGhIj')
  })

  it('rótulo de UM caractere é válido — não existe mínimo documentado', () => {
    // Exigir 6+ caracteres transformaria um rótulo curto e legítimo em `null` silencioso, que é
    // exatamente o defeito original.
    expect(buildGoogleAdsSendTo('AW-1', 'X')).toBe('AW-1/X')
  })

  it('aceita o send_to inteiro colado no campo do rótulo', () => {
    // É o erro mais comum de quem copia do painel do Google. Recusar isso seria trocar
    // "campo preenchido que não dispara" por "campo quase certo que não dispara".
    expect(buildGoogleAdsSendTo('AW-123', 'AW-123/AbC-D_efG')).toBe('AW-123/AbC-D_efG')
  })

  it('só um dos dois campos preenchido não dispara nada', () => {
    expect(buildGoogleAdsSendTo('AW-123456789', '')).toBeNull()
    expect(buildGoogleAdsSendTo('', 'AbC-D_efG')).toBeNull()
    expect(buildGoogleAdsSendTo(null, null)).toBeNull()
    expect(buildGoogleAdsSendTo(undefined, undefined)).toBeNull()
  })

  it('ID fora do formato AW- é recusado', () => {
    expect(buildGoogleAdsSendTo('GTM-NPDJG7S6', 'AbC')).toBeNull()
    expect(buildGoogleAdsSendTo('AW-', 'AbC')).toBeNull()
    expect(buildGoogleAdsSendTo('123456789', 'AbC')).toBeNull()
  })

  it('rótulo com caractere perigoso é recusado', () => {
    // Aqui não há XSS — o valor é argumento de função, não código. Mas um rótulo assim é
    // certamente errado, e falhar cedo é melhor que mandar lixo ao Google.
    for (const ruim of [
      "Lbl'",
      "x'});alert(document.cookie);({'z':'",
      '</script><img src=x onerror=alert(1)>',
      'com espaço',
      'a;b',
      'a<b',
    ]) {
      expect(buildGoogleAdsSendTo('AW-123', ruim), `"${ruim}" deveria ser recusado`).toBeNull()
    }
  })

  it('rótulo longo demais é recusado', () => {
    expect(buildGoogleAdsSendTo('AW-123', 'a'.repeat(64))).toBe(`AW-123/${'a'.repeat(64)}`)
    expect(buildGoogleAdsSendTo('AW-123', 'a'.repeat(65))).toBeNull()
  })

  it('espaços em volta são tolerados', () => {
    expect(buildGoogleAdsSendTo('  AW-123  ', '  AbC  ')).toBe('AW-123/AbC')
  })
})

describe('fireGoogleAdsConversion', () => {
  it('chama o gtag com o evento de conversão', () => {
    const gtag = vi.fn()
    vi.stubGlobal('window', { gtag })
    fireGoogleAdsConversion('AW-123/AbC')
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', { send_to: 'AW-123/AbC' })
    vi.unstubAllGlobals()
  })

  it('send_to nulo não dispara nada', () => {
    const gtag = vi.fn()
    vi.stubGlobal('window', { gtag })
    fireGoogleAdsConversion(null)
    expect(gtag).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('sem gtag na página não lança — apenas reagenda', () => {
    // Formulário sem `AW-` configurado nunca injeta o snippet, então `window.gtag` não existe.
    vi.stubGlobal('window', {})
    expect(() => fireGoogleAdsConversion('AW-123/AbC', 0)).not.toThrow()
    vi.unstubAllGlobals()
  })
})
