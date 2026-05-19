// Projeção entre "qual evento de pixel cada resposta dispara" (UI das
// Conversões) e as `pixelEvents` que o sistema guarda. Funções puras.

import type { PixelEventRule, PixelEventConfig } from '@/types/pixel-events'
import { QuestionConfig } from '@/lib/database.types'
import { genId, answerOptions } from '@/lib/branching'

function choiceOperator(q: QuestionConfig): 'equals' | 'contains' {
  return q.type === 'checkboxes' ? 'contains' : 'equals'
}

/** Evento de pixel disparado por uma resposta (null = nenhum). */
export function getAnswerEvent(rules: PixelEventRule[], answer: string): PixelEventConfig | null {
  const r = rules.find(x => x.condition?.value === answer)
  return r ? r.event : null
}

/** Define o evento de uma resposta; devolve o novo array de regras. */
export function setAnswerEvent(
  rules: PixelEventRule[], question: QuestionConfig, answer: string, event: PixelEventConfig | null,
): PixelEventRule[] {
  const idx = rules.findIndex(x => x.condition?.value === answer)
  if (!event) {
    return idx === -1 ? rules : rules.filter((_, i) => i !== idx)
  }
  if (idx === -1) {
    return [...rules, {
      id: genId(),
      condition: { operator: choiceOperator(question), value: answer },
      event,
    }]
  }
  return rules.map((r, i) => (i === idx ? { ...r, event } : r))
}

/** Regras que não correspondem a nenhuma opção atual (avançadas/órfãs). */
export function unhandledPixelRules(rules: PixelEventRule[], question: QuestionConfig): PixelEventRule[] {
  const opts = new Set(answerOptions(question))
  return rules.filter(r => !opts.has(r.condition?.value ?? ''))
}

// ── Blocos de conteúdo: um único evento "ao chegar neste bloco" ────────────

export function getBlockEvent(rules: PixelEventRule[]): PixelEventConfig | null {
  return rules[0]?.event ?? null
}

export function setBlockEvent(rules: PixelEventRule[], event: PixelEventConfig | null): PixelEventRule[] {
  if (!event) return []
  return [{
    id: rules[0]?.id ?? genId(),
    condition: { operator: 'is_empty', value: '' },
    event,
  }]
}

/** Cria um evento padrão em branco (para uma resposta recém-ativada). */
export function defaultEvent(): PixelEventConfig {
  return { type: 'standard', name: 'Lead' }
}
