/**
 * D-01 · o motor da régua de cobrança — a regra que decide se o cliente é avisado.
 *
 * O pior erro possível deste sistema é cobrar quem já pagou. O segundo pior é dizer "sua conta
 * foi rebaixada" para quem ainda está com plano ativo. Estes testes existem para os dois.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  decidirAviso, detectarRebaixamentoAtrasado, diasDesde, ehHoraDoEstagio,
  dataAtualBRT, HORARIO_POR_ESTAGIO, PRAZO_DIAS, SLA_REBAIXAMENTO_MS,
  HORARIO_WHATSAPP_POR_ESTAGIO,
  canaisNaHora,
  hm,
  JANELA_MAXIMA,
  JANELA_MINIMA,
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

  it('a carência do expire-plans é a MESMA constante — não uma cópia com o mesmo valor', () => {
    // ⚠️ O teste acima SOZINHO não guardava nada: ele nunca importou nem leu o expire-plans.
    // Passaria intacto se alguém trocasse a carência do rebaixamento para 30 dias. Agora a
    // fonte é única e este teste quebra se alguém reintroduzir o literal. (Auditoria 25/08/2026.)
    const src = readFileSync(join(__dirname, '..', 'app', 'api', 'cron', 'expire-plans', 'route.ts'), 'utf-8')
    expect(src).toMatch(/const OVERDUE_GRACE_DAYS = PRAZO_DIAS/)
    expect(src).not.toMatch(/const OVERDUE_GRACE_DAYS = \d/)
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

  // ── A FRONTEIRA (auditoria 25/08/2026) ────────────────────────────────────────────────────
  // O detector exigia `dias > PRAZO_DIAS`, mas o expire-plans rebaixa em `dias >= PRAZO_DIAS`:
  // o DIA DEVIDO era ponto cego por construção, e o alarme desenhado para "o rebaixamento não
  // aconteceu" chegava 24h tarde. A suíte testava 7, 7, 3 e 9 — nunca 5. Estes casos travam
  // exatamente o dia da virada e o SLA que a substitui.
  const devidoEm = (diasAtras: number) =>
    Date.parse(`${vencidaHa(diasAtras)}T00:00:00-03:00`) + PRAZO_DIAS * 86_400_000

  it('DIA 5, passado o SLA, e a conta segue paga → ALERTA (era o ponto cego)', () => {
    const t = devidoEm(5) + SLA_REBAIXAMENTO_MS
    expect(diasDesde(vencidaHa(5), t)).toBe(PRAZO_DIAS)
    expect(detectarRebaixamentoAtrasado(pagante({ vencidaDesde: vencidaHa(5) }), t)).toBe(true)
  })

  it('DIA 5, no instante exato do devido → ainda NÃO alerta: o cron tem a janela do SLA', () => {
    expect(detectarRebaixamentoAtrasado(pagante({ vencidaDesde: vencidaHa(5) }), devidoEm(5))).toBe(false)
  })

  it('DIA 5, um milissegundo antes do fim do SLA → ainda NÃO alerta', () => {
    const t = devidoEm(5) + SLA_REBAIXAMENTO_MS - 1
    expect(detectarRebaixamentoAtrasado(pagante({ vencidaDesde: vencidaHa(5) }), t)).toBe(false)
  })

  it('DIA 4 nunca alerta, nem no fim do dia — a carência é intencional', () => {
    const fimDoDia4 = devidoEm(4) - 1
    expect(diasDesde(vencidaHa(4), fimDoDia4)).toBe(PRAZO_DIAS - 1)
    expect(detectarRebaixamentoAtrasado(pagante({ vencidaDesde: vencidaHa(4) }), fimDoDia4)).toBe(false)
  })

  it('o SLA cobre a janela real do agendador (Vercel Hobby até 00:59 + backstop 01:10 BRT)', () => {
    // Se alguém mexer nos horários do cron sem revisar o SLA, este teste denuncia.
    expect(SLA_REBAIXAMENTO_MS).toBeGreaterThanOrEqual(70 * 60_000)
  })
})

describe('horários — rotação com a véspera fixa de manhã', () => {
  it('a rotação é 9h / 12h / 19h30 (o turno da noite entrou em 14/08)', () => {
    expect([HORARIO_POR_ESTAGIO[0], HORARIO_POR_ESTAGIO[1], HORARIO_POR_ESTAGIO[2]])
      .toEqual([hm(9), hm(12), hm(19, 30)])
  })

  it('🛡️ o D+4 (véspera do corte) é de MANHÃ — o cliente precisa do dia inteiro', () => {
    expect(HORARIO_POR_ESTAGIO[4]).toBe(hm(9))
  })

  it('nenhum aviso fora da janela civilizada (8h–19h30)', () => {
    for (const h of Object.values(HORARIO_POR_ESTAGIO)) expect(h).toBeLessThanOrEqual(JANELA_MAXIMA)
  })

  it('cada estágio dispara em UMA fatia só', () => {
    expect(ehHoraDoEstagio(0, hm(9))).toBe(true)
    expect(ehHoraDoEstagio(0, hm(12))).toBe(false)
    expect(ehHoraDoEstagio(2, hm(19, 30))).toBe(true)
    expect(ehHoraDoEstagio(2, hm(17))).toBe(false)
  })

  it('🛡️ o timer dispara aos :05/:35 — a fatia de 30 min é que faz o horário casar', () => {
    // Sem o arredondamento por fatia, hm(19,30) nunca bateria com um disparo às 19h35 e o
    // turno da noite seria mudo — a mesma família do bug de 13/08 (régua silenciosa).
    expect(ehHoraDoEstagio(2, hm(19, 35))).toBe(true)   // disparo real do timer
    expect(ehHoraDoEstagio(0, hm(9, 5))).toBe(true)     // idem, hora cheia
    expect(ehHoraDoEstagio(2, hm(19, 0))).toBe(false)   // fatia anterior NÃO conta
    expect(ehHoraDoEstagio(2, hm(20, 5))).toBe(false)   // fatia seguinte também não
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

  it('nenhum canal cobra fora da janela civilizada (8h–19h30)', () => {
    // A regra estava escrita no motor desde 11/08 e a primeira proposta de horários do
    // WhatsApp a violava (D+2 às 19h). Cobrança à noite não pode ser respondida: banco
    // fechado — o cliente só dorme com o problema.
    for (const e of ESTAGIOS) {
      expect(HORARIO_POR_ESTAGIO[e]).toBeGreaterThanOrEqual(JANELA_MINIMA)
      expect(HORARIO_POR_ESTAGIO[e]).toBeLessThanOrEqual(JANELA_MAXIMA)
      expect(HORARIO_WHATSAPP_POR_ESTAGIO[e]).toBeGreaterThanOrEqual(JANELA_MINIMA)
      expect(HORARIO_WHATSAPP_POR_ESTAGIO[e]).toBeLessThanOrEqual(JANELA_MAXIMA)
    }
  })

  it('🛡️ as 12 células estão TRAVADAS — mudar qualquer horário quebra aqui', () => {
    // Sabotagem do Codex (14/08): mover o WhatsApp do D+1 de 19h30 p/ 18h30 não derrubava
    // NENHUM teste, porque só se verificava limite e colisão. Tabela é decisão de produto —
    // muda com intenção, nunca por acidente.
    expect(HORARIO_POR_ESTAGIO).toEqual({
      0: hm(9), 1: hm(12), 2: hm(19, 30), 3: hm(9), 4: hm(9), 5: hm(9),
    })
    expect(HORARIO_WHATSAPP_POR_ESTAGIO).toEqual({
      0: hm(15), 1: hm(19, 30), 2: hm(11), 3: hm(15), 4: hm(13), 5: hm(11),
    })
  })

  it('🛡️ existe pelo menos UM turno noturno em cada canal (pedido do Sidney, 14/08)', () => {
    const noite = (t: Record<number, number>) => Object.values(t).some((m) => m >= hm(19))
    expect(noite(HORARIO_POR_ESTAGIO)).toBe(true)
    expect(noite(HORARIO_WHATSAPP_POR_ESTAGIO)).toBe(true)
  })

  it('os canais NUNCA coincidem — o ganho da mudança é espalhar os toques', () => {
    for (const e of ESTAGIOS) {
      expect(HORARIO_WHATSAPP_POR_ESTAGIO[e]).not.toBe(HORARIO_POR_ESTAGIO[e])
    }
  })

  it('canaisNaHora devolve só o canal da vez', () => {
    expect(canaisNaHora(0, hm(9))).toEqual(['email'])     // D+0 e-mail
    expect(canaisNaHora(0, hm(15))).toEqual(['whatsapp']) // D+0 WhatsApp
    expect(canaisNaHora(0, hm(11))).toEqual([])           // hora de ninguém
  })
})
