import { describe, it, expect } from 'vitest'
import { createTransportMetricsStore, dateKey } from './transport-metrics.js'

describe('métricas duráveis de transporte', () => {
  it('separa volume, motor e fallback', async () => {
    let now = Date.parse('2026-07-27T12:00:00Z')
    const metrics = createTransportMetricsStore({ file: null, now: () => now })
    metrics.load('wacli')
    await metrics.seedLegacy({
      a: { ts: Date.parse('2026-07-26T12:00:00Z'), messageId: 'A' },
      b: { ts: Date.parse('2026-07-26T13:00:00Z'), messageId: 'B' },
    })
    await metrics.recordSend({ transport: 'wacli', fallback: false })
    await metrics.beginFallback({ transport: 'wuzapi', reason: 'primary_down' })
    await metrics.recordSend({ transport: 'wuzapi', fallback: true })

    const snapshot = metrics.snapshot()
    expect(snapshot.volume.today).toBe(2)
    expect(snapshot.sendsByTransport).toEqual(expect.objectContaining({
      wacli: 1,
      wuzapi: 1,
      fallback: 1,
      legacy: 2,
    }))
    expect(snapshot.active).toEqual(expect.objectContaining({ transport: 'wuzapi', fallback: true }))
  })

  it('calcula média dos sete dias anteriores e alerta de pico', async () => {
    let now = Date.parse('2026-07-27T12:00:00Z')
    const metrics = createTransportMetricsStore({ file: null, now: () => now })
    metrics.load('wacli')
    await metrics.seedLegacy({})
    for (let day = 1; day <= 7; day++) {
      now = Date.parse(`2026-07-${String(27 - day).padStart(2, '0')}T12:00:00Z`)
      await metrics.recordSend({ transport: 'wacli' })
      await metrics.recordSend({ transport: 'wacli' })
    }
    now = Date.parse('2026-07-27T12:00:00Z')
    for (let count = 0; count < 10; count++) await metrics.recordSend({ transport: 'wacli' })
    expect(metrics.snapshot().volume).toEqual(expect.objectContaining({
      today: 10,
      average7Days: 2,
      coverageDays: 7,
      elevated: true,
    }))
  })

  it('usa o fuso de Recife na virada do dia', () => {
    expect(dateKey(Date.parse('2026-07-27T01:30:00Z'))).toBe('2026-07-26')
    expect(dateKey(Date.parse('2026-07-27T03:30:00Z'))).toBe('2026-07-27')
  })

  it('anti-flood alerta uma vez até a recuperação', async () => {
    const metrics = createTransportMetricsStore({ file: null })
    metrics.load('wuzapi')
    await metrics.beginFallback({ transport: 'wacli', reason: 'down' })
    expect(metrics.shouldAttemptFallbackAlert()).toBe(true)
    await metrics.markFallbackAlert(true)
    expect(metrics.shouldAttemptFallbackAlert()).toBe(false)
    await metrics.recordSend({ transport: 'wuzapi', fallback: false })
    expect(metrics.snapshot().fallbackIncident).toBeNull()
  })
})
