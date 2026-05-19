// Constrói o grafo da lógica de um formulário (nós + arestas + alertas) para
// o Mapa da Lógica do construtor. Puramente derivado de `questions`.

import dagre from '@dagrejs/dagre'
import { QuestionConfig } from '@/lib/database.types'
import { JUMP_OPERATORS } from '@/lib/jump-logic'
import type { PixelEventRule } from '@/types/pixel-events'

export type LogicNodeKind = 'start' | 'end' | 'question'
export type LogicEdgeKind = 'sequential' | 'jump' | 'submit'
export type WarningSeverity = 'error' | 'warning'
export type LogicDirection = 'TB' | 'LR'

// `type` (não `interface`): React Flow exige que o data do nó seja
// atribuível a `Record<string, unknown>`, o que interfaces não satisfazem.
export type LogicNodeData = {
  kind: LogicNodeKind
  questionId?: string
  title: string
  typeLabel: string
  /** Texto da condição de exibição, se houver. */
  conditionLabel?: string
  /** Rótulos dos eventos de pixel (conversões) disparados por esta pergunta. */
  pixelEvents: string[]
  /** Para nós terminais: nome do evento de início/conclusão do formulário. */
  formEvent?: string
  direction: LogicDirection
  warnings: { severity: WarningSeverity; message: string }[]
}

export interface LogicNode {
  id: string
  position: { x: number; y: number }
  data: LogicNodeData
}

export interface LogicEdge {
  id: string
  source: string
  target: string
  label?: string
  kind: LogicEdgeKind
  /** Para arestas de salto: id da pergunta de origem e índice da regra. */
  questionId?: string
  ruleId?: string
}

export interface GraphWarning {
  nodeId: string
  severity: WarningSeverity
  message: string
}

export interface LogicGraph {
  nodes: LogicNode[]
  edges: LogicEdge[]
  warnings: GraphWarning[]
}

export interface BuildLogicGraphOptions {
  formPixel?: { onStart: string | null; onComplete: string | null }
  direction?: LogicDirection
}

const START = '__start__'
const END = '__end__'
const NODE_W = 280
const NODE_H = 116

const TYPE_LABELS: Record<string, string> = {
  short_text: 'Texto curto', long_text: 'Texto longo', email: 'E-mail',
  phone: 'Telefone', number: 'Número', url: 'URL', date: 'Data',
  dropdown: 'Lista suspensa', checkboxes: 'Caixas de seleção', yes_no: 'Sim / Não',
  rating: 'Avaliação', opinion_scale: 'Escala', nps: 'NPS', cpf: 'CPF',
  address: 'Endereço', file_upload: 'Arquivo', calendly: 'Calendly',
  content_block: 'Bloco de conteúdo', html_block: 'Bloco (embed)',
}

const PIXEL_OP: Record<string, string> = {
  equals: '=', not_equals: '≠', contains: 'contém', not_contains: 'não contém',
  greater_than: '>', less_than: '<', is_empty: 'vazio', is_not_empty: 'preenchido',
}

function opLabel(op: string): string {
  return JUMP_OPERATORS.find(o => o.value === op)?.label ?? op
}

/** Texto curto e legível de uma condição (salto ou exibição). */
function conditionText(
  cond: { questionId: string; operator: string; value?: string },
  questions: QuestionConfig[],
  withQuestionName: boolean,
): string {
  const noValue = cond.operator === 'is_empty' || cond.operator === 'not_empty'
  const valuePart = noValue ? '' : ` "${cond.value ?? ''}"`
  const base = `${opLabel(cond.operator)}${valuePart}`
  if (!withQuestionName) return base
  const q = questions.find(x => x.id === cond.questionId)
  const qName = q?.title?.trim() || (q ? TYPE_LABELS[q.type] : 'pergunta removida')
  return `${qName} ${base}`
}

/** Rótulo curto de uma regra de evento de pixel (conversão). */
function pixelEventLabel(rule: PixelEventRule): string {
  const c = rule.condition
  const noVal = c.operator === 'is_empty' || c.operator === 'is_not_empty'
  const cond = noVal ? PIXEL_OP[c.operator] : `${PIXEL_OP[c.operator] ?? c.operator} "${c.value ?? ''}"`
  return `${rule.event?.name || 'evento'} — se ${cond}`
}

/**
 * Monta o grafo da lógica. Sem React/DOM — testável isoladamente.
 */
