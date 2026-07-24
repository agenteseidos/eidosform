import { describe, it, expect } from 'vitest'
import { scanForCandidates, parseThresholdMin, type ScanRow, type ClaimState } from './route'

/**
 * Testes dos P1 do cron de lead abandonado (2ª auditoria Codex).
 * P2-9 apontou que os 532 testes verdes NÃO protegiam nada disto — o cron
 * chegou a produção com starvation comprovada e ninguém quebrou.
 */

const LEASE_CUTOFF = '2026-07-23T20:00:00.000Z' // claims criados ANTES disto estão vencidos

function row(id: string, minute: number): ScanRow {
  return {
    id,
    form_id: 'form-1',
    last_activity_at: `2026-07-23T10:${String(minute).padStart(2, '0')}:00.000Z`,
  }
}

/** Claim já ENVIADO (id preenchido). */
const sent = (): ClaimState => ({ wacli_message_id: 'msg-1', created_at: '2026-07-23T19:00:00.000Z' })
/** Claim PENDENTE dentro do lease (outra instância está mandando agora). */
const pendingFresh = (): ClaimState => ({ wacli_message_id: null, created_at: '2026-07-23T20:30:00.000Z' })
/** Claim PENDENTE vencido (processo morreu no meio) — retomável. */
const pendingStale = (): ClaimState => ({ wacli_message_id: null, created_at: '2026-07-23T19:00:00.000Z' })

function deps(pages: ScanRow[][], claims: Record<string, ClaimState>, budget = () => 30_000) {
  let call = 0
  const fetched: string[] = []
  return {
    fetched,
    pagesFetched: () => call,
    deps: {
      budgetLeft: budget,
      fetchPage: async (cursor: string) => {
        fetched.push(cursor)
        return pages[call++] ?? []
      },
      fetchClaims: async (ids: string[]) => {
        const m = new Map<string, ClaimState>()
        for (const id of ids) if (claims[id]) m.set(id, claims[id])
        return m
      },
    },
  }
}

const OPTS = {
  startCursor: '2026-07-20T00:00:00.000Z',
  batchLimit: 4,
  pageSize: 12,
  maxPages: 20,
  leaseCutoffIso: LEASE_CUTOFF,
  minBudgetMs: 9_000,
}

describe('scanForCandidates — P1-1 STARVATION (bug provado em produção)', () => {
  it('CONTINUA paginando quando a primeira página inteira já está avisada', async () => {
    // Reproduz produção: os 12 mais antigos da janela já têm claim. A v2 fazia
    // LIMIT batch*3 (=12) e parava aqui, com 0 enviados PARA SEMPRE — nenhum
    // lead novo era alertado até os antigos saírem da janela de 72h.
    const page1 = Array.from({ length: 12 }, (_, i) => row(`old-${i}`, i))
    const page2 = [row('novo-acionavel', 30)]
    const claims = Object.fromEntries(page1.map(r => [r.id, sent()]))

    const { deps: d, pagesFetched } = deps([page1, page2], claims)
    const res = await scanForCandidates(d, OPTS)

    expect(res.jaAvisados).toBe(12)
    expect(pagesFetched()).toBe(2)                       // NÃO parou na 1ª página
    expect(res.picked.map(p => p.row.id)).toEqual(['novo-acionavel'])
  })

  it('para de paginar assim que junta batchLimit acionáveis', async () => {
    const page1 = Array.from({ length: 12 }, (_, i) => row(`livre-${i}`, i))
    const { deps: d, pagesFetched } = deps([page1, [row('nunca', 59)]], {})
    const res = await scanForCandidates(d, OPTS)

    expect(res.picked).toHaveLength(4)
    expect(pagesFetched()).toBe(1)
    expect(res.varreduraCompleta).toBe(false)
  })

  it('página incompleta encerra a varredura (janela esgotada)', async () => {
    const { deps: d } = deps([[row('a', 1), row('b', 2)]], { a: sent(), b: sent() })
    const res = await scanForCandidates(d, OPTS)
    expect(res.varreduraCompleta).toBe(true)
    expect(res.picked).toHaveLength(0)
  })
})

describe('scanForCandidates — não-acionáveis NÃO ocupam vaga no lote', () => {
  it('leads sem telefone são pulados e o lote segue até achar os enviáveis', async () => {
    // Regressão de um bug que EU introduzi ao mover o check de telefone pra
    // depois do claim: leads sem telefone eram claimados, descartados e
    // liberados a cada run, ocupando as 4 vagas pra sempre (starvation v2).
    const page = [
      row('sem-tel-1', 1), row('sem-tel-2', 2), row('sem-tel-3', 3),
      row('sem-tel-4', 4), row('com-tel', 5),
    ]
    const { deps: d } = deps([page], {})
    const res = await scanForCandidates(
      { ...d, isActionable: (r) => r.id === 'com-tel' },
      OPTS
    )
    expect(res.naoAcionaveis).toBe(4)
    expect(res.picked.map(p => p.row.id)).toEqual(['com-tel'])
  })
})

