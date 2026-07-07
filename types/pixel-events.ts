/**
 * types/pixel-events.ts — Tipos compartilhados para Pixel Events Condicionais
 * 
 * Usado tanto pelo backend (validação, save) quanto pelo frontend (UI do builder).
 */

export type PixelEventConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'is_empty'
  | 'is_not_empty'
  | 'one_of'
  | 'not_one_of'

export interface PixelEventCondition {
  operator: PixelEventConditionOperator
  value: string
}

export interface PixelEventConfig {
  type: 'standard' | 'custom'
  name: string
  value?: number
  currency?: string
}

export interface PixelEventRule {
  id: string
  condition: PixelEventCondition
  event: PixelEventConfig
}

export interface FormPixelEvents {
  onStart: string | null
  onComplete: string | null
}

/**
 * Eventos por conjunto de respostas (answer-set events).
 * Vivem em `forms.pixels.answerSetEvents` (JSONB). No submit, o player conta
 * quantas condições batem contra as respostas finais e dispara o evento
 * nomeado quando todas (`all`) ou pelo menos `minMatches` (`at_least`) baterem.
 * Caso de uso: qualificar lead pelo conjunto de respostas e otimizar a
 * campanha (Meta/Google/TikTok) pelo evento que só dispara pra esses leads.
 */
export interface AnswerSetCondition {
  /** Pergunta cuja resposta alimenta a condição */
  questionId: string
  condition: PixelEventCondition
  // extensão futura (scoring com pesos): weight?: number
}

export interface AnswerSetEvent {
  id: string
  /** Nome do evento custom (ex.: "LeadQualificado") */
  name: string
  match: 'all' | 'at_least'
  /** Obrigatório quando match='at_least' (1..nº de condições) */
  minMatches?: number
  conditions: AnswerSetCondition[]
}

/** Operadores válidos para validação server-side */
export const VALID_OPERATORS: PixelEventConditionOperator[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater_than',
  'less_than',
  'is_empty',
  'is_not_empty',
  'one_of',
  'not_one_of',
]

/** Eventos padrão do Meta Pixel */
export const STANDARD_PIXEL_EVENTS = [
  'AddPaymentInfo',
  'AddToCart',
  'AddToWishlist',
  'CompleteRegistration',
  'Contact',
  'CustomizeProduct',
  'Donate',
  'FindLocation',
  'InitiateCheckout',
  'Lead',
  'Purchase',
  'Schedule',
  'Search',
  'StartTrial',
  'SubmitApplication',
  'Subscribe',
  'ViewContent',
] as const
