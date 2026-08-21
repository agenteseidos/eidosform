import { describe, it, expect } from 'vitest'
import {
  calcularDueAt, dentroDaJanela, normalizarTelefone, decidirFollowup,
  JANELA_INICIO_H, JANELA_FIM_H, DELAY_MIN,
} from './followup'

/**
 * As regras do follow-up do hero — o que decide se uma mensagem PAGA sai para o celular
 * de alguém. Cada recusa aqui existe por um motivo concreto; nenhuma é preciosismo.
 */
const brt = (dia: number, hora: number, min = 0) =>
  Date.parse(`2026-08-${String(dia).padStart(2, '0')}T${String(hora).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`)

describe('janela de envio (todos os dias, 8h–21h BRT)', () => {
  it('dentro da janela, sai em +30 min', () => {
    const agora = brt(20, 14)
    expect(calcularDueAt(agora)).toBe(agora + DELAY_MIN * 60_000)
  })

  it('teste às 23h vira mensagem às 8h do dia seguinte — não 23h30', () => {
    // O caso que a janela existe para evitar: mensagem de empresa em hora estranha vira
    // denúncia de spam, e denúncia derruba a qualidade do número da Elen em produção.
    const due = calcularDueAt(brt(20, 23))
    expect(new Date(due + -3 * 3600_000).getUTCHours()).toBe(JANELA_INICIO_H)
    expect(due).toBeGreaterThan(brt(21, 0))
  })

  it('teste de madrugada espera a abertura do MESMO dia', () => {
    const due = calcularDueAt(brt(20, 3))
    expect(due).toBe(brt(20, JANELA_INICIO_H))
  })

  it('teste às 20h50 empurra para o dia seguinte (o +30 min cairia fora)', () => {
    const due = calcularDueAt(brt(20, 20, 50))
    expect(due).toBe(brt(21, JANELA_INICIO_H))
  })

  it('dentroDaJanela cobre as bordas', () => {
    expect(dentroDaJanela(brt(20, JANELA_INICIO_H))).toBe(true)
    expect(dentroDaJanela(brt(20, JANELA_FIM_H - 1, 59))).toBe(true)
    expect(dentroDaJanela(brt(20, JANELA_FIM_H))).toBe(false)
    expect(dentroDaJanela(brt(20, 3))).toBe(false)
  })
})

describe('normalizarTelefone', () => {
  it('aceita celular e fixo brasileiros, com e sem DDI e com máscara', () => {
    expect(normalizarTelefone('(83) 98831-9814')).toBe('5583988319814')
    expect(normalizarTelefone('83988319814')).toBe('5583988319814')
    expect(normalizarTelefone('5583988319814')).toBe('5583988319814')
    expect(normalizarTelefone('+55 83 3221-0000')).toBe('558332210000')
  })

  it('devolve null para o que NÃO dá para enviar — vira skip, não tentativa recusada', () => {
    for (const lixo of ['', '   ', '123', 'abc', null, undefined, '1'.repeat(20)]) {
      expect(normalizarTelefone(lixo)).toBeNull()
    }
  })
})

describe('decidirFollowup', () => {
  const base = {
    telefone: '5583988319814',
    criouConta: false,
    contato: { lastInboundAt: null, optedOut: false },
    expiraEm: brt(22, 12),
    agora: brt(20, 14),
  }

  it('envia quando o lead sumiu, dentro da janela', () => {
    expect(decidirFollowup(base)).toEqual({ enviar: true })
  })

  /** A decisão do Sidney: o follow-up é para quem sumiu, não para quem virou cliente. */
  it('NÃO envia se a pessoa já criou conta', () => {
    const r = decidirFollowup({ ...base, criouConta: true })
    expect(r).toMatchObject({ enviar: false, motivo: 'conta_criada', definitivo: true })
  })

  /** Automação por cima de conversa em andamento é o pior tipo de robô. */
  it('NÃO envia se a pessoa já falou com a Elen', () => {
    const r = decidirFollowup({ ...base, contato: { lastInboundAt: brt(20, 13), optedOut: false } })
    expect(r).toMatchObject({ enviar: false, motivo: 'falou_com_elen', definitivo: true })
  })

  it('NÃO envia para quem pediu opt-out — e isso é definitivo, sempre', () => {
    const r = decidirFollowup({ ...base, contato: { lastInboundAt: null, optedOut: true } })
    expect(r).toMatchObject({ enviar: false, motivo: 'opt_out', definitivo: true })
  })

  /** ⚠️ FAIL-CLOSED: sem saber o estado, adiar. Nunca mandar no escuro. */
  it('estado DESCONHECIDO adia — e NÃO é definitivo (a próxima rodada tenta)', () => {
    const r = decidirFollowup({ ...base, contato: { lastInboundAt: null, optedOut: false, desconhecido: true } })
    expect(r).toMatchObject({ enviar: false, motivo: 'estado_desconhecido', definitivo: false })
  })

  it('sem telefone válido é definitivo — nunca haverá envio possível', () => {
    const r = decidirFollowup({ ...base, telefone: null })
    expect(r).toMatchObject({ enviar: false, motivo: 'sem_telefone', definitivo: true })
  })

  it('expirado é definitivo — "confirmamos seu teste" de 3 dias atrás é ruído', () => {
    const r = decidirFollowup({ ...base, agora: brt(23, 12) })
    expect(r).toMatchObject({ enviar: false, motivo: 'expirado', definitivo: true })
  })

  it('fora da janela adia, sem queimar a linha', () => {
    const r = decidirFollowup({ ...base, agora: brt(20, 23) })
    expect(r).toMatchObject({ enviar: false, motivo: 'fora_da_janela', definitivo: false })
  })

  it('a ordem das recusas protege o lead: opt-out vence janela e conta vence tudo', () => {
    // Alguém que pediu para não receber não pode "voltar" por estar fora da janela.
    const optOutForaDaJanela = decidirFollowup({
      ...base, agora: brt(20, 23), contato: { lastInboundAt: null, optedOut: true },
    })
    expect(optOutForaDaJanela).toMatchObject({ motivo: 'opt_out', definitivo: true })
  })
})
