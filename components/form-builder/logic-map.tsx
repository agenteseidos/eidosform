'use client'

import { useMemo, useCallback, useState, useEffect, useRef, createContext, useContext } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { QuestionConfig } from '@/lib/database.types'
import { buildLogicGraph, type LogicNodeData, type LogicDirection } from '@/lib/logic-graph'
import { elkLayout } from '@/lib/elk-layout'
import { JumpRule } from '@/lib/jump-logic'
import { JumpRulesEditor } from './jump-rules-editor'
import { PixelEventRulesEditor } from './pixel-event-rules-editor'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertTriangle, Flag, Play, Eye, Target, Plus, LayoutGrid, GitFork } from 'lucide-react'
import { toast } from 'sonner'

interface LogicMapProps {
  questions: QuestionConfig[]
  selectedQuestionId: string | null
  onSelectQuestion: (id: string) => void
  onUpdateQuestion: (id: string, updates: Partial<QuestionConfig>) => void
  onAddQuestion: () => void
  formPixelEvents: { onStart: string | null; onComplete: string | null }
  onUpdateFormPixel: (updates: { pixel_event_on_start?: string | null; pixel_event_on_complete?: string | null }) => void
  hasPixelPlan: boolean
}

type FlowNode = Node<LogicNodeData>

interface MapCtx {
  selectedQuestionId: string | null
  onEditPixel: (questionId: string) => void
  onEditTerminalPixel: (which: 'start' | 'complete') => void
}
const LogicMapContext = createContext<MapCtx>({
  selectedQuestionId: null, onEditPixel: () => {}, onEditTerminalPixel: () => {},
})

const HANDLE_COLOR = { sequential: '#cbd5e1', jump: '#7c3aed', submit: '#16a34a' } as const

/** Distribui os pontos de saída ao longo da borda do bloco. */
function handleOffset(index: number, total: number): string {
  return `${((index + 1) / (total + 1)) * 100}%`
}

// ── Nó de pergunta ──────────────────────────────────────────────────────────
function QuestionNode({ data }: NodeProps<FlowNode>) {
  const ctx = useContext(LogicMapContext)
  const selected = data.questionId === ctx.selectedQuestionId
  const hasError = data.warnings.some(w => w.severity === 'error')
  const hasWarn = data.warnings.length > 0
  const borderColor = selected ? '#7c3aed' : hasError ? '#dc2626' : hasWarn ? '#d97706' : '#e2e8f0'
  const isLR = data.direction === 'LR'
  const handles = data.outHandles
  return (
    <div
      className="rounded-xl border-2 bg-white shadow-sm px-3.5 py-3 transition-colors"
      style={{ width: 280, borderColor, boxShadow: selected ? '0 0 0 3px #7c3aed22' : undefined }}
    >
      <Handle type="target" id="in" position={isLR ? Position.Left : Position.Top} style={{ background: '#94a3b8', width: 9, height: 9 }} />
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{data.typeLabel}</span>
        {hasWarn && <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: hasError ? '#dc2626' : '#d97706' }} />}
      </div>
      <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">{data.title}</p>
      {data.conditionLabel && (
        <div className="mt-1.5 flex items-start gap-1 text-[10px] text-violet-700 bg-violet-50 rounded px-1.5 py-1 leading-snug">
          <Eye className="w-3 h-3 mt-px shrink-0" />
          <span className="line-clamp-2">aparece se: {data.conditionLabel}</span>
        </div>
      )}
      {data.pixelEvents.map((p, i) => (
        <div key={i} className="mt-1.5 flex items-start gap-1 text-[10px] text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5 leading-snug">
          <Target className="w-3 h-3 mt-px shrink-0" />
          <span className="line-clamp-1">{p}</span>
        </div>
      ))}
      <button
        className="nodrag nopan mt-2 w-full text-[10px] font-medium text-emerald-700 hover:bg-emerald-50 rounded py-1 border border-dashed border-emerald-200 flex items-center justify-center gap-1 transition-colors"
        onClick={(e) => { e.stopPropagation(); if (data.questionId) ctx.onEditPixel(data.questionId) }}
      >
        <Target className="w-3 h-3" />
        {data.pixelEvents.length > 0 ? 'Editar conversões' : '+ Conversão (pixel)'}
      </button>
      {/* Pontos de saída — um por aresta, espaçados para a bifurcação ficar clara */}
      {handles.map((h, i) => (
        <Handle
          key={h.id}
          type="source"
          id={h.id}
          position={isLR ? Position.Right : Position.Bottom}
          style={{
            background: HANDLE_COLOR[h.kind],
            width: 11, height: 11,
            ...(isLR ? { top: handleOffset(i, handles.length) } : { left: handleOffset(i, handles.length) }),
          }}
        />
      ))}
    </div>
  )
}

