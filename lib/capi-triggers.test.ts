import { describe, it, expect } from 'vitest'
import { derivarGatilhos, lerDicasDoNavegador, montarEventosParaFila } from './capi-triggers'
import type { QuestionConfig } from './database.types'

/**
 * A derivação de gatilhos NO SERVIDOR — o coração do protocolo v2.
 *
 * O que este arquivo tranca (2º parecer independente, 18/08/2026): o POST de formulário
 * publicado é ANÔNIMO. Nenhum campo dele pode decidir QUAIS eventos saem, QUANTOS, com que
 * nome, valor ou horário. O navegador contribui com UMA coisa — a etiqueta de deduplicação
 * (`capi_hints`) — e ela só é usada quando o servidor DERIVOU o gatilho correspondente da
 * resposta que ele mesmo gravou.
 */

const perguntas = [
  { id: 'q1', type: 'short_text', title: 'Orçamento', pixelEvents: [
    { id: 'r1', condition: { operator: 'equals', value: 'alto' }, event: { type: 'custom', name: 'LeadQualificado', value: 197, currency: 'BRL' } },
  ] },
  { id: 'q2', type: 'short_text', title: 'Nome' },
] as unknown as QuestionConfig[]

const base = {
  onComplete: 'Lead',
  answerSetEvents: ([
    { id: 'as1', name: 'PerfilCompleto', match: 'all' as const, conditions: [
      { questionId: 'q1', condition: { operator: 'equals', value: 'alto' } },
      { questionId: 'q2', condition: { operator: 'is_not_empty', value: '' } },
    ] },
  ] as unknown as import('@/types/pixel-events').AnswerSetEvent[]),
  questions: perguntas,
  answers: { q1: 'alto', q2: 'Ana' } as Record<string, unknown>,
  completed: true,
}

describe('derivarGatilhos', () => {
  it('deriva um evento POR GATILHO satisfeito, com identidade própria', () => {
    const r = derivarGatilhos(base)
    expect(r).toEqual([
      { triggerId: 'complete', eventName: 'Lead' },
      { triggerId: 'answerset:as1', eventName: 'PerfilCompleto' },
      { triggerId: 'question:q1:r1', eventName: 'LeadQualificado', value: 197, currency: 'BRL' },
    ])
  })

  /** ⚠️ O P0: a quantidade é ESTRUTURAL. Não existe entrada que produza dois eventos do mesmo gatilho. */
  it('a derivação é determinística da RESPOSTA — não existe como inflar quantidade', () => {
    const a = derivarGatilhos(base)
    const b = derivarGatilhos(base)
    expect(a).toEqual(b)
    expect(new Set(a.map((g) => g.triggerId)).size).toBe(a.length)
  })

  it("'complete' NÃO nasce de resposta incompleta (autosave parcial)", () => {
    const r = derivarGatilhos({ ...base, completed: false })
    expect(r.some((g) => g.triggerId === 'complete')).toBe(false)
    // Os de qualificação continuam — decisão do Sidney: qualificou no meio, vale no meio.
    expect(r.some((g) => g.triggerId === 'question:q1:r1')).toBe(true)
  })

  it('regra de pergunta NÃO RESPONDIDA não dispara — nem com operador negativo', () => {
    // P1 do parecer: `not_equals` bate em resposta ausente. Pergunta sem resposta não avalia.
    const negativa = [
      { id: 'q9', type: 'short_text', title: 'Oculta', pixelEvents: [
        { id: 'r9', condition: { operator: 'not_equals', value: 'x' }, event: { type: 'custom', name: 'Fantasma' } },
      ] },
    ] as unknown as QuestionConfig[]
    const r = derivarGatilhos({ ...base, questions: [...perguntas, ...negativa] })
    expect(r.some((g) => g.eventName === 'Fantasma')).toBe(false)
  })

  it('resposta que NÃO satisfaz a condição não deriva o gatilho', () => {
    const r = derivarGatilhos({ ...base, answers: { q1: 'baixo', q2: 'Ana' } })
    expect(r.some((g) => g.triggerId === 'question:q1:r1')).toBe(false)
    expect(r.some((g) => g.triggerId === 'answerset:as1')).toBe(false)
  })

  it('NOMES REPETIDOS disparam uma vez — conclusão vence conjunto vence pergunta', () => {
    // Sem isto, quem configurou "Lead" na conclusão E num conjunto contaria 2 no dia da virada.
    const r = derivarGatilhos({
      ...base,
      answerSetEvents: [{ id: 'as2', name: 'Lead', match: 'all', conditions: [{ questionId: 'q2', condition: { operator: 'is_not_empty', value: '' } }] }],
    })
    expect(r.filter((g) => g.eventName === 'Lead')).toEqual([{ triggerId: 'complete', eventName: 'Lead' }])
  })

  it('id de configuração fora do formato seguro é pulado sem derrubar o resto', () => {
    const r = derivarGatilhos({
      ...base,
      answerSetEvents: [
        { id: 'tem:dois-pontos', name: 'Quebrado', match: 'all', conditions: [{ questionId: 'q2', condition: { operator: 'is_not_empty', value: '' } }] },
        ...base.answerSetEvents,
      ],
    })
    expect(r.some((g) => g.eventName === 'Quebrado')).toBe(false)
    expect(r.some((g) => g.triggerId === 'answerset:as1')).toBe(true)
  })

  it('nome acima de 64 caracteres não sai — o Meta recusaria calado', () => {
    const r = derivarGatilhos({ ...base, onComplete: 'x'.repeat(65) })
    expect(r.some((g) => g.triggerId === 'complete')).toBe(false)
  })
})

