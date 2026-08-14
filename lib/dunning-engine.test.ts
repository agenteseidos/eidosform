/**
 * D-01 · o motor da régua de cobrança — a regra que decide se o cliente é avisado.
 *
 * O pior erro possível deste sistema é cobrar quem já pagou. O segundo pior é dizer "sua conta
 * foi rebaixada" para quem ainda está com plano ativo. Estes testes existem para os dois.
 */
import { describe, it, expect } from 'vitest'
import {
  decidirAviso, detectarRebaixamentoAtrasado, diasDesde, ehHoraDoEstagio,
  dataAtualBRT, HORARIO_POR_ESTAGIO, PRAZO_DIAS,
  HORARIO_WHATSAPP_POR_ESTAGIO,
  canaisNaHora,
} from './dunning-engine'

const AGORA = Date.parse('2026-08-20T15:00:00-03:00')
/** Data da cobrança vencida há N dias. */
const vencidaHa = (n: number) => new Date(AGORA - n * 86_400_000).toISOString().slice(0, 10)

const pagante = (over: Partial<Parameters<typeof decidirAviso>[0]> = {}) => ({
  plano: 'plus', planStatus: 'active', temVencida: true, vencidaDesde: vencidaHa(0), ...over,
})

describe('🛡️ gatilho de PARADA — quem pagou não recebe cobrança', () => {
  it('sem cobrança vencida → silêncio, seja qual for o dia da régua', () => {
    // É o coração do "se pagar no meio, os e-mails param": a pergunta é feita ao gateway na
    // hora, então o pagamento interrompe a régua sem ninguém precisar cancelar nada.
    for (const dia of [0, 1, 2, 3, 4, 5]) {
      const d = decidirAviso(pagante({ temVencida: false, vencidaDesde: vencidaHa(dia) }), AGORA)
      expect(d).toEqual({ avisar: false, motivo: 'sem_inadimplencia' })
    }
  })

  it('consulta ao gateway FALHOU → silêncio (nunca falar sem saber o estado)', () => {
    const d = decidirAviso(pagante({ temVencida: null }), AGORA)
    expect(d).toEqual({ avisar: false, motivo: 'consulta_falhou' })
  })
})

describe('a régua de 6 estágios, um por dia', () => {
  it.each([
    [0, 5], [1, 4], [2, 3], [3, 2], [4, 1],
  ])('vencida há %i dias → estágio %i com %i dias restantes', (dias) => {
    const d = decidirAviso(pagante({ vencidaDesde: vencidaHa(dias) }), AGORA)
    expect(d).toMatchObject({ avisar: true, estagio: dias, diasRestantes: PRAZO_DIAS - dias })
  })

  it('cobre os 5 dias do prazo SEM buraco — cada dia tem exatamente um estágio', () => {
    const estagios = [0, 1, 2, 3, 4].map((dia) => {
      const d = decidirAviso(pagante({ vencidaDesde: vencidaHa(dia) }), AGORA)
      return d.avisar ? d.estagio : null
    })
    expect(estagios).toEqual([0, 1, 2, 3, 4])
  })

  it('o prazo prometido bate com a carência do expire-plans', () => {
    // Se estes dois números divergirem, a régua promete um prazo que o rebaixamento não honra.
    expect(PRAZO_DIAS).toBe(5)
  })
})

describe('🛡️ o aviso de "já rebaixou" NUNCA mente', () => {
  it('passou do prazo e o cliente JÁ está no gratuito → manda o aviso final', () => {
    const d = decidirAviso(pagante({ plano: 'free', vencidaDesde: vencidaHa(5) }), AGORA)
    expect(d).toMatchObject({ avisar: true, estagio: 5 })
  })

  it('passou do prazo mas o cliente AINDA está pago (rebaixamento falhou) → CALA A BOCA', () => {
    // O caso que o Sidney levantou: se o expire-plans falhar, o e-mail de 9h não pode dizer
    // "sua conta foi rebaixada" para quem continua com o plus ativo.
    const d = decidirAviso(pagante({ plano: 'plus', vencidaDesde: vencidaHa(5) }), AGORA)
    expect(d.avisar).toBe(false)
  })

  it('a régua TEM FIM — não persegue ninguém depois do D+5', () => {
    for (const dia of [6, 10, 30, 90]) {
      const d = decidirAviso(pagante({ plano: 'free', vencidaDesde: vencidaHa(dia) }), AGORA)
      expect(d).toEqual({ avisar: false, motivo: 'fora_da_regua' })
    }
  })
})

