// Layout automático do Mapa da Lógica com ELK (Eclipse Layout Kernel).
// O algoritmo "layered" organiza o fluxo em camadas, minimizando cruzamentos
// de linha — bem mais limpo que o dagre para formulários com ramificação.

import ELK from 'elkjs/lib/elk.bundled.js'
import type { LogicDirection } from '@/lib/logic-graph'

const elk = new ELK()

export interface ElkNodeInput {
  id: string
  width: number
  height: number
}
export interface ElkEdgeInput {
  id: string
  source: string
  target: string
}

/**
 * Calcula posições (canto superior-esquerdo) para cada nó. Assíncrono.
 */
export async function elkLayout(
  nodes: ElkNodeInput[],
  edges: ElkEdgeInput[],
  direction: LogicDirection,
): Promise<Map<string, { x: number; y: number }>> {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'LR' ? 'RIGHT' : 'DOWN',
      // mantém a ordem das perguntas estável entre layouts
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      'elk.spacing.nodeNode': '52',
      'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.crossingMinimization.semiInteractive': 'true',
    },
    children: nodes.map(n => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }

  const res = await elk.layout(graph)
  const positions = new Map<string, { x: number; y: number }>()
  for (const child of res.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
  }
  return positions
}
