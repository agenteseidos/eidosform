/**
 * D-05 · fila de reenvio de e-mail — as REGRAS puras (backoff, janela, o que mata um item).
 *
 * O lote 3 adiou esta fila por um motivo legítimo: guardar o e-mail montado duplicaria dado
 * pessoal do lead em repouso. A decisão do Sidney (11/08/2026) foi guardar REFERÊNCIA e
 * remontar no reenvio — é isso que estes testes travam junto com a janela de 48h.
 */
import { describe, it, expect } from 'vitest'
import { proximaTentativaEm, janelaVencida, JANELA_MS, BACKOFF_MIN } from './email-retry-queue'

const AGORA = Date.parse('2026-08-11T12:00:00.000Z')

describe('backoff — curto no começo, largo depois', () => {
  it('a primeira tentativa é em minutos, não em horas (queda curta é o caso comum)', () => {
    const t = proximaTentativaEm(0, AGORA).getTime()
    expect((t - AGORA) / 60_000).toBe(5)
  })

  it('abre progressivamente e satura no último degrau (não martela provedor fora do ar)', () => {
    const esperas = BACKOFF_MIN.map((_, i) => (proximaTentativaEm(i, AGORA).getTime() - AGORA) / 60_000)
    expect(esperas).toEqual([...BACKOFF_MIN])
    // além do fim da lista, satura — nunca estoura o array nem volta pro começo
    const alem = (proximaTentativaEm(99, AGORA).getTime() - AGORA) / 60_000
    expect(alem).toBe(BACKOFF_MIN[BACKOFF_MIN.length - 1])
  })

  it('a soma dos degraus cobre a janela de 48h', () => {
    const somaMs = BACKOFF_MIN.reduce((a, b) => a + b, 0) * 60_000
    expect(somaMs).toBeGreaterThanOrEqual(JANELA_MS)
  })
})

describe('janela de 48h — decisão do Sidney', () => {
  it('dentro da janela, o item continua vivo', () => {
    const há1h = new Date(AGORA - 60 * 60_000).toISOString()
    expect(janelaVencida(há1h, AGORA)).toBe(false)
  })

  it('em 47h ainda vive; em 48h morre', () => {
    expect(janelaVencida(new Date(AGORA - 47 * 3600_000).toISOString(), AGORA)).toBe(false)
    expect(janelaVencida(new Date(AGORA - 48 * 3600_000).toISOString(), AGORA)).toBe(true)
  })

  it('data ilegível NÃO mata o item — erra a favor de tentar de novo', () => {
    // Falhar fechado aqui significaria descartar o aviso de um lead por causa de um dado
    // corrompido. O custo do erro oposto é uma tentativa a mais.
    expect(janelaVencida('não-é-data', AGORA)).toBe(false)
  })
})
