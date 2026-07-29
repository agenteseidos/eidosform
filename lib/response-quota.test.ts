import { describe, expect, it } from 'vitest'
import { addCalendarMonth, buildResponseQuotaPeriodReset } from './response-quota'

describe('response quota period', () => {
  it('preserva dia e horário no mês seguinte', () => {
    expect(addCalendarMonth(new Date('2026-07-15T12:34:56.000Z')).toISOString())
      .toBe('2026-08-15T12:34:56.000Z')
  })

  it('faz clamp no fim do mês', () => {
    expect(addCalendarMonth(new Date('2026-01-31T10:00:00.000Z')).toISOString())
      .toBe('2026-02-28T10:00:00.000Z')
    expect(addCalendarMonth(new Date('2028-01-31T10:00:00.000Z')).toISOString())
      .toBe('2028-02-29T10:00:00.000Z')
  })

  it('gera payload completo de reset', () => {
    expect(buildResponseQuotaPeriodReset(new Date('2026-07-29T12:00:00.000Z'))).toEqual({
      responses_used: 0,
      response_period_start_at: '2026-07-29T12:00:00.000Z',
      response_period_end_at: '2026-08-29T12:00:00.000Z',
    })
  })
})
