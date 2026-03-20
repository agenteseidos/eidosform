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