describe('lerDicasDoNavegador (entrada hostil)', () => {
  it('aceita o formato legítimo', () => {
    const d = lerDicasDoNavegador([
      { triggerId: 'complete', eventId: 'a'.repeat(36) },
      { triggerId: 'question:q1:r1', eventId: 'b'.repeat(36) },
    ])
    expect(d.get('complete')).toBe('a'.repeat(36))
    expect(d.size).toBe(2)
  })

  it('gatilho duplicado fica com a PRIMEIRA dica', () => {
    const d = lerDicasDoNavegador([
      { triggerId: 'complete', eventId: 'primeiro-id-valido-aqui' },
      { triggerId: 'complete', eventId: 'segundo-id-valido-aqui1' },
    ])
    expect(d.get('complete')).toBe('primeiro-id-valido-aqui')
  })

  it('lixo em qualquer forma vira mapa vazio, nunca exceção', () => {
    for (const lixo of [null, 'string', 42, {}, [{}], [{ triggerId: 42, eventId: 'x'.repeat(20) }],
      [{ triggerId: 'purchase-inventado', eventId: 'x'.repeat(20) }],
      [{ triggerId: 'complete', eventId: 'curto' }],
      [{ triggerId: 'question:só-um-nível', eventId: 'x'.repeat(20) }]]) {
      expect(lerDicasDoNavegador(lixo as never).size).toBe(0)
    }
  })

  it('lista gigante é truncada — POST não compra processamento ilimitado', () => {
    const gigante = Array.from({ length: 5000 }, (_, i) => ({ triggerId: `answerset:a${i}`, eventId: 'x'.repeat(20) }))
    expect(lerDicasDoNavegador(gigante).size).toBeLessThanOrEqual(40)
  })
})

describe('montarEventosParaFila', () => {
  const gatilhos = [
    { triggerId: 'complete', eventName: 'Lead' },
    { triggerId: 'question:q1:r1', eventName: 'LeadQualificado', value: 197, currency: 'BRL' },
  ]

  it('adota a dica do navegador PARA O GATILHO DELA; sem dica, gera id próprio', () => {
    const eventos = montarEventosParaFila({
      gatilhos,
      dicas: new Map([['complete', 'id-do-navegador-1234567890']]),
      pixelId: '123456789012345',
      userData: {},
    })
    expect(eventos[0].event_id).toBe('id-do-navegador-1234567890')
    // Sem dica (navegador bloqueado): id do servidor — o caso em que o CAPI mais vale.
    expect(eventos[1].event_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('value/currency vêm da CONFIGURAÇÃO derivada, nunca de fora', () => {
    const eventos = montarEventosParaFila({ gatilhos, dicas: new Map(), pixelId: '123456789012345', userData: {} })
    expect(eventos[1].value).toBe(197)
    expect(eventos[0].value).toBeUndefined()
  })

  it('event_time é o AGORA do servidor — cliente não escolhe atribuição', () => {
    const antes = Date.now() - 2000
    const eventos = montarEventosParaFila({ gatilhos, dicas: new Map(), pixelId: '123456789012345', userData: {} })
    const t = Date.parse(eventos[0].event_time)
    expect(t).toBeGreaterThanOrEqual(antes)
    expect(t).toBeLessThanOrEqual(Date.now() + 2000)
  })
})
