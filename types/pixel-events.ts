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
 * Evento de conclusão com parâmetros derivados das respostas.
 * Vive em `forms.pixels.completionEvent` (JSONB). No submit, o player avalia
 * cada paramRule contra a resposta da pergunta referenciada e monta os
 * parâmetros do evento; `counterParam` recebe a contagem de regras positivas.
 * Caso de uso: conversão personalizada no Meta filtrando por parâmetro
 * (ex.: "positivos é igual a 3 ou 4") — o Meta não faz E-lógico entre eventos
 * distintos, só entre parâmetros de um mesmo disparo.
 */
export interface CompletionEventParamRule {
  /** Nome do parâmetro enviado no evento (ex.: "formado") */
  param: string
  /** Pergunta cuja resposta alimenta a condição */
  questionId: string
  condition: PixelEventCondition
  /** Valor do parâmetro quando a condição bate (default: "sim") */
  valueIfTrue?: string
  /** Valor quando não bate (default: "nao") */
  valueIfFalse?: string
  /** Se false, a regra não soma no counterParam (default: true) */
  countsTowardCounter?: boolean
}

export interface CompletionEventConfig {
  /** Nome do evento custom (ex.: "PesquisaCompleta") */
  name: string
  /** Parâmetros fixos enviados sempre (ex.: { lancamento: "rcgt0826" }) */
  staticParams?: Record<string, string>
  paramRules?: CompletionEventParamRule[]
  /** Nome do parâmetro que recebe a contagem de regras positivas (ex.: "positivos") */
  counterParam?: string
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
