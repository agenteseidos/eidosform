/**
 * VARREDURA DE ÓRFÃOS — a rotina que dois comentários prometiam e que não existia.
 *
 * Descoberta em 27/08/2026: `form-file-purge.ts` e `form-file-claim.ts` diziam "fica para a
 * varredura de órfãos"; ao procurá-la na auditoria, não havia nenhum cron de anexos. Promessa
 * em comentário não roda.
 *
 * O QUE ESTES TESTES PROTEGEM: remoção de arquivo é IRREVERSÍVEL. O erro caro aqui não é deixar
 * lixo — é apagar arquivo de cliente. Cada caso abaixo é uma forma de isso acontecer.
 */
import { describe, it, expect } from 'vitest'
import { decidirOrfaos, IDADE_MINIMA_MS } from './form-file-sweep'

const ANTIGO = Date.now() - 30 * 24 * 60 * 60 * 1000
const AGORA = Date.now()
const obj = (caminho: string, criadoEm = ANTIGO) => ({ caminho, criadoEm })

describe('🛡️ ficha VIVA sempre protege o objeto', () => {
  it.each(['pending', 'ready', 'claimed'])('status %s → NUNCA é órfão', (status) => {
    const r = decidirOrfaos({ objetos: [obj('u/f/a.pdf')], fichas: [{ object_path: 'u/f/a.pdf', status }] })
    expect(r).toEqual([])
  })

  it('objeto com DUAS fichas — uma revogada e uma viva — é PROTEGIDO', () => {
    // O caso do mesmo arquivo enviado em duas respostas: uma foi excluída, a outra continua de
    // pé. Achado no teste real de 18/08; a purga já respeita isso e a varredura também precisa.
    const r = decidirOrfaos({
      objetos: [obj('u/f/a.pdf')],
      fichas: [{ object_path: 'u/f/a.pdf', status: 'deleted' }, { object_path: 'u/f/a.pdf', status: 'claimed' }],
    })
    expect(r).toEqual([])
  })
})

describe('🛡️ os dois tipos de órfão', () => {
  it('ficha REVOGADA com objeto vivo → o remove() falhou; recolhe', () => {
    const r = decidirOrfaos({ objetos: [obj('u/f/a.pdf')], fichas: [{ object_path: 'u/f/a.pdf', status: 'deleted' }] })
    expect(r).toMatchObject([{ caminho: 'u/f/a.pdf', motivo: 'ficha_revogada' }])
  })

  it('objeto SEM ficha nenhuma → o órfão invisível (cascade levou a linha)', () => {
    // Legado do período 17→27/08, em que o DELETE deixou de purgar: apagar o formulário levava
    // as fichas junto e o arquivo ficava vivo, sem registro em lugar nenhum do banco.
    const r = decidirOrfaos({ objetos: [obj('u/f/a.pdf')], fichas: [] })
    expect(r).toMatchObject([{ caminho: 'u/f/a.pdf', motivo: 'sem_ficha' }])
  })
})

describe('🛡️ idade mínima — apagar cedo é irreversível, esperar não custa nada', () => {
  it('objeto recém-criado sem ficha NÃO é removido nesta rodada', () => {
    expect(decidirOrfaos({ objetos: [obj('u/f/novo.pdf', AGORA)], fichas: [] })).toEqual([])
  })

  it('um milissegundo antes do limite ainda é poupado', () => {
    const quase = AGORA - IDADE_MINIMA_MS + 1
    expect(decidirOrfaos({ objetos: [obj('u/f/a.pdf', quase)], fichas: [], agora: AGORA })).toEqual([])
  })

  it('exatamente no limite já entra', () => {
    const limite = AGORA - IDADE_MINIMA_MS
    expect(decidirOrfaos({ objetos: [obj('u/f/a.pdf', limite)], fichas: [], agora: AGORA })).toHaveLength(1)
  })
})

describe('🛡️ a rota aborta quando não consegue enxergar direito', () => {
  const rota = (() => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    return readFileSync(join(__dirname, '..', 'app', 'api', 'cron', 'anexos-orfaos', 'route.ts'), 'utf-8')
  })()

  it('falha ao ler as FICHAS aborta sem remover — senão todo objeto pareceria órfão', () => {
    // O modo de falha mais caro possível: a lista de fichas vem vazia por erro de rede e a
    // varredura apaga o bucket inteiro. Tem de abortar, não "seguir com o que deu".
    expect(rota).toContain('fichas_ilegiveis')
    expect(rota.indexOf('fichas_ilegiveis')).toBeLessThan(rota.indexOf('decidirOrfaos({'))
  })

  it('falha ao listar o STORAGE também aborta', () => {
    expect(rota).toContain('storage_ilegivel')
  })

  it('corte por teto é DENUNCIADO, nunca silencioso (lição do expire-plans)', () => {
    expect(rota).toContain('truncado')
    expect(rota).toMatch(/truncado[\s\S]{0,400}sendBillingOpsAlert/)
  })
})
