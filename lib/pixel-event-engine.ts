/**
 * lib/pixel-event-engine.ts — Motor de avaliação de regras de pixel events
 * 
 * Avalia as regras de pixelEvents de uma pergunta contra a resposta do usuário
 * e retorna os eventos que devem ser disparados.
 * 
 * Usado pelo form-player (client-side) para disparar eventos no Meta Pixel.
 */

import type { PixelEventRule, PixelEventConfig } from '@/types/pixel-events'

/**
 * Avalia todas as regras de pixel events de uma pergunta contra uma resposta.
 * Retorna lista de eventos que devem ser disparados.
 */
export function evaluatePixelEventRules(
  rules: PixelEventRule[] | undefined,
  answer: unknown
): PixelEventConfig[] {
  if (!rules || rules.length === 0) return []

  const answerStr = normalizeAnswer(answer)
  const events: PixelEventConfig[] = []

  for (const rule of rules) {
    if (matchesCondition(rule.condition.operator, answerStr, rule.condition.value)) {
      events.push(rule.event)
    }
  }

  return events
}

function normalizeAnswer(answer: unknown): string {
  if (answer === null || answer === undefined) return ''
  if (Array.isArray(answer)) return answer.join(', ')
  return String(answer)
}

function matchesCondition(operator: string, answer: string, value: string): boolean {
  switch (operator) {
    case 'equals':
      return answer.toLowerCase() === value.toLowerCase()
    case 'not_equals':
      return answer.toLowerCase() !== value.toLowerCase()
    case 'contains':
      return answer.toLowerCase().includes(value.toLowerCase())
    case 'not_contains':
      return !answer.toLowerCase().includes(value.toLowerCase())
    case 'greater_than': {
      const numAnswer = parseFloat(answer.replace(/[^\d.,\-]/g, '').replace(',', '.'))
      const numValue = parseFloat(value)
      return !isNaN(numAnswer) && !isNaN(numValue) && numAnswer > numValue
    }
    case 'less_than': {
      const numAnswer = parseFloat(answer.replace(/[^\d.,\-]/g, '').replace(',', '.'))
      const numValue = parseFloat(value)
      return !isNaN(numAnswer) && !isNaN(numValue) && numAnswer < numValue
    }
    case 'is_empty':
      return answer.trim() === ''
    case 'is_not_empty':
      return answer.trim() !== ''
    default:
      return false
  }
}

/**
 * Dispara evento no Meta Pixel (fbq).
 * Chamado pelo form-player quando uma regra é satisfeita.
 */
export function firePixelEvent(event: PixelEventConfig): void {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return

  const params: Record<string, unknown> = {}
  if (event.value !== undefined) params.value = event.value
  if (event.currency) params.currency = event.currency

  if (event.type === 'standard') {
    window.fbq('track', event.name, Object.keys(params).length > 0 ? params : undefined)
  } else {
    window.fbq('trackCustom', event.name, Object.keys(params).length > 0 ? params : undefined)
  }
}
