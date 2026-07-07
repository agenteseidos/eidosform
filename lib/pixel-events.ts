/**
 * lib/pixel-events.ts — Pixel Events condicionais
 * Avalia regras por pergunta e dispara eventos no Meta Pixel.
 */

import { PixelEventRule, PixelEventCondition, PixelEventConfig, CompletionEventConfig } from '@/types/pixel-events'

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
    ttq?: { track: (event: string, params?: Record<string, unknown>) => void }
    __eidosCapturedFbqEvents?: string[]
    dataLayer?: unknown[]
  }
}

/**
 * Empurra um evento pro dataLayer do GTM/Google.
 * Espelha os mesmos eventos da aba CONVERSÕES (já usados pelo Meta) para o
 * Google: o GTM/gtag escutam e disparam conversões do Google Ads/GA4.
 * Dispara na hora — NÃO depende do fbq/Meta estar carregado e NÃO altera
 * em nada o comportamento do Meta.
 */
export function pushDataLayerEvent(event: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !event) return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ event, ...(params || {}) })
}

function recordCapturedEvent(name: string) {
  if (typeof window === 'undefined' || !name) return
  if (!window.__eidosCapturedFbqEvents) window.__eidosCapturedFbqEvents = []
  window.__eidosCapturedFbqEvents.push(name)
}

function normalizeAnswer(answer: unknown): string {
  if (answer === null || answer === undefined) return ''
  if (Array.isArray(answer)) return answer.join(', ')
  return String(answer)
}

