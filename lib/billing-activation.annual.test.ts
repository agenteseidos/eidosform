import { describe, it, expect } from 'vitest'
import { buildActivePlanUpdate, buildFreePlanUpdate } from './billing-activation'

// annual_started_at (janela do benefício de migração — Codex Rodada 6 P1, política
// Sidney 2026-07-01): ativação MENSAL e reversão pra free ZERAM a coluna; ativação
// ANUAL não a toca no payload (o carimbo condicional é do stampAnnualStart, guardado
// por `.is(null)` pra não resetar em renovação/upgrade anual→anual).
describe('annual_started_at nos payloads de billing', () => {
  it('ativação MENSAL zera annual_started_at (encerra a assinatura anual vigente)', () => {
    const p = buildActivePlanUpdate({ plan: 'starter', cycle: 'MONTHLY' })
    expect(p).toHaveProperty('annual_started_at', null)
  })

  it('ativação ANUAL NÃO toca a coluna no payload (carimbo é condicional, à parte)', () => {
    const p = buildActivePlanUpdate({ plan: 'starter', cycle: 'YEARLY' })
    expect(Object.keys(p)).not.toContain('annual_started_at')
  })

  it.each(['overdue', 'cancelled', 'chargeback', 'refunded'] as const)(
    'reversão pra free (%s) zera annual_started_at',
    (status) => {
      expect(buildFreePlanUpdate(status)).toHaveProperty('annual_started_at', null)
    }
  )
})
