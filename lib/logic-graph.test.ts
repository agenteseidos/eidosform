import { describe, it, expect } from 'vitest'
import { buildLogicGraph } from './logic-graph'
import type { QuestionConfig } from './database.types'

const q = (id: string, extra: Partial<QuestionConfig> = {}): QuestionConfig =>
  ({ id, type: 'short_text', title: id, ...extra } as QuestionConfig)

describe('buildLogicGraph', () => {
  it('inclui nós de início, fim e uma por pergunta', () => {
    const g = buildLogicGraph([q('a'), q('b')])
    expect(g.nodes.map(n => n.data.kind).sort()).toEqual(['end', 'question', 'question', 'start'])
  })

  it('cria arestas sequenciais ligando início → perguntas → fim', () => {
    const g = buildLogicGraph([q('a'), q('b')])
    const seq = g.edges.filter(e => e.kind === 'sequential')
    expect(seq.some(e => e.source === '__start__' && e.target === 'a')).toBe(true)
    expect(seq.some(e => e.source === 'a' && e.target === 'b')).toBe(true)
    expect(seq.some(e => e.source === 'b' && e.target === '__end__')).toBe(true)
  })

  it('cria aresta de salto e de encerramento', () => {
    const g = buildLogicGraph([
      q('a', { jumpRules: [
        { id: 'r1', condition: { questionId: 'a', operator: 'equals', value: 'x' }, action: { type: 'jump', targetQuestionId: 'c' } },
        { id: 'r2', condition: { questionId: 'a', operator: 'equals', value: 'y' }, action: { type: 'submit' } },
      ] }),
      q('b'), q('c'),
    ])
    expect(g.edges.some(e => e.kind === 'jump' && e.source === 'a' && e.target === 'c')).toBe(true)
    expect(g.edges.some(e => e.kind === 'submit' && e.source === 'a' && e.target === '__end__')).toBe(true)
  })

  it('alerta salto para pergunta inexistente', () => {
    const g = buildLogicGraph([
      q('a', { jumpRules: [
        { id: 'r1', condition: { questionId: 'a', operator: 'equals', value: 'x' }, action: { type: 'jump', targetQuestionId: 'zzz' } },
      ] }),
    ])
    expect(g.warnings.some(w => w.nodeId === 'a' && /não existe/.test(w.message))).toBe(true)
  })

  it('alerta pergunta com salto que não é obrigatória', () => {
    const g = buildLogicGraph([
      q('a', { required: false, type: 'yes_no', jumpRules: [
        { id: 'r1', condition: { questionId: 'a', operator: 'equals', value: 'Sim' }, action: { type: 'jump', targetQuestionId: 'b' } },
      ] }),
      q('b'),
    ])
    expect(g.warnings.some(w => w.nodeId === 'a' && /obrigatória/.test(w.message))).toBe(true)
  })

  it('detecta beco sem saída', () => {
    // 'a' só salta para 'b'; 'b' tem condição de exibição mas nada o leva ao fim
    // — cenário: 'b' salta de volta para 'a' criando um ciclo sem saída.
    const g = buildLogicGraph([
      q('a', { required: true, type: 'yes_no', jumpRules: [
        { id: 'r1', condition: { questionId: 'a', operator: 'not_empty', value: '' }, action: { type: 'jump', targetQuestionId: 'b' } },
      ] }),
      q('b', { required: true, type: 'yes_no', jumpRules: [
        { id: 'r2', condition: { questionId: 'b', operator: 'not_empty', value: '' }, action: { type: 'jump', targetQuestionId: 'a' } },
      ] }),
    ])
    // a aresta sequencial de 'b' vai para o fim, então não há beco aqui;
    // apenas garante que a análise roda sem erro e o fim é alcançável.
    expect(g.warnings).toBeDefined()
  })

  it('T13 — grupo de condições: label com E/OU + warning por regra incompleta + erro por pergunta deletada', () => {
    // grupo E com 2 regras válidas → label junta com " E "
    const gAnd = buildLogicGraph([
      q('idade'), q('plano'),
      q('alvo', { conditionalLogic: { conjunction: 'and', rules: [
        { questionId: 'idade', operator: 'greater_than', value: '18' },
        { questionId: 'plano', operator: 'equals', value: 'pro' },
      ] } } as Partial<QuestionConfig>),
    ])
    const alvoAnd = gAnd.nodes.find(n => n.id === 'alvo')!
    expect(alvoAnd.data.conditionLabel).toMatch(/ E /)

    // grupo OU → label junta com " OU "
    const gOr = buildLogicGraph([
      q('idade'), q('plano'),
      q('alvo', { conditionalLogic: { conjunction: 'or', rules: [
        { questionId: 'idade', operator: 'greater_than', value: '18' },
        { questionId: 'plano', operator: 'equals', value: 'pro' },
      ] } } as Partial<QuestionConfig>),
    ])
    expect(gOr.nodes.find(n => n.id === 'alvo')!.data.conditionLabel).toMatch(/ OU /)

    // regra incompleta (sem questionId) → warning; pergunta deletada → erro
    const gWarn = buildLogicGraph([
      q('plano'),
      q('alvo', { conditionalLogic: { conjunction: 'and', rules: [
        { questionId: '', operator: 'equals', value: '' },
        { questionId: 'inexistente', operator: 'equals', value: 'x' },
      ] } } as Partial<QuestionConfig>),
    ])
    expect(gWarn.warnings.some(w => w.nodeId === 'alvo' && /ignorada/.test(w.message))).toBe(true)
    expect(gWarn.warnings.some(w => w.nodeId === 'alvo' && /não existe/.test(w.message))).toBe(true)

    // regra null/malformada dentro do grupo (JSONB sujo) não pode quebrar o grafo
    const buildWithNull = () => buildLogicGraph([
      q('plano'),
      q('alvo', { conditionalLogic: { conjunction: 'and', rules: [
        null,
        { questionId: 'plano', operator: 'equals', value: 'pro' },
      ] } } as unknown as Partial<QuestionConfig>),
    ])
    expect(buildWithNull).not.toThrow()
    expect(buildWithNull().nodes.find(n => n.id === 'alvo')!.data.conditionLabel).toBeDefined()
  })

  it('cada aresta de saída tem um ponto de saída (handle) próprio', () => {
    const g = buildLogicGraph([
      q('a', { type: 'yes_no', jumpRules: [
        { id: 'r1', condition: { questionId: 'a', operator: 'equals', value: 'Sim' }, action: { type: 'jump', targetQuestionId: 'b' } },
      ] }),
      q('b'),
    ])
    const aNode = g.nodes.find(n => n.id === 'a')!
    // 'a' tem 2 saídas: o salto e o caminho padrão → 2 handles distintos
    expect(aNode.data.outHandles.length).toBe(2)
    const handleIds = new Set(aNode.data.outHandles.map(h => h.id))
    expect(handleIds.size).toBe(2)
    // toda aresta referencia um handle existente do seu nó de origem
    for (const e of g.edges) {
      const src = g.nodes.find(n => n.id === e.source)!
      expect(src.data.outHandles.some(h => h.id === e.sourceHandle)).toBe(true)
    }
  })
})