describe('scanForCandidates — tempo comparado por EPOCH, não por string', () => {
  it('claim do BANCO (+00:00, 6 casas) vs lease do JS (Z, 3 casas) é julgado certo', async () => {
    // Formatos diferentes: comparar as strings direto é frágil por construção.
    const leaseCutoff = '2026-07-23T20:00:00.000Z'
    const claimAntigoDoBanco = { wacli_message_id: null, created_at: '2026-07-23T19:59:59.999999+00:00' }
    const claimNovoDoBanco = { wacli_message_id: null, created_at: '2026-07-23T20:00:00.000001+00:00' }
    const { deps: d } = deps([[row('vencido', 1), row('fresco', 2)]], {
      vencido: claimAntigoDoBanco as ClaimState,
      fresco: claimNovoDoBanco as ClaimState,
    })
    const res = await scanForCandidates(d, { ...OPTS, leaseCutoffIso: leaseCutoff })
    expect(res.picked.map(p => p.row.id)).toEqual(['vencido']) // só o vencido é retomado
    expect(res.jaAvisados).toBe(1)
  })

  it('created_at inválido nunca conta como "recente" (não suprime alerta pra sempre)', async () => {
    const { deps: d } = deps([[row('lixo', 1)]], {
      lixo: { wacli_message_id: null, created_at: 'não é data' } as ClaimState,
    })
    const res = await scanForCandidates(d, OPTS)
    expect(res.picked.map(p => p.row.id)).toEqual(['lixo'])
  })
})

describe('scanForCandidates — P1-2 CICLO DE VIDA DO CLAIM', () => {
  it('claim ENVIADO é pulado; PENDENTE FRESCO é pulado; PENDENTE VENCIDO é retomado', async () => {
    const page = [row('enviado', 1), row('pendente-fresco', 2), row('pendente-vencido', 3)]
    const { deps: d } = deps([page], {
      enviado: sent(),
      'pendente-fresco': pendingFresh(),
      'pendente-vencido': pendingStale(),
    })
    const res = await scanForCandidates(d, OPTS)

    expect(res.jaAvisados).toBe(2)
    expect(res.picked).toHaveLength(1)
    expect(res.picked[0].row.id).toBe('pendente-vencido')
    expect(res.picked[0].staleClaim).toBe(true) // vai pela retomada atômica, não INSERT
  })

  it('row sem claim nenhum entra como candidato novo (staleClaim=false)', async () => {
    const { deps: d } = deps([[row('virgem', 1)]], {})
    const res = await scanForCandidates(d, OPTS)
    expect(res.picked[0]).toMatchObject({ staleClaim: false })
  })
})

describe('scanForCandidates — P1-4 DEADLINE e limites de varredura', () => {
  it('corta por tempo ANTES de buscar página quando o orçamento acabou', async () => {
    const { deps: d, pagesFetched } = deps([[row('x', 1)]], {}, () => 3_000)
    const res = await scanForCandidates(d, OPTS)
    expect(res.cortadoPorTempo).toBe(true)
    expect(pagesFetched()).toBe(0)
    expect(res.picked).toHaveLength(0)
  })

  it('respeita maxPages — não varre a janela inteira sem fim', async () => {
    // Páginas com rows DISTINTAS e todas já avisadas: a varredura avança de
    // verdade, então só o teto de páginas a interrompe.
    const pages = Array.from({ length: 10 }, (_, p) =>
      Array.from({ length: 12 }, (_, i) => row(`p${p}-c${i}`, i))
    )
    const claims = Object.fromEntries(pages.flat().map(r => [r.id, sent()]))
    const { deps: d } = deps(pages, claims)
    const res = await scanForCandidates(d, { ...OPTS, maxPages: 3 })
    expect(res.paginas).toBe(3)
    expect(res.picked).toHaveLength(0)
    expect(res.varreduraCompleta).toBe(false) // parou pelo teto, não por fim de janela
  })

  it('páginas repetidas (sem nada novo) encerram a varredura em vez de rodar em círculo', async () => {
    const cheia = Array.from({ length: 12 }, (_, i) => row(`c-${i}`, i))
    const claims = Object.fromEntries(cheia.map(r => [r.id, sent()]))
    const { deps: d } = deps([cheia, cheia, cheia], claims)
    const res = await scanForCandidates(d, { ...OPTS, maxPages: 20 })
    expect(res.varreduraCompleta).toBe(true)
    expect(res.paginas).toBe(2) // 2ª página não trouxe id novo ⇒ fim
  })

  it('não pula rows com last_activity_at IGUAL ao do cursor (gte + set de vistos)', async () => {
    // Duas rows no mesmo instante: com `.gt` a segunda ficaria invisível pra
    // sempre. Com `.gte`, a página seguinte reapresenta a primeira — o set de
    // vistos descarta a repetida e a NOVA é considerada.
    const mesmoInstante = '2026-07-23T10:05:00.000Z'
    const a = { id: 'a', form_id: 'f', last_activity_at: mesmoInstante }
    const b = { id: 'b', form_id: 'f', last_activity_at: mesmoInstante }
    const { deps: d } = deps([[a], [a, b]], {}, () => 30_000)
    const res = await scanForCandidates(d, { ...OPTS, pageSize: 1 })
    expect(res.picked.map(p => p.row.id)).toEqual(['a', 'b'])
  })
})

describe('parseThresholdMin — P2-8 (fail-closed)', () => {
  it('ausente/vazio usa o padrão de 30', () => {
    expect(parseThresholdMin(undefined)).toBe(30)
    expect(parseThresholdMin('')).toBe(30)
    expect(parseThresholdMin(null)).toBe(30)
  })
  it('valor válido é respeitado', () => {
    expect(parseThresholdMin('45')).toBe(45)
  })
  it('lixo, zero, negativo e fora de faixa devolvem null (o run aborta)', () => {
    // Antes: Number('abc') = NaN e a comparação de data selecionava em silêncio.
    for (const bad of ['abc', '0', '-5', '4', '1441', '30.5']) {
      expect(parseThresholdMin(bad)).toBeNull()
    }
  })
})