// ── Nó terminal (Início / Página de obrigado) ───────────────────────────────
function TerminalNode({ data }: NodeProps<FlowNode>) {
  const ctx = useContext(LogicMapContext)
  const isStart = data.kind === 'start'
  const isLR = data.direction === 'LR'
  return (
    <div className="flex flex-col items-center gap-1" style={{ width: 280 }}>
      <div
        className="rounded-full px-5 py-2.5 flex items-center justify-center gap-2 text-sm font-semibold shadow-sm w-full"
        style={{ background: isStart ? '#16a34a' : '#475569', color: '#fff' }}
      >
        {!isStart && <Handle type="target" id="in" position={isLR ? Position.Left : Position.Top} style={{ background: '#94a3b8', width: 9, height: 9 }} />}
        {isStart ? <Play className="w-4 h-4" /> : <Flag className="w-4 h-4" />}
        {data.title}
        {isStart && <Handle type="source" id="h-seq" position={isLR ? Position.Right : Position.Bottom} style={{ background: '#cbd5e1', width: 11, height: 11 }} />}
      </div>
      <button
        className="nodrag nopan text-[10px] font-medium rounded px-2 py-0.5 flex items-center gap-1 transition-colors"
        style={{ color: data.formEvent ? '#047857' : '#64748b' }}
        onClick={(e) => { e.stopPropagation(); ctx.onEditTerminalPixel(isStart ? 'start' : 'complete') }}
      >
        <Target className="w-3 h-3" />
        {data.formEvent ? `evento: ${data.formEvent}` : '+ evento de pixel'}
      </button>
    </div>
  )
}

const EDGE_STYLE = {
  sequential: { stroke: '#cbd5e1', strokeWidth: 1.5, strokeDasharray: '5 5' },
  jump: { stroke: '#7c3aed', strokeWidth: 2 },
  submit: { stroke: '#16a34a', strokeWidth: 2 },
} as const

