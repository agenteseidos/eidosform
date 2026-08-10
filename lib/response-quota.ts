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

/**
 * A conta está SEM COTA agora? Leitura pura, sem escrever nada.
 *
 * ── POR QUE ISTO EXISTE, e por que NÃO se pausa o formulário ────────────────────────────────
 *
 * A tentação era marcar o formulário como pausado ao estourar a cota. Isso cria um travamento
 * PERMANENTE: quem vira o mês é a própria chegada de uma resposta — a RPC `check_and_increment_
 * response` avança o período quando é chamada. Se o formulário estiver pausado, ninguém responde;
 * se ninguém responde, a RPC não roda; se a RPC não roda, o mês nunca vira. O formulário morreria
 * em março e não voltaria em abril. Nunca.
 *
 * Aqui a virada do período é CALCULADA na leitura, sem gravar: se o período já venceu, o consumo
 * vale zero, independentemente do que está na coluna. A primeira resposta do mês novo é quem de
 * fato zera o contador, dentro da RPC. Nenhum estado a desfazer, nenhuma tarefa agendada, e o
 * formulário volta sozinho na virada.
 *
 * Decisão do Sidney (item 3): o lead NÃO preenche em vão. Ele vê a mensagem neutra ao abrir o
 * link, em vez de responder 12 perguntas e tomar um erro no fim.
 */
export function isOverResponseQuota(
  profile: {
    responses_used?: number | null
    responses_limit?: number | null
    response_period_end_at?: string | null
  } | null | undefined,
  now: Date = new Date()
): boolean {
  if (!profile) return false
  const limit = profile.responses_limit
  // -1 = ilimitado. null/undefined = sem limite conhecido → nunca barra por engano.
  if (limit == null || limit === -1) return false

  // Período já vencido: a próxima resposta zera o contador na RPC, então hoje NÃO está sem cota.
  const fim = profile.response_period_end_at
  if (fim) {
    const fimMs = new Date(fim).getTime()
    if (!Number.isNaN(fimMs) && now.getTime() >= fimMs) return false
  }

  return (profile.responses_used ?? 0) >= limit
}
