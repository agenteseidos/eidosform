import { describe, expect, it } from 'vitest'
import {
  decidirConversao,
  parseConversionTarget,
  type ConversionProfile,
  type ConversionTarget,
} from './conversion-check'

const futuro = new Date(Date.now() + 86400000).toISOString()
const passado = new Date(Date.now() - 86400000).toISOString()
const target: ConversionTarget = { type: 'plan_at_least', plan: 'plus', cycle: null }
const profile = (over: Partial<ConversionProfile> = {}): ConversionProfile => ({
  id: 'p1',
  plan: 'free',
  plan_status: 'active',
  plan_cycle: null,
  plan_expires_at: null,
  ...over,
})

describe('parseConversionTarget', () => {
  it('aceita plano mínimo e ciclo opcional', () => {
    expect(parseConversionTarget({ type: 'plan_at_least', plan: 'PLUS', cycle: 'yearly' }))
      .toEqual({ type: 'plan_at_least', plan: 'plus', cycle: 'YEARLY' })
    expect(parseConversionTarget({ type: 'plan_at_least', plan: 'starter', cycle: null }))
      .toEqual({ type: 'plan_at_least', plan: 'starter', cycle: null })
  })

  it('rejeita contrato desconhecido', () => {
    expect(parseConversionTarget({ type: 'exact', plan: 'plus' })).toBeNull()
    expect(parseConversionTarget({ type: 'plan_at_least', plan: 'enterprise' })).toBeNull()
    expect(parseConversionTarget({ type: 'plan_at_least', plan: 'plus', cycle: 'WEEKLY' })).toBeNull()
  })
})

describe('decidirConversao', () => {
  it('retorna not_converted sem match ou abaixo do tier', () => {
    expect(decidirConversao([], target)).toBe('not_converted')
    expect(decidirConversao([profile({ plan: 'starter', plan_cycle: 'MONTHLY', plan_expires_at: futuro })], target))
      .toBe('not_converted')
  })

  it('considera tier superior e respeita ciclo explícito', () => {
    const professional = profile({
      plan: 'professional', plan_cycle: 'MONTHLY', plan_expires_at: futuro,
    })
    expect(decidirConversao([professional], target)).toBe('converted')
    expect(decidirConversao([professional], { ...target, cycle: 'YEARLY' })).toBe('not_converted')
    expect(decidirConversao([profile({
      plan: 'plus', plan_cycle: null, plan_expires_at: futuro,
    })], { ...target, cycle: 'YEARLY' })).toBe('unknown')
  })

  it('considera canceling vigente convertido e expiração unknown', () => {
    expect(decidirConversao([profile({
      plan: 'plus', plan_status: 'canceling', plan_cycle: 'YEARLY', plan_expires_at: futuro,
    })], target)).toBe('converted')
    expect(decidirConversao([profile({
      plan: 'plus', plan_status: 'active', plan_cycle: 'YEARLY', plan_expires_at: passado,
    })], target)).toBe('unknown')
  })

  it.each(['overdue', 'cancelled', 'expired', 'chargeback'])(
    'falha fechado para status %s',
    (status) => {
      expect(decidirConversao([profile({
        plan: 'plus', plan_status: status, plan_cycle: 'YEARLY', plan_expires_at: futuro,
      })], target)).toBe('unknown')
    },
  )

  it('telefone duplicado: qualquer convertido suprime; sem conclusão vira unknown', () => {
    const free = profile({ id: 'free' })
    const paid = profile({
      id: 'paid', plan: 'plus', plan_cycle: 'YEARLY', plan_expires_at: futuro,
    })
    expect(decidirConversao([free, paid], target)).toBe('converted')
    expect(decidirConversao([free, profile({ id: 'free-2' })], target)).toBe('unknown')
  })
})