const newId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`

function estimateHeight(d: LogicNodeData): number {
  if (d.kind !== 'question') return 64
  let h = 96
  if (d.conditionLabel) h += 30
  h += d.pixelEvents.length * 22
  h += 30
  return h
}

export function LogicMap({
  questions, selectedQuestionId, onSelectQuestion, onUpdateQuestion,
  onAddQuestion, formPixelEvents, onUpdateFormPixel, hasPixelPlan,
}: LogicMapProps) {
  const nodeTypes = useMemo(() => ({ question: QuestionNode, terminal: TerminalNode }), [])
  const direction: LogicDirection = 'LR' // visualização horizontal (padrão fixo)
  const [showDefaultEdges, setShowDefaultEdges] = useState(true)
  const [jumpEditorFor, setJumpEditorFor] = useState<string | null>(null)
  const [pixelEditorFor, setPixelEditorFor] = useState<string | null>(null)
  const [terminalPixelFor, setTerminalPixelFor] = useState<'start' | 'complete' | null>(null)
  const [elkPos, setElkPos] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<FlowNode>([])
  const instRef = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null)
  // Enquadra o mapa apenas na primeira carga (e ao "Reorganizar") — nunca a
  // cada edição, senão o zoom do usuário se perde a todo ajuste.
  const hasFittedRef = useRef(false)

  const graph = useMemo(
    () => buildLogicGraph(questions, { direction, formPixel: formPixelEvents }),
    [questions, direction, formPixelEvents],
  )

  // Chave estrutural: muda só quando a topologia muda (não em arrasto).
  const structureKey = useMemo(
    () => direction + '|' + graph.nodes.map(n => n.id).join(',') + '|'
      + graph.edges.map(e => `${e.source}>${e.target}#${e.sourceHandle}`).join(','),
    [graph, direction],
  )
  // Chave de posições manuais (mapX/mapY) salvas nas perguntas.
  const posKey = useMemo(
    () => questions.map(q => `${q.id}:${q.mapX ?? ''},${q.mapY ?? ''}`).join('|'),
    [questions],
  )

  // ── Layout automático com ELK (assíncrono) ───────────────────────────────
  useEffect(() => {
    let cancelled = false
    const sizes = graph.nodes.map(n => ({ id: n.id, width: 280, height: estimateHeight(n.data) }))
    elkLayout(sizes, graph.edges, direction)
      .then(pos => { if (!cancelled) setElkPos(pos) })
      .catch(() => { /* layout falhou — mantém posições atuais */ })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey])

  // ── Sincroniza nós: posição manual (mapX/mapY) tem prioridade sobre o ELK ─
  useEffect(() => {
    const qById = new Map(questions.map(q => [q.id, q]))
    const next: FlowNode[] = graph.nodes.map(n => {
      const q = n.data.questionId ? qById.get(n.data.questionId) : undefined
      const manual = q && q.mapX != null && q.mapY != null
      const elk = elkPos.get(n.id)
      const position = manual ? { x: q!.mapX!, y: q!.mapY! } : (elk ?? { x: 0, y: 0 })
      return {
        id: n.id,
        type: n.data.kind === 'question' ? 'question' : 'terminal',
        position,
        data: n.data,
        draggable: n.data.kind === 'question',
      }
    })
    setRfNodes(next)
    // Só enquadra uma vez (carga inicial ou após "Reorganizar"). Em edições
    // normais a viewport do usuário é preservada.
    if (elkPos.size > 0 && !hasFittedRef.current) {
      hasFittedRef.current = true
      setTimeout(() => instRef.current?.fitView({ padding: 0.15, duration: 300 }), 60)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, posKey, elkPos])

  const edges: Edge[] = useMemo(
    () => graph.edges
      .filter(e => showDefaultEdges || e.kind !== 'sequential')
      .map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: 'in',
        label: e.label,
        type: 'smoothstep',
        animated: e.kind === 'jump',
        data: { kind: e.kind, questionId: e.questionId },
        style: EDGE_STYLE[e.kind],
        labelStyle: { fontSize: 10, fontWeight: 600, fill: e.kind === 'sequential' ? '#94a3b8' : '#475569' },
        labelBgStyle: { fill: '#fff', fillOpacity: 0.92 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_STYLE[e.kind].stroke },
      })),
    [graph, showDefaultEdges],
  )

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    const data = node.data as LogicNodeData
    if (data.kind === 'question' && data.questionId) onSelectQuestion(data.questionId)
  }, [onSelectQuestion])

  // Arrasto: salva a posição final na pergunta (mapX/mapY).
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    const data = node.data as LogicNodeData
    if (data.kind === 'question' && data.questionId) {
      onUpdateQuestion(data.questionId, { mapX: Math.round(node.position.x), mapY: Math.round(node.position.y) })
    }
  }, [onUpdateQuestion])

  // Reorganizar: limpa as posições manuais → volta ao layout automático.
  const reorganize = useCallback(() => {
    let cleared = 0
    for (const q of questions) {
      if (q.mapX != null || q.mapY != null) {
        onUpdateQuestion(q.id, { mapX: undefined, mapY: undefined })
        cleared++
      }
    }
    hasFittedRef.current = false // re-enquadra após reorganizar
    toast.success(cleared > 0 ? 'Mapa reorganizado automaticamente.' : 'O mapa já está no layout automático.')
  }, [questions, onUpdateQuestion])

  // Etapa 2: conectar dois blocos cria uma regra de salto.
  const onConnect = useCallback((conn: Connection) => {
    const { source, target } = conn
    if (!source || !target || source === target) return
    if (source === '__start__' || source === '__end__') {
      toast.error('O salto precisa partir de uma pergunta.')
      return
    }
    const srcQ = questions.find(q => q.id === source)
    if (!srcQ) return
    const newRule: JumpRule = {
      id: newId(),
      condition: { questionId: source, operator: srcQ.type === 'checkboxes' ? 'contains' : 'equals', value: '' },
      action: target === '__end__' ? { type: 'submit' } : { type: 'jump', targetQuestionId: target },
    }
    const needsRequired = srcQ.type !== 'content_block' && srcQ.type !== 'html_block'
    onUpdateQuestion(source, { jumpRules: [...(srcQ.jumpRules ?? []), newRule], ...(needsRequired ? { required: true } : {}) })
    setJumpEditorFor(source)
    toast.success('Salto criado — defina quando ele acontece.')
  }, [questions, onUpdateQuestion])

  // Etapa 3: clicar numa aresta edita/remove o salto.
  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    const d = edge.data as { kind?: string; questionId?: string } | undefined
    if (!d || d.kind === 'sequential') {
      toast.info('Essa é a rota padrão ("senão") — não é uma regra editável.')
      return
    }
    if (d.questionId) setJumpEditorFor(d.questionId)
  }, [])

  const ctxValue = useMemo<MapCtx>(() => ({
    selectedQuestionId,
    onEditPixel: (qId) => setPixelEditorFor(qId),
    onEditTerminalPixel: (which) => setTerminalPixelFor(which),
  }), [selectedQuestionId])

  const errors = graph.warnings.filter(w => w.severity === 'error')
  const warns = graph.warnings.filter(w => w.severity === 'warning')
  const jumpQuestion = jumpEditorFor ? questions.find(q => q.id === jumpEditorFor) : null
  const pixelQuestion = pixelEditorFor ? questions.find(q => q.id === pixelEditorFor) : null

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col">
      {/* Barra de ferramentas */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2 flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onAddQuestion}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Pergunta
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={reorganize}>
          <LayoutGrid className="w-3.5 h-3.5 mr-1" /> Reorganizar
        </Button>
        <Button
          size="sm" variant={showDefaultEdges ? 'outline' : 'secondary'} className="h-8 text-xs"
          onClick={() => setShowDefaultEdges(v => !v)}
        >
          <GitFork className="w-3.5 h-3.5 mr-1" />
          {showDefaultEdges ? 'Ocultar caminho padrão' : 'Mostrar caminho padrão'}
        </Button>
        <span className="text-[11px] text-slate-400 ml-1 hidden lg:inline">
          Arraste de um ponto de saída a outro bloco para criar um salto · arraste os blocos para organizar
        </span>
      </div>

      {/* Painel de alertas */}
      {graph.warnings.length > 0 && (
        <div className="shrink-0 border-b border-slate-200 bg-amber-50/60 px-4 py-2.5 max-h-32 overflow-auto">
          <p className="text-xs font-semibold text-slate-700 mb-1.5">
            {errors.length > 0 && <span className="text-red-600">{errors.length} erro(s)</span>}
            {errors.length > 0 && warns.length > 0 && ' · '}
            {warns.length > 0 && <span className="text-amber-700">{warns.length} aviso(s)</span>}
          </p>
          <ul className="space-y-1">
            {graph.warnings.map((w, i) => {
              const q = questions.find(x => x.id === w.nodeId)
              return (
                <li key={i}>
                  <button
                    onClick={() => onSelectQuestion(w.nodeId)}
                    className="text-left text-[11px] flex items-start gap-1.5 hover:underline"
                    style={{ color: w.severity === 'error' ? '#dc2626' : '#b45309' }}
                  >
                    <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                    <span><b>{q?.title?.trim() || 'Pergunta'}:</b> {w.message}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="flex-1 min-h-0">
        {questions.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-slate-400">
            Adicione perguntas para ver o mapa da lógica.
          </div>
        ) : (
          <LogicMapContext.Provider value={ctxValue}>
            <ReactFlow
              nodes={rfNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={onNodeClick}
              onNodeDragStop={onNodeDragStop}
              onEdgeClick={onEdgeClick}
              onConnect={onConnect}
              onInit={(inst) => { instRef.current = inst }}
              minZoom={0.1}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#e2e8f0" gap={20} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={(n) => ((n.data as LogicNodeData)?.kind === 'question' ? '#c4b5fd' : '#94a3b8')} />
            </ReactFlow>
          </LogicMapContext.Provider>
        )}
      </div>

      {/* Modal: regras de salto */}
      <Dialog open={!!jumpQuestion} onOpenChange={(o) => !o && setJumpEditorFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Saltos de “{jumpQuestion?.title?.trim() || 'pergunta'}”</DialogTitle>
            <DialogDescription>Defina para onde o formulário vai conforme a resposta.</DialogDescription>
          </DialogHeader>
          {jumpQuestion && (
            <JumpRulesEditor
              rules={jumpQuestion.jumpRules || []}
              questionId={jumpQuestion.id}
              allQuestions={questions}
              onChange={(rules) => onUpdateQuestion(jumpQuestion.id, {
                jumpRules: rules,
                ...(rules.length > 0 && jumpQuestion.type !== 'content_block' && jumpQuestion.type !== 'html_block'
                  ? { required: true } : {}),
              })}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Modal: conversões de pixel da pergunta */}
      <Dialog open={!!pixelQuestion} onOpenChange={(o) => !o && setPixelEditorFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Conversões de “{pixelQuestion?.title?.trim() || 'pergunta'}”</DialogTitle>
            <DialogDescription>Dispare um evento de pixel conforme a resposta desta pergunta.</DialogDescription>
          </DialogHeader>
          {pixelQuestion && (
            <PixelEventRulesEditor
              rules={pixelQuestion.pixelEvents || []}
              onChange={(rules) => onUpdateQuestion(pixelQuestion.id, { pixelEvents: rules })}
              hasPixelPlan={hasPixelPlan}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Modal: evento de pixel de início / conclusão */}
      <Dialog open={!!terminalPixelFor} onOpenChange={(o) => !o && setTerminalPixelFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {terminalPixelFor === 'start' ? 'Evento ao iniciar o formulário' : 'Evento ao concluir o formulário'}
            </DialogTitle>
            <DialogDescription>
              Nome do evento de pixel disparado {terminalPixelFor === 'start' ? 'quando alguém começa' : 'na conclusão'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Nome do evento</Label>
            <Input
              defaultValue={(terminalPixelFor === 'start' ? formPixelEvents.onStart : formPixelEvents.onComplete) || ''}
              placeholder="Ex.: Lead, InitiateCheckout, Purchase"
              onChange={(e) => {
                const v = e.target.value || null
                onUpdateFormPixel(terminalPixelFor === 'start'
                  ? { pixel_event_on_start: v } : { pixel_event_on_complete: v })
              }}
            />
            <p className="text-[11px] text-slate-400">Deixe em branco para não disparar nenhum evento.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
