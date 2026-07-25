import { describe, expect, it } from 'vitest'
import {
  decidirEstadoConta,
  type ConversionProfile,
} from './conversion-check'

const futuro = new Date(Date.now() + 86400000).toISOString()
const passado = new Date(Date.now() - 86400000).toISOString()
const profile = (over: Partial<ConversionProfile> = {}): ConversionProfile => ({
  id: 'p1',
  plan: 'free',
  plan_status: 'active',
  plan_cycle: null,
  plan_expires_at: null,
  ...over,
})

describe('decidirEstadoConta', () => {
  it('distingue ausência, free ativa e qualquer tier pago vigente', () => {
    expect(decidirEstadoConta([])).toBe('none')
    expect(decidirEstadoConta([profile()])).toBe('free')
    expect(decidirEstadoConta([profile({
      plan: 'starter', plan_cycle: 'MONTHLY', plan_expires_at: futuro,
    })])).toBe('paid')
    expect(decidirEstadoConta([profile({
      plan: 'professional', plan_status: 'canceling', plan_cycle: 'YEARLY',
      plan_expires_at: futuro,
    })])).toBe('paid')
  })

  it('falha fechado para plano pago expirado', () => {
    expect(decidirEstadoConta([profile({
      plan: 'plus', plan_cycle: 'YEARLY', plan_expires_at: passado,
    })])).toBe('unknown')
  })

  it.each(['overdue', 'cancelled', 'expired', 'chargeback', 'refunded', null])(
    'falha fechado para status %s',
    (status) => {
      expect(decidirEstadoConta([profile({
        plan: 'plus', plan_status: status, plan_cycle: 'YEARLY',
        plan_expires_at: futuro,
      })])).toBe('unknown')
    },
  )

  it('telefone compartilhado é unknown mesmo quando uma das contas é paga', () => {
    const free = profile({ id: 'free' })
    const paid = profile({
      id: 'paid', plan: 'plus', plan_cycle: 'YEARLY', plan_expires_at: futuro,
    })
    expect(decidirEstadoConta([free, paid])).toBe('unknown')
    expect(decidirEstadoConta([free, profile({ id: 'free-2' })])).toBe('unknown')
  })
})
