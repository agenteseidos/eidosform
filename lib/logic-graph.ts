// Constrói o grafo da lógica de um formulário (nós + arestas + alertas) para
// o Mapa da Lógica. Puramente derivado de `questions` — sem layout (o
// posicionamento é feito pelo ELK, de forma assíncrona, em elk-layout.ts).

import { QuestionConfig } from '@/lib/database.types'
import { JUMP_OPERATORS } from '@/lib/jump-logic'
import type { PixelEventRule } from '@/types/pixel-events'

export type LogicNodeKind = 'start' | 'end' | 'question'
export type LogicEdgeKind = 'sequential' | 'jump' | 'submit'
export type WarningSeverity = 'error' | 'warning'
export type LogicDirection = 'TB' | 'LR'

/** Um ponto de saída do bloco — cada aresta de saída tem o seu. */
export interface OutHandle {
  id: string
  kind: LogicEdgeKind
}

// `type` (não `interface`): React Flow exige que o data do nó seja
// atribuível a `Record<string, unknown>`, o que interfaces não satisfazem.
export type LogicNodeData = {
  kind: LogicNodeKind
  questionId?: string
  title: string
  typeLabel: string
  conditionLabel?: string
  pixelEvents: string[]
  formEvent?: string
  direction: LogicDirection
  /** Pontos de saída (um por aresta que sai deste bloco). */
  outHandles: OutHandle[]
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
  sourceHandle: string
  label?: string
  kind: LogicEdgeKind
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

function pixelEventLabel(rule: PixelEventRule): string {
  const c = rule.condition
  const noVal = c.operator === 'is_empty' || c.operator === 'is_not_empty'
  const cond = noVal ? PIXEL_OP[c.operator] : `${PIXEL_OP[c.operator] ?? c.operator} "${c.value ?? ''}"`
  return `${rule.event?.name || 'evento'} — se ${cond}`
}

/** Monta o grafo da lógica (estrutura, sem posições). */
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

  const edges: LogicEdge[] = []
  // outHandles por nó (preenchido enquanto criamos as arestas)
  const outHandles = new Map<string, OutHandle[]>()
  const pushHandle = (nodeId: string, h: OutHandle) => {
    if (!outHandles.has(nodeId)) outHandles.set(nodeId, [])
    outHandles.get(nodeId)!.push(h)
  }

  // ── Arestas ─────────────────────────────────────────────────────────────
  if (questions.length > 0) {
    pushHandle(START, { id: 'h-seq', kind: 'sequential' })
    edges.push({ id: 'e-start', source: START, target: questions[0].id, sourceHandle: 'h-seq', kind: 'sequential' })
  } else {
    pushHandle(START, { id: 'h-seq', kind: 'sequential' })
    edges.push({ id: 'e-start-end', source: START, target: END, sourceHandle: 'h-seq', kind: 'sequential' })
  }

  questions.forEach((q, i) => {
    // Saltos primeiro (cada um com seu ponto de saída)
    ;(q.jumpRules ?? []).forEach((rule) => {
      const condLabel = `Se ${conditionText(rule.condition, questions, false)}`
      const hId = `h-${rule.id}`
      if (rule.action?.type === 'submit') {
        pushHandle(q.id, { id: hId, kind: 'submit' })
        edges.push({ id: `jmp-${rule.id}`, source: q.id, target: END, sourceHandle: hId, kind: 'submit', label: condLabel, questionId: q.id, ruleId: rule.id })
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
      pushHandle(q.id, { id: hId, kind: 'jump' })
      edges.push({ id: `jmp-${rule.id}`, source: q.id, target: targetId, sourceHandle: hId, kind: 'jump', label: condLabel, questionId: q.id, ruleId: rule.id })
    })
    // Caminho padrão ("senão") por último
    const seqTarget = i < questions.length - 1 ? questions[i + 1].id : END
    pushHandle(q.id, { id: 'h-seq', kind: 'sequential' })
    edges.push({ id: `seq-${q.id}`, source: q.id, target: seqTarget, sourceHandle: 'h-seq', kind: 'sequential', label: 'padrão' })
  })

  // ── Nós ─────────────────────────────────────────────────────────────────
  const nodes: LogicNode[] = []
  nodes.push({
    id: START, position: { x: 0, y: 0 },
    data: { kind: 'start', title: 'Início', typeLabel: '', pixelEvents: [], direction,
            formEvent: options.formPixel?.onStart ?? undefined,
            outHandles: outHandles.get(START) ?? [], warnings: [] },
  })

  questions.forEach((q) => {
    const nodeWarnings: { severity: WarningSeverity; message: string }[] = []
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
        outHandles: outHandles.get(q.id) ?? [],
        warnings: nodeWarnings,
      },
    })
  })

  nodes.push({
    id: END, position: { x: 0, y: 0 },
    data: { kind: 'end', title: 'Página de obrigado', typeLabel: '', pixelEvents: [], direction,
            formEvent: options.formPixel?.onComplete ?? undefined,
            outHandles: [], warnings: [] },
  })

  // ── Becos sem saída ─────────────────────────────────────────────────────
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
    if (!incoming.has(q.id) || incoming.get(q.id)!.length === 0) {
      addWarn(q.id, 'warning', 'Esta pergunta pode estar inalcançável: nenhuma seta chega até ela.')
    }
  }

  // Anexa warnings finais aos nós
  for (const n of nodes) {
    n.data.warnings = warnings
      .filter(w => w.nodeId === n.id)
      .map(w => ({ severity: w.severity, message: w.message }))
  }

  return { nodes, edges, warnings }
}

export const LOGIC_GRAPH_IDS = { START, END }