function parseNumericValue(value: string): number {
  return parseFloat(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'))
}

export function matchesCondition(answer: unknown, condition: PixelEventCondition): boolean {
  const { operator, value } = condition
  const normalizedAnswer = normalizeAnswer(answer)
  const answerLower = normalizedAnswer.toLowerCase()
  const valueLower = (value ?? '').toLowerCase()

  switch (operator) {
    case 'equals': return answerLower === valueLower
    case 'not_equals': return answerLower !== valueLower
    case 'contains': return answerLower.includes(valueLower)
    case 'not_contains': return !answerLower.includes(valueLower)
    case 'greater_than': return parseNumericValue(normalizedAnswer) > parseNumericValue(value)
    case 'less_than': return parseNumericValue(normalizedAnswer) < parseNumericValue(value)
    case 'is_empty': return normalizedAnswer.trim() === ''
    case 'is_not_empty': return normalizedAnswer.trim() !== ''
    // Lista de valores separados por "|" — casa se a resposta for igual a
    // qualquer um deles (comparação exata, case-insensitive).
    case 'one_of':
      return splitOptionList(valueLower).includes(answerLower.trim())
    case 'not_one_of':
      return !splitOptionList(valueLower).includes(answerLower.trim())
    default: return false
  }
}

function splitOptionList(value: string): string[] {
  return value.split('|').map(v => v.trim()).filter(v => v !== '')
}

export function firePixelEvent(event: PixelEventConfig) {
  // Google/GTM — dispara uma vez, imediatamente (independe do fbq).
  pushDataLayerEvent(
    event.name,
    event.value !== undefined
      ? { value: event.value, currency: event.currency || 'BRL' }
      : undefined,
  )
  // Meta — comportamento inalterado (espera o fbq carregar, com retry).
  fireFbqEvent(event)
  // TikTok — mesmo padrão do Meta (espera o ttq carregar, com retry).
  fireTtqEvent(
    event.name,
    event.value !== undefined
      ? { value: event.value, currency: event.currency || 'BRL' }
      : undefined,
  )
}

/**
 * Dispara um evento no TikTok Pixel (ttq). O snippet oficial cria o stub
 * `window.ttq` com fila — eventos disparados antes da lib carregar são
 * enfileirados. O retry cobre só o caso do Script afterInteractive ainda
 * não ter executado. ttq.track aceita eventos padrão e custom pelo nome.
 */
function fireTtqEvent(name: string, params?: Record<string, unknown>, retries = 10) {
  if (!name || typeof window === 'undefined') return
  const { ttq } = window
  if (!ttq) {
    if (retries > 0) {
      setTimeout(() => fireTtqEvent(name, params, retries - 1), 300)
    }
    return
  }
  ttq.track(name, params)
}

function fireFbqEvent(event: PixelEventConfig, retries = 10) {
  if (typeof window === 'undefined') return
  const { fbq } = window
  if (!fbq) {
    if (retries > 0) {
      setTimeout(() => fireFbqEvent(event, retries - 1), 300)
    }
    return
  }

  const params = event.value !== undefined
    ? { value: event.value, currency: event.currency || 'BRL' }
    : undefined

  recordCapturedEvent(event.name)
  if (event.type === 'standard') {
    fbq('track', event.name, params)
  } else {
    fbq('trackCustom', event.name, params)
  }
}

export function fireNamedPixelEvent(name: string) {
  if (!name) return
  // Google/GTM — dispara uma vez, imediatamente (independe do fbq).
  pushDataLayerEvent(name)
  // Meta — comportamento inalterado (espera o fbq carregar, com retry).
  fireFbqNamedEvent(name)
  // TikTok — mesmo padrão do Meta (espera o ttq carregar, com retry).
  fireTtqEvent(name)
}

function fireFbqNamedEvent(name: string, retries = 10) {
  if (!name || typeof window === 'undefined') return
  const { fbq } = window
  if (!fbq) {
    // fbq ainda não carregou — tentar novamente em 300ms (até 10x = 3s)
    if (retries > 0) {
      setTimeout(() => fireFbqNamedEvent(name, retries - 1), 300)
    }
    return
  }
  recordCapturedEvent(name)
  const standardEvents = ['Lead', 'Purchase', 'CompleteRegistration', 'Contact', 'InitiateCheckout', 'ViewContent', 'AddToCart', 'AddPaymentInfo', 'Subscribe']
  if (standardEvents.includes(name)) {
    fbq('track', name)
  } else {
    fbq('trackCustom', name)
  }
}

export function evaluatePixelEvents(pixelEvents: PixelEventRule[] | undefined, answer: unknown) {
  if (!pixelEvents || pixelEvents.length === 0) return
  for (const rule of pixelEvents) {
    if (matchesCondition(answer, rule.condition)) {
      firePixelEvent(rule.event)
    }
  }
}

/**
 * Monta os parâmetros do evento de conclusão a partir das respostas.
 * Exportada separada do disparo pra ser testável e reutilizável (ex.: CAPI futura).
 */
export function buildCompletionEventParams(
  config: CompletionEventConfig,
  answers: Record<string, unknown>,
): Record<string, string> {
  const params: Record<string, string> = { ...(config.staticParams || {}) }
  let positives = 0
  for (const rule of config.paramRules || []) {
    if (!rule.param || !rule.questionId) continue
    const matched = matchesCondition(answers[rule.questionId], rule.condition)
    params[rule.param] = matched ? (rule.valueIfTrue ?? 'sim') : (rule.valueIfFalse ?? 'nao')
    if (matched && rule.countsTowardCounter !== false) positives++
  }
  if (config.counterParam) params[config.counterParam] = String(positives)
  return params
}

/**
 * Dispara o evento de conclusão com parâmetros (forms.pixels.completionEvent).
 * Mesmo padrão dos demais: dataLayer imediato, fbq/ttq com retry de carregamento.
 */
export function fireCompletionEventWithParams(
  config: CompletionEventConfig | null | undefined,
  answers: Record<string, unknown>,
) {
  if (!config?.name || typeof window === 'undefined') return
  const params = buildCompletionEventParams(config, answers)
  pushDataLayerEvent(config.name, params)
  fireFbqCustomWithParams(config.name, params)
  fireTtqEvent(config.name, params)
}

function fireFbqCustomWithParams(name: string, params: Record<string, string>, retries = 10) {
  if (!name || typeof window === 'undefined') return
  const { fbq } = window
  if (!fbq) {
    if (retries > 0) {
      setTimeout(() => fireFbqCustomWithParams(name, params, retries - 1), 300)
    }
    return
  }
  recordCapturedEvent(name)
  fbq('trackCustom', name, params)
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
  one_of: 'é uma das opções (separe com |)',
  not_one_of: 'não é nenhuma das opções (separe com |)',
}

export const VALUE_OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'one_of', 'not_one_of']
