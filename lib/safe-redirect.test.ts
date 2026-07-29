import { describe, expect, it } from 'vitest'
import { safeLocalRedirect, withCheckoutCycle } from './safe-redirect'

describe('safeLocalRedirect', () => {
  it('preserva path e query locais', () => {
    expect(safeLocalRedirect('/checkout/starter?cycle=yearly')).toBe('/checkout/starter?cycle=yearly')
  })

  it('bloqueia destinos externos e protocol-relative', () => {
    expect(safeLocalRedirect('https://evil.test')).toBe('/forms')
    expect(safeLocalRedirect('//evil.test/x')).toBe('/forms')
  })

  it('adiciona ciclo sem quebrar query existente', () => {
    expect(withCheckoutCycle('/checkout/starter?coupon=x', 'yearly'))
      .toBe('/checkout/starter?coupon=x&cycle=yearly')
  })
})
