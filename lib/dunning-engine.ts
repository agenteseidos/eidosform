/**
 * Régua de cobrança — o MOTOR de decisão (D-01, decidido com o Sidney em 11/08/2026).
 *
 * O PROBLEMA QUE ELA RESOLVE: a carência de 5 dias criada no lote 1D é SILENCIOSA. O cliente
 * cujo cartão falhou não é avisado de nada — descobre que caiu para o gratuito quando os
 * formulários dele param. Do ponto de vista de negócio isso é pior que o bug original: perde-se
 * a receita recuperável (a maioria das falhas de cartão se resolve com um aviso) E a relação.
 *
 * ⚠️ AGNÓSTICO DE CANAL, DE PROPÓSITO. Este arquivo decide **se** e **o que** avisar; quem
 * entrega (e-mail, WhatsApp) é problema de outro. A razão é a instrução explícita do Sidney:
 * "tudo que ocorre de checagem com os e-mails antes do envio tem que ocorrer nas mensagens
 * também". Com a decisão fora dos canais, é IMPOSSÍVEL um canal disparar sem as checagens do
 * outro — um cérebro, duas bocas.
 *
 * A REGRA DE OURO: decidir pelo ESTADO ATUAL, nunca pelo calendário. A régua NÃO agenda os 6
 * avisos de uma vez; ela recalcula todo dia. Quem pagou às 14h de terça não recebe o aviso de
 * quarta — o gatilho de parada é a própria releitura, não um cancelamento que alguém precise
 * lembrar de fazer. É a mesma disciplina dos consertos de billing desta auditoria (o polling
 * que passou a exigir cobrança paga, o reprocessador que consulta o estado atual).
 */

/** Prazo de regularização. Espelha OVERDUE_GRACE_DAYS do expire-plans — os dois têm de contar
 *  a MESMA janela, senão a régua promete um prazo que o rebaixamento não respeita. */
export const PRAZO_DIAS = 5

/** Estágio da régua: D+0 a D+5. O D+5 é o único pós-rebaixamento. */
export type EstagioDunning = 0 | 1 | 2 | 3 | 4 | 5

export type DecisaoDunning =
  | { avisar: true; estagio: EstagioDunning; diasRestantes: number }
  | { avisar: false; motivo: MotivoSilencio }

/** Por que não avisamos — cada um com significado operacional distinto. */
export type MotivoSilencio =
  | 'sem_inadimplencia'        // pagou, ou nunca esteve vencido → o gatilho de parada
  | 'plano_gratuito_sem_queda' // já era free antes disso; nada a cobrar
  | 'dados_insuficientes'      // sem data de vencimento legível → não invento prazo
  | 'consulta_falhou'          // não sei o estado → não falo (nunca mentir por falta de dado)
  | 'fora_da_regua'            // passou do D+5: a régua tem fim, não persegue ninguém
  | 'ja_avisado_hoje'          // idempotência do dia

/** O que o motor precisa saber sobre a conta AGORA — lido na hora, nunca de uma foto. */
export type EstadoConta = {
  /** Plano vigente no banco NESTE instante. */
  plano: string | null
  /** 'active' | 'canceling' | 'expired' | 'cancelled' | ... */
  planStatus: string | null
  /** Existe cobrança vencida no gateway? `null` = a consulta falhou. */
  temVencida: boolean | null
  /** Data (YYYY-MM-DD) da cobrança vencida mais antiga. */
  vencidaDesde: string | null
}

/** Dias inteiros decorridos desde `YYYY-MM-DD`, em horário de Brasília. */
export function diasDesde(dataISO: string | null, agora = Date.now()): number | null {
  if (!dataISO) return null
  const t = Date.parse(`${dataISO}T00:00:00-03:00`)
  if (Number.isNaN(t)) return null
  return Math.floor((agora - t) / 86_400_000)
}

/**
 * A decisão. Pura de propósito: é a regra inteira da régua e precisa de teste de verdade —
 * mandar cobrança para quem pagou é o pior erro possível deste sistema.
 */
