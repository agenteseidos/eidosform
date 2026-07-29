/**
 * Período mensal da cota de respostas.
 *
 * A cobrança pode ser mensal ou anual; a franquia anunciada é sempre mensal.
 * O fim usa mês-calendário com clamp (31/jan -> 28/29 fev), igual ao intervalo
 * de um mês do PostgreSQL.
 */
export function addCalendarMonth(from: Date): Date {
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth()
  const day = from.getUTCDate()
  const lastDayNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate()
  return new Date(Date.UTC(
    year,
    month + 1,
    Math.min(day, lastDayNextMonth),
    from.getUTCHours(),
    from.getUTCMinutes(),
    from.getUTCSeconds(),
    from.getUTCMilliseconds(),
  ))
}

export function buildResponseQuotaPeriodReset(from = new Date()) {
  return {
    responses_used: 0,
    response_period_start_at: from.toISOString(),
    response_period_end_at: addCalendarMonth(from).toISOString(),
  }
}
