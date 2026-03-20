/**
 * lib/pixel-events.ts — Pixel Events condicionais
 * Avalia regras por pergunta e dispara eventos no Meta Pixel.
 */

import { PixelEventRule, PixelEventCondition, PixelEventConfig } from '@/types/pixel-events'

export function matchesCondition(answer: string, condition: PixelEventCondition): boolean {
  const { operator, value } = condition
  const answerLower = (answer ?? '').toLowerCase()
  const valueLower = (value ?? '').toLowerCase()

  switch (operator) {
    case 'equals': return answerLower === valueLower
    case 'not_equals': return answerLower !== valueLower
    case 'contains': return answerLower.includes(valueLower)
    case 'not_contains': return !answerLower.includes(valueLower)
    case 'greater_than': return parseFloat(answer) > parseFloat(value)
    case 'less_than': return parseFloat(answer) < parseFloat(value)
    case 'is_empty': return !answer || answer.trim() === ''
    case 'is_not_empty': return !!(answer && answer.trim())
    default: return false
  }
}

export function firePixelEvent(event: PixelEventConfig) {
  if (typeof window === 'undefined') return
  const fbq = (window as any).fbq
  if (!fbq) return

  const params = event.value ? { value: event.value, currency: event.currency || 'BRL' } : {}

  if (event.type === 'standard') {
    fbq('track', event.name, params)
  } else {
    fbq('trackCustom', event.name, params)
  }
}

export function fireNamedPixelEvent(name: string) {
  if (!name || typeof window === 'undefined') return
  const fbq = (window as any).fbq
  if (!fbq) return
  const standardEvents = ['Lead', 'Purchase', 'CompleteRegistration', 'Contact', 'InitiateCheckout', 'ViewContent', 'AddToCart', 'AddPaymentInfo', 'Subscribe']
  if (standardEvents.includes(name)) {
    fbq('track', name)
  } else {
    fbq('trackCustom', name)
  }
}

export function evaluatePixelEvents(pixelEvents: PixelEventRule[] | undefined, answer: string) {
  if (!pixelEvents || pixelEvents.length === 0) return
  for (const rule of pixelEvents) {
    if (matchesCondition(answer, rule.condition)) {
      firePixelEvent(rule.event)
    }
  }
}

export const STANDARD_PIXEL_EVENTS = [
  'Lead',
  'Purchase',
  'CompleteRegistration',
  'Contact',
  'InitiateCheckout',
  'ViewContent',
] as const

export const OPERATOR_LABELS: Record<string, string> = {
  equals: 'é igual a',
  not_equals: 'não é igual a',
  contains: 'contém',
  not_contains: 'não contém',
  greater_than: 'é maior que',
  less_than: 'é menor que',
  is_empty: 'está vazio',
  is_not_empty: 'não está vazio',
}

export const VALUE_OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than']
