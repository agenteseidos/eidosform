/**
 * lib/hero-demo/followup.ts — as REGRAS do follow-up do hero (D-10).
 *
 * Núcleo puro: janela de envio, normalização de telefone e a decisão de suprimir. Separado do
 * encanamento pela mesma razão do `decidirAviso` da régua de cobrança — regra que decide se uma
 * mensagem PAGA sai para o celular de alguém tem de ser testável sem banco e sem rede.
 */

/** Delay pedido pelo Sidney. O lead ainda está lendo a página nos primeiros minutos. */
export const DELAY_MIN = 30
/** Janela de envio (decisão do Sidney, 20/08): TODOS os dias, 8h–21h BRT. A Elen responde 24/7. */
export const JANELA_INICIO_H = 8
export const JANELA_FIM_H = 21
/** Depois disto, "confirmamos seu teste" virou notícia velha. */
export const VALIDADE_H = 48

const MS_H = 3600_000
/** BRT = UTC-3 o ano todo (o Brasil não tem horário de verão desde 2019). */
const OFFSET_BRT_MS = -3 * MS_H

function horaBRT(t: number): number {
  return new Date(t + OFFSET_BRT_MS).getUTCHours()
}

/**
 * Quando esta mensagem pode sair.
 *
 * Regra: +30 min; se cair fora da janela, empurra para a PRÓXIMA abertura. Sem isso, quem testa
 * às 23h de um sábado receberia mensagem de empresa às 23h30 — e irritação vira denúncia de spam,
 * que derruba a qualidade do número da Elen em produção.
 */
export function calcularDueAt(agora: number = Date.now()): number {
  const alvo = agora + DELAY_MIN * 60_000
  const h = horaBRT(alvo)
  if (h >= JANELA_INICIO_H && h < JANELA_FIM_H) return alvo

  // Fora da janela: próxima abertura (hoje se ainda for madrugada, senão amanhã).
  const brt = new Date(alvo + OFFSET_BRT_MS)
  const abertura = new Date(brt)
  abertura.setUTCMinutes(0, 0, 0)
  abertura.setUTCHours(JANELA_INICIO_H)
  if (h >= JANELA_FIM_H) abertura.setUTCDate(abertura.getUTCDate() + 1)
  return abertura.getTime() - OFFSET_BRT_MS
}

/** Está dentro da janela AGORA? Conferido de novo na hora do envio — o due_at pode ter ficado
 *  parado numa fila travada e não pode "vazar" para fora do horário depois. */
export function dentroDaJanela(agora: number = Date.now()): boolean {
  const h = horaBRT(agora)
  return h >= JANELA_INICIO_H && h < JANELA_FIM_H
}

/**
 * Telefone em dígitos, formato E.164 do Brasil (55 + DDD + número).
 *
 * Devolve `null` para o que não dá para enviar — e o `null` é uma decisão, não um erro: número
 * inválido vira `skipped`, nunca uma tentativa que a Meta recusa e consome cota.
 */
export function normalizarTelefone(bruto: string | null | undefined): string | null {
  const d = String(bruto ?? '').replace(/\D/g, '')
  if (!d) return null
  // Já veio com DDI do Brasil (55 + 10 ou 11 dígitos).
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d
  // Sem DDI: 10 (fixo) ou 11 (celular) dígitos.
  if (d.length === 10 || d.length === 11) return `55${d}`
  return null
}

export type EstadoContato = {
  /** Epoch ms do último inbound na Elen; null = nunca falou. */
  lastInboundAt: number | null
  optedOut: boolean
  /** null = não deu para consultar (Elen fora do ar, timeout). */
  desconhecido?: boolean
}

export type DecisaoFollowup =
  | { enviar: true }
  | { enviar: false; motivo: string; definitivo: boolean }

/**
 * Manda ou não?
 *
 * As recusas, e por que cada uma:
 *  · SEM TELEFONE → nunca haverá envio possível. Definitivo.
 *  · EXPIRADO → "confirmamos seu teste" de 3 dias atrás é ruído. Definitivo.
 *  · JÁ CRIOU CONTA → a decisão do Sidney: o follow-up é para quem sumiu, não para quem virou
 *    cliente. Definitivo.
 *  · JÁ FALOU COM A ELEN → conversa em andamento; automação por cima é o pior tipo de robô.
 *    Definitivo. (Só a MENSAGEM prova contato — "abriu o wa.me" é inobservável.)
 *  · OPT-OUT → a pessoa pediu para não receber. Definitivo, sempre.
 *  · ESTADO DESCONHECIDO → a Elen não respondeu. FAIL-CLOSED: adiar, nunca enviar no escuro.
 *    Não é definitivo: a próxima rodada tenta de novo.
 *  · FORA DA JANELA → adiar. Não é definitivo.
 */
export function decidirFollowup(params: {
  telefone: string | null
  criouConta: boolean
  contato: EstadoContato
  expiraEm: number
  agora?: number
}): DecisaoFollowup {
  const agora = params.agora ?? Date.now()
  if (!params.telefone) return { enviar: false, motivo: 'sem_telefone', definitivo: true }
  if (agora >= params.expiraEm) return { enviar: false, motivo: 'expirado', definitivo: true }
  if (params.criouConta) return { enviar: false, motivo: 'conta_criada', definitivo: true }
  if (params.contato.optedOut) return { enviar: false, motivo: 'opt_out', definitivo: true }
  if (params.contato.desconhecido) {
    return { enviar: false, motivo: 'estado_desconhecido', definitivo: false }
  }
  if (params.contato.lastInboundAt !== null) {
    return { enviar: false, motivo: 'falou_com_elen', definitivo: true }
  }
  if (!dentroDaJanela(agora)) return { enviar: false, motivo: 'fora_da_janela', definitivo: false }
  return { enviar: true }
}
