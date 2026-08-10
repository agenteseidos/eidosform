/**
 * Cota de respostas — leitura sem escrita (alinhamento Free, item 3).
 *
 * O TESTE QUE MAIS IMPORTA AQUI é o do período vencido.
 *
 * A alternativa óbvia — marcar o formulário como pausado ao estourar a cota — cria um travamento
 * PERMANENTE. Quem vira o mês é a chegada de uma resposta: a RPC `check_and_increment_response`
 * avança o período quando é chamada. Formulário pausado → ninguém responde → a RPC não roda → o
 * mês nunca vira → o formulário morre em março e não volta em abril. Nunca.
 *
 * Por isso a virada é CALCULADA na leitura. Se o período já venceu, o consumo vale zero, mesmo com
 * a coluna dizendo 100. A primeira resposta do mês novo é quem zera de fato, dentro da RPC.
 */
import { describe, it, expect } from 'vitest'
import { isOverResponseQuota, addCalendarMonth, buildResponseQuotaPeriodReset } from './response-quota'

const AGORA = new Date('2026-08-15T12:00:00Z')
const emDias = (d: number) => new Date(AGORA.getTime() + d * 24 * 3600 * 1000).toISOString()

describe('isOverResponseQuota — dentro do período', () => {
  it('no limite exato JÁ está sem cota', () => {
    expect(isOverResponseQuota(
      { responses_used: 100, responses_limit: 100, response_period_end_at: emDias(10) }, AGORA,
    )).toBe(true)
  })

  it('uma abaixo do limite ainda recebe', () => {
    expect(isOverResponseQuota(
      { responses_used: 99, responses_limit: 100, response_period_end_at: emDias(10) }, AGORA,
    )).toBe(false)
  })

  it('acima do limite (corrida) continua barrado', () => {
    expect(isOverResponseQuota(
      { responses_used: 137, responses_limit: 100, response_period_end_at: emDias(10) }, AGORA,
    )).toBe(true)
  })
})

describe('isOverResponseQuota — a cilada do travamento permanente', () => {
  it('período VENCIDO com contador cheio NÃO está sem cota', () => {
    // Este é o teste que impede o formulário de morrer para sempre. A coluna diz 100/100, mas o
    // período acabou ontem: a próxima resposta zera o contador na RPC. Hoje ele recebe.
    expect(isOverResponseQuota(
      { responses_used: 100, responses_limit: 100, response_period_end_at: emDias(-1) }, AGORA,
    )).toBe(false)
  })

  it('conta parada há meses volta a receber sem ninguém mexer', () => {
    expect(isOverResponseQuota(
      { responses_used: 100, responses_limit: 100, response_period_end_at: emDias(-120) }, AGORA,
    )).toBe(false)
  })

  it('no INSTANTE exato do fim do período já liberou', () => {
    const fim = AGORA.toISOString()
    expect(isOverResponseQuota(
      { responses_used: 100, responses_limit: 100, response_period_end_at: fim }, AGORA,
    )).toBe(false)
  })
})

describe('isOverResponseQuota — nunca barra por engano', () => {
  it('plano ilimitado (-1) nunca fica sem cota', () => {
    expect(isOverResponseQuota(
      { responses_used: 999999, responses_limit: -1, response_period_end_at: emDias(10) }, AGORA,
    )).toBe(false)
  })

  it('limite ausente ou perfil nulo não barram ninguém', () => {
    // Fail-OPEN aqui é o certo: barrar um formulário legítimo por dado faltando seria pior que
    // deixar passar uma resposta a mais — e o gate real continua na RPC, no momento de gravar.
    expect(isOverResponseQuota({ responses_used: 500, responses_limit: null }, AGORA)).toBe(false)
    expect(isOverResponseQuota(null, AGORA)).toBe(false)
    expect(isOverResponseQuota(undefined, AGORA)).toBe(false)
  })

  it('data de fim inválida é ignorada — decide pelo contador', () => {
    expect(isOverResponseQuota(
      { responses_used: 100, responses_limit: 100, response_period_end_at: 'não-é-data' }, AGORA,
    )).toBe(true)
    expect(isOverResponseQuota(
      { responses_used: 3, responses_limit: 100, response_period_end_at: 'não-é-data' }, AGORA,
    )).toBe(false)
  })

  it('sem data de fim decide só pelo contador', () => {
    expect(isOverResponseQuota({ responses_used: 100, responses_limit: 100 }, AGORA)).toBe(true)
    expect(isOverResponseQuota({ responses_used: 0, responses_limit: 100 }, AGORA)).toBe(false)
  })
})

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
