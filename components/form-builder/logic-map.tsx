'use client'

import { useMemo, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { QuestionConfig } from '@/lib/database.types'
import { buildLogicGraph, type LogicNodeData } from '@/lib/logic-graph'
import { AlertTriangle, Flag, Play, Eye } from 'lucide-react'

interface LogicMapProps {
  questions: QuestionConfig[]
  selectedQuestionId: string | null
  onSelectQuestion: (id: string) => void
}

type FlowNode = Node<LogicNodeData & { selected?: boolean }>

// ── Nó de pergunta ──────────────────────────────────────────────────────────
function QuestionNode({ data }: NodeProps<FlowNode>) {
  const hasError = data.warnings.some(w => w.severity === 'error')
  const hasWarn = data.warnings.length > 0
  const borderColor = data.selected ? '#7c3aed' : hasError ? '#dc2626' : hasWarn ? '#d97706' : '#e2e8f0'
  return (
    <div
      className="rounded-xl border-2 bg-white shadow-sm px-3.5 py-3 transition-colors"
      style={{ width: 280, borderColor, boxShadow: data.selected ? '0 0 0 3px #7c3aed22' : undefined }}
    >
      <Handle type="target" position={Position.Top} style={{ background: '#94a3b8' }} />
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{data.typeLabel}</span>
        {hasWarn && (
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: hasError ? '#dc2626' : '#d97706' }} />
        )}
      </div>
      <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">{data.title}</p>
      {data.conditionLabel && (
        <div className="mt-1.5 flex items-start gap-1 text-[10px] text-violet-700 bg-violet-50 rounded px-1.5 py-1 leading-snug">
          <Eye className="w-3 h-3 mt-px shrink-0" />
          <span className="line-clamp-2">aparece se: {data.conditionLabel}</span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: '#94a3b8' }} />
    </div>
  )
}

// ── Nó terminal (Início / Página de obrigado) ───────────────────────────────
function TerminalNode({ data }: NodeProps<FlowNode>) {
  const isStart = data.kind === 'start'
  return (
    <div
      className="rounded-full px-5 py-2.5 flex items-center gap-2 text-sm font-semibold shadow-sm"
      style={{ background: isStart ? '#16a34a' : '#475569', color: '#fff', width: 280, justifyContent: 'center' }}
    >
      {!isStart && <Handle type="target" position={Position.Top} style={{ background: '#94a3b8' }} />}
      {isStart ? <Play className="w-4 h-4" /> : <Flag className="w-4 h-4" />}
      {data.title}
      {isStart && <Handle type="source" position={Position.Bottom} style={{ background: '#94a3b8' }} />}
    </div>
  )
}

const EDGE_STYLE = {
  sequential: { stroke: '#cbd5e1', strokeWidth: 1.5, strokeDasharray: '5 5' },
  jump: { stroke: '#7c3aed', strokeWidth: 2 },
  submit: { stroke: '#16a34a', strokeWidth: 2 },
} as const

export function LogicMap({ questions, selectedQuestionId, onSelectQuestion }: LogicMapProps) {
  const nodeTypes = useMemo(() => ({ question: QuestionNode, terminal: TerminalNode }), [])

  const graph = useMemo(() => buildLogicGraph(questions), [questions])

  const nodes: FlowNode[] = useMemo(
    () => graph.nodes.map(n => ({
      id: n.id,
      type: n.data.kind === 'question' ? 'question' : 'terminal',
      position: n.position,
      data: { ...n.data, selected: n.data.questionId === selectedQuestionId },
      draggable: true,
    })),
    [graph, selectedQuestionId],
  )

  const edges: Edge[] = useMemo(
    () => graph.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      type: 'smoothstep',
      animated: e.kind === 'jump',
      style: EDGE_STYLE[e.kind],
      labelStyle: { fontSize: 10, fontWeight: 600, fill: e.kind === 'sequential' ? '#94a3b8' : '#475569' },
      labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_STYLE[e.kind].stroke },
    })),
    [graph],
  )

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    const data = node.data as LogicNodeData
    if (data.kind === 'question' && data.questionId) onSelectQuestion(data.questionId)
  }, [onSelectQuestion])

  const errors = graph.warnings.filter(w => w.severity === 'error')
  const warns = graph.warnings.filter(w => w.severity === 'warning')

  if (questions.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-400">
        Adicione perguntas para ver o mapa da lógica.
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Painel de alertas */}
      {graph.warnings.length > 0 && (
        <div className="shrink-0 border-b border-slate-200 bg-amber-50/60 px-4 py-2.5 max-h-36 overflow-auto">
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
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#e2e8f0" gap={20} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => ((n.data as LogicNodeData)?.kind === 'question' ? '#c4b5fd' : '#94a3b8')} />
        </ReactFlow>
      </div>
    </div>
  )
}