export function decidirAviso(estado: EstadoConta, agora = Date.now()): DecisaoDunning {
  // 1) GATILHO DE PARADA. Sem cobrança vencida = pagou (ou nunca deveu). A pergunta é feita
  //    ao gateway na hora do envio; é por isso que pagar no meio da régua interrompe tudo.
  if (estado.temVencida === null) return { avisar: false, motivo: 'consulta_falhou' }
  if (estado.temVencida === false) return { avisar: false, motivo: 'sem_inadimplencia' }

  const dias = diasDesde(estado.vencidaDesde, agora)
  if (dias === null || dias < 0) return { avisar: false, motivo: 'dados_insuficientes' }

  // 2) DEPOIS DO PRAZO. O aviso final (D+5) só sai se o rebaixamento REALMENTE aconteceu — é a
  //    proteção contra mentir para o cliente quando o expire-plans falha ou atrasa. Se ele
  //    ainda está pago, o motor cala (e quem cuida disso é `detectarRebaixamentoAtrasado`).
  if (dias >= PRAZO_DIAS) {
    const jaRebaixou = estado.plano === 'free'
    if (dias === PRAZO_DIAS && jaRebaixou) return { avisar: true, estagio: 5, diasRestantes: 0 }
    return { avisar: false, motivo: dias > PRAZO_DIAS ? 'fora_da_regua' : 'sem_inadimplencia' }
  }

  // 3) DENTRO DO PRAZO. Cliente já no gratuito aqui não é caso da régua (rebaixou por outro
  //    caminho, ou nunca foi pagante): cobrar quem não tem plano pago é ruído.
  if (estado.plano === 'free') return { avisar: false, motivo: 'plano_gratuito_sem_queda' }

  return { avisar: true, estagio: dias as EstagioDunning, diasRestantes: PRAZO_DIAS - dias }
}

/**
 * O REBAIXAMENTO FALHOU? (proteção pedida pelo Sidney em 11/08.)
 *
 * O expire-plans roda à meia-noite e retenta todo dia, então uma falha isolada se corrige
 * sozinha. O perigo é a falha PERSISTENTE: cron parado ou bug travando toda noite deixaria o
 * cliente com plano pago sem receita — e HOJE não existe alarme nenhum nesse cron (verificado
 * em 11/08: zero chamadas de alerta no arquivo).
 *
 * A régua roda horas DEPOIS do rebaixamento, então ela é a testemunha natural: passou do prazo
 * e a pessoa ainda está paga = o rebaixamento não aconteceu. Detecta e ALERTA; nunca rebaixa.
 * Dois sistemas escrevendo no mesmo estado de dinheiro é como nascem os bugs que esta auditoria
 * passou a semana matando — o expire-plans continua sendo o único que rebaixa.
 */
export function detectarRebaixamentoAtrasado(estado: EstadoConta, agora = Date.now()): boolean {
  if (estado.temVencida !== true) return false
  const dias = diasDesde(estado.vencidaDesde, agora)
  if (dias === null) return false
  return dias > PRAZO_DIAS && estado.plano !== 'free'
}

/**
 * Horário de envio por estágio (decisão do Sidney, 11/08): rotação para descobrir quando o
 * cliente de fato abre — e porque apostar tudo num horário só é palpite.
 *
 * ⚠️ O D+4 é FIXO de manhã. É o último aviso antes do corte da meia-noite: saindo às 9h o
 * cliente tem o dia inteiro para resolver com o banco; às 17h sobrariam poucas horas.
 * E nada depois das 18h: cobrança à noite soa invasiva e o cliente não CONSEGUE agir (banco
 * fechado) — ele só dorme com o problema.
 */
export const HORARIO_POR_ESTAGIO: Record<EstagioDunning, number> = {
  0: 9,
  1: 12,
  2: 17,
  3: 9,
  4: 9,  // FIXO — véspera do corte
  5: 9,
}

/** É a hora deste estágio? A régua roda de hora em hora e só age na janela do estágio. */
export function ehHoraDoEstagio(estagio: EstagioDunning, horaBRT: number): boolean {
  return HORARIO_POR_ESTAGIO[estagio] === horaBRT
}

/**
 * Hora atual em Brasília (0-23). Derivada do fuso EXPLÍCITO, não do relógio da máquina: o cron
 * pode rodar de qualquer lugar, e foi assim que o expire-plans acabou agendado em UTC rodando à
 * meia-noite BRT. Exportada para o cron poder injetar a hora em teste.
 */
export function horaAtualBRT(agora = new Date()): number {
  return Number(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false,
  }).format(agora))
}

/** Dia civil atual em Brasília, usado nas chaves diárias da outbox. */
export function dataAtualBRT(agora = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(agora)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}