describe('quem não é caso da régua', () => {
  it('já estava no gratuito dentro do prazo → nada a cobrar', () => {
    const d = decidirAviso(pagante({ plano: 'free', vencidaDesde: vencidaHa(2) }), AGORA)
    expect(d).toEqual({ avisar: false, motivo: 'plano_gratuito_sem_queda' })
  })

  it('sem data de vencimento legível → não invento prazo', () => {
    for (const ruim of [null, 'não-é-data', '']) {
      const d = decidirAviso(pagante({ vencidaDesde: ruim as string | null }), AGORA)
      expect(d).toEqual({ avisar: false, motivo: 'dados_insuficientes' })
    }
  })
})

describe('🛡️ detector: o rebaixamento não aconteceu', () => {
  it('passou do prazo e continua pago → ALERTA (o expire-plans não tem alarme próprio)', () => {
    expect(detectarRebaixamentoAtrasado(pagante({ plano: 'plus', vencidaDesde: vencidaHa(7) }), AGORA)).toBe(true)
  })

  it('rebaixou como devia → sem alarme', () => {
    expect(detectarRebaixamentoAtrasado(pagante({ plano: 'free', vencidaDesde: vencidaHa(7) }), AGORA)).toBe(false)
  })

  it('dentro do prazo NÃO é atraso — a carência é intencional', () => {
    expect(detectarRebaixamentoAtrasado(pagante({ plano: 'plus', vencidaDesde: vencidaHa(3) }), AGORA)).toBe(false)
  })

  it('quem pagou nunca dispara alarme', () => {
    expect(detectarRebaixamentoAtrasado(pagante({ temVencida: false, vencidaDesde: vencidaHa(9) }), AGORA)).toBe(false)
  })
})

describe('horários — rotação com a véspera fixa de manhã', () => {
  it('a rotação é 9h / 12h / 17h', () => {
    expect([HORARIO_POR_ESTAGIO[0], HORARIO_POR_ESTAGIO[1], HORARIO_POR_ESTAGIO[2]]).toEqual([9, 12, 17])
  })

  it('🛡️ o D+4 (véspera do corte) é de MANHÃ — o cliente precisa do dia inteiro', () => {
    expect(HORARIO_POR_ESTAGIO[4]).toBe(9)
  })

  it('nenhum aviso depois das 18h (cobrança à noite não deixa o cliente agir)', () => {
    for (const h of Object.values(HORARIO_POR_ESTAGIO)) expect(h).toBeLessThanOrEqual(18)
  })

  it('cada estágio dispara em UMA hora só', () => {
    expect(ehHoraDoEstagio(0, 9)).toBe(true)
    expect(ehHoraDoEstagio(0, 12)).toBe(false)
    expect(ehHoraDoEstagio(2, 17)).toBe(true)
  })
})

describe('diasDesde — contagem em horário de Brasília', () => {
  it('conta dias inteiros e ignora a hora', () => {
    expect(diasDesde('2026-08-20', Date.parse('2026-08-20T23:59:00-03:00'))).toBe(0)
    expect(diasDesde('2026-08-19', Date.parse('2026-08-20T00:01:00-03:00'))).toBe(1)
  })

  it('a chave diária só vira depois da meia-noite de Brasília', () => {
    expect(dataAtualBRT(new Date('2026-08-14T00:30:00Z'))).toBe('2026-08-13')
    expect(dataAtualBRT(new Date('2026-08-14T03:00:00Z'))).toBe('2026-08-14')
  })
})

describe('🛡️ horários por canal (14/08) — as duas tabelas obedecem às mesmas regras', () => {
  const ESTAGIOS = [0, 1, 2, 3, 4, 5] as const

  it('nenhum canal cobra fora da janela civilizada (8h–18h)', () => {
    // A regra estava escrita no motor desde 11/08 e a primeira proposta de horários do
    // WhatsApp a violava (D+2 às 19h). Cobrança à noite não pode ser respondida: banco
    // fechado — o cliente só dorme com o problema.
    for (const e of ESTAGIOS) {
      expect(HORARIO_POR_ESTAGIO[e]).toBeGreaterThanOrEqual(8)
      expect(HORARIO_POR_ESTAGIO[e]).toBeLessThanOrEqual(18)
      expect(HORARIO_WHATSAPP_POR_ESTAGIO[e]).toBeGreaterThanOrEqual(8)
      expect(HORARIO_WHATSAPP_POR_ESTAGIO[e]).toBeLessThanOrEqual(18)
    }
  })

  it('os canais NUNCA coincidem — o ganho da mudança é espalhar os toques', () => {
    for (const e of ESTAGIOS) {
      expect(HORARIO_WHATSAPP_POR_ESTAGIO[e]).not.toBe(HORARIO_POR_ESTAGIO[e])
    }
  })

  it('canaisNaHora devolve só o canal da vez', () => {
    expect(canaisNaHora(0, 9)).toEqual(['email'])     // D+0 e-mail
    expect(canaisNaHora(0, 15)).toEqual(['whatsapp']) // D+0 WhatsApp
    expect(canaisNaHora(0, 11)).toEqual([])           // hora de ninguém
  })
})