export function buildLogicGraph(
  questions: QuestionConfig[],
  options: BuildLogicGraphOptions = {},
): LogicGraph {
  const direction: LogicDirection = options.direction ?? 'TB'
  const byId = new Map(questions.map(q => [q.id, q]))
  const warnings: GraphWarning[] = []
  const addWarn = (nodeId: string, severity: WarningSeverity, message: string) => {
    warnings.push({ nodeId, severity, message })
  }

  // ── Nós ────────────────────────────────────────────────────────────────
  const nodes: LogicNode[] = []
  nodes.push({
    id: START, position: { x: 0, y: 0 },
    data: { kind: 'start', title: 'Início', typeLabel: '', pixelEvents: [], direction,
            formEvent: options.formPixel?.onStart ?? undefined, warnings: [] },
  })

  questions.forEach((q) => {
    const nodeWarnings: { severity: WarningSeverity; message: string }[] = []

    // Condição de exibição
    let conditionLabel: string | undefined
    if (q.conditionalLogic) {
      if (!q.conditionalLogic.questionId) {
        nodeWarnings.push({ severity: 'warning', message: 'Condição de exibição sem pergunta escolhida — será ignorada.' })
      } else if (!byId.has(q.conditionalLogic.questionId)) {
        nodeWarnings.push({ severity: 'error', message: 'Condição de exibição aponta para uma pergunta que não existe mais.' })
      } else {
        conditionLabel = conditionText(q.conditionalLogic, questions, true)
      }
    }

    // Pergunta com salto deve ser obrigatória
    const hasJumps = !!(q.jumpRules && q.jumpRules.length > 0)
    if (hasJumps && q.type !== 'content_block' && q.type !== 'html_block' && q.required !== true) {
      nodeWarnings.push({ severity: 'warning', message: 'Tem regra de salto mas não é obrigatória — dá para avançar sem responder e furar o roteamento.' })
    }

    nodeWarnings.forEach(w => addWarn(q.id, w.severity, w.message))
    nodes.push({
      id: q.id,
      position: { x: 0, y: 0 },
      data: {
        kind: 'question',
        questionId: q.id,
        title: q.title?.trim() || (q.type === 'content_block' ? 'Bloco de conteúdo' : 'Pergunta sem título'),
        typeLabel: TYPE_LABELS[q.type] ?? q.type,
        conditionLabel,
        pixelEvents: (q.pixelEvents ?? []).map(pixelEventLabel),
        direction,
        warnings: nodeWarnings,
      },
    })
  })

  nodes.push({
    id: END, position: { x: 0, y: 0 },
    data: { kind: 'end', title: 'Página de obrigado', typeLabel: '', pixelEvents: [], direction,
            formEvent: options.formPixel?.onComplete ?? undefined, warnings: [] },
  })

  // ── Arestas ────────────────────────────────────────────────────────────
  const edges: LogicEdge[] = []
  if (questions.length > 0) {
    edges.push({ id: `e-start`, source: START, target: questions[0].id, kind: 'sequential' })
  } else {
    edges.push({ id: `e-start-end`, source: START, target: END, kind: 'sequential' })
  }

  questions.forEach((q, i) => {
    // Aresta sequencial (caminho padrão "senão")
    const seqTarget = i < questions.length - 1 ? questions[i + 1].id : END
    edges.push({ id: `seq-${q.id}`, source: q.id, target: seqTarget, kind: 'sequential', label: 'padrão' })

    // Arestas de salto
    ;(q.jumpRules ?? []).forEach((rule) => {
      const condLabel = `Se ${conditionText(rule.condition, questions, false)}`
      if (rule.action?.type === 'submit') {
        edges.push({ id: `jmp-${rule.id}`, source: q.id, target: END, kind: 'submit', label: condLabel, questionId: q.id, ruleId: rule.id })
        return
      }
      const targetId = rule.action?.targetQuestionId
      if (!targetId) {
        addWarn(q.id, 'error', `Regra de salto (${condLabel}) sem destino escolhido.`)
        return
      }
      if (!byId.has(targetId)) {
        addWarn(q.id, 'error', `Regra de salto (${condLabel}) aponta para uma pergunta que não existe mais.`)
        return
      }
      edges.push({ id: `jmp-${rule.id}`, source: q.id, target: targetId, kind: 'jump', label: condLabel, questionId: q.id, ruleId: rule.id })
    })
  })

  // ── Becos sem saída: nós sem caminho até a Página de obrigado ───────────
  const incoming = new Map<string, string[]>()
  for (const e of edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, [])
    incoming.get(e.target)!.push(e.source)
  }
  const reachesEnd = new Set<string>([END])
  const queue = [END]
  while (queue.length) {
    const cur = queue.shift()!
    for (const src of incoming.get(cur) ?? []) {
      if (!reachesEnd.has(src)) { reachesEnd.add(src); queue.push(src) }
    }
  }
  for (const q of questions) {
    if (!reachesEnd.has(q.id)) {
      addWarn(q.id, 'error', 'Beco sem saída: a partir desta pergunta não há caminho até a página de obrigado.')
    }
  }

  // ── Perguntas inalcançáveis: sem nenhuma aresta de entrada ──────────────
  for (const q of questions) {
    if (!incoming.has(q.id) || incoming.get(q.id)!.length === 0) {
      addWarn(q.id, 'warning', 'Esta pergunta pode estar inalcançável: nenhuma seta chega até ela.')
    }
  }

  // ── Layout automático (dagre) ───────────────────────────────────────────
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: direction === 'LR' ? 40 : 56, ranksep: direction === 'LR' ? 120 : 92, marginx: 24, marginy: 24 })
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  for (const e of edges) g.setEdge(e.source, e.target)
  dagre.layout(g)
  for (const n of nodes) {
    const p = g.node(n.id)
    if (p) n.position = { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }
  }

  // Anexa warnings finais aos nós
  for (const n of nodes) {
    n.data.warnings = warnings
      .filter(w => w.nodeId === n.id)
      .map(w => ({ severity: w.severity, message: w.message }))
  }

  return { nodes, edges, warnings }
}

export const LOGIC_GRAPH_NODE_SIZE = { width: NODE_W, height: NODE_H }
export const LOGIC_GRAPH_IDS = { START, END }
